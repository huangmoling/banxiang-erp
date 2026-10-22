"use client";

/** 前端统一 API 客户端：自动序列化、统一错误映射、401 自动回登录页 */

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, body: ApiErrorBody | null, fallback = "请求失败，请稍后重试") {
    const message = body?.error?.message ?? fallback;
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.error?.code ?? "UNKNOWN";
    this.details = body?.error?.details;
    this.requestId = body?.error?.requestId;
  }
}

type Options = Omit<RequestInit, "body"> & {
  /** JSON 请求体，自动序列化并带 content-type */
  json?: unknown;
  /** 原始请求体（上传文件用 FormData 时走这里） */
  body?: BodyInit | null;
  /** 401 时不自动跳登录（登录页自己处理错误时用） */
  noAuthRedirect?: boolean;
};

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const { json, noAuthRedirect, headers, body, ...rest } = options;

  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: {
        ...(json !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : body,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, null, "连不上服务器，请检查网络或确认服务是否在运行");
  }

  if (res.status === 401 && !noAuthRedirect) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}`;
    throw new ApiError(401, null, "登录已过期，正在跳转登录页");
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const payload = text ? safeParse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, (payload as ApiErrorBody) ?? null);
  }

  // 统一包装：{ data: ... }
  if (payload && typeof payload === "object" && "data" in (payload as object)) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
