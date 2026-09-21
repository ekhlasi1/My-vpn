// ==================== استایل‌های پایه مشترک ====================
export const baseStyles = `
  @import url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.0.3/Vazirmatn-font-face.css');

  :root {
    --primary: #6556e8;
    --primary-dark: #4d3fc2;
    --primary-light: #9c8cfb;
    --secondary: #06b6d4;
    --accent: #14b88a;
    --accent-dark: #0e9270;
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

    --glass-bg: rgba(255, 255, 255, 0.55);
    --glass-border: rgba(255, 255, 255, 0.4);
    --glass-blur: 14px;
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

    --glass-bg: rgba(22, 24, 36, 0.55);
    --glass-border: rgba(255, 255, 255, 0.08);
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
    position: relative;
    isolation: isolate;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: clamp(0.65rem, 1.6vw + 0.3rem, 0.78rem) clamp(1.15rem, 4vw, 1.6rem);
    border: 1px solid color-mix(in srgb, #fff 22%, var(--primary) 78%);
    border-radius: var(--radius-sm);
    font-weight: 700;
    font-size: clamp(0.85rem, 1.6vw, 0.92rem);
    font-family: inherit;
    cursor: pointer;
    transition: filter var(--transition), transform var(--transition), box-shadow var(--transition);
    text-decoration: none;
    color: #fff;
    background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
    backdrop-filter: blur(8px) saturate(160%);
    -webkit-backdrop-filter: blur(8px) saturate(160%);
    box-shadow: 0 2px 10px rgba(101, 86, 232, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.35), inset 0 -8px 14px rgba(0, 0, 0, 0.08);
    max-width: 100%;
  }
  /* glassy shimmer sweep on hover */
  .btn::before {
    content: '';
    position: absolute; inset: 0;
    background: linear-gradient(120deg, transparent 30%, rgba(255, 255, 255, 0.45) 48%, rgba(255, 255, 255, 0.05) 62%, transparent 80%);
    transform: translateX(-130%);
    transition: transform 0.65s ease;
    pointer-events: none;
  }
  .btn:hover::before { transform: translateX(130%); }
  .btn > * { position: relative; }
  .btn:hover { filter: brightness(1.08); transform: translateY(-2px); box-shadow: 0 10px 24px rgba(101, 86, 232, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.4); }
  .btn:active { transform: translateY(0); filter: brightness(0.97); }
  .btn:focus-visible { outline: 2px solid var(--primary-light); outline-offset: 2px; }
  .btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
  @media (prefers-reduced-motion: reduce) { .btn, .btn::before { transition: none; } }

  .btn-vip {
    background: linear-gradient(135deg, var(--warning) 0%, #d18f06 100%);
    color: #1c1e2b;
    border-color: color-mix(in srgb, #fff 30%, var(--warning) 70%);
    box-shadow: 0 2px 10px rgba(245, 158, 11, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.4);
  }
  .btn-sub {
    background: linear-gradient(135deg, var(--accent) 0%, var(--accent-dark) 100%);
    border-color: color-mix(in srgb, #fff 26%, var(--accent) 74%);
    box-shadow: 0 2px 10px rgba(20, 184, 138, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.35);
  }

  /* ---------- Global form fields (used everywhere — inside .settings-form, bare, or in auth cards) ---------- */
  .field { margin-bottom: 1rem; max-width: 460px; }
  .field.field-wide { max-width: none; }
  .field label { display: block; margin-bottom: 0.45rem; font-size: 0.83rem; color: var(--text-muted); font-weight: 600; }
  .field input, .field select, .field textarea {
    width: 100%;
    padding: 0.68rem 0.95rem;
    border-radius: var(--radius-sm);
    border: 1.5px solid var(--border);
    background: var(--surface-2);
    color: var(--text);
    font-family: inherit;
    font-size: 0.92rem;
    transition: border-color var(--transition), box-shadow var(--transition), background var(--transition);
  }
  .field textarea { resize: vertical; }
  .field input:hover, .field select:hover, .field textarea:hover { border-color: color-mix(in srgb, var(--primary) 45%, var(--border)); }
  .field input:focus, .field select:focus, .field textarea:focus {
    outline: none;
    border-color: var(--primary);
    background: var(--surface);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary) 16%, transparent);
  }
  .field input[readonly] { color: var(--text-muted); cursor: default; background: color-mix(in srgb, var(--surface-2) 65%, var(--border) 35%); }
  .field input[type="checkbox"] { width: auto; accent-color: var(--primary); }

  /* ---------- Reusable decorative dividers: sinusoidal + "broken" zigzag ---------- */
  .wave-divider {
    height: 8px; width: 100%; border-radius: 8px; overflow: hidden;
    background: linear-gradient(90deg, var(--primary), var(--secondary), var(--accent), var(--primary));
    background-size: 200% 100%;
    -webkit-mask-repeat: repeat-x; mask-repeat: repeat-x;
    -webkit-mask-size: 44px 8px; mask-size: 44px 8px;
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='44' height='8' viewBox='0 0 44 8'%3E%3Cpath d='M0 4 C 5.5 0, 11 8, 16.5 4 S 27.5 0, 33 4 S 44 8, 44 4' stroke='%23000' stroke-width='2.4' fill='none'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='44' height='8' viewBox='0 0 44 8'%3E%3Cpath d='M0 4 C 5.5 0, 11 8, 16.5 4 S 27.5 0, 33 4 S 44 8, 44 4' stroke='%23000' stroke-width='2.4' fill='none'/%3E%3C/svg%3E");
    animation: waveDividerDrift 5s linear infinite, waveDividerHue 8s linear infinite;
  }
  @keyframes waveDividerDrift { from { -webkit-mask-position-x: 0; mask-position-x: 0; } to { -webkit-mask-position-x: 44px; mask-position-x: 44px; } }
  @keyframes waveDividerHue { from { background-position-x: 0%; } to { background-position-x: 200%; } }
  .zigzag-divider {
    height: 6px; width: 100%;
    background: repeating-linear-gradient(135deg, var(--primary) 0 6px, var(--secondary) 6px 12px);
    clip-path: polygon(0% 0%, 4% 100%, 8% 0%, 12% 100%, 16% 0%, 20% 100%, 24% 0%, 28% 100%, 32% 0%, 36% 100%, 40% 0%, 44% 100%, 48% 0%, 52% 100%, 56% 0%, 60% 100%, 64% 0%, 68% 100%, 72% 0%, 76% 100%, 80% 0%, 84% 100%, 88% 0%, 92% 100%, 96% 0%, 100% 100%);
    opacity: 0.85;
  }
  @media (prefers-reduced-motion: reduce) { .wave-divider { animation: none; } }

  /* ---------- Repeating background watermark ---------- */
  /* Used to be one huge (15vw) centered, spinning "@vahidekhlasi" — now it's
     a small tile of the same text repeated (tiled) across the entire page,
     each copy slightly rotated, like a standard document watermark pattern.
     fill="currentColor" inside the embedded SVG picks up whatever "color"
     is set on .bg-watermark itself, so the light/dark tint below still works
     without needing two separate encoded SVGs. */
  .bg-watermark {
    position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden;
    color: color-mix(in srgb, var(--primary) 7%, transparent);
    background-repeat: repeat;
    background-size: 230px 130px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='230' height='130' viewBox='0 0 230 130'%3E%3Ctext x='-15' y='75' font-family='sans-serif' font-weight='800' font-size='19' letter-spacing='0.02em' fill='currentColor' transform='rotate(-18 115 65)'%3E%40vahidekhlasi%3C/text%3E%3C/svg%3E");
    animation: bgWatermarkDrift 70s linear infinite;
  }
  [data-theme="dark"] .bg-watermark { color: color-mix(in srgb, var(--primary-light) 9%, transparent); }
  @keyframes bgWatermarkDrift { from { background-position: 0 0; } to { background-position: 230px 130px; } }
  @media (prefers-reduced-motion: reduce) { .bg-watermark { animation: none; } }

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
      <!-- "/sub" used to be a fixed, publicly-guessable path to the owner's
           own unlimited config; it's no longer routed (see handler.ts /
           getOrCreateOwnerSubPath) precisely so that link can't be public.
           This CTA now points at Telegram instead, same as the header button. -->
      <a href="https://t.me/vahidekhlasi" target="_blank" class="btn btn-vip" style="margin-top:1rem;">🎟️ دریافت اشتراک VIP</a>
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

