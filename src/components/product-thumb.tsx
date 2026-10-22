"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImageOff } from "lucide-react";

/**
 * 商品缩略图 + 鼠标悬停放大预览。
 *
 * 为什么用 portal 而不是在缩略图旁边放一个 absolute 的浮层：
 * 商品列表的表格外面套着 `overflow-x-auto`，任何绝对定位的子元素都会被裁掉；
 * 入库/出库的选品下拉同理（列表自己滚动）。portal 挂到 body 上、按
 * getBoundingClientRect 算 fixed 坐标，不管父容器怎么裁都不会被切。
 *
 * 交互约定：
 * - 鼠标移上去 140ms 后才弹（快速划过列表时不会满屏闪图）
 * - 浮层 pointer-events-none，不会挡住鼠标，也不会把 mouseleave 吃掉
 * - 点一下缩略图也能开/关（触屏设备没有 hover）
 * - 滚动、缩放、按 Esc 一律关掉（图跟着页面滚走位置就错了）
 */

const CARD_WIDTH = 340;
const IMAGE_HEIGHT = 300;
const CAPTION_HEIGHT = 40;
const CARD_HEIGHT = IMAGE_HEIGHT + CAPTION_HEIGHT;
const GAP = 14;
const MARGIN = 12;
const OPEN_DELAY = 140;

export function ProductThumb({
  url,
  name,
  size = 36,
  className = "",
  clickToPreview = true,
}: {
  url: string | null;
  /** 预览图下面的说明文字（一般传产品名） */
  name?: string;
  /** 缩略图边长（px） */
  size?: number;
  className?: string;
  /** 下拉选项里的缩略图关掉点击（点图应该直接选中那一行，而不是弹图） */
  clickToPreview?: boolean;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;

    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // 默认放右边；右边放不下就翻到左边；两边都不行就贴着视口裁
    let left = r.right + GAP;
    if (left + CARD_WIDTH + MARGIN > vw) left = r.left - CARD_WIDTH - GAP;
    if (left < MARGIN) {
      left = Math.max(MARGIN, Math.min(vw - CARD_WIDTH - MARGIN, r.left));
    }

    // 竖着跟缩略图居中对齐，但不能超出视口
    let top = r.top + r.height / 2 - CARD_HEIGHT / 2;
    top = Math.max(MARGIN, Math.min(top, vh - CARD_HEIGHT - MARGIN));

    setPos({ left, top });
  }, []);

  const show = useCallback(() => {
    if (!url) return;
    clearTimer();
    timerRef.current = setTimeout(place, OPEN_DELAY);
  }, [url, place]);

  const hide = useCallback(() => {
    clearTimer();
    setPos(null);
  }, []);

  const toggle = useCallback(() => {
    if (!url) return;
    if (pos) hide();
    else {
      clearTimer();
      place();
    }
  }, [url, pos, hide, place]);

  // 打开期间：滚动 / 缩放 / Esc 都要收起来，否则浮层会停在原位不动
  useEffect(() => {
    if (!pos) return;
    const onScroll = () => hide();
    const onResize = () => hide();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("keydown", onKey);
    };
  }, [pos, hide]);

  const box = `${url && clickToPreview ? "cursor-zoom-in" : ""}`;

  return (
    <>
      <span
        ref={anchorRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={
          clickToPreview
            ? (e) => {
                e.stopPropagation();
                toggle();
              }
            : undefined
        }
        className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line-2 bg-[#f7f8fa] ${box} ${className}`}
        style={{ width: size, height: size }}
        title={url ? `${name ? `${name} · ` : ""}悬停看大图` : name ? `${name}（未传图）` : undefined}
      >
        {url ? (
          // 内部图片走带鉴权的接口，用原生 img 即可（已登录携带 cookie）
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={name ?? ""} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <ImageOff size={Math.max(13, Math.round(size * 0.42))} strokeWidth={1.6} className="text-[#c8ccd4]" />
        )}
      </span>

      {mounted && pos && url
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[70] overflow-hidden rounded-card border border-line bg-white"
              style={{ left: pos.left, top: pos.top, width: CARD_WIDTH }}
              role="dialog"
              aria-label={name ? `${name} 大图预览` : "商品图片预览"}
            >
              <div className="flex items-center justify-center bg-[#f7f8fa]" style={{ height: IMAGE_HEIGHT }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={name ?? ""}
                  className="max-h-full max-w-full object-contain"
                  draggable={false}
                />
              </div>
              {name ? (
                <div className="flex items-center justify-between gap-2 border-t border-line-2 px-3 py-2">
                  <span className="truncate text-[12.5px] font-medium text-ink">{name}</span>
                  <span className="shrink-0 text-[11px] text-muted">移开收起</span>
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
