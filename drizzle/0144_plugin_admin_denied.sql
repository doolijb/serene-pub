-- Admin per-permission deny, at the plugin level.
--
-- A JSON array of permission keys an admin has denied (e.g. 'storage',
-- 'network', 'resource:lore:write'). The effective grant is the manifest's
-- declared permissions minus this set, and every capability the runtime hands
-- out derives from the effective set. Added as its own migration (rather than
-- folded into 0143) so a DB that already created the plugins table gets the
-- column cleanly. Hand-written like every migration since 0112.
ALTER TABLE "plugins" ADD COLUMN "admin_denied" json DEFAULT '[]'::json NOT NULL;
