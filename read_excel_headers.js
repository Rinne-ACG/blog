const XLSX = require('./node_modules/xlsx');
const wb = XLSX.readFile('C:/Users/Admin/Desktop/2026牛角车间生产良率勿删.xlsx');
console.log('Sheet names:', JSON.stringify(wb.SheetNames));
const ws = wb.Sheets[wb.SheetNames[0]];
const json = XLSX.utils.sheet_to_json(ws, { header: 1 });
console.log('Row 1 (headers):', JSON.stringify(json[0]));
console.log('Row 2 (sample):', JSON.stringify(json[1]));
console.log('Row 3 (sample):', JSON.stringify(json[2]));
