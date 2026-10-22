import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { ensureBackupScheduler } from "@/modules/backup/backup.scheduler";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession();
  if (!user) redirect("/login");

  // 定时备份的调度器在这里点着。
  // 调度器的第一现场是 src/instrumentation.ts（进程启动就跑，不依赖有人访问）。
  // 这里再点一次是兜底：本地 dev 热更新、或者哪天 instrumentation 被误删，
  // 只要人还在用系统，备份就一定会继续跑。ensureBackupScheduler 是幂等的。
  ensureBackupScheduler();

  return (
    <ToastProvider>
      <AppShell user={user}>{children}</AppShell>
    </ToastProvider>
  );
}
