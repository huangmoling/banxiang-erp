import { ShieldAlert } from "lucide-react";
import { getSession } from "@/lib/session";
import { UsersClient } from "./users-client";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await getSession();

  // 侧栏已经按角色隐藏了入口，这里再拦一道：直接敲地址也进不来
  if (!user || user.role !== "admin") {
    return (
      <div className="card flex items-start gap-3 p-5">
        <ShieldAlert size={18} strokeWidth={1.8} className="mt-0.5 text-warn" />
        <div>
          <h1 className="text-[15px] font-semibold text-ink">这个页面只有管理员能看</h1>
          <p className="mt-1 text-[13px] leading-6 text-muted">
            账号的增删改会影响所有人的权限，所以只开放给管理员。需要开号或改密码，找店里的管理员处理。
          </p>
        </div>
      </div>
    );
  }

  return <UsersClient currentUserId={user.id} />;
}
