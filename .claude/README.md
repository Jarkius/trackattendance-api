# Claude Code - Track Attendance API

## Project Overview

Fastify-based HTTP API for cloud attendance tracking, designed for seamless integration with offline QR scanning stations. This API receives batch scan uploads from local stations and stores them in PostgreSQL (Neon) with idempotent deduplication.

**Related Project:** `C:\Workspace\Dev\Python\QR` - Offline QR scanning desktop app (Python/PyQt6)

## Key Architectural Decisions

### 1. Simplified Schema (Oct 2025)
**Decision:** Removed `event_id` field, renamed `device_id` → `station_name`, `employee_ref` → `badge_id`

**Rationale:**
- Direct 1:1 mapping with local QR app SQLite database
- Simpler sync logic (no field conversion needed)
- `event_id` was redundant for simple attendance tracking

**Schema:**
```sql
scans:
- id (bigint, auto)
- idempotency_key (text, unique)
- badge_id (text)           -- Employee badge scanned
- station_name (text)        -- Scanning station location
- scanned_at (timestamptz)   -- UTC timestamp
- meta (jsonb)               -- Additional context (NO PII)
- created_at (timestamptz)   -- Auto timestamp
```

### 2. UTC Timestamps Everywhere
**Decision:** Standardized on `YYYY-MM-DDTHH:MM:SSZ` format (ISO8601 with Z suffix)

**Rationale:**
- Updated Python QR app to use `datetime.now(timezone.utc)`
- No timezone conversion needed during sync
- Cloud API validation accepts format directly
- Consistent across all stations

**Implementation:**
- Local: `ISO_TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"`
- Cloud: Direct storage as `timestamptz`

### 3. Privacy-Preserving Design
**Decision:** Cloud stores only scan events, NOT employee PII

**Rationale:**
- Employee names stay in local database only
- Cloud only needs: badge_id, station_name, timestamp
- `meta` field can include `matched` flag but no names
- Reporting pulls from cloud + joins with local employee DB

**Field Mapping:**
| Local SQLite | Cloud API | Notes |
|--------------|-----------|-------|
| `badge_id` | `badge_id` | Direct copy |
| `station_name` | `station_name` | Direct copy |
| `scanned_at` | `scanned_at` | Direct copy (UTC!) |
| `employee_full_name` | — | **NOT synced** |
| `legacy_id` | `meta.legacy_id` | Optional |
| `sl_l1_desc` | — | **NOT synced** |
| `position_desc` | — | **NOT synced** |

## Current Implementation Status

### ✅ Completed
- [x] Neon PostgreSQL database setup (ap-southeast-1)
- [x] Schema simplified and aligned with local QR app
- [x] API endpoints functional (`/healthz`, `/v1/scans/batch`)
- [x] UTC timestamp standardization in QR app
- [x] Idempotency key support
- [x] Comprehensive test suite
- [x] Documentation (README, SESSION-NOTES, this file)

### 🔄 In Progress
- [x] Python sync module for QR app (**Phase 1 Complete: Manual Sync**)
  - [x] Database schema with sync tracking (sync_status, synced_at, sync_error)
  - [x] Sync service (`sync.py`) with connection test and batch upload
  - [x] QWebChannel API methods (sync_now, get_sync_status, test_connection)
  - [x] UI components (Sync Now button, status display, CSS styling)
  - [ ] **Next:** Integration testing with cloud API
- [ ] Background sync scheduler (Phase 2 - pending)

### 📋 Backlog
- [ ] GET endpoint to query scans
- [ ] Date range filtering
- [ ] Cloud report generation (fetch + join with local DB)
- [ ] Monitoring & observability

## Quick Reference

### Commands
```bash
# Development
npm run dev              # Start with hot reload (tsx watch)
npm run build            # Compile TypeScript to dist/
npm run start            # Run compiled server (production)

# Database
psql "$DATABASE_URL" -f Postgres-schema.sql  # Apply schema
psql "$DATABASE_URL" -c "\d scans"           # View table structure

# Testing
npx tsx testscript/test-neon.js              # Test DB connection
npx tsx testscript/test-api-insert.js        # Test API endpoints
npx tsx testscript/test-timestamp-conversion.js  # Test timestamp formats

# QR App Testing
cd C:\Workspace\Dev\Python\QR
python tests\test_utc_timestamps.py          # Test UTC format
```

### Environment Variables
```bash
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require&channel_binding=require
API_KEY=your-secret-api-key
PORT=5000  # Optional, defaults to 5000
```

### API Usage
```bash
# Health check
curl http://localhost:5000/healthz

# Submit scans (replace YOUR_API_KEY)
curl -X POST http://localhost:5000/v1/scans/batch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "events": [{
      "idempotency_key": "MainGate-101117-20251015T123045Z",
      "badge_id": "101117",
      "station_name": "Main Gate",
      "scanned_at": "2025-10-15T12:30:45Z",
      "meta": {"matched": true}
    }]
  }'
```

## Important Files

### Core Application
- `server.ts` - Main Fastify application entry point
- `Postgres-schema.sql` - Database schema (authoritative source)
- `.env` - Environment configuration (not in git)
- `package.json` - Dependencies and scripts

### Documentation
- `README.md` - Public-facing project documentation
- `SESSION-NOTES.md` - Detailed session history and decisions
- `AGENTS.md` - Contributor guidelines
- `.claude/README.md` - This file (Claude Code context)

### Tests
- `testscript/test-neon.js` - Database connection test
- `testscript/test-api-insert.js` - Full API integration test
- `testscript/test-timestamp-conversion.js` - Timestamp format validation

## Related Projects

### QR Standalone App
**Location:** `C:\Workspace\Dev\Python\QR`

