import { createClient } from '@supabase/supabase-js';

// 这两个值从 Supabase 控制台 → Settings → API 获取
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('⚠️ 未配置 Supabase 环境变量，请检查 .env.local 文件');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── 可靠性实验数据库（另一个 Supabase 项目）───
const RELIABILITY_URL = import.meta.env.VITE_RELIABILITY_URL as string;
const RELIABILITY_ANON_KEY = import.meta.env.VITE_RELIABILITY_ANON_KEY as string;

export const reliabilityDb = (RELIABILITY_URL && RELIABILITY_ANON_KEY)
  ? createClient(RELIABILITY_URL, RELIABILITY_ANON_KEY)
  : supabase;

/* ─── 独立账号隔离助手 ─────────────────────── */
/**
 * 判断当前登录账号是否为"独立账号"（test@qq.com）
 * 返回 { isIsolated: boolean, userId: string|null }
 */
export const getIsolatedUser = async (): Promise<{
  isIsolated: boolean;
  userId: string | null;
  email: string | null;
}> => {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return { isIsolated: false, userId: null, email: null };
  const isIsolated = user.email === 'test@qq.com';
  return { isIsolated, userId: user.id ?? null, email: user.email ?? null };
};

/**
 * 给查询自动加 user_id 过滤条件
 * - 独立账号：只查 user_id = 自己
 * - 其他账号：只查 user_id IS NULL（共享数据）
 */
export const applyUserFilter = (
  query: any,
  isIsolated: boolean,
  userId: string | null,
) => {
  if (isIsolated && userId) {
    return query.eq('user_id', userId);
  }
  // 非独立账号：只查 user_id IS NULL 的共享数据
  return query.is('user_id', null);
};

/**
 * 插入/更新时自动填入 user_id
 * - 独立账号：填入自己的 user_id
 * - 其他账号：不填（NULL = 共享）
 */
export const withUserId = (
  data: Record<string, unknown>,
  isIsolated: boolean,
  userId: string | null,
): Record<string, unknown> => {
  if (isIsolated && userId) {
    return { ...data, user_id: userId };
  }
  return data;
};
