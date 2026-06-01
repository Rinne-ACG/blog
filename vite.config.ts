import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import crypto from 'node:crypto'

const env = loadEnv('', process.cwd(), '')

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

        // ─── AI 识别代理 ────────────────
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
            } catch (e) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: String(e) }))
            }
          })
        })

        // ─── 腾讯云 OCR 代理 ────────────────
        server.middlewares.use('/api/tencent-ocr', async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Method not allowed' }))
            return
          }
          let body = ''
          req.on('data', chunk => { body += chunk })
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
              const payload = JSON.stringify({ ImageBase64: imageBase64 })
              const timestamp = Math.floor(Date.now() / 1000)
              const auth = buildTencentAuth(secretId, secretKey, 'ocr', payload, timestamp)
              const ocrRes = await fetch('https://ocr.tencentcloudapi.com', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Host': 'ocr.tencentcloudapi.com',
                  'X-TC-Action': 'RecognizeTableOCR',
                  'X-TC-Version': '2018-11-19',
                  'X-TC-Region': 'ap-guangzhou',
                  'Authorization': auth,
                  'X-TC-Timestamp': String(timestamp),
                },
                body: payload,
              })
              const data = await ocrRes.json()
              res.writeHead(ocrRes.status, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify(data))
            } catch (e: any) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: String(e.message) }))
            }
          })
        })

        // 腾讯云 API v3 签名
        function buildTencentAuth(
          secretId: string,
          secretKey: string,
          service: string,
          payload: string,
          timestamp: number,
        ): string {
          const date = new Date(timestamp * 1000).toISOString().slice(0, 10).replace(/-/g, '')
          const credentialScope = `${date}/${service}/tc3_request`
          const hashedPayload = crypto.createHash('sha256').update(payload).digest('hex')
          const canonicalRequest = [
            'POST', '/', '',
            'content-type:application/json; charset=utf-8',
            `host:${service}.tencentcloudapi.com`,
            '', 'content-type;host', hashedPayload,
          ].join('\n')
          const algorithm = 'TC3-HMAC-SHA256'
          const hashedCanonical = crypto.createHash('sha256').update(canonicalRequest).digest('hex')
          const stringToSign = [algorithm, timestamp, credentialScope, hashedCanonical].join('\n')
          const kDate = crypto.createHmac('sha256', `TC3${secretKey}`).update(date).digest()
          const kService = crypto.createHmac('sha256', kDate).update(service).digest()
          const kSigning = crypto.createHmac('sha256', kService).update('tc3_request').digest()
          const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')
          return `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`
        }

        function updateAlbumConfig(album: string, newFiles: { name: string; path: string }[]) {
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
        }
      },
    },
  ],
})