**Purpose:** Offline desktop application for QR/barcode attendance scanning

**Technology:**
- Python 3.8+ / PyQt6
- SQLite local database
- Offline-first architecture

**Integration Status:**
- ✅ Schema aligned (1:1 field mapping)
- ✅ UTC timestamps implemented
- ✅ Privacy design (no PII sync)
- 🔄 Sync module pending

**Key Files:**
- `database.py` - SQLite schema and operations (updated with sync tracking)
- `attendance.py` - Business logic and exports
- `sync.py` - **NEW:** Cloud sync service module
- `main.py` - Updated with SyncService integration
- `web/index.html` - Updated with sync UI components
- `web/script.js` - Updated with sync JavaScript functions
- `web/css/style.css` - Updated with sync component styling
- `tests/test_utc_timestamps.py` - UTC format validation

**Sync Module Implementation (2025-10-16):**
- ✅ **Phase 1 Complete:** Manual sync with "Sync Now" button
  - Database schema extended with `sync_status`, `synced_at`, `sync_error` fields
  - `SyncService` class handles API communication and batch uploads
  - Idempotency keys auto-generated: `{station}-{badge_id}-{id}`
  - UI shows sync statistics (Pending/Synced/Failed counts)
  - Connection test before sync attempt
  - Network error handling with status tracking
- 📋 **Phase 2 Pending:** Background auto-sync scheduler (QTimer-based)
- 📋 **Phase 3 Pending:** Configuration management (API URL, key, intervals)

## Development Workflow

### Starting a New Session
1. Read this file (`.claude/README.md`) for context
2. Read `SESSION-NOTES.md` for recent changes
3. Check git status for uncommitted work
4. Start dev server: `npm run dev`

### Making Schema Changes
1. Update `Postgres-schema.sql`
2. Apply to Neon: `psql "$DATABASE_URL" -f Postgres-schema.sql`
3. Update `server.ts` types and validation
4. Update tests in `testscript/`
5. Document in `SESSION-NOTES.md`

### Adding New Features
1. Use TodoWrite tool for tracking
2. Write/update tests first (TDD)
3. Implement feature
4. Run all tests
5. Update documentation
6. Mark todos as completed

## Known Issues & Gotchas

### Database Connection
- Use `channel_binding=require` for enhanced security
- Connection timeout: 10000ms (increased for Neon reliability)
- Database may auto-suspend (first query takes longer)

### Timestamps
- ALWAYS use UTC with Z suffix: `2025-10-15T12:30:45Z`
- Local QR app generates in correct format (no conversion needed)
- Cloud API validates with `format: "date-time"` in JSON schema

### Idempotency Keys
- Must be unique per scan event
- Recommended format: `{station_name}-{badge_id}-{timestamp_clean}`
- Example: `MainGate-101117-20251015T123045Z`

### Privacy
- NEVER store employee names in cloud `meta` field
- Keep PII in local database only
- Cloud reports must join with local employee.xlsx

## Useful Context for AI Assistants

### When to Use TodoWrite
- Multi-step tasks (3+ steps)
- Complex features requiring planning
- User provides multiple tasks
- Any non-trivial implementation work

### Code Style Preferences
- TypeScript with strict typing
- 2-space indentation
- async/await over promises
- Fastify patterns (plugins, hooks)
- Conventional Commits for git

### Testing Expectations
- Test database connection before API tests
- Use test isolation (no shared state)
- Clean up resources (close connections)
- Verify both success and error cases

### Documentation Standards
- Update SESSION-NOTES.md for significant changes
- Keep README.md user-facing and concise
- Use this file for AI/developer context
- Document WHY, not just WHAT

## Testing the Sync Module

**Prerequisites:**
1. Cloud API running: `npm run dev` in trackattendance-api directory
2. Python QR app with some test scans in database
3. Verify sync columns exist in local database

**Manual Testing Steps:**
```bash
# 1. Start Cloud API (Terminal 1)
cd C:\Workspace\Dev\NodeJS\trackattendance-api
npm run dev

# 2. Verify API is responding
curl http://localhost:5000/healthz

# 3. Run Python QR App (Terminal 2)
cd C:\Workspace\Dev\Python\QR
python main.py

# 4. In QR App UI:
#    - Check "Cloud Sync" card shows statistics
#    - Click "Sync Now" button
#    - Verify success message appears
#    - Check statistics update (Pending should decrease, Synced should increase)

# 5. Verify in Cloud Database
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM scans WHERE badge_id LIKE '%'"
psql "$DATABASE_URL" -c "SELECT * FROM scans ORDER BY created_at DESC LIMIT 5"
```

**Test Scenarios:**
- ✅ Connection test with API running
- ✅ Connection test with API offline (should show error)
- ✅ Sync pending scans
- ✅ Verify idempotency (sync same batch twice)
- ✅ Check cloud database receives data
- ✅ Verify sync statistics update

**Debugging:**
- Check Python console for error messages
- Check Node.js API logs for incoming requests
- Verify API_KEY matches between QR app and cloud API
- Check network connectivity to localhost:5000

## Session Start Checklist

When starting a new Claude Code session:

```bash
# 1. Get context
Read .claude/README.md
Read SESSION-NOTES.md (if recent changes)

# 2. Check environment
git status
npm run dev  # Ensure server starts

# 3. Verify database
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM scans"

# 4. Review current task
# (Check user's request or backlog above)
```

## Contact & Resources

- **Repository:** https://github.com/Jarkius/trackattendance-api
- **Database:** Neon PostgreSQL (ap-southeast-1)
- **Deployment:** TBD
- **Documentation:** See SESSION-NOTES.md for detailed history

---

**Last Updated:** 2025-10-15
**Version:** 1.0 (Initial schema alignment complete)
