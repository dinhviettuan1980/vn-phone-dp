# Vietnam Phone Intelligence Data Platform (Phase 1 + Phase 2)

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

## Phase 2 — Data Acquisition Engine (2026-09-04)

Extends Phase 1 upstream, doesn't rewrite it — see
`docs/PHASE2_IMPLEMENTATION_PLAN.md` for the full design and
`docs/architecture.md` "Phase 2" section for the decisions made while
building it (including a real leak bug found+fixed: auto-discovered data
briefly reached the live iOS export before the fix).

**New capabilities:**
- **Job queue** (`crawl_jobs`, Postgres-backed, `FOR UPDATE SKIP LOCKED`) —
  retry with exponential backoff, stale-lock recovery, priority ordering.
- **Worker** (`python -m jobs.worker` / `npm run worker`) — claims jobs,
  dispatches to CRAWL_URL/CRAWL_SOURCE/DISCOVER_DOMAIN/DISCOVER_SITEMAP/
  INGEST_DATASET, reusing Phase 1's extraction pipeline verbatim.
- **Scheduler** (`python -m jobs.scheduler` / `npm run scheduler`) — due
  `crawl_targets` → CRAWL_URL jobs, due sources → DISCOVER_SITEMAP jobs.
  Pre-existing (hand-vetted) sources default to `crawl_frequency = 'MANUAL'`
  — auto-discovery never silently expands scope beyond what was reviewed
  this session; only newly-discovered domains opt into periodic re-discovery.
- **Domain discovery** (`python -m cli.discover_domain --domain <url>` /
  `npm run discover`) — robots.txt `Sitemap:` + common-path fallback,
  recursive sitemap index resolution (gzip supported), config-driven URL
  relevance scoring (`services/crawler/config/url_scoring.yaml` — no
  business logic hard-coded). Verified end-to-end against a demo fixture
  domain: contact/lien-he/chi-nhanh pages score 80-100, products/blog score 10.
- **Dataset ingestion** (`python -m cli.ingest_dataset --file data.csv
  --source "<name>"` / `npm run ingest`) — CSV/XLSX/JSON, config-driven
  phone-column detection (Vietnamese diacritic-aware, e.g. "Điện thoại" /
  "SĐT"), each row → the SAME raw_document/phone_observation pipeline
  Phase 1's HTML crawler uses. Idempotent on file checksum.
- **Incremental crawling** — `HttpCollector.fetch()` now sends
  If-None-Match/If-Modified-Since when available, handles 304, on top of
  the existing content_hash dedup.
- **Unknown Number Priority Queue** (`GET /api/v1/unknown-numbers/priority`)
  — the manually-reported call log numbers with no known identity, ranked
  by call volume + recency + repeat-day weighting.
- **Acquisition API**: `POST /api/v1/discovery/domain`, `GET
  /api/v1/acquisition/jobs[/:id]`, `GET /api/v1/acquisition/stats`, `GET
  /api/v1/sources/:id/performance`.
- **Tests**: 67 Python tests (sitemap parsing, URL scoring, column
  detection, job queue atomicity/retry/stale-recovery against the real DB).

**Not run continuously yet**: scheduler/worker are CLI commands, not a
cron/pm2 process on the VPS — same "no automated crawl job" state Phase 1
left, now with the tooling to turn it on when wanted (see acquisition
stats to decide when).

## Trạng thái dự án (cập nhật gần nhất: 2026-09-04)

*Đọc phần này trước nếu tiếp tục làm việc trên project — tóm tắt đầy đủ để
không mất context giữa các phiên làm việc.*

### 1. Hạ tầng đang chạy

| Thành phần | Trạng thái | Chi tiết |
|---|---|---|
| Database | Live, production | Postgres 16 trên VPS `103.163.216.32`, DB `phoneintel`. Không dùng Docker/Postgres local — xem `docs/architecture.md` mục "Remote dev database". |
| API | Live, pm2 `phoneintel-api` | Port nội bộ 8037 (127.0.0.1 only, không expose trực tiếp). |
| FE tra cứu | Live, public | **https://vn-phone.tuandv.id.vn** — nginx proxy `/api/*` → API, SSL certbot (auto-renew). |
| App iOS | Cài + chạy trên iPhone thật | Xem mục 4 bên dưới. |
| **Cron/job tự động crawl** | **KHÔNG có** (nhưng đã có tooling) | Chỉ có `*/2 * * * * /home/pc1/auto-deploy.sh` (auto-deploy code khi push, không crawl). Phase 2 đã xây job queue + scheduler + worker (`crawl_jobs`, `python -m jobs.scheduler`, `python -m jobs.worker`) nhưng **chưa gắn cron/pm2 chạy liên tục trên VPS** — vẫn phải tự chạy tay. Muốn bật tự động: thêm cron gọi 2 lệnh trên định kỳ. |

Deploy code (API + FE cùng lúc): push lên `main` → auto-deploy cron trong
vòng ~2 phút tự `git pull` + build + `pm2 restart` + rsync FE
(`~/deploy-vn-phone-dp.sh`).

