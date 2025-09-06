// netlify/functions/manage-qr.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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
    'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    await cleanupExpired();

    if (event.httpMethod === 'GET') {
      // 获取活跃的二维码列表
      const { data, error } = await supabase
        .from('qr_codes')
        .select('*')
        .eq('is_active', true)
        .gte('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(data || [])
      };
    }

    if (event.httpMethod === 'DELETE') {
      // 销毁二维码
      const { shortCode } = JSON.parse(event.body);
      
      if (!shortCode) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing shortCode' })
        };
      }

      const { error } = await supabase
        .from('qr_codes')
        .update({ is_active: false })
        .eq('short_code', shortCode);

      if (error) {
        throw error;
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  } catch (error) {
    console.error('Manage QR error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};