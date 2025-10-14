-- one-time setup
create extension if not exists "uuid-ossp";

create table if not exists scans (
  id                bigserial primary key,
  idempotency_key   text        not null unique,     -- client-computed hash
  event_id          text        not null,
  device_id         text        not null,
  employee_ref      text        not null,
  scanned_at        timestamptz not null,
  meta              jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists idx_scans_event_id      on scans (event_id);
create index if not exists idx_scans_device_id     on scans (device_id);
create index if not exists idx_scans_employee_ref  on scans (employee_ref);
create index if not exists idx_scans_scanned_at    on scans (scanned_at);
