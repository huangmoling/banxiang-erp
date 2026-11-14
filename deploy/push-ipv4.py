#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 docker save 的 tar 推到 Docker Hub —— 强制走 IPv4 版。

为什么需要这个（2026-11-14 遇到）：
    本机到 registry-1.docker.io 的 IPv4 是通的（curl -4 拿 401），IPv6 却会
    「连上之后被 RST」。crane 是 Go 程序，Happy Eyeballs 先连上 IPv6 之后
    不会回退，于是 push 直接挂在第一句 `GET /v2/` 上：
        read tcp [2408:...]:41649->[2600:...]:443: wsarecv: forcibly closed

    正常解法是 hosts 把域名钉到 IPv4，但那要管理员权限（本机没有）。
    所以这里起一个本地 CONNECT 代理，**替 crane 解析域名并强制 AF_INET**，
    crane 只管把 HTTPS_PROXY 指过来。TCP 层转发，TLS 仍由 crane 自己谈。

用法：
    python deploy/push-ipv4.py --username aag111 --token 'dckr_pat_...' \\
        --image suteng-erp --tarball C:/Users/xiao/AppData/Local/Temp/x.tar
"""

from __future__ import annotations

import argparse
import os
import select
import socket
import subprocess
import sys
import threading
import time

REGISTRY = "registry-1.docker.io"
PROXY_ADDR = ("127.0.0.1", 18081)

_crane_path = ""


def log(msg: str) -> None:
    print(f"[push4] {msg}", flush=True)


def _pipe(a: socket.socket, b: socket.socket) -> None:
    try:
        while True:
            r, _, _ = select.select([a, b], [], [], 120)
            if not r:
                break
            for s in r:
                data = s.recv(262144)
                if not data:
                    return
                (b if s is a else a).sendall(data)
    except Exception:
        pass
    finally:
        for s in (a, b):
            try:
                s.close()
            except Exception:
                pass


def _handle(client: socket.socket) -> None:
    try:
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = client.recv(8192)
            if not chunk:
                client.close()
                return
            head += chunk
        first = head.split(b"\r\n", 1)[0].decode("latin-1")
        if not first.upper().startswith("CONNECT"):
            client.sendall(b"HTTP/1.1 405 Method Not Allowed\r\n\r\n")
            client.close()
            return
        hostport = first.split()[1]
        host, _, port_s = hostport.rpartition(":")
        port = int(port_s or 443)

        # 这一步是整个脚本的意义：只取 A 记录，绝不返回 AAAA
        infos = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)
        ip = infos[0][4][0]
        upstream = socket.create_connection((ip, port), timeout=30)
        client.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")

        rest = head.split(b"\r\n\r\n", 1)[1]
        if rest:
            upstream.sendall(rest)
        _pipe(client, upstream)
    except Exception:
        try:
            client.sendall(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
        except Exception:
            pass
        try:
            client.close()
        except Exception:
            pass


def start_proxy() -> threading.Thread:
    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(PROXY_ADDR)
    srv.listen(128)

    def loop() -> None:
        while True:
            try:
                c, _ = srv.accept()
            except OSError:
                return
            threading.Thread(target=_handle, args=(c,), daemon=True).start()

    t = threading.Thread(target=loop, daemon=True)
    t.start()
    return t


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description="强制 IPv4 推 Docker Hub")
    ap.add_argument("--username", required=True)
    ap.add_argument("--token", required=True)
    ap.add_argument("--image", default="suteng-erp")
    ap.add_argument("--tag", default="latest")
    ap.add_argument("--tarball", required=True)
    ap.add_argument("--crane", default=os.path.join(here, "..", ".tools", "crane.exe"))
    ap.add_argument("--no-date-tag", action="store_true")
    args = ap.parse_args()

    tarball = os.path.abspath(args.tarball)
    if not os.path.isfile(tarball):
        raise SystemExit(f"找不到 tar：{tarball}")
    crane = os.path.abspath(args.crane)
    if not os.path.isfile(crane):
        raise SystemExit(f"找不到 crane：{crane}")

    log(f"tar   : {tarball}（{os.path.getsize(tarball) / 1048576:.0f} MB）")
    log(f"crane : {crane}")

    start_proxy()
    time.sleep(0.3)
    log(f"本地强制 IPv4 代理已起：http://{PROXY_ADDR[0]}:{PROXY_ADDR[1]}")

    env = dict(os.environ)
    proxy = f"http://{PROXY_ADDR[0]}:{PROXY_ADDR[1]}"
    env["HTTP_PROXY"] = env["http_proxy"] = proxy
    env["HTTPS_PROXY"] = env["https_proxy"] = proxy
    env["NO_PROXY"] = env["no_proxy"] = "localhost,127.0.0.1,192.168.0.0/16"
    tmp_cfg = os.path.join(os.environ.get("TEMP", "."), "crane-docker-config")
    os.makedirs(tmp_cfg, exist_ok=True)
    env["DOCKER_CONFIG"] = tmp_cfg

    def run(cmd: list[str], timeout: int | None = None) -> int:
        return subprocess.run(cmd, env=env, timeout=timeout).returncode

    ref = f"{REGISTRY}/{args.username}/{args.image}:{args.tag}"
    log(f"crane auth login {REGISTRY} ...")
    if run([crane, "auth", "login", "-u", args.username, "-p", args.token, REGISTRY], 180) != 0:
        raise SystemExit("crane auth login 失败")

    log(f"开始推送 → {ref}")
    log("（layers 分块上传，中断后重跑会复用已推的层）")
    if run([crane, "push", tarball, ref]) != 0:
        raise SystemExit("crane push 失败")

    if not args.no_date_tag:
        extra = "v" + time.strftime("%Y%m%d")
        log(f"补 tag {extra} ...")
        if run([crane, "tag", ref, extra], 300) != 0:
            log("  补 tag 失败（本体已成功）")

    log("回查远端 ...")
    run([crane, "digest", ref], 120)
    run([crane, "ls", f"{args.username}/{args.image}"], 120)

    print("\n" + "=" * 64)
    print(f"  镜像地址：docker.io/{args.username}/{args.image}:{args.tag}")
    print(f"  拉取命令：docker pull {args.username}/{args.image}:{args.tag}")
    print("=" * 64)
    return 0


if __name__ == "__main__":
    sys.exit(main())
