import type { Post } from './types';

export const posts: Post[] = [
  {
    id: '1',
    title: 'React 18 并发渲染深度解析',
    slug: 'react-18-concurrent-rendering',
    date: '2026-04-20',
    summary: '深入剖析 React 18 带来的并发特性：useTransition、useDeferredValue 与 Suspense，以及如何在生产环境中正确使用它们。',
    tags: ['React', '前端', '性能优化'],
    readingTime: 8,
    content: `# React 18 并发渲染深度解析

React 18 引入了全新的并发模式（Concurrent Mode），这是 React 有史以来最大的架构升级之一。

## 什么是并发渲染？

并发渲染允许 React **中断、暂停和恢复**渲染工作。这意味着 React 可以：

- 在后台准备新的 UI，同时保持当前 UI 的响应性
- 跳过不必要的渲染
- 合并多次状态更新

## useTransition

\`useTransition\` 允许你将某些状态更新标记为"非紧急"：

\`\`\`tsx
import { useTransition, useState } from 'react';

function App() {
  const [isPending, startTransition] = useTransition();
  const [count, setCount] = useState(0);

  const handleClick = () => {
    startTransition(() => {
      setCount(c => c + 1);
    });
  };

  return (
    <div>
      {isPending && <Spinner />}
      <button onClick={handleClick}>{count}</button>
    </div>
  );
}
\`\`\`

## useDeferredValue

\`useDeferredValue\` 用于延迟渲染列表等高代价的子树：

\`\`\`tsx
const deferredQuery = useDeferredValue(query);
// deferredQuery 会在不阻塞用户输入的情况下更新
\`\`\`

## 总结

并发特性让 React 应用在**复杂交互场景下**依然保持流畅，是构建高性能前端应用的利器。合理使用这些 API，可以显著改善用户体验。

> **提示**：并发特性需要配合 \`createRoot\` 使用，确保已升级到 React 18。
`,
  },
  {
    id: '2',
    title: 'TypeScript 5.x 新特性全览',
    slug: 'typescript-5-new-features',
    date: '2026-04-15',
    summary: 'TypeScript 5.x 带来了装饰器标准化、const 类型参数、模板字符串类型改进等重磅更新，本文逐一解析。',
    tags: ['TypeScript', '前端', '工具链'],
    readingTime: 10,
    content: `# TypeScript 5.x 新特性全览

TypeScript 5.0 带来了许多令人期待的特性，让我们一起了解最重要的几个。

## 装饰器（Decorators）标准化

装饰器终于遵循 TC39 Stage 3 提案，语法更简洁：

\`\`\`typescript
function logged(target: any, context: ClassMethodDecoratorContext) {
  return function(this: any, ...args: any[]) {
    console.log(\`Calling \${String(context.name)}\`);
    return target.call(this, ...args);
  };
}

class MyClass {
  @logged
  greet(name: string) {
    return \`Hello, \${name}!\`;
  }
}
\`\`\`

## const 类型参数

新增 \`const\` 修饰符，推断更精确的字面量类型：

\`\`\`typescript
function identity<const T>(value: T): T {
  return value;
}

const result = identity({ name: 'Alice', age: 30 });
// 推断为 { name: "Alice", age: 30 } 而非 { name: string, age: number }
\`\`\`

## 多配置文件扩展

\`tsconfig.json\` 现在支持扩展多个配置：

\`\`\`json
{
  "extends": ["@tsconfig/node18/tsconfig.json", "@tsconfig/strictest/tsconfig.json"],
  "compilerOptions": { "outDir": "./dist" }
}
\`\`\`

## 性能提升

TypeScript 5.x 在编译速度上有 **10%-30%** 的提升，大型项目体感明显。

---

升级建议：直接 \`npm install typescript@latest\`，大多数项目无需修改代码即可受益。
`,
  },
  {
    id: '3',
    title: '用 Vite 构建现代前端工程',
    slug: 'vite-modern-frontend',
    date: '2026-04-08',
    summary: 'Vite 凭借原生 ESM 和 esbuild 带来了极速的开发体验。本文介绍如何配置 Vite 项目，包括路径别名、环境变量和插件生态。',
    tags: ['Vite', '工具链', '前端'],
    readingTime: 6,
    content: `# 用 Vite 构建现代前端工程

Vite（法语"快速"）由 Vue 作者尤雨溪创建，已成为现代前端工程化的首选工具。

## 为什么选择 Vite？

| 特性 | Webpack | Vite |
|------|---------|------|
| 开发启动 | 慢（全量打包）| 极快（按需编译）|
| HMR 速度 | 较慢 | 毫秒级 |
| 配置复杂度 | 高 | 低 |
| 生产构建 | Webpack | Rollup |

## 快速配置

\`\`\`typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
})
\`\`\`

## 环境变量

创建 \`.env.local\` 文件：

\`\`\`bash
VITE_API_BASE_URL=https://api.example.com
VITE_APP_TITLE=My Blog
\`\`\`

在代码中使用：
\`\`\`typescript
const apiUrl = import.meta.env.VITE_API_BASE_URL;
\`\`\`

## 推荐插件

- \`@vitejs/plugin-react\` — React 支持
- \`vite-plugin-svgr\` — SVG 组件化
- \`vite-tsconfig-paths\` — TS 路径别名
`,
  },
  {
    id: '4',
    title: 'CSS Grid 布局实战指南',
    slug: 'css-grid-practical-guide',
    date: '2026-03-28',
    summary: '从基础到高级，系统讲解 CSS Grid 布局的核心概念与实际案例，帮你告别 float 和 flexbox 嵌套地狱。',
    tags: ['CSS', '前端', '布局'],
    readingTime: 7,
    content: `# CSS Grid 布局实战指南

CSS Grid 是二维布局系统，相比 Flexbox 更适合复杂的页面结构。

## 核心概念

- **Grid Container**：设置了 \`display: grid\` 的元素
- **Grid Item**：容器的直接子元素
- **Grid Line**：构成网格的横纵线
- **Grid Track**：两条相邻 grid line 之间的空间
- **Grid Cell**：单个网格单元
- **Grid Area**：由多个 grid cell 组成的矩形区域

## 基础用法

\`\`\`css
.container {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: auto;
  gap: 1rem;
}
\`\`\`

## 命名区域

\`\`\`css
.layout {
  display: grid;
  grid-template-areas:
    "header header"
    "sidebar main"
    "footer footer";
  grid-template-columns: 200px 1fr;
}

.header  { grid-area: header; }
.sidebar { grid-area: sidebar; }
.main    { grid-area: main; }
.footer  { grid-area: footer; }
\`\`\`

## 响应式网格

\`\`\`css
.responsive-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 1.5rem;
}
\`\`\`

这个技巧无需媒体查询，列数会根据容器宽度自动调整。
`,
  },
  {
    id: '5',
    title: '深入理解 JavaScript 事件循环',
    slug: 'javascript-event-loop',
    date: '2026-03-15',
    summary: 'Call Stack、Task Queue、Microtask Queue——彻底弄清 JS 运行机制，不再困惑 setTimeout 和 Promise 的执行顺序。',
    tags: ['JavaScript', '前端', '进阶'],
    readingTime: 9,
    content: `# 深入理解 JavaScript 事件循环

JavaScript 是单线程语言，但通过事件循环机制实现了非阻塞 I/O。

## 运行时组成

1. **Call Stack**（调用栈）：执行同步代码
2. **Web APIs**：浏览器提供的异步能力（setTimeout、fetch 等）
3. **Task Queue**（宏任务队列）：setTimeout、setInterval 的回调
4. **Microtask Queue**（微任务队列）：Promise.then、queueMicrotask

## 执行顺序

\`\`\`javascript
console.log('1');

setTimeout(() => console.log('2'), 0);

Promise.resolve().then(() => console.log('3'));

console.log('4');

// 输出顺序：1, 4, 3, 2
\`\`\`

### 解析：
1. 同步代码执行：输出 \`1\`、\`4\`
2. Call Stack 清空，检查**微任务队列**：执行 Promise.then，输出 \`3\`
3. 微任务队列清空，取一个**宏任务**：执行 setTimeout，输出 \`2\`

## async/await 的本质

\`\`\`javascript
async function fetchData() {
  console.log('A');
  await fetch('/api'); // 相当于 .then()
  console.log('B');   // 微任务中执行
}
console.log('start');
fetchData();
console.log('end');
// 输出：start → A → end → B
\`\`\`

> **记住**：微任务优先于宏任务，每次宏任务执行完毕后，会清空所有微任务。
`,
  },
  {
    id: '6',
    title: 'Node.js 流（Stream）完全指南',
    slug: 'nodejs-streams-guide',
    date: '2026-03-01',
    summary: '流是 Node.js 处理大数据的核心，本文介绍 Readable、Writable、Transform 流的原理与使用，配合管道（pipe）实现高效数据处理。',
    tags: ['Node.js', '后端', 'JavaScript'],
    readingTime: 12,
    content: `# Node.js 流（Stream）完全指南

Node.js 中的 Stream 是处理流式数据的抽象接口，分为四种类型。

## 四种流类型

| 类型 | 说明 | 示例 |
|------|------|------|
| Readable | 可读流 | \`fs.createReadStream\` |
| Writable | 可写流 | \`fs.createWriteStream\` |
| Duplex | 双工流 | TCP socket |
| Transform | 转换流 | \`zlib.createGzip\` |

## 管道（Pipe）

\`\`\`javascript
import { createReadStream, createWriteStream } from 'fs';
import { createGzip } from 'zlib';

// 读取文件 → 压缩 → 写入
createReadStream('input.txt')
  .pipe(createGzip())
  .pipe(createWriteStream('output.gz'));
\`\`\`

## 自定义 Transform 流

\`\`\`javascript
import { Transform } from 'stream';

class UpperCaseTransform extends Transform {
  _transform(chunk, encoding, callback) {
    this.push(chunk.toString().toUpperCase());
    callback();
  }
}

process.stdin
  .pipe(new UpperCaseTransform())
  .pipe(process.stdout);
\`\`\`

## 流的背压（Backpressure）

当写入速度跟不上读取速度时，需要处理背压：

\`\`\`javascript
readable.on('data', (chunk) => {
  const canContinue = writable.write(chunk);
  if (!canContinue) {
    readable.pause();
    writable.once('drain', () => readable.resume());
  }
});
\`\`\`

使用 \`pipe\` 会自动处理背压，推荐优先使用管道模式。
`,
  },
];

export function getAllTags(): { name: string; count: number }[] {
  const tagMap: Record<string, number> = {};
  posts.forEach(post => {
    post.tags.forEach(tag => {
      tagMap[tag] = (tagMap[tag] || 0) + 1;
    });
  });
  return Object.entries(tagMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

export function getPostsByTag(tag: string): Post[] {
  return posts.filter(p => p.tags.includes(tag));
}

export function getPostBySlug(slug: string): Post | undefined {
  return posts.find(p => p.slug === slug);
}
