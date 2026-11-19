#!/usr/bin/env bash
# ============================================================================
#  半巷设计 ERP · 部署自检
#
#  回答一个具体问题：数据（SQLite 与商品图片）到底落在哪一层？
#  容器可写层里的东西，`docker compose pull && up -d` 重建容器时会一起消失，
#  而数据库若同时挂在卷上，就会出现「业务数据都在、只有图片没了」这种怪现象。
#
#  图片目录支持自定义（compose 里的 UPLOAD_DIR），本脚本从容器里现读这个值，
#  再判断它被哪条挂载覆盖，所以改了路径同样适用。
#
#  用法（在服务器上、compose 文件所在目录执行）：
#      bash doctor.sh
#      CONTAINER=别的容器名 bash doctor.sh
#
#  只读脚本：不删除、不写入、不重启任何东西。
# ============================================================================
set -u

CONTAINER="${CONTAINER:-suteng-erp}"
PASS=0; WARN=0; FAIL=0

c_ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
c_warn() { printf '  \033[33m!\033[0m %s\n' "$1"; WARN=$((WARN+1)); }
c_bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
h1()     { printf '\n\033[1m%s\033[0m\n' "$1"; }

h1 "1. 容器状态"
if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  c_bad "找不到容器 $CONTAINER —— 用 CONTAINER=名字 指定，或 docker ps -a 看一下"
  echo; echo "自检中断。"; exit 1
fi
STATE=$(docker inspect -f '{{.State.Status}}' "$CONTAINER")
IMG=$(docker inspect -f '{{.Config.Image}}' "$CONTAINER")
CREATED=$(docker inspect -f '{{.Created}}' "$CONTAINER")
IMAGE_ID=$(docker inspect -f '{{.Image}}' "$CONTAINER")
printf '  容器 %s：%s\n' "$CONTAINER" "$STATE"
printf '  镜像 %s\n' "$IMG"
printf '  创建 %s\n' "$CREATED"
printf '  镜像层 %s\n' "$IMAGE_ID"
[ "$STATE" = "running" ] && c_ok "运行中" || c_bad "当前不是 running（$STATE）"

h1 "2. 挂载清单"
MOUNTS=$(docker inspect -f '{{range .Mounts}}{{.Type}}|{{.Source}}|{{.Destination}}|{{.RW}}{{"\n"}}{{end}}' "$CONTAINER")
if [ -z "$MOUNTS" ]; then
  c_bad "这个容器没有任何挂载 —— 数据库和图片全都写在容器可写层，重建容器必丢"
else
  printf '%s' "$MOUNTS" | while IFS='|' read -r T S D R; do
    [ -z "${D:-}" ] && continue
    printf '  %-6s %s\n         -> %s (rw=%s)\n' "$T" "$S" "$D" "$R"
  done
fi

# 找出覆盖某个容器内路径的挂载点：取最长前缀匹配；根挂载 / 视为兜底（即未持久化）
covered_by() {
  printf '%s' "$MOUNTS" | awk -F'|' -v p="$1" '
    $3 != "" && ($3 == "/" || p == $3 || index(p, $3 "/") == 1) { print length($3) "\t" $3 }
  ' | sort -rn | head -1 | cut -f2
}
source_of() {
  printf '%s' "$MOUNTS" | awk -F'|' -v d="$1" '$3 == d { print $2; exit }'
}

h1 "3. 图片目录（UPLOAD_DIR）"
UP=$(docker exec "$CONTAINER" sh -c 'printf "%s" "${UPLOAD_DIR:-/app/data/uploads}"' 2>/dev/null)
[ -z "$UP" ] && UP="/app/data/uploads"
printf '  容器内路径 = %s\n' "$UP"

UP_MOUNT=$(covered_by "$UP")
if [ -z "$UP_MOUNT" ] || [ "$UP_MOUNT" = "/" ]; then
  c_bad "这个目录没有被任何挂载覆盖 —— 图片写在容器可写层，重建容器即全丢"
  c_warn "在 compose 里加一条：- /你的宿主机目录:${UP}"
