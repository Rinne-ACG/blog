import { useState, useEffect, useRef, useCallback } from 'react';
import { reliabilityDb } from '../lib/supabase';
import type { ReliabilityTestRecord } from '../types';

/* ─── 常量 ─── */
const TABLE = 'records' as const;

/** 表格列定义 */
interface ColumnDef {
  field: keyof ReliabilityTestRecord;
  label: string;
  colSpan?: number;
}

/** 主表头列（表格中直接展示的字段） */
const MAIN_COLUMNS: ColumnDef[] = [
  { field: 'start_time', label: '投入时间' },
  { field: 'test_no', label: '试验编号' },
  { field: 'equipment', label: '试验设备' },
  { field: 'series', label: '系列' },
  { field: 'capacity', label: '容量' },
  { field: 'voltage', label: '电压' },
  { field: 'spec', label: '规格' },
  { field: 'shelf_no', label: '排架' },
  { field: 'selected_hours', label: '试验时间选择' },
  { field: 'note', label: '备注' },
];

/** 编辑表单中额外显示的详情字段（点击编辑时才可见） */
const DETAIL_FIELDS: (keyof ReliabilityTestRecord)[] = [
  'batch_no', 'positive_foil', 'negative_foil',
  'electrolyte_paper', 'electrolyte', 'bakelite_cover',
];

/** 可选测试时间点（小时） */
const TEST_HOURS_OPTIONS = [96, 250, 500, 1000, 2000, 3000, 5000, 10000];

/** 字段中文标签映射 */
const FIELD_LABELS: Record<string, string> = {
  test_no: '试验编号',
  equipment: '试验设备',
  series: '系列',
  capacity: '容量',
  voltage: '电压',
  spec: '规格',
  batch_no: '批号',
  positive_foil: '正箔',
  negative_foil: '负箔',
  electrolyte_paper: '电解纸',
  electrolyte: '电解液',
  bakelite_cover: '电木盖',
  shelf_no: '排架',
  status: '状态',
  fail_reason: '失败原因',
  five_days: '5天数据',
  start_time: '投入时间',
  selected_hours: '试验时间选择',
  note: '备注',
};

/* ─── 格式化工具 ─── */
function formatTime(val: string | null | undefined): string {
  if (!val) return '';
  try {
    const d = new Date(val);
    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, '0');
    const D = String(d.getDate()).padStart(2, '0');
    const H = String(d.getHours()).padStart(2, '0');
    const Min = String(d.getMinutes()).padStart(2, '0');
    return `${Y}-${M}-${D} ${H}:${Min}`;
  } catch { return String(val); }
}

/** 时间调整信息（与小程序格式保持一致） */
interface TimeAdjust {
  hours: number;
  direction: 'advance' | 'delay';  // advance=提前, delay=推迟
}

/** 安全解析 time_adjust（兼容 type/direction 两种字段名） */
function parseTimeAdjust(ta: unknown): TimeAdjust | undefined {
  if (!ta) return undefined;
  let obj: Record<string, unknown>;
  if (typeof ta === 'string') {
    try { obj = JSON.parse(ta); } catch { return undefined; }
  } else {
    obj = ta as Record<string, unknown>;
  }
  const hours = typeof obj.hours === 'number' ? obj.hours : 0;
  if (hours <= 0) return undefined;
  // 兼容：优先读 direction，其次读 type
  const dir = (obj.direction as string) || (obj.type as string) || 'delay';
  return { hours, direction: dir as 'advance' | 'delay' };
}

/** 将 TimeAdjust 转为毫秒偏移量（正数=推迟，负数=提前） */
function adjustToMs(adj?: TimeAdjust | null): number {
  if (!adj || adj.hours <= 0) return 0;
  const ms = adj.hours * 3600 * 1000;
  return adj.direction === 'advance' ? -ms : ms;
}

/** 合并两个调整量，返回累加后的 TimeAdjust（用于保存） */
function combineAdjust(
  base?: TimeAdjust | null,
  extra?: TimeAdjust | null,
): TimeAdjust | undefined {
  const baseMs = adjustToMs(base);
  const extraMs = adjustToMs(extra);
  const totalMs = baseMs + extraMs;
  if (totalMs === 0) return undefined;
  const absMs = Math.abs(totalMs);
  const hours = Math.round(absMs / 3600 / 1000);
  if (hours <= 0) return undefined;
  return {
    direction: totalMs > 0 ? 'delay' : 'advance',
    hours,
  };
}

