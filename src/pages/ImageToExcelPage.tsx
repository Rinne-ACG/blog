import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import EXIF from 'exif-js';

// ─── 类型定义 ──────────────────────────
interface TableData {
  headers: string[];
  rows: (string | number)[][];
  title?: string;
}

interface AnalysisResult {
  tables: TableData[];
  description?: string;
}

type Step = 'upload' | 'analyzing' | 'preview' | 'error';

/**
 * 读取图片 EXIF 方向标签
 * 返回 orientation 值（1=正常，6=顺时针90°，8=逆时针90°，3=180°）
 */
function getEXIFOrientation(file: File): Promise<number> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const buffer = reader.result as ArrayBuffer;
        const orientation = EXIF.getTag(new Uint8Array(buffer), 'Orientation');
        resolve(orientation ?? 1);
      } catch {
        resolve(1);
      }
    };
    reader.onerror = () => resolve(1);
    // 只读取前 128KB 足够了（EXIF 在文件头部）
    const slice = file.slice(0, 131072);
    reader.readAsArrayBuffer(slice);
  });
}

/**
 * 根据 EXIF orientation 旋转图片，返回校正后的 data URL（image/jpeg）
 */
function rotateImageByEXIF(file: File, orientation: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = img;

      // 根据 orientation 决定画布尺寸和变换矩阵
      let canvasW = width, canvasH = height;
      const needSwap = orientation >= 5 && orientation <= 8;
      if (needSwap) { canvasW = height; canvasH = width; }

      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas 不支持')); return; }

      // 先平移原点到画布中心，再旋转，再平移回去
      ctx.translate(canvasW / 2, canvasH / 2);

      switch (orientation) {
        case 2:  ctx.scale(-1, 1); break;                       // 水平翻转
        case 3:  ctx.rotate(Math.PI); break;                         // 180°
        case 4:  ctx.scale(1, -1); break;                         // 垂直翻转
        case 5:  ctx.rotate(0.5 * Math.PI); ctx.scale(1, -1); break;
        case 6:  ctx.rotate(0.5 * Math.PI); break;               // 顺时针 90°
        case 7:  ctx.rotate(-0.5 * Math.PI); ctx.scale(1, -1); break;
        case 8:  ctx.rotate(-0.5 * Math.PI); break;              // 逆时针 90°
        default: break;
      }

      ctx.drawImage(img, -width / 2, -height / 2);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      resolve(dataUrl);
    };
    img.onerror = reject;
    img.src = url;
  });
}

// 直接将图片文件转为 base64（自动 EXIF 旋转校正）
async function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  const orientation = await getEXIFOrientation(file);
  let dataUrl: string;

  if (orientation >= 2) {
    dataUrl = await rotateImageByEXIF(file, orientation);
  } else {
    dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  const mimeType = dataUrl.match(/^data:(.*?);base64,/)?.[1] ?? 'image/jpeg';
  const base64 = dataUrl.split(',')[1];
  return { base64, mimeType };
}