### 2. Dữ liệu hiện có

**39 nguồn** trong `services/crawler/config/sources.yaml` (3 fixture demo +
36 nguồn thật) → **256 số điện thoại thật** đã crawl, **142 số** đủ điều
kiện xuất cho app iOS (lọc MOBILE/LANDLINE, loại hotline 1900/1800 vì đó là
số khách hàng gọi TỚI chứ không phải số gọi ĐẾN khách hàng).

Ưu tiên theo yêu cầu user: **ngân hàng & tổ chức tín dụng trước (càng
nhiều càng tốt), sau đó mới đến cơ quan chính phủ.**

- **32 ngân hàng/tổ chức tín dụng/fintech đã crawl**: Vietcombank,
  VietinBank, BIDV, Techcombank, VPBank, HDBank, VIB, SeABank, MoMo, Cake,
  TNEX, Agribank, ACB, Sacombank, Eximbank, OCB, LPBank, MSB, Nam A Bank,
  FE Credit, Home Credit, HD Saison, BVBank, PVcomBank, VietABank,
  Bac A Bank, Kienlongbank, Saigonbank, Vietbank, VietCredit, HSBC Vietnam,
  Standard Chartered Vietnam.
- **4 cơ quan nhà nước đã crawl** (mới bắt đầu, còn nhiều thiếu): SBV
  (Ngân hàng Nhà nước), Tổng cục Thuế, Bảo hiểm Xã hội Việt Nam, Cổng Dịch
  vụ công Quốc gia.
- **Loại trừ có chủ đích** — không spoof UA/giải JS challenge để né, xem
  comment đầu mỗi wave trong `sources.yaml` để biết lý do chi tiết từng cái:
  - Chặn bot xác nhận (robots.txt và/hoặc trang thật trả 403 cho cả UA
    thật lẫn browser UA): MB Bank, TPBank, Mcredit, SHB, NCB, PGBank,
    GPBank (Incapsula).
  - Lỗi kỹ thuật thật của site (không phải chính sách chặn): OceanBank
    (server không phản hồi TCP từ 2 mạng khác nhau), Shinhan Bank Vietnam
    (chain chứng chỉ TLS thiếu intermediate cert trên server họ — chỉ
    "qua" trên macOS vì curl tự bù, không qua được từ VPS/Linux).
- **Việc tiếp theo**: còn thiếu CBBank, ngân hàng nước ngoài khác (Woori,
  UOB, CIMB, Public Bank...), rồi mở rộng cơ quan chính phủ (Bộ Công an,
  Tổng cục Hải quan, Bộ Y tế, EVN Điện lực...). Quy trình khi thêm nguồn
  mới: search trang liên hệ chính thức → check robots.txt bằng UA thật của
  crawler → check nội dung tĩnh có số điện thoại không → thêm vào
  `sources.yaml` → crawl từ VPS (chạy tay, không có cron) → `npm run aggregate`.

### 3. Tính năng hiện có

**API** (`https://vn-phone.tuandv.id.vn/api/v1/...`):
- `GET /phones/:phone` — tra cứu 1 số, trả về loại số, thống kê, danh sách
  identity candidates kèm độ tin cậy.
- `GET /phones/search?q=` — tìm theo 1 phần số quốc gia.
- `GET /stats` — số liệu chất lượng dữ liệu (raw docs, observations, số
  duy nhất, tỷ lệ trùng nội dung, top nguồn...).
- `GET /sources` — thống kê theo từng nguồn.
- `GET /export/call-directory` — xuất toàn bộ danh bạ (số + nhãn tốt nhất)
  dạng E.164 sắp xếp tăng dần, dùng riêng cho app iOS nạp vào CallKit.
- `POST /call-logs/import` — nhập 1 batch cuộc gọi thủ công (`call_date` +
  danh sách `{phone_raw, call_count}`), đối chiếu ngay với DB, trả về biết/
  chưa biết từng số. Bảng riêng `personal_call_logs`, KHÔNG nằm trong chuỗi
  provenance raw_documents/phone_observations (đây là dữ liệu cá nhân người
  dùng tự nhập, không phải evidence công khai) — xem
  `database/migrations/0002_personal_call_logs.sql`.
- `GET /call-logs/summary?from=&to=` — tổng kết theo số trong khoảng thời
  gian, gộp theo số, kèm tổng số lần gọi/số ngày/nhận diện được hay chưa.
- `GET /call-logs/unknown` — danh sách số đã xuất hiện trong nhật ký cuộc
  gọi nhưng chưa có identity nào trong DB, sắp theo số lần gọi giảm dần
  (danh sách "cần tìm hiểu").

