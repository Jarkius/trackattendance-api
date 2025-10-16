-- one-time setup

create table if not exists scans (
  id                bigserial primary key,
  idempotency_key   text        not null unique,     -- client-computed hash
  station_name      text        not null,            -- scanning station location
  badge_id          text        not null,            -- employee badge ID
  scanned_at        timestamptz not null,            -- UTC timestamp
  meta              jsonb,                           -- additional context (NO PII)
  created_at        timestamptz not null default now()
);

-- indexes for performance
create index if not exists idx_scans_badge_id      on scans (badge_id);
create index if not exists idx_scans_station_name  on scans (station_name);
create index if not exists idx_scans_scanned_at    on scans (scanned_at);
