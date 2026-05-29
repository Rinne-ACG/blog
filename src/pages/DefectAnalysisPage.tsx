import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { albums } from './GalleryPage';
import type { DefectAnalysisRecord } from '../types';

/* ─── 工具函数 ─── */
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const num = (v: unknown) => Number(v) || 0;
const str = (v: unknown) => String(v ?? '');
const formatNum = (n: number): string => {
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};

const emptyRecord = (): DefectAnalysisRecord => ({
  id: generateUUID(),
  entryDate: new Date().toISOString().slice(0, 10),
  seq: '',
  workOrderNo: '',
  specSize: '',
  foilSupplier: '',
  foilVoltage: '',
  foilBatchNo: '',
  faultJudgment: '',
  chargeQty: 0,
  defectQty: 0,
  goodRechargeDefect: 0,
  defectRechargeDefect: 0,
  defectCause: '',
  notes: '',
});

/* ─── 本地 Sheet 类型 ─── */
interface LocalSheet {
  id: string;
  name: string;
}

/* ─── Excel 导出列定义 ─── */
const EXPORT_COLUMNS: { key: keyof DefectAnalysisRecord; label: string; width: number }[] = [
  { key: 'entryDate',            label: '日期',         width: 12 },
  { key: 'seq',                  label: '序号',         width: 8  },
  { key: 'workOrderNo',          label: '流转单号',     width: 14 },
  { key: 'specSize',             label: '规格尺寸',     width: 16 },
  { key: 'foilSupplier',         label: '正箔供应商',   width: 14 },
  { key: 'foilVoltage',          label: '正箔电压',     width: 10 },
  { key: 'foilBatchNo',          label: '正箔批号',     width: 14 },
  { key: 'faultJudgment',        label: '异常责任判定', width: 14 },
  { key: 'chargeQty',            label: '充电数量',     width: 10 },
  { key: 'defectQty',            label: '不良数',       width: 10 },
  { key: 'goodRechargeDefect',   label: '良品反充不良数',   width: 14 },
  { key: 'defectRechargeDefect', label: '不良品反充不良数', width: 14 },
  { key: 'defectCause',          label: '不良原因分析', width: 30 },
  { key: 'notes',                label: '备注',         width: 20 },
];

