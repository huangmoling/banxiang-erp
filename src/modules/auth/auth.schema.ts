import { z } from "zod";

export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2, "请输入用户名")
    .max(32, "用户名过长")
    .regex(/^[a-zA-Z0-9_.@-]+$/, "用户名只能包含字母、数字与 _ . @ -"),
  password: z.string().min(6, "密码至少 6 位").max(72, "密码过长"),
  remember: z.boolean().optional().default(true),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(6, "请输入当前密码"),
    newPassword: z.string().min(8, "新密码至少 8 位").max(72, "密码过长"),
    confirmPassword: z.string().min(8, "请再输入一次新密码"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "两次输入的新密码不一致",
    path: ["confirmPassword"],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
