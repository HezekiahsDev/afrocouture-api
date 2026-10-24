# AfroCouture AI — Backend API

Africa's premier AI-powered bespoke couture & artisan marketplace backend.

## Tech Stack

- **Framework**: NestJS 12
- **Database**: PostgreSQL 16 via TypeORM
- **Cache & Pub/Sub**: Redis 7
- **Authentication**: JWT (Access & Refresh tokens with Role-based guards)
- **Realtime**: Socket.IO WebSocket Gateway
- **AI Integration**: Google Vertex AI Imagen proxy

## Quick Start

### 1. Environment Configuration

```bash
cp .env.example .env
```

### 2. Start PostgreSQL & Redis

```bash
docker compose up -d postgres redis
```

### 3. Install Dependencies, Migrate & Run

```bash
pnpm install
pnpm build && pnpm migration:run   # create / update tables
pnpm seed                          # optional: sample artisans, fabrics and styles
pnpm start:dev
```

With `MAIL_HOST` empty, emails (including sign-up and password-reset codes) are printed to the console instead of being sent.

The API will be available at [http://localhost:3001](http://localhost:3001). Healthcheck: [http://localhost:3001/health](http://localhost:3001/health).

## Database

The schema is managed only by migrations — `synchronize` is off everywhere. Migrations are compiled into `dist/`, so commands run against the built code.

```bash
pnpm migration:generate   # after changing an entity: builds, then writes src/database/migrations/<timestamp>-Migration.ts
pnpm migration:run        # apply pending migrations
pnpm migration:revert     # undo the last migration
pnpm migration:show       # list applied / pending migrations
```

Rename the generated file and class to describe the change before committing it.

### Sample catalogue

```bash
pnpm seed            # adds sample artisans, merchants, fabrics and styles (skips what already exists)
pnpm seed --remove   # deletes all sample data once real sellers are live
```

Sample rows are flagged `isSample` and are never shown as verified. Their images are served by the web app from `afrocouture-web/public/images`.

### Admin accounts

```bash
pnpm admin:create admin@example.com 'a-long-password' "Full Name"
```

Admins review artisan and merchant verification through `GET /admin/verifications` and `PATCH /admin/{tailors|merchants}/:id/review` (`{ "decision": "approve" | "reject", "note": "…" }` — a note is required to reject and is emailed to the applicant).

The admin console API (`/admin/*`, admins only) also covers an overview dashboard, user search with
suspend/reactivate, all orders with read-only chat, payouts, review and fabric moderation, and an audit
log of every admin action (`GET /admin/audit`). The route list is in [docs/rbac.md](docs/rbac.md#admin).

## Environment

See `.env.example`. Beyond the database and JWT secrets:

| Variable | Purpose |
| --- | --- |
| `FRONTEND_URL` | Web app origin(s) allowed by CORS, comma-separated |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_USER`, `MAIL_PASS`, `MAIL_FROM_NAME`, `MAIL_FROM_EMAIL` | SMTP for verification codes and review emails (same setup as dali-be) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER` | File uploads (KYC documents, CAC certificates, fit photos, fabric images). Uploads return 503 until these are set. |

| `PAYSTACK_SECRET_KEY`, `PAYSTACK_BASE_URL`, `PAYMENT_CALLBACK_URL` | Paystack checkout, webhook verification, payouts and refunds. Payment endpoints return 503 until the key is set. |
| `PLATFORM_FEE_PERCENT`, `AUTO_APPROVE_DAYS` | Fee added to each order (default 0) and days before a delivered order auto-completes (default 7) |
| `VERTEX_AI_PROJECT_ID`, `VERTEX_AI_LOCATION`, `VERTEX_IMAGEN_MODEL`, `GOOGLE_APPLICATION_CREDENTIALS_JSON` | AI Design Studio (Vertex AI Imagen). AI Studio returns 503 until configured. |
| `AI_DAILY_LIMIT` | AI generations per person per UTC day (default 20) |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB` | Rate limiting (fails open if Redis is unreachable) |

`JWT_SECRET` and `JWT_REFRESH_SECRET` are required — the API refuses to start without them.

## Orders, payments, chat & AI

The full contract is in [`docs/orders-payments-ai-contract.md`](docs/orders-payments-ai-contract.md). In short:

- **Commission flow:** customer requests → artisan quotes → customer pays with Paystack (money held in escrow) →
  milestones → delivered → customer approves (artisan paid) or disputes (admin resolves). Merchants are paid for fabric when
  the artisan confirms it arrived.
- **Paystack setup:** in the dashboard set the webhook URL to `https://<api-domain>/payments/paystack/webhook`, enable
  Transfers and turn off the transfer OTP so payouts can run automatically, and keep a balance for payouts.
- **Chat:** Socket.IO namespace `/chat` (access token in `auth.token`) plus REST history at `/orders/:id/messages`.
  nginx must pass WebSocket upgrades (the provided `scripts/setup-nginx.sh` does).
- **AI Studio:** `/ai-studio/*`; images are generated with Imagen and stored on Cloudinary.
- **Rate limits:** sign-in, sign-up, code and reset endpoints, uploads and AI generation are limited per IP / email / user.

## Testing & Build

```bash
pnpm test          # Unit tests (Vitest)
pnpm build         # Production TypeScript build
pnpm lint          # Static analysis (Oxlint)
```

### Integration (e2e) tests

`pnpm test:e2e` boots the whole API in-process and drives it over HTTP with supertest
(`test/*.e2e-spec.ts`). `test/rbac.e2e-spec.ts` is the access-control matrix from
[docs/rbac.md](docs/rbac.md): every protected route answers 401 without a token, 403 for the wrong
role, 403/404 for someone else's resource, and 2xx for the right person, with no private fields leaking.
`test/admin.e2e-spec.ts` covers the admin console and its audit trail, and
`test/reviews-notifications.e2e-spec.ts` runs real orders end to end (Paystack replaced by an
in-process fake) to check reviews, replies, moderation, the notification centre and the live
socket push (using `socket.io-client` from `../afrocouture-web` when present; otherwise that test is skipped).
Each suite clears the database and the `rl:*` rate-limit keys in its Redis DB before it starts.

The suites **truncate every table**, so they refuse to start unless `DB_NAME` looks disposable
(contains `test`, `e2e` or `_b<digit>`, or `E2E_ALLOW_TRUNCATE=1`). Use a separate database and
Redis DB; environment variables override `.env`:

```bash
docker compose exec postgres psql -U "$DB_USER" -d postgres -c 'CREATE DATABASE afrocouture_test'
pnpm build
DB_NAME=afrocouture_test pnpm migration:run   # once, and after new migrations
DB_NAME=afrocouture_test REDIS_DB=15 MAIL_HOST= pnpm test:e2e   # all suites, one file at a time
```

Never point them at the production database.

## Operations: logs, alerts, health, backups

### Logs
Every request gets an id, returned in the `X-Request-Id` header and in error responses (`requestId`), and
logged with method, path (no query string), status, duration and the signed-in user. Logs are JSON lines
when `NODE_ENV=production` or `LOG_FORMAT=json`, otherwise readable text. On the server:

```bash
pm2 logs afrocouture-api                                  # live
pm2 logs afrocouture-api --nostream --lines 500 | grep <requestId>
```

### Alerts
Unexpected errors (any 500 or crash), unhandled promise rejections, and failed or reversed payouts and
refunds raise an alert. Set `ALERT_EMAIL` (comma-separated) and/or `ALERT_WEBHOOK_URL` (Slack or Discord
incoming webhook). Repeats of the same alert are suppressed for `ALERT_THROTTLE_MINUTES` (default 15).
Deliberate 4xx/502/503 responses (bad input, a provider down, a feature switched off) are logged only.
With neither variable set, alerts only go to the log.

### Health
`GET /health` returns `200 {"status":"ok","db":"up","redis":"up",...}`, or `503` with `"status":"degraded"`
when Postgres or Redis doesn't answer within 2s / 1s. Point an uptime monitor (UptimeRobot, Better Stack,
Cloudflare Health Checks) at `https://afrocouture-api.alcance.ng/health`, checking every 1–5 minutes and
alerting on any non-200.

### Database backups
`scripts/backup-db.sh` dumps the database from the Postgres container (`pg_dump` custom format), checks the
dump is readable, writes it to `BACKUP_DIR` (default `~/backups/afrocouture`), and deletes dumps older than
`BACKUP_KEEP_DAYS` (default 14). With `BACKUP_RCLONE_REMOTE` set it also copies each dump off the server
(recommended: a backup on the same VPS doesn't survive losing the VPS). A failed backup exits non-zero
and posts to `ALERT_WEBHOOK_URL`.

On the server, once:

```bash
cd /home/alcance/projects/afrocouture-api   # DEPLOY_PATH
bash scripts/backup-db.sh                 # take one now and check the output
bash scripts/install-backup-cron.sh       # daily at 02:30 server time; logs to $BACKUP_DIR/backup.log
crontab -l                                # confirm the "# afrocouture-db-backup" line
```

Change the schedule with `BACKUP_CRON="0 */6 * * *" bash scripts/install-backup-cron.sh`; remove it with
`bash scripts/install-backup-cron.sh --remove`.

Restoring replaces every table in the target database, in one transaction:

```bash
# Rehearse into a scratch database first (created if missing), then drop it:
bash scripts/restore-db.sh ~/backups/afrocouture/afrocouture-YYYYMMDD-HHMMSS.dump afrocouture_restore_check
docker compose exec postgres dropdb -U afrocouture afrocouture_restore_check

# Real restore over the live database:
pm2 stop afrocouture-api
bash scripts/restore-db.sh ~/backups/afrocouture/afrocouture-YYYYMMDD-HHMMSS.dump
pm2 start afrocouture-api
```

The scripts read `DB_NAME`, `DB_USER` and `DB_PASSWORD` from `.env` and run the Postgres tools inside the
`postgres` compose service (or `PG_CONTAINER=<name>` for a standalone container).

## Deployment

Deploy directly to your server using PM2 with the automated deploy pipeline:

### 1. Configure Server Credentials

Copy the deployment template for your environment:

```bash
# For QA / Staging
cp .env.deploy.example .env.deploy

# For Production
cp .env.deploy.production.example .env.deploy.production
```

Configure `DEPLOY_HOST` (e.g. `user@your-server-ip`) and `DEPLOY_PATH` (e.g. `/home/user/projects/afrocouture-api`).

### 2. Run Deploy

```bash
# Deploy to QA / Staging
pnpm deploy

# Deploy to Production
pnpm deploy:production
```

The script will:
1. Verify branch guards (e.g. `main` for production)
2. Run test suite locally (`pnpm test`)
3. Compile production build locally (`pnpm build`)
4. Package and upload `dist` artifact and environment via SSH/SCP
5. Unpack and reload PM2 process on the server without downtime

Migrations are not run automatically. After a deploy that includes a new migration, run on the server (where the database lives):

```bash
cd $DEPLOY_PATH && pnpm migration:run
```
