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
