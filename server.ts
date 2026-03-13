// server.ts
import Fastify from "fastify";
import pg from "pg";
import crypto from "crypto";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import path from "path";
import 'dotenv/config';

// ---- config ----
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}
if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable is required");
}

const app = Fastify({
  logger: true,
  requestTimeout: 30000
});

// ---- database pool ----
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 50,              // Support 10+ stations + dashboard polling concurrently
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 5000,  // Fail faster to allow client retry
});

pool.on('error', (err) => {
  console.error('Database pool error:', err);
});

const API_KEY = process.env.API_KEY;
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "60", 10);
const RATE_LIMIT_WINDOW = process.env.RATE_LIMIT_WINDOW || "1 minute";
const PUBLIC_RATE_LIMIT_MAX = parseInt(process.env.PUBLIC_RATE_LIMIT_MAX || "30", 10);

// ---- meta field validation (#8) ----
const META_MAX_PROPERTIES = 20;
const META_MAX_KEY_LENGTH = 64;
const META_MAX_STRING_LENGTH = 512;
const META_MAX_SIZE_BYTES = 10240; // 10KB

function validateMeta(meta: any): string | null {
  if (meta === null || meta === undefined) return null;
  if (typeof meta !== 'object' || Array.isArray(meta)) {
    return "meta must be a flat object or null";
  }

  const keys = Object.keys(meta);
  if (keys.length > META_MAX_PROPERTIES) {
    return `meta exceeds maximum of ${META_MAX_PROPERTIES} properties`;
  }

  for (const key of keys) {
    if (key.length > META_MAX_KEY_LENGTH) {
      return `meta key "${key.slice(0, 20)}..." exceeds ${META_MAX_KEY_LENGTH} characters`;
    }

    const val = meta[key];
    const t = typeof val;
    if (val !== null && t !== 'string' && t !== 'number' && t !== 'boolean') {
      return `meta.${key} has unsupported type "${t}" (only string, number, boolean, null allowed)`;
    }
    if (t === 'string' && (val as string).length > META_MAX_STRING_LENGTH) {
      return `meta.${key} string value exceeds ${META_MAX_STRING_LENGTH} characters`;
    }
  }

  // Check total serialized size
  const serialized = JSON.stringify(meta);
  if (serialized.length > META_MAX_SIZE_BYTES) {
    return `meta exceeds maximum size of ${META_MAX_SIZE_BYTES} bytes`;
  }

  return null;
}

// ---- bootstrap ----
async function bootstrap() {

// ---- Issue #7: Eager DB connection test ----
try {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    app.log.info("Database connection verified");
  } finally {
    client.release();
  }
} catch (err) {
  app.log.error({ err }, "Failed to connect to database at startup");
  process.exit(1);
}

// ---- run migration ----
try {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE scans ADD COLUMN IF NOT EXISTS business_unit TEXT
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_scans_business_unit ON scans (business_unit)
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS roster_summary (
        business_unit TEXT PRIMARY KEY,
        registered INTEGER NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS roster_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    await client.query(`
      ALTER TABLE scans ADD COLUMN IF NOT EXISTS scan_source TEXT NOT NULL DEFAULT 'manual'
    `);
    await client.query(`
      ALTER TABLE scans ALTER COLUMN scan_source SET DEFAULT 'manual'
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS station_heartbeat (
        station_name      TEXT PRIMARY KEY,
        last_clear_epoch  TEXT,
        local_scan_count  INTEGER NOT NULL DEFAULT 0,
        last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // Composite indexes for live event performance (10+ stations)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_scans_badge_station_time ON scans (badge_id, station_name, scanned_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_scans_station_scanned_at ON scans (station_name, scanned_at DESC)
    `);
    app.log.info("Database migration check complete");
  } finally {
    client.release();
  }
} catch (err) {
  app.log.warn({ err }, "Migration check failed (non-fatal)");
}

