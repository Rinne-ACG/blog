/**
 * 腾讯云表格识别 OCR — Cloudflare Pages Function（生产环境）
 * 通过腾讯云 API v3 签名调用 RecognizeTableOCR
 * 使用 Web Crypto API（crypto.subtle）替代 Node.js crypto
 */

// ─── HMAC-SHA256 辅助函数 ────────────────────────
async function hmacSha256(key: Uint8Array | string, data: string): Promise<ArrayBuffer> {
  const keyBytes = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const dataBytes = new TextEncoder().encode(data);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
}

async function sha256(data: string): Promise<string> {
  const dataBytes = new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest('SHA-256', dataBytes);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── 腾讯云 API v3 签名（使用 Web Crypto API）────────────────────────
async function buildTencentAuth(
  secretId: string,
  secretKey: string,
  service: string,
  payload: string,
  timestamp: number,
): Promise<string> {
  const d = new Date(timestamp * 1000);
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const credentialScope = `${date}/${service}/tc3_request`;

  // 1. 哈希 payload
  const hashedPayload = await sha256(payload);

  // 2. 构建规范请求字符串
  const canonicalRequest =
    'POST' + '\n' +
    '/' + '\n' +
    '' + '\n' +
    'content-type:application/json; charset=utf-8' + '\n' +
    `host:${service}.tencentcloudapi.com` + '\n' +
    '' + '\n' +
    'content-type;host' + '\n' +
    hashedPayload;

  // 3. 哈希规范请求
  const hashedCanonical = await sha256(canonicalRequest);

  // 4. 构建待签名字符串
  const algorithm = 'TC3-HMAC-SHA256';
  const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${hashedCanonical}`;

  // 5. 计算签名
  const kDate = await hmacSha256('TC3' + secretKey, date);
  const kService = await hmacSha256(kDate, service);
  const kSigning = await hmacSha256(kService, 'tc3_request');
  const signatureBytes = await hmacSha256(kSigning, stringToSign);
  const signature = Array.from(new Uint8Array(signatureBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // 6. 构建 Authorization 头
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
    return new Response(JSON.stringify({ error: '无效的 JSON' }), {
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
  const auth = await buildTencentAuth(secretId, secretKey, 'ocr', payload, timestamp);

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
