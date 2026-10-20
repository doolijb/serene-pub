/**
 * 0107 — **Story** absorbs Chat and Adventure (PLAN-genre-restructure,
 * ruled 2026-10-19). Shape is drizzle's; this moves the content:
 *
 *  · every session of the old Chat (roleplay) and of Adventure is a Story
 *    session now — `core:genre/story`;
 *  · the two shipped presets they were born from become Story's **Minimal**
 *    (was Chat's default) and **Living** (was Adventure's default), keeping
 *    their row ids, so `sessions.preset_id` stays true and an administrator's
 *    enabled/default choices carry;
 *  · the roleplay specs keep their rows and change slug — `core:spec/chat-*`
 *    → `core:spec/story-*` — because today's Chat prompts ARE Story's reply
 *    (ruled); configs, deviations and bindings key on the integer id and
 *    follow for free. Prompt seed keys and the JSON that spells slugs out
 *    (preset bindings, included actions, documents, runs) are rewritten;
 *  · layouts, layout defaults and genre settings move with the genre.
 *
 * The new assistant Chat seeds fresh `core:spec/assistant-*` specs, so nothing
 * here can collide with it (§2-7 rule a). Adventure's own specs and prompts
 * are culled by `boot/retiredGenres.ts` after this ran (its sessions and
 * preset are already Story's by then). Runs inside the anchor migration's
 * transaction; idempotent.
 */
import { sql } from "drizzle-orm"
import type { DataUpgradeContext } from "./index"

const STORY = "core:genre/story"
const OLD = ["core:genre/chat", "core:genre/adventure"]

