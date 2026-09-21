# v16 — DB self-heal + Vahid scanner port fix

- **Runtime schema self-heal** (`src/db/ensure-schema.ts`): the Worker now creates any missing
  table / column / unique index (`clean_ips`, `dns_rules`, `backend_pool.country`, ...) itself,
  once per isolate, without touching existing data. Fixes the "خطا" in کانفیگ‌های کاربر, اسکنر وحید,
  اسکن دستی and «افزودن به لیست سرورهای کاربران» on databases that were deployed before those
  features existed and never received the build-time migrations.
- **Real error messages**: `/api/admin/*` exceptions are now returned as JSON
  (`خطای سرور/دیتابیس: ...`) instead of the HTML error page, so the dashboard shows the actual cause.
- **اسکنر وحید ports**: latency is now measured on each open port that was ticked and the fastest
  one is reported (previously always timed/reported 443). Fixed in both the browser scanner
  (`src/pages/admin.ts`) and `src/services/vahid-scanner.ts`.
