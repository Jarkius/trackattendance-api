// server.ts
import Fastify from "fastify";
import pg from "pg";
import 'dotenv/config'; // or: require('dotenv').config(); if using CommonJS

// ---- config ----
// Validate required environment variables
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}
if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable is required");
}

const app = Fastify({
  logger: true,
  requestTimeout: 30000 // 30 seconds
});

// Database connection with graceful failure handling
let pool: pg.Pool | null = null;
try {
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000, // Increased for better reliability with Neon
  });

  // Test the connection
  pool.on('error', (err) => {
    console.error('Database connection error:', err);
  });
} catch (err) {
  console.error('Failed to initialize database pool:', err);
  // Continue without database for health check purposes
}

const API_KEY = process.env.API_KEY;

// ---- health ----
app.get("/healthz", async () => ({ ok: true }));

// ---- root health check (for Cloud Run) ----
app.get("/", async () => ({
  status: "ok",
  service: "Track Attendance API",
  version: "1.0.0",
  timestamp: new Date().toISOString()
}));

// ---- auth middleware ----
app.addHook("onRequest", async (req, reply) => {
  // Bypass authentication for health checks
  if (req.url === "/healthz" || req.url === "/") return;

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !API_KEY || token !== API_KEY) {
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
            scanned_at: { type: "string", format: "date-time" }, // ISO8601
            meta: { type: ["object", "null"] },
          },
          additionalProperties: false,
        },
        maxItems: 2000, // safety cap
      },
    },
    additionalProperties: false,
  },
};

type ScanInput = {
  idempotency_key: string;
  badge_id: string;
  station_name: string;
  scanned_at: string; // ISO8601
  meta?: Record<string, any> | null;
};

interface BatchRequest {
  Body: {
    events: ScanInput[];
  };
}

// ---- batch endpoint (single SQL) ----
app.post<BatchRequest>("/v1/scans/batch", { schema: batchSchema }, async (req, reply) => {
  const events = req.body.events;
  if (!events?.length) return { saved: 0, duplicates: 0, errors: 0 };

  if (!pool) {
    reply.code(503);
    throw new Error("Database not available");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");

    // Build arrays for UNNEST
    const keys: string[] = [];
    const badgeIds: string[] = [];
    const stationNames: string[] = [];
    const scannedAts: Date[] = [];
    const metas: any[] = [];

    for (const ev of events) {
      keys.push(ev.idempotency_key);
      badgeIds.push(ev.badge_id);
      stationNames.push(ev.station_name);

      // Validate and parse date
      const date = new Date(ev.scanned_at);
      if (isNaN(date.getTime())) {
        throw new Error(`Invalid date format: ${ev.scanned_at}`);
      }
      scannedAts.push(date);

      metas.push(ev.meta ?? null);
    }

    const insertSql = `
      insert into scans
        (idempotency_key, badge_id, station_name, scanned_at, meta)
      select *
      from unnest(
        $1::text[],
        $2::text[],
        $3::text[],
        $4::timestamptz[],
        $5::jsonb[]
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

// ---- dashboard endpoints (Issue #27) ----

// GET /v1/dashboard/stats - Returns aggregated scan statistics
app.get("/v1/dashboard/stats", async (req, reply) => {
  if (!pool) {
    reply.code(503);
    throw new Error("Database not available");
  }

  const client = await pool.connect();
  try {
    // Get summary stats
    const summaryResult = await client.query(`
      SELECT
        COUNT(*) as total_scans,
        COUNT(DISTINCT badge_id) as unique_badges
      FROM scans
    `);

    // Get per-station breakdown
    const stationsResult = await client.query(`
      SELECT
        station_name,
        COUNT(*) as total_scans,
        COUNT(DISTINCT badge_id) as unique_badges,
        MAX(scanned_at) as last_scan
      FROM scans
      GROUP BY station_name
      ORDER BY total_scans DESC
    `);

    const summary = summaryResult.rows[0];
    const stations = stationsResult.rows.map(row => ({
      name: row.station_name,
      scans: parseInt(row.total_scans),
      unique: parseInt(row.unique_badges),
      last_scan: row.last_scan ? new Date(row.last_scan).toISOString() : null,
    }));

    return {
      total_scans: parseInt(summary.total_scans),
      unique_badges: parseInt(summary.unique_badges),
      stations,
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

// GET /v1/dashboard/export - Returns all scans for Excel export
interface ExportQuery {
  Querystring: {
    limit?: string;
  };
}

app.get<ExportQuery>("/v1/dashboard/export", async (req, reply) => {
  if (!pool) {
    reply.code(503);
    throw new Error("Database not available");
  }

  const limit = Math.min(parseInt(req.query.limit || "100000"), 100000);

  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT
        badge_id,
        station_name,
        scanned_at,
        meta->>'matched' as matched
      FROM scans
      ORDER BY scanned_at DESC
      LIMIT $1
    `, [limit]);

    const scans = result.rows.map(row => ({
      badge_id: row.badge_id,
      station_name: row.station_name,
      scanned_at: row.scanned_at ? new Date(row.scanned_at).toISOString() : null,
      matched: row.matched === 'true',
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

// ---- graceful shutdown ----
const shutdown = async () => {
  app.log.info("Shutting down gracefully...");
  try {
    await app.close();
    if (pool) {
      await pool.end();
    }
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
const port = Number(process.env.PORT || 5000);
app.listen({ host: "0.0.0.0", port }).then(() => {
  app.log.info(`API listening on :${port}`);
});
