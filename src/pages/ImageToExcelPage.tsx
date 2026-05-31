import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';

// ─── 类型定义 ────────────────────────────────────────
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

// ─── 工具函数 ────────────────────────────────────────
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 压缩图片：限制最大宽度/高度为 1024px，降低质量减少 base64 体积
function compressImage(file: File, maxSize = 1024, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas 不支持')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve(dataUrl.split(',')[1]);
    };
    img.onerror = reject;
    img.src = url;
  });
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

// ─── 通过 Vite 代理调用 AI（开发环境）────────────────
async function analyzeImageWithAI(base64Image: string, mimeType: string): Promise<AnalysisResult> {
  const prompt = `你是一个专业的表格识别助手。用户上传的是一张纸质表格的照片，请仔细识别图片中的表格结构，并以严格的 JSON 格式返回结果。

重要提示：
- 图片中一定包含一个或多个表格（可能是打印在纸上的表格）
- 即使表格是倾斜的、有阴影的、或者拍摄角度不佳，也请尽量识别
- 识别所有可见的表头列名和每一行的数据
- 不要返回空 tables 数组，如果确实有表格，请务必提取出来

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

  // 清洗 markdown 代码块包裹：去掉开头 ```json 或 ```，去掉结尾 ```
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

// ─── 主组件 ────────────────────────────────────────
export default function ImageToExcelPage() {
  const [step, setStep] = useState<Step>('upload');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState('');
  const [editingCell, setEditingCell] = useState<{ tableIdx: number; rowIdx: number; colIdx: number } | null>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMsg('请上传图片文件（JPG/PNG/BMP 等）');
      setStep('error');
      return;
    }
    setImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
    setStep('analyzing');
    setProgress('正在上传图片并调用 AI 识别...');

    try {
      const base64 = await compressImage(file);
      const mimeType = 'image/jpeg'; // compressImage 输出 jpeg
      const analysisResult = await analyzeImageWithAI(base64, mimeType);
      setResult(analysisResult);
      setStep('preview');
    } catch (e: any) {
      setErrorMsg(e.message || '识别失败');
      setStep('error');
    }
  }, []);

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

  // ─── 渲染 ────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 p-6">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* 标题 */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">图片转 Excel</h1>
          <p className="text-gray-500">上传包含表格的图片，AI 自动识别并生成 Excel 文件</p>
        </div>

        {/* ═══ 步骤1：上传 ════════════════════════ */}
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
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l-2.586-2.586a2 2 0 00-2.828 0L6 18m8-2l.01-0.01M3 3h18v18H3z" />
                </svg>
              </div>
              <div>
                <p className="text-lg font-semibold text-gray-700">拖拽图片到这里，或点击上传</p>
                <p className="text-sm text-gray-400 mt-1">支持 JPG / PNG / BMP / WebP</p>
              </div>
            </div>
          </div>
        )}

        {/* ═══ 步骤2：识别中 ════════════════════════ */}
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

        {/* ═══ 步骤4：错误 ════════════════════════ */}
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
