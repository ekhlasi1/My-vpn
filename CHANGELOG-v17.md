# v17 — Scanner works with zero setup + SOCKS4 scan no longer risks D1

- **Scan SNI domain no longer needs a domain you own.** `resolveScanDomain()` (`src/api/admin.ts`)
  used to fall back to whatever host the admin happened to be browsing the dashboard on, which
  meant scans against a `*.workers.dev` deployment (or any custom domain not yet actually proxied
  through Cloudflare) always came back "ناموفق" no matter how good the candidate IP was. That
  restriction was never really there: Cloudflare's edge routes a `resolveOverride`'d request purely
  by TLS SNI / HTTP Host, regardless of whose Cloudflare account the matching zone belongs to. The
  scanner now defaults to a well-known public Cloudflare-fronted domain (`farsroid.com`) when
  "دامنه تست اسکنر" is left empty, so اسکن دستی, Radar, اسکنر وحید and «تست پینگ» in کانفیگ‌های
  کاربر all work immediately after deploy — no custom domain required. The setting is still there
  for anyone who wants to point it at a different domain.
- **SOCKS4 proxy-health scan (`scanSocks4`) is now sequential.** It's the one scan mode that still
  has to open a raw `cloudflare:sockets` connection (SOCKS4 can't be tested through `fetch()`), so
  running it at the old shared concurrency risked exactly the "پروکسی اسکن محدودیت خورد و ارتباط با
  سرور/دیتابیس قطع شد" symptom the TLS/SNI scan was already fixed for. It now runs one socket at a
  time — fully opened, used, and closed before the next dial — with a short pause between attempts,
  so it can never compete with an in-flight D1 query for the same connection budget.
