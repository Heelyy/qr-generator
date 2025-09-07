// netlify/functions/redirect.js
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

exports.handler = async (event) => {
  const path = event.path || event.rawUrl || '';
  const shortCode = path.split('/').pop();

  if (!shortCode) {
    return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: basic404() };
  }

  // 查记录
  const { data: qrCode, error } = await supabase
    .from('qr_codes').select('*').eq('short_code', shortCode).single();

  if (error || !qrCode) return notFound();
  const now = new Date();
  const expiresAt = new Date(qrCode.expires_at);
  if (!qrCode.is_active || now > expiresAt) {
    if (qrCode.is_active && now > expiresAt) {
      await supabase.from('qr_codes').update({ is_active: false }).eq('id', qrCode.id);
    }
    return notFound();
  }

  // 记录扫描（异步）
  (async () => {
    try {
      await supabase.from('scan_logs').insert({
        qr_code_id: qrCode.id,
        user_agent: event.headers['user-agent'] || '',
        ip_address: event.headers['x-forwarded-for'] || event.headers['x-bb-ip'] || ''
      });
      await supabase.from('qr_codes').update({ scan_count: qrCode.scan_count + 1 }).eq('id', qrCode.id);
    } catch (e) { /* swallow */ }
  })();

  const ua = (event.headers['user-agent'] || '').toLowerCase();
  const isWeChat = ua.includes('micromessenger'); // 官方常用检测方式，社区也采用该写法 :contentReference[oaicite:1]{index=1}

  if (isWeChat) {
    // 微信内：返回同域 200 的中间页，引导用户点击/复制后在外部浏览器打开
    const safeTitle = escapeHtml(qrCode.name || '链接跳转');
    const target = escapeHtml(qrCode.original_url);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      body: wechatInterstitialHtml(safeTitle, target)
    };
  }

  // 非微信：保持 302 体验
  return {
    statusCode: 302,
    headers: { Location: qrCode.original_url, 'Cache-Control': 'no-cache' }
  };
};

function wechatInterstitialHtml(title, url) {
  // 纯点击/复制方案，不自动 JS 跳转，降低被机审拦截概率
  return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6f7f9;margin:0;padding:24px;color:#222}
  .card{max-width:640px;margin:0 auto;background:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.06);padding:22px}
  h1{font-size:18px;margin:0 0 12px}
  .url{word-break:break-all;background:#f0f3f7;border-radius:8px;padding:10px 12px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;margin:12px 0}
  .btn{display:inline-block;padding:12px 16px;border-radius:10px;background:#4f46e5;color:#fff;text-decoration:none}
  .tip{font-size:13px;color:#666;margin-top:12px;line-height:1.6}
  .copy{margin-left:8px;background:#0ea5e9}
</style>
</head><body>
  <div class="card">
    <h1>继续访问目标链接</h1>
    <div class="url">${url}</div>
    <p><a class="btn" href="${url}" target="_blank" rel="noopener">在外部浏览器打开</a>
       <button class="btn copy" onclick="copyUrl()">复制链接</button></p>
    <div class="tip">如果按钮无法正常打开：长按上方链接选择复制，然后在手机系统浏览器（如 Safari/Chrome）粘贴访问。</div>
  </div>
<script>
function copyUrl(){
  const t='${url.replace(/'/g,"\\'")}';
  navigator.clipboard?.writeText(t).then(()=>alert('已复制链接，请到外部浏览器粘贴打开'));
}
</script>
</body></html>`;
}
function notFound(){ return { statusCode:404, headers:{'Content-Type':'text/html'}, body: basic404() }; }
function basic404(){ return '<!doctype html><html><head><meta charset="utf-8"><title>404</title></head><body><h1>404 - Not Found</h1></body></html>'; }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
