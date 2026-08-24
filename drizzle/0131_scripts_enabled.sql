-- The scripts kill switch (18 §10; §13.3 ruled: default ON).
--
-- Unlike the plugin switch, nothing executes until an admin authors or imports
-- a script — so this is a recovery lever, not a gate: off returns every run to
-- vanilla instantly while chains and attachments stay in place, waiting.
ALTER TABLE "system_settings" ADD COLUMN "scripts_enabled" boolean DEFAULT true NOT NULL;
