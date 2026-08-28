-- Re-projection on the 0146 precedent: `core:input/user-message@1` gained the
-- `greeting` field on its sessionShape (20) — stated default behaviour, not a
-- change to it — so the shape hash moved. Deleting the row lets boot sync
-- re-project the current declaration. Pre-release only; must not become a
-- pattern (13 §12b).
DELETE FROM "pipeline_type_registry"
WHERE "type_id" = 'core:input/user-message'
AND "version" = 1;
