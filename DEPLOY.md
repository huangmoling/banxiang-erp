# 宿藤家居 ERP · Docker 部署教程

从一台空机器到能登录使用。两条路：**拉现成镜像**（有外网，最快）或**从源码构建**（内网 NAS、要改代码时用）。

- 镜像：`aag111/suteng-erp`（标签 `latest` / `vYYYYMMDD`，`linux/amd64`）
- 容器端口：`3000`（宿主端口自定，下文示例用 `3080`）
- 数据目录：容器内 `/app/data`，映射到宿主机 `./data`
- 默认管理员：`admin` / 首次启动时 `.env` 里的 `BOOTSTRAP_ADMIN_PASSWORD`（不填则 `suteng@2026`）

---

## 0. 准备工作

| 项 | 要求 |
|---|---|
| CPU / 架构 | `x86_64`（amd64）。ARM 机器上跑不了现成镜像，需要自己构建 |
| 内存 | 2 GB 起（实测常驻约 150–250 MB） |
| 磁盘 | 10 GB 可用。镜像解压约 860 MB，数据看商品图多少 |
| Docker | Engine 24+ 且带 compose v2，`docker compose version` 能输出版本号 |
| 网络 | **不需要外网、不需要域名、不需要 HTTPS**（一期不做扫码，局域网纯 HTTP） |

检查一下：

```bash
docker --version
docker compose version
uname -m          # 应输出 x86_64
```

建目录：

```bash
sudo mkdir -p /opt/suteng-erp
sudo chown -R "$USER":"$USER" /opt/suteng-erp
cd /opt/suteng-erp
```

---

## 1. 两条路怎么选

| | 路线 A：拉现成镜像 | 路线 B：源码构建 |
|---|---|---|
| 适合 | 机器能访问 Docker Hub | 内网 NAS 出不了外网 / 要改代码 |
| 需要源码 | 不需要，只要一个 yml | 需要 |
| 首次耗时 | 下载约 314 MB | 构建 2–5 分钟（看 CPU） |
| 升级 | `docker compose pull` | 同步源码后 `--build` |

> NAS 常见情况：`registry-1.docker.io` 被 DNS 污染、443 不通，那就只能走路线 B，
> 或者把镜像 `docker save` 成 tar 拷进内网 `docker load`。

---

## 2. 路线 A：拉现成镜像

### 2.1 写 compose 文件

`/opt/suteng-erp/docker-compose.yml`：

```yaml
services:
  erp:
    image: aag111/suteng-erp:latest
    container_name: suteng-erp
    restart: unless-stopped
    ports:
      - "${HOST_PORT:-3000}:3000"
    environment:
      NODE_ENV: production
      TZ: Asia/Shanghai
      DATABASE_URL: "file:/app/data/suteng.db"
      JWT_SECRET: "${JWT_SECRET:?请先在 .env 里设置 JWT_SECRET}"
      ACCESS_TOKEN_TTL: "28800"
      REFRESH_TOKEN_TTL: "6048000"
      UPLOAD_DIR: "/app/data/uploads"
      UPLOAD_MAX_MB: "5"
      APP_NAME: "宿藤家居 ERP"
      BOOTSTRAP_ADMIN_USERNAME: "${BOOTSTRAP_ADMIN_USERNAME:-admin}"
      BOOTSTRAP_ADMIN_PASSWORD: "${BOOTSTRAP_ADMIN_PASSWORD:-suteng@2026}"
      BOOTSTRAP_ADMIN_NAME: "${BOOTSTRAP_ADMIN_NAME:-管理员}"
      LOG_LEVEL: "info"
    volumes:
      - ./data:/app/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
```

### 2.2 写 .env