function downloadExcel(tables: TableData[], filename: string) {
  if (!tables || tables.length === 0) {
    alert('没有可下载的表格数据');
    return;
  }
  const wb = XLSX.utils.book_new();
  tables.forEach((table, idx) => {
    const sheetName = (table.title || `Sheet${idx + 1}`).slice(0, 31);
    const wsData = [table.headers, ...table.rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = table.headers.map(() => ({ wch: 16 }));
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${filename}_${today}.xlsx`);
}

// ─── 通过 Vite 代理调用 AI ─────────────────────
async function analyzeImageWithAI(base64Image: string, mimeType: string): Promise<AnalysisResult> {
  const prompt = `你是一个专业的手写表格识别专家，专门识别铝电解电容器行业的生产盘点表。

【图片特征】
- 这是一张手写的纸质表格照片，字迹可能潦草、有连笔
- 表格可能是竖向排列的（表头在右侧，数据列向左延伸），请校正为标准横向表格输出
- 表中包含大量工程符号和单位，必须准确识别

【必须准确识别的特殊符号】
- 容量单位：μF（微法，手写可能像"uF"，但必须输出为"μF"）
- 电压单位：V、VF（耐压值，如 620VF）
- 尺寸符号：×（乘号，如 30×30、16×155）
- 误差符号：±（正负号，如 ±10%、±20%）
- 批号：纯数字，如 2606222、260630，注意区分 0 和 6、1 和 7、5 和 6

【表头列名（从上到下）】
生产批号 | 系列 | 规格 | 尺寸 | 容量误差(%) | 铝箔耐压 | 盘点数量(颗) | 放置地点 | 备注

【输出要求】
1. 将竖向表格校正为标准横向表格（一行 = 一条记录）
2. 批号必须逐位核对，不能多也不能少
3. 规格列格式为"电压/容量"，如"450V/30μF"
4. 尺寸列格式为"直径×高度"，如"30×30"
5. 盘点数量是纯数字，不要带单位
6. 空单元格用空字符串""表示
7. 不确定的内容用[?]标记，不要猜测

【返回格式示例】
{
  "tables": [
    {
      "title": "组套后产品盘点表",
      "headers": ["生产批号", "系列", "规格", "尺寸", "容量误差(%)", "铝箔耐压", "盘点数量(颗)", "放置地点", "备注"],
      "rows": [
        ["2606222", "HK", "450V/30μF", "30×30", "±20%", "620VF", "584", "老化桂排孔", ""]
      ]
    }
  ],
  "description": "铝电解电容器组套后产品盘点表"
}

只返回 JSON，不要任何其他说明文字。`;

  const response = await fetch('/api/ai-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'glm-5v-turbo',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Image}` },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AI 服务错误 ${response.status}: ${errText}`);
  }

  const data: any = await response.json();
  const content: string = data?.choices?.[0]?.message?.content ?? '';
  if (!content) {
    throw new Error(`AI 返回内容为空，完整响应：${JSON.stringify(data).slice(0, 500)}`);
  }

  // 清洗 markdown 代码块包裹
  let cleaned = content;
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '');
  cleaned = cleaned.replace(/\n?\s*```\s*$/, '');
  cleaned = cleaned.trim();

  console.log('清洗后的 AI 返回内容:', cleaned.slice(0, 300));

  try {
    const parsed = JSON.parse(cleaned) as AnalysisResult;
    if (!parsed.tables || !Array.isArray(parsed.tables) || parsed.tables.length === 0) {
      throw new Error('AI 未识别到任何表格，请上传包含清晰表格的图片');
    }
    return parsed;
  } catch (e: any) {
    throw new Error(`AI 返回的数据无法解析：${e.message}\n原始内容：${content.slice(0, 300)}`);
  }
}

// ─── 解析单元格数组为表格数据（多个地方复用）───
function parseCellsToTables(cells: any[]): AnalysisResult {
  const getRow = (c: any) => (typeof c.Row === 'number' ? c.Row : typeof c.RowIndex === 'number' ? c.RowIndex : 0);
  const getCol = (c: any) => (typeof c.Column === 'number' ? c.Column : typeof c.ColIndex === 'number' ? c.ColIndex : 0);
  const getText = (c: any) => c.Text ?? c.Word ?? '';

  const maxRow = Math.max(...cells.map(getRow));
  const maxCol = Math.max(...cells.map(getCol));
  const headers: string[] = [];
  const rows: string[][] = [];

  for (let r = 0; r <= maxRow; r++) {
    const rowCells = cells.filter(c => getRow(c) === r).sort((a, b) => getCol(a) - getCol(b));
    const rowData = new Array(maxCol + 1).fill('');
    rowCells.forEach(c => { rowData[getCol(c)] = getText(c); });
    if (r === 0) {
      rowData.forEach((v, i) => { headers[i] = v || `列${i + 1}`; });
    } else {
      rows.push(rowData);
    }
  }

  return {
    tables: [{ title: '识别结果', headers, rows }],
    description: '腾讯云 OCR 识别结果',
  };
}

// ─── 通过腾讯云 OCR 识别表格 ─────────────────────
async function analyzeImageTencent(base64Image: string): Promise<AnalysisResult> {
  const response = await fetch('/api/tencent-ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64: base64Image }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`腾讯云 OCR 服务错误 ${response.status}: ${errText}`);
  }

  const data: any = await response.json();
  console.log('【腾讯云 OCR 原始返回】', JSON.stringify(data, null, 2).slice(0, 3000));

  const resp = data.Response;
  if (!resp || resp.Error) {
    throw new Error(`腾讯云 OCR 识别失败：${resp?.Error?.Message || '未知错误'}`);
  }

  // ── 情况1：直接返回 TableDetectInfos（旧版 API）───
  const tableInfos: any[] = resp.TableDetectInfos || [];
  if (tableInfos.length) {
    const cells: any[] = tableInfos[0]?.Cells || [];
    if (cells.length) {
      return parseCellsToTables(cells);
    }
  }

  // ── 情况2：返回 Data 字段（base64 编码的 ZIP 文件，新版 API）───
  const dataB64: string = resp.Data;
  if (!dataB64) {
    throw new Error('腾讯云 OCR 未识别到任何表格');
  }

  // 直接用 xlsx 库解析 base64 数据（ZIP 实际是 .xlsx 格式）
  try {
    // 清理 base64 数据（去掉可能的换行/空格）
    const cleanB64 = dataB64.replace(/[\s\r\n]/g, '');
    const workbook = XLSX.read(cleanB64, { type: 'base64', cellDates: true });
    if (!workbook.SheetNames.length) {
      throw new Error('腾讯云 OCR 返回的 Excel 文件没有工作表');
    }
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      throw new Error('无法读取工作表数据');
    }

    // 直接用 xlsx 内置方法转为数组
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (!jsonData || jsonData.length === 0) {
      throw new Error('Excel 数据为空');
    }

    // 第一行作为表头
    const headers: string[] = (jsonData[0] as any[]).map((h: any, i: number) => String(h || `列${i + 1}`));
    const rows: any[][] = [];
    for (let r = 1; r < jsonData.length; r++) {
      const row = jsonData[r] as any[];
      if (row && row.length) {
        const rowData = new Array(headers.length).fill('');
        for (let c = 0; c < row.length; c++) {
          rowData[c] = String(row[c] ?? '');
        }
        rows.push(rowData);
      }
    }

    return {
      tables: [{ title: '腾讯云 OCR 识别结果', headers, rows }],
      description: '腾讯云 OCR 识别结果（xlsx 格式）',
    };
  } catch (e: any) {
    console.error('xlsx 解析失败：', e);
    throw new Error('腾讯云 OCR 识别结果解析失败：' + String(e.message || e));
  }
}


