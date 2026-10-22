#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""在本机把 docker save 导出的 tar 直接推到 Docker Hub（本机不需要装 Docker）。

为什么要有这个脚本：
    NAS 上 dockerd 出不了网（DNS 被污染 + 443 被阻断）时，`docker push` 根本推不动。
    所以改成：NAS 上 `docker save` → 把 tar 拉到本机 → 本机用 crane 从 tar 直接推。
    crane 是单文件 Go 程序，不吃 dockerd，也不吃 root。

网络优先级（--proxy auto，默认）：
    1) 直连能到 registry  → 不走代理（正常情况就是这条）
    2) 直连不通、SOCKS 活着 → 起本机 HTTP CONNECT 代理，上游转 SOCKS5
    3) 都不行            → 明确报错，别在那儿干等超时

用法：
    python deploy/push-local.py --username aag111 --token 'dckr_pat_...' \
        --image suteng-erp --tarball C:/path/to/suteng-erp.tar

    # 强制直连 / 强制走 SOCKS
    python deploy/push-local.py ... --proxy none
    python deploy/push-local.py ... --proxy socks

前置：crane 放在 suteng-erp/.tools/crane.exe（脚本默认就去那儿找），
      重新下载：https://github.com/google/go-containerregistry/releases
"""

from __future__ import annotations

import argparse
import os
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

REGISTRY = "registry-1.docker.io"
REGISTRY_V2 = f"https://{REGISTRY}/v2/"

DEFAULT_SOCKS_HOST = "127.0.0.1"
DEFAULT_SOCKS_PORT = 10808
PROXY_PORT = 18080


# --------------------------------------------------------------------------- #
# 连通性探测
# --------------------------------------------------------------------------- #
def probe_direct(timeout: float = 10.0) -> bool:
    """不走任何代理，直接打 registry。拿到 401/403 就算通（说明能协商到鉴权那一步）。"""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(REGISTRY_V2, timeout=timeout) as r:
            return r.status < 500
    except urllib.error.HTTPError as e:
        return e.code in (401, 403)
    except Exception:
        return False


def port_alive(host: str, port: int, timeout: float = 3.0) -> bool:
    try:
        socket.create_connection((host, port), timeout=timeout).close()
        return True
    except OSError:
        return False


# --------------------------------------------------------------------------- #
# SOCKS5（只做 CONNECT）——直连不通时才用得上
# --------------------------------------------------------------------------- #
def _is_ip(h: str) -> bool:
    try:
        socket.inet_aton(h)
        return h.count(".") == 3
    except OSError:
        return False


def socks5_connect(dst_host: str, dst_port: int, socks_host: str, socks_port: int,
                   timeout: float = 25.0) -> socket.socket:
    s = socket.create_connection((socks_host, socks_port), timeout=timeout)
    s.settimeout(timeout)
    s.sendall(b"\x05\x01\x00")
    if s.recv(2) != b"\x05\x00":
        raise OSError("SOCKS5 握手失败")

    req = b"\x05\x01\x00"
    if _is_ip(dst_host):
        req += b"\x01" + socket.inet_aton(dst_host)
    else:
        hb = dst_host.encode("idna")
        req += b"\x03" + bytes([len(hb)]) + hb
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


# --------------------------------------------------------------------------- #
# HTTP CONNECT 代理（Go 程序只认 HTTP 代理，不认 socks5://）
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


def _handle_client(client: socket.socket, socks_host: str, socks_port: int) -> None:
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
        upstream = socks5_connect(host, int(port), socks_host, socks_port)
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


def start_proxy(port: int, socks_host: str, socks_port: int) -> None:
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", port))
    srv.listen(32)
    srv.settimeout(0.5)

    def loop():
        while True:
            try:
                conn, _ = srv.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            threading.Thread(target=_handle_client, args=(conn, socks_host, socks_port),
                             daemon=True).start()

    threading.Thread(target=loop, daemon=True).start()


# --------------------------------------------------------------------------- #
def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description="本机用 crane 把 tar 推到 Docker Hub")
    ap.add_argument("--username", required=True)
    ap.add_argument("--token", required=True)
    ap.add_argument("--image", default="suteng-erp")
    ap.add_argument("--tag", default="latest")
    ap.add_argument("--tarball", required=True, help="docker save 导出的 tar")
    ap.add_argument("--crane", default=os.path.join(here, "..", ".tools", "crane.exe"),
                    help="crane 可执行文件（默认 .tools/crane.exe）")
    ap.add_argument("--proxy", choices=["auto", "none", "socks"], default="auto",
                    help="auto=先试直连，不通再走 SOCKS；none=只直连；socks=只走代理")
    ap.add_argument("--socks-host", default=DEFAULT_SOCKS_HOST)
    ap.add_argument("--socks-port", type=int, default=DEFAULT_SOCKS_PORT)
    ap.add_argument("--no-date-tag", action="store_true", help="不额外补 vYYYYMMDD tag")
    args = ap.parse_args()

    def log(msg: str) -> None:
        print(f"[push] {msg}", flush=True)

    tarball = os.path.abspath(args.tarball)
    if not os.path.isfile(tarball):
        raise SystemExit(f"找不到 tar：{tarball}")
    crane = os.path.abspath(args.crane)
    if not os.path.isfile(crane):
        raise SystemExit(f"找不到 crane：{crane}（去 go-containerregistry releases 下 Windows_x86_64 放到 .tools/）")

    log(f"tar    : {tarball}（{os.path.getsize(tarball) / 1048576:.0f} MB）")
    log(f"crane  : {crane}")

    ref = f"{REGISTRY}/{args.username}/{args.image}:{args.tag}"
    env = dict(os.environ)
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        env.pop(k, None)
    # 凭据写临时目录，不碰用户已有的 ~/.docker/config.json
    tmp_cfg = os.path.join(os.environ.get("TEMP", "."), "crane-docker-config")
    os.makedirs(tmp_cfg, exist_ok=True)
    env["DOCKER_CONFIG"] = tmp_cfg

    # ---- 决定走哪条路 ----
    mode = args.proxy
    if mode == "auto":
        log("探测直连 ...")
        if probe_direct():
            mode = "none"
            log("  直连可用")
        else:
            log("  直连不通，看有没有 SOCKS 出口")
            if port_alive(args.socks_host, args.socks_port):
                mode = "socks"
                log(f"  SOCKS {args.socks_host}:{args.socks_port} 在")
            else:
                raise SystemExit(
                    "直连到 registry-1.docker.io 不通，且没有可用的 SOCKS 代理。\n"
                    "请打开代理软件，或加 --proxy socks --socks-port <端口> 指一个能用的。"
                )

    if mode == "socks":
        log(f"启动本机 HTTP 代理 :{PROXY_PORT}（上游 SOCKS5 {args.socks_host}:{args.socks_port}）")
        start_proxy(PROXY_PORT, args.socks_host, args.socks_port)
        time.sleep(0.4)
        env["HTTPS_PROXY"] = env["HTTP_PROXY"] = f"http://127.0.0.1:{PROXY_PORT}"
        env["NO_PROXY"] = env["no_proxy"] = "localhost,127.0.0.1,192.168.0.0/16"
    else:
        log("走直连（不设代理）")
        env["NO_PROXY"] = env["no_proxy"] = "*"

    def run(cmd: list[str], timeout: int | None = None) -> int:
        return subprocess.run(cmd, env=env, timeout=timeout).returncode

    log(f"crane auth login {REGISTRY} ...")
    if run([crane, "auth", "login", "-u", args.username, "-p", args.token, REGISTRY],
           timeout=180) != 0:
        raise SystemExit("crane auth login 失败（凭据或网络问题）")

    log(f"开始推送 → {ref}")
    log("（layers 是分块上传，中断后重跑会复用已推的层，不会从头再来）")
    code = run([crane, "push", tarball, ref])
    if code != 0:
        raise SystemExit(f"crane push 失败（exit {code}）")

    if not args.no_date_tag:
        extra = "v" + time.strftime("%Y%m%d")
        log(f"补 tag {extra} ...")
        # 注意：crane tag 的第二个参数只收「标签名」，不能传 a/b/c:v20261021 这种完整引用，
        # 否则会被当成 tag 字符串拼进 URL，报 404 page not found。
        if run([crane, "tag", ref, extra], timeout=300) != 0:
            log(f"  补 tag 失败（{ref} 本体已成功，不影响拉取）")

    log("回查远端 ...")
    run([crane, "digest", ref], timeout=120)
    run([crane, "ls", f"{args.username}/{args.image}"], timeout=120)

    print("\n" + "=" * 64)
    print(f"  镜像地址：docker.io/{args.username}/{args.image}:{args.tag}")
    print(f"  拉取命令：docker pull {args.username}/{args.image}:{args.tag}")
    print(f"  页面地址：https://hub.docker.com/r/{args.username}/{args.image}")
    print("=" * 64)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
