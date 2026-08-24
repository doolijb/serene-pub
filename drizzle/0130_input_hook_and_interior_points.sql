-- The input hook and the first interior point (18 §4a, §4e).
--
-- `user-message` declares a scripts hook over the text it publishes — what
-- retrieval and the prompt see; the stored message stays untouched — and
-- `summarize-batch` declares the `each-draft` interior point, invoked by its
-- binding through `ctx.scripts` so the user's cleanup chain reaches every
-- intermediate draft before synthesis reads it (core dogfooding §4e, 07 §0b).
--
-- Points live in a registry column for the reason `slots` do: the panel offers
-- one chain option per point and renders from rows (F6). Point keys are hashed
-- (the S3 argument, one construct over), so the two rows re-project — same
-- narrow pre-release terms as 0127/0128.
ALTER TABLE "pipeline_type_registry" ADD COLUMN "script_points" json;--> statement-breakpoint
DELETE FROM "pipeline_type_registry"
WHERE ("type_id" = 'core:input/user-message' AND "version" = 1)
	OR ("type_id" = 'core:provider/summarize-batch' AND "version" = 1);
