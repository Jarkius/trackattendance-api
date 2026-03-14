# Track Attendance API

🚀 **Production-Ready** Fastify-based HTTP service for ingesting bulk attendance scans backed by PostgreSQL (Neon) and deployed on Google Cloud Run.

✅ **Currently Live**: https://trackattendance-api-969370105809.asia-southeast1.run.app

Designed for seamless integration with offline QR scanning stations, capturing badge events reliably with idempotent storage and operational logging.

## Features
- **Batch endpoint** that deduplicates scans by idempotency key
- **Simplified schema** aligned with local QR app database (badge_id, station_name, scanned_at)
- **UTC timestamp support** - direct compatibility with ISO8601 format
- **Privacy-preserving** - stores only scan events, not employee PII
- **Business unit tracking** per scan event
- **Public mobile attendance dashboard** - no auth required, auto-refreshes every 30s
- **Roster summary sync** endpoint with hash-based deduplication
- **Dashboard stats endpoints** - authenticated (with station and BU breakdown) and public (rate-limited)
- **Admin clear-scans endpoint** - PIN-protected via `X-Confirm-Delete` header (clears all stations + roster)
- **Admin clear-station endpoint** - delete scans for a single station only
- **Station heartbeat & status** - stations report liveness via `POST /v1/stations/heartbeat`; status visible on mobile dashboard (ready/pending/offline)
- **Scan source tracking** - `badge`, `lookup`, or `manual` stored per scan event
- **Meta field sanitization** - max 20 properties enforced, per-value size limits applied
- **DB pool eager connection test** at startup to detect misconfiguration early
- JSON schema validation and Fastify logging for observability
- Graceful shutdown with pooled PostgreSQL connections
- **Production Deployed** - Running on Google Cloud Run with automatic scaling
- **Monitoring Ready** - Health checks, logging, and error handling included
- **Security Hardened** - API authentication and validation implemented
- **Cloud Sync Ready** - Designed for offline-first QR scanning stations
- **CI/CD** - GitHub Actions with TypeScript type check gate before deploy

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

Visit `http://localhost:5000/` to confirm the server is running.

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
- `GET /` - readiness probe; unauthenticated (health check)
- `GET /healthz` - legacy health endpoint (use `/` instead)
- `POST /v1/scans/batch` - accepts `{ "events": [...] }` payloads with ISO8601 timestamps; returns counts of saved and duplicate scans
- `GET /v1/dashboard/stats` - authenticated dashboard stats (stations, BU breakdown)
- `GET /v1/dashboard/public/stats` - public dashboard stats (no auth, rate-limited)
- `GET /v1/dashboard/export` - authenticated scan export
- `POST /v1/roster/summary` - sync roster BU counts (with hash-based deduplication)
- `GET /v1/roster/hash` - check current roster hash
- `DELETE /v1/admin/clear-scans` - clear all scans + roster + set clear_epoch (requires `X-Confirm-Delete` header)
- `DELETE /v1/admin/clear-station?station=Name` - clear scans for one station (requires `X-Confirm-Delete` header)
- `POST /v1/stations/heartbeat` - station liveness report (unauthenticated)
- `GET /v1/stations/status` - all station statuses with ready/pending/offline (unauthenticated)
- `GET /dashboard/` - public mobile dashboard HTML page (light/dark theme, auto-refresh)

### Request Format

```json
{
  "events": [
    {
      "idempotency_key": "MainGate-101117-20251015T123045Z",
      "badge_id": "101117",
      "station_name": "Main Gate",
      "scanned_at": "2025-10-15T12:30:45Z",
      "business_unit": "Operations",
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
| `business_unit` | string | - | Business unit of the employee being scanned (optional) |
| `scan_source` | string | - | How the scan was captured: `badge`, `lookup`, or `manual` (default: `manual`) |
| `meta` | object | - | Additional context (does NOT contain employee names/PII; max 20 properties) |

### Response Format

```json
{
  "saved": 1,
  "duplicates": 0,
  "errors": 0
}
```

## Project Layout
- `server.ts` — Fastify entry point and route wiring.
- `dist/` — generated JavaScript output; do not edit manually.
- `public/index.html` — Mobile attendance dashboard (single-file, vanilla JS).
- `Postgres-schema.sql` — authoritative schema; includes `scans`, `roster_summary`, `roster_meta`, and `station_heartbeat` tables.
- `AGENTS.md` — contributor guidelines and workflow expectations.

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

In CI, `tsc --noEmit` runs as a type check gate before any deployment step proceeds.

### Manual Testing

```bash
# Health check
curl http://localhost:5000/

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

## 🚀 Production Deployment

### Google Cloud Run Status
- **✅ Live URL**: https://trackattendance-api-969370105809.asia-southeast1.run.app
- **🗄️ Database**: Neon PostgreSQL (production)
- **🔐 API Key**: Configured and secured
- **📈 Scaling**: Automatic (0-10 instances, serverless)
- **🌍 Region**: Asia Southeast 1
- **⚡ Performance**: Sub-second response times

### Deployment Configuration
- **Docker**: Multi-stage build optimized for production
- **CI/CD**: GitHub Actions with TypeScript type check gate before deploy
- **Monitoring**: Health checks and logging configured
- **Security**: Non-root user, TLS/SSL enabled

## Frontend Integration

This API is designed to work with scanning stations and supporting frontends:

- **QR Standalone App** — Offline-first Python/PyQt6 desktop scanner; SQLite local storage with UTC timestamps; 1:1 field mapping for zero-conversion sync; privacy-preserving (employee names stay local)
- **Mobile Dashboard** — Public HTML page (`GET /dashboard/`) for real-time attendance display; auto-refreshes every 30s; no authentication required
- **Roster Sync** — BU counts and email field pushed via `POST /v1/roster/summary`; hash-based deduplication prevents redundant writes

### Integration Status
- Schema aligned (badge_id, station_name, scanned_at, business_unit)
- Timestamp format standardized (UTC with Z suffix)
- Privacy design complete (no PII in cloud)
- Sync module fully implemented and tested
- End-to-end workflow verified
- Production deployment operational
- Mobile dashboard live with public stats endpoint
- Roster sync with hash deduplication operational

### 📋 Manual Testing
Comprehensive manual testing guide available: [`MANUAL_TESTING_GUIDE.md`](MANUAL_TESTING_GUIDE.md)

#### Quick Test Commands
```bash
# Health check
curl https://trackattendance-api-969370105809.asia-southeast1.run.app/

# Production API test
curl -X POST https://trackattendance-api-969370105809.asia-southeast1.run.app/v1/scans/batch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $YOUR_API_KEY" \
  -d '{"events":[{"idempotency_key":"test-123","badge_id":"101117","station_name":"Test","scanned_at":"2025-10-15T12:30:45Z"}]}'
```

See `SESSION-NOTES.md` for detailed development documentation and deployment strategy.

## Planned: Licensing & Multi-Tenant Support

Per-client API keys with station limits, Stripe subscription management, and license enforcement via heartbeat response. See [Commercialization Plan](../PLAN-commercialize.md) for full architecture.

## Contributing
Follow `AGENTS.md` for coding standards, commit style, and pull-request checklists. Merge changes only after verifying local runs and documenting new configuration.

## License
ISC
