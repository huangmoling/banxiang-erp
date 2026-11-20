/**
 * 生产环境启动初始化（纯 JS，不依赖 tsx）。
 * 幂等：已存在管理员就跳过，仓位按名称 upsert。
 * 由容器 CMD 在 `prisma migrate deploy` 之后、`node server.js` 之前执行。
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();

const username = process.env.BOOTSTRAP_ADMIN_USERNAME ?? "admin";
const displayName = process.env.BOOTSTRAP_ADMIN_NAME ?? "管理员";

/**
 * 初始管理员密码。
 *
 * **绝不在代码里留默认口令**：这个系统会部署到公网服务器上，
 * 一旦忘了在 .env 里覆盖，`admin / suteng@2026` 就等于给全网留了把钥匙。
 * 没显式配置时随机生成一个，启动日志里打一次，抄下来登录后立刻改。
 */
const providedPassword = (process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "").trim();
const generatedPassword = providedPassword
  ? null
  : randomBytes(12).toString("base64url");
const password = providedPassword || generatedPassword;

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
    if (generatedPassword) {
      console.log("=".repeat(56));
      console.log(`[seed] 未配置 BOOTSTRAP_ADMIN_PASSWORD，已随机生成初始密码：`);
      console.log(`[seed]     ${generatedPassword}`);
      console.log(`[seed] 请立刻登录并修改，这个密码只在这里打印一次。`);
      console.log("=".repeat(56));
    }
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
