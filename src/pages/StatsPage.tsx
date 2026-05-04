import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { supabase } from '../lib/supabase';
import type { ProductionRecord } from '../types';

/* ─── 工具函数 ─── */
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};
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
  id: generateUUID(),
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
   Excel 原生批注解析
═══════════════════════════════════════════════════ */
// 列字母转数字 (A=0, B=1, ..., Z=25, AA=26, ...)
const colLetterToIndex = (col: string): number => {
  let result = 0;
  for (let i = 0; i < col.length; i++) {
    result = result * 26 + (col.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return result - 1;
};

// 单元格地址解析 (如 "K3" -> { row: 2, col: 10 })
const parseCellRef = (ref: string): { row: number; col: number } | null => {
  const match = ref.match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return null;
  return {
    col: colLetterToIndex(match[1].toUpperCase()),
    row: parseInt(match[2], 10) - 1, // 转为 0-based
  };
};

// 解析 Excel 原生批注 XML
// 返回 Map: key = "行索引,列索引", value = 批注内容
const parseExcelNativeComments = async (
  fileBuffer: ArrayBuffer,
  sheetIndex: number
): Promise<Map<string, string>> => {
  const comments = new Map<string, string>();
  
  try {
    const zip = await JSZip.loadAsync(fileBuffer);
    const commentFileName = `xl/comments${sheetIndex + 1}.xml`;
    const commentFile = zip.file(commentFileName);
    
    if (!commentFile) {
      return comments;
    }
    
    const content = await commentFile.async('string');
    
    // 解析批注 XML
    // 结构: <comment ref="K3"><text><r><t>内容</t></r></text></comment>
    const commentRegex = /<comment ref="([^"]+)"[^>]*>([\s\S]*?)<\/comment>/g;
    let match;
    
    while ((match = commentRegex.exec(content)) !== null) {
      const ref = match[1];
      const textContent = match[2];
      
      // 提取 <t> 标签内容（可能有多个）
      const textMatches = textContent.match(/<t[^>]*>([^<]*)<\/t>/g);
      let text = textMatches 
        ? textMatches.map(t => t.replace(/<[^>]+>/g, '')).join('').trim()
        : '';
      
      // 移除 "Administrator:" 前缀
      text = text.replace(/^Administrator:\s*/, '');
      // 处理换行符
      text = text.replace(/&#10;/g, '\n').replace(/&#13;/g, '');
      
      if (text) {
        const cellRef = parseCellRef(ref);
        if (cellRef) {
          const key = `${cellRef.row},${cellRef.col}`;
          comments.set(key, text);
        }
      }
    }
  } catch (err) {
    console.error('解析 Excel 原生批注失败:', err);
  }
  
  return comments;
};

/* ═══════════════════════════════════════════════════
   Excel 导入工具
═══════════════════════════════════════════════════ */
const num = (v: unknown) => Number(v) || 0;
const str = (v: unknown) => String(v ?? '');

function parseSheetRecords(ws: XLSX.WorkSheet, numFn: typeof num, strFn: typeof str, rowComments: Map<string, string>) {
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 }) as unknown[][];
  if (raw.length < 2) return [];

  // 找表头行（必须包含至少3个业务关键字）
  const HEADER_KEYWORDS = ['日期', '序号', '物料代码', '规格', '流转单号', '良品数'];
  let foundHeaderRowIdx = -1;
  for (let i = 0; i < Math.min(raw.length, 10); i++) {
    if (!raw[i]) continue;
    const rowStrs = (raw[i] as unknown[]).map((c) =>
      c == null ? '' : String(c).replace(/\n|\r/g, '').trim()
    );
    if (HEADER_KEYWORDS.filter((kw) => rowStrs.includes(kw)).length >= 3) {
      foundHeaderRowIdx = i; break;
    }
  }
  if (foundHeaderRowIdx === -1) {
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] && (raw[i] as unknown[]).some((c) => c != null && c !== '')) {
        foundHeaderRowIdx = i; break;
      }
    }
  }
  if (foundHeaderRowIdx === -1) return [];

  const headers = (raw[foundHeaderRowIdx] as unknown[]).map((h) =>
    h == null ? '' : String(h).replace(/\n|\r/g, '').trim()
  );

  // 构建列名到索引的映射
  const headerColIndexMap: Record<string, number> = {};
  headers.forEach((h, i) => { if (h) headerColIndexMap[h] = i; });

  // 字段名到列索引的映射（用于批注关联）
  const fieldToColIdx: Record<string, number> = {
    entryDate: headerColIndexMap['录入日期'] ?? -1,
    seq: headerColIndexMap['序号'] ?? -1,
    materialCode: headerColIndexMap['物料代码'] ?? -1,
    spec: headerColIndexMap['规格'] ?? -1,
    size: headerColIndexMap['尺寸'] ?? -1,
    workOrderNo: headerColIndexMap['流转单号'] ?? -1,
    positiveFoilVoltage: headerColIndexMap['正箔电压'] ?? headerColIndexMap['正箔\n电压'] ?? -1,
    designQty: headerColIndexMap['设计数量'] ?? headerColIndexMap['设计\n数量'] ?? -1,
    actualQty: headerColIndexMap['实际此单总数'] ?? -1,
    windingQty: headerColIndexMap['卷绕数'] ?? headerColIndexMap['卷绕\n数量'] ?? -1,
    goodQty: headerColIndexMap['良品数'] ?? -1,
    loss: headerColIndexMap['损耗'] ?? -1,
    firstBottomConvexShortBurstRate: headerColIndexMap['一次底凸、短路、爆破率'] ?? headerColIndexMap['一次底凸短路爆破率'] ?? -1,
    firstPassRate: headerColIndexMap['一次\n直通率'] ?? headerColIndexMap['一次直通率'] ?? -1,
    batchYieldRate: headerColIndexMap['整批良率'] ?? -1,
    defectShort: headerColIndexMap['短路'] ?? -1,
    defectBurst: headerColIndexMap['爆破'] ?? -1,
    defectBottomConvex: headerColIndexMap['底凸'] ?? -1,
    defectVoltage: headerColIndexMap['耐压'] ?? -1,
    defectAppearance: headerColIndexMap['外观'] ?? -1,
    defectLeakage: headerColIndexMap['漏电'] ?? -1,
    defectHighCap: headerColIndexMap['高容'] ?? -1,
    defectLowCap: headerColIndexMap['低容'] ?? -1,
    defectDF: headerColIndexMap['DF'] ?? -1,
    operator: headerColIndexMap['作业员'] ?? -1,
    notes: headerColIndexMap['备注'] ?? -1,
    reworkOrderNo: headerColIndexMap['重工单号'] ?? -1,
  };

  // 过滤数据行（从表头后开始）
  const dataStartIdx = foundHeaderRowIdx + 1;
  const dataRows = raw.slice(dataStartIdx).filter(
    (row) => row && (row as unknown[]).some((c) => c != null && c !== '')
  );

  return dataRows.map((row, dataRowIdx): ProductionRecord => {
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
      id: generateUUID(),
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

    // 解析批注：从 Excel 原生批注和备注列两个来源收集
    const comments: Record<string, string> = {};

    // 1. 从备注列获取批注（原有逻辑）
    const commentsStr = strFn(g(['批注', 'comments']));
    const parsedFromNotes = parseComments(commentsStr);
    if (parsedFromNotes) {
      Object.assign(comments, parsedFromNotes);
    }

    // 2. 从 Excel 原生批注获取（新增逻辑）
    // 批注单元格地址中的行号是 1-based，需要减1转为 0-based（与 dataRowIdx 对应）
    const excelRowIdx = dataStartIdx + dataRowIdx; // 在整个 sheet 中的行索引（0-based）
    Object.entries(fieldToColIdx).forEach(([field, colIdx]) => {
      if (colIdx >= 0) {
        const key = `${excelRowIdx},${colIdx}`;
        const nativeComment = rowComments.get(key);
        if (nativeComment) {
          comments[field] = nativeComment;
        }
      }
    });

    const derived = calcDerived(base);
    return {
      ...derived,
      batchYieldRate: derived.batchYieldRate || calcRate(derived.goodQty, derived.actualQty),
      comments: Object.keys(comments).length > 0 ? comments : undefined,
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
// 批注字段映射（用于导出的列名）
const COMMENT_FIELD_LABELS: Record<string, string> = {
  entryDate: '录入日期', seq: '序号', materialCode: '物料代码', spec: '规格',
  size: '尺寸', workOrderNo: '流转单号', positiveFoilVoltage: '正箔电压',
  designQty: '设计数量', actualQty: '实际此单总数', windingQty: '卷绕数',
  goodQty: '良品数', loss: '损耗', firstBottomConvexShortBurstRate: '一次底凸短路爆破率',
  firstPassRate: '一次直通率', batchYieldRate: '整批良率',
  defectShort: '短路', defectBurst: '爆破', defectBottomConvex: '底凸',
  defectVoltage: '耐压', defectAppearance: '外观', defectLeakage: '漏电',
  defectHighCap: '高容', defectLowCap: '低容', defectDF: 'DF',
  operator: '作业员', notes: '备注', reworkOrderNo: '重工单号',
};
// 反向映射：列名 -> 字段名
const COMMENT_LABEL_TO_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(COMMENT_FIELD_LABELS).map(([k, v]) => [v, k])
);

// 解析批注字符串 "字段名:内容; 字段名:内容; ..."
const parseComments = (commentStr: string): Record<string, string> | undefined => {
  if (!commentStr || !commentStr.trim()) return undefined;
  const comments: Record<string, string> = {};
  const parts = commentStr.split(';');
  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx > 0) {
      const label = part.slice(0, colonIdx).trim();
      const content = part.slice(colonIdx + 1).trim();
      const field = COMMENT_LABEL_TO_FIELD[label];
      if (field && content) {
        comments[field] = content;
      }
    }
  }
  return Object.keys(comments).length > 0 ? comments : undefined;
};

