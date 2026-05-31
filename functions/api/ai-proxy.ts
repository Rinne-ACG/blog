// Cloudflare Pages Functions — AI 识别代理
// 生产环境用这个，开发环境用 vite.config.ts 里的代理

export async function onRequestPost(context: any) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { model, messages, max_tokens } = body;

    const apiKey = env.VITE_GLM_API_KEY || '';
    if (!apiKey) {
      return Response.json(
        { error: '未配置 VITE_GLM_API_KEY，请在 Cloudflare Pages 环境变量中设置' },
        { status: 500 }
      );
    }

    // 调用智谱 GLM-5.1 API（OpenAI 兼容格式）
    const glmRes = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'glm-5v-turbo',
        messages,
        max_tokens,
      }),
    });

    const data = await glmRes.json();
    return Response.json(data, { status: glmRes.status });
  } catch (e) {
    return Response.json(
      { error: String(e) },
      { status: 500 }
    );
  }
}
