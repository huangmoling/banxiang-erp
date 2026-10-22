import { SignJWT, jwtVerify } from "jose";

/**
 * 访问令牌的签发与校验。
 * 这里不读环境变量、不依赖 Node API，因此 Edge Runtime（middleware）也能用。
 */

export type AccessClaims = {
  sub: string;
  username: string;
  displayName: string;
  role: string;
  /** 签发时间（秒）。仅用于排查，判定作废靠下面的 pwd */
  iat: number | null;
  /**
   * 签发时该用户的 users.passwordChangedAt 毫秒戳（从未改过密码则为 null）。
   * 用毫秒而不是拿 iat 去比，是因为 JWT 的 iat 只到秒：
   * 「改密码」与「旧令牌最后一次请求」完全可能落在同一秒里，比不出先后。
   */
  pwd: number | null;
};

export async function signAccessToken(
  claims: Omit<AccessClaims, "iat">,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    username: claims.username,
    displayName: claims.displayName,
    role: claims.role,
    pwd: claims.pwd,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(key);
}

/** 校验失败（过期 / 篡改 / 格式错误）统一返回 null，由调用方决定如何处理 */
export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AccessClaims | null> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      username: String(payload.username ?? ""),
      displayName: String(payload.displayName ?? ""),
      role: String(payload.role ?? ""),
      iat: typeof payload.iat === "number" ? payload.iat : null,
      pwd: typeof payload.pwd === "number" ? payload.pwd : null,
    };
  } catch {
    return null;
  }
}
