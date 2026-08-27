-- Stored values for a plugin's manifest-declared settings schema (12 §6).
--
-- Values only — the schema stays in the manifest, so the form, validation and
-- the audit surface all read one declaration. A `secret` field's value is the
-- typed `{$secret: true, value}` shape with AES-256-GCM ciphertext under the
-- app secret (13 §6's ruling: typed, encrypted, write-only in the UI,
-- delivered only into the declaring extension's own hook invocations — never
-- a free-form column, which core could not mechanically redact or exclude).
-- Hand-written like every migration since 0112.
ALTER TABLE "plugins" ADD COLUMN "settings" json DEFAULT '{}'::json NOT NULL;
