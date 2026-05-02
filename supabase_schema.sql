-- ═══════════════════════════════════════════
-- Supabase 建表 SQL
-- 在 Supabase 控制台 → SQL Editor 中执行本文件
-- ═══════════════════════════════════════════

-- 1. 工作表（sheets）表
-- 存每个 sheet 的元信息
create table if not exists public.sheets (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  "order"     int[]       not null default '{}',  -- sheet 顺序
  user_id     uuid        references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.sheets enable row level security;

-- 每个用户只能访问自己的 sheets
create policy "Users can manage own sheets"
  on public.sheets
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2. 生产记录（records）表
create table if not exists public.records (
  id                    uuid        primary key default gen_random_uuid(),
  sheet_id              uuid        references public.sheets(id) on delete cascade,
  entry_date            date,
  seq                   text,
  material_code         text,
  spec                  text,
  size                  text,
  work_order_no         text,
  positive_foil_voltage text,
  design_qty            int     default 0,
  actual_qty            int     default 0,
  winding_qty           int     default 0,
  good_qty              int     default 0,
  loss                  numeric default 0,
  first_bottom_convex_short_burst_rate numeric default 0,
  first_pass_rate       numeric default 0,
  batch_yield_rate      numeric default 0,
  defect_short          int     default 0,
  defect_burst          int     default 0,
  defect_bottom_convex  int     default 0,
  defect_voltage        int     default 0,
  defect_appearance     int     default 0,
  defect_leakage        int     default 0,
  defect_high_cap       int     default 0,
  defect_low_cap        int     default 0,
  defect_df             int     default 0,
  operator              text,
  notes                 text,
  rework_order_no       text,
  user_id               uuid references auth.users(id) on delete cascade,
  created_at            timestamptz not null default now()
);

alter table public.records enable row level security;

create policy "Users can manage own records"
  on public.records
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 3. 索引
create index if not exists idx_records_sheet_id on public.records(sheet_id);
create index if not exists idx_records_user_id on public.records(user_id);
create index if not exists idx_sheets_user_id   on public.sheets(user_id);

-- 4. 自动更新 updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_sheets_updated_at
  before update on public.sheets
  for each row
  execute function public.handle_updated_at();
