const JSZip = require('jszip');
const fs = require('fs');

async function parseExcelComments(filePath) {
  const buffer = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buffer);
  
  // 工作表顺序：['7.8.9.10月份', '11月份', '12月', '2026.01', '2026.02', '2026.03']
  // 2026.03 是第6个工作表，对应 comments6.xml
  
  const commentFile = 'xl/comments6.xml';
  const content = await zip.file(commentFile).async('string');
  
  console.log('=== xl/comments6.xml (2026.03 工作表批注) ===');
  console.log(content);
  
  // 解析批注内容
  // 结构：<comment ref="K3"><text><r><t>内容</t></r></text></comment>
  
  const commentRegex = /<comment ref="([^"]+)"[^>]*>([\s\S]*?)<\/comment>/g;
  let match;
  
  console.log('\n=== 批注详情 ===');
  while ((match = commentRegex.exec(content)) !== null) {
    const ref = match[1];
    const textContent = match[2];
    
    // 提取 <t> 标签内容
    const textMatches = textContent.match(/<t[^>]*>([^<]*)<\/t>/g);
    const text = textMatches ? textMatches.map(t => t.replace(/<[^>]+>/g, '')).join('').trim() : '';
    
    console.log(`${ref}: ${text}`);
  }
}

parseExcelComments('C:/Users/Admin/Desktop/2026牛角车间生产良率勿删.xlsx')
  .then(() => console.log('\n解析完成'))
  .catch(err => console.error('解析失败:', err));
