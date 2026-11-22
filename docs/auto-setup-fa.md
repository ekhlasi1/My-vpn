# نصب کاملاً خودکار (دیتابیس + جدول‌ها)

هدف: بعد از اینکه پروژه به GitHub رسید، **بدون هیچ دستور دستی** دیتابیس D1 ساخته شود، جدول‌ها ساخته شوند و ورکر آمادهٔ کار باشد.

## چه چیزی خودکار است؟

| مرحله | چه کسی انجام می‌دهد | کِی |
|---|---|---|
| ساخت دیتابیس `bndmax-vpn-db` (اگر نبود) و نوشتن `database_id` در `wrangler.toml` | `scripts/ci-setup.js` | هر build |
| اجرای `schema.sql` و `migration-v*.sql` | `scripts/ci-setup.js` | هر build |
| ساخت جدول‌ها / ایندکس‌ها / ستون‌های جاافتاده / تنظیمات پیش‌فرض (در صورتی که مرحلهٔ بالا شکست خورده باشد) | `src/db/bootstrap.ts` داخل خود ورکر | اولین درخواست |
| دیپلوی و بررسی `/health` | `.github/workflows/deploy.yml` | هر push |

همهٔ مراحل idempotent هستند: اجرای دوباره چیزی را خراب یا پاک نمی‌کند و دیتابیس موجود دوباره استفاده می‌شود.

## تنها کار یک‌باره (کلادفلر اجازهٔ حذفش را نمی‌دهد)

ساخت دیتابیس نیاز به اجازه دارد؛ هیچ کدی نمی‌تواند بدون توکن این اجازه را برای خودش بگیرد. پس یک بار:

1. توکن بسازید: Cloudflare → My Profile → API Tokens → Create Token  
   دسترسی‌ها: **Account → Workers Scripts → Edit** و **Account → D1 → Edit**
2. در GitHub: Settings → Secrets and variables → Actions → دو secret بسازید:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
3. یک commit به `main` بزنید (یا Actions → Deploy to Cloudflare → Run workflow).

تمام. از این به بعد هر push خودکار دیپلوی می‌شود.

> اگر دامنهٔ اختصاصی دارید و `workers.dev` غیرفعال است، یک **Variable** به نام `WORKER_URL` (مثلاً `https://vpn.example.com`) در همان صفحه بسازید تا بررسی `/health` بداند کجا را چک کند.

## اگر به‌جای GitHub Actions از Cloudflare Workers Builds استفاده می‌کنید

همان `npm run build` اجرا می‌شود و همین کار را می‌کند. فقط مطمئن شوید توکن build دسترسی **D1: Edit** دارد. فایل `deploy.yml` بدون secret خودش را رد می‌کند، پس تداخلی پیش نمی‌آید (ولی هر دو را با هم فعال نکنید).

## اگر خطا دادند

- **Build با پیام `could not prepare the D1 database` شکست خورد:** پیام دقیقاً می‌گوید چه دسترسی‌ای کم است؛ معمولاً `D1: Edit` یا `CLOUDFLARE_ACCOUNT_ID`.
- **مرحلهٔ Health check قرمز شد:** `https://آدرس-شما/health` را باز کنید؛ علت دقیق (بدون هیچ رمزی) آنجا نوشته می‌شود.
- **می‌خواهید خودتان دیتابیس را مدیریت کنید:** متغیر محیطی `CI_SETUP_SKIP=1` را بگذارید و `database_id` را دستی در `wrangler.toml` بنویسید.

رمز پیش‌فرض داشبورد در `FIXES-fa.md` آمده؛ بعد از اولین ورود حتماً عوضش کنید.
