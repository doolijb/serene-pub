-- Preset event bindings (24 §1, admin IA discussion 2026-08-28): a preset
-- populates a genre's event slots — {event → {spec, config?}} — replacing the
-- primary_slug/config_selections pair as the model the form edits. Backfill
-- happens in the boot seed pass (composed against the input locks, which SQL
-- alone reaches awkwardly); pre-release, these squash.
ALTER TABLE "session_presets" ADD COLUMN "bindings" json NOT NULL DEFAULT '{}'::json;
