import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
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
  batchYieldRate: 0,
  defectShort: 0, defectBurst: 0, defectBottomConvex: 0,
  defectVoltage: 0, defectAppearance: 0, defectLeakage: 0,
  defectHighCap: 0, defectLowCap: 0, defectDF: 0,
  operator: '', notes: '', reworkOrderNo: '',
});

/* ─── 类型：本地 Sheet 映射（name ↔ cloudId）── */
interface LocalSheet {
  id: string;       // cloud sheet id
  name: string;
}

/* ═══════════════════════════════════════════════════
   Excel 导入工具
═══════════════════════════════════════════════════ */
const num = (v: unknown) => Number(v) || 0;
const str = (v: unknown) => String(v ?? '');

function parseSheetRecords(ws: XLSX.WorkSheet, numFn: typeof num, strFn: typeof str) {
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 }) as unknown[][];
  if (raw.length < 2) return [];

  // 找表头行（必须包含至少3个业务关键字）
  const HEADER_KEYWORDS = ['日期', '序号', '物料代码', '规格', '流转单号', '良品数'];
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(raw.length, 10); i++) {
    if (!raw[i]) continue;
    const rowStrs = (raw[i] as unknown[]).map((c) =>
      c == null ? '' : String(c).replace(/\n|\r/g, '').trim()
    );
    if (HEADER_KEYWORDS.filter((kw) => rowStrs.includes(kw)).length >= 3) {
      headerRowIdx = i; break;
    }
  }
  if (headerRowIdx === -1) {
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] && (raw[i] as unknown[]).some((c) => c != null && c !== '')) {
        headerRowIdx = i; break;
      }
    }
  }
  if (headerRowIdx === -1) return [];

  const headers = (raw[headerRowIdx] as unknown[]).map((h) =>
    h == null ? '' : String(h).replace(/\n|\r/g, '').trim()
  );

  const dataRows = raw.slice(headerRowIdx + 1).filter(
    (row) => row && (row as unknown[]).some((c) => c != null && c !== '')
  );

  return dataRows.map((row): ProductionRecord => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => { if (h) obj[h] = (row as unknown[])[i]; });

    const g = (keys: string[]) => {
      for (const k of keys) { if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k]; }
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
      entryDate = strFn(rawDate).slice(0, 10);
    }

    const base: ProductionRecord = {
      id: generateId(),
      entryDate,
      seq: strFn(g(['序号', 'seq'])),
      materialCode: strFn(g(['物料代码', 'materialCode'])),
      spec: strFn(g(['规格', 'spec'])),
      size: strFn(g(['尺寸', 'size'])),
      workOrderNo: strFn(g(['流转单号', 'workOrderNo'])),
      positiveFoilVoltage: strFn(g(['正箔电压', '正箔\\n电压', 'positiveFoilVoltage'])),
      designQty: numFn(g(['设计数量', '设计\\n数量', 'designQty'])),
      actualQty: 0,
      windingQty: numFn(g(['卷绕数', '卷绕\\n数量', 'windingQty'])),
      goodQty: numFn(g(['良品数', 'goodQty'])),
      loss: 0,
      firstBottomConvexShortBurstRate: 0,
      firstPassRate: 0,
      batchYieldRate: numFn(g(['整批良率', 'batchYieldRate'])),
      defectShort: numFn(g(['短路', 'defectShort'])),
      defectBurst: numFn(g(['爆破', 'defectBurst'])),
      defectBottomConvex: numFn(g(['底凸', 'defectBottomConvex'])),
      defectVoltage: numFn(g(['耐压', 'defectVoltage'])),
      defectAppearance: numFn(g(['外观', 'defectAppearance'])),
      defectLeakage: numFn(g(['漏电', 'defectLeakage'])),
      defectHighCap: numFn(g(['高容', 'defectHighCap'])),
      defectLowCap: numFn(g(['低容', 'defectLowCap'])),
      defectDF: numFn(g(['DF', 'defectDF'])),
      operator: strFn(g(['作业员', 'operator'])),
      notes: strFn(g(['备注', 'notes'])),
      reworkOrderNo: strFn(g(['重工单号', 'reworkOrderNo'])),
    };

    const derived = calcDerived(base);
    return {
      ...derived,
      batchYieldRate: derived.batchYieldRate || calcRate(derived.goodQty, derived.actualQty),
    };
  });
}

