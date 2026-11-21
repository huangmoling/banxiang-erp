/**
 * 类型化错误体系。
 * 业务代码只抛这些错误，全局处理器负责翻译成规范响应，
 * 客户端永远看不到堆栈与内部细节。
 */

export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "TOO_MANY_REQUESTS"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: AppErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = "提交的内容有误，请检查后重试", details?: unknown) {
    super("VALIDATION_ERROR", message, 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "请先登录") {
    super("UNAUTHORIZED", message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "没有权限执行此操作") {
    super("FORBIDDEN", message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "找不到该记录") {
    super("NOT_FOUND", message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message = "数据冲突，请刷新后重试", details?: unknown) {
    super("CONFLICT", message, 409, details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "操作过于频繁，请稍后再试") {
    super("TOO_MANY_REQUESTS", message, 429);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
