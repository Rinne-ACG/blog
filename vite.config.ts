import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

const env = loadEnv('', process.cwd(), '')

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'api-proxy',
      configureServer(server: any) {
        // AI 识别代理
        server.middlewares.use('/api/ai-proxy', async (req: any, res: any) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Method not allowed' }))
            return
          }
          let body = ''
          req.on('data', (chunk: any) => { body += chunk })
          req.on('end', async () => {
            try {
              const { model, messages, max_tokens } = JSON.parse(body)
              const apiKey = env.VITE_GLM_API_KEY || ''
              if (!apiKey) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: '未配置 VITE_GLM_API_KEY' }))
                return
              }
              const glmRes = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({ model: model || 'glm-5v-turbo', messages, max_tokens }),
              })
              const data = await glmRes.json()
              res.writeHead(glmRes.status, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify(data))
            } catch (e: any) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: String(e.message || e) }))
            }
          })
        })

        // 腾讯云 OCR 代理（使用官方 SDK，无需手写签名）
        server.middlewares.use('/api/tencent-ocr', async (req: any, res: any) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Method not allowed' }))
            return
          }
          let body = ''
          req.on('data', (chunk: any) => { body += chunk })
          req.on('end', async () => {
            try {
              const { imageBase64 } = JSON.parse(body)
              if (!imageBase64) throw new Error('缺少图片数据')
              const secretId = env.TENCENT_SECRET_ID || ''
              const secretKey = env.TENCENT_SECRET_KEY || ''
              if (!secretId || !secretKey) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: '未配置 TENCENT_SECRET_ID / TENCENT_SECRET_KEY' }))
                return
              }
              // 动态加载腾讯云官方 SDK（避免顶层 import 的 type 问题）
              const { ocr } = await import('tencentcloud-sdk-nodejs')
              const OcrClient = ocr.v20181119.Client
              const client = new OcrClient({
                credential: { secretId, secretKey },
                region: 'ap-guangzhou',
                profile: {
                  signMethod: 'TC3-HMAC-SHA256',
                  httpProfile: { reqMethod: 'POST', reqTimeout: 30 },
                },
              })
              const data = await client.RecognizeTableOCR({ ImageBase64: imageBase64 })
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ Response: data }))
            } catch (e: any) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: String(e.message || e) }))
            }
          })
        })

        // 图片上传 API
        server.middlewares.use('/api/upload-images', (req: any, res: any) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Method not allowed' }))
            return
          }
          let body = ''
          req.on('data', (chunk: any) => { body += chunk })
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
              try { updateAlbumConfig(album, results) } catch (e) { console.error('Failed to update album config:', e) }
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: true, files: results }))
            } catch (e: any) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: String(e.message || e) }))
            }
          })
        })
      },

      // 更新相册配置
      updateAlbumConfig(album: string, newFiles: { name: string; path: string }[]) {
        const galleryPath = path.join(__dirname, 'src', 'pages', 'GalleryPage.tsx')
        let content = fs.readFileSync(galleryPath, 'utf-8')
        const albumKey = `'${album.replace(/'/g, "\\'")}'`
        const keyIdx = content.indexOf(albumKey)
        if (keyIdx === -1) {
          const newEntries = newFiles.map(f =>
            `      { src: '/images/${album}/${f.name.replace(/'/g, "\\'")}', caption: '${f.name.replace(/\.[^.]+$/, '').replace(/'/g, "\\'")}' },\n`
          ).join('')
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
        const searchStart = content.indexOf('images:', keyIdx)
        if (searchStart === -1) return
        const arrStart = content.indexOf('[', searchStart)
        if (arrStart === -1) return
        let depth = 0, arrEnd = arrStart
        for (let i = arrStart + 1; i < content.length; i++) {
          if (content[i] === '[') depth++
          else if (content[i] === ']') { if (depth === 0) { arrEnd = i; break }; depth-- }
        }
        const arrContent = content.slice(arrStart + 1, arrEnd)
        const newEntries = newFiles.map(f =>
          `      { src: '/images/${album}/${f.name.replace(/'/g, "\\'")}', caption: '${f.name.replace(/\.[^.]+$/, '').replace(/'/g, "\\'")}' },\n`
        ).join('')
        content = content.slice(0, arrEnd) + (arrContent.trim() ? '\n' : '') + newEntries + content.slice(arrEnd)
        fs.writeFileSync(galleryPath, content)
      },
    },
  ],
  server: { port: 5173, strictPort: true },
})