export async function run(tx: MigrationTx, _ctx: DataUpgradeContext): Promise<void> {
	const q = (s: string) => tx.execute(sql.raw(s))
	const inOld = OLD.map((g) => `'${g}'`).join(", ")

	// Presets first: the renamed rows must exist before the seeds look for them.
	// Core's seed keys are core-<slug> (a plugin's plugin:<id>:<slug>); the
	// suffix match covers both spellings.
	await q(`UPDATE session_presets SET seed_key = replace(seed_key, 'chat-default', 'story-minimal'),
		name = 'Minimal', genre_id = '${STORY}' WHERE seed_key LIKE '%chat-default'`)
	await q(`UPDATE session_presets SET seed_key = replace(seed_key, 'adventure-default', 'story-living'),
		name = 'Living', genre_id = '${STORY}' WHERE seed_key LIKE '%adventure-default'`)
	// Any other preset of the two genres (a person's copy) is a Story preset now.
	await q(`UPDATE session_presets SET genre_id = '${STORY}' WHERE genre_id IN (${inOld})`)
	// One default per genre: Living wins when both carried the mark.
	await q(`UPDATE session_presets SET is_default = false WHERE genre_id = '${STORY}' AND is_default = true
		AND seed_key NOT LIKE '%story-living' AND EXISTS (SELECT 1 FROM session_presets p WHERE p.genre_id = '${STORY}' AND p.seed_key LIKE '%story-living')`)

	// A session that named no preset ran its genre as it stood: an old Chat
	// one call per turn (Minimal), an old Adventure the narrated world
	// (Living). Name the preset now, or the declared defaults would add a
	// call to every migrated Chat session.
	await q(`UPDATE sessions SET preset_id = (SELECT id FROM session_presets WHERE seed_key LIKE '%story-minimal' ORDER BY id LIMIT 1)
		WHERE genre_id = 'core:genre/chat' AND preset_id IS NULL`)
	await q(`UPDATE sessions SET preset_id = (SELECT id FROM session_presets WHERE seed_key LIKE '%story-living' ORDER BY id LIMIT 1)
		WHERE genre_id = 'core:genre/adventure' AND preset_id IS NULL`)
	await q(`UPDATE sessions SET genre_id = '${STORY}' WHERE genre_id IN (${inOld})`)

	// The roleplay specs are Story's: slug rename, rows kept.
	await q(`UPDATE pipeline_specs SET slug = 'core:spec/story-' || substr(slug, length('core:spec/chat-') + 1)
		WHERE slug LIKE 'core:spec/chat-%' AND source_plugin_id IS NULL`)
	await q(`UPDATE pipeline_prompts SET seed_key = replace(seed_key, ':chat-', ':story-')
		WHERE seed_key LIKE 'pipeline-prompt:core:%:chat-%' AND owner_plugin_id IS NULL`)
	// Adventure's three actions live on as Story's (look, rest, ask): their
	// prompt rows follow by seed key; the rest of Adventure's rows are culled.
	for (const a of ["rest", "look", "ask"])
		await q(`UPDATE pipeline_prompts SET seed_key = replace(seed_key, ':adventure-${a}', ':story-${a}')
			WHERE seed_key LIKE 'pipeline-prompt:core:%:adventure-${a}' AND owner_plugin_id IS NULL`)
	// The Story ruleset is Freeform (ruled 2026-10-19): every stored reference follows.
	await q(`UPDATE sessions SET primary_ruleset = replace(primary_ruleset, 'core:ruleset/story@1', 'core:ruleset/freeform@1')
		WHERE primary_ruleset LIKE 'core:ruleset/story@1%'`)
	await q(`UPDATE lorebooks SET primary_ruleset = replace(primary_ruleset, 'core:ruleset/story@1', 'core:ruleset/freeform@1')
		WHERE primary_ruleset LIKE 'core:ruleset/story@1%'`)
	await q(`UPDATE lorebook_entries SET type_id = replace(type_id, 'core:entry/story.', 'core:entry/freeform.')
		WHERE type_id LIKE 'core:entry/story.%'`)
	// JSON that spells a slug out.
	await q(`UPDATE session_presets SET bindings = replace(bindings::text, 'core:spec/chat-', 'core:spec/story-')::json
		WHERE bindings::text LIKE '%core:spec/chat-%'`)
	await q(`UPDATE session_presets SET included_actions = replace(included_actions::text, 'core:spec/chat-', 'core:spec/story-')::json
		WHERE included_actions::text LIKE '%core:spec/chat-%'`)
	await q(`UPDATE pipeline_runs SET spec_slug = 'core:spec/story-' || substr(spec_slug, length('core:spec/chat-') + 1)
		WHERE spec_slug LIKE 'core:spec/chat-%'`)

	// Layouts, defaults and genre settings follow the genre. A Story row that
	// already exists wins over a moved one.
	await q(`UPDATE session_layout_presets SET genre_id = '${STORY}' WHERE genre_id IN (${inOld})`)
	await q(`DELETE FROM user_layout_defaults d WHERE d.genre_id IN (${inOld})
		AND EXISTS (SELECT 1 FROM user_layout_defaults s WHERE s.user_id = d.user_id AND s.genre_id = '${STORY}')`)
	await q(`DELETE FROM user_layout_defaults d WHERE d.genre_id = 'core:genre/adventure'
		AND EXISTS (SELECT 1 FROM user_layout_defaults s WHERE s.user_id = d.user_id AND s.genre_id = 'core:genre/chat')`)
	await q(`UPDATE user_layout_defaults SET genre_id = '${STORY}' WHERE genre_id IN (${inOld})`)
	await q(`DELETE FROM session_genre_settings WHERE genre_id = 'core:genre/adventure'
		AND EXISTS (SELECT 1 FROM session_genre_settings s WHERE s.genre_id IN ('core:genre/chat', '${STORY}'))`)
	await q(`DELETE FROM session_genre_settings WHERE genre_id = 'core:genre/chat'
		AND EXISTS (SELECT 1 FROM session_genre_settings s WHERE s.genre_id = '${STORY}')`)
	await q(`UPDATE session_genre_settings SET genre_id = '${STORY}' WHERE genre_id IN (${inOld})`)
}
