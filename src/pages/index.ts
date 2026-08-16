// ==================== استایل‌های پایه مشترک ====================
export const baseStyles = `
  @import url('https://cdn.jsdelivr.net/gh/rastikerdar/vazir-font@v30.1.0/dist/font-face.css');
  
  :root {
    --primary: #6c5ce7;
    --primary-light: #a29bfe;
    --secondary: #fd79a8;
    --accent: #00b894;
    --warning: #fdcb6e;
    --error: #e17055;
    --bg: #f0f0f5;
    --card-bg: rgba(255, 255, 255, 0.7);
    --text: #2d3436;
    --shadow: 0 8px 32px rgba(108, 92, 231, 0.15);
    --radius: 16px;
    --transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  
  [data-theme="dark"] {
    --bg: #0f0f1a;
    --card-bg: rgba(30, 30, 50, 0.8);
    --text: #e8e8f0;
    --shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }
  
  * { margin: 0; padding: 0; box-sizing: border-box; }
  
  body {
    font-family: 'Vazir', sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    transition: var(--transition);
    padding: 1.5rem;
    background-image: radial-gradient(circle at 10% 20%, rgba(108, 92, 231, 0.05) 0%, transparent 50%),
                      radial-gradient(circle at 90% 80%, rgba(0, 184, 148, 0.05) 0%, transparent 50%);
  }
  
  .container {
    max-width: 1200px;
    margin: 0 auto;
    animation: fadeIn 0.6s ease;
  }
  
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  /* Glassmorphism card */
  .glass {
    background: var(--card-bg);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    border: 1px solid rgba(255, 255, 255, 0.15);
    transition: var(--transition);
    padding: 1.8rem;
  }
  .glass:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 40px rgba(108, 92, 231, 0.25);
  }
  
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.7rem 1.6rem;
    border: none;
    border-radius: 50px;
    font-weight: 600;
    font-size: 0.95rem;
    cursor: pointer;
    transition: var(--transition);
    text-decoration: none;
    color: #fff;
    background: var(--primary);
    box-shadow: 0 4px 15px rgba(108, 92, 231, 0.3);
  }
  .btn:hover {
    transform: scale(1.04) translateY(-2px);
    box-shadow: 0 8px 25px rgba(108, 92, 231, 0.4);
  }
  .btn-vip {
    background: var(--warning);
    color: #2d3436;
  }
  .btn-vip:hover {
    background: #f9a825;
    color: #1e1e2f;
  }
  .btn-sub {
    background: var(--accent);
  }
  .btn-sub:hover {
    background: #00a381;
  }
  
  .theme-toggle {
    position: fixed;
    top: 20px;
    right: 20px;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: none;
    background: var(--card-bg);
    backdrop-filter: blur(8px);
    font-size: 1.2rem;
    cursor: pointer;
    box-shadow: var(--shadow);
    transition: var(--transition);
    z-index: 999;
  }
  .theme-toggle:hover {
    transform: rotate(20deg) scale(1.1);
  }
  
  .footer {
    text-align: center;
    padding: 2rem 0;
    margin-top: 2rem;
    border-top: 1px solid rgba(108, 92, 231, 0.15);
    font-size: 0.9rem;
    opacity: 0.7;
  }
  .footer a {
    color: var(--primary);
    text-decoration: none;
  }
  .footer a:hover {
    text-decoration: underline;
  }
  
  @media (max-width: 600px) {
    body { padding: 0.8rem; }
    .glass { padding: 1.2rem; }
    .btn { font-size: 0.85rem; padding: 0.6rem 1.2rem; }
  }
`;