先生成密钥（**不要手写**）：

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# 机器上没有 node：
openssl rand -base64 48
```

`/opt/suteng-erp/.env`：

```bash
JWT_SECRET=把上面生成的那串粘进来
HOST_PORT=3080
BOOTSTRAP_ADMIN_PASSWORD=你自己的初始密码
```

### 2.3 启动

```bash
docker compose up -d
docker compose ps          # 等 STATUS 出现 (healthy)，约 20–40 秒
```

---

## 3. 路线 B：源码构建

把源码放到 `/opt/suteng-erp`（保留 `Dockerfile`、`docker-compose.yml`、`prisma/`、`src/`），
用仓库里自带的 `docker-compose.yml`（它带 `build: .`）。

```bash
cd /opt/suteng-erp
# .env 与路线 A 完全一样
docker compose up -d --build
```

构建注意（**改 Dockerfile 前必读**，这些坑都踩过）：

1. **构建阶段必须用 `node:22-bookworm` 完整版，不能换 slim**。Prisma 靠 `openssl` 命令探测
   libssl 版本，slim 里没有，会把平台判成 `debian-openssl-1.1.x`，生成的引擎和运行镜像
   （3.0.x）对不上，启动报 `could not locate the Query Engine`。
2. **运行阶段要把 `openssl` 与 `libssl.so.3` / `libcrypto.so.3` 拷进镜像**，否则运行时同样判错。
   Dockerfile 是从 builder 直接拷的，因为内网常解析不了 `deb.debian.org`（apt 装不了）。
3. **`schema.prisma` 里不要写多个 `binaryTargets`**，会触发联网下引擎，内网解析不了
   `binaries.prisma.sh` 直接构建失败。只留 `native`。
4. `next build` 会加载每个路由做静态分析，而 `env.ts` 在模块加载时就校验配置 ——
   Dockerfile 在 builder 阶段注入了**假占位值**，不是真实密钥，别当成配置去改。
5. `COPY --from=builder /app/public ./public` 要求源码里有 `public/` 目录（当前用 `.gitkeep` 占位）。

---

## 4. 环境变量清单

| 变量 | 必填 | 说明 |
|---|---|---|
| `JWT_SECRET` | **是** | ≥32 字符随机串。改了它所有人都要重新登录 |
| `HOST_PORT` | 建议 | 宿主机端口，默认 3000。被占用就换（NAS 上用 3080） |
| `BOOTSTRAP_ADMIN_PASSWORD` | 建议 | 首次启动建管理员用。**已有用户后不生效**，不会覆盖改过的密码 |
| `BOOTSTRAP_ADMIN_USERNAME` / `_NAME` | 否 | 默认 `admin` / `管理员` |
| `DATABASE_URL` | 否 | 已由 compose 固定成 `file:/app/data/suteng.db`，一般不用动 |
| `UPLOAD_DIR` / `UPLOAD_MAX_MB` | 否 | 图片目录与单图上限（默认 5 MB） |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` | 否 | 秒。默认 8 小时 / 70 天 |
| `TZ` | **是** | 必须 `Asia/Shanghai`。容器默认 UTC 会让「本月」统计在月初月末差 8 小时 |
| `LOG_LEVEL` | 否 | `trace/debug/info/warn/error/fatal`，默认 `info` |

`JWT_SECRET` 没设时 compose 会直接拒绝启动并打印提示 —— 这是故意的，宁可起不来也不带空密钥跑。

---

## 5. 启动验收（6 步，逐条走）

```bash
# 1. 容器状态，应看到 (healthy)
docker compose ps

# 2. 启动日志，应看到 seed 建管理员 + 服务就绪
docker compose logs --tail=40
```

日志里应该有：

```
[seed] 已创建管理员账号：admin
[seed] 仓位已就绪：主仓 / 次品区 / 报废区
```

```bash
# 3. 就绪探针（会真查一次数据库）
curl -s http://127.0.0.1:3080/api/health?ready=1
# 期望：{"status":"ready","db":"ok","time":"..."}
```

4. 浏览器打开 `http://<机器局域网IP>:3080`，应看到登录页。
5. 用 `admin` + 你设的初始密码登录。
6. 首页「库存仪表台」四个数字都是 0、左侧菜单齐全 —— 说明库表已建好。

> 验收用 `IP:端口`，不要用 `127.0.0.1` 从别的电脑试；也不要用 `localhost`。

---

## 6. 首次登录后马上做三件事

1. **改密码**：右上角账号 → 改密码。旧密码是 `BOOTSTRAP_ADMIN_PASSWORD`（没设就是 `suteng@2026`）。
   改完旧令牌立刻失效，需要用新密码重新登录一次。
2. **建产品**：商品页建第一个产品（名称 / 颜色 / 规格 / 单位 / 安全库存）。
   也可以等入库时在入库页直接建，两条路径产出一致。
3. **配备份**：进「备份」页（仅管理员可见）
   - 定时备份 cron 填 `0 3 * * *`（每天 3 点），保留 5 份
   - 要云端再存一份就填 OpenList 地址/目录/账号密码，先点「测试连接」再保存

---

## 7. 数据、备份与迁移

### 7.1 data 目录里是什么

```
./data/
├── suteng.db        ← 全部业务数据（SQLite，WAL 模式）
├── suteng.db-wal    ← 运行时存在，别手动删
├── suteng.db-shm
├── uploads/         ← 商品图片
└── backups/         ← 应用生成的快照（suteng-auto-*.db 等）
```

**目录不要放在 SMB / NFS 共享盘上。** SQLite 的锁在网络盘上不可靠，会偶发写坏。

### 7.2 备份怎么做

优先用系统里的「备份」页：

- **立即备份**：随时点，生成 `suteng-manual-*.db`，**永不参与轮转**
- **定时备份**：按 cron 跑，超出保留份数只轮转 `auto`，手动备份不动
- **恢复**：上传 `.db` 覆盖整库；覆盖前系统会自动拍一张 `pre-restore` 保命照，拍不出来就拒绝恢复

### 7.3 别直接 cp 数据库文件

容器在跑的时候 SQLite 处于 WAL 模式，最近的事务可能还在 `-wal` 里没落盘。
**直接 `cp suteng.db` 可能拷到一个「少了最近几笔」的库**，而且拷出来不报错，很难发现。

要么走 UI 的「立即备份」（内部用 `VACUUM INTO`，拿到是一致性快照），要么先停容器：

```bash
docker compose stop
cp data/suteng.db /somewhere/suteng-$(date +%Y%m%d).db
docker compose start
```

