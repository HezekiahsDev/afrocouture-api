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

### 3. Install Dependencies & Run

```bash
pnpm install
pnpm start:dev
```

The API will be available at [http://localhost:3001](http://localhost:3001). Healthcheck: [http://localhost:3001/health](http://localhost:3001/health).

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
