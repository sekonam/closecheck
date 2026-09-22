-- Pin the database's timezone to UTC for every connection and role (2026-09-22).
--
-- The real fix behind the portal-link-liveness bug (20260922093000) and its whole class of
-- siblings: Prisma writes UTC instants into `timestamp WITHOUT time zone` columns, but any SQL that
-- compares or defaults with `now()` / CURRENT_TIMESTAMP renders in the connection's SESSION
-- timezone. On a non-UTC server that silently mixes timezones — a Prisma @default(now()) column and
-- a raw-INSERT sibling written seconds apart can disagree by the server's UTC offset, and a
-- security predicate like link expiry can be evaluated hours off.
--
-- Setting it at the DATABASE level makes every session (app, auth, api, signup, portal roles, and
-- migrations) start in UTC regardless of the host's system timezone, so per-call `AT TIME ZONE
-- 'utc'` patches stop being load-bearing — they remain as harmless belt-and-suspenders. This is the
-- altitude fix; do not rely on the individual call-site casts alone.
--
-- Uses current_database() so it applies to whatever the database is actually named across
-- environments (local `closecheck`, Render's generated name), not a hardcoded literal.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
END
$$;

-- ALTER DATABASE only affects sessions opened AFTER it runs, and this migration's own connection is
-- already open — set it here too so anything later in this same deploy is already UTC.
SET timezone TO 'UTC';
