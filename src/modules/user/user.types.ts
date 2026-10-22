/** 账号管理前后端共享类型（不含服务端依赖，客户端组件可直接引用） */

export type UserRole = "admin" | "manager" | "keeper" | "viewer";

export const USER_ROLES: UserRole[] = ["admin", "manager", "keeper", "viewer"];

export const USER_ROLE_LABEL: Record<UserRole, string> = {
  admin: "管理员",
  manager: "店长",
  keeper: "仓管",
  viewer: "查看",
};

/** 每个角色能干什么，直接写在界面上——省得每次加人都要问一遍「给他开什么」 */
export const USER_ROLE_HINT: Record<UserRole, string> = {
  admin: "全部权限，包括账号管理、红冲、改别人的密码",
  manager: "开单、审核、红冲、看报表，不能管账号",
  keeper: "开单、审核（入库 / 出库 / 盘点 / 处置），不能红冲、不能管账号",
  viewer: "只能看，不能开单也不能审核",
};

export const USER_ROLE_TONE: Record<UserRole, string> = {
  admin: "bg-brand-soft text-brand",
  manager: "bg-[#eef4ee] text-[#3f7a4a]",
  keeper: "bg-[#fdf4e8] text-[#a15f12]",
  viewer: "bg-[#f2f4f7] text-muted",
};

export function toUserRole(value: string | null | undefined): UserRole {
  return value === "admin" || value === "manager" || value === "keeper" ? value : "viewer";
}

export type UserRow = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  /** YYYY-MM-DD HH:mm；从没登录过为 null */
  lastLoginAt: string | null;
  createdAt: string;
};

export type UserListResult = {
  items: UserRow[];
  total: number;
};
