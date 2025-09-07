// netlify/functions/redirect.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

exports.handler = async (event, context) => {
  const path = event.path || event.rawUrl || '';
  const shortCode = path.split('/').pop();
  
  if (!shortCode) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'text/html' },
      body: '<!DOCTYPE html><html><head><title>404</title></head><body><h1>404 - Not Found</h1></body></html>'
    };
  }

  try {
    // 查找二维码记录
    const { data: qrCode, error } = await supabase
      .from('qr_codes')
      .select('*')
      .eq('short_code', shortCode)
      .single();

    if (error || !qrCode) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/html' },
        body: '<!DOCTYPE html><html><head><title>404</title></head><body><h1>404 - Not Found</h1></body></html>'
      };
    }

    // 检查是否过期或已失效
    const now = new Date();
    const expiresAt = new Date(qrCode.expires_at);
    
    if (!qrCode.is_active || now > expiresAt) {
      // 自动标记为失效
      if (qrCode.is_active && now > expiresAt) {
        await supabase
          .from('qr_codes')
          .update({ is_active: false })
          .eq('id', qrCode.id);
      }

      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/html' },
        body: '<!DOCTYPE html><html><head><title>404</title></head><body><h1>404 - Not Found</h1></body></html>'
      };
    }

    // 记录扫描（异步执行，不阻塞重定向）
    const logScan = async () => {
      try {
        await supabase.from('scan_logs').insert({
          qr_code_id: qrCode.id,
          user_agent: event.headers['user-agent'] || '',
          ip_address: event.headers['x-forwarded-for'] || event.headers['x-bb-ip'] || ''
        });

        await supabase
          .from('qr_codes')
          .update({ scan_count: qrCode.scan_count + 1 })
          .eq('id', qrCode.id);
      } catch (err) {
        console.error('记录扫描失败:', err);
      }
    };

    // 异步记录，立即重定向
    logScan();

    // 重定向到原始URL
    return {
      statusCode: 302,
      headers: {
        Location: qrCode.original_url,
        'Cache-Control': 'no-cache'
      }
    };
  } catch (error) {
    console.error('Redirect error:', error);
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'text/html' },
      body: '<!DOCTYPE html><html><head><title>404</title></head><body><h1>404 - Not Found</h1></body></html>'
    };
  }
};
