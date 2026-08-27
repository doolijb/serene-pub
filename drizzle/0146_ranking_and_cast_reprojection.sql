-- A targeted re-projection, on the 0099/0106 precedent and just as
-- deliberately narrow: three types gained declared surface before any release
-- shipped them, so their registry rows are stale snapshots of code that no
-- longer exists.
--
--   · core:task/rank-hybrid@1     gained the nine signal-weight fields
--     (`signalKeyword` … `signalPriorityBonus`), the tuning matrix weights.ts
--     always held but nothing declared.
--   · core:task/rank-semantic@1   gained `sourceBudget` / `defaultSourceBudget`,
--     the semantic arm's last two undeclared constants.
--   · core:provider/extract-cast@1 gained its two script hooks (`scripts`
--     before over `content`, `castScripts` after over `cast`) — the paste-rung
--     half of replaceable cast extraction (ruling of 2026-08-26).
--
-- Slot declarations are part of a type's content hash (13 §12b), so each is a
-- hash change; deleting the rows lets boot sync re-project the current
-- declarations. Every default reproduces the shipped constants exactly, so an
-- untouched spec behaves identically — the parity corpus is the check.
--
-- The new script type `core:script:cast/transform@1` needs nothing here: a new
-- type inserts a row and conflicts with nothing.
--
-- This must not become a pattern (13 §12b): once 0.6.0 ships, a changed type
-- is a new version, never a rewrite of the row.
DELETE FROM "pipeline_type_registry"
WHERE "type_id" IN (
	'core:task/rank-hybrid',
	'core:task/rank-semantic',
	'core:provider/extract-cast'
)
AND "version" = 1;
