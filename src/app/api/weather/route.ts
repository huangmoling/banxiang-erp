import { NextRequest } from "next/server";
import { defineRoute } from "@/lib/api-handler";
import { AppError } from "@/lib/errors";

/**
 * 工作台天气 —— 服务端代取。
 *
 * 为什么不放浏览器里直接 fetch：IP 定位那几个免费源（ipinfo / ipapi）
 * 都不给 CORS 头，端上拿不到；服务端请求没有这个限制。
 *
 * 定位优先级：
 *   1) 前端传了 lat/lon（HTTPS 下浏览器定位成功时）—— 最准；
 *   2) 否则按服务器自己的出口 IP 反查城市 —— 库房在哪，天气就是哪。
 *
 * 数据源 Open-Meteo（免 key）+ pconline / ipwho.is（免 key 的 IP 库）。
 * 全部失败就抛 503，前端静默不显示，不打扰干活。
 */

type Weather = { temp: number; code: number; city: string; high: number; low: number };

const TIMEOUT = 6000;
const CACHE_TTL = 10 * 60 * 1000;

// 同一坐标 10 分钟内不重复打外部接口：一台机器开着页面不会把免费额度刷完
const cache = new Map<string, { at: number; data: Weather }>();

function fetchWithTimeout(url: string, ms = TIMEOUT): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { signal: ctl.signal, cache: "no-store" }).finally(() => clearTimeout(timer));
}

/** 反查回来的「城市」得真是个城市：海上、空值都不认 */
const OCEAN = /大西洋|太平洋|印度洋|北冰洋|南冰洋|海洋|ocean/i;
function trustCity(city: string | undefined): boolean {
  const c = (city ?? "").trim();
  return c.length > 0 && !OCEAN.test(c);
}

/** 城市名 → 坐标（Open-Meteo geocoding，免 key） */
async function geocode(name: string): Promise<{ lat: number; lon: number; city: string } | null> {
  try {
    const res = await fetchWithTimeout(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=zh&format=json`,
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { results?: { latitude: number; longitude: number; name?: string }[] };
    const hit = j.results?.[0];
    if (!hit) return null;
    return { lat: hit.latitude, lon: hit.longitude, city: hit.name ?? name };
  } catch {
    return null;
  }
}

/**
 * 按服务器出口 IP 反查坐标与城市。
 *
 * 首选太平洋电脑网的 IP 库（whois.pconline.com.cn）：国内库，对家宽/联通线路
 * 认得很准，返回 GBK 编码的省/市名；ipwho.is 对 IPv6 常把坐标丢到海上
 * （实测给过「大西洋」），只作兜底。
 */
async function locateByIp(): Promise<{ lat: number; lon: number; city: string; source: string } | null> {
  try {
    const res = await fetchWithTimeout("https://whois.pconline.com.cn/ipJson.jsp?json=true");
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const text = new TextDecoder("gbk").decode(buf);
      const raw = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      const j = JSON.parse(raw) as { city?: string; pro?: string };
      const full = String(j.city || "").trim();
      if (trustCity(full)) {
        // 「成都市」查不到时退一步用「成都」
        for (const name of [full, full.replace(/市$/, "")]) {
          const geo = await geocode(name);
          if (geo) return { ...geo, source: `pconline:${name}` };
        }
      }
    }
  } catch {
    /* 换下一个源 */
  }
  try {
    const res = await fetchWithTimeout("https://ipwho.is/");
    if (res.ok) {
      const j = (await res.json()) as { success?: boolean; latitude?: number; longitude?: number; city?: string };
      if (j.success !== false && typeof j.latitude === "number" && typeof j.longitude === "number") {
        // ipwho 对 IPv6 常把点丢到海上，反查不到可信城市就当没定位到
        const city = j.city || (await cityFromCoords(j.latitude, j.longitude));
        if (trustCity(city)) return { lat: j.latitude, lon: j.longitude, city, source: "ipwho" };
        console.warn("[weather] ipwho 城市不可信:", city, j.latitude, j.longitude);
      }
    }
  } catch {
    /* 都失败就当没有 */
  }
  return null;
}

/**
 * 坐标反查城市名。ipwho.is 有时只回坐标不带 city，光有温度没有地名太干，
 * 补一层 BigDataCloud（免 key，中文）。失败就算了，不能因为城市名挂掉整块天气。
 */
async function cityFromCoords(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetchWithTimeout(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh`,
      4000,
    );
    if (!res.ok) return "";
    const j = (await res.json()) as { city?: string; locality?: string; principalSubdivision?: string };
    return j.city || j.locality || j.principalSubdivision || "";
  } catch {
    return "";
  }
}

export const GET = defineRoute(async ({ req }) => {
  const sp = (req as NextRequest).nextUrl.searchParams;
  // 注意：Number(null) === 0，没传参数时必须显式判空，
  // 否则「没坐标」会被当成 (0,0)——那是几内亚湾，出来的城市叫「大西洋」。
  const latStr = sp.get("lat");
  const lonStr = sp.get("lon");
  const latRaw = latStr === null || latStr === "" ? NaN : Number(latStr);
  const lonRaw = lonStr === null || lonStr === "" ? NaN : Number(lonStr);

  let lat: number;
  let lon: number;
  let city = sp.get("city") ?? "";
  let source = "ip";

  const hasCoords =
    Number.isFinite(latRaw) &&
    Number.isFinite(lonRaw) &&
    Math.abs(latRaw) <= 90 &&
    Math.abs(lonRaw) <= 180 &&
    !(Math.abs(latRaw) < 0.01 && Math.abs(lonRaw) < 0.01); // (0,0) 是无效定位
  if (hasCoords) {
    lat = latRaw;
    lon = lonRaw;
    source = "client-geo";
  } else {
    const loc = await locateByIp();
    if (!loc) throw new AppError("SERVICE_UNAVAILABLE", "暂时取不到天气", 503);
    lat = loc.lat;
    lon = loc.lon;
    city = city || loc.city;
    source = loc.source;
  }

  if (!city) city = await cityFromCoords(lat, lon);

  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    const cachedCity = trustCity(city) ? city : trustCity(hit.data.city) ? hit.data.city : "";
    return { ...hit.data, city: cachedCity, cached: true, source };
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lon.toFixed(4));
  url.searchParams.set("current", "temperature_2m,weather_code");
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("timezone", "auto");

  const res = await fetchWithTimeout(url.toString());
  if (!res.ok) throw new AppError("SERVICE_UNAVAILABLE", "天气服务暂时不可用", 503);

  const j = (await res.json()) as {
    current?: { temperature_2m?: number; weather_code?: number };
    daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
  };

  const temp = Math.round(j.current?.temperature_2m ?? NaN);
  if (!Number.isFinite(temp)) throw new AppError("SERVICE_UNAVAILABLE", "天气数据为空", 503);

  const data: Weather = {
    temp,
    code: Number(j.current?.weather_code ?? 0),
    city,
    high: Math.round(j.daily?.temperature_2m_max?.[0] ?? NaN),
    low: Math.round(j.daily?.temperature_2m_min?.[0] ?? NaN),
  };

  cache.set(key, { at: Date.now(), data });
  return { ...data, source };
});

export const runtime = "nodejs";
