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
