import "server-only";
import pino from "pino";
import { env } from "./env";

/**
 * 结构化 JSON 日志，贯穿 requestId。
 * 敏感字段一律脱敏，密码与令牌绝不落日志。
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { app: "suteng-erp" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "password",
      "*.password",
      "passwordHash",
      "*.passwordHash",
      "token",
      "*.token",
      "accessToken",
      "refreshToken",
      "*.refreshToken",
      "authorization",
      "headers.cookie",
      "req.headers.cookie",
    ],
    censor: "[redacted]",
  },
});

export type Logger = typeof logger;
