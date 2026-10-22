import { z } from "zod";
import { USER_ROLES, type UserRole } from "./user.types";

const username = z
  .string({ message: "请输入用户名" })
  .trim()
  .min(2, "用户名至少 2 位")
  .max(32, "用户名过长")
  .regex(/^[a-zA-Z0-9_.@-]+$/, "用户名只能包含字母、数字与 _ . @ -");

const displayName = z
  .string({ message: "请输入姓名" })
  .trim()
  .min(1, "请输入姓名")
  .max(20, "姓名过长");

const password = z
  .string({ message: "请输入密码" })
  .min(8, "密码至少 8 位")
  .max(72, "密码过长");

/** 角色清单只写在 user.types.ts 一处，这里派生——加角色不用两头改、也不会漏 */
const role = z.enum(USER_ROLES as [UserRole, ...UserRole[]], {
  message: "请选择角色",
});

export const createUserSchema = z.object({
  username,
  displayName,
  role,
  password,
});

export const updateUserSchema = z
  .object({
    displayName: displayName.optional(),
    role: role.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (v) => v.displayName !== undefined || v.role !== undefined || v.isActive !== undefined,
    { message: "没有要修改的内容" },
  );

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** 管理员重置别人密码：不需要原密码（他自己也提供不了），但至少要 8 位 */
export const resetPasswordSchema = z.object({
  newPassword: password,
});