/* ═══════════════════════════════════════════════════
   筛选下拉子组件
═══════════════════════════════════════════════════ */
function FilterDropdown({
  fieldKey, uniqueVals, selected, onChange, onClose,
}: {
  fieldKey: string;
  uniqueVals: string[];
  selected: Set<string>;
  onChange: (field: string, newSelected: Set<string>) => void;
  onClose: () => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const filtered = searchTerm.trim()
    ? uniqueVals.filter(v => v.toLowerCase().includes(searchTerm.trim().toLowerCase()))
    : uniqueVals;
  const allSelected = uniqueVals.length > 0 && selected.size === uniqueVals.length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50 flex-shrink-0">
        <span className="text-xs font-medium text-gray-600">
          筛选（{selected.size}/{uniqueVals.length}）
        </span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-0.5 rounded flex-shrink-0">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="px-2 py-1.5 border-b border-gray-100 flex-shrink-0">
        <input
          type="text"
          placeholder="搜索..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          onClick={e => e.stopPropagation()}
          className="w-full text-xs px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-emerald-300"
          autoFocus
        />
      </div>
      <div className="flex-shrink-0 px-2 py-1 border-b border-gray-50">
        <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5"
          onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={allSelected}
            onChange={() => onChange(fieldKey, allSelected ? new Set() : new Set(uniqueVals))}
            className="w-3 h-3 accent-emerald-600" />
          <span className="text-xs text-gray-600 font-medium">全选</span>
        </label>
      </div>
      <div className="overflow-y-auto flex-1 px-2 py-1">
        {filtered.map(v => (
          <label key={v} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5"
            onClick={e => e.stopPropagation()}>
            <input type="checkbox" checked={selected.has(v)}
              onChange={() => {
                const next = new Set(selected);
                if (next.has(v)) next.delete(v); else next.add(v);
                onChange(fieldKey, next);
              }}
              className="w-3 h-3 accent-emerald-600" />
            <span className="text-xs text-gray-700 truncate max-w-[160px]" title={v}>{v || '（空）'}</span>
          </label>
        ))}
        {filtered.length === 0 && <p className="text-xs text-gray-400 text-center py-2">无匹配项</p>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   主组件
═══════════════════════════════════════════════════ */
export default function DefectAnalysisPage() {
  const navigate = useNavigate();

  /* ─── 工作表 ─── */
  const [sheets, setSheets] = useState<LocalSheet[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [newSheetName, setNewSheetName] = useState('');
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null);
  const [editingSheetName, setEditingSheetName] = useState('');
  const [sheetLoading, setSheetLoading] = useState(true);

  /* ─── 记录数据 ─── */
  const [sheetRecords, setSheetRecords] = useState<DefectAnalysisRecord[]>([]);
  const [recordLoading, setRecordLoading] = useState(false);

  /* ─── 表单弹窗 ─── */
  const [showForm, setShowForm] = useState(false);
  const [editingRecord, setEditingRecord] = useState<DefectAnalysisRecord | null>(null);
  const [formData, setFormData] = useState<DefectAnalysisRecord>(emptyRecord());

  /* ─── 删除确认 ─── */
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteSheetConfirmId, setDeleteSheetConfirmId] = useState<string | null>(null);

  /* ─── 筛选 / 排序 ─── */
  const [filterValues, setFilterValues] = useState<Record<string, Set<string>>>({});
  const [openFilterField, setOpenFilterField] = useState<string | null>(null);
  const [filterPos, setFilterPos] = useState<{ top: number; left: number } | null>(null);
  const [sortField, setSortField] = useState<keyof DefectAnalysisRecord | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  /* ─── 图片预览 ─── */
  const [lightboxImg, setLightboxImg] = useState<{ src: string; caption?: string; idx: number; list: { src: string; caption?: string }[] } | null>(null);

  /* ─── 添加图片 ─── */
  const [newImages, setNewImages] = useState<{ id: string; file: File; caption: string; preview: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ─── 提示 ─── */
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  const filterRef = useRef<HTMLDivElement>(null);

  /* ─── 点击外部关闭筛选 ─── */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setOpenFilterField(null);
        setFilterPos(null);
      }
    };
    if (openFilterField) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openFilterField]);

  /* ─── 加载工作表列表 ─── */
  useEffect(() => {
    const load = async () => {
      setSheetLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/login', { replace: true }); return; }
      const { data, error } = await supabase
        .from('defect_sheets')
        .select('id, name, order')
        .order('order', { ascending: true });
      if (error) { showToast('加载工作表失败', 'error'); setSheetLoading(false); return; }
      const list: LocalSheet[] = (data || []).map((s: { id: string; name: string }) => ({
        id: s.id, name: s.name,
      }));
      setSheets(list);
      if (list.length > 0) setActiveSheetId(list[0].id);
      setSheetLoading(false);
    };
    load();
  }, [navigate]);

  /* ─── 加载记录 ─── */
  useEffect(() => {
    if (!activeSheetId) { setSheetRecords([]); return; }
    const load = async () => {
      setRecordLoading(true);
      const { data, error } = await supabase
        .from('defect_records')
        .select('*')
        .eq('sheet_id', activeSheetId)
        .order('entry_date', { ascending: true });
      if (error) { showToast('加载记录失败', 'error'); setRecordLoading(false); return; }
      const records: DefectAnalysisRecord[] = (data || []).map((r: Record<string, unknown>) => ({
        id: str(r.id),
        entryDate: str(r.entry_date),
        seq: str(r.seq),
        workOrderNo: str(r.work_order_no),
        specSize: str(r.spec_size),
        foilSupplier: str(r.foil_supplier),
        foilVoltage: str(r.foil_voltage),
        foilBatchNo: str(r.foil_batch_no),
        faultJudgment: str(r.fault_judgment),
        chargeQty: num(r.charge_qty),
        defectQty: num(r.defect_qty),
        goodRechargeDefect: num(r.good_recharge_defect),
        defectRechargeDefect: num(r.defect_recharge_defect),
        defectCause: str(r.defect_cause),
        notes: str(r.notes),
      }));
      setSheetRecords(records);
      setRecordLoading(false);
    };
    load();
  }, [activeSheetId]);

  /* ─── 筛选 + 排序 ─── */
  const filteredSorted = useCallback(() => {
    let list = [...sheetRecords];
    // 筛选
    Object.entries(filterValues).forEach(([field, selected]) => {
      if (selected.size === 0) return;
      list = list.filter(r => selected.has(String(r[field as keyof DefectAnalysisRecord] ?? '')));
    });
    // 排序
    if (sortField) {
      list.sort((a, b) => {
        const va = a[sortField]; const vb = b[sortField];
        const na = Number(va); const nb = Number(vb);
        let cmp = 0;
        if (!isNaN(na) && !isNaN(nb)) cmp = na - nb;
        else cmp = String(va ?? '').localeCompare(String(vb ?? ''));
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }, [sheetRecords, filterValues, sortField, sortDir]);

  /* ─── 汇总 ─── */
  const summary = useCallback(() => {
    const rows = filteredSorted();
    return {
      count: rows.length,
      totalChargeQty: rows.reduce((s, r) => s + r.chargeQty, 0),
      totalDefectQty: rows.reduce((s, r) => s + r.defectQty, 0),
      totalGoodRecharge: rows.reduce((s, r) => s + r.goodRechargeDefect, 0),
      totalDefectRecharge: rows.reduce((s, r) => s + r.defectRechargeDefect, 0),
    };
  }, [filteredSorted]);

  /* ─── 获取字段唯一值（用于筛选） ─── */
  const getUniqueVals = (field: keyof DefectAnalysisRecord) => {
    const seen = new Set<string>();
    const result: string[] = [];
    sheetRecords.forEach(r => {
      const v = String(r[field] ?? '');
      if (!seen.has(v)) { seen.add(v); result.push(v); }
    });
    return result;
  };

  /* ─── 获取字段历史值（用于 datalist 建议） ─── */
  const getFieldOptions = (field: keyof DefectAnalysisRecord) => {
    const seen = new Set<string>();
    const result: string[] = [];
    sheetRecords.forEach(r => {
      const v = String(r[field] ?? '').trim();
      if (v && !seen.has(v)) { seen.add(v); result.push(v); }
    });
    return result;
  };

  /* ─── 切换排序 ─── */
  const handleSort = (field: keyof DefectAnalysisRecord) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  /* ─── 新建工作表 ─── */
  const handleCreateSheet = async () => {
    const name = newSheetName.trim();
    if (!name) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const id = generateUUID();
    const { error } = await supabase.from('defect_sheets').insert({
      id, name, user_id: user.id, order: sheets.length,
    });
    if (error) { showToast('创建失败', 'error'); return; }
    const ns: LocalSheet = { id, name };
    setSheets(prev => [...prev, ns]);
    setActiveSheetId(id);
    setNewSheetName('');
    showToast('工作表已创建');
  };

  /* ─── 重命名工作表 ─── */
  const handleRenameSheet = async () => {
    const name = editingSheetName.trim();
    if (!name || !editingSheetId) return;
    const { error } = await supabase.from('defect_sheets').update({ name }).eq('id', editingSheetId);
    if (error) { showToast('重命名失败', 'error'); return; }
    setSheets(prev => prev.map(s => s.id === editingSheetId ? { ...s, name } : s));
    setEditingSheetId(null);
    showToast('已重命名');
  };

  /* ─── 删除工作表 ─── */
  const handleDeleteSheet = async (id: string) => {
    await supabase.from('defect_records').delete().eq('sheet_id', id);
    const { error } = await supabase.from('defect_sheets').delete().eq('id', id);
    if (error) { showToast('删除失败', 'error'); return; }
    const remaining = sheets.filter(s => s.id !== id);
    setSheets(remaining);
    setDeleteSheetConfirmId(null);
    if (activeSheetId === id) setActiveSheetId(remaining[0]?.id ?? null);
    showToast('工作表已删除');
  };

  /* ─── 新增 / 编辑记录 ─── */
  const openNewForm = () => {
    setEditingRecord(null);
    setFormData(emptyRecord());
    setShowForm(true);
  };
  const openEditForm = (r: DefectAnalysisRecord) => {
    setEditingRecord(r);
    setFormData({ ...r });
    setShowForm(true);
    // 重置新图片状态
    newImages.forEach(img => URL.revokeObjectURL(img.preview));
    setNewImages([]);
  };

  /* ─── 图片选择与上传 ─── */

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !editingRecord?.workOrderNo) return;
    const added: typeof newImages = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      const id = Math.random().toString(36).slice(2, 9);
      added.push({
        id,
        file,
        caption: file.name.replace(/\.[^.]+$/, ''),
        preview: URL.createObjectURL(file),
      });
    }
    setNewImages(prev => [...prev, ...added]);
    e.target.value = '';
  };

  const handleRemoveNewImage = (id: string) => {
    setNewImages(prev => {
      const item = prev.find(i => i.id === id);
      if (item) URL.revokeObjectURL(item.preview);
      return prev.filter(i => i.id !== id);
    });
  };

  const handleUpdateCaption = (id: string, caption: string) => {
    setNewImages(prev => prev.map(i => (i.id === id ? { ...i, caption } : i)));
  };

  /** 将新图片转为 base64 并调用 API 上传 */
  const uploadNewImages = async (): Promise<boolean> => {
    if (!newImages.length || !editingRecord?.workOrderNo) return true;
    setUploading(true);
    try {
      const imagesData = await Promise.all(
        newImages.map(async img => ({
          name: img.file.name,
          data: await fileToBase64(img.file),
        }))
      );
      const res = await fetch('/api/upload-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ album: editingRecord.workOrderNo, images: imagesData }),
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.error || 'Upload failed');
      newImages.forEach(img => URL.revokeObjectURL(img.preview));
      setNewImages([]);
      showToast(`成功添加 ${result.files.length} 张图片`);
      return true;
    } catch (err) {
      showToast(`图片上传失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
      return false;
    } finally {
      setUploading(false);
    }
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleSaveRecord = async () => {
    if (!activeSheetId) return;
    const row = { ...formData };
    if (!row.entryDate) row.entryDate = new Date().toISOString().slice(0, 10);

    const dbRow = {
      id: row.id,
      sheet_id: activeSheetId,
      entry_date: row.entryDate,
      seq: row.seq,
      work_order_no: row.workOrderNo,
      spec_size: row.specSize,
      foil_supplier: row.foilSupplier,
      foil_voltage: row.foilVoltage,
      foil_batch_no: row.foilBatchNo,
      fault_judgment: row.faultJudgment,
      charge_qty: row.chargeQty,
      defect_qty: row.defectQty,
      good_recharge_defect: row.goodRechargeDefect,
      defect_recharge_defect: row.defectRechargeDefect,
      defect_cause: row.defectCause,
      notes: row.notes,
    };

    if (editingRecord) {
      const { error } = await supabase.from('defect_records').update(dbRow).eq('id', row.id);
      if (error) { showToast('保存失败', 'error'); return; }
      setSheetRecords(prev => prev.map(r => r.id === row.id ? row : r));
      // 上传新图片
      await uploadNewImages();
      showToast('已更新');
    } else {
      const { error } = await supabase.from('defect_records').insert(dbRow);
      if (error) { showToast('新增失败', 'error'); return; }
      setSheetRecords(prev => [...prev, row]);
      showToast('已新增');
    }
    setShowForm(false);
  };

  /* ─── 双击行编辑 ─── */
  const handleRowDoubleClick = (r: DefectAnalysisRecord) => openEditForm(r);

  /* ─── 删除记录 ─── */
  const handleDeleteRecord = async (id: string) => {
    const { error } = await supabase.from('defect_records').delete().eq('id', id);
    if (error) { showToast('删除失败', 'error'); return; }
    setSheetRecords(prev => prev.filter(r => r.id !== id));
    setDeleteConfirmId(null);
    showToast('已删除');
  };

  /* ─── Excel 导入 ─── */
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeSheetId) return;
    e.target.value = '';

    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 }) as unknown[][];
    if (raw.length < 2) { showToast('文件内容为空', 'error'); return; }

    // 找表头行
    const KEYWORDS = ['日期', '流转单号', '规格尺寸', '充电数量'];
    let headerIdx = -1;
    for (let i = 0; i < Math.min(raw.length, 10); i++) {
      const row = (raw[i] as unknown[]).map(c => c == null ? '' : String(c).replace(/\n|\r/g, '').trim());
      if (KEYWORDS.filter(kw => row.includes(kw)).length >= 2) { headerIdx = i; break; }
    }
    if (headerIdx === -1) headerIdx = 0;

    const headers = (raw[headerIdx] as unknown[]).map(h => h == null ? '' : String(h).replace(/\n|\r/g, '').trim());
    const colMap: Record<string, number> = {};
    headers.forEach((h, i) => { if (h) colMap[h] = i; });

    const dataRows = raw.slice(headerIdx + 1).filter(
      row => row && (row as unknown[]).some(c => c != null && c !== '')
    );

    const imported: DefectAnalysisRecord[] = dataRows.map(row => {
      const g = (keys: string[]) => {
        for (const k of keys) {
          const idx = colMap[k];
          if (idx !== undefined && (row as unknown[])[idx] != null && (row as unknown[])[idx] !== '') return (row as unknown[])[idx];
        }
        return '';
      };
      let entryDate = '';
      const rawDate = g(['日期', '录入日期']);
      if (rawDate instanceof Date) entryDate = rawDate.toISOString().slice(0, 10);
      else if (typeof rawDate === 'number') {
        const d = XLSX.SSF.parse_date_code(rawDate);
        entryDate = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
      } else entryDate = str(rawDate).slice(0, 10);
      if (!entryDate) entryDate = new Date().toISOString().slice(0, 10);

      return {
        id: generateUUID(),
        entryDate,
        seq: str(g(['序号'])),
        workOrderNo: str(g(['流转单号'])),
        specSize: str(g(['规格尺寸'])),
        foilSupplier: str(g(['正箔供应商'])),
        foilVoltage: str(g(['正箔电压'])),
        foilBatchNo: str(g(['正箔批号'])),
        faultJudgment: str(g(['异常责任判定'])),
        chargeQty: num(g(['充电数量'])),
        defectQty: num(g(['不良数'])),
        goodRechargeDefect: num(g(['良品反充不良数'])),
        defectRechargeDefect: num(g(['不良品反充不良数'])),
        defectCause: str(g(['不良原因分析'])),
        notes: str(g(['备注'])),
      };
    }).filter(r => r.workOrderNo || r.entryDate);

    if (imported.length === 0) { showToast('未识别到有效数据', 'error'); return; }

    // 批量写入
    const dbRows = imported.map(r => ({
      id: r.id, sheet_id: activeSheetId,
      entry_date: r.entryDate, seq: r.seq,
      work_order_no: r.workOrderNo, spec_size: r.specSize,
      foil_supplier: r.foilSupplier, foil_voltage: r.foilVoltage,
      foil_batch_no: r.foilBatchNo, fault_judgment: r.faultJudgment,
      charge_qty: r.chargeQty, defect_qty: r.defectQty,
      good_recharge_defect: r.goodRechargeDefect,
      defect_recharge_defect: r.defectRechargeDefect,
      defect_cause: r.defectCause, notes: r.notes,
    }));
    const { error } = await supabase.from('defect_records').insert(dbRows);
    if (error) { showToast('导入失败：' + error.message, 'error'); return; }
    setSheetRecords(prev => [...prev, ...imported]);
    showToast(`成功导入 ${imported.length} 条记录`);
  };

  /* ─── Excel 导出 ─── */
  const handleExport = () => {
    const rows = filteredSorted();
    if (rows.length === 0) { showToast('没有可导出的数据', 'error'); return; }
    const header = EXPORT_COLUMNS.map(c => c.label);
    // 合并表头（异常详情 跨4列）
    const mergeHeader = ['日期', '序号', '流转单号', '规格尺寸', '正箔供应商', '正箔电压', '正箔批号',
      '异常责任判定', '异常详情', '', '', '', '不良原因分析', '备注'];
    const subHeader = ['', '', '', '', '', '', '', '', '充电数量', '不良数', '良品反充不良数', '不良品反充不良数', '', ''];

    const data = rows.map(r => EXPORT_COLUMNS.map(c => {
      const v = r[c.key];
      return (typeof v === 'number') ? v : (v ?? '');
    }));

    const ws = XLSX.utils.aoa_to_sheet([mergeHeader, subHeader, ...data]);
    // 合并"异常详情"单元格
    ws['!merges'] = [{ s: { r: 0, c: 8 }, e: { r: 0, c: 11 } }];
    ws['!cols'] = EXPORT_COLUMNS.map(c => ({ wch: c.width }));
    const wb = XLSX.utils.book_new();
    const sheetName = sheets.find(s => s.id === activeSheetId)?.name ?? '不良分析';
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `不良分析_${sheetName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast('导出成功');
  };

  /* ─── datalist 输入框 ─── */
  const textInputWithDatalist = (field: keyof DefectAnalysisRecord, placeholder: string, listId: string) => (
    <>
      <input
        type="text"
        list={listId}
        value={str(formData[field])}
        onChange={e => setFormData(prev => ({ ...prev, [field]: e.target.value }))}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
      />
      <datalist id={listId}>
        {getFieldOptions(field).map(v => <option key={v} value={v} />)}
      </datalist>
    </>
  );

  /* ─── 渲染 ─── */
  const displayRows = filteredSorted();
  const sum = summary();
  const activeSheet = sheets.find(s => s.id === activeSheetId);

  if (sheetLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-600" />
      </div>
    );
  }

  return (
    <div className="max-w-full mx-auto px-3 py-6 overflow-x-auto">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium transition-all
          ${toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}>
          {toast.msg}
        </div>
      )}

      {/* 页面标题 */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">不良分析统计</h1>
        <p className="text-gray-500 text-sm mt-1">牛角车间 · 不良品充电异常分析记录</p>
      </div>

      {/* 工作表栏 */}
      <div className="flex flex-wrap items-center gap-2 mb-4 bg-white rounded-xl p-3 shadow-sm border border-gray-100">
        {sheets.map(s => (
          <div key={s.id} className="relative group">
            {editingSheetId === s.id ? (
              <div className="flex items-center gap-1">
                <input
                  value={editingSheetName}
                  onChange={e => setEditingSheetName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleRenameSheet(); if (e.key === 'Escape') setEditingSheetId(null); }}
                  className="w-28 text-sm px-2 py-1 border border-slate-300 rounded focus:outline-none"
                  autoFocus
                />
                <button onClick={handleRenameSheet} className="text-green-600 hover:text-green-700 text-xs font-medium">✓</button>
                <button onClick={() => setEditingSheetId(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
              </div>
            ) : (
              <button
                onClick={() => { setActiveSheetId(s.id); setFilterValues({}); setSortField(null); }}
                onDoubleClick={() => { setEditingSheetId(s.id); setEditingSheetName(s.name); }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeSheetId === s.id ? 'bg-slate-700 text-white shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {s.name}
              </button>
            )}
            {/* 删除按钮 */}
            {deleteSheetConfirmId === s.id ? (
              <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-red-200 rounded-lg shadow-lg p-2 flex gap-2 whitespace-nowrap">
                <span className="text-xs text-red-600">确认删除？</span>
                <button onClick={() => handleDeleteSheet(s.id)} className="text-xs text-red-600 font-medium hover:underline">是</button>
                <button onClick={() => setDeleteSheetConfirmId(null)} className="text-xs text-gray-500 hover:underline">否</button>
              </div>
            ) : (
              <button
                onClick={() => setDeleteSheetConfirmId(s.id)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full text-xs hidden group-hover:flex items-center justify-center leading-none"
              >×</button>
            )}
          </div>
        ))}
        {/* 新建工作表 */}
        <div className="flex items-center gap-1 ml-2">
          <input
            value={newSheetName}
            onChange={e => setNewSheetName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateSheet(); }}
            placeholder="新工作表名..."
            className="w-28 text-sm px-2 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-300"
          />
          <button onClick={handleCreateSheet}
            className="px-2.5 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200 transition-colors font-medium">
            + 新建
          </button>
        </div>
      </div>

      {/* 操作栏 */}
      {activeSheetId && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button onClick={openNewForm}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 shadow-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新增记录
          </button>
          <label className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 cursor-pointer shadow-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            导入 Excel
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
          </label>
          <button onClick={handleExport}
            className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 shadow-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            导出 Excel
          </button>
          {Object.values(filterValues).some(s => s.size > 0) && (
            <button onClick={() => setFilterValues({})}
              className="flex items-center gap-1 px-3 py-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-sm hover:bg-amber-100">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              清除筛选
            </button>
          )}
          <span className="ml-auto text-sm text-gray-500">
            共 <span className="font-semibold text-gray-800">{displayRows.length}</span>
            {displayRows.length !== sheetRecords.length && (
              <span className="text-amber-600"> / {sheetRecords.length}</span>
            )} 条
          </span>
        </div>
      )}

      {/* 主表格 */}
      {activeSheetId ? (
        recordLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-slate-600" />
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl shadow-sm border border-gray-200 bg-white" ref={filterRef}>
            <table className="min-w-full text-sm border-collapse">
              <thead>
                {/* 第一行：主表头（含分组）*/}
                <tr className="bg-slate-700 text-white">
                  {[
                    { label: '日期', field: 'entryDate', rowSpan: 2, colSpan: 1 },
                    { label: '序号', field: 'seq', rowSpan: 2, colSpan: 1 },
                    { label: '流转单号', field: 'workOrderNo', rowSpan: 2, colSpan: 1 },
                    { label: '规格尺寸', field: 'specSize', rowSpan: 2, colSpan: 1 },
                    { label: '正箔供应商', field: 'foilSupplier', rowSpan: 2, colSpan: 1 },
                    { label: '正箔电压', field: 'foilVoltage', rowSpan: 2, colSpan: 1 },
                    { label: '正箔批号', field: 'foilBatchNo', rowSpan: 2, colSpan: 1 },
                    { label: '异常责任判定', field: 'faultJudgment', rowSpan: 2, colSpan: 1 },
                  ].map(col => (
                    <th
                      key={col.field}
                      rowSpan={col.rowSpan}
                      colSpan={col.colSpan}
                      className="px-2 py-2 text-left font-semibold text-xs whitespace-nowrap border-r border-slate-500 cursor-pointer select-none relative"
                      onClick={() => handleSort(col.field as keyof DefectAnalysisRecord)}
                    >
                      <div className="flex items-center gap-1">
                        <span>{col.label}</span>
                        {/* 筛选按钮 */}
                        <button
                          className={`p-0.5 rounded hover:bg-slate-600 ${
                            filterValues[col.field]?.size ? 'text-amber-400' : 'text-slate-300'}`}
                          onClick={e => { e.stopPropagation(); const btn = e.currentTarget; const r = btn.getBoundingClientRect(); setOpenFilterField(openFilterField === col.field ? null : col.field); setFilterPos({ top: r.bottom + 4, left: r.left }); }}
                        >
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L13 10.414V17a1 1 0 01-1.447.894l-4-2A1 1 0 017 15V10.414L3.293 6.707A1 1 0 013 6V3z" />
                          </svg>
                        </button>
                        {sortField === col.field && (
                          <span className="text-xs">{sortDir === 'asc' ? '↑' : '↓'}</span>
                        )}
                        {/* 筛选下拉 */}
                        {openFilterField === col.field && (
                          <div className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-2xl w-52"
                            style={{ top: filterPos?.top ?? 0, left: filterPos?.left ?? 0 }}
                            onClick={e => e.stopPropagation()}>
                            <FilterDropdown
                              fieldKey={col.field}
                              uniqueVals={getUniqueVals(col.field as keyof DefectAnalysisRecord)}
                              selected={filterValues[col.field] ?? new Set()}
                              onChange={(f, s) => setFilterValues(prev => ({ ...prev, [f]: s }))}
                              onClose={() => { setOpenFilterField(null); setFilterPos(null); }}
                            />
                          </div>
                        )}
                      </div>
                    </th>
                  ))}
                  {/* 异常详情（跨 4 列）*/}
                  <th colSpan={4} className="px-2 py-2 text-center font-semibold text-xs border-r border-slate-500">
                    异常详情
                  </th>
                  {[
                    { label: '不良原因分析', field: 'defectCause' },
                    { label: '备注', field: 'notes' },
                  ].map(col => (
                    <th key={col.field} rowSpan={2}
                      className="px-2 py-2 text-left font-semibold text-xs whitespace-nowrap border-r border-slate-500 cursor-pointer select-none"
                      onClick={() => handleSort(col.field as keyof DefectAnalysisRecord)}
                    >
                      {col.label}
                    </th>
                  ))}
                  <th rowSpan={2} className="px-2 py-2 text-center font-semibold text-xs whitespace-nowrap">操作</th>
                </tr>
                {/* 第二行：异常详情子表头 */}
                <tr className="bg-slate-600 text-white">
                  {[
                    { label: '充电数量', field: 'chargeQty' },
                    { label: '不良数', field: 'defectQty' },
                    { label: '良品反充不良数', field: 'goodRechargeDefect' },
                    { label: '不良品反充不良数', field: 'defectRechargeDefect' },
                  ].map(col => (
                    <th key={col.field}
                      className="px-2 py-1.5 text-left text-xs whitespace-nowrap border-r border-slate-500 cursor-pointer select-none relative"
                      onClick={() => handleSort(col.field as keyof DefectAnalysisRecord)}
                    >
                      <div className="flex items-center gap-1">
                        <span>{col.label}</span>
                        {/* 筛选按钮 */}
                        <button
                          className={`p-0.5 rounded hover:bg-slate-500 ${filterValues[col.field]?.size ? 'text-amber-400' : 'text-slate-300'}`}
                          onClick={e => { e.stopPropagation(); const btn = e.currentTarget; const r = btn.getBoundingClientRect(); setOpenFilterField(openFilterField === col.field ? null : col.field); setFilterPos({ top: r.bottom + 4, left: r.left }); }}
                        >
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L13 10.414V17a1 1 0 01-1.447.894l-4-2A1 1 0 017 15V10.414L3.293 6.707A1 1 0 013 6V3z" />
                          </svg>
                        </button>
                        {sortField === col.field && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                        {openFilterField === col.field && (
                          <div className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-2xl w-52"
                            style={{ top: filterPos?.top ?? 0, left: filterPos?.left ?? 0 }}
                            onClick={e => e.stopPropagation()}>
                            <FilterDropdown
                              fieldKey={col.field}
                              uniqueVals={getUniqueVals(col.field as keyof DefectAnalysisRecord)}
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
                {displayRows.map((r, idx) => (
                  <tr
                    key={r.id}
                    onDoubleClick={() => handleRowDoubleClick(r)}
                    className={`border-b border-gray-100 hover:bg-slate-50 transition-colors cursor-pointer
                      ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                  >
                    <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap text-center">{r.entryDate}</td>
                    <td className="px-2 py-1.5 text-gray-600 text-center">{r.seq}</td>
                    <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap text-center">{r.workOrderNo}</td>
                    <td className="px-2 py-1.5 text-gray-700 text-center">{r.specSize}</td>
                    <td className="px-2 py-1.5 text-gray-700 text-center">{r.foilSupplier}</td>
                    <td className="px-2 py-1.5 text-gray-700 text-center">{r.foilVoltage}</td>
                    <td className="px-2 py-1.5 text-gray-700 text-center">{r.foilBatchNo}</td>
                    <td className="px-2 py-1.5 text-center">
                      {r.faultJudgment && (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium
                          ${r.faultJudgment.includes('供应商') ? 'bg-red-100 text-red-700' :
                            r.faultJudgment.includes('自制') ? 'bg-orange-100 text-orange-700' :
                            'bg-gray-100 text-gray-700'}`}>
                          {r.faultJudgment}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center tabular-nums">{formatNum(r.chargeQty)}</td>
                    <td className="px-2 py-1.5 text-center tabular-nums">{formatNum(r.defectQty)}</td>
                    <td className="px-2 py-1.5 text-center tabular-nums">{formatNum(r.goodRechargeDefect)}</td>
                    <td className="px-2 py-1.5 text-center tabular-nums">{formatNum(r.defectRechargeDefect)}</td>
                    <td className="px-2 py-1.5 text-gray-600 max-w-[200px] truncate text-center" title={r.defectCause}>{r.defectCause}</td>
                    <td className="px-2 py-1.5 text-gray-500 max-w-[120px] truncate text-center" title={r.notes}>{r.notes}</td>
                    <td className="px-2 py-1.5 text-center whitespace-nowrap">
                      <button onClick={() => openEditForm(r)}
                        className="text-emerald-600 hover:text-emerald-700 text-xs mr-2 font-medium">编辑</button>
                      {deleteConfirmId === r.id ? (
                        <>
                          <button onClick={() => handleDeleteRecord(r.id)}
                            className="text-red-600 hover:text-red-800 text-xs font-medium mr-1">确认</button>
                          <button onClick={() => setDeleteConfirmId(null)}
                            className="text-gray-400 hover:text-gray-600 text-xs">取消</button>
                        </>
                      ) : (
                        <button onClick={() => setDeleteConfirmId(r.id)}
                          className="text-red-400 hover:text-red-600 text-xs font-medium">删除</button>
                      )}
                    </td>
                  </tr>
                ))}
                {displayRows.length === 0 && (
                  <tr>
                    <td colSpan={15} className="text-center py-12 text-gray-400">
                      <div className="flex flex-col items-center gap-2">
                        <svg className="w-10 h-10 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span>{sheetRecords.length > 0 ? '筛选结果为空，试试清除筛选条件' : '暂无数据，点击「新增记录」或「导入 Excel」'}</span>
                      </div>
                    </td>
                  </tr>
                )}
                {/* 汇总行 */}
                {displayRows.length > 0 && (
                  <tr className="bg-slate-50 font-semibold text-sm border-t-2 border-slate-300">
                    <td colSpan={8} className="px-3 py-2 text-slate-700">
                      汇总（{sum.count} 条）
                    </td>
                    <td className="px-2 py-2 text-center tabular-nums text-slate-800">{formatNum(sum.totalChargeQty)}</td>
                    <td className="px-2 py-2 text-center tabular-nums text-slate-800">{formatNum(sum.totalDefectQty)}</td>
                    <td className="px-2 py-2 text-center tabular-nums text-slate-800">{formatNum(sum.totalGoodRecharge)}</td>
                    <td className="px-2 py-2 text-center tabular-nums text-slate-800">{formatNum(sum.totalDefectRecharge)}</td>
                    <td colSpan={3} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="text-center py-20 text-gray-400">
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p>请先创建一个工作表</p>
        </div>
      )}

      {/* 新增 / 编辑弹窗 */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingRecord ? '编辑记录' : '新增记录'}
              </h2>
              <button onClick={() => setShowForm(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5 grid grid-cols-2 gap-4">

              {/* 基本信息 */}
              <div className="col-span-2">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">基本信息</h3>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">日期</label>
                <input type="date" value={formData.entryDate}
                  onChange={e => setFormData(prev => ({ ...prev, entryDate: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">序号</label>
                <input type="text" value={formData.seq}
                  onChange={e => setFormData(prev => ({ ...prev, seq: e.target.value }))}
                  placeholder="序号"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">流转单号</label>
                {textInputWithDatalist('workOrderNo', '流转单号', 'dl-workOrderNo')}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">规格尺寸</label>
                {textInputWithDatalist('specSize', '规格尺寸', 'dl-specSize')}
              </div>

              {/* 正箔信息 */}
              <div className="col-span-2">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3 mt-2">正箔信息</h3>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">正箔供应商</label>
                {textInputWithDatalist('foilSupplier', '正箔供应商', 'dl-foilSupplier')}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">正箔电压</label>
                {textInputWithDatalist('foilVoltage', '正箔电压', 'dl-foilVoltage')}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">正箔批号</label>
                {textInputWithDatalist('foilBatchNo', '正箔批号', 'dl-foilBatchNo')}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">异常责任判定</label>
                {textInputWithDatalist('faultJudgment', '如：供应商责任/自制责任', 'dl-faultJudgment')}
              </div>

              {/* 异常详情 */}
              <div className="col-span-2">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3 mt-2">异常详情</h3>
              </div>
              {[
                { field: 'chargeQty' as const, label: '充电数量' },
                { field: 'defectQty' as const, label: '不良数' },
                { field: 'goodRechargeDefect' as const, label: '良品反充不良数' },
                { field: 'defectRechargeDefect' as const, label: '不良品反充不良数' },
              ].map(({ field, label }) => (
                <div key={field}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <input type="number" min={0} value={formData[field]}
                    onChange={e => setFormData(prev => ({ ...prev, [field]: Number(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  />
                </div>
              ))}

              {/* 分析备注 */}
              <div className="col-span-2">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3 mt-2">分析与备注</h3>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">不良原因分析</label>
                <textarea value={formData.defectCause}
                  onChange={e => setFormData(prev => ({ ...prev, defectCause: e.target.value }))}
                  rows={3} placeholder="输入不良原因分析..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-none"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">备注</label>
                <textarea value={formData.notes}
                  onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  rows={2} placeholder="备注（可选）"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-none"
                />
              </div>

              {/* 相册图片 — 仅编辑模式显示 */}
              {editingRecord?.workOrderNo && (
                <div className="col-span-2">
                  <div className="flex items-center justify-between mb-3 mt-3">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      📷 相册图片 · {editingRecord.workOrderNo}
                      {albums[editingRecord.workOrderNo] && `（${albums[editingRecord.workOrderNo].images.length + newImages.length} 张）`}
                    </h3>
                    <button type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      添加图片
                    </button>
                    <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleImageSelect} />
                  </div>

                  {/* 已有图片 */}
                  {albums[editingRecord.workOrderNo] && albums[editingRecord.workOrderNo].images.length > 0 && (
                    <div className="grid grid-cols-4 gap-3 mb-3">
                      {albums[editingRecord.workOrderNo].images.map((img, idx) => (
                        <button key={img.src} type="button"
                          onClick={() => setLightboxImg({ src: img.src, caption: img.caption, idx, list: albums[editingRecord!.workOrderNo].images })}
                          className="group relative aspect-square rounded-xl overflow-hidden border border-gray-200 bg-gray-50 hover:border-emerald-400 hover:shadow-md transition-all cursor-zoom-in">
                          <img src={img.src} alt={img.caption || ''} loading="lazy"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                          {img.caption && (
                            <div className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[10px] px-1.5 py-0.5 truncate">
                              {img.caption}
                            </div>
                          )}
                          <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-[10px]">
                            🔍
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* 新增图片预览 */}
                  {newImages.length > 0 && (
                    <>
                      <div className="text-[11px] font-medium text-emerald-600 mb-2 flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        待保存 · {newImages.length} 张新图片（点击保存后自动上传）
                      </div>
                      <div className="space-y-2 p-3 bg-emerald-50/50 rounded-xl border border-emerald-100">
                        {newImages.map(img => (
                          <div key={img.id} className="flex items-center gap-3 p-2 bg-white rounded-lg border border-emerald-100">
                            <div className="relative w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 border-2 border-dashed border-emerald-300">
                              <img src={img.preview} alt="" className="w-full h-full object-cover" />
                              <span className="absolute -top-1 -right-1 px-1.5 py-0.5 bg-emerald-500 text-white text-[9px] font-bold rounded-full">NEW</span>
                            </div>
                            <input type="text" value={img.caption}
                              onChange={e => handleUpdateCaption(img.id, e.target.value)}
                              placeholder="输入图片标题..."
                              className="flex-1 min-w-0 text-sm px-2 py-1.5 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-300"
                            />
                            <span className="text-[10px] text-gray-400 flex-shrink-0">{(img.file.size / 1024).toFixed(0)}KB</span>
                            <button type="button" onClick={() => handleRemoveNewImage(img.id)}
                              className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors flex-shrink-0">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {!albums[editingRecord.workOrderNo] && newImages.length === 0 && (
                    <p className="text-xs text-gray-400 italic text-center py-4">该流转单号暂无相册，点击上方「添加图片」创建</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 p-5 border-t bg-gray-50 rounded-b-2xl">
              <button onClick={() => setShowForm(false)}
                className="px-5 py-2 text-sm text-gray-600 hover:text-gray-800 font-medium rounded-lg hover:bg-gray-100">
                取消
              </button>
              <button onClick={handleSaveRecord}
                className="px-6 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 shadow-sm">
                {editingRecord ? '保存修改' : '确认新增'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 图片灯箱 */}
      {lightboxImg && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center"
          onClick={e => { if (e.target === e.currentTarget) setLightboxImg(null); }}>
          <div className="relative max-w-4xl w-full mx-4 flex flex-col items-center" onClick={e => e.stopPropagation()}>
            {/* 关闭按钮 */}
            <button onClick={() => setLightboxImg(null)}
              className="absolute -top-10 right-0 text-white/70 hover:text-white text-sm font-medium flex items-center gap-1">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              关闭
            </button>
            {/* 左右切换按钮 */}
            {lightboxImg.idx > 0 && (
              <button onClick={() => {
                const prev = lightboxImg.list[lightboxImg.idx - 1];
                setLightboxImg({ ...prev, idx: lightboxImg.idx - 1, list: lightboxImg.list });
              }}
                className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-12 w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 text-white flex items-center justify-center transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            {lightboxImg.idx < lightboxImg.list.length - 1 && (
              <button onClick={() => {
                const next = lightboxImg.list[lightboxImg.idx + 1];
                setLightboxImg({ ...next, idx: lightboxImg.idx + 1, list: lightboxImg.list });
              }}
                className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-12 w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 text-white flex items-center justify-center transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
            {/* 大图 */}
            <img src={lightboxImg.src} alt={lightboxImg.caption || ''}
              className="max-h-[75vh] max-w-full object-contain rounded-lg shadow-2xl" />
            {/* 标题 */}
            <p className="mt-3 text-white/90 text-sm font-medium">{lightboxImg.caption || ''}</p>
            {/* 缩略图条 */}
            <div className="flex gap-2 mt-3 overflow-x-auto pb-1 max-w-full px-4">
              {lightboxImg.list.map((img, i) => (
                <button key={img.src} type="button"
                  onClick={() => setLightboxImg({ ...img, idx: i, list: lightboxImg.list })}
                  className={`flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-all ${
                    i === lightboxImg.idx ? 'border-emerald-400 shadow-lg' : 'border-white/20 opacity-60 hover:opacity-100'
                  }`}>
                  <img src={img.src} alt={img.caption || ''} loading="lazy"
                    className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