/** 根据投入时间和试验时间数组，计算当前活跃的取货时间（支持时间调整） */
function getActivePickupTime(
  startTime: string | null | undefined,
  selectedHours: unknown,
  timeAdjust?: TimeAdjust | null,
): { active: string | null; allDone: boolean } {
  if (!startTime || !Array.isArray(selectedHours) || selectedHours.length === 0) {
    return { active: null, allDone: false };
  }
  const start = new Date(startTime).getTime();
  if (isNaN(start)) return { active: null, allDone: false };

  const sorted = [...(selectedHours as number[])].sort((a, b) => a - b);
  const now = Date.now();
  const ms = adjustToMs(timeAdjust);

  for (const h of sorted) {
    const pickupMs = start + h * 3600 * 1000 + ms;
    if (isNaN(pickupMs)) continue;
    const pickupTime = new Date(pickupMs);
    if (isNaN(pickupTime.getTime())) continue;
    if (pickupTime.getTime() > now) {
      return { active: pickupTime.toISOString(), allDone: false };
    }
  }
  const lastH = sorted[sorted.length - 1];
  const lastMs = start + lastH * 3600 * 1000 + ms;
  if (isNaN(lastMs)) return { active: null, allDone: false };
  const lastPickup = new Date(lastMs);
  if (isNaN(lastPickup.getTime())) return { active: null, allDone: false };
  return { active: lastPickup.toISOString(), allDone: true };
}

/** 获取记录的取货时间毫秒数（用于排序，无取货时间返回 Infinity） */
function getPickupTimeMs(r: ReliabilityTestRecord): number {
  const ta = parseTimeAdjust(r.time_adjust);
  const { active } = getActivePickupTime(r.start_time, r.selected_hours, ta);
  if (!active) return Infinity;
  const ms = new Date(active).getTime();
  return isNaN(ms) ? Infinity : ms;
}

/** 计算所有取货时间点（含调整前后对比，用于预览）
 *  original: 原始取货时间（无调整）
 *  adjusted: 应用 timeAdjust 后的取货时间
 */
function getPickupPreview(
  startTime: string | null | undefined,
  selectedHours: unknown,
  timeAdjust?: TimeAdjust | null,
): { hour: number; original: string; adjusted: string; isExpired: boolean }[] {
  if (!startTime || !Array.isArray(selectedHours) || selectedHours.length === 0) return [];
  const start = new Date(startTime).getTime();
  if (isNaN(start)) return [];

  const sorted = [...(selectedHours as number[])].sort((a, b) => a - b);
  const now = Date.now();
  const ms = adjustToMs(timeAdjust);

  return sorted.map(h => {
    const baseMs = start + h * 3600 * 1000;
    // 安全保护：baseMs 无效时跳过
    if (isNaN(baseMs)) return null;
    const original = new Date(baseMs);
    const adjusted = new Date(baseMs + ms);
    if (isNaN(original.getTime()) || isNaN(adjusted.getTime())) return null;
    return {
      hour: h,
      original: original.toISOString(),
      adjusted: adjusted.toISOString(),
      isExpired: adjusted.getTime() <= now,
    };
  }).filter(Boolean) as { hour: number; original: string; adjusted: string; isExpired: boolean }[];
}

/* ─── Toast 提示组件 ─── */
function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 2500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`fixed top-4 right-4 z-[100] px-5 py-3 rounded-xl shadow-lg text-sm font-medium ${type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
      {type === 'success' ? '✅' : '❌'} {msg}
    </div>
  );
}

/* ─── 筛选下拉组件 ─── */
function FilterDropdown({
  uniqueVals, selected, onChange, onClose,
}: {
  uniqueVals: string[];
  selected: Set<string>;
  onChange: (key: string, vals: Set<string>) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = search
    ? uniqueVals.filter(v => v.toLowerCase().includes(search.toLowerCase()))
    : [...uniqueVals];
  const allSelected = filtered.length > 0 && filtered.every(v => selected.has(v));

  const toggleAll = () => {
    if (allSelected) {
      const next = new Set(selected);
      filtered.forEach(v => next.delete(v));
      onChange('filter', next);
    } else {
      onChange('filter', new Set([...selected, ...filtered]));
    }
  };

  const toggleOne = (val: string) => {
    const next = new Set(selected);
    if (next.has(val)) next.delete(val); else next.add(val);
    onChange('filter', next);
  };

  return (
    <div className="flex flex-col h-full">
      <input
        autoFocus value={search} onChange={e => setSearch(e.target.value)}
        placeholder="搜索..."
        className="px-3 py-2 text-xs border-b border-gray-200 focus:outline-none"
        onClick={e => e.stopPropagation()}
      />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
        <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-gray-600">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-3.5 h-3.5 accent-emerald-600" />
          全选
        </label>
      </div>
      <ul className="flex-1 overflow-y-auto p-1.5 space-y-0.5" onClick={e => e.stopPropagation()}>
        {filtered.map(v => (
          <li key={v || '(空)'}>
            <label className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-xs transition-colors ${selected.has(v) ? 'bg-emerald-50 text-emerald-700' : 'text-gray-600'}`}>
              <input type="checkbox" checked={selected.has(v)} onChange={() => toggleOne(v)} className="w-3.5 h-3.5 accent-emerald-600" />
              <span className="truncate">{v || '<空>'}</span>
            </label>
          </li>
        ))}
        {filtered.length === 0 && <li className="text-center text-xs text-gray-300 py-4">无匹配项</li>}
      </ul>
      <div className="flex justify-end gap-2 p-2 border-t border-gray-200" onClick={e => e.stopPropagation()}>
        <button onClick={() => { onChange('filter', new Set()); }} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">清空</button>
        <button onClick={onClose} className="px-3 py-1.5 text-xs bg-slate-800 text-white rounded-md hover:bg-slate-700">确定</button>
      </div>
    </div>
  );
}

