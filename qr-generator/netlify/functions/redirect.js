// netlify/functions/redirect.js  —— 覆盖版
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

exports.handler = async (event) => {
  const path = event.path || event.rawUrl || '';
  const shortCode = path.split('/').pop();

  if (!shortCode) return notFound();

  // 查记录
  const { data: qr, error } = await supabase.from('qr_codes').select('*').eq('short_code', shortCode).single();
  if (error || !qr) return notFound();

  const now = new Date(), exp = new Date(qr.expires_at);
  if (!qr.is_active || now > exp) {
    if (qr.is_active && now > exp) {
      await supabase.from('qr_codes').update({ is_active: false }).eq('id', qr.id);
    }
    return notFound();
  }

  // 异步记日志
  (async () => {
    try {
      await supabase.from('scan_logs').insert({
        qr_code_id: qr.id,
        user_agent: event.headers['user-agent'] || '',
        ip_address: event.headers['x-forwarded-for'] || event.headers['x-bb-ip'] || ''
      });
      await supabase.from('qr_codes').update({ scan_count: qr.scan_count + 1 }).eq('id', qr.id);
    } catch {}
  })();

  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
  const safe = escapeHtml;
  const title = safe(qr.name || '二维码内容');

  // 如果是文本记录：直接渲染文本
  if (qr.type === 'text' || (!qr.original_url && qr.content)) {
    const content = safe(qr.content || '');
    return { statusCode: 200, headers, body: htmlShell(title, `<pre class="box">${content}</pre><p class="tip">已在微信内展示，可复制使用。</p>`) };
  }

  // 链接记录：展示“外部打开/复制”
  const url = safe(qr.original_url);
  return {
    statusCode: 200,
    headers,
    body: htmlShell('继续访问目标链接', `
      <div class="box">${url}</div>
      <p>
        <a class="btn" href="${url}" target="_blank" rel="noopener">在外部浏览器打开</a>
        <button class="btn copy" onclick="copyUrl()">复制链接</button>
      </p>
      <p class="tip">如无法直接打开，请复制后在系统浏览器粘贴访问。</p>
      <script>function copyUrl(){navigator.clipboard&&navigator.clipboard.writeText('${url.replace(/'/g,"\\'")}').then(()=>alert('已复制'));}</script>
    `)
  };
};

function notFound(){ return { statusCode:404, headers:{'Content-Type':'text/html; charset=utf-8'}, body: htmlShell('404', '<h1>404 - Not Found</h1>') }; }
function htmlShell(t, inner){
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t}</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6f7f9;margin:0;padding:24px;color:#222}
.card{max-width:680px;margin:0 auto;background:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.06);padding:22px}
h1{font-size:18px;margin:0 0 12px}
.box{white-space:pre-wrap;word-break:break-all;background:#f0f3f7;border-radius:8px;padding:12px;font:13px ui-monospace,Menlo,Consolas,monospace;margin:12px 0}
.btn{display:inline-block;padding:10px 14px;border-radius:10px;background:#4f46e5;color:#fff;text-decoration:none;border:0}
.btn.copy{margin-left:8px;background:#0ea5e9}
.tip{font-size:13px;color:#666;margin-top:12px;line-height:1.6}
</style><body><div class="card">${inner}</div></body></html>`;
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
