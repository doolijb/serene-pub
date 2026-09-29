-- Wire mode becomes a capability: carry the old flags' INTENT across.
--
-- "Does this endpoint want chat or completions" used to be answered by
-- adapter-local flags — `extra_json.useChat` on KoboldCPP, KoboldCPP Managed,
-- Ollama and LM Studio, `extra_json.prerenderPrompt` on the OpenAI-compatible
-- adapter, and an unconditional true inside AnthropicAdapter. Those are gone: it
-- is a connection capability now (`wire_chat` / `wire_completion`), graded
-- through the same four layers as everything else, so the pipeline that RENDERS
-- a prompt and the adapter that SENDS it read one resolved value instead of two
-- that could not see each other.
--
-- Every default lands on chat, which is what all five of those flags already
-- defaulted to — so nothing changes for a connection that never touched them.
-- What this file exists for is the connection that DID: somebody who switched
-- Chat Mode off, or Prerender Prompt on, chose text completion deliberately,
-- and dropping the flag without moving that choice would silently flip them to
-- the other method on their next generation. On the send path, silently.
--
-- ── Why an OVERRIDE and not a resolved value ────────────────────────────────
--
-- `capabilities` holds three things: `overrides` and `probe` are DURABLE INTENT,
-- and `resolved` is a CACHE of those plus the static manifest (connections/
-- resolve.ts). A hand-set flag is intent, so it belongs in `overrides` — where
-- it outranks the adapter's default, the preset and every test that runs after
-- it, which is exactly what the capability panel promises in prose.
--
-- The cache is deliberately NOT rewritten here. `resolveWireMode` resolves live
-- from the row rather than reading the cache, precisely because the cache on
-- every existing row was written by a build in which these two keys did not
-- exist — so a backfill would have to be right about every capability, not just
-- these two, and would go stale again the next time the manifest changed.
--
-- ⚠ `wire_chat: false` rather than `wire_completion: 1`. Off is the durable half
-- of the statement: the tie-break prefers chat whenever both are available, so
-- switching completion ON would leave chat on too and change nothing. Turning
-- chat off is what "not that method" means, and it leaves `wire_completion` in
-- its auto state where a preset or a probe can still speak to it.
--
-- ── What is deliberately NOT translated ─────────────────────────────────────
--
-- An ABSENT `useChat` key on an Ollama connection. That adapter read the same
-- setting with two different defaults in one file — `!!extraJson?.useChat` at
-- the build and `?? true` at the send — and its own comment names that a bug:
-- a connection with no key had a completion prompt built and a chat request
-- sent, with `messages: undefined`. Absence there is an accident of two
-- disagreeing defaults, not a person's choice, and encoding it would make a bug
-- durable. Those rows land on chat, which is what the form has always written.
UPDATE "connections"
SET "capabilities" = (
	COALESCE("capabilities"::jsonb, '{}'::jsonb) ||
	jsonb_build_object(
		'overrides',
		-- Merged into whatever overrides the row already carries, never
		-- replacing them: a person may have switched vision or tool calling by
		-- hand, and those are the same durable half of the same column.
		COALESCE("capabilities"::jsonb -> 'overrides', '{}'::jsonb) ||
		'{"wire_chat": false}'::jsonb
	)
)::json
WHERE
	-- ⚠ `->` and a jsonb literal, NOT `->>` and a string. `->>` extracts the
	-- value as TEXT, so it cannot tell the boolean `false` from the string
	-- `"false"` — and under the old code those two meant opposite things:
	-- `extraJson?.useChat ?? true` reads a non-empty string as TRUTHY, so a
	-- `"false"` connection was in chat mode and would have been flipped to
	-- completion by the loose match. Comparing the jsonb VALUE matches exactly
	-- what the connection forms and `connectionDefaults.ts` ever wrote.
	--
	-- Anything else in these keys is left alone and lands on chat, which is what
	-- it already did: no shipped code path wrote a non-boolean here, and a
	-- migration guessing at one would be guessing on the send path.
	("extra_json"::jsonb -> 'useChat') = 'false'::jsonb
	-- The OpenAI-compatible adapter's own spelling of the same choice. Its read
	-- was a plain truthiness test rather than a `??`, so the boolean is likewise
	-- the whole of what it was ever given.
	OR ("extra_json"::jsonb -> 'prerenderPrompt') = 'true'::jsonb;
