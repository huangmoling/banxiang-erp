import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError, ForbiddenError, isAppError, UnauthorizedError } from "./errors";
import { logger, type Logger } from "./logger";
import { getSession, type AuthUser } from "./session";

export type RouteContext<P> = {
  req: NextRequest;
  params: P;
  requestId: string;
  log: Logger;
  user: AuthUser;
};

export type PublicRouteContext<P> = Omit<RouteContext<P>, "user"> & { user: AuthUser | null };

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
};

function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
): NextResponse<ApiErrorBody> {
  const body: ApiErrorBody = { error: { code, message, requestId } };
  if (details !== undefined) body.error.details = details;
  return NextResponse.json(body, {
    status,
    headers: { "x-request-id": requestId },
  });
}

/**
 * 统一的路由包装器：
 * - 生成/透传 requestId，结构化日志
 * - 统一鉴权（默认要求登录，公开端点显式 auth:false）
 * - 统一错误映射，客户端永远只看到规范结构，不返回堆栈
 * - handler 直接返回数据对象即可，自动包成 { data }
 */
export function defineRoute<P = Record<string, never>>(
  handler: (ctx: RouteContext<P>) => Promise<unknown> | unknown,
  options: { auth?: boolean; roles?: string[] } = {},
) {
  const requireAuth = options.auth !== false;

  return async (req: NextRequest, routeCtx: { params: Promise<P> }): Promise<Response> => {
    const started = Date.now();
    const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const log = logger.child({ requestId });

    try {
      const params = (routeCtx?.params ? await routeCtx.params : ({} as P)) as P;
      const user = await getSession();

      if (requireAuth) {
        if (!user) throw new UnauthorizedError();
        if (options.roles && options.roles.length > 0 && !options.roles.includes(user.role)) {
          throw new ForbiddenError();
        }
      }

      const result = await handler({
        req,
        params,
        requestId,
        log,
        user: user as AuthUser,
      });

      if (result instanceof Response) {
        result.headers.set("x-request-id", requestId);
        return result;
      }

      log.info(
        { method: req.method, path: req.nextUrl.pathname, status: 200, ms: Date.now() - started },
        "request ok",
      );

      return NextResponse.json({ data: result ?? null }, { headers: { "x-request-id": requestId } });
    } catch (err) {
      const ms = Date.now() - started;
      const path = req.nextUrl.pathname;

      if (err instanceof ZodError) {
        const details = err.issues.map((i) => ({
          field: i.path.join(".") || "(root)",
          message: i.message,
        }));
        log.warn({ method: req.method, path, status: 400, ms, details }, "validation failed");
        return errorResponse(400, "VALIDATION_ERROR", details[0]?.message ?? "提交的内容有误", requestId, details);
      }

      if (isAppError(err)) {
        const level = err.status >= 500 ? "error" : "warn";
        log[level]({ method: req.method, path, status: err.status, ms, code: err.code }, err.message);
        return errorResponse(err.status, err.code, err.message, requestId, err.details);
      }

      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2002") {
          log.warn({ method: req.method, path, status: 409, ms, target: err.meta?.target }, "unique conflict");
          return errorResponse(409, "CONFLICT", "该记录已存在，请勿重复提交", requestId);
        }
        if (err.code === "P2025") {
          log.warn({ method: req.method, path, status: 404, ms }, "record not found");
          return errorResponse(404, "NOT_FOUND", "找不到该记录，可能已被删除", requestId);
        }
      }

      // 未知错误：日志留全量，响应只给通用信息 + requestId，便于对照排查
      log.error(
        { method: req.method, path, status: 500, ms, err: { message: (err as Error)?.message, stack: (err as Error)?.stack } },
        "unhandled error",
      );
      return errorResponse(500, "INTERNAL_ERROR", "服务器处理失败，请稍后重试", requestId);
    }
  };
}

/** 显式声明公开端点（不需要登录） */
export const publicRoute = <P = Record<string, never>>(
  handler: (ctx: PublicRouteContext<P>) => Promise<unknown> | unknown,
) => defineRoute<P>(handler as (ctx: RouteContext<P>) => Promise<unknown> | unknown, { auth: false });

export function noContent(): Response {
  return new Response(null, { status: 204 });
}
