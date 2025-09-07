// netlify/functions/redirect.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// 提取短代码的函数，支持多种路径格式
function extractShortCode(path) {
  // 支持的路径格式: /go/abc123, /share/abc123, /link/abc123, /view/abc123, /article/abc123
  const patterns = [
    /\/go\/([a-zA-Z0-9]+)/,
    /\/share\/([a-zA-Z0-9]+)/,
    /\/s\/([a-zA-Z0-9]+)/,
    /\/link\/([a-zA-Z0-9]+)/,
    /\/l\/([a-zA-Z0-9]+)/,
    /\/view\/([a-zA-Z0-9]+)/,
    /\/v\/([a-zA-Z0-9]+)/,
    /\/article\/([a-zA-Z0-9]+)/,
    /\/a\/([a-zA-Z0-9]+)/
  ];
  
  for (const pattern of patterns) {
    const match = path.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  // 后备方案：取路径最后一段
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1];
}

// 检测微信环境
function isWeChatEnvironment(userAgent) {
  return userAgent && userAgent.toLowerCase().includes('micromessenger');
}

// 生成微信友好的重定向响应
function createWeChatFriendlyRedirect(originalUrl, userAgent) {
  const isWeChat = isWeChatEnvironment(userAgent);
  
  if (isWeChat) {
    // 微信环境：使用中间页面避免直接重定向被拦截
    const intermediatePage = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>正在跳转...</title>
    <meta name="robots" content="noindex,nofollow">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
            text-align: center;
        }
        .container {
            background: white;
            border-radius: 10px;
            padding: 30px;
            margin: 50px auto;
            max-width: 400px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .loading {
            font-size: 18px;
            color: #333;
            margin-bottom: 20px;
        }
        .spinner {
            width: 40px;
            height: 40px;
            border: 4px solid #f3f3f3;
            border-top: 4px solid #4CAF50;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 20px auto;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .manual-link {
            margin-top: 20px;
            padding: 10px 20px;
            background: #4CAF50;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            display: inline-block;
        }
        .tips {
            font-size: 14px;
            color: #666;
            margin-top: 20px;
            line-height: 1.5;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="loading">正在为您跳转...</div>
        <div class="spinner"></div>
        <div class="tips">
            如果长时间未跳转，请点击下方按钮<br>
            或复制链接到浏览器打开
        </div>
        <a href="${originalUrl}" class="manual-link" id="manualLink">手动跳转</a>
        
        <script>
            // 延迟跳转避免被微信检测
            setTimeout(function() {
                try {
                    // 尝试多种跳转方式
                    if (window.WeixinJSBridge) {
                        // 微信内置浏览器
                        window.location.href = "${originalUrl}";
                    } else {
                        // 其他情况
                        window.location.replace("${originalUrl}");
                    }
                } catch (e) {
                    console.log('跳转失败，显示手动链接');
                    document.getElementById('manualLink').style.display = 'inline-block';
                }
            }, 1500);
            
            // 监听微信JS Bridge
            document.addEventListener('WeixinJSBridgeReady', function() {
                setTimeout(function() {
                    window.location.href = "${originalUrl}";
                }, 1000);
            });
            
            // 页面可见性变化时重试
            document.addEventListener('visibilitychange', function() {
                if (!document.hidden) {
                    setTimeout(function() {
                        window.location.href = "${originalUrl}";
                    }, 500);
                }
            });
        </script>
    </div>
</body>
</html>`;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Frame-Options': 'SAMEORIGIN',
        'X-Content-Type-Options': 'nosniff'
      },
      body: intermediatePage
    };
  } else {
    // 非微信环境：直接302重定向
    return {
      statusCode: 302,
      headers: {
        'Location': originalUrl,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    };
  }
}

// 生成404页面
function generate404Page() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>链接未找到</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
            text-align: center;
        }
        .container {
            background: white;
            border-radius: 10px;
            padding: 40px;
            margin: 100px auto;
            max-width: 400px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .error-code { font-size: 48px; color: #e74c3c; margin-bottom: 20px; }
        .error-message { font-size: 18px; color: #333; margin-bottom: 10px; }
        .error-description { font-size: 14px; color: #666; line-height: 1.5; }
        .home-link {
            margin-top: 30px;
            padding: 10px 20px;
            background: #4CAF50;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            display: inline-block;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="error-code">404</div>
        <div class="error-message">链接未找到</div>
        <div class="error-description">
            该链接可能已过期或已被删除<br>
            请检查链接是否正确或联系分享者
        </div>
        <a href="/" class="home-link">返回首页</a>
    </div>
</body>
</html>`;
}

exports.handler = async (event, context) => {
  const path = event.path || event.rawUrl || '';
  const userAgent = event.headers['user-agent'] || '';
  const clientIP = event.headers['x-forwarded-for'] || event.headers['x-bb-ip'] || '';
  
  console.log('Redirect request:', { path, userAgent: userAgent.substring(0, 100) });
  
  const shortCode = extractShortCode(path);
  
  if (!shortCode) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: generate404Page()
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
      console.log('QR code not found:', shortCode, error);
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: generate404Page()
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

      console.log('QR code expired or inactive:', shortCode);
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: generate404Page()
      };
    }

    // 记录扫描（异步执行，不阻塞重定向）
    const logScan = async () => {
      try {
        // 记录扫描日志
        await supabase.from('scan_logs').insert({
          qr_code_id: qrCode.id,
          user_agent: userAgent.substring(0, 500),
          ip_address: clientIP.substring(0, 100),
          is_wechat: isWeChatEnvironment(userAgent),
          scanned_at: new Date().toISOString()
        });

        // 更新扫描计数
        await supabase
          .from('qr_codes')
          .update({ 
            scan_count: qrCode.scan_count + 1,
            last_scanned_at: new Date().toISOString()
          })
          .eq('id', qrCode.id);
          
        console.log('Scan logged successfully for:', shortCode);
      } catch (err) {
        console.error('记录扫描失败:', err);
      }
    };

    // 异步记录扫描，不阻塞重定向
    logScan();

    // 根据环境返回适当的重定向响应
    return createWeChatFriendlyRedirect(qrCode.original_url, userAgent);

  } catch (error) {
    console.error('Redirect error:', error);
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: generate404Page()
    };
  }
};