// ==================== صفحه اصلی ====================
export async function indexPage(): Promise<Response> {
  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BNDMAX VPN – امن و پرسرعت</title>
  <style>${baseStyles}</style>
  <style>
    /* اختصاصی صفحه اصلی */
    .hero {
      text-align: center;
      padding: 3rem 1rem 2rem;
    }
    .hero h1 {
      font-size: 2.8rem;
      background: linear-gradient(135deg, var(--primary), var(--secondary));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .hero p {
      font-size: 1.2rem;
      margin-top: 0.5rem;
      opacity: 0.8;
    }
    .features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1.5rem;
      margin: 2rem 0;
    }
    .feature-item {
      text-align: center;
      padding: 1.5rem 1rem;
    }
    .feature-item .icon {
      font-size: 2.8rem;
      margin-bottom: 0.5rem;
    }
    .feature-item h3 {
      font-size: 1.2rem;
      margin-bottom: 0.3rem;
    }
    .vip-box {
      border: 2px solid var(--warning);
      position: relative;
      overflow: hidden;
    }
    .vip-box::before {
      content: "🎖️";
      position: absolute;
      top: -20px;
      left: -20px;
      font-size: 6rem;
      opacity: 0.08;
      transform: rotate(-15deg);
    }
  </style>
</head>
<body>
  <button class="theme-toggle" id="themeToggle" aria-label="تغییر تم">🌓</button>
  <div class="container">
    <div class="hero">
      <h1>به BNDMAX VPN خوش آمدید</h1>
      <p>پروکسی امن، سریع و جهانی</p>
      <div style="margin-top:1rem;">
        <a href="https://t.me/vahidekhlasi" target="_blank" class="btn" style="background: #0088cc;">📱 تلگرام</a>
      </div>
    </div>

    <div class="glass features">
      <div class="feature-item">
        <div class="icon">⚡</div>
        <h3>سرعت برق‌آسا</h3>
        <p>بهینه‌شده برای کمترین تأخیر</p>
      </div>
      <div class="feature-item">
        <div class="icon">🔒</div>
        <h3>امنیت پیشرفته</h3>
        <p>رمزنگاری در سطح سازمانی</p>
      </div>
      <div class="feature-item">
        <div class="icon">🌐</div>
        <h3>شبکه جهانی</h3>
        <p>سرورهای متعدد در سراسر جهان</p>
      </div>
    </div>

    <div class="glass vip-box" style="margin-top:2rem;">
      <h2 style="color: var(--warning);">🎖️ اشتراک ویژه (VIP)</h2>
      <p>با تهیه اشتراک ویژه، از سرعت بالاتر، پهنای باند اختصاصی و پشتیبانی اولویت‌دار بهره‌مند شوید.</p>
      <a href="/sub" class="btn btn-vip" style="margin-top:0.5rem;">🎟️ دریافت اشتراک VIP</a>
    </div>
  </div>

  <div class="footer">
    <p>BNDMAX VPN – نسخه ۱.۰.۰</p>
    <p>📱 <a href="https://t.me/vahidekhlasi" target="_blank">t.me/vahidekhlasi</a></p>
  </div>

  <script>
    (function() {
      const toggle = document.getElementById('themeToggle');
      const stored = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', stored);
      toggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
      });
    })();
  </script>
</body>
</html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ==================== صفحه خطا ====================
export async function errorPage(): Promise<Response> {
  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>خطا – BNDMAX VPN</title>
  <style>${baseStyles}</style>
  <style>
    .error-box {
      text-align: center;
      max-width: 600px;
      margin: 4rem auto;
      padding: 3rem 2rem;
    }
    .error-box .icon {
      font-size: 4.5rem;
      color: var(--error);
    }
    .error-box h1 {
      color: var(--error);
      font-size: 2.5rem;
      margin: 0.5rem 0;
    }
    .error-box p {
      opacity: 0.8;
      margin: 1rem 0;
    }
    .error-box .btn {
      margin-top: 1rem;
    }
  </style>
</head>
<body>
  <button class="theme-toggle" id="themeToggle" aria-label="تغییر تم">🌓</button>
  <div class="container">
    <div class="glass error-box">
      <div class="icon">⚠️</div>
      <h1>خطای سرور</h1>
      <h2 style="font-weight:400;font-size:1.3rem;">مشکلی پیش آمده است</h2>
      <p>صفحه‌ای که به دنبال آن هستید در دسترس نیست.<br />لطفاً بعداً تلاش کنید.</p>
      <button class="btn" onclick="location.reload()">تلاش مجدد</button>
    </div>
  </div>
  <div class="footer">
    <p>BNDMAX VPN – <a href="https://t.me/vahidekhlasi" target="_blank">تماس با پشتیبانی</a></p>
  </div>
  <script>
    (function() {
      const toggle = document.getElementById('themeToggle');
      const stored = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', stored);
      toggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
      });
    })();
  </script>
