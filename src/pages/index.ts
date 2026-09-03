// ==================== استایل‌های پایه مشترک ====================
export const baseStyles = `
  @import url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.0.3/Vazirmatn-font-face.css');

  :root {
    --primary: #4f5bd5;
    --primary-dark: #3c46b3;
    --primary-light: #818cf8;
    --secondary: #ec4899;
    --accent: #10b981;
    --accent-dark: #059669;
    --warning: #f59e0b;
    --error: #ef4444;

    --bg: #f4f5fa;
    --surface: #ffffff;
    --surface-2: #f8f9fd;
    --card-bg: #ffffff;
    --border: #e6e8f2;
    --text: #1c1e2b;
    --text-muted: #6b7086;

    --shadow-sm: 0 1px 2px rgba(20, 22, 40, 0.05), 0 1px 3px rgba(20, 22, 40, 0.06);
    --shadow: 0 4px 14px rgba(30, 34, 70, 0.07), 0 1px 4px rgba(30, 34, 70, 0.05);
    --shadow-lg: 0 16px 40px rgba(30, 34, 70, 0.12), 0 4px 12px rgba(30, 34, 70, 0.06);

    --radius-sm: 10px;
    --radius: 16px;
    --radius-lg: 20px;
    --transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);

    --sidebar-w: 250px;
    --header-h: 64px;
  }

  [data-theme="dark"] {
    --bg: #0e0f17;
    --surface: #161824;
    --surface-2: #12131d;
    --card-bg: #161824;
    --border: #262a3d;
    --text: #eef0fa;
    --text-muted: #9296b3;

    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.25);
    --shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    --shadow-lg: 0 20px 45px rgba(0, 0, 0, 0.5);
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  html { -webkit-text-size-adjust: 100%; }

  body {
    font-family: 'Vazirmatn', 'Vazir', Tahoma, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    transition: background-color var(--transition), color var(--transition);
    line-height: 1.7;
    -webkit-font-smoothing: antialiased;
  }

  ::selection { background: var(--primary-light); color: #fff; }

  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 20px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--primary-light); }

  a { color: inherit; }
  button { font-family: inherit; }

  .container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1.75rem 1.5rem;
    animation: fadeIn 0.5s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* Card */
  .glass {
    background: var(--card-bg);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    border: 1px solid var(--border);
    transition: box-shadow var(--transition), transform var(--transition), border-color var(--transition);
    padding: 1.75rem;
  }
  .glass:hover {
    box-shadow: var(--shadow-lg);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.7rem 1.5rem;
    border: none;
    border-radius: var(--radius-sm);
    font-weight: 600;
    font-size: 0.92rem;
    font-family: inherit;
    cursor: pointer;
    transition: filter var(--transition), transform var(--transition), box-shadow var(--transition);
    text-decoration: none;
    color: #fff;
    background: var(--primary);
    box-shadow: 0 2px 10px rgba(79, 91, 213, 0.28);
  }
  .btn:hover { filter: brightness(1.08); transform: translateY(-1px); }
  .btn:active { transform: translateY(0); filter: brightness(0.97); }
  .btn:focus-visible { outline: 2px solid var(--primary-light); outline-offset: 2px; }
  .btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

  .btn-vip {
    background: var(--warning);
    color: #1c1e2b;
    box-shadow: 0 2px 10px rgba(245, 158, 11, 0.3);
  }
  .btn-sub {
    background: var(--accent);
    box-shadow: 0 2px 10px rgba(16, 185, 129, 0.28);
  }

  .theme-toggle {
    position: fixed;
    top: 18px;
    left: 18px;
    width: 42px;
    height: 42px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--surface);
    font-size: 1.15rem;
    cursor: pointer;
    box-shadow: var(--shadow);
    transition: transform var(--transition), box-shadow var(--transition);
    z-index: 999;
  }
  .theme-toggle:hover { transform: rotate(15deg); box-shadow: var(--shadow-lg); }

  .footer {
    text-align: center;
    padding: 1.75rem 0 0.5rem;
    margin-top: 1.5rem;
    border-top: 1px solid var(--border);
    font-size: 0.85rem;
    color: var(--text-muted);
  }
  .footer a {
    color: var(--primary);
    font-weight: 600;
    text-decoration: none;
  }
  .footer a:hover { text-decoration: underline; }

  code {
    font-family: 'SFMono-Regular', Consolas, monospace;
    background: var(--surface-2);
    border: 1px solid var(--border);
    padding: 0.1rem 0.4rem;
    border-radius: 6px;
    font-size: 0.85em;
  }

  @media (max-width: 640px) {
    .container { padding: 1.1rem 0.9rem; }
    .glass { padding: 1.15rem; border-radius: var(--radius-sm); }
    .btn { font-size: 0.85rem; padding: 0.65rem 1.15rem; }
    .theme-toggle { top: 12px; left: 12px; width: 38px; height: 38px; }
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
    .brand-bar {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      font-weight: 800;
      font-size: 1.05rem;
      letter-spacing: 0.02em;
      padding-top: 0.5rem;
    }
    .brand-bar .logo-dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: linear-gradient(135deg, var(--primary), var(--secondary));
      display: inline-block;
    }
    .hero {
      text-align: center;
      padding: 2.25rem 1rem 2.5rem;
    }
    .hero h1 {
      font-size: clamp(1.9rem, 5vw, 2.8rem);
      font-weight: 800;
      background: linear-gradient(135deg, var(--primary), var(--secondary));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      line-height: 1.3;
    }
    .hero p {
      font-size: 1.1rem;
      margin-top: 0.6rem;
      color: var(--text-muted);
    }
    .features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 0;
      margin: 1.75rem 0;
      overflow: hidden;
      padding: 0;
    }
    .feature-item {
      text-align: center;
      padding: 1.75rem 1.25rem;
      border-inline-end: 1px solid var(--border);
    }
    .feature-item:last-child { border-inline-end: none; }
    .feature-item .icon {
      font-size: 2.3rem;
      margin-bottom: 0.6rem;
    }
    .feature-item h3 {
      font-size: 1.08rem;
      font-weight: 700;
      margin-bottom: 0.35rem;
    }
    .feature-item p {
      font-size: 0.88rem;
      color: var(--text-muted);
    }
    .vip-box {
      border: 1px solid var(--border);
      border-top: 3px solid var(--warning);
      position: relative;
      overflow: hidden;
    }
    .vip-box::before {
      content: "🎖️";
      position: absolute;
      top: -20px;
      left: -20px;
      font-size: 6rem;
      opacity: 0.06;
      transform: rotate(-15deg);
    }
    .vip-box h2 {
      display: flex; align-items: center; gap: 0.5rem;
      font-size: 1.3rem;
    }
    .vip-box p {
      color: var(--text-muted);
      margin-top: 0.5rem;
      max-width: 560px;
    }
    @media (max-width: 640px) {
      .feature-item { border-inline-end: none; border-bottom: 1px solid var(--border); }
      .feature-item:last-child { border-bottom: none; }
    }
  </style>
</head>
<body>
  <button class="theme-toggle" id="themeToggle" aria-label="تغییر تم">🌓</button>
  <div class="container">
    <div class="brand-bar"><span class="logo-dot"></span> BNDMAX VPN</div>
    <div class="hero">
      <h1>به BNDMAX VPN خوش آمدید</h1>
      <p>پروکسی امن، سریع و جهانی</p>
      <div style="margin-top:1.25rem;">
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

    <div class="glass vip-box" style="margin-top:1.5rem;">
      <h2 style="color: var(--warning);">🎖️ اشتراک ویژه (VIP)</h2>
      <p>با تهیه اشتراک ویژه، از سرعت بالاتر، پهنای باند اختصاصی و پشتیبانی اولویت‌دار بهره‌مند شوید.</p>
      <a href="/sub" class="btn btn-vip" style="margin-top:1rem;">🎟️ دریافت اشتراک VIP</a>
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
    .error-wrap { min-height: 80vh; display: flex; align-items: center; justify-content: center; }
    .error-box {
      text-align: center;
      max-width: 480px;
      width: 100%;
      padding: 2.75rem 2rem;
      border-top: 3px solid var(--error);
    }
    .error-box .icon {
      font-size: 3.5rem;
      display: inline-flex;
      width: 88px; height: 88px;
      align-items: center; justify-content: center;
      border-radius: 50%;
      background: color-mix(in srgb, var(--error) 12%, transparent);
      margin-bottom: 1rem;
    }
    .error-box h1 {
      color: var(--error);
      font-size: 1.9rem;
      font-weight: 800;
      margin: 0.5rem 0;
    }
    .error-box h2 {
      font-weight: 500;
      font-size: 1.1rem;
      color: var(--text-muted);
    }
    .error-box p {
      color: var(--text-muted);
      margin: 1rem 0;
      font-size: 0.92rem;
    }
    .error-box .btn {
      margin-top: 0.5rem;
    }
  </style>
</head>
<body>
  <button class="theme-toggle" id="themeToggle" aria-label="تغییر تم">🌓</button>
  <div class="container error-wrap">
    <div class="glass error-box">
      <div class="icon">⚠️</div>
      <h1>خطای سرور</h1>
      <h2>مشکلی پیش آمده است</h2>
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
        <h3 style="color:var(--primary);font-size:1.05rem;">🦊 VLESS</h3>
        <span style="font-size:0.72rem;background:var(--primary);color:#fff;padding:0.2rem 0.75rem;border-radius:30px;font-weight:600;">${sub.uuid.substring(0,8)}</span>
      </div>
      <div style="background:var(--surface-2);border-radius:var(--radius-sm);padding:0.8rem;overflow-x:auto;font-family:monospace;font-size:0.7rem;word-break:break-all;white-space:pre-wrap;max-height:180px;overflow-y:auto;border:1px solid var(--border);color:var(--text-muted);">
        ${escapeHtml(sub.link)}
      </div>
      <div style="margin-top:1rem;">
        <button class="btn btn-sub copy-btn" data-config="${escapeHtml(sub.link)}" style="width:100%;">📋 کپی VLESS</button>
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
      margin-bottom: 1.75rem;
    }
    .page-header h1 {
      font-size: clamp(1.6rem, 4vw, 2.1rem);
      font-weight: 800;
      background: linear-gradient(135deg, var(--primary), var(--secondary));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .page-header p {
      color: var(--text-muted);
      margin-top: 0.4rem;
    }
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
      gap: 1.25rem;
      margin: 1.75rem 0;
    }
    .card {
      transition: transform var(--transition), box-shadow var(--transition);
    }
    .card:hover {
      transform: translateY(-4px);
    }
    .vip-info {
      border: 1px solid var(--border);
      border-top: 3px solid var(--warning);
      position: relative;
      overflow: hidden;
    }
    .vip-info::before {
      content: "🎖️";
      position: absolute;
      top: -15px;
      right: -15px;
      font-size: 5rem;
      opacity: 0.05;
      transform: rotate(20deg);
    }
    .vip-info h2 { display:flex; align-items:center; gap:0.5rem; font-size: 1.2rem; }
    .vip-info p { color: var(--text-muted); margin-top: 0.4rem; }
    .copy-btn {
      background: var(--accent);
    }
    .notification {
      position: fixed;
      top: 20px;
      left: 20px;
      background: var(--accent);
      color: #fff;
      padding: 0.8rem 1.5rem;
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow-lg);
      transform: translateX(-130%);
      transition: transform 0.35s ease;
      z-index: 1000;
      font-weight: 600;
      font-size: 0.9rem;
    }
    .notification.show {
      transform: translateX(0);
    }
    .notification.error {
      background: var(--error);
    }
    @media (max-width: 600px) {
      .cards-grid { grid-template-columns: 1fr; }
      .notification { left: 12px; right: 12px; top: 12px; text-align: center; }
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

    <div class="glass vip-info" style="margin-bottom:1.75rem;">
      <h2 style="color:var(--warning);">🎖️ اشتراک ویژه (VIP)</h2>
      <p>با تهیه اشتراک ویژه، از سرعت بالاتر و پشتیبانی اختصاصی بهره‌مند شوید.</p>
      <a href="/" class="btn btn-vip" style="margin-top:0.9rem;">🏠 بازگشت به صفحه اصلی</a>
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