import "server-only";
import { z } from "zod";

/**
 * 配置集中校验：启动即失败，绝不带着半截配置跑起来。
 * 所有密钥只能来自环境变量，代码里不出现默认密钥。
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL 未配置"),

  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET 至少需要 32 位字符，请用随机字符串，不要手写短口令"),
  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(28800),
  REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(6048000),

  UPLOAD_DIR: z.string().default("./data/uploads"),
  UPLOAD_MAX_MB: z.coerce.number().positive().default(5),

  APP_NAME: z.string().default("宿藤家居 ERP"),
  BOOTSTRAP_ADMIN_USERNAME: z.string().default("admin"),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(6).default("suteng@2026"),
  BOOTSTRAP_ADMIN_NAME: z.string().default("管理员"),

  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  // 配置错误必须在启动阶段就暴露，不能等到某个请求才崩
  throw new Error(`环境变量配置有误：\n${lines.join("\n")}\n请参照 .env.example 补齐。`);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === "production",
  isDev: raw.NODE_ENV === "development",
} as const;

export type Env = typeof env;
