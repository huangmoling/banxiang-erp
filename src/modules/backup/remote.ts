import "server-only";
import {
  normalizeRemotePath,
  testOpenlist,
  uploadToOpenlist,
  type OpenlistConfig,
} from "./openlist.client";
import {
  JIANGUOYUN_DEFAULT_URL,
  testWebdav,
  uploadToWebdav,
} from "./webdav.client";
import type { RemoteProvider, RemoteTestResult } from "./backup.types";

/**
 * 云端存储的统一入口。
 *
 * 现在支持两家：
 * - **OpenList**（自建，底下挂 R2 / 本地盘 / 各家网盘）——原来就有的那套
 * - **坚果云**（WebDAV）——客户手上现成的，不依赖家里那台 NAS 还活着
 *
 * 上层（backup.service）只认这里的两个函数，不再关心是哪家。
 * 加第三家只要在这里加一个分支。
 */

export type RemoteConfig = {
  provider: RemoteProvider;
  url: string;
  username: string;
  password: string;
  /** 只有 OpenList 用；坚果云走 Basic 认证 */
  token: string;
  remotePath: string;
};

export type RemoteUploadOutcome = { remotePath: string; size: number };

export function defaultRemoteUrl(provider: RemoteProvider): string {
  return provider === "jianguoyun" ? JIANGUOYUN_DEFAULT_URL : "";
}

/** 两家目录规则一致（/a/b，压掉重复斜杠），共用一份实现，免得改一边忘一边 */
export function normalizeRemotePathFor(_provider: RemoteProvider, raw: string): string {
  return normalizeRemotePath(raw);
}

function openlistOf(cfg: RemoteConfig): OpenlistConfig {
  return {
    url: cfg.url,
    username: cfg.username,
    password: cfg.password,
    token: cfg.token,
    remotePath: normalizeRemotePath(cfg.remotePath),
  };
}

export async function uploadToRemote(
  cfg: RemoteConfig,
  absPath: string,
  remoteName?: string,
): Promise<RemoteUploadOutcome> {
  if (cfg.provider === "jianguoyun") {
    const outcome = await uploadToWebdav(
      {
        url: cfg.url || JIANGUOYUN_DEFAULT_URL,
        username: cfg.username,
        password: cfg.password,
        remotePath: cfg.remotePath,
      },
      absPath,
      remoteName,
    );
    return { remotePath: outcome.remotePath, size: outcome.size };
  }

  return uploadToOpenlist(openlistOf(cfg), absPath, remoteName);
}

export async function testRemote(cfg: RemoteConfig): Promise<RemoteTestResult> {
  if (cfg.provider === "jianguoyun") {
    return testWebdav({
      url: cfg.url || JIANGUOYUN_DEFAULT_URL,
      username: cfg.username,
      password: cfg.password,
      remotePath: cfg.remotePath,
    });
  }
  return testOpenlist(openlistOf(cfg));
}
