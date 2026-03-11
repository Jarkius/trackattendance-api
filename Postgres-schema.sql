-- one-time setup

create table if not exists scans (
  id                bigserial primary key,
  idempotency_key   text        not null unique,     -- client-computed hash
  station_name      text        not null,            -- scanning station location
  badge_id          text        not null,            -- employee badge ID
  scanned_at        timestamptz not null,            -- UTC timestamp
  meta              jsonb,                           -- additional context (NO PII)
  business_unit     text,                            -- organizational unit (e.g. "Engineering")
  scan_source       text        not null default 'manual',  -- 'badge' or 'manual'
  created_at        timestamptz not null default now()
);

-- indexes for performance
create index if not exists idx_scans_badge_id             on scans (badge_id);
create index if not exists idx_scans_station_name         on scans (station_name);
create index if not exists idx_scans_scanned_at           on scans (scanned_at desc);
create index if not exists idx_scans_business_unit        on scans (business_unit);
create index if not exists idx_scans_badge_station_time   on scans (badge_id, station_name, scanned_at desc);
create index if not exists idx_scans_station_scanned_at   on scans (station_name, scanned_at desc);

-- roster summary: registered headcount per business unit (full-replace on each upload)
create table if not exists roster_summary (
  business_unit text        primary key,
  registered    integer     not null,
  updated_at    timestamptz not null default now()
);

-- roster metadata (hash, clear_epoch, etc.)
create table if not exists roster_meta (
  key   text primary key,
  value text not null
);

-- station heartbeat: tracks station liveness and clear status
create table if not exists station_heartbeat (
  station_name      text        primary key,
  last_clear_epoch  text,
  local_scan_count  integer     not null default 0,
  last_seen_at      timestamptz not null default now()
);

-- migration for existing databases
-- ALTER TABLE scans ADD COLUMN IF NOT EXISTS business_unit TEXT;
