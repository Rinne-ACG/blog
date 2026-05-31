import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// 从 .env / .env.local 加载环境变量（服务端读取，不暴露到前端）
const env = loadEnv('', process.cwd(), '')

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'upload-api',
      configureServer(server) {
        server.middlewares.use('/api/upload-images', (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Method not allowed' }))
            return
          }

          let body = ''
          req.on('data', chunk => { body += chunk })
          req.on('end', () => {
            try {
              const { album, images } = JSON.parse(body)
              if (!album || !Array.isArray(images)) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'Missing album or images' }))
                return
              }

              const albumDir = path.join(__dirname, 'public', 'images', album)
              if (!fs.existsSync(albumDir)) {
                fs.mkdirSync(albumDir, { recursive: true })
              }

              const results: { name: string; path: string }[] = []
              for (const img of images) {
                if (!img.name || !img.data) continue
                const base64Data = img.data.replace(/^data:\w+\/\w+;base64,/, '')
                const filePath = path.join(albumDir, img.name)
                fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'))
                results.push({ name: img.name, path: `/images/${album}/${img.name}` })
              }

              // 自动更新 GalleryPage.tsx 的 albums 配置
              try {
                updateAlbumConfig(album, results)
              } catch (e) {
                console.error('Failed to update album config:', e)
              }

              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: true, files: results }))
            } catch (e) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: String(e) }))
            }
          })
        })

        // ─── AI 识别代理（开发环境）────────────────
        server.middlewares.use('/api/ai-proxy', async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Method not allowed' }))
            return
          }

          let body = ''
          req.on('data', chunk => { body += chunk })
          req.on('end', async () => {
            try {
              const { model, messages, max_tokens } = JSON.parse(body)

              // 从 .env.local 读取 API Key（服务端，不暴露到前端）
              const apiKey = env.VITE_GLM_API_KEY || ''
              if (!apiKey) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: '未配置 VITE_GLM_API_KEY，请在 .env.local 中设置' }))
                return
              }

              // 调用智谱 GLM-5.1 API（OpenAI 兼容格式）
              const glmRes = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({ model: model || 'glm-5.1', messages, max_tokens }),
              })

              const data = await glmRes.json()
              res.writeHead(glmRes.status, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify(data))
            } catch (e) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: String(e) }))
            }
          })
        })

        function updateAlbumConfig(album: string, newFiles: { name: string; path: string }[]) {
          const galleryPath = path.join(__dirname, 'src', 'pages', 'GalleryPage.tsx')
          let content = fs.readFileSync(galleryPath, 'utf-8')

          const albumKey = `'${album.replace(/'/g, "\\'")}'`
          const keyIdx = content.indexOf(albumKey)

          if (keyIdx === -1) {
            // 相册不存在 — 创建新的相册条目
            const newEntries = newFiles.map(f =>
              `      { src: '/images/${album}/${f.name.replace(/'/g, "\\'")}', caption: '${f.name.replace(/\.[^.]+$/, '').replace(/'/g, "\\'")}' },\n`
            ).join('')
            // 在最后的 `};` 前插入新相册
            const lastBracket = content.lastIndexOf('  },\n}')
            if (lastBracket !== -1) {
              content = content.slice(0, lastBracket) +
                `  '${album}': {\n` +
                `    title: '${album}',\n` +
                `    description: '${album}不良记录图片',\n` +
                `    cover: '/images/${album}/${newFiles[0].name.replace(/'/g, "\\'")}',\n` +
                `    images: [\n${newEntries}` +
                `    ],\n` +
                `  },\n` +
                content.slice(lastBracket)
              fs.writeFileSync(galleryPath, content)
              console.log(`Created new album: ${album}`)
            }
            return
          }

          // 相册已存在 — 追加图片到 images 数组
          const searchStart = content.indexOf('images:', keyIdx)
          if (searchStart === -1) return

          const arrStart = content.indexOf('[', searchStart)
          if (arrStart === -1) return

          let depth = 0
          let arrEnd = arrStart
          for (let i = arrStart + 1; i < content.length; i++) {
            if (content[i] === '[') depth++
            else if (content[i] === ']') {
              if (depth === 0) { arrEnd = i; break }
              depth--
            }
          }

          const arrContent = content.slice(arrStart + 1, arrEnd)
          const newEntries = newFiles.map(f =>
            `      { src: '/images/${album}/${f.name.replace(/'/g, "\\'")}', caption: '${f.name.replace(/\.[^.]+$/, '').replace(/'/g, "\\'")}' },\n`
          ).join('')

          content = content.slice(0, arrEnd) +
            (arrContent.trim() ? '\n' : '') + newEntries +
            content.slice(arrEnd)

          fs.writeFileSync(galleryPath, content)
        }
      },
    },
  ],
})
