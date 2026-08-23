import { baseStyles } from './index'

function shell(title: string, body: string, extraStyle = ''): string {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>${baseStyles}</style>
  <style>${extraStyle}</style>
</head>
<body>
${body}
<script>
(function() {
  const stored = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', stored);
})();
</script>
</body>
</html>`
}

const authFormStyle = `
  .auth-wrap { min-height: 90vh; display: flex; align-items: center; justify-content: center; }
  .auth-card { width: 100%; max-width: 380px; }
  .auth-card h1 { text-align:center; font-size:1.6rem; margin-bottom: 0.3rem; }
  .auth-card p.sub { text-align:center; opacity:0.7; margin-bottom:1.5rem; font-size:0.9rem; }
  .field { margin-bottom: 1rem; }
  .field label { display:block; margin-bottom:0.4rem; font-size:0.85rem; opacity:0.8; }
  .field input { width:100%; padding:0.7rem 1rem; border-radius:10px; border:1px solid rgba(108,92,231,0.25); background: rgba(255,255,255,0.5); font-family:inherit; font-size:0.95rem; }
  [data-theme="dark"] .field input { background: rgba(255,255,255,0.06); color: var(--text); }
  .msg { font-size:0.85rem; text-align:center; margin-top:0.8rem; min-height:1.2rem; }
  .msg.error { color: var(--error); }
  .msg.ok { color: var(--accent); }
`

export function setupPage(): Response {
  const body = `
  <div class="auth-wrap">
    <div class="glass auth-card">
      <h1>🛡️ راه‌اندازی داشبورد</h1>
      <p class="sub">این اولین اجرای داشبورد است. یک رمز عبور مدیریتی تعیین کنید.</p>
      <form id="f">
        <div class="field"><label>رمز عبور جدید</label><input type="password" id="p1" required minlength="6" /></div>
        <div class="field"><label>تکرار رمز عبور</label><input type="password" id="p2" required minlength="6" /></div>
        <button class="btn" type="submit" style="width:100%; justify-content:center;">ایجاد و ورود</button>
      </form>
      <div class="msg" id="msg"></div>
    </div>
  </div>
  <script>
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('msg');
      const p1 = document.getElementById('p1').value;
      const p2 = document.getElementById('p2').value;
      if (p1 !== p2) { msg.textContent = 'رمزها یکسان نیستند'; msg.className = 'msg error'; return; }
      const res = await fetch('/api/admin/setup', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ password: p1 }) });
      const data = await res.json();
      if (res.ok) { location.href = '/admin'; }
      else { msg.textContent = data.error || 'خطا رخ داد'; msg.className = 'msg error'; }
    });
  </script>`
  return new Response(shell('راه‌اندازی داشبورد', body, authFormStyle), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export function loginPage(error?: string): Response {
  const body = `
  <div class="auth-wrap">
    <div class="glass auth-card">
      <h1>🔐 ورود به داشبورد</h1>
      <p class="sub">BNDMAX VPN &middot; پنل مدیریت</p>
      <form id="f">
        <div class="field"><label>رمز عبور</label><input type="password" id="p" required /></div>
        <button class="btn" type="submit" style="width:100%; justify-content:center;">ورود</button>
      </form>
      <div class="msg ${error ? 'error' : ''}" id="msg">${error ?? ''}</div>
    </div>
  </div>
  <script>
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('msg');
      const p = document.getElementById('p').value;
      const res = await fetch('/api/admin/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ password: p }) });
      const data = await res.json();
      if (res.ok) { location.href = '/admin'; }
      else { msg.textContent = data.error || 'رمز اشتباه است'; msg.className = 'msg error'; }
    });
  </script>`
  return new Response(shell('ورود به داشبورد', body, authFormStyle), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

const dashboardStyle = `
  .dash-wrap { max-width: 1100px; margin: 0 auto; }
  .dash-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; flex-wrap:wrap; gap:0.8rem; }
  .dash-header h1 { font-size:1.5rem; }
  .tabs { display:flex; gap:0.5rem; margin-bottom:1.5rem; flex-wrap:wrap; }
  .tab-btn { padding:0.6rem 1.2rem; border-radius:50px; border:none; cursor:pointer; background: var(--card-bg); font-family:inherit; font-weight:600; font-size:0.85rem; }
  .tab-btn.active { background: var(--primary); color:#fff; }
  .tab-panel { display:none; }
  .tab-panel.active { display:block; }
  .stat-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:1rem; margin-bottom:1.5rem; }
  .stat-card { text-align:center; padding:1.2rem 0.5rem; }
  .stat-card .num { font-size:1.8rem; font-weight:700; color:var(--primary); }
  .stat-card .lbl { font-size:0.8rem; opacity:0.7; margin-top:0.2rem; }
  table { width:100%; border-collapse:collapse; font-size:0.85rem; }
  th, td { padding:0.6rem 0.5rem; text-align:right; border-bottom:1px solid rgba(108,92,231,0.12); }
  th { opacity:0.7; font-weight:600; }
  .pill { padding:0.2rem 0.6rem; border-radius:30px; font-size:0.72rem; font-weight:600; }
  .pill.active { background: rgba(0,184,148,0.15); color:#00b894; }
  .pill.expired { background: rgba(225,112,85,0.15); color:#e17055; }
  .pill.disabled { background: rgba(120,120,120,0.15); color:#888; }
  .pill.pro { background: rgba(253,203,110,0.2); color:#e1a100; }
  .pill.trial { background: rgba(108,92,231,0.15); color: var(--primary); }
  .table-wrap { overflow-x:auto; }
  .row-actions { display:flex; gap:0.3rem; flex-wrap:wrap; }
  .row-actions button { border:none; border-radius:8px; padding:0.3rem 0.6rem; font-size:0.72rem; cursor:pointer; background: rgba(108,92,231,0.12); color: var(--primary); font-family:inherit; }
  .row-actions button.danger { background: rgba(225,112,85,0.12); color: var(--error); }
  form.settings-form .field { margin-bottom:1rem; max-width:420px; }
  form.settings-form label { display:block; margin-bottom:0.35rem; font-size:0.85rem; opacity:0.8; }
  form.settings-form input { width:100%; padding:0.6rem 0.9rem; border-radius:10px; border:1px solid rgba(108,92,231,0.25); background: rgba(255,255,255,0.5); font-family:inherit; }
  [data-theme="dark"] form.settings-form input { background: rgba(255,255,255,0.06); color: var(--text); }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
  @media (max-width:600px){ .grid2 { grid-template-columns:1fr; } }
  .toast { position:fixed; top:20px; left:20px; background:var(--accent); color:#fff; padding:0.7rem 1.3rem; border-radius:50px; box-shadow:var(--shadow); transform:translateX(-120%); transition:transform .35s ease; z-index:1000; font-size:0.85rem; }
  .toast.show { transform:translateX(0); }
  .toast.error { background: var(--error); }
  .badge-link { font-size:0.7rem; opacity:0.6; margin-top:0.2rem; }
  .quota-bar-wrap { width:100%; height:14px; border-radius:8px; background: rgba(108,92,231,0.12); overflow:hidden; }
  .quota-bar { height:100%; background: var(--primary); transition: width .3s ease, background .3s ease; }
  .quota-bar.danger { background: var(--error); }
  .pill.neutral { background: rgba(120,120,120,0.15); color:#888; }
`

export function dashboardPage(): Response {
  const body = `
  <div class="dash-wrap">
    <div class="dash-header">
      <h1>🛡️ پنل مدیریت BNDMAX VPN</h1>
      <button class="btn" id="logoutBtn" style="background:var(--error);">خروج</button>
    </div>

    <div class="tabs">
      <button class="tab-btn active" data-tab="overview">📊 نمای کلی</button>
      <button class="tab-btn" data-tab="users">👥 کاربران</button>
      <button class="tab-btn" data-tab="botusers">📇 لیست ورودی‌های ربات</button>
      <button class="tab-btn" data-tab="trial">🎁 تنظیمات تست</button>
      <button class="tab-btn" data-tab="quota">⚡ محدودیت مصرف کلادفلر</button>
      <button class="tab-btn" data-tab="pool">🖧 پنل‌ها / اکانت‌های کلادفلر</button>
      <button class="tab-btn" data-tab="telegram">🤖 ربات تلگرام</button>
      <button class="tab-btn" data-tab="security">🔒 امنیت</button>
    </div>

    <div class="tab-panel active" id="tab-overview">
      <div class="stat-grid" id="statGrid"><div class="glass stat-card">…</div></div>

      <div class="glass" style="margin-bottom:1.2rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.6rem; margin-bottom:0.6rem;">
          <h3>⚡ مصرف امروز از سقف روزانه کلادفلر</h3>
          <span class="pill" id="serviceStatusPill">…</span>
        </div>
        <div class="quota-bar-wrap"><div class="quota-bar" id="quotaBarFill" style="width:0%"></div></div>
        <p style="font-size:0.8rem; opacity:0.75; margin-top:0.5rem;" id="quotaText">در حال بارگذاری…</p>
        <div style="display:flex; gap:0.6rem; flex-wrap:wrap; margin-top:0.6rem;">
          <button class="btn" style="background:var(--error);" id="pauseBtn">⏸️ قطع موقت همه اتصالات</button>
          <button class="btn" id="resumeBtn">▶️ وصل کردن مجدد</button>
        </div>
      </div>

      <div class="glass">
        <h3 style="margin-bottom:0.8rem;">آدرس‌های ثابت مالک (env.UUID)</h3>
        <p style="font-size:0.85rem; opacity:0.75;">این‌ها همیشه فعال و بدون محدودیت حجم/زمان هستند و از متغیر UUID در wrangler.toml خوانده می‌شوند.</p>
      </div>
    </div>

    <div class="tab-panel" id="tab-users">
      <div class="glass" style="margin-bottom:1.2rem;">
        <h3 style="margin-bottom:0.8rem;">➕ افزودن اشتراک پرو</h3>
        <form class="settings-form" id="proForm">
          <div class="grid2">
            <div class="field"><label>آیدی عددی تلگرام کاربر</label><input type="text" id="proTelegramId" placeholder="مثلاً 123456789" required /></div>
            <div class="field"><label>نام/یوزرنیم (اختیاری)</label><input type="text" id="proTelegramName" placeholder="@username" /></div>
            <div class="field"><label>مدت اعتبار (روز)</label><input type="number" id="proDays" value="30" min="1" required /></div>
            <div class="field"><label>حجم (گیگابایت)</label><input type="number" id="proVolume" value="50" min="1" required /></div>
          </div>
          <button class="btn btn-vip" type="submit">🎖️ ساخت اشتراک پرو</button>
        </form>
        <p style="font-size:0.75rem; opacity:0.6; margin-top:0.5rem;">در صورت ثبت آیدی تلگرام، لینک اشتراک به‌صورت خودکار برای کاربر ارسال می‌شود (اگر ربات متصل باشد).</p>
      </div>

      <div class="glass table-wrap">
        <h3 style="margin-bottom:0.8rem;">لیست کاربران</h3>
        <table id="usersTable">
          <thead><tr><th>UUID</th><th>تلگرام</th><th>نوع</th><th>وضعیت</th><th>مصرف</th><th>انقضا</th><th>عملیات</th></tr></thead>
          <tbody><tr><td colspan="7">در حال بارگذاری…</td></tr></tbody>
        </table>
      </div>
    </div>

    <div class="tab-panel" id="tab-botusers">
      <div class="glass table-wrap">
        <h3 style="margin-bottom:0.8rem;">📇 هر کسی که وارد ربات شده</h3>
        <p style="font-size:0.8rem; opacity:0.7; margin-bottom:0.8rem;">این لیست شامل همه کسانی است که تاکنون به ربات پیام داده‌اند، حتی اگر هنوز اشتراکی دریافت نکرده باشند.</p>
        <table id="botUsersTable">
          <thead><tr><th>آیدی تلگرام</th><th>نام/یوزرنیم</th><th>اولین بازدید</th><th>آخرین بازدید</th><th>تعداد پیام</th></tr></thead>
          <tbody><tr><td colspan="5">در حال بارگذاری…</td></tr></tbody>
        </table>
      </div>
    </div>

    <div class="tab-panel" id="tab-trial">
      <div class="glass">
        <h3 style="margin-bottom:1rem;">تنظیمات اشتراک تست</h3>
        <form class="settings-form" id="trialForm">
          <div class="field"><label>مدت اعتبار تست (ساعت)</label><input type="number" id="trialDuration" min="1" required /></div>
          <div class="field"><label>حجم تست (مگابایت)</label><input type="number" id="trialVolume" min="1" required /></div>
          <div class="field"><label>فاصله زمانی مجاز برای دریافت تست بعدی (ساعت)</label><input type="number" id="trialCooldown" min="1" required /></div>
          <div class="field"><label>اعلان مصرف هر چند مگابایت به کاربر ارسال شود</label><input type="number" id="notifyStepMb" min="1" required /></div>
          <button class="btn" type="submit">💾 ذخیره تنظیمات</button>
        </form>
      </div>

      <div class="glass" style="margin-top:1.2rem;">
        <h3 style="margin-bottom:0.6rem;">🎁 جایزه ماهانه ویژه VIP</h3>
        <p style="font-size:0.8rem; opacity:0.7; margin-bottom:0.8rem;">
          کاربران VIP فعال می‌توانند هر ۳۰ روز یک‌بار از داخل ربات (دکمه «🎁 جایزه ویژه VIP») این لینک را به‌عنوان جایزه دریافت کنند. یک لینک ساب/کانفیگ معتبر ۱ ماهه اینجا وارد کنید.
        </p>
        <form class="settings-form" id="wikiGiftForm">
          <div class="field"><label>لینک جایزه (ساب یا کانفیگ)</label><input type="text" id="wikiGiftLink" placeholder="https://..." /></div>
          <button class="btn" type="submit">💾 ذخیره لینک جایزه</button>
        </form>
      </div>
    </div>

    <div class="tab-panel" id="tab-quota">
      <div class="glass" style="margin-bottom:1.2rem;">
        <h3 style="margin-bottom:0.6rem;">⚡ سقف درخواست روزانه</h3>
        <p style="font-size:0.8rem; opacity:0.7; margin-bottom:0.8rem;">
          پلن رایگان کلادفلر ورکرز روزانه ۱۰۰٬۰۰۰ درخواست را مجاز می‌داند. برای اینکه هیچ‌وقت به این سقف نخورید و ورکر مسدود/محدود نشود،
          یک سقف خودمانی (کمتر از سقف واقعی) تعیین کنید؛ با رسیدن مصرف به این سقف، در صورت فعال بودن «توقف خودکار»، اتصالات جدید تا روز بعد یا تا وصل مجدد دستی، پذیرفته نمی‌شوند.
        </p>
        <form class="settings-form" id="quotaForm">
          <div class="field"><label>سقف روزانه (تعداد اتصال/درخواست)</label><input type="number" id="dailyLimit" min="100" required /></div>
          <div class="field" style="display:flex; align-items:center; gap:0.5rem;">
            <input type="checkbox" id="autoPause" style="width:auto;" />
            <label for="autoPause" style="margin:0;">توقف خودکار سرویس هنگام رسیدن به سقف</label>
          </div>
          <button class="btn" type="submit">💾 ذخیره تنظیمات</button>
        </form>
      </div>
    </div>

    <div class="tab-panel" id="tab-pool">
      <div class="glass" style="margin-bottom:1.2rem;">
        <h3 style="margin-bottom:0.6rem;">🔑 رمز اتصال این ورکر</h3>
        <p style="font-size:0.8rem; opacity:0.7; margin-bottom:0.6rem;">
          این رمز مخصوص همین ورکر است. آن را همراه آدرس همین ورکر به هر اکانت دیگری بدهید تا بتواند این ورکر را به لیست
          اکانت‌های خودش اضافه کند و کانفیگ/کاربرانش را با آن هماهنگ کند — بدون نیاز به هیچ توکن یا شناسه‌ای از کلادفلر.
        </p>
        <div class="grid2">
          <div class="field"><label>آدرس همین ورکر</label><input type="text" id="mySyncUrl" readonly /></div>
          <div class="field"><label>رمز اتصال</label><input type="text" id="mySyncSecret" readonly /></div>
        </div>
        <button class="btn" id="copySyncBtn" type="button">📋 کپی آدرس + رمز</button>
        <button class="btn" id="regenSyncBtn" type="button" style="margin-inline-start:0.5rem;">🔄 تولید رمز جدید</button>
      </div>

      <div class="glass" style="margin-bottom:1.2rem;">
        <h3 style="margin-bottom:0.6rem;">🖧 پنل‌ها / اکانت‌های کلادفلر</h3>
        <p style="font-size:0.8rem; opacity:0.7; margin-bottom:0.8rem;">
          برای افزودن یک ورکر روی اکانت کلادفلر دیگر: فقط «آدرس ورکر» و همان «رمز اتصال ورکر» را که از تب پنل‌های همان
          ورکر (بخش بالا، روی آن اکانت) کپی کرده‌اید وارد کنید — نیازی به توکن کلادفلر، Account ID یا Database ID نیست.
          کاربران VIP و بررسی سلامت به‌صورت خودکار و مستقیم بین دو ورکر رد و بدل می‌شود.
        </p>
        <form class="settings-form" id="poolAddForm" style="margin-bottom:1rem;">
          <div class="grid2">
            <div class="field"><label>آدرس ورکر *</label><input type="text" id="poolUrl" placeholder="my-worker-2.username.workers.dev" required /></div>
            <div class="field"><label>برچسب (اختیاری)</label><input type="text" id="poolLabel" placeholder="اکانت ۲" /></div>
          </div>
          <div class="field"><label>رمز اتصال ورکر مقصد (از تب پنل‌های همان ورکر)</label><input type="text" id="poolSyncSecret" placeholder="رمز اتصال آن ورکر را اینجا بچسبانید" /></div>
          <details style="margin:0.6rem 0;">
            <summary style="cursor:pointer; font-size:0.85rem; opacity:0.85;">روش قدیمی‌تر با توکن کلادفلر (اختیاری، فقط اگر رمز اتصال بالا را ندارید)</summary>
            <div class="grid2" style="margin-top:0.6rem;">
              <div class="field"><label>Cloudflare Account ID</label><input type="text" id="poolAccountId" placeholder="Account ID" /></div>
              <div class="field"><label>Cloudflare API Token</label><input type="password" id="poolApiToken" placeholder="API Token" /></div>
              <div class="field"><label>D1 Database ID (همان اکانت)</label><input type="text" id="poolDatabaseId" placeholder="Database ID" /></div>
              <div class="field"><label>نام اسکریپت ورکر روی آن اکانت</label><input type="text" id="poolScriptName" placeholder="my-vpn" /></div>
            </div>
          </details>
          <button class="btn" type="submit">➕ افزودن اکانت</button>
        </form>

        <div class="grid2" style="margin-bottom:1rem;">
          <div class="field"><label>اندازه هر گروه فعال (batch size)</label><input type="number" id="poolBatchSize" min="1" required /></div>
          <div class="field"><label>مدت استراحت هر گروه (روز)</label><input type="number" id="poolRestDays" min="1" required /></div>
        </div>
        <button class="btn" id="poolSettingsSaveBtn" type="button">💾 ذخیره تنظیمات چرخش</button>
        <button class="btn" id="poolCheckAllBtn" type="button" style="margin-inline-start:0.5rem;">🩺 بررسی سلامت همه اکانت‌ها</button>

        <div class="table-wrap" style="margin-top:1.2rem;">
          <table id="poolTable">
            <thead><tr><th>آدرس</th><th>برچسب</th><th>سلامت اکانت</th><th>وضعیت چرخش</th><th>فعال/غیرفعال</th><th>عملیات</th></tr></thead>
            <tbody><tr><td colspan="6">در حال بارگذاری…</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="tab-panel" id="tab-telegram">
      <div class="glass">
        <h3 style="margin-bottom:1rem;">اتصال ربات تلگرام</h3>
        <form class="settings-form" id="tgForm">
          <div class="field"><label>توکن ربات (از BotFather)</label><input type="text" id="tgToken" placeholder="123456:ABC-..." /></div>
          <div class="field"><label>آیدی عددی ادمین تلگرام</label><input type="text" id="tgAdminId" placeholder="مثلاً 123456789" /></div>
          <div class="field"><label>یوزرنیم ادمین (بدون @)</label><input type="text" id="tgAdminUsername" placeholder="vahidekhlasi" /></div>
          <div class="field"><label>یوزرنیم کانال اجباری (با @)</label><input type="text" id="requiredChannel" placeholder="@donatewirepubg" /></div>
          <div class="field"><label>لینک دعوت کانال</label><input type="text" id="requiredChannelUrl" placeholder="https://t.me/donatewirepubg" /></div>
          <div style="display:flex; gap:0.6rem; flex-wrap:wrap;">
            <button class="btn" type="submit">💾 ذخیره تنظیمات</button>
            <button class="btn btn-sub" type="button" id="setWebhookBtn">🔗 فعال‌سازی Webhook</button>
          </div>
        </form>
        <p class="badge-link">آیدی عددی خودت رو می‌تونی با پیام دادن به ربات @userinfobot در تلگرام پیدا کنی.</p>
        <p class="badge-link">⚠️ برای اینکه ربات بتواند عضویت کاربران در کانال را چک کند، باید ربات را به‌عنوان ادمین کانال اضافه کنید.</p>
      </div>
    </div>

    <div class="tab-panel" id="tab-security">
      <div class="glass">
        <h3 style="margin-bottom:1rem;">تغییر رمز عبور داشبورد</h3>
        <form class="settings-form" id="pwForm">
          <div class="field"><label>رمز عبور فعلی</label><input type="password" id="curPw" required /></div>
          <div class="field"><label>رمز عبور جدید</label><input type="password" id="newPw" required minlength="6" /></div>
          <button class="btn" type="submit">🔒 تغییر رمز</button>
        </form>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
  (function() {
    const toast = document.getElementById('toast');
    function showToast(msg, isErr) {
      toast.textContent = msg;
      toast.className = 'toast' + (isErr ? ' error' : '') + ' show';
      clearTimeout(toast._t);
      toast._t = setTimeout(() => toast.classList.remove('show'), 3000);
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });

    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await fetch('/api/admin/logout', { method: 'POST' });
      location.href = '/admin/login';
    });

    async function api(path, opts) {
      const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
      if (res.status === 401) { location.href = '/admin/login'; throw new Error('unauthorized'); }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'خطا');
      return data;
    }

    function fmtMb(mb) { return mb >= 1024 ? (mb/1024).toFixed(2) + ' GB' : Math.round(mb) + ' MB'; }
    function fmtDate(ts) { return ts ? new Date(ts).toLocaleString('fa-IR') : 'نامحدود'; }

    async function loadOverview() {
      const data = await api('/api/admin/stats');
      const grid = document.getElementById('statGrid');
      grid.innerHTML = [
        ['کل کاربران', data.total],
        ['فعال', data.active],
        ['تست', data.trial],
        ['پرو', data.pro],
        ['منقضی/غیرفعال', data.inactive],
        ['کل مصرف', fmtMb(data.totalUsageMb)],
      ].map(([lbl, num]) => '<div class="glass stat-card"><div class="num">' + num + '</div><div class="lbl">' + lbl + '</div></div>').join('');
    }

    async function loadUsers() {
      const data = await api('/api/admin/users');
      const tbody = document.querySelector('#usersTable tbody');
      if (!data.users.length) { tbody.innerHTML = '<tr><td colspan="7">کاربری ثبت نشده</td></tr>'; return; }
      tbody.innerHTML = data.users.map(u => {
        const usage = u.volume_limit_mb > 0 ? fmtMb(u.volume_used_mb) + ' / ' + fmtMb(u.volume_limit_mb) : fmtMb(u.volume_used_mb) + ' / نامحدود';
        return '<tr>' +
          '<td style="font-family:monospace;font-size:0.7rem;">' + u.uuid.slice(0,8) + '…</td>' +
          '<td>' + (u.telegram_name || u.telegram_id || '-') + '</td>' +
          '<td><span class="pill ' + u.type + '">' + (u.type === 'pro' ? 'پرو' : 'تست') + '</span></td>' +
          '<td><span class="pill ' + u.status + '">' + (u.status === 'active' ? 'فعال' : u.status === 'expired' ? 'منقضی' : 'غیرفعال') + '</span></td>' +
          '<td>' + usage + '</td>' +
          '<td style="font-size:0.72rem;">' + fmtDate(u.expires_at) + '</td>' +
          '<td class="row-actions">' +
            '<button data-act="toggle" data-uuid="' + u.uuid + '" data-status="' + u.status + '">' + (u.status === 'active' ? 'غیرفعال' : 'فعال') + '</button>' +
            '<button data-act="extend" data-uuid="' + u.uuid + '">+۳۰ روز</button>' +
            '<button class="danger" data-act="delete" data-uuid="' + u.uuid + '">حذف</button>' +
          '</td>' +
        '</tr>';
      }).join('');

      tbody.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', async () => {
          const act = btn.dataset.act, uuid = btn.dataset.uuid;
          try {
            if (act === 'toggle') {
              const next = btn.dataset.status === 'active' ? 'disabled' : 'active';
              await api('/api/admin/users/' + uuid, { method: 'PATCH', body: JSON.stringify({ status: next }) });
            } else if (act === 'extend') {
              await api('/api/admin/users/' + uuid + '/extend', { method: 'POST', body: JSON.stringify({ days: 30 }) });
            } else if (act === 'delete') {
              if (!confirm('حذف این کاربر قطعی است. ادامه می‌دهید؟')) return;
              await api('/api/admin/users/' + uuid, { method: 'DELETE' });
            }
            showToast('انجام شد');
            loadUsers(); loadOverview();
          } catch (e) { showToast(e.message, true); }
        });
      });
    }

    document.getElementById('proForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/admin/users/pro', { method: 'POST', body: JSON.stringify({
          telegramId: document.getElementById('proTelegramId').value,
          telegramName: document.getElementById('proTelegramName').value,
          days: Number(document.getElementById('proDays').value),
          volumeGb: Number(document.getElementById('proVolume').value),
        })});
        showToast('اشتراک پرو ساخته شد');
        e.target.reset();
        loadUsers(); loadOverview();
      } catch (e) { showToast(e.message, true); }
    });

    async function loadTrialSettings() {
      const data = await api('/api/admin/settings');
      document.getElementById('trialDuration').value = data.trial_duration_hours;
      document.getElementById('trialVolume').value = data.trial_volume_mb;
      document.getElementById('trialCooldown').value = data.trial_cooldown_hours;
      document.getElementById('notifyStepMb').value = data.usage_notify_step_mb || '400';
      document.getElementById('tgToken').value = data.telegram_bot_token || '';
      document.getElementById('tgAdminId').value = data.telegram_admin_id || '';
      document.getElementById('tgAdminUsername').value = data.telegram_admin_username || '';
      document.getElementById('requiredChannel').value = data.required_channel || '';
      document.getElementById('requiredChannelUrl').value = data.required_channel_url || '';
      document.getElementById('wikiGiftLink').value = data.wiki_gift_link || '';
    }

    document.getElementById('trialForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({
          trial_duration_hours: document.getElementById('trialDuration').value,
          trial_volume_mb: document.getElementById('trialVolume').value,
          trial_cooldown_hours: document.getElementById('trialCooldown').value,
          usage_notify_step_mb: document.getElementById('notifyStepMb').value,
        })});
        showToast('تنظیمات ذخیره شد');
      } catch (e) { showToast(e.message, true); }
    });

    document.getElementById('wikiGiftForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({
          wiki_gift_link: document.getElementById('wikiGiftLink').value,
        })});
        showToast('لینک جایزه ذخیره شد');
      } catch (e) { showToast(e.message, true); }
    });

    // ---------- Requirement #3: quota + kill switch ----------
    async function loadQuota() {
      const q = await api('/api/admin/quota');
      const pct = q.limit > 0 ? Math.min(100, (q.count / q.limit) * 100) : 0;
      const fill = document.getElementById('quotaBarFill');
      fill.style.width = pct + '%';
      fill.className = 'quota-bar' + (pct >= 90 ? ' danger' : '');
      document.getElementById('quotaText').textContent =
        q.count.toLocaleString('fa-IR') + ' از ' + q.limit.toLocaleString('fa-IR') + ' اتصال امروز (' + pct.toFixed(1) + '٪) — تاریخ: ' + q.date;
      const pill = document.getElementById('serviceStatusPill');
      pill.textContent = q.paused ? '⏸️ متوقف شده' : '✅ فعال';
      pill.className = 'pill ' + (q.paused ? 'expired' : 'active');
      document.getElementById('dailyLimit').value = q.limit;
      document.getElementById('autoPause').checked = q.autoPause;
    }

    document.getElementById('pauseBtn').addEventListener('click', async () => {
      try { await api('/api/admin/quota/pause', { method: 'POST' }); showToast('همه اتصالات موقتاً قطع شدند'); loadQuota(); }
      catch (e) { showToast(e.message, true); }
    });
    document.getElementById('resumeBtn').addEventListener('click', async () => {
      try { await api('/api/admin/quota/resume', { method: 'POST' }); showToast('اتصالات وصل شدند'); loadQuota(); }
      catch (e) { showToast(e.message, true); }
    });

    document.getElementById('quotaForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/admin/quota', { method: 'POST', body: JSON.stringify({
          dailyLimit: Number(document.getElementById('dailyLimit').value),
          autoPause: document.getElementById('autoPause').checked,
        })});
        showToast('تنظیمات ذخیره شد');
        loadQuota();
      } catch (e) { showToast(e.message, true); }
    });

    // ---------- Simple worker-to-worker sync secret (this worker's own) ----------
    async function loadSyncSecret() {
      try {
        const data = await api('/api/admin/sync-secret');
        document.getElementById('mySyncUrl').value = window.location.host;
        document.getElementById('mySyncSecret').value = data.secret;
      } catch (e) { showToast(e.message, true); }
    }
    document.getElementById('copySyncBtn').addEventListener('click', () => {
      const text = document.getElementById('mySyncUrl').value + '  —  ' + document.getElementById('mySyncSecret').value;
      navigator.clipboard.writeText(text).then(() => showToast('کپی شد')).catch(() => showToast('کپی نشد', true));
    });
    document.getElementById('regenSyncBtn').addEventListener('click', async () => {
      if (!confirm('با تولید رمز جدید، اکانت‌هایی که رمز قبلی را دارند دیگر نمی‌توانند به این ورکر وصل شوند مگر رمز جدید را به آن‌ها هم بدهید. ادامه می‌دهید؟')) return;
      try {
        await api('/api/admin/sync-secret/regenerate', { method: 'POST' });
        loadSyncSecret();
        showToast('رمز جدید ساخته شد');
      } catch (e) { showToast(e.message, true); }
    });

    // ---------- Requirement #4 + #1(3rd batch): backend worker pool / multi-account ----------
    function healthPill(w) {
      if (w.health_status === 'healthy') return '<span class="pill active">🟢 سالم</span>';
      if (w.health_status === 'unhealthy') return '<span class="pill" style="background:#5a1f1f;color:#ffb3b3;" title="' + (w.last_error || '') + '">🔴 مشکل‌دار</span>';
      return '<span class="pill neutral">⚪ بررسی‌نشده</span>';
    }
    async function loadPool() {
      const data = await api('/api/admin/pool');
      document.getElementById('poolBatchSize').value = data.batchSize || '5';
      document.getElementById('poolRestDays').value = data.restDays || '1';
      const tbody = document.querySelector('#poolTable tbody');
      if (!data.pool.length) { tbody.innerHTML = '<tr><td colspan="6">هنوز اکانتی اضافه نشده — کانفیگ‌های VIP روی همین ورکر باقی می‌مانند</td></tr>'; return; }
      tbody.innerHTML = data.pool.map(w =>
        '<tr>' +
          '<td style="font-family:monospace; font-size:0.75rem;">' + w.hostname + '</td>' +
          '<td>' + (w.label || '-') + '</td>' +
          '<td>' + healthPill(w) + '</td>' +
          '<td><span class="pill ' + (w.enabled && w.active ? 'active' : 'neutral') + '">' + (!w.enabled ? 'غیرفعال' : (w.active ? '🟢 فعال' : '😴 استراحت')) + '</span></td>' +
          '<td><button data-act="toggle" data-id="' + w.id + '" data-enabled="' + w.enabled + '">' + (w.enabled ? 'غیرفعال کن' : 'فعال کن') + '</button></td>' +
          '<td class="row-actions">' +
            '<button data-act="check" data-id="' + w.id + '">🩺 بررسی سلامت</button>' +
            '<button class="danger" data-act="delete" data-id="' + w.id + '">حذف</button>' +
          '</td>' +
        '</tr>'
      ).join('');
      tbody.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id, act = btn.dataset.act;
          try {
            if (act === 'toggle') {
              await api('/api/admin/pool/' + id, { method: 'PATCH', body: JSON.stringify({ enabled: btn.dataset.enabled !== 'true' }) });
            } else if (act === 'delete') {
              if (!confirm('این اکانت از استخر حذف شود؟')) return;
              await api('/api/admin/pool/' + id, { method: 'DELETE' });
            } else if (act === 'check') {
              btn.disabled = true; btn.textContent = 'در حال بررسی…';
              await api('/api/admin/pool/' + id + '/check', { method: 'POST' });
            }
            showToast('انجام شد');
            loadPool();
          } catch (e) { showToast(e.message, true); }
        });
      });
    }

    document.getElementById('poolAddForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/admin/pool', { method: 'POST', body: JSON.stringify({
          url: document.getElementById('poolUrl').value,
          label: document.getElementById('poolLabel').value,
          syncSecret: document.getElementById('poolSyncSecret').value,
          cfAccountId: document.getElementById('poolAccountId').value,
          cfApiToken: document.getElementById('poolApiToken').value,
          cfDatabaseId: document.getElementById('poolDatabaseId').value,
          cfScriptName: document.getElementById('poolScriptName').value,
        })});
        showToast('اکانت اضافه شد');
        e.target.reset();
        loadPool();
      } catch (e) { showToast(e.message, true); }
    });

    document.getElementById('poolSettingsSaveBtn').addEventListener('click', async () => {
      try {
        await api('/api/admin/pool/settings', { method: 'POST', body: JSON.stringify({
          batchSize: Number(document.getElementById('poolBatchSize').value),
          restDays: Number(document.getElementById('poolRestDays').value),
        })});
        showToast('تنظیمات چرخش ذخیره شد');
        loadPool();
      } catch (e) { showToast(e.message, true); }
    });

    document.getElementById('poolCheckAllBtn').addEventListener('click', async (e) => {
      const btn = e.target;
      btn.disabled = true; const orig = btn.textContent; btn.textContent = 'در حال بررسی همه…';
      try {
        await api('/api/admin/pool/check-all', { method: 'POST' });
        showToast('بررسی سلامت انجام شد');
        loadPool();
      } catch (e) { showToast(e.message, true); }
      finally { btn.disabled = false; btn.textContent = orig; }
    });

    async function loadBotUsers() {
      const data = await api('/api/admin/bot-users');
      const tbody = document.querySelector('#botUsersTable tbody');
      if (!data.botUsers.length) { tbody.innerHTML = '<tr><td colspan="5">هنوز کسی وارد ربات نشده</td></tr>'; return; }
      tbody.innerHTML = data.botUsers.map(u =>
        '<tr>' +
          '<td style="font-family:monospace;">' + u.telegram_id + '</td>' +
          '<td>' + (u.telegram_name || '-') + '</td>' +
          '<td style="font-size:0.72rem;">' + fmtDate(u.first_seen) + '</td>' +
          '<td style="font-size:0.72rem;">' + fmtDate(u.last_seen) + '</td>' +
          '<td>' + u.messages + '</td>' +
        '</tr>'
      ).join('');
    }

    document.getElementById('tgForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({
          telegram_bot_token: document.getElementById('tgToken').value,
          telegram_admin_id: document.getElementById('tgAdminId').value,
          telegram_admin_username: document.getElementById('tgAdminUsername').value,
          required_channel: document.getElementById('requiredChannel').value,
          required_channel_url: document.getElementById('requiredChannelUrl').value,
        })});
        showToast('تنظیمات ربات ذخیره شد');
      } catch (e) { showToast(e.message, true); }
    });

    document.getElementById('setWebhookBtn').addEventListener('click', async () => {
      try {
        const data = await api('/api/admin/telegram/set-webhook', { method: 'POST' });
        showToast(data.ok ? 'Webhook فعال شد ✅' : 'خطا در فعال‌سازی Webhook', !data.ok);
      } catch (e) { showToast(e.message, true); }
    });

    document.getElementById('pwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/admin/change-password', { method: 'POST', body: JSON.stringify({
          currentPassword: document.getElementById('curPw').value,
          newPassword: document.getElementById('newPw').value,
        })});
        showToast('رمز عبور تغییر کرد');
        e.target.reset();
      } catch (e) { showToast(e.message, true); }
    });

    loadOverview(); loadUsers(); loadBotUsers(); loadTrialSettings(); loadQuota(); loadPool(); loadSyncSecret();
  })();
  </script>`
  return new Response(shell('پنل مدیریت | BNDMAX VPN', body, dashboardStyle), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
