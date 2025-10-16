# Session Notes - Track Attendance API Setup

## Date: 2025-10-15

## Objective
Set up and run the Track Attendance API server with Neon PostgreSQL database.

## Current Status

### ✅ Completed

1. **Environment Configuration**
   - `.env` file configured with DATABASE_URL, API_KEY, PORT
   - DATABASE_URL includes `channel_binding=require` for enhanced security
   - Connected to Neon PostgreSQL (ap-southeast-1 region)

2. **Database Schema Setup**
   - Applied `Postgres-schema.sql` to Neon database
   - `scans` table created with idempotency support
   - **Schema simplified to match local QR app:**
     - Removed `event_id` (not needed for simple attendance tracking)
     - Renamed `device_id` → `station_name` (matches local DB)
     - Renamed `employee_ref` → `badge_id` (matches local DB)
   - Indexes on: badge_id, station_name, scanned_at
   - Verified schema structure matches both server.ts and local QR app

3. **Database Connection Testing**
   - Verified connection with channel_binding=require
   - Test script: `testscript/test-neon.js`
   - Successfully connected and queried PostgreSQL 17.5

4. **Dependencies Installation**
   - All npm packages installed
   - TypeScript, Fastify, pg, dotenv configured

5. **API Server**
   - Server running on port 5000
   - Started with `npm run dev`
   - Health check endpoint responding

6. **API Integration Testing**
   - Created comprehensive test suite: `testscript/test-api-insert.js`
   - All 7 tests passed:
     - ✓ Health check
     - ✓ Unauthorized access (401)
     - ✓ Single scan insert
     - ✓ Batch insert (3 records)
     - ✓ Idempotency (duplicate detection)
     - ✓ Insert without meta field
     - ✓ Invalid date validation
   - 5 records successfully inserted into database

7. **Project Organization**
   - Test scripts moved to `testscript/` folder
   - Added `testscript/` to .gitignore
   - Cleaned up unused test files

8. **QR Standalone Project Integration Opportunity**
   - Found Python-based QR scanning app at `C:\Workspace\Dev\Python\QR`
   - Offline desktop app with SQLite storage
   - **Aligned schemas for seamless cloud sync integration**

9. **Schema Alignment & Timestamp Standardization**
   - **Updated QR Python app to use UTC timestamps:**
     - Changed `ISO_TIMESTAMP_FORMAT` from `%Y-%m-%dT%H:%M:%S` to `%Y-%m-%dT%H:%M:%SZ`
     - Updated `database.py` to use `datetime.now(timezone.utc)`
     - Updated `attendance.py` to use UTC timestamps
     - Created `tests/test_utc_timestamps.py` - all tests passing
   - **Perfect 1:1 field mapping achieved:**
     - Local `badge_id` ↔ Cloud `badge_id` ✓
     - Local `station_name` ↔ Cloud `station_name` ✓
     - Local `scanned_at` ↔ Cloud `scanned_at` ✓ (both use UTC with Z)
   - **No timestamp conversion needed during sync!**

## Server Endpoints

- `GET /healthz` - Health check (unauthenticated)
- `POST /v1/scans/batch` - Batch attendance scan ingestion (requires Bearer token)

## API Schema

### POST /v1/scans/batch Request Body
```json
{
  "events": [{
    "idempotency_key": "unique-key-per-scan",
    "badge_id": "employee-badge-id",
    "station_name": "scanner-station-name",
    "scanned_at": "2025-10-15T10:30:00Z",
    "meta": {
      "matched": true,
      "location": "Main Gate"
    }
  }]
}
```

**Note:** Schema simplified from original design - removed `event_id`, renamed fields to match local QR app database.

### Field Explanations

**`idempotency_key`** (Required)
- Prevents duplicate scans from network retries
- Should be unique per scan event
- Example format: `{station_name}-{badge_id}-{timestamp}`
- **Critical for data integrity in production**

