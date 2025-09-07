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

// 微信优化路径映射
function getOptimizedPath(routeType, isWeChatEnv) {
  const routes = {
    go: '/go/',
    share: '/share/',
    link: '/link/',
    view: '/view/',
    article: '/article/', // 保持向后兼容
  };
  
  // 微信环境下优先使用较短的路径
  if (isWeChatEnv) {
    const wechatOptimized = {
      go: '/go/',
      share: '/s/',
      link: '/l/',
      view: '/v/',
      article: '/a/',
    };
    return wechatOptimized[routeType] || routes[routeType] || routes.go;
  }
  
  return routes[routeType] || routes.go;
}

// 生成微信友好的URL
function generateWeChatFriendlyUrl(protocol, host, path, shortCode) {
  // 添加随机参数以避免缓存和模式识别
  const timestamp = Date.now();
  const randomParam = Math.random().toString(36).substring(2, 8);
  
  // 微信环境下使用更自然的URL结构
  const baseUrl = `${protocol}://${host}${path}${shortCode}`;
  
  // 添加伪装参数使URL看起来更像正常文章链接
  const disguiseParams = [
    `?t=${timestamp}`,
    `?from=timeline&isappinstalled=0`,
    `?scene=23&srcid=${randomParam}`,
    `?chksm=${randomParam}&scene=27`,
  ];
  
  const randomDisguise = disguiseParams[Math.floor(Math.random() * disguiseParams.length)];
  return baseUrl + randomDisguise;
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, User-Agent, X-Forwarded-For',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
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

    const { 
      originalUrl, 
      expiresInMinutes, 
      routeType = 'go', 
      isWeChatEnv = false 
    } = JSON.parse(event.body);
    
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
    
    // 获取优化路径
    const optimizedPath = getOptimizedPath(routeType, isWeChatEnv);
    
    // 记录用户代理信息用于分析
    const userAgent = event.headers['user-agent'] || '';
    const isWeChatUA = userAgent.toLowerCase().includes('micromessenger');

    const { data, error } = await supabase
      .from('qr_codes')
      .insert({
        short_code: shortCode,
        original_url: processedUrl,
        name: name,
        expires_at: expiresAt.toISOString(),
        route_type: routeType,
        is_wechat_optimized: isWeChatEnv || isWeChatUA,
        user_agent: userAgent.substring(0, 500) // 限制长度
      })
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Database error' })
      };
    }

    // 生成微信友好的URL
    const qrUrl = generateWeChatFriendlyUrl(protocol, host, optimizedPath, shortCode);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        isText: false,
        shortCode,
        name,
        expiresAt: expiresAt.toISOString(),
        qrUrl: qrUrl,
        originalUrl: processedUrl,
        routeType: routeType,
        optimizedPath: optimizedPath,
        isWeChatOptimized: isWeChatEnv || isWeChatUA
      })
    };
  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      })
    };
  }
};
