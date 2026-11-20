#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""在本机搭一条「NAS → 本机 SOCKS 代理」的通道，然后用 crane 把镜像推到 Docker Hub。

为什么需要这个：
    NAS 所在网络到 Docker Hub 的 DNS 被污染、443 被阻断，dockerd 直连推不了；
    本机有可用 SOCKS5（默认 127.0.0.1:10808），但 NAS 访问不到本机回环。

做法：
    1) 本机开一个 HTTP CONNECT 代理（监听 127.0.0.1:18080），上游走本机 SOCKS5；
    2) SSH 到 NAS，用「远程端口转发」把 127.0.0.1:18888（NAS 侧）接到本机 18080；
    3) NAS 上用 crane（不依赖 dockerd）读 docker save 的 tar 再 push，
       期间只给 crane 进程设 HTTPS_PROXY，不动 daemon.json、不重启 docker。

用法：
    python deploy/push-via-tunnel.py --username aag111 --token 'dckr_pat_...' \
        --image suteng-erp --source-image suteng-erp-erp:latest [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import getpass
import os
import socket
import struct
import sys
import threading
import time
import urllib.request

try:
    import paramiko
except ImportError:  # pragma: no cover
    print("缺少 paramiko，请用带 paramiko 的 venv 解释器跑本脚本。", file=sys.stderr)
    raise SystemExit(2)

LOCAL_PROXY_PORT = 18080
REMOTE_PROXY_PORT = 18888
SOCKS_HOST = "127.0.0.1"
SOCKS_PORT = 10808
CRANE = "/tmp/crane"


# --------------------------------------------------------------------------- #
# SOCKS5 最小客户端（只做 CONNECT）
# --------------------------------------------------------------------------- #
def socks5_connect(dst_host: str, dst_port: int, timeout: float = 25.0) -> socket.socket:
    s = socket.create_connection((SOCKS_HOST, SOCKS_PORT), timeout=timeout)
    s.settimeout(timeout)
    s.sendall(b"\x05\x01\x00")
    if s.recv(2) != b"\x05\x00":
        raise OSError("SOCKS5 握手失败（代理要求认证？）")

    host_b = dst_host.encode("idna") if not _is_ip(dst_host) else dst_host.encode()
    req = b"\x05\x01\x00"
    if _is_ip(dst_host):
        req += b"\x01" + socket.inet_aton(dst_host)
    else:
        req += b"\x03" + bytes([len(host_b)]) + host_b
    req += struct.pack("!H", dst_port)
    s.sendall(req)

    head = s.recv(4)
    if len(head) < 4 or head[0] != 5 or head[1] != 0:
        raise OSError(f"SOCKS5 CONNECT 被拒绝：{head!r}")

    atyp = head[3]
    if atyp == 1:
        s.recv(6)
    elif atyp == 3:
        n = s.recv(1)[0]
        s.recv(n + 2)
    elif atyp == 4:
        s.recv(18)
    s.settimeout(None)
    return s


def _is_ip(h: str) -> bool:
    try:
        socket.inet_aton(h)
        return h.count(".") == 3
    except OSError:
        return False


# --------------------------------------------------------------------------- #
# HTTP CONNECT 代理（上游走 SOCKS5）
# --------------------------------------------------------------------------- #
def _pump(a: socket.socket, b: socket.socket) -> None:
    def one_way(src, dst):
        try:
            while True:
                data = src.recv(65536)
                if not data:
                    break
                dst.sendall(data)
        except OSError:
            pass
        finally:
            try:
                dst.shutdown(socket.SHUT_WR)
            except OSError:
                pass

    t = threading.Thread(target=one_way, args=(b, a), daemon=True)
    t.start()
    one_way(a, b)
    t.join(timeout=5)


def handle_client(client: socket.socket) -> None:
    try:
        client.settimeout(30)
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = client.recv(4096)
            if not chunk:
                client.close()
                return
            buf += chunk
            if len(buf) > 65536:
                client.close()
                return
        line = buf.split(b"\r\n", 1)[0].decode("latin-1")
        parts = line.split(" ")
        if len(parts) < 2 or parts[0].upper() != "CONNECT":
            client.sendall(b"HTTP/1.1 405 Method Not Allowed\r\n\r\n")
            client.close()
            return
        host, _, port = parts[1].rpartition(":")
        upstream = socks5_connect(host, int(port))
        client.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        client.settimeout(None)
        _pump(client, upstream)
        upstream.close()
    except Exception:
        pass
    finally:
        try:
            client.close()
        except OSError:
            pass


def start_http_proxy(port: int) -> socket.socket:
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", port))
    srv.listen(16)
    srv.settimeout(0.5)

    stop = threading.Event()

    def loop():
        while not stop.is_set():
            try:
                conn, _ = srv.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            threading.Thread(target=handle_client, args=(conn,), daemon=True).start()

    threading.Thread(target=loop, daemon=True).start()
    return srv


# --------------------------------------------------------------------------- #
# SSH 远程转发：NAS:18888 -> 本机:18080
# --------------------------------------------------------------------------- #
def start_remote_forward(transport: paramiko.Transport, remote_port: int, local_port: int) -> None:
    transport.request_port_forward("127.0.0.1", remote_port)

    def loop():
        while transport.is_active():
            try:
                chan = transport.accept(1.0)
            except Exception:
                break
            if chan is None:
                continue
            try:
                upstream = socket.create_connection(("127.0.0.1", local_port), timeout=30)
            except OSError:
                chan.close()
                continue
            threading.Thread(target=_pump_chan, args=(chan, upstream), daemon=True).start()

    threading.Thread(target=loop, daemon=True).start()


def _pump_chan(chan, sock):
    def chan_to_sock():
        try:
            while True:
                data = chan.recv(65536)
                if not data:
                    break
                sock.sendall(data)
        except Exception:
            pass
        finally:
            try:
                sock.shutdown(socket.SHUT_WR)
            except OSError:
                pass

    t = threading.Thread(target=chan_to_sock, daemon=True)
    t.start()
    try:
        while True:
            data = sock.recv(65536)
            if not data:
                break
            chan.sendall(data)
    except Exception:
        pass
    finally:
        t.join(timeout=5)
        try:
            chan.close()
        except Exception:
            pass
        try:
            sock.close()
        except OSError:
            pass


# --------------------------------------------------------------------------- #
# Docker Hub
# --------------------------------------------------------------------------- #
HUB_LOGIN = "https://hub.docker.com/v2/users/login/"


def hub_login(username: str, token: str) -> dict:
    body = json.dumps({"username": username, "password": token}).encode()
    req = urllib.request.Request(
        HUB_LOGIN, data=body, method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "suteng-erp-push/1.0"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def main() -> int:
    ap = argparse.ArgumentParser(description="通过 SSH 反向隧道推镜像到 Docker Hub")
    ap.add_argument("--username", required=True)
    ap.add_argument("--token", required=True)
    ap.add_argument("--image", default="suteng-erp")
    ap.add_argument("--tag", default="latest")
    ap.add_argument("--source-image", default="suteng-erp-erp:latest")
    ap.add_argument("--host", default="192.168.1.110")
    ap.add_argument("--ssh-port", type=int, default=22033)
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default=os.environ.get("NAS_SSH_PASSWORD", ""),
                    help="NAS SSH 密码（也可用环境变量 NAS_SSH_PASSWORD）")
    ap.add_argument("--dry-run", action="store_true", help="只验证通道，不真正 push")
    args = ap.parse_args()
    if not args.password:
        args.password = getpass.getpass("NAS SSH 密码: ")

    def log(msg: str) -> None:
        print(f"[push] {msg}", flush=True)

    target = f"{args.username}/{args.image}:{args.tag}"
    # crane 需要显式 registry 主机名，避免被 daemon.json 里的 mirror 影响（crane 不读 daemon 配置，但保持显式更稳）
    push_ref = f"registry-1.docker.io/{target}"

    # 0) 先在本机确认代理可用（本机自带 socks 出口）
    log("检查本机 SOCKS 代理...")
    try:
        socks5_connect("registry-1.docker.io", 443).close()
        log(f"SOCKS5 {SOCKS_HOST}:{SOCKS_PORT} 可用")
    except OSError as exc:
        raise SystemExit(f"本机 SOCKS5 不可用（{exc}），请确认代理软件在跑。")

    # 1) 校验 Docker Hub 凭据（走本机默认网络，本机有 socks 环境吗？没有就跳过强校验）
    log(f"校验 Docker Hub 凭据（{args.username}）...")
    try:
        data = hub_login(args.username, args.token)
        if not data.get("token"):
            raise SystemExit(f"凭据校验失败：{data}")
        log("凭据有效")
    except SystemExit:
        raise
    except Exception as exc:
        log(f"（跳过本机凭据校验：{exc}；改由 NAS 上的 crane 登录结果判断）")

    # 2) 起代理 + 隧道
    log(f"启动本机 HTTP 代理 :{LOCAL_PROXY_PORT}（上游 SOCKS5 {SOCKS_PORT}）")
    start_http_proxy(LOCAL_PROXY_PORT)

    log(f"SSH 连接 {args.user}@{args.host}:{args.ssh_port}")
    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(args.host, port=args.ssh_port, username=args.user,
                password=args.password, timeout=20, allow_agent=False, look_for_keys=False)
    transport = cli.get_transport()
    start_remote_forward(transport, REMOTE_PROXY_PORT, LOCAL_PROXY_PORT)
    time.sleep(1.0)
    log(f"反向隧道就绪：NAS 127.0.0.1:{REMOTE_PROXY_PORT} → 本机 :{LOCAL_PROXY_PORT}")

    env = (f"HTTPS_PROXY=http://127.0.0.1:{REMOTE_PROXY_PORT} "
           f"HTTP_PROXY=http://127.0.0.1:{REMOTE_PROXY_PORT} "
           f"NO_PROXY=localhost,127.0.0.1,192.168.1.0/24")

    def run(cmd: str, timeout: int = 1800, echo: bool = True) -> tuple[int, str]:
        stdin, stdout, stderr = transport.open_session(timeout=timeout)
        stdin.exec_command(cmd)
        buf = []
        for line in iter(stdout.readline, ""):
            buf.append(line)
            if echo and line.strip():
                print("   ", line.rstrip())
        err = stderr.read().decode("utf-8", "replace").strip()
        if err:
            buf.append(err)
            if echo:
                print("[stderr]", err[:2000], file=sys.stderr)
        return stdout.channel.recv_exit_status(), "".join(buf)

    try:
        # 3) 通道自测：让 NAS 上的 crane 通过隧道访问 registry
        log("通道自测：NAS 上 crane 通过隧道连 registry-1.docker.io ...")
        code, out = run(f"{env} {CRANE} catalog 2>&1 | head -5", timeout=90)
        print(f"    exit={code}")
        if code != 0 and "401" not in out and "unauthorized" not in out.lower():
            log("通道自测未通过，后面多半也会失败，先继续但注意输出")

        if args.dry_run:
            log("--dry-run：到此为止，不推镜像。")
            return 0

        # 4) 登录 + 推
        log(f"crane auth login registry-1.docker.io（用户 {args.username}）...")
        code, out = run(
            f"{env} printf '%s' {shq(args.token)} | {CRANE} auth login -u {shq(args.username)} "
            f"--password-stdin registry-1.docker.io 2>&1", timeout=120)
        if code != 0:
            raise SystemExit(f"crane auth login 失败（exit {code}）")

        log("确认 NAS 上镜像存在...")
        code, out = run(
            "echo %s | sudo -S -p '' docker images --format '{{.Repository}}:{{.Tag}}' "
            "| grep -x %s || true" % (shq(args.password), shq(args.source_image)), echo=False)
        if args.source_image not in out:
            raise SystemExit(f"NAS 上不存在 {args.source_image}")
        log(f"源镜像：{args.source_image}")

        log("docker save | crane push（大镜像，请耐心等；输出是分层上传进度）...")
        cmd = (
            "echo %s | sudo -S -p '' sh -c %s"
            % (
                shq(args.password),
                shq(f"docker save {args.source_image} | {env} {CRANE} push - {push_ref}"),
            )
        )
        code, _ = run(cmd, timeout=5400)
        if code != 0:
            raise SystemExit(f"crane push 失败（exit {code}），见上面的输出")

        # 5) 补一个日期 tag（同一份 manifest，秒完成）
        extra = "v" + time.strftime("%Y%m%d")
        log(f"补 tag {extra} ...")
        code, _ = run(f"{env} {CRANE} tag {push_ref} {push_ref.rsplit(':', 1)[0]}:{extra}", timeout=180)
        if code != 0:
            log("（补 tag 失败，不影响 latest）")

        log("回查远端 digest ...")
        run(f"{env} {CRANE} digest {push_ref}", timeout=120)
    finally:
        try:
            transport.cancel_port_forward("127.0.0.1", REMOTE_PROXY_PORT)
        except Exception:
            pass
        cli.close()

    print("\n" + "=" * 64)
    print(f"  镜像地址：docker.io/{target}")
    print(f"  拉取命令：docker pull {target}")
    print(f"  页面地址：https://hub.docker.com/r/{args.username}/{args.image}")
    print("=" * 64)
    return 0


def shq(s: str) -> str:
    import shlex
    return shlex.quote(s)


if __name__ == "__main__":
    raise SystemExit(main())
