#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 NAS 上已构建好的 suteng-erp 镜像推送到 Docker Hub。

用法（本机没有 Docker，靠 NAS 来 tag/push）：

    MSYS_NO_PATHCONV=1 python deploy/push.py \
        --username aag111 --token 'dckr_pat_...'

可选：
    --image suteng-erp           Docker Hub 仓库名（默认 suteng-erp）
    --tag latest                 主 tag（默认 latest，另自动补一个 vYYYYMMDD）
    --source-image suteng-erp-erp:latest   NAS 上的源镜像
    --keep-login                 推完不清 NAS 上的 docker 登录态

流程：
    1) 用 用户名+PAT 调 Docker Hub 登录接口换 JWT，先确认凭据有效
    2) 检查 <用户名>/<image> 是否已存在（存在就复用，推新 tag 覆盖）
    3) SSH 到 NAS：docker login registry-1.docker.io → tag → push
    4) 回查 Hub，确认 tag 已上线

注意：必须用带 paramiko 的解释器跑（系统 python 没装）：
    C:/Users/xiao/.workbuddy/binaries/python/envs/default/Scripts/python.exe
"""

from __future__ import annotations

import argparse
import json
import shlex
import sys
import time
import urllib.error
import urllib.request

try:
    import paramiko
except ImportError:  # pragma: no cover
    print("缺少 paramiko，请用带 paramiko 的 venv 解释器跑本脚本。", file=sys.stderr)
    raise SystemExit(2)

HUB_LOGIN = "https://hub.docker.com/v2/users/login/"
HUB_REPO = "https://hub.docker.com/v2/repositories/{ns}/{repo}/"
HUB_TAGS = "https://hub.docker.com/v2/repositories/{ns}/{repo}/tags/{tag}/"
DOCKER_REGISTRY = "registry-1.docker.io"


# --------------------------------------------------------------------------- #
# Docker Hub API
# --------------------------------------------------------------------------- #
def hub_login(username: str, token: str) -> str:
    body = json.dumps({"username": username, "password": token}).encode()
    req = urllib.request.Request(
        HUB_LOGIN,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "suteng-erp-push/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        raise SystemExit(
            f"Docker Hub 登录失败（HTTP {exc.code}）：{detail}\n"
            f"请确认用户名 `{username}` 与 token 是否匹配、是否具备 Read & Write 权限。"
        )
    jwt = data.get("token")
    if not jwt:
        raise SystemExit(f"Docker Hub 未返回 token：{data}")
    return jwt


def hub_repo_exists(jwt: str, ns: str, repo: str) -> bool:
    req = urllib.request.Request(
        HUB_REPO.format(ns=ns, repo=repo), headers={"Authorization": f"JWT {jwt}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            return resp.status == 200
    except urllib.error.HTTPError as exc:
        return exc.code != 404


def hub_tag_exists(jwt: str, ns: str, repo: str, tag: str) -> bool:
    req = urllib.request.Request(
        HUB_TAGS.format(ns=ns, repo=repo, tag=tag), headers={"Authorization": f"JWT {jwt}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            return resp.status == 200
    except urllib.error.HTTPError:
        return False


# --------------------------------------------------------------------------- #
# SSH
# --------------------------------------------------------------------------- #
class Remote:
    def __init__(self, host, port, user, password, use_sudo, sudo_password):
        self.cli = paramiko.SSHClient()
        self.cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self.cli.connect(
            host, port=port, username=user, password=password,
            timeout=20, allow_agent=False, look_for_keys=False,
        )
        self.use_sudo = use_sudo
        self.sudo_password = sudo_password or password

    def run(self, cmd: str, timeout: int = 900, echo: bool = True) -> tuple[int, str]:
        """边读边打印，避免长任务把通道缓冲区灌满后卡死。"""
        if self.use_sudo:
            wrapped = "sudo -S -p '' sh -c %s" % shlex.quote(cmd)
        else:
            wrapped = cmd
        stdin, stdout, stderr = self.cli.exec_command(wrapped, timeout=timeout)
        if self.use_sudo:
            stdin.write(self.sudo_password + "\n")
            stdin.flush()

        buf: list[str] = []
        for line in iter(stdout.readline, ""):
            buf.append(line)
            if echo and line.strip():
                print("   ", line.rstrip())
        err = stderr.read().decode("utf-8", "replace").strip()
        err = "\n".join(l for l in err.splitlines() if not l.startswith("[sudo]")).strip()
        if err:
            buf.append(err)
            if echo:
                print("[stderr]", err, file=sys.stderr)
        return stdout.channel.recv_exit_status(), "".join(buf)

    def close(self):
        self.cli.close()


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser(description="推送 suteng-erp 镜像到 Docker Hub")
    ap.add_argument("--username", required=True)
    ap.add_argument("--token", required=True)
    ap.add_argument("--image", default="suteng-erp", help="Docker Hub 仓库名")
    ap.add_argument("--tag", default="latest")
    ap.add_argument("--source-image", default="suteng-erp-erp:latest", help="NAS 上的源镜像")
    ap.add_argument("--host", default="192.168.1.110")
    ap.add_argument("--ssh-port", type=int, default=22033)
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="REDACTED__")
    ap.add_argument("--no-sudo", action="store_true")
    ap.add_argument("--keep-login", action="store_true")
    args = ap.parse_args()

    def log(msg: str) -> None:
        print(f"[push] {msg}", flush=True)

    # 1) 凭据
    log(f"校验 Docker Hub 凭据（用户 {args.username}）...")
    jwt = hub_login(args.username, args.token)
    log("凭据有效，已换取 JWT")

    repo = args.image
    if hub_repo_exists(jwt, args.username, repo):
        log(f"`{args.username}/{repo}` 已存在（你自己的仓库），直接推新 tag 覆盖")
    else:
        log(f"`{args.username}/{repo}` 尚未创建，推送时会自动建")
    full_name = f"{args.username}/{repo}"
    push_name = f"{DOCKER_REGISTRY}/{args.username}/{repo}"
    extra_tag = "v" + time.strftime("%Y%m%d")

    # 2) NAS 上打标签并推
    r = Remote(args.host, args.ssh_port, args.user, args.password,
               use_sudo=not args.no_sudo, sudo_password=args.password)
    try:
        log("检查源镜像...")
        _, out = r.run(
            "docker images --format '{{.Repository}}:{{.Tag}}' | grep -x %s || true"
            % shlex.quote(args.source_image),
            echo=False,
        )
        if args.source_image not in out:
            raise SystemExit(f"NAS 上不存在源镜像 {args.source_image}，请先跑 deploy/update-nas.py。")
        log(f"源镜像存在：{args.source_image}")

        log(f"登录 {DOCKER_REGISTRY} ...")
        # 必须登录到显式主机名：只写 docker.io 会被 /etc/docker/daemon.json 的
        # registry-mirrors（只读加速器）拦住，push 报 requested access denied。
        login_cmd = (
            "printf '%%s' %s | docker login -u %s --password-stdin %s 2>&1"
            % (shlex.quote(args.token), shlex.quote(args.username), DOCKER_REGISTRY)
        )
        code, out = r.run(login_cmd, echo=False)
        print("   ", out.replace(args.token, "***").strip())
        if code != 0:
            raise SystemExit(f"NAS 上 docker login 失败（exit {code}）")

        log(f"打标签 → {push_name}:{args.tag} 与 :{extra_tag}")
        r.run(f"docker tag {shlex.quote(args.source_image)} "
              f"{shlex.quote(push_name)}:{shlex.quote(args.tag)}", echo=False)
        r.run(f"docker tag {shlex.quote(args.source_image)} "
              f"{shlex.quote(push_name)}:{shlex.quote(extra_tag)}", echo=False)

        log("开始推送（858MB 镜像，首次上传视 NAS 上行带宽，可能要几分钟）...")
        code, _ = r.run(
            f"docker push {shlex.quote(push_name)}:{shlex.quote(args.tag)} && "
            f"docker push {shlex.quote(push_name)}:{shlex.quote(extra_tag)} 2>&1",
            timeout=3600,
        )
        if code != 0:
            raise SystemExit(f"docker push 失败（exit {code}），见上面的输出")

        log("NAS 上的相关镜像：")
        r.run("docker images --format '{{.Repository}}:{{.Tag}}  {{.Size}}' "
              "| grep -i suteng", echo=True)

        if not args.keep_login:
            r.run(f"docker logout {DOCKER_REGISTRY} >/dev/null 2>&1 || true", echo=False)
            log("已清理 NAS 上的 docker 登录态")
    finally:
        r.close()

    # 3) 回查
    log("回查 Hub ...")
    for t in (args.tag, extra_tag):
        ok = hub_tag_exists(jwt, args.username, repo, t)
        log(f"  tag {t}: {'已上线' if ok else '未查到（Hub 索引可能有延迟，稍等再看）'}")

    print("\n" + "=" * 64)
    print(f"  镜像地址：docker.io/{full_name}:{args.tag}")
    print(f"           docker.io/{full_name}:{extra_tag}")
    print(f"  拉取命令：docker pull {full_name}:{args.tag}")
    print(f"  页面地址：https://hub.docker.com/r/{full_name}")
    print("=" * 64)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
