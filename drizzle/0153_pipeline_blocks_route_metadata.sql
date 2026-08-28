-- Route blocks' renderable halves (20 §10, 22 §3): the routed port reference
-- and each branch's declared predicate. Stored per published version like
-- over_ref/repeat_while; existing versions stay null until republished, which
-- is fine — no shipped pipeline routes yet.
ALTER TABLE "pipeline_blocks" ADD COLUMN "on_ref" json;
--> statement-breakpoint
ALTER TABLE "pipeline_blocks" ADD COLUMN "routes" json;
