import { useState, useRef, useCallback, useEffect } from 'react';
import * as XLSX from 'xlsx';
import type { ProductionRecord } from '../types';

/* ─── 工具函数 ─── */
const generateId = () => Math.random().toString(36).slice(2, 11);
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const calcRate = (part: number, total: number) =>
  total > 0 ? round2((part / total) * 100) : 0;

const calcDerived = (f: ProductionRecord): ProductionRecord => {
  const defectSum =
    f.defectShort + f.defectBurst + f.defectBottomConvex +
    f.defectVoltage + f.defectAppearance + f.defectLeakage +
    f.defectHighCap + f.defectLowCap + f.defectDF;
  const actualQty = f.goodQty + defectSum;
  const loss = f.designQty > 0
    ? round4((actualQty - f.designQty) / f.designQty * 100) : 0;
  const firstBottomConvexShortBurstRate = f.windingQty > 0
    ? round4((f.defectShort + f.defectBurst + f.defectBottomConvex) / f.windingQty * 100) : 0;
  const firstPassRate = calcRate(f.goodQty, actualQty);
  return { ...f, actualQty, loss, firstBottomConvexShortBurstRate, firstPassRate };
};

const emptyRecord = (): ProductionRecord => ({
  id: generateId(),
  entryDate: new Date().toISOString().slice(0, 10),
  seq: '', materialCode: '', spec: '', size: '', workOrderNo: '',
  positiveFoilVoltage: '', designQty: 0, actualQty: 0, windingQty: 0,
  goodQty: 0, loss: 0, firstBottomConvexShortBurstRate: 0, firstPassRate: 0,
  batchYieldRate: 0, defectShort: 0, defectBurst: 0, defectBottomConvex: 0,
  defectVoltage: 0, defectAppearance: 0, defectLeakage: 0,
  defectHighCap: 0, defectLowCap: 0, defectDF: 0,
  operator: '', notes: '', reworkOrderNo: '',
});

/* ─── 导出列配置 ─── */
const EXPORT_COLUMNS: { key: keyof ProductionRecord; label: string; width: number }[] = [
  { key: 'entryDate',                      label: '录入日期',           width: 12 },
  { key: 'seq',                            label: '序号',               width: 8  },
  { key: 'materialCode',                   label: '物料代码',           width: 16 },
  { key: 'spec',                           label: '规格',               width: 14 },
  { key: 'size',                           label: '尺寸',               width: 10 },
  { key: 'workOrderNo',                    label: '流转单号',           width: 14 },
  { key: 'positiveFoilVoltage',            label: '正箔电压',           width: 10 },
  { key: 'designQty',                      label: '设计数量',           width: 10 },
  { key: 'actualQty',                      label: '实际此单总数',       width: 14 },
  { key: 'windingQty',                     label: '卷绕数',             width: 10 },
  { key: 'goodQty',                        label: '良品数',             width: 10 },
  { key: 'loss',                           label: '损耗(%)',            width: 10 },
  { key: 'firstBottomConvexShortBurstRate',label: '一次底凸短路爆破率(%)', width: 22 },
  { key: 'firstPassRate',                  label: '一次直通率(%)',      width: 14 },
  { key: 'batchYieldRate',                 label: '整批良率(%)',        width: 12 },
  { key: 'defectShort',                    label: '短路',               width: 8  },
  { key: 'defectBurst',                    label: '爆破',               width: 8  },
  { key: 'defectBottomConvex',             label: '底凸',               width: 8  },
  { key: 'defectVoltage',                  label: '耐压',               width: 8  },
  { key: 'defectAppearance',               label: '外观',               width: 8  },
  { key: 'defectLeakage',                  label: '漏电',               width: 8  },
  { key: 'defectHighCap',                  label: '高容',               width: 8  },
  { key: 'defectLowCap',                   label: '低容',               width: 8  },
  { key: 'defectDF',                       label: 'DF',                 width: 8  },
  { key: 'operator',                       label: '作业员',             width: 10 },
  { key: 'notes',                          label: '备注',               width: 20 },
  { key: 'reworkOrderNo',                  label: '重工单号',           width: 14 },
];