</body>
</html>`;
  return new Response(html, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ==================== صفحه اشتراک (VIP) ====================
export async function subscriptionPage(env: any, request: Request): Promise<Response> {
  const { splitAndFilter } = await import('../utils/array.ts');
  const { generateSubscription, generateVlessConfig } = await import('../services/subscription.ts');

  const uuids = splitAndFilter(env.UUID || '', ',');
  const url = new URL(request.url);

  const subscriptions = uuids.map((uuid: string) => ({
    uuid,
    link: generateSubscription(uuid, url),
    vlessJson: JSON.stringify(generateVlessConfig(uuid, url), null, 2)
  }));

  const escapeHtml = (str: string) =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  const cardsHtml = subscriptions.map((sub: any) => `
    <div class="glass card" data-uuid="${sub.uuid}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
        <h3 style="color:var(--primary);">🦊 VLESS</h3>
        <span style="font-size:0.75rem;background:var(--primary);color:#fff;padding:0.2rem 0.8rem;border-radius:30px;">${sub.uuid.substring(0,8)}</span>
      </div>
      <div style="background:rgba(0,0,0,0.03);border-radius:12px;padding:0.8rem;overflow-x:auto;font-family:monospace;font-size:0.7rem;word-break:break-all;white-space:pre-wrap;max-height:180px;overflow-y:auto;border:1px solid rgba(108,92,231,0.1);">
        ${escapeHtml(sub.link)}
      </div>
      <div style="margin-top:1rem;">
        <button class="btn btn-sub copy-btn" data-config="${escapeHtml(sub.link)}" style="width:100%;justify-content:center;">📋 کپی VLESS</button>
      </div>
    </div>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>اشتراک BNDMAX VPN</title>
  <style>${baseStyles}</style>
  <style>
    .page-header {
      text-align: center;
      margin-bottom: 2rem;
    }
    .page-header h1 {
      font-size: 2.2rem;
      background: linear-gradient(135deg, var(--primary), var(--secondary));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .page-header p {
      opacity: 0.7;
    }
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1.8rem;
      margin: 2rem 0;
    }
    .card {
      transition: var(--transition);
    }
    .card:hover {
      transform: translateY(-6px);
    }
    .vip-info {
      border: 2px solid var(--warning);
      position: relative;
      overflow: hidden;
    }
    .vip-info::before {
      content: "🎖️";
      position: absolute;
      top: -15px;
      right: -15px;
      font-size: 5rem;
      opacity: 0.06;
      transform: rotate(20deg);
    }
    .copy-btn {
      background: var(--accent);
    }
    .copy-btn:hover {
      background: #00a381;
    }
    .notification {
      position: fixed;
      top: 20px;
      left: 20px;
      background: var(--accent);
      color: #fff;
      padding: 0.8rem 1.5rem;
      border-radius: 50px;
      box-shadow: var(--shadow);
      transform: translateX(-120%);
      transition: transform 0.4s ease;
      z-index: 1000;
      font-weight: 500;
    }
    .notification.show {
      transform: translateX(0);
    }
    .notification.error {
      background: var(--error);
    }
    @media (max-width: 600px) {
      .cards-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <button class="theme-toggle" id="themeToggle" aria-label="تغییر تم">🌓</button>
  <div class="container">
    <div class="page-header">
      <h1>اشتراک BNDMAX VPN</h1>
      <p>پیکربندی خود را کپی کرده و در کلاینت وارد کنید</p>
    </div>

    <div class="glass vip-info">
      <h2 style="color:var(--warning);">🎖️ اشتراک ویژه (VIP)</h2>
      <p>با تهیه اشتراک ویژه، از سرعت بالاتر و پشتیبانی اختصاصی بهره‌مند شوید.</p>
      <a href="/" class="btn btn-vip" style="margin-top:0.3rem;">🏠 بازگشت به صفحه اصلی</a>
    </div>

    <div class="cards-grid">
      ${cardsHtml}
    </div>

    <div class="footer">
      <p>BNDMAX VPN – <a href="https://t.me/vahidekhlasi" target="_blank">📱 t.me/vahidekhlasi</a></p>
    </div>
  </div>

  <div class="notification" id="notification">✅ کپی شد!</div>

  <script>
    (function() {
      // تم
      const toggle = document.getElementById('themeToggle');
      const stored = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', stored);
      toggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
      });

      // دکمه کپی
      const notif = document.getElementById('notification');
      function showNotif(msg, isError = false) {
        notif.textContent = msg;
        notif.className = 'notification' + (isError ? ' error' : '');
        notif.classList.add('show');
        clearTimeout(notif._timer);
        notif._timer = setTimeout(() => notif.classList.remove('show'), 3000);
      }

      document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const config = btn.getAttribute('data-config');
          if (!config) return showNotif('خطا در دریافت پیکربندی', true);
          try {
            await navigator.clipboard.writeText(config);
            showNotif('✅ پیکربندی VLESS کپی شد!');
          } catch {
            // fallback
            const ta = document.createElement('textarea');
            ta.value = config;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            try {
              document.execCommand('copy');
              showNotif('✅ پیکربندی کپی شد!');
            } catch {
              showNotif('❌ کپی ناموفق، دستی کپی کنید', true);
            }
            document.body.removeChild(ta);
          }
        });
      });
    })();
  </script>
</body>
</html>`;

  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}