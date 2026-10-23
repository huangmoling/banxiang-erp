#!/usr/bin/env python3
"""把本机源码同步到 NAS 并重建容器（一条命令完成发布）。

用法：
    set NAS_SSH_PASSWORD=你的密码
    python deploy/update-nas.py

可用环境变量（都有默认值）：
    NAS_SSH_HOST     默认 192.168.1.110
    NAS_SSH_PORT     默认 22033
    NAS_SSH_USER     默认 admin
    NAS_SSH_PASSWORD 必填（不写会提示输入）
    NAS_REMOTE_DIR   默认 /opt/suteng-erp
    NAS_HOST_PORT    默认 3080（仅用于发布后的健康检查）

做了什么：打包源码（不含 node_modules / .next / data / .env）→ SFTP 上传 →
远端解包（保留 data 与 .env）→ docker compose build → up -d → 健康检查。
"""
from __future__ import annotations

import getpass
import io
import os
import shlex
import sys
import tarfile
from pathlib import Path

import paramiko

HOST = os.environ.get("NAS_SSH_HOST", "192.168.1.110")
PORT = int(os.environ.get("NAS_SSH_PORT", "22033"))
USER = os.environ.get("NAS_SSH_USER", "admin")
PASSWORD = os.environ.get("NAS_SSH_PASSWORD") or getpass.getpass(f"{USER}@{HOST} 密码: ")
REMOTE_DIR = os.environ.get("NAS_REMOTE_DIR", "/opt/suteng-erp")
HOST_PORT = os.environ.get("NAS_HOST_PORT", "3080")

ROOT = Path(__file__).resolve().parent.parent
INCLUDE = [
    "Dockerfile",
    "docker-compose.yml",
    ".dockerignore",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "next.config.ts",
    "postcss.config.mjs",
    "tailwind.config.ts",
    ".env.example",
    "README.md",
    "prisma",
    "scripts",
    "src",
    "public",
]
SKIP_DIRS = {"node_modules", ".next", ".next-build", ".next-dev-cache", "data", ".git"}


def build_tar() -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for item in INCLUDE:
            p = ROOT / item
            if not p.exists():
                continue
            if p.is_dir():
                for f in p.rglob("*"):
                    if f.is_dir() or any(part in SKIP_DIRS for part in f.parts):
                        continue
                    tar.add(f, arcname=str(f.relative_to(ROOT)))
            else:
                tar.add(p, arcname=item)
    return buf.getvalue()


class Remote:
    def __init__(self) -> None:
        self.cli = paramiko.SSHClient()
        self.cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self.cli.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=20)
        self.sftp = paramiko.SFTPClient.from_transport(self.cli.get_transport())

    def sudo(self, cmd: str, timeout: int = 1800) -> int:
        wrapped = "sudo -S -p '' sh -c %s" % shlex.quote(cmd)
        stdin, stdout, stderr = self.cli.exec_command(wrapped, timeout=timeout)
        stdin.write(PASSWORD + "\n")
        stdin.flush()
        for line in stdout:
            print("   ", line.rstrip())
        err = stderr.read().decode("utf-8", "replace").strip()
        if err:
            print("[stderr]", err, file=sys.stderr)
        return stdout.channel.recv_exit_status()


def main() -> int:
    print(f"[1/4] 打包源码 -> {ROOT}")
    blob = build_tar()
    print(f"      {len(blob) / 1024:.0f} KB")

    print(f"[2/4] 上传到 {HOST}")
    r = Remote()
    remote_tar = "/home/%s/suteng-erp.tar.gz" % USER
    with r.sftp.file(remote_tar, "wb") as fh:
        fh.write(blob)

    print("[3/4] 解包并重建镜像（首次或改依赖时会慢，改了代码通常 1~3 分钟）")
    code = r.sudo(
        "mkdir -p %s/data/uploads && tar -xzf %s -C %s && cd %s && "
        "DOCKER_BUILDKIT=1 COMPOSE_PROGRESS=plain docker compose build"
        % (REMOTE_DIR, remote_tar, REMOTE_DIR, REMOTE_DIR)
    )
    if code != 0:
        print("构建失败，先看上面的报错。容器仍在跑旧版本。", file=sys.stderr)
        return code

    print("[4/4] 重建容器并做健康检查")
    code = r.sudo(
        "cd %s && docker compose up -d --force-recreate && sleep 8 && "
        "curl -s -m 8 http://127.0.0.1:%s/api/health?ready=1" % (REMOTE_DIR, HOST_PORT)
    )
    print(f"\n访问地址：http://{HOST}:{HOST_PORT}")
    return code


if __name__ == "__main__":
    sys.exit(main())
