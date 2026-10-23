#!/usr/bin/env node
/**
 * 把 prisma CLI 连同它的依赖闭包，从构建阶段的 node_modules 里拷成一个自包含目录。
 *
 * 为什么需要这一步：
 *   运行镜像（slim）里要在启动时跑 `prisma migrate deploy`，原来靠
 *   `RUN npm i -g prisma@6.16.2` 现装。但这台 NAS 的构建容器**完全没有外网**
 *   （registry.npmjs.org 连 DNS 都解析不了），那一行能过纯粹是吃了 Docker 层缓存；
 *   只要 `prisma/` 目录变了（加迁移就会变），缓存作废，构建立刻失败。
 *
 *   只拷 node_modules/prisma 一个目录也不行——它运行时还要 effect / empathic /
 *   @prisma/engines 等传递依赖，缺一个就 MODULE_NOT_FOUND。
 *
 * 所以这里按 Node 的解析规则把整棵依赖树走一遍，逐个目录拷出来。
 * 全程只读本地文件，不需要网络；拷出来的东西和 `npm i -g` 的效果等价。
 *
 * 用法： node scripts/bundle-prisma-cli.mjs <源node_modules> <输出目录>
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const SRC = path.resolve(process.argv[2] || "/app/node_modules");
const OUT = path.resolve(process.argv[3] || "/prisma-cli");
const ROOTS = ["prisma"];

if (!fs.existsSync(SRC)) {
  console.error(`[bundle-prisma-cli] 源目录不存在：${SRC}`);
  process.exit(1);
}

/** 从「解析到的入口文件」反推包根目录：取最后一个 node_modules/ 之后的一到两段 */
function packageRootOf(resolved) {
  const parts = resolved.split(/[\\/]/);
  const idx = parts.lastIndexOf("node_modules");
  if (idx === -1) return null;
  const name = parts[idx + 1].startsWith("@")
    ? `${parts[idx + 1]}/${parts[idx + 2]}`
    : parts[idx + 1];
  return path.join(parts.slice(0, idx + 2 + (parts[idx + 1].startsWith("@") ? 1 : 0)).join(path.sep));
}

const copied = new Map(); // 包名 -> 源目录
const queue = [...ROOTS];
const missing = [];

while (queue.length > 0) {
  const name = queue.shift();
  if (copied.has(name)) continue;

  // 用「以谁为基准」的方式解析，才能正确落到嵌套的 node_modules 里
  let pkgJsonPath;
  try {
    const req = createRequire(path.join(SRC, "noop.js"));
    pkgJsonPath = req.resolve(`${name}/package.json`);
  } catch {
    try {
      const req = createRequire(path.join(SRC, "noop.js"));
      const entry = req.resolve(name);
      const root = packageRootOf(entry);
      pkgJsonPath = root ? path.join(root, "package.json") : null;
    } catch {
      missing.push(name);
      continue;
    }
  }

  if (!pkgJsonPath || !fs.existsSync(pkgJsonPath)) {
    missing.push(name);
    continue;
  }

  const pkgDir = path.dirname(pkgJsonPath);
  copied.set(name, pkgDir);

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  } catch {
    continue;
  }

  // 运行时真正需要的三类：dependencies / optionalDependencies / 已安装的 peerDependencies
  const next = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ];
  for (const dep of next) {
    if (!copied.has(dep) && !queue.includes(dep)) queue.push(dep);
  }
}

// ---- 落盘 ----
// 不用 fs.cpSync：在 Windows 上拷 node_modules/prisma 这棵树时，
// 它会直接把 node 进程打死（无报错、退出码 127），换成手写递归就正常。
const outModules = path.join(OUT, "node_modules");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(outModules, { recursive: true });

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isSymbolicLink()) {
      try {
        fs.copyFileSync(fs.realpathSync(s), d);
      } catch {
        /* 断链的可选文件跳过即可 */
      }
    } else fs.copyFileSync(s, d);
  }
}

let bytes = 0;
for (const [name, dir] of copied) {
  copyDir(dir, path.join(outModules, name));
}

// 入口脚本：不依赖 npm 生成的 .bin 软链，直接写一个 shim。
// 路径必须按「shim 自己在哪」算，不能写死 OUT 的绝对路径——
// 这个目录在构建阶段是 /prisma-cli，拷进运行镜像后是 /opt/prisma-cli，
// 写死就会在容器里报 Cannot find module '/prisma-cli/node_modules/prisma/build/index.js'。
const shim = path.join(OUT, "prisma");
const relEntry = path.join("node_modules", "prisma", "build", "index.js");
if (!fs.existsSync(path.join(OUT, relEntry))) {
  console.error(`[bundle-prisma-cli] 找不到 CLI 入口：${path.join(OUT, relEntry)}`);
  process.exit(1);
}
fs.writeFileSync(
  shim,
  `#!/bin/sh\nDIR=$(cd "$(dirname "$0")" && pwd)\nexec node "$DIR/${relEntry.split(path.sep).join("/")}" "$@"\n`,
  { mode: 0o755 },
);

// 引擎权限：@prisma/engines 里的二进制丢了可执行位就跑不起来
const enginesDir = path.join(outModules, "@prisma", "engines");
const fixExec = (p) => {
  if (!fs.existsSync(p)) return;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, e.name);
    if (e.isDirectory()) fixExec(full);
    else if (!/\.(js|json|md|d\.ts|map)$/i.test(e.name)) fs.chmodSync(full, 0o755);
  }
};
fixExec(enginesDir);

const statSize = (p) => {
  let n = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, e.name);
    if (e.isDirectory()) n += statSize(full);
    else n += fs.statSync(full).size;
  }
  return n;
};
bytes = statSize(outModules);

console.log(
  `[bundle-prisma-cli] 拷贝 ${copied.size} 个包，${(bytes / 1024 / 1024).toFixed(1)} MB → ${OUT}`,
);
if (missing.length > 0) {
  console.log(`[bundle-prisma-cli] 跳过未安装的可选依赖：${[...new Set(missing)].join(", ")}`);
}
const must = ["prisma", "@prisma/engines"];
for (const m of must) {
  if (!copied.has(m)) {
    console.error(`[bundle-prisma-cli] 关键包缺失：${m}`);
    process.exit(1);
  }
}