/* ─── 从单个 worksheet 解析 records ─── */
function parseSheetRecords(
  ws: XLSX.WorkSheet,
  num: (v: unknown) => number,
  str: (v: unknown) => string,
): ProductionRecord[] {
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 }) as unknown[][];
  if (raw.length < 2) return [];

  // 找表头行：必须包含已知业务字段（如"日期"、"序号"、"物料代码"等），
  // 避免把标题行（如"不良拆解统计表"）误认为表头
  const HEADER_KEYWORDS = ['日期', '序号', '物料代码', '规格', '流转单号', '良品数'];
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(raw.length, 10); i++) {
    if (!raw[i]) continue;
    const rowStrs = (raw[i] as unknown[]).map((c) =>
      c == null ? '' : String(c).replace(/\n|\r/g, '').trim()
    );
    const matchCount = HEADER_KEYWORDS.filter((kw) => rowStrs.includes(kw)).length;
    if (matchCount >= 3) { headerRowIdx = i; break; }
  }
  // 没找到关键字匹配的表头行时，降级为第一个非空行
  if (headerRowIdx === -1) {
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] && (raw[i] as unknown[]).some(
        (c) => c !== null && c !== undefined && c !== ''
      )) { headerRowIdx = i; break; }
    }
  }
  if (headerRowIdx === -1) return [];

  const headers = (raw[headerRowIdx] as unknown[]).map((h) =>
    h == null ? '' : String(h).replace(/\n|\r/g, '').trim()
  );

  const json: Record<string, unknown>[] = raw
    .slice(headerRowIdx + 1)
    .filter((row) => row && (row as unknown[]).some(
      (c) => c !== null && c !== undefined && c !== ''
    ))
    .map((row) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((h, i) => { if (h) obj[h] = (row as unknown[])[i]; });
      return obj;
    });

  if (!json.length) return [];

  return json.map((row) => {
    const g = (keys: string[]) => {
      for (const k of keys) {
        if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k];
      }
      return '';
    };

    let entryDate = '';
    const rawDate = g(['日期', '录入日期', 'entryDate']);
    if (rawDate instanceof Date) {
      entryDate = rawDate.toISOString().slice(0, 10);
    } else if (typeof rawDate === 'number') {
      const d = XLSX.SSF.parse_date_code(rawDate);
      entryDate = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    } else {
      entryDate = str(rawDate).slice(0, 10);
    }

    const base: ProductionRecord = {
      id: generateId(),
      entryDate,
      seq: str(g(['序号', 'seq'])),
      materialCode: str(g(['物料代码', 'materialCode'])),
      spec: str(g(['规格', 'spec'])),
      size: str(g(['尺寸', 'size'])),
      workOrderNo: str(g(['流转单号', 'workOrderNo'])),
      positiveFoilVoltage: str(g(['正箔电压', 'positiveFoilVoltage'])),
      designQty: num(g(['设计数量', 'designQty'])),
      actualQty: 0,
      windingQty: num(g(['卷绕数', 'windingQty'])),
      goodQty: num(g(['良品数', 'goodQty'])),
      loss: 0,
      firstBottomConvexShortBurstRate: 0,
      firstPassRate: 0,
      batchYieldRate: num(g(['整批良率', 'batchYieldRate'])),
      defectShort: num(g(['短路', 'defectShort'])),
      defectBurst: num(g(['爆破', 'defectBurst'])),
      defectBottomConvex: num(g(['底凸', 'defectBottomConvex'])),
      defectVoltage: num(g(['耐压', 'defectVoltage'])),
      defectAppearance: num(g(['外观', 'defectAppearance'])),
      defectLeakage: num(g(['漏电', 'defectLeakage'])),
      defectHighCap: num(g(['高容', 'defectHighCap'])),
      defectLowCap: num(g(['低容', 'defectLowCap'])),
      defectDF: num(g(['DF', 'defectDF'])),
      operator: str(g(['作业员', 'operator'])),
      notes: str(g(['备注', 'notes'])),
      reworkOrderNo: str(g(['重工单号', 'reworkOrderNo'])),
    };
    const derived = calcDerived(base);
    return {
      ...derived,
      batchYieldRate: derived.batchYieldRate || calcRate(derived.goodQty, derived.actualQty),
    };
  });
}

/* ─── Sheet 数据类型 ─── */
type SheetMap = Record<string, ProductionRecord[]>;
const DEFAULT_SHEET = '工作表1';