### 7.4 整机迁移到另一台机器

```bash
# 旧机
docker compose stop
tar czf suteng-data-$(date +%Y%m%d).tar.gz data

# 新机（同样的目录结构与 .env，JWT_SECRET 换成新的也行，大家重登一次）
tar xzf suteng-data-*.tar.gz
docker compose up -d
```

---

## 8. 日常运维

| 要做的事 | 命令 |
|---|---|
| 看日志 | `docker compose logs -f --tail=100` |
| 重启 | `docker compose restart` |
| 停止（数据保留） | `docker compose down` |
| 升级到最新镜像 | `docker compose pull && docker compose up -d` |
| 升级（源码） | 同步源码后 `docker compose up -d --build` |
| 回滚到某天版本 | 把 image 改成 `aag111/suteng-erp:v20261021` 再 `up -d` |
| 进容器看文件 | `docker compose exec erp ls -la /app/data` |

- 容器带 `restart: unless-stopped`，宿主机重启会自动拉起；**前提是 Docker 服务本身开机自启**：
  `sudo systemctl enable docker`
- **升级前先点一次「立即备份」**。降级时数据库里可能有新版本才有的字段，回滚镜像前先确认。
- 查看可用历史版本：`docker image ls aag111/suteng-erp`

---

## 9. 故障排查

| 症状 | 原因与处理 |
|---|---|
| `请先设置 JWT_SECRET` / compose 拒绝启动 | `.env` 里没填，或填成 `JWT_SECRET=` 空值，或含空格。重新生成粘进去 |
| compose 通过，但容器起来就退出，日志 `JWT_SECRET 至少需要 32 位字符` | compose 只查「有没有值」，长度由应用校验。用生成命令产出 48 字节，别手写短口令 |
| `Bind for 0.0.0.0:3080 failed: port is already allocated` | 端口占用。改 `.env` 的 `HOST_PORT`，再 `docker compose up -d` |
| 容器反复重启，日志 `could not locate the Query Engine` | 镜像构建时 openssl 没带进去。用官方镜像，或按第 3 节第 1–2 条改 Dockerfile |
| `unable to open database file` | `./data` 权限不对或不存在。`mkdir -p data && chmod 777 data` 先救急 |
| 月初/月末统计差 8 小时 | `TZ` 没设成 `Asia/Shanghai`，改完 `docker compose up -d` 重建 |
| 局域网其它电脑打不开 | 用了 `127.0.0.1`。换成机器局域网 IP；再不行查防火墙是否放行该端口 |
| 备份页显示路径 `/app/data/backups` | 正常，那是容器内路径，对应宿主机 `./data/backups` |
| 恢复后提示「来自旧版本，需重启」 | `docker compose restart` 让进程重新加载库文件 |
| 商品图上传后不显示 | `./data/uploads` 不可写，或反代没放行请求体大小 |
| 忘记管理员密码 | 进容器用接口改不了就没密码了：`docker compose exec erp node -e "..."` 重置，或从备份恢复 |

---

## 10. 上线前的安全清单

- [ ] `JWT_SECRET` 是随机生成的 48 字节，不是示例值，也没在别处复用
- [ ] 初始密码已改，不再是 `suteng@2026`
- [ ] 只在局域网暴露。要公网访问就套反向代理 + HTTPS，或用 Tailscale 组网
- [ ] `data/` 目录权限收紧到只有运维账号可读
- [ ] 备份已开启，并且**异地留了一份**（本地磁盘 + 另一台机器 / 网盘）
- [ ] 记下当前镜像版本号，出事能回滚

---

## 附录：完整文件

`docker-compose.yml`（源码构建用，仓库自带）

```yaml
services:
  erp:
    build: .
    image: aag111/suteng-erp:latest
    container_name: suteng-erp
    restart: unless-stopped
    ports:
      - "${HOST_PORT:-3000}:3000"
    environment:
      NODE_ENV: production
      TZ: Asia/Shanghai
      DATABASE_URL: "file:/app/data/suteng.db"
      JWT_SECRET: "${JWT_SECRET:?请先在 .env 里设置 JWT_SECRET}"
      ACCESS_TOKEN_TTL: "28800"
      REFRESH_TOKEN_TTL: "6048000"
      UPLOAD_DIR: "/app/data/uploads"
      UPLOAD_MAX_MB: "5"
      APP_NAME: "宿藤家居 ERP"
      BOOTSTRAP_ADMIN_USERNAME: "${BOOTSTRAP_ADMIN_USERNAME:-admin}"
      BOOTSTRAP_ADMIN_PASSWORD: "${BOOTSTRAP_ADMIN_PASSWORD:-suteng@2026}"
      BOOTSTRAP_ADMIN_NAME: "${BOOTSTRAP_ADMIN_NAME:-管理员}"
      LOG_LEVEL: "info"
    volumes:
      - ./data:/app/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
```

`.env`

```bash
JWT_SECRET=用 node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))" 生成
HOST_PORT=3080
BOOTSTRAP_ADMIN_PASSWORD=你的初始密码
```
