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

// ---- auth middleware ----
app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/healthz") return;
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
