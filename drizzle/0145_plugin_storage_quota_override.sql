-- Admin per-plugin storage-quota override (bytes; null = none).
--
-- An admin can raise or lower a *granted* plugin's storage quota beyond the
-- manifest-declared value. It supersedes the manifest quota at grant-derivation
-- and is clamped there to a sane admin band [1 KB … 2 GB] (wider than the 256 MB
-- author ceiling, because an override is a deliberate, trusted act). Denying the
-- `storage` permission still wins — an override never revives denied storage.
-- Hand-written like every migration since 0112.
ALTER TABLE "plugins" ADD COLUMN "storage_quota_override" bigint;
