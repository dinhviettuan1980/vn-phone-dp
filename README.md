# Vietnam Phone Intelligence Data Platform (Phase 1)

A data platform, not a CRUD app. The asset is the **phone intelligence
database + raw evidence + provenance** — not a UI. See
`IMPLEMENTATION_PLAN.md` for scope and `docs/architecture.md` for design
decisions (start there if you're wondering "why is X built this way").

```
SOURCE REGISTRY -> RAW ACQUISITION -> RAW EVIDENCE (immutable)
   -> PHONE EXTRACTOR -> PHONE OBSERVATION -> PHONE NORMALIZER
   -> PHONE NUMBER (canonical) -> INTELLIGENCE AGGREGATION -> LOOKUP API
```

Raw data is never overwritten. A phone number can have many observations
across many sources, and many (possibly conflicting) identity claims — see
`docs/architecture.md` for why.

## Trạng thái dự án (cập nhật gần nhất: 2026-09-03)

*Đọc phần này trước nếu tiếp tục làm việc trên project — tóm tắt để không
mất context giữa các phiên làm việc.*

**Việc đã xong:**
- Phase 1 đầy đủ theo `IMPLEMENTATION_PLAN.md`: schema, normalizer, extractor,
  crawler framework, aggregation, API, Docker Compose, seed pipeline, test.
- Dev DB + production đều chạy trên VPS `103.163.216.32` (không dùng Docker
  Postgres/local) — chi tiết trong `docs/architecture.md` mục "Remote dev
  database".
- API + FE đã deploy live: **API** pm2 `phoneintel-api` (port 8037 nội bộ),
  **FE tra cứu** tại **https://vn-phone.tuandv.id.vn** (nginx proxy `/api/*`,
  SSL certbot). Cả 2 cùng redeploy qua `~/deploy-vn-phone-dp.sh` (auto-deploy
  cron 2 phút trên VPS, xem `apps/web/`).
- **36 nguồn dữ liệu** trong `services/crawler/config/sources.yaml` (3
  fixture demo + 29 ngân hàng/tổ chức tín dụng + 4 cơ quan nhà nước) →
  **255 số điện thoại thật** đã crawl (không tính fixture). Ưu tiên hiện tại
  theo yêu cầu user: **ngân hàng & tổ chức tín dụng trước (càng nhiều càng
  tốt), sau đó mới đến cơ quan chính phủ.**
  - Đã crawl (29): Vietcombank, VietinBank, BIDV, Techcombank, VPBank,
    HDBank, VIB, SeABank, MoMo, Cake, TNEX, Agribank, ACB, Sacombank,
    Eximbank, OCB, LPBank, MSB, Nam A Bank, FE Credit, Home Credit,
    HD Saison, BVBank, PVcomBank, VietABank, Bac A Bank, Kienlongbank,
    Saigonbank, Vietbank; SBV, Tổng cục Thuế, Bảo hiểm Xã hội, Cổng Dịch vụ
    công Quốc gia (4 cơ quan nhà nước, mới bắt đầu).
  - Loại trừ có chủ đích (chặn bot xác nhận qua robots.txt và/hoặc trang
    thật, không spoof UA/giải JS challenge để né): MB Bank, TPBank, Mcredit,
    SHB, NCB, PGBank — xem comment đầu mỗi wave trong `sources.yaml` để biết
    lý do từng cái.
  - **Việc tiếp theo**: còn thiếu 1 số ngân hàng nhỏ (VietCredit, OceanBank,
    GPBank, CBBank, ngân hàng nước ngoài tại VN như HSBC/Standard
    Chartered/Shinhan/Woori/UOB/CIMB), rồi mở rộng thêm cơ quan chính phủ
    (Bộ Công an, Tổng cục Hải quan, Bộ Y tế, EVN Điện lực...). WebSearch có
    giới hạn phiên — nếu bị chặn, đợi reset rồi tiếp tục theo đúng quy
    trình: search trang liên hệ chính thức → check robots.txt bằng UA thật
    của crawler → check nội dung tĩnh có số điện thoại không → thêm vào
    `sources.yaml` → crawl từ VPS → `npm run aggregate`.
