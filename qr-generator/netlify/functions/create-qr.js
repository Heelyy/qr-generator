const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// 检测是否为URL
function isValidURL(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    // 也检测常见的URL格式（没有协议的）
    const urlPattern = /^(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/;
    return urlPattern.test(string);
  }
}

function generateShortCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function getNextName() {
  const { data, error } = await supabase
    .from('qr_codes')
    .select('name')
    .order('created_at', { ascending: false })
    .limit(1);
  
  if (error || !data || data.length === 0) {
    return 'QR-001';
  }
  
  const lastNumber = parseInt(data[0].name.split('-')[1]) || 0;
  const nextNumber = (lastNumber + 1).toString().padStart(3, '0');
  return `QR-${nextNumber}`;
}

async function cleanupExpired() {
  await supabase
    .from('qr_codes')
    .update({ is_active: false })
    .lt('expires_at', new Date().toISOString())
    .eq('is_active', true);
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    await cleanupExpired();

    const { originalUrl, expiresInMinutes } = JSON.parse(event.body);
    
    if (!originalUrl) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing originalUrl' })
      };
    }

    // 检测内容类型
    const isURL = isValidURL(originalUrl.trim());
    
    if (!isURL) {
      // 文本内容：直接返回原文本，前端会直接生成包含文本的二维码
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          isText: true,
          content: originalUrl,
          message: '文本内容将直接编码到二维码中'
        })
      };
    }

    // URL内容：使用短链接系统
    if (!expiresInMinutes) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing expiresInMinutes for URL' })
      };
    }

    // 确保URL有协议
    let processedUrl = originalUrl.trim();
    if (!processedUrl.startsWith('http://') && !processedUrl.startsWith('https://')) {
      processedUrl = 'https://' + processedUrl;
    }

    let shortCode;
    let isUnique = false;
    let attempts = 0;
    
    while (!isUnique && attempts < 10) {
      shortCode = generateShortCode();
      const { data } = await supabase
        .from('qr_codes')
        .select('id')
        .eq('short_code', shortCode)
        .single();
      
      if (!data) isUnique = true;
      attempts++;
    }
    
    if (!isUnique) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Unable to generate unique short code' })
      };
    }

    const name = await getNextName();
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
    const host = event.headers.host || 'localhost';
    const protocol = event.headers['x-forwarded-proto'] || 'https';

    const { data, error } = await supabase
      .from('qr_codes')
      .insert({
        short_code: shortCode,
        original_url: processedUrl,
        name: name,
        expires_at: expiresAt.toISOString()
      })
      .select()
      .single();

    if (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Database error' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        isText: false,
        shortCode,
        name,
        expiresAt: expiresAt.toISOString(),
        qrUrl: `${protocol}://${host}/article/${shortCode}`,
        originalUrl: processedUrl
      })
    };
  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
