import { ShieldAlert } from "lucide-react";
import { getSession } from "@/lib/session";
import { BackupsClient } from "./backups-client";

export const dynamic = "force-dynamic";

export default async function BackupsPage() {
  const user = await getSession();

  // 备份 = 整套账的可下载副本 + 一键覆盖的能力，只给管理员
  if (!user || user.role !== "admin") {
    return (
      <div className="card flex items-start gap-3 p-5">
        <ShieldAlert size={18} strokeWidth={1.8} className="mt-0.5 text-[#a15f12]" />
        <div>
          <h1 className="text-[15px] font-semibold text-ink">这个页面只有管理员能看</h1>
          <p className="mt-1 text-[13px] leading-6 text-muted">
            备份文件里是全部的账，恢复还能一键覆盖数据，所以只开放给管理员。要备份或恢复，找店里管服务器的人。
          </p>
        </div>
      </div>
    );
  }

  return <BackupsClient />;
}