// ---- rate limiting ----
await app.register(rateLimit, {
  max: RATE_LIMIT_MAX,
  timeWindow: RATE_LIMIT_WINDOW,
  allowList: [],
  keyGenerator: (req) => req.ip,
  skipOnError: true,
  errorResponseBuilder: (_req, context) => ({
    statusCode: 429,
    error: "Too Many Requests",
    message: `Rate limit exceeded, retry in ${context.after}`,
  }),
});

// ---- static files for public dashboard ----
await app.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/dashboard/',
  decorateReply: false,
});

// ---- health (with in-memory cache to avoid DB hit on every probe) ----
let healthCache: { ok: boolean; db: string; ts: number } | null = null;
const HEALTH_CACHE_MS = 5000;

app.get("/healthz", { config: { rateLimit: false } }, async () => {
  const now = Date.now();
  if (healthCache && (now - healthCache.ts) < HEALTH_CACHE_MS) {
    return { ok: healthCache.ok, db: healthCache.db };
  }
  // Issue #7: Health check verifies DB connectivity
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
    healthCache = { ok: true, db: "connected", ts: now };
    return { ok: true, db: "connected" };
  } catch {
    healthCache = { ok: false, db: "disconnected", ts: now };
    return { ok: false, db: "disconnected" };
  }
});

app.get("/", { config: { rateLimit: false } }, async () => {
  let clear_epoch: string | null = null;
  try {
    const client = await pool.connect();
    try {
      const result = await client.query("SELECT value FROM roster_meta WHERE key = 'clear_epoch'");
      clear_epoch = result.rows[0]?.value || null;
    } finally {
      client.release();
    }
  } catch { /* non-fatal */ }
  return {
    status: "ok",
    service: "Track Attendance API",
    version: "1.2.0",
    clear_epoch,
    timestamp: new Date().toISOString(),
  };
});

// ---- auth middleware ----
app.addHook("onRequest", async (req, reply) => {
  // Bypass authentication for health checks and public endpoints
  if (req.url === "/healthz" || req.url === "/") return;
  if (req.url.startsWith("/v1/dashboard/public")) return;
  if (req.url.startsWith("/v1/stations/status")) return;
  if (req.url.startsWith("/dashboard/")) return;

  const auth = req.headers.authorization || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (!token || !API_KEY) {
    reply.code(401);
    throw new Error("Unauthorized");
  }
  const tokenBuf = Buffer.from(token);
  const keyBuf = Buffer.from(API_KEY);
  if (tokenBuf.length !== keyBuf.length || !crypto.timingSafeEqual(tokenBuf, keyBuf)) {
    reply.code(401);
    throw new Error("Unauthorized");
  }
});

// ---- JSON schema validation ----
const batchSchema = {
  body: {
    type: "object",
    required: ["events"],
    properties: {
      events: {
        type: "array",
        items: {
          type: "object",
          required: [
            "idempotency_key",
            "badge_id",
            "station_name",
            "scanned_at",
          ],
          properties: {
            idempotency_key: { type: "string", minLength: 8, maxLength: 128 },
            badge_id: { type: "string", minLength: 1, maxLength: 128 },
            station_name: { type: "string", minLength: 1, maxLength: 128 },
            scanned_at: { type: "string", format: "date-time" },
            meta: { type: ["object", "null"] },
            business_unit: { type: ["string", "null"], maxLength: 256 },
            scan_source: { type: ["string", "null"], maxLength: 32 },
          },
          additionalProperties: false,
        },
        maxItems: 2000,
      },
    },
    additionalProperties: false,
  },
};

type ScanInput = {
  idempotency_key: string;
  badge_id: string;
  station_name: string;
  scanned_at: string;
  meta?: Record<string, any> | null;
  business_unit?: string | null;
  scan_source?: string;
};

interface BatchRequest {
  Body: {
    events: ScanInput[];
  };
}

// ---- roster summary schema ----
const rosterSummarySchema = {
  body: {
    type: "object",
    required: ["business_units"],
    properties: {
      business_units: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "registered"],
          properties: {
            name: { type: "string", maxLength: 256 },
            registered: { type: "integer", minimum: 0 },
          },
          additionalProperties: false,
        },
        maxItems: 200,
      },
    },
    additionalProperties: false,
  },
};