/* ─── Excel 导出列定义 ─── */
const EXPORT_COLUMNS: { key: keyof ProductionRecord; label: string; width: number }[] = [
  { key: 'entryDate', label: '录入日期', width: 12 },
  { key: 'seq', label: '序号', width: 8 },
  { key: 'materialCode', label: '物料代码', width: 20 },
  { key: 'spec', label: '规格', width: 18 },
  { key: 'size', label: '尺寸', width: 12 },
  { key: 'workOrderNo', label: '流转单号', width: 14 },
  { key: 'positiveFoilVoltage', label: '正箔电压', width: 10 },
  { key: 'designQty', label: '设计数量', width: 10 },
  { key: 'actualQty', label: '实际此单总数', width: 14 },
  { key: 'windingQty', label: '卷绕数', width: 10 },
  { key: 'goodQty', label: '良品数', width: 10 },
  { key: 'loss', label: '损耗(%)', width: 10 },
  { key: 'firstBottomConvexShortBurstRate', label: '一次底凸短路爆破率(%)', width: 20 },
  { key: 'firstPassRate', label: '一次直通率(%)', width: 14 },
  { key: 'batchYieldRate', label: '整批良率(%)', width: 12 },
  { key: 'defectShort', label: '短路', width: 8 },
  { key: 'defectBurst', label: '爆破', width: 8 },
  { key: 'defectBottomConvex', label: '底凸', width: 8 },
  { key: 'defectVoltage', label: '耐压', width: 8 },
  { key: 'defectAppearance', label: '外观', width: 8 },
  { key: 'defectLeakage', label: '漏电', width: 8 },
  { key: 'defectHighCap', label: '高容', width: 8 },
  { key: 'defectLowCap', label: '低容', width: 8 },
  { key: 'defectDF', label: 'DF', width: 8 },
  { key: 'operator', label: '作业员', width: 12 },
  { key: 'notes', label: '备注', width: 20 },
  { key: 'reworkOrderNo', label: '重工单号', width: 14 },
];

