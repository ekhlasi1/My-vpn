import { baseStyles } from './index'

function page(status: number, title: string, body: string): Response {
  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>${baseStyles}</style>
  <style>
    .sys-wrap { min-height: 100vh; display:flex; align-items:center; justify-content:center; padding:1.25rem; }
    .sys-box { width:100%; max-width:640px; padding:2rem 1.75rem; border-top:3px solid var(--warning); line-height:1.9; }
    .sys-box h1 { font-size:1.35rem; font-weight:800; margin-bottom:.6rem; }
    .sys-box ol { padding-inline-start:1.25rem; margin:.8rem 0; }
    .sys-box code { direction:ltr; unicode-bidi:embed; background:var(--surface-2); padding:.1rem .45rem; border-radius:6px; font-size:.85em; }
    .sys-box pre { direction:ltr; text-align:left; background:var(--surface-2); padding:.8rem; border-radius:8px; overflow-x:auto; font-size:.8rem; }
    .sys-box .muted { color:var(--text-muted); font-size:.85rem; }
  </style>
</head>
<body>
  <div class="sys-wrap"><div class="glass sys-box">${body}</div></div>
  <script>
    (function(){
      var s = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', s);
    })();
  </script>
</body>
</html>`
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/** Shown instead of a bare "server error" when the D1 binding is not attached. */
export function dbMissingPage(): Response {
  return page(
    503,
    'دیتابیس متصل نیست – BNDMAX VPN',
    `<h1>⚠️ دیتابیس D1 به ورکر وصل نیست</h1>
    <p>ورکر اجرا می‌شود، اما بایندینگ دیتابیس با نام <code>DB</code> به آن متصل نشده است؛ بنابراین صفحهٔ ورود نمی‌تواند باز شود.</p>
    <p><b>یکی از دو راه زیر را انجام دهید:</b></p>
    <ol>
      <li><b>از طریق داشبورد:</b> Workers &amp; Pages ← ورکر شما ← Settings ← Bindings ← Add ← <b>D1 database</b>؛ نام متغیر (Variable name) را دقیقاً <code>DB</code> بگذارید و یک دیتابیس بسازید/انتخاب کنید. سپس Deploy کنید.</li>
      <li><b>از طریق wrangler.toml:</b> مقدار <code>database_id</code> را با شناسهٔ واقعی دیتابیس جایگزین کنید (با دستور <code>npx wrangler d1 create bndmax-vpn-db</code> ساخته می‌شود) و دوباره deploy کنید.</li>
    </ol>
    <p class="muted">جدول‌ها به‌صورت خودکار در اولین درخواست ساخته می‌شوند؛ نیازی به اجرای دستی schema نیست. وضعیت لحظه‌ای: <code>/health</code></p>`,
  )
}

/** Shown when the DB is attached but initialisation/queries fail. */
export function dbErrorPage(): Response {
  return page(
    500,
    'خطای دیتابیس – BNDMAX VPN',
    `<h1>⚠️ خطا در اتصال به دیتابیس</h1>
    <p>ورکر به دیتابیس متصل است اما ساخت یا خواندن جدول‌ها با خطا روبه‌رو شد.</p>
    <p>برای دیدن علت دقیق، مسیر <code>/health</code> را باز کنید یا لاگ زنده را با دستور زیر ببینید:</p>
    <pre>npx wrangler tail</pre>
    <p class="muted">اگر دیتابیس را جابه‌جا یا پاک کرده‌اید، مطمئن شوید <code>database_id</code> در wrangler.toml با دیتابیس موجود یکی است.</p>`,
  )
}