**FE web** (`apps/web/`, tại vn-phone.tuandv.id.vn): không build step
(HTML/CSS/JS thuần), gọi thẳng API cùng domain (không cần CORS). 2 tab:
- **Tra cứu**: 1 ô tìm kiếm số điện thoại.
- **Nhật ký cuộc gọi**: form dán/nhập danh sách số + số lần gọi cho 1 ngày
  (vì iOS không cho app đọc lịch sử cuộc gọi — xem mục 4, bug/quyết định #7),
  bảng tổng kết theo khoảng ngày, và bảng "số cần tìm hiểu".

**App iOS** (`apps/ios/`, đã cài lên iPhone thật của Tuan): SwiftUI app +
CallKit Call Directory Extension —
- Nút "Đồng bộ dữ liệu ngay": tải toàn bộ danh bạ từ `/export/call-directory`,
  lưu vào App Group container dùng chung với extension.
- Khi có cuộc gọi đến (hoặc xem Lịch sử cuộc gọi) từ 1 trong 142 số: iOS tự
  hiện **"Tra Số VN: <tên tổ chức>"** — hoàn toàn do iOS xử lý native, app
  không cần đang chạy.
- **Chưa có**: đồng bộ nền tự động (background refresh) — hiện phải tự mở
  app bấm nút mỗi lần muốn cập nhật dữ liệu mới nhất.

**CLI** (chạy tay qua SSH, không có lịch tự động):
- `python -m jobs.crawl_worker --source "<tên>"` — crawl 1 nguồn.
- `python -m jobs.crawl_worker --normalize-only` — trích xuất lại các
  raw_documents chưa có observations.
- `npm run aggregate -w @phoneintel/api` — chạy rule-based aggregation.
- `npm run stats -w @phoneintel/api` / `python -m tools.data_stats` — xem
  số liệu chất lượng dữ liệu.

### 4. Bug thật đã tìm + sửa trong lúc làm

Đáng nhớ vì có thể tái diễn dạng khác khi thêm nguồn/tính năng mới:
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
5. Máy Mac dev hết sạch dung lượng ổ đĩa giữa lúc build iOS (Xcode tích luỹ
   ~112GB simulator runtime cũ) — khiến Bash tool lỗi ENOSPC ngay cả với
   lệnh nhỏ nhất. Fix: `xcrun simctl runtime list` xem UUID, `xcrun simctl
   runtime delete <UUID>` xoá bản cũ (giữ bản mới nhất).
6. Signing app iOS: Personal Team miễn phí gặp 2 lỗi thật (credential hết
   hạn ở 1 account, giới hạn ~3 thiết bị/năm ở account khác) → chuyển sang
   team trả phí IMIP có sẵn quyền Developer, build thành công ngay, không
   bị giới hạn hết hạn app sau 7 ngày. Chi tiết: `apps/ios/README.md`.
7. **iOS không có API nào để app bên thứ 3 đọc lịch sử cuộc gọi** (Recents),
   kể cả quá khứ lẫn tự động theo dõi tương lai — giới hạn riêng tư của hệ
   điều hành, không phải do cách code. Đã kiểm chứng trước khi xây (không
   xây nhầm hướng): không có Shortcuts action, không có Screen Time API,
   `CXCallDirectoryExtension` chỉ cung cấp nhãn CHO iOS chứ không nhận lại
   thông tin cuộc gọi thật đã xảy ra, và chạy nền cố định giờ (vd 22h hàng
   ngày) cũng không khả thi (iOS tự quyết định lúc nào cho background task
   chạy). → Quyết định: tính năng "Nhật ký cuộc gọi" là **nhập thủ công**
   (user tự chép từ Recents), không có phần tự động nào.
8. Auto-deploy VPS từng bị treo ~7 phút ở bước `npm install` (0% CPU suốt,
   không phải chậm mà là kẹt thật — nguyên nhân chưa rõ, có thể do resource
   contention nhất thời trên VPS nhỏ). Xử lý: `pgrep -af 'npm install'` xem
   PID, `kill <pid>`, xoá `/tmp/auto-deploy.lock`, chạy lại tay. Nếu gặp lại
   dữ liệu FE/API mãi không cập nhật dù đã push, kiểm tra
   `~/auto-deploy.log` + `ps aux | grep npm` trước khi nghi code có bug.

### 5. Nguyên tắc đang áp dụng khi thêm nguồn mới

Xem `docs/architecture.md` mục "Privacy / scope guardrail":
- Chỉ crawl trang liên hệ/hotline CÔNG KHAI của tổ chức (không phải dữ liệu
  cá nhân) — ngân hàng, tổ chức tín dụng, cơ quan nhà nước.
- Luôn check robots.txt bằng chính UA thật của crawler trước khi thêm.
- Nếu trang chặn bot (403 dù UA thật, hoặc bot-fight/Cloudflare challenge cả
  browser UA) → loại trừ, KHÔNG spoof UA hay giải JS challenge để né.
- Lỗi kỹ thuật thật (site sập, TLS cert hỏng) không phải là "chặn" — vẫn
  loại trừ nhưng không cần cân nhắc đạo đức, chỉ là không truy cập được.
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