**`badge_id`** (Required)
- Employee identifier (badge ID scanned from QR/barcode)
- Maps directly to local database `badge_id` field
- Examples: "101117", "EMP001"

**`station_name`** (Required)
- Identifies the scanning station/location
- Maps directly to local database `station_name` field
- Examples: "Main Gate", "Side Entrance"

**`scanned_at`** (Required)
- ISO8601 timestamp with timezone (UTC)
- Format: `YYYY-MM-DDTHH:MM:SSZ` (e.g., `2025-10-15T12:30:45Z`)
- QR app automatically generates in correct UTC format
- **No conversion needed during sync!**

**`meta`** (Optional)
- JSONB field for additional context
- **Privacy consideration:** Does NOT store employee names or PII
- Recommended fields:
  - `matched`: boolean - whether employee was found in local DB
  - `local_id`: number - reference to local SQLite scan ID
- Examples of additional fields: location, temperature, GPS coords

## Next Steps

### Ready for Implementation
1. **QR App Cloud Sync Module**
   - Schema alignment: ✅ Complete (1:1 field mapping)
   - Timestamp format: ✅ Complete (UTC with Z suffix)
   - Privacy design: ✅ Complete (no PII in cloud)
   - Next: Implement Python sync service with:
     - Batch upload with retry logic
     - Idempotency key generation: `{station_name}-{badge_id}-{id}`
     - Sync status tracking (pending/synced/failed)

2. **API Improvements**
   - Add GET endpoint to query scans
   - Add filtering by date range, employee, device
   - Add aggregation endpoints (daily stats, etc.)

3. **Monitoring & Observability**
   - Add structured logging
   - Add metrics endpoint (Prometheus format)
   - Add health checks for database connectivity

## Notes

- Server runs on port 5000 (configurable via PORT env var)
- Database connection uses pooling (max 20 connections)
- Graceful shutdown handlers configured for SIGTERM/SIGINT
- Test scripts located in `testscript/` folder (git-ignored)
- Channel binding enabled for enhanced PostgreSQL security

## Test Scripts

### Database Connection Test
```bash
npx tsx testscript/test-neon.js
```

### API Integration Test
```bash
# Start server first
npm run dev

# In another terminal
npx tsx testscript/test-api-insert.js
```

### Timestamp Conversion Test
```bash
npx tsx testscript/test-timestamp-conversion.js
```

### QR App UTC Timestamp Test
```bash
cd C:\Workspace\Dev\Python\QR
python tests\test_utc_timestamps.py
```

## Related Projects

### **QR Standalone App** (`C:\Workspace\Dev\Python\QR`)

**Technology Stack:**
- Python/PyQt6 desktop application
- SQLite local database
- Offline-first architecture

**Schema (SQLite):**
```sql
scans:
- id INTEGER (auto)
- badge_id TEXT
- station_name TEXT
- scanned_at TEXT  -- Format: "2025-10-15T12:30:45Z" (UTC)
- employee_full_name TEXT (nullable)
- legacy_id TEXT (nullable)
- sl_l1_desc TEXT (nullable)
- position_desc TEXT (nullable)
```

**Cloud API Mapping:**
| Local Field | Cloud Field | Sync Notes |
|-------------|-------------|------------|
| `badge_id` | `badge_id` | Direct copy |
| `station_name` | `station_name` | Direct copy |
| `scanned_at` | `scanned_at` | Direct copy (already UTC!) |
| `employee_full_name` | — | **NOT synced** (privacy) |
| `legacy_id` | `meta.legacy_id` | Optional |
| `sl_l1_desc` | — | **NOT synced** (privacy) |
| `position_desc` | — | **NOT synced** (privacy) |

**Integration Status:**
- ✅ Schema aligned
- ✅ Timestamp format standardized (UTC)
- ✅ Privacy-preserving design (no PII in cloud)
- 🔄 Ready for sync module implementation