export default function ImageToExcelPage() {
  const [step, setStep] = useState<Step>('upload');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState('');
  const [editingCell, setEditingCell] = useState<{ tableIdx: number; rowIdx: number; colIdx: number } | null>(null);
  const [ocrMode, setOcrMode] = useState<'ai' | 'tencent'>('ai');

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMsg('请上传图片文件（JPG/PNG/BMP 等）');
      setStep('error');
      return;
    }
    setImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
    setStep('analyzing');
    setProgress('正在读取图片（自动校正方向）...');

    try {
      const { base64, mimeType } = await fileToBase64(file);

      if (ocrMode === 'tencent') {
        setProgress('正在调用腾讯云 OCR 识别...');
        const analysisResult = await analyzeImageTencent(base64);
        setResult(analysisResult);
        setStep('preview');
      } else {
        setProgress('正在调用 AI 识别...');
        setProgress('AI 识别中...');
        const analysisResult = await analyzeImageWithAI(base64, mimeType);
        setResult(analysisResult);
        setStep('preview');
      }
    } catch (e: any) {
      setErrorMsg(e.message || '识别失败');
      setStep('error');
    }
  }, [ocrMode]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleReset = useCallback(() => {
    setStep('upload');
    setImageFile(null);
    setImagePreviewUrl(null);
    setResult(null);
    setErrorMsg('');
    setEditingCell(null);
  }, []);

  // 单元格编辑
  const handleCellChange = useCallback((tableIdx: number, rowIdx: number, colIdx: number, value: string) => {
    setResult(prev => {
      if (!prev) return prev;
      const newTables = [...prev.tables];
      const newRows = [...newTables[tableIdx].rows];
      newRows[rowIdx] = [...newRows[rowIdx]];
      newRows[rowIdx][colIdx] = value;
      newTables[tableIdx] = { ...newTables[tableIdx], rows: newRows };
      return { ...prev, tables: newTables };
    });
    setEditingCell(null);
  }, []);

  // 添加行
  const handleAddRow = useCallback((tableIdx: number) => {
    setResult(prev => {
      if (!prev) return prev;
      const newTables = [...prev.tables];
      const cols = newTables[tableIdx].headers.length;
      const newRow = new Array(cols).fill('');
      newTables[tableIdx] = { ...newTables[tableIdx], rows: [...newTables[tableIdx].rows, newRow] };
      return { ...prev, tables: newTables };
    });
  }, []);

  // 删除行
  const handleDeleteRow = useCallback((tableIdx: number, rowIdx: number) => {
    setResult(prev => {
      if (!prev) return prev;
      const newTables = [...prev.tables];
      const newRows = newTables[tableIdx].rows.filter((_, i) => i !== rowIdx);
      newTables[tableIdx] = { ...newTables[tableIdx], rows: newRows };
      return { ...prev, tables: newTables };
    });
  }, []);

  // ─── 渲染 ─────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 p-6">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* 标题 */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">图片转 Excel</h1>
          <p className="text-gray-500">上传包含表格的图片，AI 自动识别并生成 Excel 文件</p>
          <p className="text-xs text-gray-400 mt-1">✅ 已启用自动方向校正（EXIF 旋转检测）</p>
        </div>

        {/* OCR 模式切换 */}
        <div className="flex justify-center">
          <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
            <button
              onClick={() => setOcrMode('ai')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                ocrMode === 'ai'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              🤖 AI 识别（GLM-5V）
            </button>
            <button
              onClick={() => setOcrMode('tencent')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                ocrMode === 'tencent'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              ☁️ 腾讯云 OCR（手写优先）
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2 text-center w-full">
            {ocrMode === 'tencent' ? '✅ 手写表格推荐用腾讯云 OCR' : '✅ 印刷体表格推荐用 AI 识别'}
          </p>
        </div>

        {/* ═══ 步骤1：上传 ══════════════════ */}
        {step === 'upload' && (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors cursor-pointer
              ${isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-white hover:border-indigo-400 hover:bg-indigo-50/50'}`}
            onClick={() => document.getElementById('file-input')?.click()}
          >
            <input id="file-input" type="file" accept="image/*" className="hidden" onChange={handleFileInput} />
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l-2.586-2.586a2 2 0 00-2.828 0L6 18m8-2l.01-.01M3 3h18v18H3z" />
                </svg>
              </div>
              <div>
                <p className="text-lg font-semibold text-gray-700">拖拽图片到这里，或点击上传</p>
                <p className="text-sm text-gray-400 mt-1">支持 JPG / PNG / BMP / WebP（自动校正拍摄方向）</p>
              </div>
            </div>
          </div>
        )}

        {/* ═══ 步骤2：识别中 ══════════════════ */}
        {step === 'analyzing' && (
          <div className="flex flex-col items-center gap-6 py-12">
            <div className="relative">
              <div className="w-20 h-20 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
            </div>
            <div className="text-center">
              <p className="text-gray-900 font-semibold text-lg mb-1">AI 正在识别中</p>
              <p className="text-gray-500 text-sm">{progress}</p>
            </div>
            {imagePreviewUrl && (
              <img src={imagePreviewUrl} alt="分析中" className="max-h-40 rounded-xl opacity-50 border border-gray-200" />
            )}
          </div>
        )}

        {/* ═══ 步骤3：预览 & 编辑 ══════════════════ */}
        {step === 'preview' && result && (
          <div className="space-y-6">
            {/* 顶部信息栏 */}
            <div className="flex flex-wrap items-start justify-between gap-4 bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
              <div className="flex items-start gap-3">
                {imagePreviewUrl && (
                  <img src={imagePreviewUrl} alt="原图" className="w-16 h-16 rounded-lg object-cover border border-gray-200 flex-shrink-0" />
                )}
                <div>
                  <p className="font-semibold text-gray-900">识别完成</p>
                  <p className="text-sm text-gray-500 mt-0.5">共识别到 {result.tables.length} 个表格</p>
                  {result.description && (
                    <p className="text-xs text-gray-400 mt-1 italic">"{result.description}"</p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => downloadExcel(result.tables, imageFile?.name?.replace(/\.[^.]+$/, '') ?? '识别结果')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors shadow shadow-green-200"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  下载 Excel
                </button>
                <button
                  onClick={handleReset}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 transition-colors"
                >
                  重新上传
                </button>
              </div>
            </div>

            {/* 各表格预览（可编辑） */}
            {result.tables.map((table, tableIdx) => (
              <div key={tableIdx} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {/* 表格标题栏 */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50/50">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-indigo-400" />
                    <span className="font-medium text-gray-800 text-sm">{table.title || `表格 ${tableIdx + 1}`}</span>
                    <span className="text-xs text-gray-400 ml-1">· {table.rows.length} 行 × {table.headers.length} 列</span>
                  </div>
                  <button
                    onClick={() => handleAddRow(tableIdx)}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                  >
                    + 添加行
                  </button>
                </div>

                {/* 表格本体 */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-100 text-xs text-gray-600 uppercase tracking-wider">
                        <th className="px-4 py-2.5 text-left w-10">#</th>
                        {table.headers.map((h, i) => (
                          <th key={i} className="px-4 py-2.5 text-left">{h}</th>
                        ))}
                        <th className="px-4 py-2.5 w-16">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row, rowIdx) => (
                        <tr key={rowIdx} className="border-t border-gray-50 hover:bg-indigo-50/30 transition-colors">
                          <td className="px-4 py-2 text-gray-400 text-xs">{rowIdx + 1}</td>
                          {row.map((cell, colIdx) => (
                            <td key={colIdx} className="px-4 py-2">
                              {editingCell?.tableIdx === tableIdx && editingCell?.rowIdx === rowIdx && editingCell?.colIdx === colIdx ? (
                                <input
                                  autoFocus
                                  className="w-full px-2 py-1 border border-indigo-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                  defaultValue={String(cell ?? '')}
                                  onBlur={e => handleCellChange(tableIdx, rowIdx, colIdx, e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') handleCellChange(tableIdx, rowIdx, colIdx, (e.target as HTMLInputElement).value); }}
                                />
                              ) : (
                                <span
                                  className="cursor-pointer hover:bg-yellow-50 px-1 py-0.5 rounded"
                                  onClick={() => setEditingCell({ tableIdx, rowIdx, colIdx })}
                                >
                                  {String(cell ?? '')}
                                </span>
                              )}
                            </td>
                          ))}
                          <td className="px-4 py-2">
                            <button
                              onClick={() => handleDeleteRow(tableIdx, rowIdx)}
                              className="text-red-400 hover:text-red-600 text-xs"
                              title="删除此行"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ═══ 步骤4：错误 ══════════════════ */}
        {step === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-red-700 font-semibold">{errorMsg}</p>
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
            >
              重新上传
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
