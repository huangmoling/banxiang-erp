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

/**
 * tar = 数据库 + 商品图片 + manifest（v1.5 起）
 * db  = 只有数据库的老备份（v1.4 及以前），仍可下载 / 恢复，但恢复不动图片
 */
export type BackupFormat = "tar" | "db";

/** 云端存储：OpenList（自建，挂 R2/本地盘）| 坚果云（WebDAV） */
export type RemoteProvider = "openlist" | "jianguoyun";

export const REMOTE_PROVIDER_LABEL: Record<RemoteProvider, string> = {
  openlist: "OpenList",
  jianguoyun: "坚果云",
};

/** 各家的默认地址与填写提示，界面直接读这里，避免两处写死 */
export const REMOTE_PROVIDER_META: Record<
  RemoteProvider,
  { urlPlaceholder: string; urlHint: string; userPlaceholder: string; passHint: string; pathHint: string }
> = {
  openlist: {
    urlPlaceholder: "http://192.168.1.110:7890",
    urlHint: "只填到端口就行，不用带网盘里的目录",
    userPlaceholder: "admin",
    passHint: "填 OpenList 的登录密码",
    pathHint: "OpenList 里的路径，例如 /r2/suteng；不存在会自动创建",
  },
  jianguoyun: {
    urlPlaceholder: "https://dav.jianguoyun.com/dav",
    urlHint: "坚果云固定填 https://dav.jianguoyun.com/dav（一般不用改）",
    userPlaceholder: "you@example.com",
    passHint: "填坚果云的【应用密码】，不是登录密码",
    pathHint: "坚果云里的目录，例如 /suteng；不存在会自动创建",
  },
};

export type BackupFile = {
  /** 文件名（下载 / 删除 / 恢复都按它定位，服务端会再校验一遍格式） */
  name: string;
  kind: BackupKind;
  /** tar 含图片，db 只有数据库 */
  format: BackupFormat;
  sizeBytes: number;
  createdAt: string;
  /**
   * 手动备份与恢复前快照都算「钉住的」：
   * 定时轮转只覆盖 auto，永远不碰它们。
   * 这是用户明确要求的——手动备的那一份不能被定时备份挤掉。
   */
  pinned: boolean;
  /** 这一份传到云端的时间；没传过就是 null */
  uploadedAt: string | null;
  /** 包里带了几张商品图；老 .db 备份或还没登记时为 null */
  imageCount: number | null;
  /** 库里那部分多大（tar 里 suteng.db 的大小），老备份为 null */
  dbBytes: number | null;
};

/** 云端存储配置。密码与令牌只进不出，接口回给前端的是「存了没」 */
export type RemoteSettings = {
  enabled: boolean;
  provider: RemoteProvider;
  /** OpenList 服务地址 / 坚果云 WebDAV 地址 */
  url: string;
  username: string;
  /** 网盘里的目标目录，例如 /r2/suteng 或 /suteng */
  remotePath: string;
  /** 是否已经存了密码（坚果云是应用密码） */
  passwordSet: boolean;
  /** 是否已经存了长期令牌（只有 OpenList 用） */
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
  /** 最近一次往云端传的时间（成功或失败都算） */
  lastUploadAt: string | null;
  /** 最近一次上传失败的原因，成功后清空 */
  lastUploadError: string | null;
  /** 云端上传配置 */
  remote: RemoteSettings;
  /** 当前商品图片目录的绝对路径（界面显示「图片也一起备了」，也方便排查挂载） */
  imageDir: string;
};

/** 保存设置时提交的补丁。网盘的密码/令牌留空表示「不改」 */
export type BackupSettingsPatch = {
  enabled?: boolean;
  cron?: string;
  keepCount?: number;
  remote?: {
    enabled?: boolean;
    provider?: RemoteProvider;
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
  /** 自动上传云端的结果；没开云端时是 null */
  upload: BackupUploadResult | null;
};

/** 一次上传的结果。失败不抛错——本地备份已经落盘了，传不上去只是「少一层保险」 */
export type BackupUploadResult = {
  ok: boolean;
  name: string;
  /** 上传成功时在云端里的完整路径 */
  remotePath: string | null;
  error: string | null;
};

/** 「测试连接」的结果，界面上要逐条打勾/打叉 */
export type RemoteTestResult = {
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

/** 老名字，保留导出以免旧引用报错 */
export type OpenlistTestResult = RemoteTestResult;

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
  /** 恢复源的格式：tar 带图片，db 只有库 */
  format: BackupFormat;
  /** 备份包里带了几张商品图（db 格式为 0） */
  imagesInBackup: number;
  /** 这次真正写进图片目录的张数（已存在的同名图不重复写） */
  imagesRestored: number;
  /** 恢复后仍找不到图片文件的商品数——为 0 才算图片完全对上了 */
  imagesMissing: number;
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
  remote: {
    enabled: false,
    provider: "openlist",
    url: "",
    username: "",
    remotePath: "",
    passwordSet: false,
    tokenSet: false,
  },
  imageDir: "",
};

/** 定时备份最多留多少份（再多就是拿磁盘开玩笑） */
export const BACKUP_KEEP_MIN = 1;
export const BACKUP_KEEP_MAX = 60;

/** 上传日志留最近多少条（列表里标注「已上传」用，不必无限长） */
export const UPLOAD_LOG_MAX = 200;

/** 备份文件信息登记表留多少条（列表里显示「带几张图」用） */
export const FILE_INFO_MAX = 300;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
