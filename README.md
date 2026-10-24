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

## Environment

See `.env.example`. Beyond the database and JWT secrets:

| Variable | Purpose |
| --- | --- |
| `FRONTEND_URL` | Web app origin(s) allowed by CORS, comma-separated |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_USER`, `MAIL_PASS`, `MAIL_FROM_NAME`, `MAIL_FROM_EMAIL` | SMTP for verification codes and review emails (same setup as dali-be) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER` | File uploads (KYC documents, CAC certificates, fit photos, fabric images). Uploads return 503 until these are set. |

`JWT_SECRET` and `JWT_REFRESH_SECRET` are required — the API refuses to start without them.

## Testing & Build

```bash
pnpm test          # Unit tests (Vitest)
pnpm build         # Production TypeScript build
pnpm lint          # Static analysis (Oxlint)
```

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
