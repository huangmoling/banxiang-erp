/**
 * 备份 / 恢复的共享类型。前后端都能引，不含服务端依赖。
 */

/** auto 定时快照 | manual 手动快照 | pre-restore 恢复前自动拍的保命照 */
export type BackupKind = "auto" | "manual" | "pre-restore";

export const BACKUP_KIND_LABEL: Record<BackupKind, string> = {
  auto: "定时备份",
  manual: "手动备份",
  "pre-restore": "恢复前快照",
};

export const BACKUP_KIND_TONE: Record<BackupKind, string> = {
  auto: "bg-sunken text-ink-2",
  manual: "bg-brand-soft text-brand-ink",
  "pre-restore": "bg-warn-soft text-warn",
};

export type BackupFile = {
  /** 文件名（下载 / 删除都按它定位，服务端会再校验一遍格式） */
  name: string;
  kind: BackupKind;
  sizeBytes: number;
  createdAt: string;
  /**
   * 手动备份与恢复前快照都算「钉住的」：
   * 定时轮转只覆盖 auto，永远不碰它们。
   * 这是用户明确要求的——手动备的那一份不能被定时备份挤掉。
   */
  pinned: boolean;
  /** 这一份传到网盘（OpenList）的时间；没传过就是 null */
  uploadedAt: string | null;
};

/** 网盘（OpenList）配置。密码与令牌只进不出，接口回给前端的是「存了没」 */
export type OpenlistSettings = {
  enabled: boolean;
  /** 服务地址，例如 http://192.168.1.110:7890 */
  url: string;
  username: string;
  /** 网盘里的目标目录，例如 /r2/suteng */
  remotePath: string;
  /** 是否已经存了密码 / 长期令牌（前端只用来显示「已保存」） */
  passwordSet: boolean;
  tokenSet: boolean;
};

export type BackupSettings = {
  enabled: boolean;
  /**
   * 定时备份的 cron 表达式（5 段：分 时 日 月 周），按服务器本地时间。
   * 例：`0 3 * * *` 每天 3 点；`0 3 * * 1` 每周一；步进写法见 `CRON_PRESETS`。
   */
  cron: string;
  /** 定时备份保留份数：超出后从最旧的开始删。手动备份不占名额 */
  keepCount: number;
  /** 最近一次定时备份的完成时间（ISO） */
  lastAutoAt: string | null;
  /** 最近一次定时备份失败的原因，成功后清空 */
  lastAutoError: string | null;
  /** 按当前 cron 算出来的下一次运行时间（只读，服务端算好给界面显示） */
  nextRunAt: string | null;
  /** 最近一次往网盘传的时间（成功或失败都算） */
  lastUploadAt: string | null;
  /** 最近一次上传失败的原因，成功后清空 */
  lastUploadError: string | null;
  /** 网盘上传配置 */
  openlist: OpenlistSettings;
};

/** 保存设置时提交的补丁。网盘的密码/令牌留空表示「不改」 */
export type BackupSettingsPatch = {
  enabled?: boolean;
  cron?: string;
  keepCount?: number;
  openlist?: {
    enabled?: boolean;
    url?: string;
    username?: string;
    remotePath?: string;
    password?: string;
    token?: string;
  };
};

export type BackupListResult = {
  settings: BackupSettings;
  items: BackupFile[];
  /** 备份目录（挂在 data 卷里，整卷拷走就能带走所有备份） */
  dir: string;
  totalBytes: number;
  autoCount: number;
  manualCount: number;
};

export type BackupCreateResult = {
  file: BackupFile;
  /** 轮转时被覆盖掉（删掉）的旧定时备份 */
  removed: string[];
  /** 自动上传网盘的结果；没开网盘时是 null */
  upload: BackupUploadResult | null;
};

/** 一次上传的结果。失败不抛错——本地备份已经落盘了，传不上去只是「少一层保险」 */
export type BackupUploadResult = {
  ok: boolean;
  name: string;
  /** 上传成功时在网盘里的完整路径 */
  remotePath: string | null;
  error: string | null;
};

/** 「测试连接」的结果，界面上要逐条打勾/打叉 */
export type OpenlistTestResult = {
  ok: boolean;
  /** 用哪个账号连上的 */
  user: string | null;
  /** 目标目录在不在 */
  pathExists: boolean;
  /** 该目录可写 */
  writable: boolean;
  /** 目录里现在有多少个文件 */
  fileCount: number;
  /** 一句话结论，失败时就是原因 */
  message: string;
};

export type BackupRestoreResult = {
  /** 从哪个文件恢复的（用户上传的文件名，仅供显示） */
  from: string;
  /** 恢复前自动给当时的数据拍的快照，后悔了还能用这份退回来 */
  safetyBackup: string | null;
  /** 备份里缺少哪些迁移：非空说明备份来自旧版本，需要重启容器补表结构 */
  pendingMigrations: string[];
  /** schema 与当前代码不匹配时为 true，界面上要提示「请重启服务」 */
  needsRestart: boolean;
  /** 恢复后库里的数据量，给管理员吃个定心丸 */
  counts: { products: number; documents: number; movements: number; users: number };
};

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  enabled: true,
  cron: "0 3 * * *",
  keepCount: 7,
  lastAutoAt: null,
  lastAutoError: null,
  nextRunAt: null,
  lastUploadAt: null,
  lastUploadError: null,
  openlist: {
    enabled: false,
    url: "",
    username: "",
    remotePath: "",
    passwordSet: false,
    tokenSet: false,
  },
};

/** 定时备份最多留多少份（再多就是拿磁盘开玩笑） */
export const BACKUP_KEEP_MIN = 1;
export const BACKUP_KEEP_MAX = 60;

/** 上传日志留最近多少条（列表里标注「已上传」用，不必无限长） */
export const UPLOAD_LOG_MAX = 200;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