interface UpcomingItem {
  record: ReliabilityTestRecord;
  pickupMs: number;
  pickupTime: string;
}

export default function ReliabilityTestPage() {
  /* ─── State ─── */
  const [records, setRecords] = useState<ReliabilityTestRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // 弹窗
  const [showForm, setShowForm] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ReliabilityTestRecord | null>(null);
  // 编辑时：基准调整值（已有调整），保存时与 formData.time_adjust 累加
  const [baseTimeAdjust, setBaseTimeAdjust] = useState<TimeAdjust | undefined>(undefined);
  const [formData, setFormData] = useState<Partial<ReliabilityTestRecord>>({});
  const [formLoading, setFormLoading] = useState(false);

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<ReliabilityTestRecord | null>(null);

  // Toast
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // 筛选 & 排序
  const [filterValues, setFilterValues] = useState<Record<string, Set<string>>>({});
  const [openFilterField, setOpenFilterField] = useState<string | null>(null);
  const [filterPos, setFilterPos] = useState<{ top: number; left: number } | null>(null);
  const [sortField, setSortField] = useState<keyof ReliabilityTestRecord | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // 搜索
  const [searchText, setSearchText] = useState('');

  // 分页
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  // Refs
  const filterRef = useRef<HTMLDivElement>(null);

  /* ─── Toast ─── */
  const showToast = useCallback((msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
  }, []);

  /* ─── 点击外部关闭筛选 ─── */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (openFilterField && filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setOpenFilterField(null);
        setFilterPos(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openFilterField]);

  /* ─── 加载数据 ─── */
  const loadRecords = async () => {
    setLoading(true);
    try {
      const { data, error } = await reliabilityDb.from(TABLE).select('*').order('create_time', { ascending: false });
      if (error) throw error;

      // 自动更新状态：所有取货时间已过 → status = '已完成'
      const toUpdate: string[] = [];
      (data || []).forEach(r => {
        if (r.status === '已完成') return;
        const ta = parseTimeAdjust(r.time_adjust);
        const { allDone } = getActivePickupTime(r.start_time, r.selected_hours, ta);
        if (allDone) toUpdate.push(r.id);
      });

      if (toUpdate.length > 0) {
        const { error: updError } = await reliabilityDb
          .from(TABLE)
          .update({ status: '已完成', update_time: new Date().toISOString() })
          .in('id', toUpdate);
        if (updError) console.warn('自动更新状态失败:', updError.message);
        // 重新加载最新数据
        const { data: refreshed, error: refError } = await reliabilityDb
          .from(TABLE).select('*').order('create_time', { ascending: false });
        if (refError) throw refError;
        setRecords(refreshed || []);
      } else {
        setRecords(data || []);
      }
    } catch (err) {
      console.error('加载可靠性实验数据失败:', err);
      showToast('加载数据失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRecords(); }, []);

  /* ─── 即将取货数据（现在 ~ 3天后） ─── */
  const nowMs = Date.now();
  const threeDaysLaterMs = nowMs + 3 * 86400000;

  const upcomingPickups: UpcomingItem[] = (() => {
    return records
      .map(r => {
        const ta = parseTimeAdjust(r.time_adjust);
        const pickup = getActivePickupTime(r.start_time, r.selected_hours, ta);
        if (!pickup.active) return null;
        const ms = new Date(pickup.active).getTime();
        if (isNaN(ms) || ms < nowMs || ms > threeDaysLaterMs) return null;
        return { record: r, pickupMs: ms, pickupTime: pickup.active as string };
      })
      .filter(Boolean as any)
      .sort((a, b) => a.pickupMs - b.pickupMs);
  })();

  /* ─── 筛选 + 排序 + 搜索 ─── */
  const filteredAndSorted = (() => {
    let list = [...records];

    // 文字搜索
    if (searchText.trim()) {
      const kw = searchText.trim().toLowerCase();
      list = list.filter(r =>
        Object.entries(r).some(([k, v]) =>
          k !== 'id' && k !== 'selected_hours' && k !== 'time_adjust' &&
          typeof v === 'string' && v.toLowerCase().includes(kw))
      );
    }

    // 列筛选
    for (const [field, vals] of Object.entries(filterValues)) {
      if (vals.size > 0) {
        list = list.filter(r => vals.has(String((r as unknown as Record<string, unknown>)[field] ?? '')));
      }
    }

    // 排序：默认按取货时间升序（最近的在前），用户手动排序时优先用用户选择
    if (sortField) {
      list.sort((a, b) => {
        const va = a[sortField], vb = b[sortField];
        if (va == null && vb == null) return 0;
        if (va == null) return sortDir === 'asc' ? -1 : 1;
        if (vb == null) return sortDir === 'asc' ? 1 : -1;
        const sa = String(va), sb = String(vb);
        return sortDir === 'asc' ? sa.localeCompare(sb, 'zh') : sb.localeCompare(sa, 'zh');
      });
    } else {
      // 默认：按取货时间升序（最近的在前）
      list.sort((a, b) => getPickupTimeMs(a) - getPickupTimeMs(b));
    }

    return list;
  })();

  // 分页数据
  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / PAGE_SIZE));
  const paginatedData = filteredAndSorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // 获取某字段唯一值（用于筛选）
  const getUniqueVals = (field: keyof ReliabilityTestRecord): string[] =>
    [...new Set(records.map(r => String((r[field] ?? '')).trim())].sort((a, b) => a.localeCompare(b, 'zh'));

  /* ─── 排序 ─── */
  const handleSort = (field: keyof ReliabilityTestRecord) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  /* ─── 新增 ─── */
  const openAddForm = () => {
    setEditingRecord(null);
    setBaseTimeAdjust(undefined);
    setFormData({ selected_hours: [] });
    setShowForm(true);
  };

  /* ─── 编辑 ─── */
  const openEditForm = (r: ReliabilityTestRecord) => {
    setEditingRecord(r);
    // 已有调整存入 baseTimeAdjust（不显示在表单上）
    const parsedTA = parseTimeAdjust(r.time_adjust);
    setBaseTimeAdjust(parsedTA || undefined);
    // 表单 time_adjust 清空，等待用户输入新增调整量
    setFormData({ ...r, time_adjust: undefined });
    setShowForm(true);
  };

  /* ─── 保存 ─── */
  const handleSaveRecord = async () => {
    if (!formData.series) {
      showToast('系列不能为空', 'error');
      return;
    }

    setFormLoading(true);
    try {
      const now = new Date().toISOString();
      // 保存时：合并已有调整 + 本次新增调整
      const finalTimeAdjust = combineAdjust(baseTimeAdjust || undefined, formData.time_adjust as TimeAdjust | undefined);

      const row: Record<string, unknown> = {
        test_no: formData.test_no || '',
        equipment: formData.equipment || '',
        series: formData.series || '',
        capacity: formData.capacity || '',
        voltage: formData.voltage || '',
        spec: formData.spec || '',
        five_days: formData.five_days || '',
        note: formData.note || '',
        batch_no: formData.batch_no || '',
        positive_foil: formData.positive_foil || '',
        negative_foil: formData.negative_foil || '',
        electrolyte_paper: formData.electrolyte_paper || '',
        electrolyte: formData.electrolyte || '',
        bakelite_cover: formData.bakelite_cover || '',
        status: formData.status || 'active',
        fail_reason: formData.fail_reason || '',
        shelf_no: formData.shelf_no || '',
        start_time: formData.start_time || now,
        selected_hours: formData.selected_hours || [],
        time_adjust: finalTimeAdjust || null,
      };

      if (editingRecord) {
        row.update_time = now;
        const { error } = await reliabilityDb.from(TABLE).update(row).eq('id', editingRecord.id);
        if (error) throw error;
        setRecords(prev => prev.map(r => r.id === editingRecord.id ? { ...r, ...row } as ReliabilityTestRecord : r));
        showToast('已更新', 'success');
      } else {
        row.create_time = now;
        row.update_time = now;
        const { data, error } = await reliabilityDb.from(TABLE).insert(row).select().single();
        if (error) throw error;
        setRecords(prev => [{ id: data.id, ...row } as ReliabilityTestRecord, ...prev]);
        showToast('已新增', 'success');
      }
      setShowForm(false);
    } catch (err) {
      console.error('保存失败:', err);
      showToast(editingRecord ? '保存失败' : '新增失败', 'error');
    } finally {
      setFormLoading(false);
    }
  };

  /* ─── 删除 ─── */
  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const { error } = await reliabilityDb.from(TABLE).delete().eq('id', deleteTarget.id);
      if (error) throw error;
      setRecords(prev => prev.filter(r => r.id !== deleteTarget.id));
      showToast('已删除', 'success');
    } catch {
      showToast('删除失败', 'error');
    } finally {
      setDeleteTarget(null);
    }
  };

  /* ─── 双击编辑 ─── */
  const [doubleClickTimer, setDoubleClickTimer] = useState<NodeJS.Timeout | null>(null);
  const [lastClickId, setLastClickId] = useState<string | null>(null);
  const handleRowClick = (r: ReliabilityTestRecord) => {
    if (lastClickId === r.id && doubleClickTimer) {
      clearTimeout(doubleClickTimer);
      setDoubleClickTimer(null);
      setLastClickId(null);
      openEditForm(r);
      return;
    }
    if (doubleClickTimer) clearTimeout(doubleClickTimer);
    setLastClickId(r.id);
    setDoubleClickTimer(setTimeout(() => {
      setDoubleClickTimer(null);
      setLastClickId(null);
    }, 280));
  };

  /* ─── Excel 导入导出 ─── */
  const handleExportExcel = async () => {
    const XLSX = await import('xlsx');
    const exportData = filteredAndSorted.map(r => {
      const row: Record<string, unknown> = {};
      MAIN_COLUMNS.forEach(col => {
        row[col.label] = col.field === 'start_time'
          ? formatTime(r[col.field])
          : (r[col.field] ?? '');
      });
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    ws['!cols'] = MAIN_COLUMNS.map(() => ({ wch: 14 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '可靠性实验记录');
    XLSX.writeFile(wb, `可靠性实验记录_${new Date().toLocaleDateString()}.xlsx`);
    showToast(`导出 ${exportData.length} 条`, 'success');
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    try {
      const XLSX = await import('xlsx');
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws);

      if (rows.length === 0) {
        showToast('Excel 中没有数据', 'error');
        return;
      }

      const reverseLabels: Record<string, string> = {};
      Object.entries(FIELD_LABELS).forEach(([en, zh]) => {
        reverseLabels[zh] = en;
      });

      const now = new Date().toISOString();
      let added = 0;

      for (const raw of rows) {
        const mapped: Partial<ReliabilityTestRecord> = {};
        for (const [label, val] of Object.entries(raw)) {
          if (!val || (typeof val === 'string' && !val.trim())) continue;
          const cleanVal = String(val).trim();
          const key = reverseLabels[label] || (label in FIELD_LABELS ? label : null);
          if (key) {
            (mapped as Record<string, unknown>)[key] = cleanVal;
          }
        }

        if (!mapped.series) continue;

        (mapped as Record<string, unknown>).create_time = now;
        (mapped as Record<string, unknown>).update_time = now;
        (mapped as Record<string, unknown>).status ||= 'active';
        ((mapped as Record<string, unknown>).start_time as string) ||= now.split('T')[0];

        const { error } = await reliabilityDb.from(TABLE).insert(mapped);
        if (error) {
          console.warn('导入跳过:', error.message, mapped);
          continue;
        }
        added++;
      }

      if (added > 0) {
        await loadRecords();
        showToast(`导入成功 ${added} 条`, 'success');
      } else {
        showToast('未导入任何数据，请检查 Excel 列名是否正确', 'error');
      }
    } catch (err) {
      console.error('导入错误:', err);
      showToast(`导入失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  /* ─── 渲染 ─── */
  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 max-w-[1600px] mx-auto" ref={filterRef}>

      {/* 页面标题 */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          🧪 可靠性实验统计
          {!loading && <span className="text-xs font-normal text-gray-400 ml-1">({filteredAndSorted.length} 条)</span>}
        </h1>

        {/* 操作按钮 */}
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors shadow-sm">
            导出 Excel
          </button>
          <label className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors cursor-pointer shadow-sm">
            导入 Excel
            <input type="file" accept=".xlsx,.xls,.csv" hidden onChange={handleImportExcel} />
          </label>
          <button onClick={openAddForm}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 shadow-sm">
            新增记录
          </button>
        </div>
      </div>

      {/* ─── 即将取货提醒卡片 ─── */}
      {!loading && upcomingPickups.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-bold text-amber-700 mb-2 flex items-center gap-1.5">
            ⏰ 即将取货（未来3天内）
            <span className="text-xs font-normal text-amber-500 bg-amber-50 px-2 py-0.5 rounded-full">{upcomingPickups.length} 条</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {upcomingPickups.map(item => {
              const r = item.record;
              const hoursLeft = Math.ceil((item.pickupMs - nowMs) / 3600000);
              const isUrgent = hoursLeft <= 24;
              return (
                <div
                  key={r.id}
                  className={`rounded-xl border shadow-sm p-3 transition-colors cursor-pointer hover:shadow-md ${
                    isUrgent
                      ? 'bg-red-50 border-red-200 hover:bg-red-100'
                      : 'bg-amber-50 border-amber-200 hover:bg-amber-100'
                  }`}
                  onClick={() => openEditForm(r)}
                >
                  {/* 顶部：状态和紧急程度 */}
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      isUrgent ? 'bg-red-500 text-white' : 'bg-amber-400 text-amber-900'
                    }`}>
                      {isUrgent ? '🔥 紧急' : '⏳ 即将'}
                    </span>
                    <span className="text-xs text-gray-400">
                      {hoursLeft <= 0 ? '已到期' : hoursLeft < 24 ? `${hoursLeft}H后` : `${Math.ceil(hoursLeft / 24)}天后`}
                    </span>
                  </div>

                  {/* 核心信息 */}
                  <div className="space-y-0.5 text-xs">
                    <p className="font-bold text-gray-800 truncate" title={r.series || ''}>
                      📦 {r.series || '-'}
                    </p>
                    <p className="text-gray-600 truncate" title={r.spec || ''}>
                      📐 规格：{r.spec || '-'}
                    </p>
                    {r.batch_no && (
                      <p className="text-gray-500 truncate" title={r.batch_no}>
                        🏷️ 批号：{r.batch_no}
                      </p>
                    )}
                    {r.shelf_no && (
                      <p className="text-gray-500 truncate">
                        📍 排架：{r.shelf_no}
                      </p>
                    )}
                  </div>

                  {/* 取货时间（最重要） */}
                  <div className={`mt-2 pt-2 border-t border-dashed text-xs font-medium ${
                    isUrgent ? 'border-red-200 text-red-700' : 'border-amber-200 text-amber-700'
                  }`}>
                    🕐 取货时间：{formatTime(item.pickupTime)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 搜索栏 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 mb-4 flex items-center gap-3">
        <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input
          type="text"
          value={searchText}
          onChange={e => { setSearchText(e.target.value); setPage(1); }}
          placeholder="搜索系列、规格、批号、货架号等任意字段..."
          className="flex-1 min-w-0 px-3 py-2 border-0 focus:outline-none text-sm bg-transparent"
        />
        {searchText && (
          <button onClick={() => setSearchText('')} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
            ✕
          </button>
        )}
      </div>

      {/* 主内容 */}
      {loading ? (
        <div className="flex justify-center items-center py-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-600" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* 数据表格 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-700 text-white">
                    <th className="px-3 py-2 text-left font-semibold text-xs whitespace-nowrap border-r border-slate-500 sticky left-0 bg-slate-700 z-10">操作</th>
                    {MAIN_COLUMNS.map(col => (
                      <th
                        key={col.field}
                        className="px-2 py-2 text-left font-semibold text-xs whitespace-nowrap border-r border-slate-500 cursor-pointer select-none relative"
                        onClick={() => handleSort(col.field)}
                      >
                        <div className="flex items-center gap-1">
                          <span>{col.label}</span>
                          <button
                            className={`p-0.5 rounded hover:bg-slate-600 ${filterValues[col.field]?.size ? 'text-amber-400' : 'text-slate-300'}`}
                            onClick={e => { e.stopPropagation(); const btn = e.currentTarget; const r = btn.getBoundingClientRect(); setOpenFilterField(openFilterField === col.field ? null : col.field); setFilterPos({ top: r.bottom + 4, left: r.left }); }}
                          >
                            ▲
                          </button>
                          {sortField === col.field && <span className="text-xs">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                          {openFilterField === col.field && (
                            <div className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-2xl w-52"
                              style={{ top: filterPos?.top ?? 0, left: filterPos?.left ?? 0 }}
                              onClick={e => e.stopPropagation()}
                            >
                              <FilterDropdown
                                uniqueVals={getUniqueVals(col.field)}
                                selected={filterValues[col.field] ?? new Set()}
                                onChange={(f, s) => setFilterValues(prev => ({ ...prev, [f]: s }))}
                                onClose={() => { setOpenFilterField(null); setFilterPos(null); }}
                              />
                            </div>
                          )}
                        </div>
                      </th>
                    ))}
                    <th className="px-2 py-2 text-left font-semibold text-xs whitespace-nowrap border-r border-slate-500">
                      取货时间
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedData.length > 0 ? paginatedData.map(r => (
                    <tr key={r.id}
                      className="border-b border-gray-100 hover:bg-slate-50 transition-colors cursor-pointer"
                      onClick={() => handleRowClick(r)}
                    >
                      <td className="px-3 py-1.5 whitespace-nowrap sticky left-0 bg-white z-10" onClick={e => e.stopPropagation()}>
                        <button onClick={() => openEditForm(r)}
                          className="text-emerald-600 hover:text-emerald-700 text-xs mr-2 font-medium">编辑</button>
                        <button onClick={() => setDeleteTarget(r)}
                          className="text-red-500 hover:text-red-700 text-xs font-medium">删除</button>
                      </td>
                      {MAIN_COLUMNS.map(col => {
                        const rawVal = r[col.field];
                        let display: string;
                        if (col.field === 'start_time') {
                          display = formatTime(rawVal as string | null | undefined);
                        } else if (col.field === 'five_days') {
                          display = rawVal ? String(rawVal) : '-';
                        } else if (col.field === 'selected_hours') {
                          display = Array.isArray(rawVal) ? (rawVal as number[]).map(v => `${v}H`).join(', ') : '-';
                        } else {
                          display = rawVal == null ? '-' : String(rawVal);
                        }
                        return (
                          <td key={col.field}
                            className={`px-2 py-1.5 text-gray-700 whitespace-nowrap text-center`}
                          >{display}</td>
                        );
                      })}
                      <td className={`px-2 py-1.5 text-center text-xs font-medium ${
                        (() => {
                          const ta = parseTimeAdjust(r.time_adjust);
                          const pickup = getActivePickupTime(r.start_time, r.selected_hours, ta);
                          if (!pickup.active) return 'text-gray-400';
                          if (pickup.allDone) return 'text-gray-400';
                          return new Date(pickup.active).getTime() - Date.now() < 86400000 ? 'text-red-600' : 'text-emerald-700';
                        })()
                      }`}>
                        {(() => {
                          const ta = parseTimeAdjust(r.time_adjust);
                          const pickup = getActivePickupTime(r.start_time, r.selected_hours, ta);
                          if (!pickup.active) return '-';
                          const txt = formatTime(pickup.active);
                          return pickup.allDone ? `${txt}（已到期）` : txt;
                        })()}
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={MAIN_COLUMNS.length + 1} className="px-6 py-16 text-center text-gray-400 text-sm">暂无数据</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <span className="text-xs text-gray-500">
                  第 {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filteredAndSorted.length)} 条 / 共 {filteredAndSorted.length} 条
                </span>
                <div className="flex items-center gap-1.5">
                  <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
                    className="px-3 py-1.5 text-xs border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">上一页</button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                    .map((p, i, arr) => (
                      <span key={p} className="flex items-center">
                        {i > 0 && arr[i - 1] !== p - 1 && <span className="text-gray-300 mx-1">...</span>}
                        <button onClick={() => setPage(p)}
                          className={`w-8 h-8 text-xs rounded-md font-medium transition-colors ${p === page ? 'bg-slate-700 text-white' : 'hover:bg-gray-100 text-gray-600'}`}>{p}</button>
                      </span>
                    ))}
                  <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    className="px-3 py-1.5 text-xs border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">下一页</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── 新增/编辑弹窗 ─── */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between rounded-t-2xl z-10">
              <h2 className="text-base font-bold text-gray-800">
                {editingRecord ? '✏️ 编辑记录' : '➕ 新增记录'}
              </h2>
              <button onClick={() => setShowForm(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* 主字段 */}
              <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                {MAIN_COLUMNS.map(col => {
                  const field = col.field;
                  return (
                    <div key={field}>
                      <label className="block text-xs font-medium text-gray-600 mb-1">{FIELD_LABELS[field] || field}</label>
                      {field === 'note' ? (
                        <textarea
                          value={(formData as Record<string, unknown>)[field] as string || ''} onChange={e => setFormData(p => ({ ...p, [field]: e.target.value }))}
                          rows={2} placeholder={`${FIELD_LABELS[field] || field}（可选）`}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-none"
                        />
                      ) : field === 'start_time' ? (
                        <input
                          type="datetime-local"
                          value={
                            ((formData as Record<string, unknown>)[field] as string)?.slice(0, 16)
                              || new Date().toISOString().slice(0, 16)
                          }
                          onChange={e => setFormData(p => ({ ...p, [field]: e.target.value }))}
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                        />
                      ) : field === 'selected_hours' ? (
                        <div className="flex flex-wrap gap-2">
                          {TEST_HOURS_OPTIONS.map(h => {
                            const selected = Array.isArray(formData.selected_hours)
                              ? (formData.selected_hours as number[]).includes(h)
                              : false;
                            return (
                              <label
                                key={h}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm cursor-pointer transition-colors ${selected ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}
                              >
                                <input
                                  type="checkbox"
                                  className="sr-only"
                                  checked={selected}
                                  onChange={() => {
                                    const curr = Array.isArray(formData.selected_hours)
                                      ? [...(formData.selected_hours as number[])]
                                      : [];
                                    if (selected) {
                                      setFormData(p => ({ ...p, selected_hours: curr.filter(v => v !== h) }));
                                    } else {
                                      setFormData(p => ({ ...p, selected_hours: [...curr, h] }));
                                    }
                                  }}
                                />
                                <span className="text-xs">{h}H</span>
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={(formData as Record<string, unknown>)[field] as string || ''}
                          onChange={e => setFormData(p => ({ ...p, [field]: e.target.value }))}
                          placeholder={`输入${FIELD_LABELS[field] || field}`}
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* ─── 时间调整（可选，整体调整所有提醒时间）─── */}
              <div className="border-t border-gray-200 pt-4">
                <label className="block text-xs font-semibold text-gray-700 mb-2">时间调整（可选，整体调整所有提醒时间）</label>
                {(() => {
                  // baseTA：已有调整（编辑模式从 baseTimeAdjust 读取，新增模式为 undefined）
                  const baseTA = editingRecord ? baseTimeAdjust : undefined;
                  const hasBase = baseTA && baseTA.hours > 0;

                  // newTA：本次表单输入的新增调整量
                  const newTA = (formData.time_adjust || {}) as TimeAdjust;
                  const newDir = newTA.direction || 'delay';
                  const newHours = newTA.hours || 0;

                  // 预览：原始时间 → 合并后（base + new）的时间
                  const preview = getPickupPreview(
                    (formData as Record<string, unknown>).start_time as string,
                    formData.selected_hours,
                    combineAdjust(baseTA, newTA) || undefined,
                  );

                  // 快捷按钮：在新增调整量上累加
                  const applyExtra = (h: number) => {
                    const nextHours = newHours + h;
                    setFormData(p => ({
                      ...p,
                      time_adjust: { direction: newDir, hours: nextHours },
                    }));
                  };

                  // 切换提前/推迟
                  const switchDir = (t: 'advance' | 'delay') => {
                    setFormData(p => ({
                      ...p,
                      time_adjust: { ...(p.time_adjust || {}), direction: t },
                    }));
                  };

                  // 手动输入小时数（替换新增量）
                  const setNewHours = (val: number) => {
                    setFormData(p => ({
                      ...p,
                      time_adjust: { ...(p.time_adjust || {}), direction: newDir, hours: val },
                    }));
                  };

                  return (
                    <div className="space-y-3">
                      {/* 已有调整提示（编辑模式，不显示具体数值，只提示有调整） */}
                      {hasBase && (
                        <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5 inline-flex items-center gap-1">
                          ⚠️ 该记录已有时间调整，本次输入将在其基础上累加
                        </div>
                      )}

                      {/* 提前/推迟 + 小时输入 */}
                      <div className="flex items-center gap-3">
                        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => switchDir('advance')}
                            className={`px-4 py-2 text-xs font-medium flex items-center gap-1 transition-colors ${
                              newDir === 'advance'
                                ? 'bg-sky-500 text-white'
                                : 'bg-white text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            提前
                          </button>
                          <button
                            type="button"
                            onClick={() => switchDir('delay')}
                            className={`px-4 py-2 text-xs font-medium flex items-center gap-1 transition-colors border-l border-gray-200 ${
                              newDir === 'delay'
                                ? 'bg-sky-500 text-white'
                                : 'bg-white text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            推迟
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            value={newHours || ''}
                            onChange={e => setNewHours(parseInt(e.target.value) || 0)}
                            placeholder="0"
                            className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-sky-300"
                          />
                          <span className="text-xs text-gray-500">小时（本次新增）</span>
                        </div>
                      </div>

                      {/* 调整预览 */}
                      {preview.length > 0 && newHours > 0 && (
                        <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
                          <p className="text-xs text-gray-400 font-medium">
                            调整预览：原始时间 → 累加后时间
                            {hasBase && (
                              <span className="ml-1 text-amber-500">
                                （已有调整 {baseTA!.direction === 'advance' ? '提前' : '推迟'}{baseTA!.hours}H）
                              </span>
                            )}
                          </p>
                          {preview.map(item => (
                            <div key={item.hour} className="flex items-center gap-2 text-xs">
                              <span className="font-medium text-gray-600 w-12">{item.hour}H</span>
                              <span className="text-gray-400 line-through">{formatTime(item.original)}</span>
                              <span className="text-gray-300">→</span>
                              <span className={item.isExpired ? 'text-gray-400' : 'text-red-500 font-medium'}>
                                {formatTime(item.adjusted)}
                                {item.isExpired ? '（已到期）' : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 快捷按钮：累加 */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {([24, 48, 72, 168] as const).map(h => (
                          <button
                            key={h}
                            type="button"
                            onClick={() => applyExtra(h)}
                            className="px-2.5 py-1 text-xs border border-gray-200 rounded-md hover:bg-gray-50 text-gray-600 transition-colors"
                          >
                            +{h}H（累计）
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setFormData(p => ({ ...p, time_adjust: undefined }))}
                          className="px-3 py-1 text-xs border border-orange-200 text-orange-600 rounded-md hover:bg-orange-50 transition-colors"
                        >
                          清除本次调整
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* 详情字段分隔线 */}
              <div className="border-t border-gray-200 pt-4">
                <p className="text-xs text-gray-400 mb-3 font-medium">以下为详情字段（点击编辑时查看）</p>
                <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                  {DETAIL_FIELDS.map(field => (
                    <div key={field}>
                      <label className="block text-xs font-medium text-gray-600 mb-1">{FIELD_LABELS[field] || field}</label>
                      <input
                        type="text"
                        value={(formData as Record<string, unknown>)[field] as string || ''}
                        onChange={e => setFormData(p => ({ ...p, [field]: e.target.value }))}
                        placeholder={`输入${FIELD_LABELS[field] || field}`}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* 状态/失败原因/5天数据 */}
              <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                {['status', 'fail_reason', 'five_days'].map(field => (
                  <div key={field}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{FIELD_LABELS[field] || field}</label>
                    <input
                      type="text"
                      value={(formData as Record<string, unknown>)[field] as string || ''}
                      onChange={e => setFormData(p => ({ ...p, [field]: e.target.value }))}
                      placeholder={`输入${FIELD_LABELS[field] || field}`}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="sticky bottom-0 bg-gray-50 px-6 py-4 flex justify-end gap-3 rounded-b-2xl border-t border-gray-100">
              <button onClick={() => setShowForm(false)}
                className="px-5 py-2.5 border border-gray-300 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors">
                取消
              </button>
              <button onClick={handleSaveRecord} disabled={formLoading}
                className="px-6 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 shadow-sm disabled:opacity-50 flex items-center gap-2">
                {formLoading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                {editingRecord ? '保存修改' : '确认新增'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 删除确认弹窗 ─── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-2">⚠️ 确认删除</h3>
            <p className="text-sm text-gray-600 mb-1">确认删除以下记录？此操作不可撤销。</p>
            <p className="text-xs bg-red-50 text-red-700 px-3 py-2 rounded-lg mb-5 break-all">
              {deleteTarget.series} | {deleteTarget.spec} | 批号: {deleteTarget.batch_no}
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-100">取消</button>
              <button onClick={handleDelete}
                className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600">确认删除</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
