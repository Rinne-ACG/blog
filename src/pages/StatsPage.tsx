import { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import type { ProductionRecord } from '../types';

// 生成唯一ID
const generateId = () => Math.random().toString(36).slice(2, 11);

// 计算良率
const calcYieldRate = (good: number, total: number): number => {
  if (total === 0) return 0;
  return Math.round((good / total) * 10000) / 100;
};

// 计算不良数
const calcDefect = (total: number, good: number): number => total - good;

// 空记录模板
const createEmptyRecord = (): ProductionRecord => ({
  id: generateId(),
  date: new Date().toISOString().slice(0, 10),
  productModel: '',
  productionQty: 0,
  goodQty: 0,
  defectQty: 0,
  yieldRate: 0,
  notes: '',
});

export default function StatsPage() {
  const [records, setRecords] = useState<ProductionRecord[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductionRecord>(createEmptyRecord());
  const [searchQuery, setSearchQuery] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 显示提示
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 2500);
  };

  // 过滤记录
  const filtered = records.filter(r => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      r.date.includes(q) ||
      r.productModel.toLowerCase().includes(q) ||
      r.notes.toLowerCase().includes(q)
    );
  });

  // 统计数据
  const totalProduction = records.reduce((s, r) => s + r.productionQty, 0);
  const totalGood = records.reduce((s, r) => s + r.goodQty, 0);
  const totalDefect = records.reduce((s, r) => s + r.defectQty, 0);
  const overallYield = calcYieldRate(totalGood, totalProduction);

  // 打开新增表单
  const openAddForm = () => {
    setEditingId(null);
    setForm(createEmptyRecord());
    setShowForm(true);
  };

  // 打开编辑表单
  const openEditForm = (record: ProductionRecord) => {
    setEditingId(record.id);
    setForm({ ...record });
    setShowForm(true);
  };

  // 删除记录
  const deleteRecord = (id: string) => {
    if (!confirm('确定要删除这条记录吗？')) return;
    setRecords(prev => prev.filter(r => r.id !== id));
    showToast('已删除');
  };

  // 保存记录（新增或编辑）
  const saveRecord = () => {
    if (!form.productModel.trim()) {
      alert('请填写产品型号');
      return;
    }
    if (form.productionQty <= 0) {
      alert('生产数量必须大于 0');
      return;
    }
    if (form.goodQty < 0 || form.goodQty > form.productionQty) {
      alert('良品数量应在 0 ~ 生产数量之间');
      return;
    }

    const defectQty = calcDefect(form.productionQty, form.goodQty);
    const yieldRate = calcYieldRate(form.goodQty, form.productionQty);

    const finalRecord: ProductionRecord = {
      ...form,
      defectQty,
      yieldRate,
    };

    if (editingId) {
      setRecords(prev => prev.map(r => r.id === editingId ? finalRecord : r));
      showToast('修改成功');
    } else {
      setRecords(prev => [finalRecord, ...prev]);
      showToast('添加成功');
    }
    setShowForm(false);
  };

  // 导入 Excel
  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const wsName = wb.SheetNames[0];
        const ws = wb.Sheets[wsName];
        const json: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws);

        if (json.length === 0) {
          alert('Excel 文件中没有数据');
          return;
        }

        // 尝试自动映射列名（兼容多种命名方式）
        const mapped: ProductionRecord[] = json.map((row: Record<string, unknown>) => {
          // 尝试匹配列名
          const getVal = (keys: string[]): string | number => {
            for (const k of keys) {
              if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k] as string | number;
            }
            return '';
          };

          const dateRaw = getVal(['日期', 'date', 'Date', '生产日期', '生产日']);
          const productRaw = getVal(['产品型号', 'productModel', '型号', '产品', '型号']);
          const prodQtyRaw = getVal(['生产数量', 'productionQty', '生产数', '产量', '总数量', 'total']);
          const goodQtyRaw = getVal(['良品数量', 'goodQty', '良品数', '良品', '合格数', 'good']);

          // 统一处理日期
          let dateStr = '';
          if (typeof dateRaw === 'number' && dateRaw > 40000) {
            // Excel 日期序列号
            dateStr = XLSX.SSF.parse_date_code(dateRaw)?.date ?? String(dateRaw);
          } else {
            dateStr = String(dateRaw).slice(0, 10);
          }

          const productionQty = Math.max(0, Number(prodQtyRaw) || 0);
          const goodQty = Math.max(0, Math.min(productionQty, Number(goodQtyRaw) || 0));

          return {
            id: generateId(),
            date: dateStr,
            productModel: String(productRaw),
            productionQty,
            goodQty,
            defectQty: calcDefect(productionQty, goodQty),
            yieldRate: calcYieldRate(goodQty, productionQty),
            notes: String(getVal(['备注', 'notes', 'Notes', '说明', '备注信息']) || ''),
          };
        });

        setRecords(prev => [...mapped.reverse(), ...prev]);
        showToast(`成功导入 ${mapped.length} 条记录`);
      } catch (err) {
        console.error(err);
        alert('读取 Excel 文件失败，请确认文件格式正确');
      }
    };
    reader.readAsArrayBuffer(file);
    // 清空 input，允许重复选择同一文件
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // 导出 Excel
  const handleExport = () => {
    if (records.length === 0) {
      alert('暂无数据可导出');
      return;
    }

    // 准备数据（去掉 id 列）
    const exportData = records.map(r => ({
      '日期': r.date,
      '产品型号': r.productModel,
      '生产数量': r.productionQty,
      '良品数量': r.goodQty,
      '不良数量': r.defectQty,
      '良率(%)': r.yieldRate,
      '备注': r.notes,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    // 设置列宽
    ws['!cols'] = [
      { wch: 12 }, // 日期
      { wch: 18 }, // 产品型号
      { wch: 10 }, // 生产数量
      { wch: 10 }, // 良品数量
      { wch: 10 }, // 不良数量
      { wch: 10 }, // 良率
      { wch: 20 }, // 备注
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '生产良率记录');

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `生产良率记录_${dateStr}.xlsx`);
    showToast('导出成功');
  };

  // 统计卡片
  const StatCard = ({ label, value, unit, color }: { label: string; value: string | number; unit?: string; color: string }) => (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>
        {value}<span className="text-base font-normal text-gray-400 ml-1">{unit}</span>
      </p>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-10">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">生产良率统计</h1>
        <p className="text-gray-500 mt-1">录入、查看和导出生产良率数据</p>
      </div>

      {/* 统计概览 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="记录总数" value={records.length} unit="条" color="text-gray-900" />
        <StatCard label="总生产量" value={totalProduction.toLocaleString()} unit="件" color="text-gray-900" />
        <StatCard label="总良品数" value={totalGood.toLocaleString()} unit="件" color="text-green-600" />
        <StatCard label="整体良率" value={overallYield} unit="%" color={overallYield >= 95 ? 'text-green-600' : overallYield >= 85 ? 'text-amber-500' : 'text-red-500'} />
      </div>

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* 新增按钮 */}
        <button
          onClick={openAddForm}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新增记录
        </button>

        {/* 导入按钮 */}
        <label className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors text-sm font-medium">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          导入 Excel
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleImport}
          />
        </label>

        {/* 导出按钮 */}
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          导出 Excel
        </button>

        {/* 搜索框 */}
        <div className="relative flex-1 min-w-[200px] max-w-sm ml-auto">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            placeholder="搜索日期 / 型号 / 备注..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 数据表格 */}
      {filtered.length > 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-gray-600 font-medium">日期</th>
                  <th className="px-4 py-3 text-left text-gray-600 font-medium">产品型号</th>
                  <th className="px-4 py-3 text-right text-gray-600 font-medium">生产数量</th>
                  <th className="px-4 py-3 text-right text-gray-600 font-medium">良品数量</th>
                  <th className="px-4 py-3 text-right text-gray-600 font-medium">不良数量</th>
                  <th className="px-4 py-3 text-right text-gray-600 font-medium">良率</th>
                  <th className="px-4 py-3 text-left text-gray-600 font-medium">备注</th>
                  <th className="px-4 py-3 text-center text-gray-600 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((record, idx) => (
                  <tr
                    key={record.id}
                    className={`border-b border-gray-50 hover:bg-gray-50/60 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-25'}`}
                  >
                    <td className="px-4 py-3 text-gray-900 font-medium">{record.date}</td>
                    <td className="px-4 py-3 text-gray-700">{record.productModel}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{record.productionQty.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-green-600 font-medium">{record.goodQty.toLocaleString()}</td>
                    <td className={`px-4 py-3 text-right font-medium ${record.defectQty > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                      {record.defectQty > 0 ? record.defectQty.toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                        record.yieldRate >= 95 ? 'bg-green-100 text-green-700' :
                        record.yieldRate >= 85 ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {record.yieldRate}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 max-w-[180px] truncate">{record.notes || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => openEditForm(record)}
                          className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="编辑"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => deleteRecord(record.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="删除"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
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
            <p className="px-4 py-3 text-sm text-gray-500 bg-gray-50 border-t border-gray-100">
              搜索 "<span className="font-medium">{searchQuery}</span>" 找到 {filtered.length} 条结果
            </p>
          )}
        </div>
      ) : (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-100">
          <svg className="w-16 h-16 text-gray-200 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-gray-500 text-lg mb-1">{searchQuery ? '没有找到匹配的记录' : '暂无生产记录'}</p>
          <p className="text-gray-400 text-sm mb-6">
            {searchQuery ? '试试其他关键词' : '点击上方「新增记录」开始录入，或导入已有 Excel 文件'}
          </p>
          {!searchQuery && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-indigo-600 text-sm font-medium hover:text-indigo-700"
            >
              导入已有 Excel →
            </button>
          )}
        </div>
      )}

      {/* 录入表单弹窗 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* 遮罩 */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowForm(false)} />

          {/* 弹窗 */}
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">
                {editingId ? '编辑记录' : '新增记录'}
              </h2>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* 日期 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  生产日期 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                />
              </div>

              {/* 产品型号 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  产品型号 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="例如：2604014"
                  value={form.productModel}
                  onChange={e => setForm(f => ({ ...f, productModel: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                />
              </div>

              {/* 生产数量 & 良品数量 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    生产数量 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    placeholder="0"
                    value={form.productionQty || ''}
                    onChange={e => setForm(f => ({ ...f, productionQty: Number(e.target.value) || 0 }))}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    良品数量 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={form.goodQty || ''}
                    onChange={e => setForm(f => ({ ...f, goodQty: Number(e.target.value) || 0 }))}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                  />
                </div>
              </div>

              {/* 实时预览计算结果 */}
              <div className="bg-indigo-50 rounded-lg px-4 py-3 text-sm">
                <div className="flex items-center gap-4">
                  <div>
                    <span className="text-gray-500">不良数量：</span>
                    <span className="font-medium text-red-600">
                      {calcDefect(form.productionQty, form.goodQty).toLocaleString()} 件
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">良率：</span>
                    <span className={`font-bold ${
                      calcYieldRate(form.goodQty, form.productionQty) >= 95 ? 'text-green-600' :
                      calcYieldRate(form.goodQty, form.productionQty) >= 85 ? 'text-amber-600' : 'text-red-600'
                    }`}>
                      {calcYieldRate(form.goodQty, form.productionQty)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* 备注 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">备注</label>
                <textarea
                  rows={3}
                  placeholder="可选，填写不良原因等..."
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent resize-none"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setShowForm(false)}
                className="px-5 py-2.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={saveRecord}
                className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
              >
                {editingId ? '保存修改' : '添加记录'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast 提示 */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-gray-900 text-white text-sm px-5 py-2.5 rounded-full shadow-lg">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