interface RosterSummaryRequest {
  Body: {
    business_units: Array<{ name: string; registered: number }>;
  };
}

// ---- roster summary endpoints ----

// GET /v1/roster/hash — check if roster needs updating (authenticated)
app.get("/v1/roster/hash", async (req, reply) => {
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT value FROM roster_meta WHERE key = 'hash'");
    return { hash: result.rows[0]?.value || null };
  } finally {
    client.release();
  }
});

// POST /v1/roster/summary — full replace of BU counts (authenticated)
app.post<RosterSummaryRequest>("/v1/roster/summary", { schema: rosterSummarySchema }, async (req, reply) => {
  const { business_units } = req.body;

  // Compute hash from payload to enable dedup across stations
  const hashInput = business_units
    .map(bu => `${bu.name}:${bu.registered}`)
    .sort()
    .join("|");
  const rosterHash = crypto.createHash("sha256").update(hashInput).digest("hex").slice(0, 16);

  const client = await pool.connect();
  try {
    // Check if hash matches — skip update if same roster already stored
    const existing = await client.query("SELECT value FROM roster_meta WHERE key = 'hash'");
    if (existing.rows[0]?.value === rosterHash) {
      return { saved: business_units.length, skipped: true, hash: rosterHash };
    }

    await client.query("BEGIN");
    await client.query("DELETE FROM roster_summary");

    if (business_units.length > 0) {
      const names = business_units.map(bu => bu.name);
      const registered = business_units.map(bu => bu.registered);

      await client.query(`
        INSERT INTO roster_summary (business_unit, registered)
        SELECT * FROM unnest($1::text[], $2::integer[])
      `, [names, registered]);
    }

    // Store hash
    await client.query(`
      INSERT INTO roster_meta (key, value) VALUES ('hash', $1)
      ON CONFLICT (key) DO UPDATE SET value = $1
    `, [rosterHash]);

    await client.query("COMMIT");

    return { saved: business_units.length, skipped: false, hash: rosterHash };
  } catch (e: any) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError: any) {
      app.log.error({ err: rollbackError }, "Rollback failed");
    }
    app.log.error({ err: e }, "Roster summary update failed");
    reply.code(500);
    return { error: "Failed to update roster summary" };
  } finally {
    client.release();
  }
});

// ---- batch endpoint ----
app.post<BatchRequest>("/v1/scans/batch", { schema: batchSchema }, async (req, reply) => {
  const events = req.body.events;
  if (!events?.length) return { saved: 0, duplicates: 0, errors: 0 };

  // Validate meta fields (#8)
  for (const ev of events) {
    if (ev.meta !== undefined && ev.meta !== null) {
      const metaError = validateMeta(ev.meta);
      if (metaError) {
        reply.code(400);
        return { error: metaError, saved: 0, duplicates: 0, errors: events.length };
      }
    }
  }

  const client = await pool.connect();
  try {
    await client.query("begin");

    const keys: string[] = [];
    const badgeIds: string[] = [];
    const stationNames: string[] = [];
    const scannedAts: Date[] = [];
    const metas: any[] = [];
    const businessUnits: (string | null)[] = [];
    const scanSources: string[] = [];

    for (const ev of events) {
      keys.push(ev.idempotency_key);
      badgeIds.push(ev.badge_id);
      stationNames.push(ev.station_name);

      const date = new Date(ev.scanned_at);
      if (isNaN(date.getTime())) {
        throw new Error(`Invalid date format: ${ev.scanned_at}`);
      }
      scannedAts.push(date);
      metas.push(ev.meta ?? null);
      businessUnits.push(ev.business_unit ?? null);
      const src = ev.scan_source ?? "manual";
      scanSources.push(src);
    }

    const insertSql = `
      insert into scans
        (idempotency_key, badge_id, station_name, scanned_at, meta, business_unit, scan_source)
      select *
      from unnest(
        $1::text[],
        $2::text[],
        $3::text[],
        $4::timestamptz[],
        $5::jsonb[],
        $6::text[],
        $7::text[]
      )
      on conflict (idempotency_key) do nothing
      returning idempotency_key
    `;

    const res = await client.query(insertSql, [
      keys,
      badgeIds,
      stationNames,
      scannedAts,
      metas,
      businessUnits,
      scanSources,
    ]);

    await client.query("commit");

    const savedSet = new Set(res.rows.map((r) => r.idempotency_key));
    const duplicates = keys.length - savedSet.size;

    return {
      saved: savedSet.size,
      duplicates,
      errors: 0,
    };
  } catch (e: any) {
    try {
      await client.query("rollback");
    } catch (rollbackError: any) {
      app.log.error({ err: rollbackError }, "Rollback failed");
    }
    app.log.error({ err: e }, "Batch processing failed");
    reply.code(500);
    return {
      error: "Failed to process batch",
      saved: 0,
      duplicates: 0,
      errors: events.length
    };
  } finally {
    client.release();
  }
});