- **App iOS** (`apps/ios/`) đã viết xong + build thử thành công (simulator):
  SwiftUI app + CallKit Call Directory Extension, hiện tên ngân hàng khi có
  cuộc gọi đến (giống Truecaller/ViewCaller nhưng dùng data của mình).
  **CHƯA cài lên iPhone thật** — user sẽ tự làm sau (cần Xcode + cắm cáp +
  chọn Apple ID cá nhân miễn phí). Hướng dẫn đầy đủ: `apps/ios/README.md`.

**Bug thật đã tìm + sửa trong lúc làm** (đáng nhớ vì có thể tái diễn dạng
khác khi thêm nguồn mới):
1. `npm run build` (tsc thật) chưa từng được test — chỉ test qua
   vitest/tsx (esbuild, khoan dung hơn). Path mapping trỏ thẳng ra file .ts
   ngoài rootDir làm tsc fail. Fix: cho `packages/shared-types` build tsc
   thật, dùng qua npm workspace dependency.
2. JS `\b` (word boundary) không nhận diện ký tự có dấu tiếng Việt → regex
   cleanup tên công ty im lặng không strip được gì.
3. HTML→text join bằng space đơn giản làm context window lẫn nội dung giữa
   các `<li>`/`<p>` không liên quan → phải giữ ranh giới đoạn (`\n`).
4. `robots.txt` fetch dùng User-Agent mặc định của Python (`Python-urllib/x.y`)
   thay vì UA thật của crawler → một số CDN (MoMo, Cake) 403 UA mặc định
   trong khi vẫn cho UA thật của mình crawl bình thường → false "disallow".
   Fix: tự fetch robots.txt bằng UA thật, không dùng `rp.read()` mặc định.

**Quyết định/nguyên tắc đang áp dụng khi thêm nguồn mới** (xem
`docs/architecture.md` mục "Privacy / scope guardrail"):
- Chỉ crawl trang liên hệ/hotline CÔNG KHAI của tổ chức (không phải dữ liệu
  cá nhân) — ngân hàng, tổ chức tín dụng, cơ quan nhà nước.
- Luôn check robots.txt bằng chính UA thật của crawler trước khi thêm.
- Nếu trang chặn bot (403 dù UA thật, hoặc bot-fight/Cloudflare challenge cả
  browser UA) → loại trừ, KHÔNG spoof UA hay giải JS challenge để né.
- IP dev máy Mac có thể đổi bất chợt (đã gặp 2 lần) — nếu API/test báo lỗi
  "no pg_hba.conf entry", cần thêm IP mới vào `pg_hba.conf` trên VPS (xem
  `docs/architecture.md`).

## Live deployment

**https://vn-phone.tuandv.id.vn** — lookup FE, publicly reachable.

API runs as `phoneintel-api` under pm2 on the VPS (`103.163.216.32`),
internal port `8037` (127.0.0.1 only, not directly exposed). nginx
(`/etc/nginx/sites-available/vn-phone.tuandv.id.vn`) serves `apps/web/`
as static files at the domain root and reverse-proxies `/api/*` to the
pm2 process — same-origin, no CORS needed. SSL via certbot (auto-renews).

Both API and FE redeploy together via the standard auto-deploy cron
(`~/vn-phone-dp` + `~/deploy-vn-phone-dp.sh`, which does `git pull`, builds
the API, `pm2 restart`, and `rsync`s `apps/web/` to `/var/www/vn-phone/` +
`APPS` entry in `~/auto-deploy.sh`): push to `main` and it's live within
~2 minutes. Connects to the same `phoneintel` database as local dev, just
over `127.0.0.1` instead of the scoped external-IP rule (see
`docs/architecture.md`).

## Stack

- **API**: Node 20, TypeScript, Fastify, Drizzle ORM over Postgres
- **Crawler**: Python 3.12, httpx + BeautifulSoup4 (no Playwright)
- **DB**: PostgreSQL (raw SQL migrations in `database/migrations/`)
- **Infra**: Docker Compose — `postgres`, `api`, `crawler`, `fixtures`

## Quick start (Docker)

