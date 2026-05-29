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

/** 主表头列（不含系统字段） */
const MAIN_COLUMNS: ColumnDef[] = [
  { field: 'series', label: '系列' },
  { field: 'capacity', label: '容量' },
  { field: 'voltage', label: '电压' },
  { field: 'spec', label: '规格' },
  { field: 'batch_no', label: '批号' },
  { field: 'positive_foil', label: '正箔' },
  { field: 'negative_foil', label: '负箔' },
  { field: 'electrolyte_paper', label: '电解纸' },
  { field: 'electrolyte', label: '电解液' },
  { field: 'bakelite_cover', label: '酚醛盖板' },
  { field: 'shelf_no', label: '货架号' },
  { field: 'status', label: '状态' },
  { field: 'fail_reason', label: '失败原因' },
  { field: 'five_days', label: '5天数据' },
  { field: 'start_time', label: '开始时间' },
  { field: 'note', label: '备注' },
];

/** 表单字段（排除系统字段和 JSON 字段） */
const FORM_FIELDS: (keyof ReliabilityTestRecord)[] = [
  'series', 'capacity', 'voltage', 'spec', 'batch_no',
  'positive_foil', 'negative_foil', 'electrolyte_paper',
  'electrolyte', 'bakelite_cover', 'shelf_no',
  'status', 'fail_reason', 'five_days', 'start_time', 'note',
];

/** 字段中文标签映射 */
const FIELD_LABELS: Record<string, string> = {
  series: '系列',
  capacity: '容量',
  voltage: '电压',
  spec: '规格',
  batch_no: '批号',
  positive_foil: '正箔',
  negative_foil: '负箔',
  electrolyte_paper: '电解纸',
  electrolyte: '电解液',
  bakelite_cover: '酚醛盖板',
  shelf_no: '货架号',
  status: '状态',
  fail_reason: '失败原因',
  five_days: '5天数据',
  start_time: '开始时间',
  note: '备注',
};

