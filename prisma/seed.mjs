/**
 * 生产环境启动初始化（纯 JS，不依赖 tsx）。
 * 幂等：已存在管理员就跳过，仓位按名称 upsert。
 * 由容器 CMD 在 `prisma migrate deploy` 之后、`node server.js` 之前执行。
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const username = process.env.BOOTSTRAP_ADMIN_USERNAME ?? "admin";
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "suteng@2026";
const displayName = process.env.BOOTSTRAP_ADMIN_NAME ?? "管理员";

async function main() {
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    await prisma.user.create({
      data: {
        username,
        displayName,
        passwordHash: await bcrypt.hash(password, 10),
        role: "admin",
      },
    });
    console.log(`[seed] 已创建管理员账号：${username}`);
  } else {
    console.log(`[seed] 已有 ${userCount} 个用户，跳过管理员创建`);
  }

  const locations = [
    { name: "主仓", type: "normal", isSellable: true, isSystem: true, sortNo: 1 },
    { name: "次品区", type: "defective", isSellable: false, isSystem: true, sortNo: 2 },
    { name: "报废区", type: "scrap", isSellable: false, isSystem: true, sortNo: 3 },
  ];

  for (const loc of locations) {
    await prisma.location.upsert({ where: { name: loc.name }, update: {}, create: loc });
  }
  console.log("[seed] 仓位已就绪：主仓 / 次品区 / 报废区");
}

main()
  .catch((e) => {
    console.error("[seed] 失败：", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