```bash
docker compose up -d postgres fixtures
docker compose run --rm crawler python -m jobs.crawl_worker --source all
docker compose up -d api
docker compose run --rm api npm run aggregate -w @phoneintel/api
curl http://localhost:3000/api/v1/phones/0912345678
```

The `fixtures` service serves 3 synthetic sources (official org, business
directory, low-trust blog — entirely fake data) over real HTTP so the
crawler exercises real robots.txt/rate-limit/retry logic without touching
any live external website. See `docs/architecture.md`.

## Quick start (local dev, no Docker, no local Postgres)

There's a dedicated dev Postgres already running on the VPS
(`103.163.216.32`, database `phoneintel`) — no need to run Postgres locally
or via Docker for day-to-day API development. Credentials are in the
project's `.env` (gitignored). See `docs/architecture.md` for how it's
firewalled (scoped to a specific dev IP, not open to the internet).

```bash
# 1. DATABASE_URL already points at the remote dev DB via .env — just load it
export $(grep -v '^#' .env | xargs)
psql "$DATABASE_URL" -f database/migrations/0001_init.sql   # already applied once, safe to skip

# 2. install deps
npm install
(cd services/crawler && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt)

# 3. start the fixture server (separate terminal)
(cd services/crawler && source .venv/bin/activate && python tools/serve_fixtures.py)

# 4. run the pipeline
export DATABASE_URL FIXTURES_BASE_URL=http://localhost:8899
./scripts/seed.sh          # crawl + aggregate (see database/seed/README.md)

# 5. run the API
npm run dev -w @phoneintel/api
curl http://localhost:3000/api/v1/phones/0912345678
```

## CLI commands

| Command | What it does |
|---|---|
| `python -m jobs.crawl_worker --source all` | Crawl every active source (idempotent) |
| `python -m jobs.crawl_worker --source "Fixture Official Org"` | Crawl one source |
| `python -m jobs.crawl_worker --normalize-only` | Re-run extraction on any raw_documents missing observations |
| `npm run aggregate -w @phoneintel/api` | Rule-based aggregation: observations -> identity candidates |
| `npm run stats -w @phoneintel/api` | Data quality metrics (Node CLI) |
| `python -m tools.data_stats` (from `services/crawler`) | Same metrics, spec's example CLI shape |

## API

Base path `/api/v1`.

- `GET /phones/:phone` — canonical phone + type, observation/source counts, identity candidates with confidence and evidence count
- `GET /phones/search?q=0912` — partial national-number search
- `GET /stats` — data quality metrics
- `GET /sources` — per-source raw_document/observation counts

## Testing

```bash
npm run test -w @phoneintel/api      # normalizer + extractor unit tests + integration (needs seeded DATABASE_URL)
(cd services/crawler && source .venv/bin/activate && python -m pytest)  # Python normalizer + extractor unit tests
```

The integration suite (`apps/api/src/__tests__/integration.pipeline.test.ts`)
asserts against a database that's already been through the real pipeline —
run `./scripts/seed.sh` first. It's skipped automatically if `DATABASE_URL`
isn't set.

## Repo layout

```
apps/api/              Fastify API, Drizzle schema, normalizer, extractor, aggregation, CLI
apps/web/               Static lookup FE (plain HTML/CSS/JS, no build step) — https://vn-phone.tuandv.id.vn
services/crawler/       Python crawler framework + fixtures + tests
packages/shared-types/  TS types shared conceptually across API/crawler (crawler mirrors independently)
database/migrations/    SQL schema (source of truth)
database/seed/          Seed pipeline docs (no static INSERT files — see database/seed/README.md)
docs/                   architecture.md, database.md, scaling.md
scripts/seed.sh         Orchestrates crawl + aggregate against the fixture sources
```

## Adding a real source

Add an entry to `services/crawler/config/sources.yaml` — no core code
changes needed for a source that just needs the generic HTTP collector. See
`collectors/sources/example_official.py` for where source-specific parsing
overrides go if a site's markup needs it. Read the privacy/scope note in
`docs/architecture.md` before adding anything beyond
official/business-directory/government sources.
