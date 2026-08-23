-- `core:query/graph-context@1` now declares `optional`: its failure is absorbed
-- and the run continues, because a slow read of a block the template already
-- guards with `{{#if}}` should never cost somebody their reply.
--
-- That flag is part of the **hashed contract**, deliberately. The ports do not
-- move when it flips, so every spec pinning the version keeps compiling — and
-- quietly stops failing, or starts failing, when the node errors. A behaviour
-- change wearing a compatible signature is exactly what the frozen-version rule
-- exists to catch, so `registrySync.typeContentHash` hashes it and this
-- re-projects the row.
--
-- Only this type is affected: a descriptor that leaves `optional` unset hashes
-- identically to before, because `JSON.stringify` drops undefined keys.
--
-- Same narrow terms as 0107/0108/0111 — safe only because nothing outside this
-- repo has pinned the version. Once 0.6.0 ships, a changed type is a new
-- version, never a rewrite of the row (13 §12b).
DELETE FROM "pipeline_type_registry"
WHERE "type_id" = 'core:query/graph-context'
AND "version" = 1;
