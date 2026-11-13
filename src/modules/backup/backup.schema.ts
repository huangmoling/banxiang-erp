import { z } from "zod";
import { isValidCron } from "@/lib/cron";
import { BACKUP_KEEP_MAX, BACKUP_KEEP_MIN, type RemoteProvider } from "./backup.types";

/**
 * cron 表达式：标准 5 段（分 时 日 月 周）。
 * 校验不只靠正则——直接拿调度器那份解析器跑一遍，
 * 保证「能存进去的」一定是「调度器看得懂的」，不会出现存了个语法错、结果从此不备份。
 */
const cronSchema = z
  .string()
  .trim()
  .min(1, "cron 表达式不能为空")
  .max(120, "cron 表达式太长了")
  .refine((v) => isValidCron(v), {
    message: "cron 要 5 段（分 时 日 月 周），例如 0 3 * * * 表示每天 3 点",
  });

/** 网盘地址：留空允许（= 没配），填了就必须是 http(s) 的完整地址 */
const urlSchema = z
  .string()
  .trim()
  .max(300, "地址太长了")
  .refine((v) => v === "" || /^https?:\/\/[^\s]+$/i.test(v), {
    message: "地址要像 https://dav.jianguoyun.com/dav 这样",
  });

const remotePathSchema = z
  .string()
  .trim()
  .max(300, "目录太长了")
  .refine((v) => v === "" || v.startsWith("/") || v.startsWith("./") || !v.includes(".."), {
    message: "目录要写成 /suteng 这样",
  });

const providerSchema = z.enum(["openlist", "jianguoyun"]);

const remoteSchema = z.object({
  enabled: z.boolean().optional(),
  provider: providerSchema.optional(),
  url: urlSchema.optional(),
  username: z.string().trim().max(120, "账号太长了").optional(),
  remotePath: remotePathSchema.optional(),
  /** 留空表示不改已保存的密码 */
  password: z.string().max(200, "密码太长了").optional(),
  /** 长期令牌（只有 OpenList 用），留空表示不改 */
  token: z.string().trim().max(600, "令牌太长了").optional(),
});

export const backupSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  cron: cronSchema.optional(),
  keepCount: z
    .number()
    .int("份数要填整数")
    .min(BACKUP_KEEP_MIN, `至少保留 ${BACKUP_KEEP_MIN} 份`)
    .max(BACKUP_KEEP_MAX, `最多保留 ${BACKUP_KEEP_MAX} 份`)
    .optional(),
  remote: remoteSchema.optional(),
  /** 老前端的字段名，等价于 remote；升级期间两边都收 */
  openlist: remoteSchema.optional(),
});

export type BackupSettingsInput = z.infer<typeof backupSettingsSchema>;

/** 测试连接：允许直接把界面上没保存的参数丢过来试 */
export const remoteTestSchema = z.object({
  provider: providerSchema.optional(),
  url: z.string().trim().max(300).optional(),
  username: z.string().trim().max(120).optional(),
  password: z.string().max(200).optional(),
  token: z.string().trim().max(600).optional(),
  remotePath: z.string().trim().max(300).optional(),
});

/** 老名字，保留导出以免旧引用报错 */
export const openlistTestSchema = remoteTestSchema;

/** 备份文件名：拒绝一切路径字符，只认自己生成的两种（tar 含图片 / db 老格式） */
export const backupNameSchema = z
  .string()
  .regex(/^suteng-(auto|manual|pre-restore)-\d{8}-\d{6}\.(tar|db)$/, "备份文件名不合法");

export type RemoteProviderInput = RemoteProvider;