else
  c_ok "已被挂载覆盖：宿主机 $(source_of "$UP_MOUNT") -> ${UP_MOUNT}"
  printf '%s' "$MOUNTS" | grep -q "|${UP}|" || c_warn "注意：挂的是上一级目录 ${UP_MOUNT}，${UP} 是该目录下的子目录，同样会持久化"
fi

UC=$(docker exec "$CONTAINER" sh -c "ls -1 '$UP' 2>/dev/null | wc -l" 2>/dev/null | tr -d ' ')
USZ=$(docker exec "$CONTAINER" sh -c "du -sh '$UP' 2>/dev/null | cut -f1" 2>/dev/null)
printf '  文件数 = %s（占用 %s）\n' "${UC:-?}" "${USZ:-?}"
docker exec "$CONTAINER" sh -c "ls -ld '$UP'" 2>/dev/null | sed 's/^/  /'
[ "${UC:-0}" -gt 0 ] && c_ok "容器内能看到 ${UC} 个图片文件" || c_warn "容器内图片目录是空的"

h1 "4. 数据库"
DB=$(docker exec "$CONTAINER" sh -c 'printf "%s" "${DATABASE_URL:-}"' 2>/dev/null)
DBPATH=$(printf '%s' "$DB" | sed 's/^file://')
printf '  DATABASE_URL = %s\n' "${DB:-(取不到)}"
if [ -n "$DBPATH" ]; then
  DB_MOUNT=$(covered_by "$DBPATH")
  if [ -z "$DB_MOUNT" ] || [ "$DB_MOUNT" = "/" ]; then
    c_bad "数据库文件没有被挂载覆盖 —— 重建容器会丢全部业务数据"
  else
    c_ok "数据库落在宿主机：$(source_of "$DB_MOUNT")"
  fi
  DBSZ=$(docker exec "$CONTAINER" sh -c "ls -lh '$DBPATH' 2>/dev/null | awk '{print \$5}'" 2>/dev/null | tr -d ' ')
  printf '  文件大小 = %s\n' "${DBSZ:-(读不到)}"
fi

h1 "5. 宿主机侧核对"
if [ -n "$UP_MOUNT" ] && [ "$UP_MOUNT" != "/" ]; then
  HOSTSRC=$(source_of "$UP_MOUNT")
  # 容器内子路径（当挂的是上一级时）换算到宿主机
  SUB=${UP#$UP_MOUNT}
  HOSTUP="${HOSTSRC}${SUB}"
  printf '  宿主机图片目录 = %s\n' "$HOSTUP"
  if [ -d "$HOSTUP" ]; then
    HC=$(ls -1 "$HOSTUP" 2>/dev/null | wc -l | tr -d ' ')
    printf '  宿主机文件数 = %s\n' "$HC"
    if [ "${UC:-0}" = "${HC:-x}" ]; then
      c_ok "两边数量一致，持久化正常"
    else
      c_warn "两边数量不一致（容器 ${UC:-?} / 宿主 ${HC:-?}）"
    fi
  else
    c_warn "宿主机上还没有这个目录"
  fi
else
  c_warn "没有宿主机目录可对照（图片目录未持久化）"
fi

h1 "结论"
if [ "$FAIL" -eq 0 ]; then
  printf '  \033[32m部署方式正常\033[0m：图片与数据库都落在宿主机磁盘上，重建容器不会丢。\n'
else
  printf '  \033[31m发现 %d 处问题\033[0m，逐条看上面的 ✗。\n' "$FAIL"
  printf '  典型症状：更新镜像后业务数据还在、商品图片全变破图 ——\n'
  printf '  因为 db 单独挂了文件会留存，而图片写在容器层，随旧容器一起销毁。\n\n'
  printf '  修法（volumes 整目录挂，不要只挂单个 db 文件）：\n'
  printf '      volumes:\n'
  printf '        - ./data:/app/data\n'
  printf '  自定义图片位置则加一条，并让 UPLOAD_DIR 指向同一容器内路径：\n'
  printf '      environment:\n'
  printf '        UPLOAD_DIR: "/app/uploads"\n'
  printf '      volumes:\n'
  printf '        - /你的宿主机目录:/app/uploads\n'
fi
printf '\n  ✓ %d 项正常   ! %d 项提醒   ✗ %d 项异常\n\n' "$PASS" "$WARN" "$FAIL"
