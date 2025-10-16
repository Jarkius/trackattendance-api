# Track Attendance API

Fastify-based HTTP service for ingesting bulk attendance scans backed by PostgreSQL (Neon).
Designed for seamless integration with offline QR scanning stations, capturing badge events reliably with idempotent storage and operational logging.

## Features
- **Batch endpoint** that deduplicates scans by idempotency key
- **Simplified schema** aligned with local QR app database (badge_id, station_name, scanned_at)
- **UTC timestamp support** - direct compatibility with ISO8601 format
- **Privacy-preserving** - stores only scan events, not employee PII
- JSON schema validation and Fastify logging for observability
- Graceful shutdown with pooled PostgreSQL connections
- **Cloud sync ready** - designed for offline-first QR scanning stations

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
- `DATABASE_URL` � connection string for the target PostgreSQL instance.
- `API_KEY` � shared secret used by the bearer-token middleware.
- `PORT` (optional) � defaults to `5000`.

Apply the bootstrap schema before first run:
```bash
psql "$DATABASE_URL" -f Postgres-schema.sql
```

## Running & Deployment
- `npm run dev` launches the TypeScript source with hot reload via `tsx`.
- `npm run build` compiles to `dist/` using `tsc`.
- `npm run start` executes the compiled server (use for production or containers).

## API Overview

### Endpoints
- `GET /healthz` - readiness probe; unauthenticated
- `POST /v1/scans/batch` - accepts `{ "events": [...] }` payloads with ISO8601 timestamps; returns counts of saved and duplicate scans

### Request Format

```json
{
  "events": [
    {
      "idempotency_key": "MainGate-101117-20251015T123045Z",
      "badge_id": "101117",
      "station_name": "Main Gate",
      "scanned_at": "2025-10-15T12:30:45Z",
      "meta": {
        "matched": true,
        "location": "Main Entrance"
      }
    }
  ]
}
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `idempotency_key` | string | ✓ | Unique key per scan (prevents duplicates on retry) |
| `badge_id` | string | ✓ | Employee badge identifier scanned from QR/barcode |
| `station_name` | string | ✓ | Scanning station location name |
| `scanned_at` | string | ✓ | ISO8601 UTC timestamp (format: `YYYY-MM-DDTHH:MM:SSZ`) |
| `meta` | object | - | Additional context (does NOT contain employee names/PII) |

### Response Format

```json
{
  "saved": 1,
  "duplicates": 0,
  "errors": 0
}
```

## Project Layout
- `server.ts` � Fastify entry point and route wiring.
- `dist/` � generated JavaScript output; do not edit manually.
- `Postgres-schema.sql` � authoritative schema for the `scans` table.
- `AGENTS.md` � contributor guidelines and workflow expectations.

## Testing

### Automated Tests

```bash
# Database connection test
npx tsx testscript/test-neon.js

# API integration tests (all endpoints)
npm run dev  # Start server first
npx tsx testscript/test-api-insert.js

# Timestamp compatibility test
npx tsx testscript/test-timestamp-conversion.js
```

All test scripts are located in `testscript/` directory (git-ignored).

### Manual Testing

```bash
# Health check
curl http://localhost:5000/healthz

# Submit a scan (requires API_KEY in .env)
curl -X POST http://localhost:5000/v1/scans/batch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "events": [{
      "idempotency_key": "test-123",
      "badge_id": "EMP001",
      "station_name": "Test Station",
      "scanned_at": "2025-10-15T12:30:45Z"
    }]
  }'
```

## QR App Integration

This API is designed to work seamlessly with the **QR Standalone App** (`C:\Workspace\Dev\Python\QR`):
- Offline-first Python/PyQt6 desktop application
- SQLite local storage with UTC timestamps
- 1:1 field mapping for zero-conversion sync
- Privacy-preserving design (employee names stay local)

### Integration Status
- ✅ Schema aligned (badge_id, station_name, scanned_at)
- ✅ Timestamp format standardized (UTC with Z suffix)
- ✅ Privacy design complete (no PII in cloud)
- 🔄 Sync module implementation in progress

See `SESSION-NOTES.md` for detailed integration documentation.

## Contributing
Follow `AGENTS.md` for coding standards, commit style, and pull-request checklists. Merge changes only after verifying local runs and documenting new configuration.

## License
ISC
