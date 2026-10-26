#!/usr/bin/env node
/**
 * suteng-erp 构建残留清理器
 *
 * 存在意义
 * --------
 * 本项目历史上每次构建前会把 .next 改名成 .next-old-* 作为回滚点（约 180 MB /
 * 830~900 个文件），加上 .tmp 下 docker save 导出的 830 MB tar。这些中间产物
 * 在 F 盘上被删除时会整棵进入回收站，短时间内堆到数 GB。
 *
 * 重要实测结论（本机）
 * -------------------
 * F 盘上任何删除动作（包括 Node 的 fs.rmSync 与 Win32 DeleteFileW）都会被卷级
 * 机制转成「移入回收站」，增量恒等于原文件大小；C 盘删除则是真正的物理删除。
 * 因此本脚本无法绕过回收站，它的作用是：
 *   1) 把散落各处的残留一次性集中清除，避免条目碎片化累积；
 *   2) 抑制 .next-old-* 快照的产生（建议直接不用快照，见 package.json）。
 *
 * 治本做法：构建前不再备份 .next（next build 可自行覆盖），docker save 的 tar
 * 输出到 C 盘 %TEMP% 而非项目目录。
 *
 * 用法
 * ----
 *   node scripts/clean.mjs                清理全部快照与 .tmp 下的 tar
 *   node scripts/clean.mjs --keep 1       保留最近 1 份快照
 *   node scripts/clean.mjs --dry          只列出将要删除的内容
 *   node scripts/clean.mjs --snapshot     应急：把 .next 改名为 .next-old-<时间戳>
 *                                         （会产生一份 180 MB 回收站垃圾，慎用）
 *   node scripts/clean.mjs --quiet        仅输出最终汇总
 *
 * 推荐入口（见 package.json）
 * --------------------------
 *   npm run clean         立刻清理全部残留
 *   npm run clean:dry     预演，不实际删除
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const argv = process.argv.slice(2)
const FLAG = (f) => argv.includes(f)
const NUM = (f, fallback) => {
  const i = argv.indexOf(f)
  if (i < 0) return fallback
  const v = Number(argv[i + 1])
  return Number.isFinite(v) ? v : fallback
}

const DRY = FLAG('--dry')
const QUIET = FLAG('--quiet')
const SNAPSHOT_ONLY = FLAG('--snapshot')
const KEEP = Math.max(0, NUM('--keep', 1))

const SNAPSHOT_RE = /^\.next-old/
const TAR_DIR = path.join(ROOT, '.tmp')

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`

function log(msg) {
  if (!QUIET) console.log(msg)
}

function dirSize(target) {
  let total = 0
  const stack = [target]
  while (stack.length) {
    const cur = stack.pop()
    let st
    try {
      st = fs.lstatSync(cur)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      let entries = []
      try {
        entries = fs.readdirSync(cur)
      } catch {
        continue
      }
      for (const e of entries) stack.push(path.join(cur, e))
    } else {
      total += st.size
    }
  }
  return total
}

/** 物理删除。fs.rmSync 不经过回收站，这是本脚本的核心。 */
function removePath(target) {
  if (DRY) return
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

function pad(n, width = 2) {
  return String(n).padStart(width, '0')
}

function stamp(d = new Date()) {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

function listSnapshots() {
  let entries
  try {
    entries = fs.readdirSync(ROOT, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory() && SNAPSHOT_RE.test(e.name))
    .map((e) => {
      const full = path.join(ROOT, e.name)
      let mtime = 0
      try {
        mtime = fs.statSync(full).mtimeMs
      } catch {
        /* ignore */
      }
      return { full, name: e.name, mtime, size: dirSize(full) }
    })
    .sort((a, b) => b.mtime - a.mtime)
}

function listTarballs() {
  if (!fs.existsSync(TAR_DIR)) return []
  const out = []
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (/\.tar(\.gz)?$/i.test(e.name)) {
        let size = 0
        try {
          size = fs.statSync(full).size
        } catch {
          /* ignore */
        }
        out.push({ full, name: path.relative(ROOT, full), size })
      }
    }
  }
  walk(TAR_DIR)
  return out
}

/* ---------------- 快照模式 ---------------- */

function doSnapshot() {
  const cur = path.join(ROOT, '.next')
  if (!fs.existsSync(cur)) {
    log('· 未发现 .next，跳过快照')
    return
  }
  const destName = `.next-old-${stamp()}`
  const dest = path.join(ROOT, destName)
  if (DRY) {
    log(`· [dry] 将把 .next 改名为 ${destName}`)
    return
  }
  fs.renameSync(cur, dest)
  log(`· 快照完成：.next → ${destName}（${mb(dirSize(dest))}）`)
}

/* ---------------- 清理模式 ---------------- */

function doClean() {
  const snaps = listSnapshots()
  const tars = listTarballs()

  let freed = 0
  let removed = 0

  const doomedSnaps = snaps.slice(KEEP)
  const keptSnaps = snaps.slice(0, KEEP)

  if (keptSnaps.length) {
    for (const s of keptSnaps) log(`  保留 ${s.name}（${mb(s.size)}）`)
  }

  for (const s of doomedSnaps) {
    log(`  ${DRY ? '[dry] 将删除' : '删除'} ${s.name}（${mb(s.size)}）`)
    removePath(s.full)
    freed += s.size
    removed += 1
  }

  for (const t of tars) {
    log(`  ${DRY ? '[dry] 将删除' : '删除'} ${t.name}（${mb(t.size)}）`)
    removePath(t.full)
    freed += t.size
    removed += 1
  }

  // .tmp 清空后顺手移除空目录
  if (!DRY && fs.existsSync(TAR_DIR)) {
    try {
      if (fs.readdirSync(TAR_DIR).length === 0) fs.rmdirSync(TAR_DIR)
    } catch {
      /* ignore */
    }
  }

  if (removed === 0) {
    log('· 没有需要清理的残留，已是干净状态')
  } else {
    console.log(
      `${DRY ? '[预演] 将' : '已'}清理 ${removed} 项，释放 ${mb(freed)}（物理删除，未进入回收站）`
    )
  }
}

/* ---------------- 入口 ---------------- */

if (SNAPSHOT_ONLY) {
  doSnapshot()
} else {
  doClean()
}
