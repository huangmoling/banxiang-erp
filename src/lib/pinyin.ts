import { pinyin } from "pinyin-pro";

/**
 * 拼音索引：在「保存商品」时生成并落库，不是查询时现算。
 * 理由——几千个商品每次搜索都实时转拼音会拖慢输入体验；落库后建索引，查询是毫秒级。
 */
export type PinyinIndex = {
  /** 全拼，连续小写，如 beioubuyidanyiren */
  full: string;
  /** 首字母，如 boby */
  initials: string;
};

/** 统一归一化：小写、去空白、去标点，保证「北欧 布艺」与「北欧布艺」等价 */
function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "")
    .replace(/[·・\-_/\\()（）[\]【】,，.。:：;；'"'"!！?？、]/g, "");
}

/**
 * 生成拼音索引。
 * nonZh: "consecutive" 让「1.4m」「2.2m」这类非中文片段整体保留，
 * 否则会被拆成单个字母，首字母检索就乱了。
 */
export function buildPinyinIndex(name: string): PinyinIndex {
  const text = name.trim();
  if (!text) return { full: "", initials: "" };

  let fullArr: string[] = [];
  let firstArr: string[] = [];

  try {
    const full = pinyin(text, {
      toneType: "none",
      type: "array",
      nonZh: "consecutive",
      v: true,
    });
    const first = pinyin(text, {
      pattern: "first",
      toneType: "none",
      type: "array",
      nonZh: "consecutive",
      v: true,
    });
    fullArr = Array.isArray(full) ? full : [String(full)];
    firstArr = Array.isArray(first) ? first : [String(first)];
  } catch {
    // 拼音库异常不能阻断保存商品：退化为原文本，至少还能按中文搜到
    return { full: normalize(text), initials: normalize(text) };
  }

  return {
    full: normalize(fullArr.join("")),
    initials: normalize(firstArr.join("")),
  };
}

/** 判断一个查询串是否像拼音（用于决定要不要走拼音字段匹配） */
export function looksLikePinyin(query: string): boolean {
  return /^[a-z0-9]+$/i.test(query.trim());
}
