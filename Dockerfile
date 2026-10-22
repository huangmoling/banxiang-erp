# 不写 `# syntax=docker/dockerfile:1`：本文件只用标准指令，
# 去掉可避免构建时额外拉取 frontend 镜像（部分 NAS 上的 Docker 镜像加速器会对它返回 401）。

# ---------- 构建阶段 ----------
# 构建阶段用完整版 node:22-bookworm（不是 slim）：
# 它自带 openssl CLI，prisma generate 才能把 native 识别成 debian-openssl-3.0.x，
# 与运行镜像一致；slim 里探测不到 libssl，会按 1.1.x 生成，运行时报找不到 Query Engine。
# 也不能两条退路一起用：这里没网络的 NAS 解析不了 deb.debian.org（apt 装不了 openssl），
# 也解析不了 binaries.prisma.sh（下不了跨平台引擎），所以必须在构建镜像里一步到位。

FROM node:22-bookworm AS builder
WORKDIR /app

# 先只拷贝清单，命中缓存后依赖不会因为改代码重装
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund


# 构建期占位变量（不是密钥，也不会进入运行环境）：
# next build 会加载每个 route 模块做静态分析，而 env.ts 在模块加载时就要校验配置，
# 构建容器里没有运行期变量，不占位会直接报「DATABASE_URL 未配置」而构建失败。
# 运行期的真实值由 docker compose 注入，这里是构建期的假值。
ENV DATABASE_URL="file:/tmp/build-placeholder.db" \
    JWT_SECRET="build-time-placeholder-only-not-a-real-secret-000000" \
    NEXT_TELEMETRY_DISABLED=1

COPY . .
RUN npx prisma generate && npx next build

# ---------- 运行阶段 ----------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# standalone 产物 + 静态资源
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Prisma 客户端运行时需要引擎与生成的客户端
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# 迁移用的 Prisma CLI 单独全局安装。
# 不复制构建阶段的 node_modules/prisma —— 它有 effect / empathic 等传递依赖，
# 只拷目录会在运行时抛 MODULE_NOT_FOUND；全局安装能保证依赖闭包完整。
RUN npm i -g prisma@6.16.2 --no-audit --no-fund

# slim 运行镜像里没有 openssl，Prisma 会据此把部署平台判定成 debian-openssl-1.1.x，
# 与构建时生成（3.0.x）不一致，启动即报找不到 Query Engine。
# 这台 NAS 的构建网络解析不了 deb.debian.org（apt 装不了），所以直接从构建镜像拷贝
# 二进制与两个同版本共享库（同一 Debian 版本，ABI 一致），比换整镜像省 400MB+。
COPY --from=builder /usr/bin/openssl /usr/local/bin/openssl
COPY --from=builder /usr/lib/x86_64-linux-gnu/libssl.so.3 \
                    /usr/lib/x86_64-linux-gnu/libcrypto.so.3 \
                    /usr/lib/x86_64-linux-gnu/

# 数据目录（SQLite 与上传图片），由 volume 挂载覆盖
RUN mkdir -p /app/data/uploads

EXPOSE 3000

# 启动前先跑迁移，再做幂等初始化（建管理员与默认仓位），最后起服务
CMD ["sh", "-c", "prisma migrate deploy --schema=/app/prisma/schema.prisma && node /app/prisma/seed.mjs && node server.js"]
