const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// 读取 xlsx 文件
const filePath = 'C:/Users/Admin/Desktop/2026牛角车间生产良率勿删.xlsx';
const wb = XLSX.readFile(filePath, { cellNF: true });

console.log('工作表列表:', wb.SheetNames);

// 获取工作表索引
const sheetIndex = wb.SheetNames.indexOf('2026.03');
console.log('2026.03 工作表索引:', sheetIndex);

// xlsx 内部使用 JSZip，我们需要访问其内部结构
// 尝试通过工作簿对象读取
if (wb.Workbook && wb.Workbook.Sheets) {
  console.log('工作簿中的工作表信息:');
  wb.Workbook.Sheets.forEach((sheet, i) => {
    console.log(`  ${i}: ${JSON.stringify(sheet)}`);
  });
}

// 检查是否有批注相关的属性
const ws = wb.Sheets['2026.03'];
if (ws) {
  console.log('\n工作表元数据键:', Object.keys(ws).filter(k => k.startsWith('!')));
}

// 使用 JSZip 直接读取 zip 内容（xlsx 内部使用）
// 获取 workbook 对象内部的 zip 实例
const zip = wb._c;
// console.log('zip 类型:', typeof zip);

// 尝试另一种方式：使用 xlsx 的内置方法来读取文件列表
try {
  // xlsx 库使用 ODS_Parse 或类似的解析方式
  // 让我们检查是否有 _get_zip 或类似方法
  console.log('\n尝试读取 xlsx 内部结构...');
  const internals = Object.getOwnPropertyNames(wb).filter(k => k.startsWith('_') || k.includes('zip'));
  console.log('内部属性:', internals);
} catch (e) {
  console.log('读取内部结构失败:', e.message);
}

// 直接读取 zip 文件（xlsx 本质是 zip）
const JSZip = require('xlsx/node_modules/jszip');
console.log('\n使用 JSZip 读取...');