// ---- dashboard endpoints ----

// GET /v1/dashboard/stats - Authenticated aggregated stats
app.get("/v1/dashboard/stats", async (req, reply) => {
  const client = await pool.connect();
  try {
    const summaryResult = await client.query(`
      SELECT
        COUNT(*) as total_scans,
        COUNT(DISTINCT badge_id) as unique_badges
      FROM scans
    `);

    const stationsResult = await client.query(`
      SELECT
        station_name,
        COUNT(*) as total_scans,
        COUNT(DISTINCT badge_id) as unique_badges,
        MAX(scanned_at) as last_scan
      FROM scans
      GROUP BY station_name
      ORDER BY station_name ASC
    `);

    const buResult = await client.query(`
      WITH scan_bu AS (
        SELECT COALESCE(business_unit, 'Unmatched') AS bu,
               COUNT(DISTINCT badge_id) AS unique_badges
        FROM scans
        GROUP BY COALESCE(business_unit, 'Unmatched')
      )
      SELECT
        COALESCE(s.bu, r.business_unit, 'Unmatched') AS business_unit,
        COALESCE(r.registered, 0) AS registered,
        COALESCE(s.unique_badges, 0) AS unique_badges
      FROM scan_bu s
      FULL OUTER JOIN roster_summary r ON s.bu = r.business_unit
      ORDER BY CASE WHEN COALESCE(s.bu, r.business_unit, 'Unmatched') = 'Unmatched' THEN 1 ELSE 0 END,
               COALESCE(s.bu, r.business_unit, 'Unmatched') ASC
    `);

    const summary = summaryResult.rows[0];
    const stations = stationsResult.rows.map(row => ({
      name: row.station_name,
      scans: parseInt(row.total_scans),
      unique: parseInt(row.unique_badges),
      last_scan: row.last_scan ? new Date(row.last_scan).toISOString() : null,
    }));

    const business_units = buResult.rows.map(row => ({
      name: row.business_unit,
      registered: parseInt(row.registered) || 0,
      unique: parseInt(row.unique_badges) || 0,
    }));

    return {
      total_scans: parseInt(summary.total_scans),
      unique_badges: parseInt(summary.unique_badges),
      stations,
      business_units,
      timestamp: new Date().toISOString(),
    };
  } catch (e: any) {
    app.log.error({ err: e }, "Dashboard stats query failed");
    reply.code(500);
    throw new Error("Failed to fetch dashboard stats");
  } finally {
    client.release();
  }
});

