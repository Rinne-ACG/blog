import { useState, useRef, useCallback, useEffect } from 'react';
import * as XLSX from 'xlsx';
import OpenAI from 'openai';

// ─── 类型定义 ───────────────────────────────────────────
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

// ─── 工具函数 ───────────────────────────────────────────
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // 返回 data URL（去掉 base64, 前缀）
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function downloadExcel(tables: TableData[], filename: string) {
  const wb = XLSX.utils.book_new();
  tables.forEach((table, idx) => {
    const sheetName = (table.title || `Sheet${idx + 1}`).slice(0, 31);
    const wsData = [table.headers, ...table.rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    // 设置列宽
    ws['!cols'] = table.headers.map(() => ({ wch: 16 }));
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${filename}_${today}.xlsx`);
}

// ─── GPT-4o 调用 ─────────────────────────────────────────
async function analyzeImageWithGPT(base64Image: string, mimeType: string): Promise<AnalysisResult> {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey || apiKey === 'your_openai_api_key_here') {
    throw new Error('请先在 .env.local 中配置 VITE_OPENAI_API_KEY');
  }

  const client = new OpenAI({
    apiKey,
    dangerouslyAllowBrowser: true, // 前端直接调用（Key 仅本地使用，不提交 git）
  });

  const prompt = `你是一个专业的表格识别助手。请分析图片中的所有表格数据，并以严格的 JSON 格式返回结果。

要求：
1. 识别图片中所有表格（可能有多个）
2. 提取表头和每行数据
3. 保持原始数据格式（数字就是数字，文字就是文字）
4. 如果单元格为空，用空字符串 "" 表示
5. 只返回 JSON，不要任何其他说明文字

返回格式：
{
  "tables": [
    {
      "title": "表格名称（如果图片中有的话，没有则用 Table1）",
      "headers": ["列1", "列2", "列3"],
      "rows": [
        ["数据1", "数据2", "数据3"],
        ["数据4", "数据5", "数据6"]
      ]
    }
  ],
  "description": "对图片内容的简短描述（不超过50字）"
}`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
              detail: 'high',
            },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? '';
  // 清洗可能存在的 markdown 代码块包裹
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  try {
    const parsed = JSON.parse(cleaned) as AnalysisResult;
    if (!parsed.tables || !Array.isArray(parsed.tables)) {
      throw new Error('返回格式不符合预期');
    }
    return parsed;
  } catch {
    throw new Error(`AI 返回的数据无法解析，原始内容：${content.slice(0, 200)}`);
  }
}

// ─── 主组件 ───────────────────────────────────────────────
export default function ImageToExcelPage() {
  const [step, setStep] = useState<Step>('upload');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState('');
  const [editingCell, setEditingCell] = useState<{ tableIdx: number; rowIdx: number; colIdx: number } | null>(null);
  const [editingHeader, setEditingHeader] = useState<{ tableIdx: number; colIdx: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // 清除图片预览 URL（避免内存泄露）
  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  // ─── 文件处理 ─────────────────────────────────────────
  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMsg('请上传图片文件（JPG、PNG、WEBP 等）');
      setStep('error');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setErrorMsg('图片大小不能超过 20MB');
      setStep('error');
      return;
    }
    const url = URL.createObjectURL(file);
    setImageFile(file);
    setImagePreviewUrl(url);
    setStep('upload');
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  // ─── 拖拽处理 ─────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  // ─── 粘贴处理（Ctrl+V）──────────────────────────────
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) handleFile(file);
          break;
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handleFile]);

  // ─── AI 分析 ──────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!imageFile) return;
    setStep('analyzing');
    setErrorMsg('');

    const messages = [
      '正在上传图片…',
      '正在识别表格结构…',
      'AI 分析中，请稍候…',
      '正在整理数据…',
    ];
    let msgIdx = 0;
    setProgress(messages[msgIdx]);
    const interval = setInterval(() => {
      msgIdx = (msgIdx + 1) % messages.length;
      setProgress(messages[msgIdx]);
    }, 2000);

    try {
      const base64 = await fileToBase64(imageFile);
      const mimeType = imageFile.type || 'image/jpeg';
      const analysisResult = await analyzeImageWithGPT(base64, mimeType);
      clearInterval(interval);
      setResult(analysisResult);
      setStep('preview');
    } catch (err) {
      clearInterval(interval);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setStep('error');
    }
  };

  // ─── 表格编辑 ─────────────────────────────────────────
  const updateCell = (tableIdx: number, rowIdx: number, colIdx: number, value: string) => {
    if (!result) return;
    const newResult = { ...result, tables: result.tables.map((t, ti) => {
      if (ti !== tableIdx) return t;
      const newRows = t.rows.map((row, ri) => {
        if (ri !== rowIdx) return row;
        const newRow = [...row];
        newRow[colIdx] = value;
        return newRow;
      });
      return { ...t, rows: newRows };
    })};
    setResult(newResult);
  };

  const updateHeader = (tableIdx: number, colIdx: number, value: string) => {
    if (!result) return;
    const newResult = { ...result, tables: result.tables.map((t, ti) => {
      if (ti !== tableIdx) return t;
      const newHeaders = [...t.headers];
      newHeaders[colIdx] = value;
      return { ...t, headers: newHeaders };
    })};
    setResult(newResult);
  };

  const addRow = (tableIdx: number) => {
    if (!result) return;
    const newResult = { ...result, tables: result.tables.map((t, ti) => {
      if (ti !== tableIdx) return t;
      const emptyRow = new Array(t.headers.length).fill('');
      return { ...t, rows: [...t.rows, emptyRow] };
    })};
    setResult(newResult);
  };

  const deleteRow = (tableIdx: number, rowIdx: number) => {
    if (!result) return;
    const newResult = { ...result, tables: result.tables.map((t, ti) => {
      if (ti !== tableIdx) return t;
      return { ...t, rows: t.rows.filter((_, ri) => ri !== rowIdx) };
    })};
    setResult(newResult);
  };

  // ─── 重置 ─────────────────────────────────────────────
  const handleReset = () => {
    setStep('upload');
    setImageFile(null);
    setImagePreviewUrl(null);
    setResult(null);
    setErrorMsg('');
    setProgress('');
    setEditingCell(null);
    setEditingHeader(null);
  };

  // ═══════════════════════════════════════════════════════
  //  渲染
  // ═══════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50/30">
      <div className="max-w-5xl mx-auto px-4 py-10">

        {/* ── 页头 ─────────────────────────────── */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg mb-4">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">图片转 Excel</h1>
          <p className="text-gray-500 text-sm">上传含有表格的照片，AI 自动识别并生成可编辑的 Excel 文件</p>
        </div>

        {/* ── 步骤指示器 ─────────────────────────── */}
        <div className="flex items-center justify-center gap-4 mb-8">
          {[
            { id: 1, label: '上传图片', active: step === 'upload' || step === 'error' },
            { id: 2, label: 'AI 识别', active: step === 'analyzing' },
            { id: 3, label: '编辑下载', active: step === 'preview' },
          ].map(({ id, label, active }, i, arr) => (
            <div key={id} className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  active ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' : 'bg-gray-200 text-gray-500'
                }`}>{id}</div>
                <span className={`text-sm font-medium ${active ? 'text-indigo-600' : 'text-gray-400'}`}>{label}</span>
              </div>
              {i < arr.length - 1 && <div className="w-10 h-px bg-gray-300" />}
            </div>
          ))}
        </div>

        {/* ═══ 步骤1：上传区域 ════════════════════════════ */}
        {(step === 'upload' || step === 'error') && (
          <div className="space-y-5">
            {/* 拖拽/上传区 */}
            <div
              ref={dropZoneRef}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !imageFile && fileInputRef.current?.click()}
              className={`relative rounded-2xl border-2 border-dashed transition-all duration-200 ${
                isDragging
                  ? 'border-indigo-400 bg-indigo-50 scale-[1.01]'
                  : imageFile
                  ? 'border-green-300 bg-green-50/30'
                  : 'border-gray-300 bg-white hover:border-indigo-300 hover:bg-indigo-50/20 cursor-pointer'
              }`}
              style={{ minHeight: '280px' }}
            >
              {imageFile && imagePreviewUrl ? (
                /* 已选择图片 */
                <div className="p-5 flex flex-col sm:flex-row gap-5 items-start">
                  <div className="relative flex-shrink-0">
                    <img
                      src={imagePreviewUrl}
                      alt="预览"
                      className="max-h-64 max-w-full sm:max-w-xs rounded-xl object-contain border border-gray-200 shadow-sm"
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleReset(); }}
                      className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 text-white text-xs flex items-center justify-center hover:bg-red-600 shadow"
                    >✕</button>
                  </div>
                  <div className="flex-1 pt-2">
                    <p className="font-medium text-gray-900 mb-1">{imageFile.name}</p>
                    <p className="text-sm text-gray-500 mb-4">{(imageFile.size / 1024).toFixed(1)} KB · {imageFile.type}</p>
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAnalyze(); }}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors shadow shadow-indigo-200"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.347a3.854 3.854 0 00-1.083 1.899l-.18.72a1 1 0 01-.97.765h-1.572a1 1 0 01-.97-.765l-.18-.72a3.854 3.854 0 00-1.083-1.899l-.347-.347z" />
                        </svg>
                        开始 AI 识别
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 transition-colors"
                      >
                        重新选择
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* 未选择图片 */
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8">
                  <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="text-center">
                    <p className="text-gray-700 font-medium mb-1">拖拽图片到这里，或点击选择</p>
                    <p className="text-gray-400 text-sm">支持 JPG、PNG、WEBP 等格式，最大 20MB</p>
                    <p className="text-gray-400 text-xs mt-1">也可以直接 Ctrl+V 粘贴截图</p>
                  </div>
                </div>
              )}
            </div>

            {/* 操作按钮组（未选图片时显示） */}
            {!imageFile && (
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-medium hover:border-indigo-300 hover:text-indigo-600 transition-colors shadow-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  选择文件
                </button>
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-medium hover:border-indigo-300 hover:text-indigo-600 transition-colors shadow-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  拍照上传
                </button>
              </div>
            )}

            {/* 错误提示 */}
            {step === 'error' && errorMsg && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-4 flex gap-3">
                <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-red-800">识别失败</p>
                  <p className="text-sm text-red-600 mt-0.5 whitespace-pre-wrap">{errorMsg}</p>
                </div>
              </div>
            )}

            {/* 隐藏 input */}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleInputChange} />
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleInputChange} />
          </div>
        )}

        {/* ═══ 步骤2：AI 分析中 ════════════════════════ */}
        {step === 'analyzing' && (
          <div className="flex flex-col items-center justify-center py-20 gap-6">
            <div className="relative">
              <div className="w-20 h-20 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-200">
                <svg className="w-10 h-10 text-white animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.347a3.854 3.854 0 00-1.083 1.899l-.18.72a1 1 0 01-.97.765h-1.572a1 1 0 01-.97-.765l-.18-.72a3.854 3.854 0 00-1.083-1.899l-.347-.347z" />
                </svg>
              </div>
              {/* 旋转环 */}
              <div className="absolute inset-0 rounded-2xl border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
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

        {/* ═══ 步骤3：预览 & 编辑 ════════════════════════ */}
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
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => addRow(tableIdx)}
                      className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-indigo-50 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      添加行
                    </button>
                    <button
                      onClick={() => downloadExcel([table], table.title ?? `表格${tableIdx + 1}`)}
                      className="text-xs text-green-600 hover:text-green-700 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-green-50 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      单独下载
                    </button>
                  </div>
                </div>

                {/* 表格主体 */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-indigo-50/60">
                        <th className="w-8 px-2 py-2 text-center text-xs text-gray-400 font-normal border-b border-gray-100">#</th>
                        {table.headers.map((header, colIdx) => (
                          <th key={colIdx} className="px-3 py-2 text-left font-semibold text-gray-700 border-b border-gray-100 min-w-[100px]">
                            {editingHeader?.tableIdx === tableIdx && editingHeader.colIdx === colIdx ? (
                              <input
                                autoFocus
                                className="w-full border border-indigo-300 rounded px-1.5 py-0.5 text-sm font-medium bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                value={header}
                                onChange={e => updateHeader(tableIdx, colIdx, e.target.value)}
                                onBlur={() => setEditingHeader(null)}
                                onKeyDown={e => e.key === 'Enter' && setEditingHeader(null)}
                              />
                            ) : (
                              <span
                                className="cursor-pointer hover:text-indigo-600 transition-colors"
                                title="点击编辑表头"
                                onClick={() => setEditingHeader({ tableIdx, colIdx })}
                              >
                                {header || <span className="text-gray-300 italic">空表头</span>}
                              </span>
                            )}
                          </th>
                        ))}
                        <th className="w-8 px-2 py-2 border-b border-gray-100" />
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row, rowIdx) => (
                        <tr
                          key={rowIdx}
                          className={`group border-b border-gray-50 last:border-0 ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'} hover:bg-indigo-50/30 transition-colors`}
                        >
                          <td className="px-2 py-1.5 text-center text-xs text-gray-300 select-none">{rowIdx + 1}</td>
                          {table.headers.map((_, colIdx) => (
                            <td key={colIdx} className="px-3 py-1.5">
                              {editingCell?.tableIdx === tableIdx && editingCell.rowIdx === rowIdx && editingCell.colIdx === colIdx ? (
                                <input
                                  autoFocus
                                  className="w-full border border-indigo-300 rounded px-1.5 py-0.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 min-w-[80px]"
                                  value={String(row[colIdx] ?? '')}
                                  onChange={e => updateCell(tableIdx, rowIdx, colIdx, e.target.value)}
                                  onBlur={() => setEditingCell(null)}
                                  onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') setEditingCell(null); }}
                                />
                              ) : (
                                <span
                                  className="cursor-pointer text-gray-700 hover:text-indigo-700 transition-colors block min-w-[80px]"
                                  title="点击编辑"
                                  onClick={() => setEditingCell({ tableIdx, rowIdx, colIdx })}
                                >
                                  {row[colIdx] !== '' && row[colIdx] != null
                                    ? String(row[colIdx])
                                    : <span className="text-gray-200">—</span>}
                                </span>
                              )}
                            </td>
                          ))}
                          {/* 删除行按钮 */}
                          <td className="px-2 py-1.5 text-center">
                            <button
                              onClick={() => deleteRow(tableIdx, rowIdx)}
                              className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all"
                              title="删除此行"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      ))}
                      {table.rows.length === 0 && (
                        <tr>
                          <td colSpan={table.headers.length + 2} className="py-8 text-center text-gray-400 text-sm">
                            暂无数据行，点击上方"添加行"手动录入
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {/* 底部下载按钮 */}
            <div className="flex justify-center pt-2 pb-4">
              <button
                onClick={() => downloadExcel(result.tables, imageFile?.name?.replace(/\.[^.]+$/, '') ?? '识别结果')}
                className="inline-flex items-center gap-2 px-8 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg shadow-indigo-200 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                下载所有表格 (.xlsx)
              </button>
            </div>
          </div>
        )}

        {/* ── 使用说明 ─────────────────────────── */}
        {step === 'upload' && !imageFile && (
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                icon: '📸',
                title: '拍照或选图',
                desc: '上传包含表格的照片，支持手写、打印、截图等各种格式',
              },
              {
                icon: '🤖',
                title: 'AI 自动识别',
                desc: '由 GPT-4o 视觉模型解析图片中的表格结构和数据',
              },
              {
                icon: '📊',
                title: '编辑并下载',
                desc: '在线校对、修改数据，一键下载为标准 Excel 文件',
              },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-5 text-center">
                <div className="text-3xl mb-3">{icon}</div>
                <p className="font-semibold text-gray-900 mb-1.5">{title}</p>
                <p className="text-gray-500 text-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
