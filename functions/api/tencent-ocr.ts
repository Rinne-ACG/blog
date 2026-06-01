/**
 * 腾讯云通用表格识别 OCR — Cloudflare Pages Function（生产环境）
 * 通过腾讯云 API v3 签名调用 GeneralTableOCR
 */
import crypto from 'crypto';

// ─── 腾讯云 API v3 签名（Node.js crypto，Cloudflare Workers 兼容） ───
function sign(key: string, msg: string): string {
  return crypto.createHmac('sha256', key).update(msg).digest('hex');
}

function getSignature(secretKey: string, date: string, service: string, stringToSign: string): string {
  const kDate = sign(`TC3${secretKey}`, date);
  const kService = sign(kDate, service);
  const kSigning = sign(kService, 'tc3_request');
  return sign(kSigning, stringToSign);
}

function buildAuth(secretId: string, secretKey: string, service: string, region: string, payload: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const credentialScope = `${date}/${service}/tc3_request`;

  const hashedPayload = crypto.createHash('sha256').update(payload).digest('hex');
  const canonicalRequest = [
    'POST',
    '/',
    '',
    `content-type:application/json; charset=utf-8`,
    `host:${service}.tencentcloudapi.com`,
    '',
    'content-type;host',
    hashedPayload,
  ].join('\n');

  const hashedCanonical = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = [`TC3-HMAC-SHA256`, timestamp, credentialScope, hashedCanonical].join('\n');

  const signature = getSignature(secretKey, date, service, stringToSign);

  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`;
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

  const auth = buildAuth(secretId, secretKey, 'ocr', 'ap-guangzhou', payload);

  try {
    const ocrRes = await fetch('https://ocr.tencentcloudapi.com', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Host': 'ocr.tencentcloudapi.com',
        'X-TC-Action': 'GeneralTableOCR',
        'X-TC-Version': '2018-11-19',
        'X-TC-Region': 'ap-guangzhou',
        'Authorization': auth,
        'X-TC-Timestamp': String(Math.floor(Date.now() / 1000)),
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