// GET /v1/dashboard/public/stats - Unauthenticated public stats (stricter rate limit)
app.get("/v1/dashboard/public/stats", {
  config: {
    rateLimit: {
      max: PUBLIC_RATE_LIMIT_MAX,
      timeWindow: RATE_LIMIT_WINDOW,
    }
  }
}, async (req, reply) => {
  const client = await pool.connect();
  try {
    const summaryResult = await client.query(`
      SELECT
        COUNT(*) as total_scans,
        COUNT(DISTINCT badge_id) as unique_badges
      FROM scans
    `);

    const stationsResult = await client.query(`
      SELECT
        station_name,
        COUNT(DISTINCT badge_id) as unique_badges
      FROM scans
      GROUP BY station_name
      ORDER BY station_name ASC
    `);

    const buResult = await client.query(`
      WITH scan_bu AS (
        SELECT COALESCE(business_unit, 'Unmatched') AS bu,
               COUNT(DISTINCT badge_id) AS unique_badges
        FROM scans
        GROUP BY COALESCE(business_unit, 'Unmatched')
      )
      SELECT
        COALESCE(s.bu, r.business_unit, 'Unmatched') AS business_unit,
        COALESCE(r.registered, 0) AS registered,
        COALESCE(s.unique_badges, 0) AS unique_badges
      FROM scan_bu s
      FULL OUTER JOIN roster_summary r ON s.bu = r.business_unit
      ORDER BY CASE WHEN COALESCE(s.bu, r.business_unit, 'Unmatched') = 'Unmatched' THEN 1 ELSE 0 END,
               COALESCE(s.bu, r.business_unit, 'Unmatched') ASC
    `);

    // Scan timeline: 10-minute buckets for the last 3 hours (with gap-filling)
    const timelineResult = await client.query(`
      WITH buckets AS (
        SELECT generate_series(
          date_trunc('hour', NOW() - INTERVAL '3 hours') + INTERVAL '10 min' * FLOOR(EXTRACT(MINUTE FROM NOW() - INTERVAL '3 hours') / 10),
          NOW(),
          INTERVAL '10 minutes'
        ) AS bucket
      ),
      scan_counts AS (
        SELECT
          date_trunc('hour', scanned_at) + INTERVAL '10 min' * FLOOR(EXTRACT(MINUTE FROM scanned_at) / 10) AS bucket,
          COUNT(*) AS scans
        FROM scans
        WHERE scanned_at >= NOW() - INTERVAL '3 hours'
        GROUP BY 1
      )
      SELECT b.bucket, COALESCE(s.scans, 0) AS scans
      FROM buckets b
      LEFT JOIN scan_counts s ON b.bucket = s.bucket
      ORDER BY b.bucket ASC
    `);

    const summary = summaryResult.rows[0];

    const buRows = buResult.rows.map(row => ({
      name: row.business_unit,
      registered: parseInt(row.registered) || 0,
      unique: parseInt(row.unique_badges) || 0,
    }));

    const total_registered = buRows.reduce((sum, b) => sum + b.registered, 0);

    return {
      total_scans: parseInt(summary.total_scans),
      unique_badges: parseInt(summary.unique_badges),
      total_registered,
      stations: stationsResult.rows.map(row => ({
        name: row.station_name,
        unique: parseInt(row.unique_badges),
      })),
      business_units: buRows,
      timeline: timelineResult.rows.map(row => ({
        time: new Date(row.bucket).toISOString(),
        scans: parseInt(row.scans),
      })),
      timestamp: new Date().toISOString(),
    };
  } catch (e: any) {
    app.log.error({ err: e }, "Public dashboard stats query failed");
    reply.code(500);
    throw new Error("Failed to fetch public dashboard stats");
  } finally {
    client.release();
  }
});

// GET /v1/dashboard/public/config - Unauthenticated dashboard config
app.get("/v1/dashboard/public/config", {
  config: {
    rateLimit: {
      max: PUBLIC_RATE_LIMIT_MAX,
      timeWindow: RATE_LIMIT_WINDOW,
    }
  }
}, async (req, reply) => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT value FROM roster_meta WHERE key = 'dashboard_refresh_interval'"
    );
    const interval = result.rows.length > 0 ? parseInt(result.rows[0].value) : 60;
    return { refresh_interval: interval };
  } finally {
    client.release();
  }
});