/* ═══════════════════════════════════════════════════
   主组件
═══════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════
   筛选下拉子组件
   - 独立 state 管理搜索词，不会互相干扰
   - 所有值全部渲染，通过搜索框过滤
   - e.stopPropagation() 防止冒泡触发表头排序
═════════════════════════════════════════════════ */
function FilterDropdown({
  fieldKey,
  uniqueVals,
  selected,
  onChange,
  onClose,
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
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50 flex-shrink-0">
        <span className="text-xs font-medium text-gray-600">
          筛选（{selected.size}/{uniqueVals.length}）
          {searchTerm && filtered.length !== uniqueVals.length && (
            <span className="text-gray-400 ml-1">· 匹配{filtered.length}项</span>
          )}
        </span>
        <div className="flex gap-1">
          {selected.size > 0 && (
            <button
              onClick={() => onChange(fieldKey, new Set())}
              className="text-xs text-indigo-600 hover:text-indigo-800"
            >清除</button>
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* 搜索框 */}
      <div className="px-2 py-1.5 border-b border-gray-50 flex-shrink-0">
        <input
          type="text"
          placeholder="搜索筛选值..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400 h-7"
        />
      </div>

      {/* 选项列表 */}
      <div className="overflow-y-auto flex-1 min-h-0">
        {filtered.length === 0 ? (
          <div className="px-3 py-2 text-xs text-gray-400">{searchTerm ? '无匹配项' : '无可用选项'}</div>
        ) : (
          filtered.map((val) => (
            <label
              key={val}
              className="flex items-center gap-2 px-3 py-1 hover:bg-gray-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(val)}
                onChange={() => {
                  const next = new Set(selected);
                  next.has(val) ? next.delete(val) : next.add(val);
                  onChange(fieldKey, next);
                }}
                className="rounded flex-shrink-0"
              />
              <span className="truncate text-xs">{val || '(空)'}</span>
            </label>
          ))
        )}
      </div>

      {/* 全选/取消全选 */}
      <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 flex-shrink-0">
        <label className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < uniqueVals.length; }}
            onChange={() => onChange(fieldKey, allSelected ? new Set() : new Set(uniqueVals))}
            className="rounded"
          />
          全选/取消全选
        </label>
      </div>
    </div>
  );
}

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

  /* ── 排序状态 ── */
  type SortField = keyof ProductionRecord | '';
  type SortDir = 'asc' | 'desc' | '';
  const [sortField, setSortField] = useState<SortField>('');
  const [sortDir, setSortDir] = useState<SortDir>('');

  /* ── 列筛选状态 ── */
  const [filterOpen, setFilterOpen] = useState<string | null>(null); // 当前打开筛选的列名
  const [filterValues, setFilterValues] = useState<Record<string, Set<string>>>({}); // 每列选中的值集合

  /* ── 批注状态 ── */
  const [commentTarget, setCommentTarget] = useState<{ recordId: string; field: string } | null>(null); // 当前编辑批注的目标
  const [commentText, setCommentText] = useState(''); // 当前批注内容
  const [hoveredComment, setHoveredComment] = useState<{ recordId: string; field: string; x: number; y: number } | null>(null); // 悬停显示批注

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

  // 格式化数字：小数保留两位，整数不变
  const formatNum = (val: number): string => {
    if (Number.isInteger(val)) return val.toString();
    return Number(val).toFixed(2);
  };

  /* ── 搜索过滤 + 列筛选 ── */
  const getCellValue = (r: ProductionRecord, field: SortField): string | number => {
    const fieldMap: Record<string, keyof ProductionRecord> = {
      entryDate: 'entryDate', seq: 'seq', materialCode: 'materialCode', spec: 'spec',
      size: 'size', workOrderNo: 'workOrderNo', positiveFoilVoltage: 'positiveFoilVoltage',
      designQty: 'designQty', actualQty: 'actualQty', windingQty: 'windingQty',
      goodQty: 'goodQty', loss: 'loss', firstBottomConvexShortBurstRate: 'firstBottomConvexShortBurstRate',
      firstPassRate: 'firstPassRate', batchYieldRate: 'batchYieldRate',
      defectShort: 'defectShort', defectBurst: 'defectBurst', defectBottomConvex: 'defectBottomConvex',
      defectVoltage: 'defectVoltage', defectAppearance: 'defectAppearance',
      defectLeakage: 'defectLeakage', defectHighCap: 'defectHighCap', defectLowCap: 'defectLowCap',
      defectDF: 'defectDF', operator: 'operator', notes: 'notes', reworkOrderNo: 'reworkOrderNo',
    };
    const key = fieldMap[field] ?? field;
    const val = r[key as keyof ProductionRecord];
    // 序号列按数字排序
    if (field === 'seq') {
      const na = Number(String(val).replace(/\D/g, ''));
      return isNaN(na) ? String(val) : na;
    }
    // 确保返回 string | number 类型（排除 comments 等复杂对象）
    if (typeof val === 'string' || typeof val === 'number') {
      return val;
    }
    return String(val ?? '');
  };

  const filtered = sheetRecords
    .filter((r) => {
      // 关键字搜索
      const q = searchQuery.trim().toLowerCase();
      const matchSearch = !q || (
        r.entryDate.includes(q) || r.materialCode.toLowerCase().includes(q) ||
        r.workOrderNo.toLowerCase().includes(q) || r.spec.toLowerCase().includes(q) ||
        r.operator.toLowerCase().includes(q)
      );
      // 列筛选：selected 表示被选中的值，selected.size === 0 表示显示全部
      const matchFilters = Object.entries(filterValues).every(([col, selected]) => {
        if (selected.size === 0) return true;  // 没有选中任何值，显示全部
        const val = String(getCellValue(r, col as SortField));
        return selected.has(val);  // 只显示被勾选的值
      });
      return matchSearch && matchFilters;
    })
    .sort((a, b) => {
      if (!sortField || !sortDir) return 0;
      const va = getCellValue(a, sortField);
      const vb = getCellValue(b, sortField);
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb : String(va).localeCompare(String(vb), 'zh-CN');
      return sortDir === 'asc' ? cmp : -cmp;
    });

  // 筛选结果汇总计算
  const summary = (() => {
    const totalDesign   = filtered.reduce((s, r) => s + r.designQty, 0);
    const totalActual   = filtered.reduce((s, r) => s + r.actualQty, 0);
    const totalWinding  = filtered.reduce((s, r) => s + r.windingQty, 0);
    const totalGood     = filtered.reduce((s, r) => s + r.goodQty, 0);
    const lossRate      = totalDesign > 0 ? round4((totalActual - totalDesign) / totalDesign * 100) : 0;
    const firstBSBRate  = totalWinding > 0 ? round4(
      filtered.reduce((s, r) => s + r.defectShort + r.defectBurst + r.defectBottomConvex, 0) / totalWinding * 100
    ) : 0;
    const firstPassRate = totalActual > 0 ? round4(totalGood / totalActual * 100) : 0;
    const batchYieldRate = totalActual > 0 ? round4(totalGood / totalActual * 100) : 0;
    const sum = (key: keyof ProductionRecord) => filtered.reduce((s, r) => s + ((r[key] as number) ?? 0), 0);
    return {
      totalDesign, totalActual, totalWinding, totalGood,
      lossRate, firstBSBRate, firstPassRate, batchYieldRate,
      defectShort:      sum('defectShort'),
      defectBurst:      sum('defectBurst'),
      defectBottomConvex: sum('defectBottomConvex'),
      defectVoltage:     sum('defectVoltage'),
      defectAppearance:  sum('defectAppearance'),
      defectLeakage:     sum('defectLeakage'),
      defectHighCap:     sum('defectHighCap'),
      defectLowCap:      sum('defectLowCap'),
      defectDF:          sum('defectDF'),
    };
  })();

  // 获取所有列的唯一值（用于筛选下拉）
  const getColumnUniqueValues = (field: SortField): string[] => {
    return [...new Set(sheetRecords.map((r) => String(getCellValue(r, field))))].sort((a, b) => {
      const na = Number(a), nb = Number(b);
      return isNaN(na) || isNaN(nb) ? a.localeCompare(b, 'zh-CN') : na - nb;
    });
  };

  /* ── 排序/筛选切换 ── */
  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDir === 'asc') { setSortDir('desc'); }
      else if (sortDir === 'desc') { setSortField(''); setSortDir(''); }
      else { setSortDir('asc'); }
    } else { setSortField(field); setSortDir('asc'); }
  };

  const handleFilterChange = (field: string, newSelected: Set<string>) => {
    setFilterValues((prev) => ({ ...prev, [field]: newSelected }));
  };

  /* ── 批注操作 ── */
  const openCommentEditor = (recordId: string, field: string, currentComment: string = '') => {
    setCommentTarget({ recordId, field });
    setCommentText(currentComment);
  };

  const saveComment = async () => {
    if (!commentTarget) return;

    const record = sheetRecords.find(r => r.id === commentTarget.recordId);
    if (!record) return;

    const currentComments = record.comments || {};
    const updatedComments = { ...currentComments };

    if (commentText.trim()) {
      updatedComments[commentTarget.field] = commentText.trim();
    } else {
      delete updatedComments[commentTarget.field];
    }

    // 更新本地状态
    setSheetRecords(prev => prev.map(r =>
      r.id === commentTarget.recordId
        ? { ...r, comments: Object.keys(updatedComments).length > 0 ? updatedComments : undefined }
        : r
    ));

    // 保存到数据库
    await supabase
      .from('records')
      .update({ comments: Object.keys(updatedComments).length > 0 ? updatedComments : null })
      .eq('id', commentTarget.recordId);

    setCommentTarget(null);
    setCommentText('');
    showToast(commentText.trim() ? '批注已保存' : '批注已删除');
  };

  const closeCommentEditor = () => {
    setCommentTarget(null);
    setCommentText('');
  };

  // 渲染带批注的单元格
  const renderCommentCell = (
    r: ProductionRecord,
    field: keyof ProductionRecord,
    display: string,
    extraClass: string = ''
  ) => {
    const hasComment = r.comments && r.comments[field];
    return (
      <td
        className={`relative px-2 py-1.5 text-center cursor-pointer hover:bg-yellow-50/50 transition-colors ${extraClass}`}
        onDoubleClick={() => openCommentEditor(r.id, field, r.comments?.[field] || '')}
        onMouseEnter={(e) => {
          if (hasComment) {
            const rect = e.currentTarget.getBoundingClientRect();
            setHoveredComment({
              recordId: r.id,
              field,
              x: rect.left,
              y: rect.bottom + 4,
            });
          }
        }}
        onMouseLeave={() => setHoveredComment(null)}
      >
        {display}
        {/* 批注指示器（红色三角） */}
        {hasComment && (
          <span className="absolute top-0.5 right-0.5 text-red-500 leading-none">
            <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="currentColor">
              <path d="M0 0L12 0L12 12Z" />
            </svg>
          </span>
        )}
      </td>
    );
  };

  /* ── 汇总 ── */
  const totalGood   = sheetRecords.reduce((s, r) => s + r.goodQty, 0);
  const totalActual = sheetRecords.reduce((s, r) => s + r.actualQty, 0);
  const avgYield    = calcRate(totalGood, totalActual);

  /* ── 初始加载：获取当前用户 + 加载 Sheets ── */
  useEffect(() => {
    let ignore = false;

    async function init() {
      // 获取用户（容错处理锁竞争）
      let user;
      try {
        const res = await supabase.auth.getUser();
        user = res.error ? null : res.data.user;
      } catch (e) { user = null; }
      if (!user || ignore) return;

      try {
        const { data: cloudSheets, error } = await supabase
          .from('sheets')
          .select('id, name, "order"')
          .order('created_at', { ascending: true });

        if (ignore) return;
        if (error) throw error;

        if (!cloudSheets || cloudSheets.length === 0) {
          // 首次使用，创建默认 Sheet
          const { data: newSheet, error: insertError } = await supabase
            .from('sheets')
            .insert({ name: '工作表1', 'order': [], user_id: user.id })
            .select('id, name, "order"')
            .single();
          if (ignore) return;
          if (insertError) throw insertError;
          if (newSheet) {
            setLocalSheets([{ id: newSheet.id, name: newSheet.name }]);
            setActiveSheetId(newSheet.id);
            setSheetRecords([]);
            setLoading(false); // 没有记录需要加载，直接关闭 loading
          }
        } else {
          const mapped: LocalSheet[] = cloudSheets.map((s) => ({
            id: s.id,
            name: s.name,
          }));
          setLocalSheets(mapped);
          setActiveSheetId(mapped[0].id);
          // loadRecords 内部会处理 loading 状态
          await loadRecords(mapped[0].id);
        }
      } catch (err) {
        console.error('初始化失败:', err);
        setLoading(false);
        showToast('加载数据失败，请检查网络连接');
      }
    }

    init();
    return () => { ignore = true; };
  }, []);

  /* ── 加载某个 Sheet 的所有记录 ── */
  const loadRecords = async (sheetId: string, retryCount = 0) => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('records')
        .select('*')
        .eq('sheet_id', sheetId)
        .order('entry_date', { ascending: false });

      if (error) {
        throw error;
      }

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
          comments: r.comments as Record<string, string> | undefined,
        }))
      );
      setLoading(false);
    } catch (err: any) {
      console.error('加载记录失败:', err);
      setLoading(false);

      // 网络错误时重试一次（最多重试1次）
      if (retryCount < 1 && (err.message?.includes('Failed to fetch') || err.message?.includes('ERR_CONNECTION_CLOSED'))) {
        console.log(`网络错误，1秒后重试... (${retryCount + 1}/1)`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return loadRecords(sheetId, retryCount + 1);
      }

      showToast('加载数据失败，请检查网络连接');
    }
  };

  /* ── Sheet 切换 ── */
  const switchSheet = async (sheet: LocalSheet) => {
    if (sheet.id === activeSheetId) return; // 已经是当前 sheet，不重复加载
    setActiveSheetId(sheet.id);
    setSearchQuery('');
    setSheetRecords([]); // 先清空当前记录，避免显示旧数据
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
  const openAdd = () => {
    const base = emptyRecord();
    // 计算当前工作表最大序号 + 1
    if (sheetRecords.length > 0) {
      const maxSeq = sheetRecords.reduce((max, r) => {
        const num = parseInt(String(r.seq).replace(/\D/g, ''), 10);
        return !isNaN(num) && num > max ? num : max;
      }, 0);
      base.seq = String(maxSeq + 1);
    }
    setEditingId(null);
    setForm(base);
    setShowForm(true);
  };
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
      entry_date: final.entryDate || new Date().toISOString().slice(0, 10),  // 空日期使用今天
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
        .insert({ ...recordCloudData, id: generateUUID() } as Record<string, unknown>)
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
        const fileBuffer = evt.target!.result as ArrayBuffer;
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        let user;
        try {
          const { data, error } = await supabase.auth.getUser();
          user = error ? null : data.user;
        } catch (e) { user = null; }
        if (!user) { showToast('请先登录'); return; }

        let totalCount = 0;

        for (let sheetIdx = 0; sheetIdx < wb.SheetNames.length; sheetIdx++) {
          const sheetName = wb.SheetNames[sheetIdx];
          const ws = wb.Sheets[sheetName];
          
          // 先解析 Excel 原生批注
          const rowComments = await parseExcelNativeComments(fileBuffer, sheetIdx);
          
          // 解析工作表记录，传入批注数据
          const records = parseSheetRecords(ws, num, str, rowComments);
          if (!records.length) continue;

          // 过滤必须有流转单号的记录
          const validRecords = records.filter((r) => r.workOrderNo && r.workOrderNo.trim() !== '');
          if (!validRecords.length) continue;

          // 找到或创建同名 sheet（覆盖模式）
          let localSheet = localSheets.find((s) => s.name === sheetName);
          let sheetExists = !!localSheet;

          if (!localSheet) {
            // 先检查数据库中是否已存在同名 sheet（其他用户创建的）
            const { data: existingSheet } = await supabase
              .from('sheets')
              .select('id, name')
              .eq('name', sheetName)
              .maybeSingle();

            if (existingSheet) {
              // 复用已存在的 sheet
              localSheet = { id: existingSheet.id, name: existingSheet.name };
              sheetExists = true;
              // 如果本地没有，添加到本地状态
              if (!localSheets.find((s) => s.id === localSheet!.id)) {
                setLocalSheets((prev) => [...prev, localSheet!]);
              }
            } else {
              // 创建新 sheet
              const { data: newSheet } = await supabase
                .from('sheets')
                .insert({ name: sheetName, 'order': [], user_id: user.id })
                .select('id, name')
                .single();
              if (!newSheet) continue;
              localSheet = { id: newSheet.id, name: newSheet.name };
              setLocalSheets((prev) => [...prev, localSheet!]);
            }
          } else {
            // 本地已存在，检查数据库是否也有（可能其他用户创建了同名 sheet）
            const { data: existingSheet } = await supabase
              .from('sheets')
              .select('id, name')
              .eq('name', sheetName)
              .maybeSingle();
            if (existingSheet && existingSheet.id !== localSheet.id) {
              // 数据库有同名但不同 id，更新本地 sheet id
              localSheet = { id: existingSheet.id, name: existingSheet.name };
              setLocalSheets((prev) =>
                prev.map((s) => s.name === sheetName ? localSheet! : s)
              );
            }
          }

          // 覆盖模式：先删除该 sheet 的所有旧记录
          await supabase.from('records').delete().eq('sheet_id', localSheet!.id);

          // 插入新记录
          const today = new Date().toISOString().slice(0, 10);
          const cloudRecords = validRecords.map((r) => ({
            id: generateUUID(),
            sheet_id: localSheet!.id,
            entry_date: r.entryDate || today,  // 空日期使用今天
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
            comments: r.comments || null,
          }));

          await supabase.from('records').insert(cloudRecords as Record<string, unknown>[]);
          totalCount += validRecords.length;

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
      // 导出批注：格式为 "字段名:内容; 字段名:内容; ..."
      if (r.comments && Object.keys(r.comments).length > 0) {
        const commentParts: string[] = [];
        Object.entries(r.comments).forEach(([field, content]) => {
          const label = COMMENT_FIELD_LABELS[field] || field;
          commentParts.push(`${label}:${content}`);
        });
        row['批注'] = commentParts.join('; ');
      } else {
        row['批注'] = '';
      }
      return row;
    });
    // 添加批注列
    const ws = XLSX.utils.json_to_sheet(exportData);
    ws['!cols'] = [...EXPORT_COLUMNS.map(({ width }) => ({ wch: width })), { wch: 30 }];
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

  // 获取某字段的历史唯一值（按出现顺序去重）
  const getFieldOptions = (field: keyof ProductionRecord): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];
    sheetRecords.forEach((r) => {
      const val = r[field];
      if (val !== undefined && val !== null && val !== '') {
        const strVal = String(val);
        if (!seen.has(strVal)) {
          seen.add(strVal);
          result.push(strVal);
        }
      }
    });
    return result;
  };

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
  // 带下拉建议的输入框（datalist 实现）
  const textInputWithDatalist = (field: keyof ProductionRecord, placeholder = '') => {
    const datalistId = `datalist-${field}`;
    const options = getFieldOptions(field);
    return (
      <>
        <input type="text" placeholder={placeholder} list={datalistId}
          value={(form[field] as string) || ''}
          onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
          className={inputCls} />
        {options.length > 0 && (
          <datalist id={datalistId}>
            {options.map((opt) => <option key={opt} value={opt} />)}
          </datalist>
        )}
      </>
    );
  };

  const parseNoteForDefectTypes = (note: string, record: ProductionRecord): Record<string, number> => {
    const typeMap: Record<string, number> = {};
    if (!note || note.trim() === '' || note.trim() === '/' || note.trim() === '／') return typeMap;

    // 各通用类别的不良数量
    const categoryCounts: Record<string, number> = {
      '短路': record.defectShort,
      '爆破': record.defectBurst,
      '底凸': record.defectBottomConvex,
      '耐压': record.defectVoltage,
      '外观': record.defectAppearance,
      '漏电': record.defectLeakage,
      '高容': record.defectHighCap,
      '低容': record.defectLowCap,
      'DF': record.defectDF,
    };

    // 按分号分割，支持多条备注（如 "底凸：均为箔边爆破；短路：2个箔边爆破，1个箔面爆破"）
    const parts = note.split(/[；;]/);
    for (const part of parts) {
      const trimmedPart = part.trim();
      if (!trimmedPart) continue;
      const colonMatch = trimmedPart.match(/^(.+?)\s*[：:]】?\s*(.+)$/);
      if (!colonMatch) continue;
      const category = colonMatch[1].trim();
      const description = colonMatch[2].trim();
      const totalCount = categoryCounts[category];
      if (!totalCount || totalCount <= 0) continue;

      // 情况1："均为XXX" 或 "全部XXX" → XXX 获得该类别全部数量
      if (/^均为/.test(description) || /^全部/.test(description)) {
        const defectType = description.replace(/^均为|^全部/, '').trim();
        if (defectType) {
          typeMap[defectType] = (typeMap[defectType] || 0) + totalCount;
        }
        continue;
      }

      // 情况2：按逗号分割，逐项解析数量和不良类型
      // 支持格式："2个箔边爆破，1个箔面爆破"、"两颗箔边爆破，一颗箔面爆破"、"箔边爆破×2，箔面爆破×1"
      const items = description.split(/[，,、]/).map(s => s.trim()).filter(s => s.length > 0);
      if (items.length === 0) continue;

      const parsedItems: { defectType: string; qty: number }[] = [];
      let hasExplicitQty = false;

      for (const item of items) {
        // 格式A："XXX×2" 或 "XXX*2"
        const qtySuffixMatch = item.match(/^(.+?)\s*[×xX*](\d+)$/);
        if (qtySuffixMatch) {
          parsedItems.push({ defectType: qtySuffixMatch[1].trim(), qty: parseInt(qtySuffixMatch[2], 10) });
          hasExplicitQty = true;
          continue;
        }
        // 格式B："2个XXX"、"两颗XXX"、"一个XXX"
        const qtyMatch = item.match(/^(\d+)\s*(?:个|颗|粒)/);
        if (qtyMatch) {
          const qty = parseInt(qtyMatch[1], 10);
          const rest = item.replace(/^\d+\s*(?:个|颗|粒)/, '').trim();
          if (rest) parsedItems.push({ defectType: rest, qty });
          hasExplicitQty = true;
          continue;
        }
        // 中文数字："两个XXX"、"三颗XXX"、"十五颗XXX"
        // 解析中文数字（支持个位、整十、十几等）
        const parseChineseNumber = (s: string): { qty: number; rest: string } | null => {
          const digits: Record<string, number> = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
          // 匹配：二十三、十五、十、十一等
          const match = s.match(/^([零一二三四五六七八九十]+)\s*(?:个|颗|粒)?/);
          if (!match) return null;
          const cnNum = match[1];
          const rest = s.substring(match[0].length).trim();

          // 转换为数字
          let qty = 0;
          if (/^\d+$/.test(cnNum)) { qty = parseInt(cnNum, 10); } // 已经是阿拉伯数字
          else if (cnNum === '十') { qty = 10; }
          else if (cnNum.startsWith('十') && cnNum.length === 2) { qty = 10 + (digits[cnNum[1]] || 0); } // 十几
          else if (cnNum.endsWith('十') && cnNum.length === 2) { qty = (digits[cnNum[0]] || 0) * 10; } // 几十
          else if (cnNum.includes('十') && cnNum.length > 2) { // 几十几，如二十三
            const parts = cnNum.split('十');
            qty = (digits[parts[0]] || 0) * 10 + (digits[parts[1]] || 0);
          }
          else { qty = digits[cnNum] ?? 0; }

          if (qty > 0 && rest) return { qty, rest };
          return null;
        };
        const cnResult = parseChineseNumber(item);
        if (cnResult) {
          parsedItems.push({ defectType: cnResult.rest, qty: cnResult.qty });
          hasExplicitQty = true;
          continue;
        }
        // 只有"个/颗"前缀但无数字：默认1
        if (/^(?:个|颗|粒)/.test(item)) {
          const rest = item.replace(/^(?:个|颗|粒)/, '').trim();
          if (rest) parsedItems.push({ defectType: rest, qty: 1 });
          continue;
        }
        // 格式C：只有不良类型名称（无数量）
        parsedItems.push({ defectType: item, qty: 0 });
      }

      if (hasExplicitQty) {
        for (const { defectType, qty } of parsedItems) {
          const actualQty = qty > 0 ? qty : 1;
          typeMap[defectType] = (typeMap[defectType] || 0) + actualQty;
        }
      } else {
        // 无明确数量，按 totalCount 平均分配
        const noQtyItems = parsedItems.filter(p => p.qty === 0);
        if (noQtyItems.length > 0) {
          const base = Math.floor(totalCount / noQtyItems.length);
          const extra = totalCount % noQtyItems.length;
          for (let i = 0; i < noQtyItems.length; i++) {
            const { defectType } = noQtyItems[i];
            const qty = i === 0 ? base + extra : base;
            if (qty > 0) {
              typeMap[defectType] = (typeMap[defectType] || 0) + qty;
            }
          }
        }
      }
    }
    return typeMap;
  };

  // 备注不良类型统计
  const calculateNoteDefectStats = () => {
    const typeCountMap: Record<string, number> = {};
    sheetRecords.forEach(record => {
      const note = record.notes?.trim();
      if (!note || note === '/' || note === '／') return;
      const typeMap = parseNoteForDefectTypes(note, record);
      Object.entries(typeMap).forEach(([type, count]) => {
        typeCountMap[type] = (typeCountMap[type] || 0) + count;
      });
    });
    const totalCount = Object.values(typeCountMap).reduce((sum, c) => sum + c, 0);
    if (totalCount === 0) return { items: [], totalCount: 0 };
    let items = Object.entries(typeCountMap)
      .map(([type, count]) => ({
        type,
        count,
        percentage: round2((count / totalCount) * 100),
      }))
      .sort((a, b) => b.count - a.count);
    const mainItems = items.filter(item => item.percentage > 0.5);
    const otherItems = items.filter(item => item.percentage <= 0.5);
    if (otherItems.length > 0) {
      const otherCount = otherItems.reduce((sum, item) => sum + item.count, 0);
      mainItems.push({
        type: '其他',
        count: otherCount,
        percentage: round2((otherCount / totalCount) * 100),
      });
    }
    mainItems.sort((a, b) => b.count - a.count);
    // 使用原始百分比计算累积，最后一项限制不超过100%
    let cumulative = 0;
    const itemsWithCumulative = mainItems.map((item, idx) => {
      const rawPercent = (item.count / totalCount) * 100;
      cumulative += rawPercent;
      // 最后一项确保累积百分比不超过100%
      const isLastItem = idx === mainItems.length - 1;
      const cumulativePercentage = isLastItem ? Math.min(round2(cumulative), 100) : round2(cumulative);
      return { ...item, cumulativePercentage };
    });
    return { items: itemsWithCumulative, totalCount };
  };

  const noteDefectStats = calculateNoteDefectStats();

  // ═══ 汇总统计计算 ═══
  const totalDesign   = sheetRecords.reduce((s, r) => s + r.designQty, 0);
  const totalWinding  = sheetRecords.reduce((s, r) => s + r.windingQty, 0);
  const avgLossRate   = totalDesign > 0 ? round2((totalActual - totalDesign) / totalDesign * 100) : 0;

  // 解析规格电压数值（用于区分低/中/高压损耗）
  const parseSpecVoltage = (v: string): number | null => {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };
  const lowVoltageRecords  = sheetRecords.filter(r => { const v = parseSpecVoltage(r.spec); return v !== null && v <= 120; });
  const midVoltageRecords  = sheetRecords.filter(r => { const v = parseSpecVoltage(r.spec); return v !== null && v >= 160 && v < 400; });
  const highVoltageRecords = sheetRecords.filter(r => { const v = parseSpecVoltage(r.spec); return v !== null && v >= 400; });

  const calcAvgLossRate = (records: ProductionRecord[]): number => {
    if (records.length === 0) return 0;
    const totalD = records.reduce((s, r) => s + r.designQty, 0);
    const totalA = records.reduce((s, r) => s + r.actualQty, 0);
    return totalD > 0 ? round2((totalA - totalD) / totalD * 100) : 0;
  };
  const lowVoltageLossRate  = calcAvgLossRate(lowVoltageRecords);
  const midVoltageLossRate  = calcAvgLossRate(midVoltageRecords);
  const highVoltageLossRate = calcAvgLossRate(highVoltageRecords);

  const totalBottomConvexShortBurstRate = totalWinding > 0 ? round2(
    sheetRecords.reduce((s, r) => s + r.defectShort + r.defectBurst + r.defectBottomConvex, 0) / totalWinding * 100
  ) : 0;

  const totalPassRate = totalActual > 0 ? round2(totalGood / totalActual * 100) : 0;

  const voltageDistribution = [
    { label: '≤120V（低压）',   count: lowVoltageRecords.length },
    { label: '160V-400V（中压）', count: midVoltageRecords.length },
    { label: '≥400V（高压）',   count: highVoltageRecords.length },
    { label: '未知',           count: sheetRecords.filter(r => parseSpecVoltage(r.spec) === null).length },
  ];
  // ═══ 汇总统计计算结束 ═══

  // 生成柏拉图SVG（全部单行拼接）
  const generateParetoSVG = (items: typeof noteDefectStats.items) => {
    if (items.length === 0) return '';
    var w = 800, h = 500, cl = 60, cr = 740, ct = 40, cb = 380;
    var cw = cr-cl, ch = cb-ct, mx = Math.max.apply(null, items.map(function(i){return i.count})) || 1;
    var s = '';
    s += '<svg viewBox="0 0 '+w+' '+h+'" width="'+w+'" height="'+h+'" xmlns="http://www.w3.org/2000/svg">';
    s += '<rect width="'+w+'" height="'+h+'" fill="white"/>';
    s += '<text x="'+(w/2)+'" y="30" text-anchor="middle" font-size="16" font-weight="bold" fill="#1f2937">备注不良类型柏拉图</text>';
    [0,50,100,150,200,250,300,350].forEach(function(y){
      var cy = cb-y;
      s += '<line x1="'+cl+'" y1="'+cy+'" x2="'+cr+'" y2="'+cy+'" stroke="#e5e7eb" stroke-width="0.5"/>';
      s += '<text x="'+(cl-5)+'" y="'+(cy+4)+'" text-anchor="end" font-size="10" fill="#6b7280">'+(y===0?'0':y)+'</text>';
    });
    items.forEach(function(_item,idx){
      var x = cl+(idx+0.5)*(cw/items.length);
      s += '<line x1="'+x+'" y1="'+ct+'" x2="'+x+'" y2="'+cb+'" stroke="#e5e7eb" stroke-width="0.5" stroke-dasharray="4"/>';
    });
    s += '<line x1="'+cl+'" y1="'+ct+'" x2="'+cl+'" y2="'+cb+'" stroke="#374151" stroke-width="1.5"/>';
    s += '<text x="20" y="210" text-anchor="middle" font-size="12" fill="#374151" transform="rotate(-90 20 210)">频次</text>';
    s += '<line x1="'+cr+'" y1="'+ct+'" x2="'+cr+'" y2="'+cb+'" stroke="#374151" stroke-width="1.5"/>';
    [0,20,40,60,80,100].forEach(function(p){
      var cy = cb-(p/100)*ch;
      s += '<text x="'+(cr+5)+'" y="'+(cy+4)+'" font-size="10" fill="#6b7280">'+p+'%</text>';
    });
    s += '<text x="'+(w-20)+'" y="210" text-anchor="middle" font-size="12" fill="#374151" transform="rotate(90 '+(w-20)+' 210)">累积百分比</text>';
    s += '<line x1="'+cl+'" y1="'+cb+'" x2="'+cr+'" y2="'+cb+'" stroke="#374151" stroke-width="1.5"/>';
    items.forEach(function(item,idx){
      var x = cl+(idx+0.5)*(cw/items.length);
      var dt = item.type.length>4?item.type.slice(0,4)+'...':item.type;
      s += '<text x="'+x+'" y="'+(cb+18)+'" text-anchor="middle" font-size="10" fill="#374151">'+dt+'</text>';
    });
    items.forEach(function(item,idx){
      var bw=(cw/items.length)*0.7, bh=(item.count/mx)*(ch*0.85);
      var x=cl+(idx+0.5)*(cw/items.length)-bw/2, y=cb-bh;
      var col=item.percentage>10?'#ef4444':(item.percentage>5?'#f59e0b':'#10b981');
      s += '<rect x="'+x+'" y="'+y+'" width="'+bw+'" height="'+bh+'" fill="'+col+'" opacity="0.8"><title>'+item.type+': 频次 '+item.count+'，百分比 '+item.percentage+'%</title></rect>';
    });
    var pts:string[]=[];
    items.forEach(function(item,idx){
      var x=cl+(idx+0.5)*(cw/items.length), y=cb-(item.cumulativePercentage/100)*ch;
      pts.push(x+','+y);
    });
    s += '<polyline points="'+pts.join(' ')+'" fill="none" stroke="#6366f1" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
    items.forEach(function(item,idx){
      var x=cl+(idx+0.5)*(cw/items.length), y=cb-(item.cumulativePercentage/100)*ch;
      s += '<circle cx="'+x+'" cy="'+y+'" r="4" fill="#6366f1" stroke="white" stroke-width="1.5"><title>累积百分比: '+item.cumulativePercentage+'%</title></circle>';
      s += '<text x="'+x+'" y="'+(y-8)+'" text-anchor="middle" font-size="9" fill="#6366f1" font-weight="bold">'+item.cumulativePercentage+'%</text>';
    });
    // 图例移至图表下方（y=400），避免与X轴标签重叠
    s += '<rect x="200" y="430" width="12" height="12" fill="#ef4444" opacity="0.8"/>';
    s += '<text x="216" y="441" font-size="11" fill="#374151">频次（柱状图）</text>';
    s += '<line x1="340" y1="436" x2="360" y2="436" stroke="#6366f1" stroke-width="2.5"/>';
    s += '<circle cx="350" cy="436" r="3" fill="#6366f1"/>';
    s += '<text x="366" y="441" font-size="11" fill="#374151">累积百分比（折线）</text>';
    s += '</svg>';
    return s;
  };

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

  // 渲染批注气泡
  const renderCommentBubble = () => {
    if (!hoveredComment) return null;
    const record = sheetRecords.find(r => r.id === hoveredComment.recordId);
    const comment = record?.comments?.[hoveredComment.field];
    if (!comment) return null;
    return (
      <div
        className="fixed z-50 px-3 py-2 text-xs text-white bg-gray-800 rounded-lg shadow-xl whitespace-normal max-w-xs"
        style={{ left: hoveredComment.x, top: hoveredComment.y }}
      >
        {comment}
      </div>
    );
  };

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
              className={`group relative flex items-center gap-1.5 px-4 py-2 cursor-pointer select-none border-t border-l border-r text-sm font-medium rounded-t-lg transition-colors whitespace-normal ${
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
            <p>{searchQuery || Object.values(filterValues).some(v => v.size > 0) ? '没有找到匹配记录' : '暂无数据，请导入 Excel 或手动录入'}</p>
          </div>
        ) : (
          <div className="min-h-[400px] max-h-[calc(100vh-280px)] overflow-auto rounded-xl border border-gray-100">
            <table className="w-full text-xs border-collapse" style={{tableLayout: 'fixed'}}>
              <colgroup>
              <col style={{width: '100px', minWidth: '100px'}} />
              <col style={{width: '50px', minWidth: '50px'}} />
              <col style={{width: '120px', minWidth: '120px'}} />
              <col style={{width: '80px', minWidth: '80px'}} />
              <col style={{width: '80px', minWidth: '80px'}} />
              <col style={{width: '120px', minWidth: '120px'}} />
              <col style={{width: '80px', minWidth: '80px'}} />
              <col style={{width: '100px', minWidth: '100px'}} />
              <col style={{width: '110px', minWidth: '110px'}} />
              <col style={{width: '90px', minWidth: '90px'}} />
              <col style={{width: '90px', minWidth: '90px'}} />
              <col style={{width: '80px', minWidth: '80px'}} />
              <col style={{width: '100px', minWidth: '100px'}} />
              <col style={{width: '90px', minWidth: '90px'}} />
              <col style={{width: '80px', minWidth: '80px'}} />
              <col style={{width: '60px', minWidth: '60px'}} />
              <col style={{width: '60px', minWidth: '60px'}} />
              <col style={{width: '60px', minWidth: '60px'}} />
              <col style={{width: '60px', minWidth: '60px'}} />
              <col style={{width: '60px', minWidth: '60px'}} />
              <col style={{width: '60px', minWidth: '60px'}} />
              <col style={{width: '60px', minWidth: '60px'}} />
              <col style={{width: '60px', minWidth: '60px'}} />
              <col style={{width: '80px', minWidth: '80px'}} />
              <col style={{width: '130px', minWidth: '130px'}} />
              <col style={{width: '100px', minWidth: '100px'}} />
              <col style={{width: '70px', minWidth: '70px'}} />
              <col style={{width: '70px', minWidth: '70px'}} />
            </colgroup>
<thead className="sticky top-0 z-10 bg-gray-50">
                <tr>
                  {[
                    { key: 'entryDate', label: '录入日期' },
                    { key: 'seq', label: '序号' },
                    { key: 'materialCode', label: '物料代码' },
                    { key: 'spec', label: '规格' },
                    { key: 'size', label: '尺寸' },
                    { key: 'workOrderNo', label: '流转单号' },
                    { key: 'positiveFoilVoltage', label: '正箔电压' },
                    { key: 'designQty', label: '设计数量' },
                    { key: 'actualQty', label: '实际此单总数' },
                    { key: 'windingQty', label: '卷绕数' },
                    { key: 'goodQty', label: '良品数' },
                    { key: 'loss', label: '损耗(%)' },
                    { key: 'firstBottomConvexShortBurstRate', label: '一次底凸短路爆破率(%)' },
                    { key: 'firstPassRate', label: '一次直通率(%)' },
                    { key: 'batchYieldRate', label: '整批良率(%)' },
                    { key: 'defectShort', label: '短路' },
                    { key: 'defectBurst', label: '爆破' },
                    { key: 'defectBottomConvex', label: '底凸' },
                    { key: 'defectVoltage', label: '耐压' },
                    { key: 'defectAppearance', label: '外观' },
                    { key: 'defectLeakage', label: '漏电' },
                    { key: 'defectHighCap', label: '高容' },
                    { key: 'defectLowCap', label: '低容' },
                    { key: 'defectDF', label: 'DF' },
                    { key: 'operator', label: '作业员' },
                    { key: 'notes', label: '备注' },
                    { key: 'reworkOrderNo', label: '重工单号' },
                    { key: '__actions__', label: '' },
                  ].map(({ key, label }) => {
                    const isSorted = sortField === key;
                    const isActions = key === '__actions__';
                    const uniqueVals = isActions ? [] : getColumnUniqueValues(key as SortField);
                    const hasFilter = filterValues[key] && filterValues[key].size > 0 && filterValues[key].size < uniqueVals.length;

                    return (
                      <th key={key}
                        className={`relative px-2 py-2 text-left font-semibold whitespace-normal border-b border-gray-100 ${isSorted ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600'} ${!isActions ? 'hover:bg-gray-100 select-none' : ''}`}
                      >
                        <div
                          className={`flex items-center gap-1 ${!isActions ? 'cursor-pointer' : ''}`}
                          onClick={() => !isActions && toggleSort(key as SortField)}
                        >
                          <span>{label}</span>
                          {!isActions && (
                            <>
                              {isSorted ? (
                                <span className="text-indigo-500">{sortDir === 'asc' ? '↑' : '↓'}</span>
                              ) : (
                                <span className="text-gray-300 text-[10px]">⇅</span>
                              )}
                            </>
                          )}
                          {!isActions && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setFilterOpen(filterOpen === key ? null : key);
                              }}
                              className={`ml-0.5 p-0.5 rounded text-[10px] ${hasFilter ? 'bg-indigo-100 text-indigo-600' : 'text-gray-400 hover:bg-gray-200'}`}
                              title="筛选"
                            >
                              <svg className="w-3 h-3" fill={hasFilter ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                              </svg>
                            </button>
                          )}
                        </div>

                        {/* 筛选下拉框 */}
                        {filterOpen === key && (
                          <div
                            className="absolute top-full left-0 z-50 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl w-56 h-72 overflow-hidden"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <FilterDropdown
                              fieldKey={key}
                              uniqueVals={uniqueVals}
                              selected={filterValues[key] ?? new Set()}
                              onChange={handleFilterChange}
                              onClose={() => setFilterOpen(null)}
                            />
                          </div>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead><tfoot>
                  <tr className="bg-indigo-50 border-t-2 border-indigo-200 font-bold text-xs">
                    <td className="px-2 py-1.5 text-indigo-700 text-center min-w-0 overflow-hidden truncate" style={{width:'100px'}}>汇总 ({filtered.length} 条)</td>
                    <td className="px-2 py-1.5" style={{width:'50px'}}></td>
                    <td className="px-2 py-1.5" style={{width:'120px'}}></td>
                    <td className="px-2 py-1.5" style={{width:'80px'}}></td>
                    <td className="px-2 py-1.5" style={{width:'80px'}}></td>
                    <td className="px-2 py-1.5" style={{width:'120px'}}></td>
                    <td className="px-2 py-1.5" style={{width:'80px'}}></td>
                    <td className="px-2 py-1.5 text-center text-indigo-900" style={{width:'90px'}}>{summary.totalDesign.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-center text-indigo-600 font-medium" style={{width:'90px'}}>{summary.totalActual.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-center text-indigo-900" style={{width:'80px'}}>{summary.totalWinding.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-center text-green-600 font-medium" style={{width:'80px'}}>{summary.totalGood.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-center text-indigo-900" style={{width:'80px'}}>{summary.lossRate >= 0 ? "+" + formatNum(summary.lossRate) + "%" : formatNum(summary.lossRate) + "%"}</td>
                    <td className="px-2 py-1.5 text-center text-red-500" style={{width:'100px'}}>{formatNum(summary.firstBSBRate)}%</td>
                    <td className="px-2 py-1.5 text-center text-blue-600" style={{width:'80px'}}>{formatNum(summary.firstPassRate)}%</td>
                    <td className="px-2 py-1.5 text-center text-indigo-900" style={{width:'80px'}}>{summary.batchYieldRate > 0 ? formatNum(summary.batchYieldRate) + "%" : "—"}</td>
                    <td className="px-2 py-1.5 text-center text-indigo-600" style={{width:'60px'}}>{summary.defectShort > 0 ? formatNum(summary.defectShort) : "—"}</td>
                    <td className="px-2 py-1.5 text-center text-indigo-600" style={{width:'60px'}}>{summary.defectBurst > 0 ? formatNum(summary.defectBurst) : "—"}</td>
                    <td className="px-2 py-1.5 text-center text-indigo-600" style={{width:'60px'}}>{summary.defectBottomConvex > 0 ? formatNum(summary.defectBottomConvex) : "—"}</td>
                    <td className="px-2 py-1.5 text-center text-indigo-600" style={{width:'60px'}}>{summary.defectVoltage > 0 ? formatNum(summary.defectVoltage) : "—"}</td>
                    <td className="px-2 py-1.5 text-center text-indigo-600" style={{width:'60px'}}>{summary.defectAppearance > 0 ? formatNum(summary.defectAppearance) : "—"}</td>
                    <td className="px-2 py-1.5 text-center text-indigo-600" style={{width:'60px'}}>{summary.defectLeakage > 0 ? formatNum(summary.defectLeakage) : "—"}</td>
                    <td className="px-2 py-1.5 text-center text-indigo-600" style={{width:'60px'}}>{summary.defectHighCap > 0 ? formatNum(summary.defectHighCap) : "—"}</td>
                    <td className="px-2 py-1.5 text-center text-indigo-600" style={{width:'60px'}}>{summary.defectLowCap > 0 ? formatNum(summary.defectLowCap) : "—"}</td>
                    <td className="px-2 py-1.5 text-center text-indigo-600" style={{width:'60px'}}>{summary.defectDF > 0 ? formatNum(summary.defectDF) : "—"}</td>
                    <td className="px-2 py-1.5 text-center text-indigo-400" style={{width:'80px'}}>—</td>
                    <td className="px-2 py-1.5 text-center text-indigo-400" style={{width:'150px'}}>—</td>
                    <td className="px-2 py-1.5 text-center text-indigo-400" style={{width:'100px'}}>—</td>
                    <td className="px-2 py-1.5 text-center text-indigo-400" style={{width:'70px'}}>—</td>
                  </tr>
                </tfoot><tbody>
                {filtered.map((r, i) => (
                  <tr key={r.id} className={`group hover:bg-indigo-50/40 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                    {renderCommentCell(r, 'entryDate', r.entryDate, 'whitespace-normal')}
                    {renderCommentCell(r, 'seq', r.seq)}
                    {renderCommentCell(r, 'materialCode', r.materialCode, 'font-medium text-gray-800')}
                    {renderCommentCell(r, 'spec', r.spec)}
                    {renderCommentCell(r, 'size', r.size)}
                    {renderCommentCell(r, 'workOrderNo', r.workOrderNo)}
                    {renderCommentCell(r, 'positiveFoilVoltage', r.positiveFoilVoltage)}
                    {renderCommentCell(r, 'designQty', r.designQty.toLocaleString())}
                    {renderCommentCell(r, 'actualQty', r.actualQty.toLocaleString())}
                    {renderCommentCell(r, 'windingQty', r.windingQty.toLocaleString())}
                    {renderCommentCell(r, 'goodQty', r.goodQty.toLocaleString())}
                    {(() => { const absLoss = Math.abs(r.loss); const hasComment = r.comments && r.comments['loss']; const colorClass = absLoss > 1 ? (hasComment ? 'text-yellow-600' : 'text-red-600') : (hasComment ? 'text-orange-500' : ''); return renderCommentCell(r, 'loss', r.loss >= 0 ? `+${formatNum(r.loss)}%` : `${formatNum(r.loss)}%`, colorClass); })()}
                    {(() => { const val = r.firstBottomConvexShortBurstRate; const hasComment = r.comments && r.comments['firstBottomConvexShortBurstRate']; const colorClass = val > 1 ? (hasComment ? 'text-yellow-600' : 'text-red-600') : (hasComment ? 'text-orange-500' : ''); return renderCommentCell(r, 'firstBottomConvexShortBurstRate', `${formatNum(val)}%`, colorClass); })()}
                    {renderCommentCell(r, 'firstPassRate', `${formatNum(r.firstPassRate)}%`)}
                    {renderCommentCell(r, 'batchYieldRate', r.batchYieldRate > 0 ? `${formatNum(r.batchYieldRate)}%` : '—')}
                    {renderCommentCell(r, 'defectShort', r.defectShort ? formatNum(r.defectShort) : '—')}
                    {renderCommentCell(r, 'defectBurst', r.defectBurst ? formatNum(r.defectBurst) : '—')}
                    {renderCommentCell(r, 'defectBottomConvex', r.defectBottomConvex ? formatNum(r.defectBottomConvex) : '—')}
                    {renderCommentCell(r, 'defectVoltage', r.defectVoltage ? formatNum(r.defectVoltage) : '—')}
                    {renderCommentCell(r, 'defectAppearance', r.defectAppearance ? formatNum(r.defectAppearance) : '—')}
                    {renderCommentCell(r, 'defectLeakage', r.defectLeakage ? formatNum(r.defectLeakage) : '—')}
                    {renderCommentCell(r, 'defectHighCap', r.defectHighCap ? formatNum(r.defectHighCap) : '—')}
                    {renderCommentCell(r, 'defectLowCap', r.defectLowCap ? formatNum(r.defectLowCap) : '—')}
                    {renderCommentCell(r, 'defectDF', r.defectDF ? formatNum(r.defectDF) : '—')}
                    {/* 作业员和备注不支持批注，保持原样 */}
                    <td className="px-2 py-1.5">{r.operator}</td>
                    <td className="px-2 py-1.5 max-w-[120px] truncate" title={r.notes}>{r.notes}</td>
                    {renderCommentCell(r, 'reworkOrderNo', r.reworkOrderNo)}
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
                                {/* 筛选结果汇总行 */}
                

              </tbody>
            </table>

          </div>
        )}

      {/* ── 汇总统计 ── */}
      <div className="mt-6 bg-white border border-gray-200 rounded-xl p-5">
        <h4 className="text-base font-bold text-gray-900 mb-4">📊 汇总统计</h4>

        {/* 彩色卡片概览 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-indigo-50 rounded-lg p-3">
            <div className="text-xs text-indigo-600 mb-1">总单数</div>
            <div className="text-xl font-bold text-indigo-700">{sheetRecords.length}</div>
          </div>
          <div className="bg-green-50 rounded-lg p-3">
            <div className="text-xs text-green-600 mb-1">良品数量</div>
            <div className="text-xl font-bold text-green-700">{totalGood.toLocaleString()}</div>
          </div>
          <div className="bg-blue-50 rounded-lg p-3">
            <div className="text-xs text-blue-600 mb-1">完工产量</div>
            <div className="text-xl font-bold text-blue-700">{totalActual.toLocaleString()}</div>
          </div>
          <div className="bg-amber-50 rounded-lg p-3">
            <div className="text-xs text-amber-600 mb-1">总直通率</div>
            <div className="text-xl font-bold text-amber-700">{totalPassRate}%</div>
          </div>
        </div>

        {/* 详细统计表格 */}
        <div className="mb-6">
          <h5 className="text-sm font-semibold text-gray-700 mb-2">详细统计</h5>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">统计项</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">数值</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">计算说明</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-white">
                  <td className="px-3 py-2 text-gray-800">平均损耗率</td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900">{avgLossRate}%</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">(完工产量 - 总设计数量) / 总设计数量 × 100%</td>
                </tr>
                <tr className="bg-gray-50">
                  <td className="px-3 py-2 text-gray-800">低压损耗 (≤120V)</td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900">{lowVoltageLossRate}%</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">规格电压 ≤ 120V 记录的平均损耗率</td>
                </tr>
                <tr className="bg-white">
                  <td className="px-3 py-2 text-gray-800">中压损耗 (160V-400V)</td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900">{midVoltageLossRate}%</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">160V ≤ 规格电压 &lt; 400V 记录的平均损耗率</td>
                </tr>
                <tr className="bg-gray-50">
                  <td className="px-3 py-2 text-gray-800">高压损耗 (≥400V)</td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900">{highVoltageLossRate}%</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">规格电压 ≥ 400V 记录的平均损耗率</td>
                </tr>
                <tr className="bg-white">
                  <td className="px-3 py-2 text-gray-800">底凸短路爆破率</td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900">{totalBottomConvexShortBurstRate}%</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">(短路+爆破+底凸) / 卷绕数 × 100%</td>
                </tr>
                <tr className="bg-gray-50">
                  <td className="px-3 py-2 text-gray-800">总直通率</td>
                  <td className="px-3 py-2 text-right font-medium text-indigo-600 font-semibold">{totalPassRate}%</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">良品数量 / 完工产量 × 100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 电压分布概览 */}
        <div>
          <h5 className="text-sm font-semibold text-gray-700 mb-2">电压分布概览</h5>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {voltageDistribution.map((item, idx) => (
              <div key={idx} className="bg-gray-50 rounded-lg p-3 flex justify-between items-center">
                <span className="text-xs text-gray-600">{item.label}</span>
                <span className="text-sm font-bold text-gray-800">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 备注不良类型统计 ── */}
      {noteDefectStats.totalCount > 0 && noteDefectStats.items.length > 0 && (
        <div className="mt-6 bg-white border border-gray-200 rounded-xl p-5">
          <h4 className="text-base font-bold text-gray-900 mb-4">📋 备注不良类型统计</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">不良类型</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">频次</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">百分比(%)</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">累积百分比(%)</th>
                </tr>
              </thead>
              <tbody>
                {noteDefectStats.items.map((item, idx) => (
                  <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-2 text-gray-800">{item.type}</td>
                    <td className="px-3 py-2 text-right font-medium text-gray-900">{item.count}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{item.percentage}%</td>
                    <td className="px-3 py-2 text-right text-indigo-600 font-semibold">{item.cumulativePercentage}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-indigo-50 border-t-2 border-indigo-200">
                  <td className="px-3 py-2 font-bold text-indigo-900">合计</td>
                  <td className="px-3 py-2 text-right font-bold text-indigo-900">{noteDefectStats.totalCount}</td>
                  <td className="px-3 py-2 text-right font-bold text-indigo-900">100%</td>
                  <td className="px-3 py-2 text-right text-indigo-600">—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      </div>

      {/* ── 批注编辑弹窗 ── */}
      {commentTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">
                编辑批注 - {commentTarget.field}
              </h2>
              <button onClick={closeCommentEditor} className="p-1 text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="请输入批注内容..."
                rows={4}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                autoFocus
              />
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
              <button onClick={closeCommentEditor} className="px-5 py-2 text-sm text-gray-600 hover:text-gray-800 transition">取消</button>
              <button onClick={saveComment} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm">
                保存批注
              </button>
            </div>
          </div>
        </div>
      )}

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
                    {textInputWithDatalist('materialCode', 'H1.HK.2G.6023')}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">规格</label>
                    {textInputWithDatalist('spec', '400V680uF')}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">尺寸</label>
                    {textInputWithDatalist('size', '35*60')}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">流转单号 <span className="text-red-400">*</span></label>
                    {textInput('workOrderNo', '2511001')}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">正箔电压</label>
                    {textInputWithDatalist('positiveFoilVoltage', '560V')}
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
                    {textInputWithDatalist('operator')}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">重工单号</label>
                    {textInputWithDatalist('reworkOrderNo')}
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

      {/* 柏拉图 */}
      {noteDefectStats.totalCount > 0 && noteDefectStats.items.length > 0 && (
        <div className="mt-6 bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-base font-bold text-gray-900">📈 备注不良类型柏拉图</h4>
            <button
              onClick={() => {
                const svgEl = document.getElementById('pareto-chart');
                if (svgEl) {
                  const svgData = new XMLSerializer().serializeToString(svgEl);
                  const canvas = document.createElement('canvas');
                  const ctx = canvas.getContext('2d');
                  if (!ctx) return;
                  const img = new Image();
                  img.onload = function() {
                    canvas.width = img.width; canvas.height = img.height;
                    ctx.drawImage(img, 0, 0);
                    canvas.toBlob(function(blob) {
                      if (blob) {
                        navigator.clipboard.write([new ClipboardItem({'image/png': blob})]).then(function() {
                          showToast('图表已复制到剪贴板');
                        }).catch(function() {
                          showToast('复制失败，请右键另存为图片');
                        });
                      }
                    });
                  };
                  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors"
            >
              复制到剪贴板
            </button>
          </div>
          <div id="pareto-chart" className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: generateParetoSVG(noteDefectStats.items) }} />
        </div>
      )}

      {/* 批注气泡 */}
      {renderCommentBubble()}
    </div>
  );
}
