/** Cookie 名称，middleware（Edge）与 Node 端共用，故不引入 server-only */

export const ACCESS_COOKIE = "st_access";
export const REFRESH_COOKIE = "st_refresh";

/** 刷新端点路径：被 middleware 重定向到这里换取新访问令牌 */
export const REFRESH_PATH = "/api/auth/session-refresh";