// PUT /v1/dashboard/config - Authenticated: set dashboard config
app.put("/v1/dashboard/config", async (req, reply) => {
  const body = req.body as any;
  const interval = parseInt(body?.refresh_interval);
  if (isNaN(interval) || (interval !== 0 && (interval < 10 || interval > 600))) {
    reply.code(400);
    return { error: "refresh_interval must be 0 (manual only) or 10-600 seconds" };
  }
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO roster_meta (key, value) VALUES ('dashboard_refresh_interval', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [String(interval)]
    );
    app.log.info({ refresh_interval: interval }, "Dashboard config updated");
    return { refresh_interval: interval };
  } finally {
    client.release();
  }
});

// GET /v1/dashboard/export - Authenticated export for Excel
interface ExportQuery {
  Querystring: {
    limit?: string;
  };
}

app.get<ExportQuery>("/v1/dashboard/export", async (req, reply) => {
  const limit = Math.min(parseInt(req.query.limit || "100000"), 100000);

  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT
        badge_id,
        station_name,
        scanned_at,
        meta->>'matched' as matched,
        meta->>'legacy_id' as legacy_id,
        business_unit,
        scan_source
      FROM scans
      ORDER BY scanned_at ASC
      LIMIT $1
    `, [limit]);

    const scans = result.rows.map(row => ({
      badge_id: row.badge_id,
      legacy_id: row.legacy_id || null,
      station_name: row.station_name,
      scanned_at: row.scanned_at ? new Date(row.scanned_at).toISOString() : null,
      matched: row.matched === 'true',
      business_unit: row.business_unit || null,
      scan_source: row.scan_source || 'manual',
    }));

    return {
      total_records: scans.length,
      export_timestamp: new Date().toISOString(),
      scans,
    };
  } catch (e: any) {
    app.log.error({ err: e }, "Dashboard export query failed");
    reply.code(500);
    throw new Error("Failed to export dashboard data");
  } finally {
    client.release();
  }
});

// ---- admin endpoints ----

app.get("/v1/admin/scan-count", async (req, reply) => {
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT COUNT(*) as count FROM scans");
    return {
      count: parseInt(result.rows[0].count),
      timestamp: new Date().toISOString(),
    };
  } catch (e: any) {
    reply.code(500);
    return { error: "Failed to get scan count" };
  } finally {
    client.release();
  }
});

app.delete("/v1/admin/clear-scans", async (req, reply) => {
  const confirmHeader = req.headers["x-confirm-delete"];
  if (confirmHeader !== "DELETE ALL SCANS") {
    reply.code(400);
    return {
      error: "Missing or invalid X-Confirm-Delete header",
      message: "Set header 'X-Confirm-Delete: DELETE ALL SCANS' to confirm",
    };
  }

  const client = await pool.connect();
  try {
    const countResult = await client.query("SELECT COUNT(*) as count FROM scans");
    const deletedCount = parseInt(countResult.rows[0].count);

    await client.query("BEGIN");
    await client.query("TRUNCATE TABLE scans");
    await client.query("TRUNCATE TABLE roster_summary");
    const clearEpoch = new Date().toISOString();
    await client.query(`
      INSERT INTO roster_meta (key, value) VALUES ('clear_epoch', $1)
      ON CONFLICT (key) DO UPDATE SET value = $1
    `, [clearEpoch]);
    // Reset roster hash so next import will re-upload
    await client.query("DELETE FROM roster_meta WHERE key = 'hash'");
    // Clear stale heartbeats — active stations will re-register on next health check
    await client.query("TRUNCATE TABLE station_heartbeat");
    await client.query("COMMIT");

    app.log.info(`Admin: Cleared ${deletedCount} scans + roster from cloud database, epoch=${clearEpoch}`);

    return {
      ok: true,
      deleted: deletedCount,
      clear_epoch: clearEpoch,
      message: `Cleared ${deletedCount} scan(s) + roster from cloud database`,
      timestamp: new Date().toISOString(),
    };
  } catch (e: any) {
    try { await client.query("ROLLBACK"); } catch {}
    app.log.error({ err: e }, "Admin clear-scans failed");
    reply.code(500);
    return {
      ok: false,
      error: "Failed to clear scans",
      message: e.message,
    };
  } finally {
    client.release();
  }
});

// DELETE /v1/admin/clear-station — clear scans for a single station
app.delete("/v1/admin/clear-station", async (req, reply) => {
  const confirmHeader = req.headers["x-confirm-delete"];
  if (confirmHeader !== "DELETE STATION SCANS") {
    reply.code(400);
    return { error: "Missing or invalid X-Confirm-Delete header" };
  }

  const station = (req.query as any)?.station;
  if (!station || typeof station !== "string" || station.length > 128) {
    reply.code(400);
    return { error: "Missing or invalid 'station' query parameter (must be a non-empty string, max 128 characters)" };
  }

  const client = await pool.connect();
  try {
    const countResult = await client.query(
      "SELECT COUNT(*) as count FROM scans WHERE station_name = $1", [station]
    );
    const deletedCount = parseInt(countResult.rows[0].count);

    await client.query("DELETE FROM scans WHERE station_name = $1", [station]);
    await client.query("DELETE FROM station_heartbeat WHERE station_name = $1", [station]);

    app.log.info(`Admin: Cleared ${deletedCount} scans + heartbeat for station "${station}"`);

    return {
      ok: true,
      deleted: deletedCount,
      station,
      message: `Cleared ${deletedCount} scan(s) for station "${station}"`,
      timestamp: new Date().toISOString(),
    };
  } catch (e: any) {
    app.log.error({ err: e }, "Admin clear-station failed");
    reply.code(500);
    return { ok: false, error: "Failed to clear station scans", message: e.message };
  } finally {
    client.release();
  }
});

// ---- station heartbeat & status ----

// POST /v1/stations/heartbeat — station reports its status (authenticated)
app.post("/v1/stations/heartbeat", async (req, reply) => {
  const body = req.body as any;
  const station_name = body?.station_name;
  if (!station_name || typeof station_name !== "string") {
    reply.code(400);
    return { error: "Missing station_name" };
  }

  const last_clear_epoch = body?.last_clear_epoch || null;
  const local_scan_count = parseInt(body?.local_scan_count) || 0;

  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO station_heartbeat (station_name, last_clear_epoch, local_scan_count, last_seen_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (station_name) DO UPDATE SET
        last_clear_epoch = $2,
        local_scan_count = $3,
        last_seen_at = NOW()
    `, [station_name, last_clear_epoch, local_scan_count]);
    return { ok: true };
  } catch (e: any) {
    app.log.error({ err: e }, "Station heartbeat failed");
    reply.code(500);
    return { ok: false, error: e.message };
  } finally {
    client.release();
  }
});

