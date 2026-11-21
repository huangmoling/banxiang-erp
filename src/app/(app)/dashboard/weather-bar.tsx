"use client";

import { useEffect, useState } from "react";
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  MapPin,
  Sun,
} from "lucide-react";

/**
 * 工作台问候栏的天气块。
 *
 * 请求走自家 /api/weather：IP 定位那几个免费源都不给 CORS 头，端上直接拿不到，
 * 交给服务端代取（服务端还有 10 分钟缓存，不刷外部额度）。
 *
 * 端上唯一能贡献的是精确定位：HTTPS 下 navigator.geolocation 拿到经纬度就带上，
 * 内网 http:// 时浏览器不给这个 API，服务端会自动退回按出口 IP 定位。
 *
 * 取不到就整块不渲染 —— 工作台是干活的地方，不拿报错占位置。
 */

type Weather = { temp: number; code: number; city: string; high: number; low: number };

const CACHE_KEY = "banxiang:weather:v1";
const CACHE_TTL = 10 * 60 * 1000;
const GEO_TIMEOUT = 5000;

function iconOf(code: number) {
  if (code === 0) return Sun;
  if (code <= 2) return CloudSun;
  if (code === 3) return Cloud;
  if (code === 45 || code === 48) return CloudFog;
  if (code >= 51 && code <= 57) return CloudDrizzle;
  if (code >= 61 && code <= 67) return CloudRain;
  if (code >= 71 && code <= 77) return CloudSnow;
  if (code >= 80 && code <= 82) return CloudRain;
  if (code === 85 || code === 86) return CloudSnow;
  if (code >= 95) return CloudLightning;
  return CloudSun;
}

function textOf(code: number): string {
  if (code === 0) return "晴";
  if (code === 1) return "少云";
  if (code === 2) return "多云";
  if (code === 3) return "阴";
  if (code === 45 || code === 48) return "有雾";
  if (code >= 51 && code <= 57) return "毛毛雨";
  if (code >= 61 && code <= 67) return "下雨";
  if (code >= 71 && code <= 77) return "下雪";
  if (code >= 80 && code <= 82) return "阵雨";
  if (code === 85 || code === 86) return "阵雪";
  if (code >= 95) return "雷雨";
  return "多云";
}

/** 浏览器精确定位；非安全上下文（内网 http）拿不到 API，直接返回 null */
async function browserPosition(): Promise<{ lat: number; lon: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        timeout: GEO_TIMEOUT,
        maximumAge: 10 * 60 * 1000,
        enableHighAccuracy: false,
      }),
    );
    return { lat: pos.coords.latitude, lon: pos.coords.longitude };
  } catch {
    return null;
  }
}

async function loadWeather(): Promise<Weather> {
  const pos = await browserPosition();
  const qs = pos ? `?lat=${pos.lat.toFixed(4)}&lon=${pos.lon.toFixed(4)}` : "";
  const res = await fetch(`/api/weather${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error("weather-unavailable");
  const body = (await res.json()) as { data?: Weather };
  if (!body.data || typeof body.data.temp !== "number") throw new Error("weather-empty");
  return body.data;
}

export function WeatherBar() {
  const [wx, setWx] = useState<Weather | null>(null);

  useEffect(() => {
    let alive = true;

    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { at: number; data: Weather };
        if (saved?.at && Date.now() - saved.at < CACHE_TTL && typeof saved.data?.temp === "number") {
          setWx(saved.data);
          return;
        }
      }
    } catch {
      /* 缓存坏了就重新取 */
    }

    loadWeather()
      .then((data) => {
        if (!alive) return;
        setWx(data);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
        } catch {
          /* 隐私模式写不进去，忽略 */
        }
      })
      .catch(() => {
        /* 取不到就保持不渲染 */
      });

    return () => {
      alive = false;
    };
  }, []);

  if (!wx) return null;

  const Icon = iconOf(wx.code);
  const range =
    Number.isFinite(wx.high) && Number.isFinite(wx.low) ? `最高 ${wx.high}° 最低 ${wx.low}°` : textOf(wx.code);

  return (
    <div
      className="flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 backdrop-blur-[2px]"
      title={range}
    >
      <Icon size={17} strokeWidth={2} className="shrink-0 text-white" />
      <span className="tnum text-[14px] font-semibold leading-none text-white">{wx.temp}°</span>
      <span className="text-[12px] leading-none text-white/85">{textOf(wx.code)}</span>
      {wx.city ? (
        <span className="flex items-center gap-0.5 text-[11.5px] leading-none text-white/70">
          <MapPin size={11} strokeWidth={2.2} className="shrink-0" />
          {wx.city}
        </span>
      ) : null}
    </div>
  );
}
