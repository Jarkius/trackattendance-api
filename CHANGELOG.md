# Changelog

Notable changes to the TrackAttendance API. Every merge to `main` deploys to Cloud Run (`.github/workflows/deploy.yml`).

## 2026-11-24

### Added

- **Attendance buckets on both stats endpoints** (`/v1/dashboard/stats`, `/v1/dashboard/public/stats`), PR #28:
  - `matched_unique`: registered employees who attended (`business_unit IS NOT NULL OR meta.matched = true`). This is the only numerator of the attendance rate.
  - `walkin_unique`: unmatched scans with `scan_source = 'manual'` (typed names of people missing from the roster), deduplicated after lower-casing, trimming and collapsing spaces.
  - `unknown_badge_unique`: unmatched scans from any other source (garbled or unknown badges that need review).

  The fields are additive. Older kiosks ignore them, and kiosk v2.1.11+ falls back to the BU sum when they are missing.
- **Public dashboard** rate is now `matched_unique / total_registered`, capped at 100%, with walk-ins shown as a separate "+N Walk-in" figure.

### Fixed

- **Refused requests no longer show up as application errors** (PR #29). The auth hook used to throw on a missing or wrong key, so every bot probe and browser favicon request was logged with a stack trace and showed up in Error Reporting as "Error: Unauthorized". It now replies 401 directly. The status and body (`{statusCode, error, message}`) are unchanged.

### Changed (infrastructure)

- **Dedicated runtime service account.** The service now runs as `trackattendance-api-runtime@…` with no project roles, instead of the default compute account, which has project Editor. The API calls no Google Cloud APIs, so it needs none.
- **Scaling pinned in `deploy.yml`:** `--service-account`, `--min-instances 1` and `--max-instances 5`, so a deploy can never silently revert them. Lower `--min-instances` to `0` between events to save cost (see `docs/handoffs/2026-11-24_event-readiness.md`).
