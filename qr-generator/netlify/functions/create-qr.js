// netlify/functions/create-qr.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// 生成随机短码
function generateShortCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 生成下一个名称
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

// 清理过期记录
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
    
    if (!originalUrl || !expiresInMinutes) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    // 生成唯一短码
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

    // 保存到数据库
    const { data, error } = await supabase
      .from('qr_codes')
      .insert({
        short_code: shortCode,
        original_url: originalUrl,
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
        shortCode,
        name,
        expiresAt: expiresAt.toISOString(),
        qrUrl: `${protocol}://${host}/r/${shortCode}`
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};