// PUT /v1/stations/rename — rename a station across all scans and heartbeat
app.put("/v1/stations/rename", async (req, reply) => {
  const body = req.body as any;
  const old_name = typeof body?.old_name === "string" ? body.old_name.trim() : "";
  const new_name = typeof body?.new_name === "string" ? body.new_name.trim() : "";
  if (!old_name || !new_name || old_name.length > 128 || new_name.length > 128) {
    reply.code(400);
    return { error: "old_name and new_name must be non-empty strings, max 128 characters" };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scansResult = await client.query(
      "UPDATE scans SET station_name = $1 WHERE station_name = $2",
      [new_name, old_name]
    );
    await client.query(
      `INSERT INTO station_heartbeat (station_name, last_seen_at)
       VALUES ($1, NOW())
       ON CONFLICT (station_name) DO NOTHING`,
      [new_name]
    );
    // Merge old heartbeat into new if old exists
    await client.query(
      `UPDATE station_heartbeat SET
         local_scan_count = COALESCE((SELECT local_scan_count FROM station_heartbeat WHERE station_name = $2), 0),
         last_clear_epoch = COALESCE((SELECT last_clear_epoch FROM station_heartbeat WHERE station_name = $2), last_clear_epoch),
         last_seen_at = NOW()
       WHERE station_name = $1`,
      [new_name, old_name]
    );
    await client.query("DELETE FROM station_heartbeat WHERE station_name = $1", [old_name]);
    await client.query("COMMIT");
    app.log.info(`Station renamed: '${old_name}' → '${new_name}' (${scansResult.rowCount} scans updated)`);
    return { ok: true, scans_updated: scansResult.rowCount };
  } catch (e: any) {
    try { await client.query("ROLLBACK"); } catch {}
    app.log.error({ err: e }, "Station rename failed");
    reply.code(500);
    return { ok: false, error: e.message };
  } finally {
    client.release();
  }
});

