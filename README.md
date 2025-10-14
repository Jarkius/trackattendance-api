# Track Attendance API

Fastify-based HTTP service for ingesting bulk attendance scans backed by PostgreSQL.
Use it to capture badge events reliably with idempotent storage and operational logging.

## Features
- Batch endpoint that deduplicates scans by idempotency key.
- JSON schema validation and Fastify logging for observability.
- Graceful shutdown with pooled PostgreSQL connections.

## Requirements
- Node.js 20+ (align with engines used by the team).
- PostgreSQL 14+ reachable via `DATABASE_URL`.
- npm 10+ recommended for lockfile compatibility.

## Quick Start
```bash
git clone https://github.com/Jarkius/trackattendance-api.git
cd trackattendance-api
npm install
cp .env.example .env
# fill in DATABASE_URL and API_KEY
npm run dev
```

Visit `http://localhost:5000/healthz` to confirm the server is running.

## Configuration
`.env` must define:
- `DATABASE_URL` – connection string for the target PostgreSQL instance.
- `API_KEY` – shared secret used by the bearer-token middleware.
- `PORT` (optional) – defaults to `5000`.

Apply the bootstrap schema before first run:
```bash
psql "$DATABASE_URL" -f Postgres-schema.sql
```

## Running & Deployment
- `npm run dev` launches the TypeScript source with hot reload via `tsx`.
- `npm run build` compiles to `dist/` using `tsc`.
- `npm run start` executes the compiled server (use for production or containers).

## API Overview
- `GET /healthz` – readiness probe; unauthenticated.
- `POST /v1/scans/batch` – accepts `{ "events": [...] }` payloads with ISO8601 timestamps; returns counts of saved and duplicate scans.

Example batch payload:
```json
{
  "events": [
    {
      "idempotency_key": "abc-123",
      "event_id": "event-001",
      "device_id": "kiosk-7",
      "employee_ref": "emp-42",
      "scanned_at": "2024-10-14T08:30:00Z",
      "meta": { "location": "HQ" }
    }
  ]
}
```

## Project Layout
- `server.ts` – Fastify entry point and route wiring.
- `dist/` – generated JavaScript output; do not edit manually.
- `Postgres-schema.sql` – authoritative schema for the `scans` table.
- `AGENTS.md` – contributor guidelines and workflow expectations.

## Testing
`npm test` is a placeholder; adopt Vitest or Jest and enforce ~80% branch coverage before merging feature work.

## Contributing
Follow `AGENTS.md` for coding standards, commit style, and pull-request checklists. Merge changes only after verifying local runs and documenting new configuration.
