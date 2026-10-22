import "server-only";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatDateTime } from "@/lib/date";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { userRepository } from "./user.repository";
import type { CreateUserInput, UpdateUserInput } from "./user.schema";
import type { UserListResult, UserRow } from "./user.types";
import { toUserRole } from "./user.types";

type RawUser = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

function toRow(u: RawUser): UserRow {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: toUserRole(u.role),
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt ? formatDateTime(u.lastLoginAt.toISOString()) : null,
    createdAt: formatDateTime(u.createdAt.toISOString()),
  };
}

async function writeAudit(
  actorId: string,
  action: string,
  entityId: string,
  summary: string,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: { userId: actorId, action, entityType: "user", entityId, summary },
    });
  } catch {
    // 审计失败不阻断业务
  }
}

export const userService = {
  async list(): Promise<UserListResult> {
    const rows = await userRepository.list();
    return { items: rows.map(toRow), total: rows.length };
  },

  async create(input: CreateUserInput, actorId: string): Promise<UserRow> {
    const existed = await userRepository.findByUsername(input.username);
    if (existed) throw new ConflictError(`用户名「${input.username}」已经被占用了，换一个`);

    const passwordHash = await hashPassword(input.password);
    const created = await userRepository.create({
      username: input.username,
      displayName: input.displayName,
      role: input.role,
      passwordHash,
    });

    await writeAudit(
      actorId,
      "user.create",
      created.id,
      `新增账号「${created.displayName}」（${created.username}）`,
    );
    return toRow(created);
  },

  /**
   * 改姓名 / 角色 / 启停。
   * 这里有三道闸门，都是为了「别把自己锁在门外」：
   * 1. 不能停用自己；2. 不能降级自己；3. 不能把最后一个可用的管理员停掉或降级。
   */
  async update(id: string, input: UpdateUserInput, actorId: string): Promise<UserRow> {
    const target = await userRepository.findById(id);
    if (!target) throw new NotFoundError("找不到这个账号，可能已经被删除");

    const nextRole = input.role ?? toUserRole(target.role);
    const nextActive = input.isActive ?? target.isActive;
    const losesAdmin = toUserRole(target.role) === "admin" && (nextRole !== "admin" || !nextActive);

    if (id === actorId) {
      if (input.isActive === false) throw new ValidationError("不能停用自己的账号");
      if (input.role && nextRole !== "admin") throw new ValidationError("不能降级自己的角色");
    }

    if (losesAdmin) {
      const others = await userRepository.countActiveAdmins(id);
      if (others === 0) {
        throw new ConflictError("系统里至少要留一个能用的管理员，否则以后没人能管账号了");
      }
    }

    const updated = await userRepository.update(id, {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    });

    // 停用之后把人踢下线，不能让他开着页面继续干活
    if (input.isActive === false) await userRepository.revokeSessions(id);

    await writeAudit(
      actorId,
      "user.update",
      id,
      `修改账号「${updated.displayName}」：角色 ${nextRole}，${nextActive ? "启用" : "停用"}`,
    );
    return toRow(updated);
  },

  /** 管理员重置别人的密码：重置后该账号所有登录失效，必须用新密码重新登 */
  async resetPassword(id: string, newPassword: string, actorId: string): Promise<void> {
    const target = await userRepository.findById(id);
    if (!target) throw new NotFoundError("找不到这个账号，可能已经被删除");

    if (id === actorId) {
      throw new ForbiddenError("改自己的密码请用右下角的「修改密码」，那里需要先输入原密码");
    }

    const passwordHash = await hashPassword(newPassword);
    await userRepository.updatePassword(id, passwordHash);
    await userRepository.revokeSessions(id);

    await writeAudit(actorId, "user.reset_password", id, `重置账号「${target.displayName}」的密码`);
  },
};