// GET /v1/stations/status — public: all station statuses (for admin panel + mobile dashboard)
app.get("/v1/stations/status", {
  config: { rateLimit: { max: PUBLIC_RATE_LIMIT_MAX, timeWindow: RATE_LIMIT_WINDOW } }
}, async (req, reply) => {
  const client = await pool.connect();
  try {
    const epochResult = await client.query("SELECT value FROM roster_meta WHERE key = 'clear_epoch'");
    const clear_epoch = epochResult.rows[0]?.value || null;

    const stationsResult = await client.query(`
      SELECT station_name, last_clear_epoch, local_scan_count, last_seen_at
      FROM station_heartbeat
      ORDER BY station_name
    `);

    const now = new Date();
    const stations = stationsResult.rows.map(row => {
      const lastSeen = new Date(row.last_seen_at);
      const secondsAgo = Math.floor((now.getTime() - lastSeen.getTime()) / 1000);
      let status = "offline";
      if (secondsAgo <= 120) {
        status = (!clear_epoch || row.last_clear_epoch === clear_epoch) ? "ready" : "pending";
      }
      return {
        station_name: row.station_name,
        status,
        last_clear_epoch: row.last_clear_epoch,
        local_scan_count: parseInt(row.local_scan_count),
        seconds_ago: secondsAgo,
        last_seen_at: row.last_seen_at,
      };
    });

    const readyCount = stations.filter(s => s.status === "ready").length;

    return {
      clear_epoch,
      stations,
      ready_count: readyCount,
      total_count: stations.length,
      timestamp: new Date().toISOString(),
    };
  } catch (e: any) {
    app.log.error({ err: e }, "Station status query failed");
    reply.code(500);
    return { error: "Failed to fetch station status" };
  } finally {
    client.release();
  }
});

// GET /v1/scans/check-duplicate — cross-station duplicate check (Live Sync)
app.get("/v1/scans/check-duplicate", async (req, reply) => {
  const { badge_id, window_minutes, exclude_station } = req.query as {
    badge_id?: string;
    window_minutes?: string;
    exclude_station?: string;
  };

  if (!badge_id || !badge_id.trim()) {
    reply.code(400);
    return { error: "badge_id is required" };
  }

  const windowMin = Math.max(1, Math.min(60, parseInt(window_minutes || "5") || 5));

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT station_name, scanned_at
       FROM scans
       WHERE badge_id = $1
         AND scanned_at >= NOW() - make_interval(mins => $2)
         AND ($3::text IS NULL OR station_name != $3)
       ORDER BY scanned_at DESC
       LIMIT 1`,
      [badge_id.trim(), windowMin, exclude_station?.trim() || null]
    );

    if (result.rows.length > 0) {
      return {
        duplicate: true,
        badge_id: badge_id.trim(),
        station_name: result.rows[0].station_name,
        scanned_at: result.rows[0].scanned_at,
      };
    }
    return { duplicate: false };
  } catch (e: any) {
    app.log.error({ err: e }, "Duplicate check query failed");
    reply.code(500);
    return { error: "Duplicate check failed" };
  } finally {
    client.release();
  }
});

// ---- graceful shutdown ----
const shutdown = async () => {
  app.log.info("Shutting down gracefully...");
  try {
    await app.close();
    await pool.end();
    app.log.info("Shutdown complete");
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "Error during shutdown");
    process.exit(1);
  }
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// ---- start server ----
const port = parseInt(process.env.PORT || "5000", 10);
if (isNaN(port) || port < 1 || port > 65535) {
  throw new Error("Invalid PORT: must be a number between 1 and 65535");
}
await app.listen({ host: "0.0.0.0", port });
app.log.info(`API listening on :${port}`);

} // end bootstrap

bootstrap().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
