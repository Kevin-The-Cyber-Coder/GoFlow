-- Runs once, when the Postgres data volume is first created.
--
-- Email addresses are compared case-insensitively throughout the product, and
-- citext keeps that rule in the database instead of relying on every query to
-- remember lower(). The auth module depends on this extension existing.
CREATE EXTENSION IF NOT EXISTS citext;
