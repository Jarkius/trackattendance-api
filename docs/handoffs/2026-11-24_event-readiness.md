# Handoff: API event readiness (2026-11-24)

Event: Friday 2026-11-28, about 1,900 attendees and 10 kiosks. GCP project `trackattendance-20251014`, region `asia-southeast1`, service `trackattendance-api`. See `CHANGELOG.md` for what changed; this file records state, evidence and what is left to do.

## Live state (verified 2026-11-24)
- Serving revision `trackattendance-api-00089-g5x`, 100% of traffic. It runs as `trackattendance-api-runtime@trackattendance-20251014.iam.gserviceaccount.com`, which has no project roles.
- Scaling is set on the revision: min 1, max 5, concurrency 100, 1 vCPU / 1 GiB. The console's service-level "Service scaling" box shows 0; it is unset and expected. Cloud Run uses the higher of the two.
- Rate limits: `RATE_LIMIT_MAX=600`/min per IP and `PUBLIC_RATE_LIMIT_MAX=120`/min per IP, in memory per instance.
- DB: Neon through the pooled endpoint (`-pooler` host), pool max 50 per instance.
- Rollback: revision `trackattendance-api-00087-tmx` (before today's account change) is still available. Use `gcloud run services update-traffic trackattendance-api --region asia-southeast1 --to-revisions <rev>=100`.

## Evidence
- **Load test against prod** (throwaway `LOADTEST-*` stations, deleted afterwards):
  - 8 stations at about 7× the expected peak: 360/360 scans arrived. Kiosk round trip p50 141 ms, p95 513 ms.
  - Burst of 2,400 pending scans: all arrived within 1 s.
  - Concurrent resend: 0 duplicate rows.
  - Server side, batch p50 21 ms; one instance handled it all; no 429s or 5xx.
- **Expected event load:** about 32 scans/min and about 50 requests/min across 10 kiosks, under 10% of the per-IP limit even behind one NAT.
- **30-day log review:**
  - Authenticated traffic came only from the owner's own devices (confirmed by the owner).
  - There were 28 refused requests, all bots probing for LLM proxies (`/api-proxy/v1beta/*`, `/v1/models`) or browser favicon fetches. No brute force.
  - Audit log shows only the owner and the deploy SA making changes.
- Logs are kept for 30 days only. Export them if a post-event review is needed.

## Before the event (owner)
1. Clear the old cloud scans (66 at handoff) from the kiosk Admin Panel. This also resets the roster summary, and kiosks re-upload it on their next roster check.
2. Give each of the 10 kiosks a unique station name before doors open. Do not rename a station mid-event; a rename while scans are pending can duplicate them in the cloud.
3. Open the dashboard once and confirm all 10 stations appear.

## After the event (cost)
- `gcloud run services update trackattendance-api --region asia-southeast1 --project trackattendance-20251014 --min-instances 0`, and change `--min-instances 1` to `0` in `deploy.yml`, or the next deploy restores 1.
- Close the kiosk apps; their heartbeats keep an instance warm.
- Optional: an Artifact Registry cleanup policy (keep the last 5 images), and a billing budget alert.

## Open / deferred
- `DATABASE_URL` and `API_KEY` are plain env vars on the service (readable by anyone with view access; only the owner has it today). Move them to Secret Manager after the event and grant `roles/secretmanager.secretAccessor` to the runtime SA only.
- `/healthz` returns 404 on Cloud Run (Google reserves paths ending in `z`). Monitoring should use `/`.
- A project API key "API key 1" (Vertex AI) exists; delete it if Vertex isn't used.
- The `claude-review` workflow fails on every PR. It is not a required check (only `check` is).
