-- Re-projection on the 0146 precedent: `core:query/session-history@1` gained
-- the `channel` param (20 §7) before any release shipped it. Default 'main'
-- reproduces today's read byte-for-byte; the parity corpus is the check.
-- Must not become a pattern (13 §12b).
DELETE FROM "pipeline_type_registry"
WHERE "type_id" = 'core:query/session-history'
AND "version" = 1;
