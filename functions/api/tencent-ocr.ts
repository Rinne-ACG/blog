/**
 * 腾讯云表格识别 OCR — Cloudflare Pages Function（生产环境）
 * 通过腾讯云 API v3 签名调用 RecognizeTableOCR
 * 开发环境代理在 vite.config.ts，生产环境走这个 Function
 */
import crypto from 'crypto';

// ─── 腾讯云 API v3 签名（与 vite.config.ts 保持一致） ───
function buildTencentAuth(
  secretId: string,
  secretKey: string,
  service: string,
  payload: string,
  timestamp: number,
): string {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedPayload = crypto.createHash('sha256').update(payload).digest('hex');
  const canonicalRequest = [
    'POST', '/', '',
    'content-type:application/json; charset=utf-8',
    `host:${service}.tencentcloudapi.com`,
    '', 'content-type;host', hashedPayload,
  ].join('\n');
  const algorithm = 'TC3-HMAC-SHA256';
  const hashedCanonical = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = [algorithm, timestamp, credentialScope, hashedCanonical].join('\n');
  const kDate = crypto.createHmac('sha256', `TC3${secretKey}`).update(date).digest();
  const kService = crypto.createHmac('sha256', kDate).update(service).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('tc3_request').digest();
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`;
}

export async function onRequestPost(context: any) {
  const { request, env } = context;
  const secretId = env.TENCENT_SECRET_ID || '';
  const secretKey = env.TENCENT_SECRET_KEY || '';

  if (!secretId || !secretKey) {
    return new Response(JSON.stringify({ error: '未配置 TENCENT_SECRET_ID / TENCENT_SECRET_KEY' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: '无效的 JSON 请求体' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { imageBase64 } = body;
  if (!imageBase64) {
    return new Response(JSON.stringify({ error: '缺少 imageBase64' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const payload = JSON.stringify({ ImageBase64: imageBase64 });
  const timestamp = Math.floor(Date.now() / 1000);
  const auth = buildTencentAuth(secretId, secretKey, 'ocr', payload, timestamp);

  try {
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
    });

    const data = await ocrRes.json();
    return new Response(JSON.stringify(data), {
      status: ocrRes.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