/* ─── 格式化工具 ─── */
function formatNum(n: number | undefined | null): string {
  if (n == null) return '-';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function formatTime(val: string | null | undefined): string {
  if (!val) return '';
  try {
    const d = new Date(val);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return String(val);
  }
}

/* ─── Toast 提示组件 ─── */
function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 2500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`fixed top-4 right-4 z-[100] px-5 py-3 rounded-xl shadow-lg text-sm font-medium animate-bounce-in ${
      type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
    }`}>
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
        <span className="text-[10px] text-gray-400">已选 {Array.from(selected).filter(s => !search || s.toLowerCase().includes(search.toLowerCase())).length}/{filtered.length}</span>
      </div>
      <ul className="flex-1 overflow-y-auto p-1.5 space-y-0.5" onClick={e => e.stopPropagation()}>
        {filtered.map(v => (
          <li key={v || '(空)'}>
            <label className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-xs transition-colors hover:bg-gray-50 ${selected.has(v) ? 'bg-emerald-50 text-emerald-700' : 'text-gray-600'}`}>
              <input type="checkbox" checked={selected.has(v)} onChange={() => toggleOne(v)} className="w-3.5 h-3.5 accent-emerald-600" />
              <span className="truncate">{v || '<em>（空）</em>'}</span>
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

export default function ReliabilityTestPage() {
  /* ─── State ─── */
  const [records, setRecords] = useState<ReliabilityTestRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // 弹窗
  const [showForm, setShowForm] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ReliabilityTestRecord | null>(null);
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
      let query = reliabilityDb.from(TABLE).select('*').order('create_time', { ascending: false });
      const { data, error } = await query;
      if (error) throw error;
      setRecords(data || []);
    } catch (err) {
      console.error('加载可靠性实验数据失败:', err);
      showToast('加载数据失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRecords(); }, []);

  /* ─── 筛选 + 排序 + 搜索 ─── */
  const filteredAndSorted = (() => {
    let list = [...records];

    // 文字搜索
    if (searchText.trim()) {
      const kw = searchText.trim().toLowerCase();
      list = list.filter(r =>
        Object.entries(r).some(([k, v]) =>
          k !== 'id' && k !== 'selected_hours' && k !== 'time_adjust' &&
          typeof v === 'string' && v.toLowerCase().includes(kw)
        )
      );
    }

    // 列筛选
    for (const [field, vals] of Object.entries(filterValues)) {
      if (vals.size > 0) {
        list = list.filter(r => vals.has(String((r as Record<string, unknown>)[field] ?? '')));
      }
    }

    // 排序
    if (sortField) {
      list.sort((a, b) => {
        const va = a[sortField], vb = b[sortField];
        if (va == null && vb == null) return 0;
        if (va == null) return sortDir === 'asc' ? -1 : 1;
        if (vb == null) return sortDir === 'asc' ? 1 : -1;
        const sa = String(va), sb = String(vb);
        return sortDir === 'asc' ? sa.localeCompare(sb, 'zh') : sb.localeCompare(sa, 'zh');
      });
    }

    return list;
  })();

  // 分页数据
  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / PAGE_SIZE));
  const paginatedData = filteredAndSorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // 获取某字段唯一值（用于筛选）
  const getUniqueVals = (field: keyof ReliabilityTestRecord): string[] =>
    [...new Set(records.map(r => String((r[field] ?? '')).trim()))].sort((a, b) => a.localeCompare(b, 'zh'));

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
    setFormData({});
    setShowForm(true);
  };

  /* ─── 编辑 ─── */
  const openEditForm = (r: ReliabilityTestRecord) => {
    setEditingRecord(r);
    setFormData({ ...r });
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
      const row: Record<string, unknown> = {
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
      };

      if (editingRecord) {
        row.update_time = now;
        const { error } = await reliabilityDb.from(TABLE).update(row).eq('id', editingRecord.id);
        if (error) throw error;
        setRecords(prev => prev.map(r => r.id === editingRecord.id ? { ...r, ...row } as ReliabilityTestRecord : r));
        showToast('已更新');
      } else {
        row.create_time = now;
        row.update_time = now;
        const { data, error } = await reliabilityDb.from(TABLE).insert(row).select().single();
        if (error) throw error;
        setRecords(prev => [{ id: data.id, ...row } as ReliabilityTestRecord, ...prev]);
        showToast('已新增');
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
      showToast('已删除');
    } catch (err) {
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
    // 动态导入 SheetJS
    const XLSX = await import('xlsx');
    const exportData = filteredAndSorted.map(r => {
      const row: Record<string, unknown> = {};
      MAIN_COLUMNS.forEach(col => {
        row[col.label] = col.field === 'start_time' || col.field === 'create_time'
          ? formatTime(r[col.field])
          : r[col.field];
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

      // 标签匹配：支持中英文标签
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
          if (key && key in (formData || {})) {
            mapped[key as keyof ReliabilityTestRecord] = cleanVal;
          }
        }

        if (!mapped.series) continue;

        mapped.create_time = now;
        mapped.update_time = now;
        mapped.status ||= 'active';
        mapped.start_time ||= now.split('T')[0];

        const { error } = await reliabilityDb.from(TABLE).insert(mapped);
        if (error) {
          console.warn('导入跳过:', error.message, mapped);
          continue;
        }
        added++;
      }

      if (added > 0) {
        await loadRecords();
        showToast(`导入成功 ${added} 条`);
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
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
            导出 Excel
          </button>
          <label className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors cursor-pointer shadow-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
            导入 Excel
            <input type="file" accept=".xlsx,.xls,.csv" hidden onChange={handleImportExcel} />
          </label>
          <button onClick={openAddForm}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 shadow-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            新增记录
          </button>
        </div>
      </div>

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
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        )}
      </div>

      {/* 主内容 */}
      {loading ? (
        <div className="flex justify-center items-center py-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-600" />
        </div>
      ) : (
        <>
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
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L13 10.414V17a1 1 0 01-1.447.894l-4-2A1 1 0 017 15V10.414L3.293 6.707A1 1 0 013 6V3z" /></svg>
                          </button>
                          {sortField === col.field && <span className="text-xs">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                          {openFilterField === col.field && (
                            <div className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-2xl w-52"
                              style={{ top: filterPos?.top ?? 0, left: filterPos?.left ?? 0 }}
                              onClick={e => e.stopPropagation()}>
                              <FilterDropdown
                                fieldKey={col.field}
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
                  </tr>
                </thead>
                <tbody>
                  {paginatedData.length > 0 ? paginatedData.map(r => (
                    <tr key={r.id}
                      className={`border-b border-gray-100 hover:bg-slate-50 transition-colors cursor-pointer`}
                      onClick={() => handleRowClick(r)}
                    >
                      <td className="px-3 py-1.5 whitespace-nowrap sticky left-0 bg-white z-10" onClick={e => e.stopPropagation()}>
                        <button onClick={() => openEditForm(r)}
                          className="text-emerald-600 hover:text-emerald-700 text-xs mr-2 font-medium">编辑</button>
                        <button onClick={() => setDeleteTarget(r)}
                          className="text-red-500 hover:text-red-700 text-xs font-medium">删除</button>
                      </td>
                      {MAIN_COLUMNS.map(col => {
                        const val = r[col.field];
                        const display = col.field === 'start_time' ? formatTime(val)
                          : col.field === 'five_days' ? (val || '-')
                          : (val ?? '-');
                        return (
                          <td key={col.field}
                            className={`px-2 py-1.5 text-gray-700 whitespace-nowrap text-center ${
                              col.field === 'note' ? 'max-w-[150px] truncate' : ''
                            }`}
                            title={typeof val === 'string' && val?.length > 30 ? val : ''}
                          >{display}</td>
                        );
                      })}
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
                          className={`w-8 h-8 text-xs rounded-md font-medium transition-colors ${
                            p === page ? 'bg-slate-700 text-white' : 'hover:bg-gray-100 text-gray-600'
                          }`}>{p}</button>
                      </span>
                    ))}
                  <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    className="px-3 py-1.5 text-xs border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">下一页</button>
                </div>
              </div>
            )}
          </div>
        </>
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
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-6 grid grid-cols-2 gap-x-5 gap-y-4">
              {FORM_FIELDS.map(field => (
                <div key={field}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{FIELD_LABELS[field] || field}</label>
                  {field === 'note' ? (
                    <textarea
                      value={(formData[field] as string) || ''} onChange={e => setFormData(p => ({ ...p, [field]: e.target.value }))}
                      rows={2} placeholder={`${FIELD_LABELS[field] || field}（可选）`}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-none"
                    />
                  ) : field === 'start_time' ? (
                    <input
                      type="datetime-local"
                      value={
                        (formData[field] as string)?.slice(0, 16)
                          || new Date().toISOString().slice(0, 16)
                      }
                      onChange={e => setFormData(p => ({ ...p, [field]: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    />
                  ) : (
                    <input
                      type="text"
                      value={(formData[field] as string) || ''}
                      onChange={e => setFormData(p => ({ ...p, [field]: e.target.value }))}
                      placeholder={`输入${FIELD_LABELS[field] || field}`}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    />
                  )}
                </div>
              ))}
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