/* ═══════════════════════════════════════════════════
   主组件
═══════════════════════════════════════════════════ */
export default function StatsPage() {
  const navigate = useNavigate();

  /* ── Sheet 列表（本地缓存）── */
  const [localSheets, setLocalSheets] = useState<LocalSheet[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [sheetRecords, setSheetRecords] = useState<ProductionRecord[]>([]);

  /* ── UI 状态 ── */
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductionRecord>(emptyRecord());
  const [searchQuery, setSearchQuery] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [loading, setLoading] = useState(true);   // 初始加载中
  const [saving, setSaving] = useState(false);   // 保存中

  /* ── Sheet 重命名弹窗 ── */
  const [renamingSheet, setRenamingSheet] = useState<LocalSheet | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── 工具 ── */
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 2500);
  };

  /* ── 当前 Sheet 信息 ── */
  const activeLocal = localSheets.find((s) => s.id === activeSheetId);
  const activeSheetName = activeLocal?.name ?? '工作表1';

  /* ── 搜索过滤 ── */
  const filtered = sheetRecords.filter((r) => {
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

  /* ── 汇总 ── */
  const totalGood   = sheetRecords.reduce((s, r) => s + r.goodQty, 0);
  const totalActual = sheetRecords.reduce((s, r) => s + r.actualQty, 0);
  const avgYield    = calcRate(totalGood, totalActual);

  /* ── 初始加载：获取当前用户 + 加载 Sheets ── */
  useEffect(() => {
    let ignore = false;

    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || ignore) return;

      const { data: cloudSheets } = await supabase
        .from('sheets')
        .select('id, name, "order"')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      if (ignore) return;

      if (!cloudSheets || cloudSheets.length === 0) {
        // 首次使用，创建默认 Sheet
        const { data: newSheet } = await supabase
          .from('sheets')
          .insert({ name: '工作表1', 'order': [], user_id: user.id })
          .select('id, name, "order"')
          .single();
        if (ignore) return;
        if (newSheet) {
          setLocalSheets([{ id: newSheet.id, name: newSheet.name }]);
          setActiveSheetId(newSheet.id);
          setSheetRecords([]);
        }
      } else {
        const mapped: LocalSheet[] = cloudSheets.map((s) => ({
          id: s.id,
          name: s.name,
        }));
        setLocalSheets(mapped);
        setActiveSheetId(mapped[0].id);
        await loadRecords(mapped[0].id);
      }

      setLoading(false);
    }

    init();
    return () => { ignore = true; };
  }, []);

  /* ── 加载某个 Sheet 的所有记录 ── */
  const loadRecords = async (sheetId: string) => {
    const { data } = await supabase
      .from('records')
      .select('*')
      .eq('sheet_id', sheetId)
      .order('entry_date', { ascending: false });

    setSheetRecords(
      (data ?? []).map((r) => ({
        id: r.id,
        entryDate: r.entry_date ?? '',
        seq: r.seq ?? '',
        materialCode: r.material_code ?? '',
        spec: r.spec ?? '',
        size: r.size ?? '',
        workOrderNo: r.work_order_no ?? '',
        positiveFoilVoltage: r.positive_foil_voltage ?? '',
        designQty: r.design_qty ?? 0,
        actualQty: r.actual_qty ?? 0,
        windingQty: r.winding_qty ?? 0,
        goodQty: r.good_qty ?? 0,
        loss: Number(r.loss) || 0,
        firstBottomConvexShortBurstRate: Number(r.first_bottom_convex_short_burst_rate) || 0,
        firstPassRate: Number(r.first_pass_rate) || 0,
        batchYieldRate: Number(r.batch_yield_rate) || 0,
        defectShort: r.defect_short ?? 0,
        defectBurst: r.defect_burst ?? 0,
        defectBottomConvex: r.defect_bottom_convex ?? 0,
        defectVoltage: r.defect_voltage ?? 0,
        defectAppearance: r.defect_appearance ?? 0,
        defectLeakage: r.defect_leakage ?? 0,
        defectHighCap: r.defect_high_cap ?? 0,
        defectLowCap: r.defect_low_cap ?? 0,
        defectDF: r.defect_df ?? 0,
        operator: r.operator ?? '',
        notes: r.notes ?? '',
        reworkOrderNo: r.rework_order_no ?? '',
      }))
    );
  };

  /* ── Sheet 切换 ── */
  const switchSheet = async (sheet: LocalSheet) => {
    setActiveSheetId(sheet.id);
    setSearchQuery('');
    await loadRecords(sheet.id);
  };

  /* ── 新建 Sheet ── */
  const addSheet = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    let n = localSheets.length + 1;
    let name = `工作表${n}`;
    while (localSheets.find((s) => s.name === name)) { n++; name = `工作表${n}`; }

    const { data: newSheet } = await supabase
      .from('sheets')
      .insert({ name, 'order': [], user_id: user.id })
      .select('id, name')
      .single();

    if (newSheet) {
      setLocalSheets((prev) => [...prev, { id: newSheet.id, name: newSheet.name }]);
      setActiveSheetId(newSheet.id);
      setSheetRecords([]);
      setSearchQuery('');
    }
  };

  /* ── 开始重命名 ── */
  const startRename = (sheet: LocalSheet) => {
    setRenamingSheet(sheet);
    setRenameValue(sheet.name);
  };

  /* ── 确认重命名 ── */
  const confirmRename = async () => {
    if (!renamingSheet) return;
    const newName = renameValue.trim();
    if (!newName || newName === renamingSheet.name) { setRenamingSheet(null); return; }
    if (localSheets.find((s) => s.name === newName && s.id !== renamingSheet.id)) {
      alert('该名称已存在'); return;
    }
    await supabase.from('sheets').update({ name: newName }).eq('id', renamingSheet.id);
    setLocalSheets((prev) =>
      prev.map((s) => s.id === renamingSheet.id ? { ...s, name: newName } : s)
    );
    setRenamingSheet(null);
  };

  /* ── 删除 Sheet ── */
  const deleteSheet = async (sheet: LocalSheet) => {
    if (localSheets.length === 1) { alert('至少保留一个工作表'); return; }
    if (!confirm(`确认删除工作表「${sheet.name}」及其所有数据？`)) return;
    await supabase.from('sheets').delete().eq('id', sheet.id);
    const remaining = localSheets.filter((s) => s.id !== sheet.id);
    setLocalSheets(remaining);
    if (activeSheetId === sheet.id) {
      setActiveSheetId(remaining[0].id);
      await loadRecords(remaining[0].id);
    }
  };

  /* ── 记录 CRUD ── */
  const openAdd = () => { setEditingId(null); setForm(emptyRecord()); setShowForm(true); };
  const openEdit = (r: ProductionRecord) => { setEditingId(r.id); setForm({ ...r }); setShowForm(true); };

  const deleteRecord = async (id: string) => {
    if (!confirm('确认删除这条记录吗？')) return;
    await supabase.from('records').delete().eq('id', id);
    setSheetRecords((prev) => prev.filter((r) => r.id !== id));
    showToast('已删除');
  };

  const saveRecord = async () => {
    if (!form.materialCode.trim()) { alert('请填写物料代码'); return; }
    if (!form.workOrderNo.trim()) { alert('请填写流转单号'); return; }
    if (!activeSheetId) { alert('未选择工作表'); return; }

    setSaving(true);
    const derived = calcDerived(form);
    const final = {
      ...derived,
      batchYieldRate: derived.batchYieldRate || calcRate(derived.goodQty, derived.actualQty),
    };

    const recordCloudData = {
      sheet_id: activeSheetId,
      entry_date: final.entryDate,
      seq: final.seq,
      material_code: final.materialCode,
      spec: final.spec,
      size: final.size,
      work_order_no: final.workOrderNo,
      positive_foil_voltage: final.positiveFoilVoltage,
      design_qty: final.designQty,
      actual_qty: final.actualQty,
      winding_qty: final.windingQty,
      good_qty: final.goodQty,
      loss: final.loss,
      first_bottom_convex_short_burst_rate: final.firstBottomConvexShortBurstRate,
      first_pass_rate: final.firstPassRate,
      batch_yield_rate: final.batchYieldRate,
      defect_short: final.defectShort,
      defect_burst: final.defectBurst,
      defect_bottom_convex: final.defectBottomConvex,
      defect_voltage: final.defectVoltage,
      defect_appearance: final.defectAppearance,
      defect_leakage: final.defectLeakage,
      defect_high_cap: final.defectHighCap,
      defect_low_cap: final.defectLowCap,
      defect_df: final.defectDF,
      operator: final.operator,
      notes: final.notes,
      rework_order_no: final.reworkOrderNo,
    };

    if (editingId) {
      // 编辑
      await supabase.from('records').update(recordCloudData).eq('id', editingId);
      setSheetRecords((prev) => prev.map((r) => r.id === editingId ? { ...final, id: editingId } : r));
      showToast('修改成功');
    } else {
      // 新增
      const { data: inserted } = await supabase
        .from('records')
        .insert({ ...recordCloudData, id: generateId() } as Record<string, unknown>)
        .select()
        .single();
      if (inserted) {
        setSheetRecords((prev) => [{ ...final, id: inserted.id as string }, ...prev]);
        showToast('添加成功');
      }
    }

    setSaving(false);
    setShowForm(false);
  };

  /* ── 导入 Excel ── */
  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = new Uint8Array(evt.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        let totalCount = 0;

        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          const records = parseSheetRecords(ws, num, str);
          if (!records.length) continue;

          // 找到或创建同名 sheet
          let localSheet = localSheets.find((s) => s.name === sheetName);
          if (!localSheet) {
            const { data: newSheet } = await supabase
              .from('sheets')
              .insert({ name: sheetName, 'order': [], user_id: user.id })
              .select('id, name')
              .single();
            if (!newSheet) continue;
            localSheet = { id: newSheet.id, name: newSheet.name };
            setLocalSheets((prev) => [...prev, localSheet!]);
          }

          // 插入记录
          const cloudRecords = records.map((r) => ({
            id: generateId(),
            sheet_id: localSheet!.id,
            entry_date: r.entryDate,
            seq: r.seq,
            material_code: r.materialCode,
            spec: r.spec,
            size: r.size,
            work_order_no: r.workOrderNo,
            positive_foil_voltage: r.positiveFoilVoltage,
            design_qty: r.designQty,
            actual_qty: r.actualQty,
            winding_qty: r.windingQty,
            good_qty: r.goodQty,
            loss: r.loss,
            first_bottom_convex_short_burst_rate: r.firstBottomConvexShortBurstRate,
            first_pass_rate: r.firstPassRate,
            batch_yield_rate: r.batchYieldRate,
            defect_short: r.defectShort,
            defect_burst: r.defectBurst,
            defect_bottom_convex: r.defectBottomConvex,
            defect_voltage: r.defectVoltage,
            defect_appearance: r.defectAppearance,
            defect_leakage: r.defectLeakage,
            defect_high_cap: r.defectHighCap,
            defect_low_cap: r.defectLowCap,
            defect_df: r.defectDF,
            operator: r.operator,
            notes: r.notes,
            rework_order_no: r.reworkOrderNo,
          }));

          await supabase.from('records').insert(cloudRecords as Record<string, unknown>[]);
          totalCount += records.length;

          // 如果当前在导入的 sheet 上，更新记录
          if (activeSheetId === localSheet.id) {
            await loadRecords(localSheet.id);
          }
        }

        if (totalCount === 0) {
          alert('Excel 中没有可识别的数据'); return;
        }
        showToast(`成功导入 ${totalCount} 条记录`);
      } catch (err) {
        console.error(err);
        alert('读取 Excel 失败，请确认文件格式');
      }
    };
    reader.readAsArrayBuffer(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [activeSheetId, localSheets]);

  /* ── 导出 Excel ── */
  const handleExport = () => {
    if (!sheetRecords.length) { alert('当前工作表暂无数据可导出'); return; }
    const wb = XLSX.utils.book_new();
    const exportData = sheetRecords.map((r) => {
      const row: Record<string, unknown> = {};
      EXPORT_COLUMNS.forEach(({ key, label }) => { row[label] = r[key]; });
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    ws['!cols'] = EXPORT_COLUMNS.map(({ width }) => ({ wch: width }));
    XLSX.utils.book_append_sheet(wb, ws, activeSheetName);
    XLSX.writeFile(wb, `生产良率记录_${activeSheetName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast('导出成功');
  };

  /* ── 退出登录 ── */
  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  /* ── 表单输入控件 ── */
  const inputCls = 'w-full px-2.5 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition';
  const numInput = (field: keyof ProductionRecord, placeholder = '0') => (
    <input type="number" min="0" placeholder={placeholder}
      value={(form[field] as number) || ''}
      onChange={(e) => setForm((f) => calcDerived({ ...f, [field]: Number(e.target.value) || 0 }))}
      className={inputCls} />
  );
  const textInput = (field: keyof ProductionRecord, placeholder = '') => (
    <input type="text" placeholder={placeholder}
      value={(form[field] as string) || ''}
      onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
      className={inputCls} />
  );

  /* ════ RENDER ════ */
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500 text-sm">正在加载数据…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-full mx-auto px-4 py-8">

      {/* 顶部工具栏 */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <h1 className="text-3xl font-bold text-gray-900">生产良率统计</h1>
        <p className="text-gray-500 text-sm hidden sm:block">牛角车间 · 云端同步</p>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 text-sm font-medium transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            退出登录
          </button>
        </div>
      </div>

      {/* ── Sheet 标签栏 ── */}
      <div className="flex items-end gap-0 mb-0 overflow-x-auto">
        {localSheets.map((sheet) => {
          const isActive = sheet.id === activeSheetId;
          return (
            <div
              key={sheet.id}
              className={`group relative flex items-center gap-1.5 px-4 py-2 cursor-pointer select-none border-t border-l border-r text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-white border-gray-200 text-indigo-600 -mb-px z-10'
                  : 'bg-gray-100 border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700'
              }`}
              onClick={() => switchSheet(sheet)}
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {renamingSheet?.id === sheet.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={confirmRename}
                  onKeyDown={(e) => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') setRenamingSheet(null); }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-transparent border-b border-indigo-400 outline-none w-24 text-inherit px-0 py-0 h-auto text-sm"
                />
              ) : (
                <span onDoubleClick={(e) => { e.stopPropagation(); startRename(sheet); }}>{sheet.name}</span>
              )}
              {isActive && localSheets.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); deleteSheet(sheet); }}
                  className="opacity-0 group-hover:opacity-100 ml-1 text-gray-400 hover:text-red-500 transition-opacity"
                  title="删除工作表">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
        <button onClick={addSheet}
          className="px-3 py-2 bg-gray-100 hover:bg-gray-200 border border-gray-200 border-t-0 text-gray-500 text-sm rounded-b-lg transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* 主内容面板 */}
      <div className="bg-white border border-gray-200 rounded-b-2xl rounded-tr-2xl p-5 shadow-sm">

        {/* 当前 Sheet 概览 */}
        <div className="flex items-center gap-4 mb-5 flex-wrap text-sm text-gray-600">
          <span className="font-semibold text-gray-900">{activeSheetName}</span>
          <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full text-xs font-medium">
            {sheetRecords.length} 条记录
          </span>
          <span>良品合计：<strong className="text-gray-900">{totalGood.toLocaleString()}</strong></span>
          <span>实际合计：<strong className="text-gray-900">{totalActual.toLocaleString()}</strong></span>
          <span>平均良率：<strong className="text-green-600">{avgYield}%</strong></span>
        </div>

        {/* 操作栏 */}
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <button onClick={openAdd}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            录入记录
          </button>

          <label className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium cursor-pointer transition-colors">
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
            导出 Excel
          </button>

          {/* 搜索框 */}
          <div className="relative flex-1 min-w-[200px] max-w-sm ml-auto">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text" placeholder="搜索日期/物料代码/流转单号/规格…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 transition" />
          </div>
        </div>

        {/* 数据表格 */}
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p>{searchQuery ? '没有找到匹配记录' : '暂无数据，请导入 Excel 或手动录入'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  {['录入日期','序号','物料代码','规格','尺寸','流转单号','正箔电压','设计数量','实际此单总数','卷绕数','良品数','损耗(%)','一次底凸短路爆破率(%)','一次直通率(%)','整批良率(%)','短路','爆破','底凸','耐压','外观','漏电','高容','低容','DF','作业员','备注','重工单号',''].map((h) => (
                    <th key={h} className="px-2 py-2 text-left font-semibold text-gray-600 whitespace-nowrap border-b border-gray-100">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={r.id} className={`group hover:bg-indigo-50/40 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.entryDate}</td>
                    <td className="px-2 py-1.5">{r.seq}</td>
                    <td className="px-2 py-1.5 font-medium text-gray-800">{r.materialCode}</td>
                    <td className="px-2 py-1.5">{r.spec}</td>
                    <td className="px-2 py-1.5">{r.size}</td>
                    <td className="px-2 py-1.5">{r.workOrderNo}</td>
                    <td className="px-2 py-1.5">{r.positiveFoilVoltage}</td>
                    <td className="px-2 py-1.5 text-right">{r.designQty.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right font-medium text-indigo-600">{r.actualQty.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right">{r.windingQty.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right font-medium text-green-600">{r.goodQty.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right">{r.loss >= 0 ? `+${r.loss}` : r.loss}%</td>
                    <td className="px-2 py-1.5 text-right text-red-500">{r.firstBottomConvexShortBurstRate}%</td>
                    <td className="px-2 py-1.5 text-right text-blue-600">{r.firstPassRate}%</td>
                    <td className="px-2 py-1.5 text-right">{r.batchYieldRate > 0 ? `${r.batchYieldRate}%` : '—'}</td>
                    <td className="px-2 py-1.5 text-right">{r.defectShort || '—'}</td>
                    <td className="px-2 py-1.5 text-right">{r.defectBurst || '—'}</td>
                    <td className="px-2 py-1.5 text-right">{r.defectBottomConvex || '—'}</td>
                    <td className="px-2 py-1.5 text-right">{r.defectVoltage || '—'}</td>
                    <td className="px-2 py-1.5 text-right">{r.defectAppearance || '—'}</td>
                    <td className="px-2 py-1.5 text-right">{r.defectLeakage || '—'}</td>
                    <td className="px-2 py-1.5 text-right">{r.defectHighCap || '—'}</td>
                    <td className="px-2 py-1.5 text-right">{r.defectLowCap || '—'}</td>
                    <td className="px-2 py-1.5 text-right">{r.defectDF || '—'}</td>
                    <td className="px-2 py-1.5">{r.operator}</td>
                    <td className="px-2 py-1.5 max-w-[120px] truncate">{r.notes}</td>
                    <td className="px-2 py-1.5">{r.reworkOrderNo}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEdit(r)} className="p-1 text-indigo-500 hover:text-indigo-700" title="编辑">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button onClick={() => deleteRecord(r.id)} className="p-1 text-red-400 hover:text-red-600" title="删除">
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
        )}
      </div>

      {/* ── 录入/编辑表单弹窗 ── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
              <h2 className="text-lg font-bold text-gray-900">{editingId ? '编辑记录' : '录入记录'}</h2>
              <button onClick={() => setShowForm(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* 基本信息 */}
              <div>
                <h3 className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">基本信息</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">录入日期</label>
                    <input type="date" value={form.entryDate} onChange={(e) => setForm((f) => ({ ...f, entryDate: e.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">序号</label>
                    {textInput('seq', '自动编号')}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">物料代码 <span className="text-red-400">*</span></label>
                    {textInput('materialCode', 'H1.HK.2G.6023')}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">规格</label>
                    {textInput('spec', '400V680uF')}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">尺寸</label>
                    {textInput('size', '35*60')}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">流转单号 <span className="text-red-400">*</span></label>
                    {textInput('workOrderNo', '2511001')}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">正箔电压</label>
                    {textInput('positiveFoilVoltage', '560V')}
                  </div>
                </div>
              </div>

              {/* 数量统计（自动计算） */}
              <div>
                <h3 className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">数量统计</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">设计数量</label>
                    {numInput('designQty')}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">卷绕数</label>
                    {numInput('windingQty')}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">良品数 <span className="text-red-400">*</span></label>
                    {numInput('goodQty')}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">实际此单总数（自动）</label>
                    <div className="px-2.5 py-2 bg-blue-50 rounded-lg text-sm font-medium text-blue-700 border border-blue-200">{form.actualQty}</div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">损耗（自动，%）</label>
                    <div className={`px-2.5 py-2 rounded-lg text-sm font-medium border ${
                      form.loss > 0 ? 'bg-red-50 text-red-600 border-red-200' :
                      form.loss < 0 ? 'bg-amber-50 text-amber-600 border-amber-200' :
                      'bg-gray-50 text-gray-500 border-gray-200'
                    }`}>{form.designQty > 0 ? `${form.loss}%` : '—'}</div>
                  </div>
                </div>
              </div>

              {/* 良率统计（自动计算） */}
              <div>
                <h3 className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">良率统计（%）</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">一次底凸短路爆破率（自动）</label>
                    <div className="px-2.5 py-2 bg-blue-50 rounded-lg text-sm font-medium text-blue-700 border border-blue-200">{form.windingQty > 0 ? `${form.firstBottomConvexShortBurstRate}%` : '—'}</div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">一次直通率（自动）</label>
                    <div className="px-2.5 py-2 bg-blue-50 rounded-lg text-sm font-medium text-blue-700 border border-blue-200">{form.actualQty > 0 ? `${form.firstPassRate}%` : '—'}</div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">整批良率</label>
                    {numInput('batchYieldRate')}
                  </div>
                </div>
              </div>

              {/* 不良明细 */}
              <div>
                <h3 className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-3">不良明细</h3>
                <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
                  {(['defectShort','defectBurst','defectBottomConvex','defectVoltage','defectAppearance','defectLeakage','defectHighCap','defectLowCap','defectDF'] as const).map((field) => (
                    <div key={field}>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        {field === 'defectShort' ? '短路' :
                         field === 'defectBurst' ? '爆破' :
                         field === 'defectBottomConvex' ? '底凸' :
                         field === 'defectVoltage' ? '耐压' :
                         field === 'defectAppearance' ? '外观' :
                         field === 'defectLeakage' ? '漏电' :
                         field === 'defectHighCap' ? '高容' :
                         field === 'defectLowCap' ? '低容' : 'DF'}
                      </label>
                      {numInput(field)}
                    </div>
                  ))}
                </div>
              </div>

              {/* 其他 */}
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">其他</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">作业员</label>
                    {textInput('operator')}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">重工单号</label>
                    {textInput('reworkOrderNo')}
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-xs font-medium text-gray-500 mb-1">备注</label>
                    <textarea value={(form as ProductionRecord).notes || ''}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                      rows={2} className={inputCls} placeholder="备注信息…" />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 sticky bottom-0 bg-white rounded-b-2xl">
              <button onClick={() => setShowForm(false)} className="px-5 py-2 text-sm text-gray-600 hover:text-gray-800 transition">取消</button>
              <button onClick={saveRecord} disabled={saving}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm">
                {saving ? '保存中…' : (editingId ? '保存修改' : '确认添加')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="bg-gray-800 text-white text-sm px-5 py-2.5 rounded-full shadow-lg">
            {toastMsg}
          </div>
        </div>
      )}
    </div>
  );
}
