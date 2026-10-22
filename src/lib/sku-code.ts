import "server-only";
import { randomBytes } from "node:crypto";

/**
 * SKU 内部编码：只在系统内使用，仓管不需要记。
 * 用随机串而非自增，避免并发下拿不到号；唯一性由数据库唯一索引兜底。
 */
export function generateSkuCode(): string {
  const body = BigInt(`0x${randomBytes(6).toString("hex")}`).toString(36).toUpperCase();
  return `SKU-${body.padStart(8, "0").slice(-8)}`;
}