/* ─── 表单 Field 组件 ─── */
const Field = ({
  label, required, children,
}: { label: string; required?: boolean; children: React.ReactNode }) => (
  <div>
    <label className="block text-xs font-medium text-gray-600 mb-1">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    {children}
  </div>
);

const inputCls =
  'w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 ' +
  'placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent';

const autoFieldCls = (extra = '') =>
  `px-2.5 py-2 bg-blue-50 rounded-lg text-sm font-medium text-blue-700 border border-blue-200 flex items-center gap-1 ${extra}`;

const CalcIcon = () => (
  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
);

/* ════════════════════════════════════════════
   主组件
════════════════════════════════════════════ */
/* ── localStorage 持久化工具 ── */
const LS_SHEETS = 'stats_sheets_v1';
const LS_ORDER  = 'stats_sheetOrder_v1';
const LS_ACTIVE = 'stats_activeSheet_v1';

function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

export default function StatsPage() {
  /* ── State（初始值从 localStorage 恢复）── */
  const [sheets, setSheets] = useState<SheetMap>(() =>
    loadLS(LS_SHEETS, { [DEFAULT_SHEET]: [] })
  );
  const [sheetOrder, setSheetOrder] = useState<string[]>(() =>
    loadLS(LS_ORDER, [DEFAULT_SHEET])
  );
  const [activeSheet, setActiveSheet] = useState<string>(() =>
    loadLS(LS_ACTIVE, DEFAULT_SHEET)
  );

  /* ── 每次数据变化时自动同步到 localStorage ── */
  useEffect(() => {
    localStorage.setItem(LS_SHEETS, JSON.stringify(sheets));
  }, [sheets]);
  useEffect(() => {
    localStorage.setItem(LS_ORDER, JSON.stringify(sheetOrder));
  }, [sheetOrder]);
  useEffect(() => {
    localStorage.setItem(LS_ACTIVE, JSON.stringify(activeSheet));
  }, [activeSheet]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductionRecord>(emptyRecord());
  const [searchQuery, setSearchQuery] = useState('');
  const [toastMsg, setToastMsg] = useState('');

  // 重命名弹窗
  const [renamingSheet, setRenamingSheet] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── 工具 ── */
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 2500);
  };
  const num = (v: unknown) => Number(v) || 0;
  const str = (v: unknown) => String(v ?? '');

  /* ── 当前 Sheet 数据 ── */
  const records = sheets[activeSheet] ?? [];
  const setRecords = (updater: (prev: ProductionRecord[]) => ProductionRecord[]) => {
    setSheets((s) => ({ ...s, [activeSheet]: updater(s[activeSheet] ?? []) }));
  };

  /* ── 搜索过滤 ── */
  const filtered = records.filter((r) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      r.entryDate.includes(q) ||
      r.materialCode.toLowerCase().includes(q) ||
      r.workOrderNo.toLowerCase().includes(q) ||
      r.spec.toLowerCase().includes(q) ||
      r.operator.toLowerCase().includes(q)
    );
  });

  /* ── 汇总（当前 Sheet） ── */
  const totalGood   = records.reduce((s, r) => s + r.goodQty, 0);
  const totalActual = records.reduce((s, r) => s + r.actualQty, 0);
  const avgYield    = calcRate(totalGood, totalActual);

  /* ── Sheet 管理 ── */
  const addSheet = () => {
    let n = sheetOrder.length + 1;
    let name = `工作表${n}`;
    while (sheets[name]) { n++; name = `工作表${n}`; }
    setSheets((s) => ({ ...s, [name]: [] }));
    setSheetOrder((o) => [...o, name]);
    setActiveSheet(name);
    setSearchQuery('');
  };

  const startRename = (name: string) => {
    setRenamingSheet(name);
    setRenameValue(name);
  };

  const confirmRename = () => {
    if (!renamingSheet) return;
    const newName = renameValue.trim();
    if (!newName || newName === renamingSheet) { setRenamingSheet(null); return; }
    if (sheets[newName]) { alert('该名称已存在'); return; }

    setSheets((s) => {
      const next: SheetMap = {};
      Object.keys(s).forEach((k) => { next[k === renamingSheet ? newName : k] = s[k]; });
      return next;
    });
    setSheetOrder((o) => o.map((k) => (k === renamingSheet ? newName : k)));
    if (activeSheet === renamingSheet) setActiveSheet(newName);
    setRenamingSheet(null);
  };

  const deleteSheet = (name: string) => {
    if (sheetOrder.length === 1) { alert('至少保留一个工作表'); return; }
    if (!confirm(`确认删除工作表「${name}」及其所有数据？`)) return;
    setSheets((s) => { const next = { ...s }; delete next[name]; return next; });
    const newOrder = sheetOrder.filter((k) => k !== name);
    setSheetOrder(newOrder);
    if (activeSheet === name) setActiveSheet(newOrder[0]);
  };

  const switchSheet = (name: string) => {
    setActiveSheet(name);
    setSearchQuery('');
  };

  /* ── 记录 CRUD ── */
  const openAdd = () => { setEditingId(null); setForm(emptyRecord()); setShowForm(true); };
  const openEdit = (r: ProductionRecord) => { setEditingId(r.id); setForm({ ...r }); setShowForm(true); };

  const deleteRecord = (id: string) => {
    if (!confirm('确认删除这条记录吗？')) return;
    setRecords((prev) => prev.filter((r) => r.id !== id));
    showToast('已删除');
  };

  const saveRecord = () => {
    if (!form.materialCode.trim()) { alert('请填写物料代码'); return; }
    if (!form.workOrderNo.trim()) { alert('请填写流转单号'); return; }
    const derived = calcDerived(form);
    const final: ProductionRecord = {
      ...derived,
      batchYieldRate: derived.batchYieldRate || calcRate(derived.goodQty, derived.actualQty),
    };
    if (editingId) {
      setRecords((prev) => prev.map((r) => (r.id === editingId ? final : r)));
      showToast('修改成功');
    } else {
      setRecords((prev) => [...prev, final]);
      showToast('添加成功');
    }
    setShowForm(false);
  };

  /* ── 导入 Excel（识别所有 Sheet） ── */
  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });

        let totalCount = 0;
        const newSheets: SheetMap = {};
        const newOrder: string[] = [];

        wb.SheetNames.forEach((sheetName) => {
          const ws = wb.Sheets[sheetName];
          const mapped = parseSheetRecords(ws, num, str);
          if (mapped.length > 0) {
            newSheets[sheetName] = mapped;
            newOrder.push(sheetName);
            totalCount += mapped.length;
          }
        });

        if (!newOrder.length) { alert('Excel 中没有可识别的数据'); return; }

        // 合并到现有 sheets，若 sheet 名已存在则追加
        setSheets((prev) => {
          const merged = { ...prev };
          newOrder.forEach((name) => {
            merged[name] = [...(merged[name] ?? []), ...newSheets[name]];
          });
          return merged;
        });
        setSheetOrder((prev) => {
          const existing = new Set(prev);
          const toAdd = newOrder.filter((n) => !existing.has(n));
          return [...prev, ...toAdd];
        });
        // 跳转到第一个导入的 sheet
        setActiveSheet(newOrder[0]);
        setSearchQuery('');
        showToast(`成功导入 ${newOrder.length} 个工作表，共 ${totalCount} 条记录`);
      } catch (err) {
        console.error(err);
        alert('读取 Excel 失败，请确认文件格式');
      }
    };
    reader.readAsArrayBuffer(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  /* ── 导出 Excel（每个 Sheet 一个工作表） ── */
  const handleExport = () => {
    const hasData = sheetOrder.some((n) => (sheets[n] ?? []).length > 0);
    if (!hasData) { alert('暂无数据可导出'); return; }

    const wb = XLSX.utils.book_new();
    sheetOrder.forEach((sheetName) => {
      const recs = sheets[sheetName] ?? [];
      if (!recs.length) return;
      const exportData = recs.map((r) => {
        const row: Record<string, unknown> = {};
        EXPORT_COLUMNS.forEach(({ key, label }) => { row[label] = r[key]; });
        return row;
      });
      const ws = XLSX.utils.json_to_sheet(exportData);
      ws['!cols'] = EXPORT_COLUMNS.map(({ width }) => ({ wch: width }));
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });
    XLSX.writeFile(wb, `生产良率记录_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast('导出成功');
  };

  /* ── 表单输入控件 ── */
  const numInput = (field: keyof ProductionRecord, placeholder = '0') => (
    <input
      type="number" min="0" placeholder={placeholder}
      value={(form[field] as number) || ''}
      onChange={(e) => setForm((f) => calcDerived({ ...f, [field]: Number(e.target.value) || 0 }))}
      className={inputCls}
    />
  );

  const textInput = (field: keyof ProductionRecord, placeholder = '') => (
    <input
      type="text" placeholder={placeholder}
      value={(form[field] as string) || ''}
      onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
      className={inputCls}
    />
  );

  /* ════ RENDER ════ */
  return (
    <div className="max-w-full mx-auto px-4 py-8">

      {/* 标题 */}
      <div className="mb-5">
        <h1 className="text-3xl font-bold text-gray-900">生产良率统计</h1>
        <p className="text-gray-500 mt-1 text-sm">牛角车间 · 按工作表分类录入、查看、导入/导出生产良率数据</p>
      </div>

      {/* ── Sheet 标签栏 ── */}
      <div className="flex items-end gap-0 mb-0 overflow-x-auto">
        {sheetOrder.map((name) => {
          const isActive = name === activeSheet;
          return (
            <div
              key={name}
              className={`group relative flex items-center gap-1.5 px-4 py-2 cursor-pointer select-none border-t border-l border-r text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-white border-gray-200 text-indigo-600 -mb-px z-10'
                  : 'bg-gray-100 border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700'
              }`}
              onClick={() => switchSheet(name)}
            >
              {/* Sheet 图标 */}
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
              </svg>

              {/* 双击重命名 */}
              <span
                onDoubleClick={(e) => { e.stopPropagation(); startRename(name); }}
                title="双击重命名"
              >
                {name}
              </span>

              {/* 记录数 badge */}
              {(sheets[name] ?? []).length > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  isActive ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-200 text-gray-500'
                }`}>
                  {(sheets[name] ?? []).length}
                </span>
              )}

              {/* 删除按钮（hover 显示） */}
              {sheetOrder.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); deleteSheet(name); }}
                  className="opacity-0 group-hover:opacity-100 ml-0.5 text-gray-400 hover:text-red-500 transition-all"
                  title="删除此工作表"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}

        {/* 新建 Sheet 按钮 */}
        <button
          onClick={addSheet}
          className="flex items-center gap-1 px-3 py-2 text-gray-400 hover:text-indigo-600 hover:bg-gray-100 rounded-t-lg transition-colors text-sm"
          title="新建工作表"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* ── 内容区（白色卡片，连接标签栏） ── */}
      <div className="bg-white border border-gray-200 rounded-b-xl rounded-tr-xl p-5 shadow-sm">

        {/* 概览卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[
            { label: '本表记录', value: records.length, unit: '条', color: 'text-gray-900' },
            { label: '实际总数', value: totalActual.toLocaleString(), unit: '件', color: 'text-gray-900' },
            { label: '良品总数', value: totalGood.toLocaleString(), unit: '件', color: 'text-green-600' },
            { label: '整体良率', value: `${avgYield}%`, unit: '',
              color: avgYield >= 95 ? 'text-green-600' : avgYield >= 85 ? 'text-amber-500' : 'text-red-500' },
          ].map((c) => (
            <div key={c.label} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <p className="text-xs text-gray-500 mb-0.5">{c.label}</p>
              <p className={`text-xl font-bold ${c.color}`}>
                {c.value}<span className="text-sm font-normal text-gray-400 ml-1">{c.unit}</span>
              </p>
            </div>
          ))}
        </div>

        {/* 工具栏 */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button onClick={openAdd}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新增记录
          </button>

          <label className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 cursor-pointer text-sm font-medium transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            导入 Excel
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
          </label>

          <button onClick={handleExport}
            className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            导出全部 Excel
          </button>

          <button
            onClick={() => {
              if (!window.confirm('确定要清空所有工作表和数据吗？此操作不可撤销。')) return;
              const fresh = { [DEFAULT_SHEET]: [] };
              setSheets(fresh);
              setSheetOrder([DEFAULT_SHEET]);
              setActiveSheet(DEFAULT_SHEET);
              showToast('已清空所有数据');
            }}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-red-200 text-red-500 rounded-lg hover:bg-red-50 text-sm font-medium transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            清空数据
          </button>

          {/* 搜索框 */}
          <div className="relative flex-1 min-w-[200px] max-w-sm ml-auto">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input type="text" placeholder="搜索物料代码 / 流转单号 / 规格 / 作业员..."
              value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent" />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* 表格 */}
        {filtered.length > 0 ? (
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs whitespace-nowrap">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {['录入日期','序号','物料代码','规格','尺寸','流转单号','正箔电压',
                      '设计数量','实际总数','卷绕数','良品数','损耗%','底凸短路爆破率%',
                      '一次直通率%','整批良率%','短路','爆破','底凸','耐压','外观','漏电',
                      '高容','低容','DF','作业员','备注','重工单号','操作'].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left text-gray-500 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-b border-gray-50 hover:bg-indigo-50/30 transition-colors">
                      <td className="px-3 py-2 text-gray-700">{r.entryDate}</td>
                      <td className="px-3 py-2 text-gray-500">{r.seq || '—'}</td>
                      <td className="px-3 py-2 font-medium text-gray-900">{r.materialCode}</td>
                      <td className="px-3 py-2 text-gray-700">{r.spec || '—'}</td>
                      <td className="px-3 py-2 text-gray-700">{r.size || '—'}</td>
                      <td className="px-3 py-2 text-gray-700">{r.workOrderNo}</td>
                      <td className="px-3 py-2 text-gray-700">{r.positiveFoilVoltage || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{r.designQty || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{r.actualQty}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{r.windingQty || '—'}</td>
                      <td className="px-3 py-2 text-right text-green-600 font-medium">{r.goodQty}</td>
                      <td className={`px-3 py-2 text-right font-medium ${r.loss > 0 ? 'text-red-500' : r.loss < 0 ? 'text-amber-500' : 'text-gray-400'}`}>
                        {r.designQty > 0 ? `${r.loss}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">{r.firstBottomConvexShortBurstRate ? `${r.firstBottomConvexShortBurstRate}%` : '—'}</td>
                      <td className="px-3 py-2 text-right">{r.firstPassRate ? `${r.firstPassRate}%` : '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={`inline-block px-1.5 py-0.5 rounded-full font-bold ${
                          r.batchYieldRate >= 95 ? 'bg-green-100 text-green-700' :
                          r.batchYieldRate >= 85 ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-700'}`}>
                          {r.batchYieldRate}%
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600">{r.defectShort || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{r.defectBurst || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{r.defectBottomConvex || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{r.defectVoltage || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{r.defectAppearance || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{r.defectLeakage || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{r.defectHighCap || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{r.defectLowCap || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{r.defectDF || '—'}</td>
                      <td className="px-3 py-2 text-gray-700">{r.operator || '—'}</td>
                      <td className="px-3 py-2 text-gray-500 max-w-[120px] truncate">{r.notes || '—'}</td>
                      <td className="px-3 py-2 text-gray-500">{r.reworkOrderNo || '—'}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(r)}
                            className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors" title="编辑">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button onClick={() => deleteRecord(r.id)}
                            className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="删除">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {searchQuery && (
              <p className="px-4 py-2 text-xs text-gray-500 bg-gray-50 border-t">
                搜索「{searchQuery}」找到 {filtered.length} 条
              </p>
            )}
          </div>
        ) : (
          <div className="text-center py-16 bg-gray-50 rounded-xl border border-dashed border-gray-200">
            <svg className="w-12 h-12 text-gray-200 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-gray-400">
              {searchQuery ? `没有找到"${searchQuery}"相关记录` : `「${activeSheet}」暂无数据`}
            </p>
            {!searchQuery && (
              <p className="text-gray-400 text-xs mt-1">点击「新增记录」手动录入，或「导入 Excel」批量导入</p>
            )}
          </div>
        )}
      </div>

      {/* ── 重命名弹窗 ── */}
      {renamingSheet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setRenamingSheet(null)} />
          <div className="relative bg-white rounded-xl shadow-2xl p-6 w-80">
            <h3 className="text-base font-bold text-gray-900 mb-4">重命名工作表</h3>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') setRenamingSheet(null); }}
              className={inputCls}
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setRenamingSheet(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
              <button onClick={confirmRename}
                className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">确认</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 录入弹窗 ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 overflow-y-auto">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowForm(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl mb-10">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{editingId ? '编辑记录' : '新增记录'}</h2>
                <p className="text-xs text-gray-400 mt-0.5">工作表：{activeSheet}</p>
              </div>
              <button onClick={() => setShowForm(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* 基本信息 */}
              <div>
                <h3 className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">基本信息</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Field label="录入日期" required>
                    <input type="date" value={form.entryDate}
                      onChange={(e) => setForm((f) => ({ ...f, entryDate: e.target.value }))}
                      className={inputCls} />
                  </Field>
                  <Field label="序号">{textInput('seq', '如：001')}</Field>
                  <Field label="物料代码" required>{textInput('materialCode', '如：H1.LK.2D.6001')}</Field>
                  <Field label="规格">{textInput('spec', '如：16V 220uF')}</Field>
                  <Field label="尺寸">{textInput('size', '如：8×12')}</Field>
                  <Field label="流转单号" required>{textInput('workOrderNo', '请输入流转单号')}</Field>
                </div>
              </div>

              {/* 电气参数 */}
              <div>
                <h3 className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">电气参数</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Field label="正箔电压">{textInput('positiveFoilVoltage', '如：16V')}</Field>
                </div>
              </div>

              {/* 数量统计 */}
              <div>
                <h3 className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">数量统计</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Field label="设计数量">{numInput('designQty')}</Field>
                  <Field label="卷绕数">{numInput('windingQty')}</Field>
                  <Field label="良品数" required>{numInput('goodQty')}</Field>
                  <Field label="实际此单总数（自动）">
                    <div className={autoFieldCls()}>
                      <CalcIcon />{form.actualQty}
                    </div>
                  </Field>
                  <Field label="损耗（自动，%）">
                    <div className={autoFieldCls(
                      form.loss > 0 ? '!bg-red-50 !text-red-600 !border-red-200' :
                      form.loss < 0 ? '!bg-amber-50 !text-amber-600 !border-amber-200' : ''
                    )}>
                      <CalcIcon />{form.designQty > 0 ? `${form.loss}%` : '—'}
                    </div>
                  </Field>
                </div>
              </div>

              {/* 良率统计 */}
              <div>
                <h3 className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">良率统计（%）</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Field label="一次底凸短路爆破率（自动）">
                    <div className={autoFieldCls()}>
                      <CalcIcon />{form.windingQty > 0 ? `${form.firstBottomConvexShortBurstRate}%` : '—'}
                    </div>
                  </Field>
                  <Field label="一次直通率（自动）">
                    <div className={autoFieldCls()}>
                      <CalcIcon />{form.actualQty > 0 ? `${form.firstPassRate}%` : '—'}
                    </div>
                  </Field>
                  <Field label="整批良率（留空自动计算）">
                    <div className="flex items-center gap-2">
                      {numInput('batchYieldRate')}
                      {form.batchYieldRate === 0 && form.actualQty > 0 && (
                        <span className="text-xs text-gray-400 whitespace-nowrap">
                          ≈{calcRate(form.goodQty, form.actualQty)}%
                        </span>
                      )}
                    </div>
                  </Field>
                </div>
              </div>

              {/* 不良分类 */}
              <div>
                <h3 className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">不良分类（件数）</h3>
                <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
                  <Field label="短路">{numInput('defectShort')}</Field>
                  <Field label="爆破">{numInput('defectBurst')}</Field>
                  <Field label="底凸">{numInput('defectBottomConvex')}</Field>
                  <Field label="耐压">{numInput('defectVoltage')}</Field>
                  <Field label="外观">{numInput('defectAppearance')}</Field>
                  <Field label="漏电">{numInput('defectLeakage')}</Field>
                  <Field label="高容">{numInput('defectHighCap')}</Field>
                  <Field label="低容">{numInput('defectLowCap')}</Field>
                  <Field label="DF">{numInput('defectDF')}</Field>
                </div>
              </div>

              {/* 其他 */}
              <div>
                <h3 className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">其他</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Field label="作业员">{textInput('operator', '请输入姓名')}</Field>
                  <Field label="重工单号">{textInput('reworkOrderNo')}</Field>
                  <Field label="备注">
                    <textarea rows={2} value={form.notes}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                      placeholder="可选备注..." className={`${inputCls} resize-none`} />
                  </Field>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)}
                className="px-5 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">取消</button>
              <button onClick={saveRecord}
                className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium transition-colors">
                {editingId ? '保存修改' : '添加记录'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-gray-900 text-white text-sm px-5 py-2.5 rounded-full shadow-lg">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
