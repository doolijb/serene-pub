-- Review is on or off. The third position is retired.
--
-- `async` meant "run the node, land the write as a proposal, record it for
-- somebody to look at later". Nobody could name a case: a graph proposal must
-- never auto-apply, so it wants the blocking position, and a review record per
-- generated message is noise nobody reads. In this application it was emptier
-- still — `createReviewer` approved an async request immediately and wrote a
-- record, so choosing it was indistinguishable from `off` except for the row.
--
-- Both retired spellings become `on` rather than `off`. Somebody who asked to
-- review a write keeps being asked: quietly dropping a gate is the one outcome
-- of this change that could let an unreviewed write land on an install that had
-- deliberately gated it. `async` behaving as `off` in practice is not a reason
-- to make that permanent — it is the bug, and the intent on the row is the
-- thing to honour.
--
-- Two tables, because a review position is written like any other option: as a
-- per-scope override, and as a value inside a named configuration.
UPDATE "pipeline_node_overrides"
SET "value" = '"on"'::json
WHERE "slot" = 'settings'
AND "path" = 'review'
AND ("value"::jsonb) IN ('"sync"'::jsonb, '"async"'::jsonb);--> statement-breakpoint

UPDATE "pipeline_config_values"
SET "value" = '"on"'::json
WHERE "slot" = 'settings'
AND "path" = 'review'
AND ("value"::jsonb) IN ('"sync"'::jsonb, '"async"'::jsonb);
