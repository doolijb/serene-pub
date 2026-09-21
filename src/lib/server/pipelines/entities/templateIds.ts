/**
 * Core's **template ids**, derived from its seed keys (R19).
 *
 * A template row now carries two identities and they answer different
 * questions. `seed_key` is storage identity: what the seed pass matches on so a
 * boot updates the row it wrote last time instead of inserting a second one.
 * `template_id` is the name a *document* uses — owner-namespaced, versioned,
 * and therefore safe for a spec somebody else wrote to pin. The grammar and the
 * plugin-facing declaration live in the SDK (`templateIds.ts`); this module is
 * only the half core needs: how an id is derived for a row core seeds.
 *
 * ## The derivation, and why it is the whole key
 *
 * Slugify `seed_key` in full — lower-case, every run of characters outside
 * `[a-z0-9]` becomes one hyphen, hyphens trimmed at the ends — and wrap it as
 * `core:template/<slug>@1`.
 *
 * The obvious alternative was the seed key's LAST segment, which is short and
 * reads well: `core:template/adventure-planner@1`. It is not usable. Four of
 * core's prompt slugs name a row in three to five pools each —
 * `summarize-world-default` is a row in `summarize-batch`, `summarize-synth`
 * AND `name-entry` — so the last segment is not unique, and "disambiguate the
 * ones that collide" is worse than either: it makes an id a function of which
 * OTHER rows exist, so adding a prompt in 0.7 would silently change an id a
 * plugin had already pinned. An id that moves is not an id.
 *
 * Slugifying the whole key inherits uniqueness from the unique column it is
 * derived from, so a new row can never change an existing id, and each key's
 * table prefix (`pipeline-prompt:`, `pipeline-context-template:`,
 * `pipeline-variable-template:`) rides along — which is why the three tables
 * cannot mint the same id for different rows either. The cost is length, and
 * length is what a plugin author pays when they read a core id out of the
 * library rather than type it from memory.
 *
 * ## It is written in two places on purpose
 *
 * Migration 0143 backfills existing installs with the same rule as one
 * `regexp_replace` per table, because a migration cannot call this. That is a
 * duplication with teeth: `coreTemplateIds.int.test.ts` asserts the SQL and this
 * function agree on every row a fresh install seeds, so the two cannot drift
 * into handing an upgraded install and a fresh one different ids.
 */

/**
 * Core's template id for a seeded row. Pure, total, and stable forever: the
 * seed keys it reads are themselves frozen (`core-catalog/src/prompts.ts` — "it
 * must never change again").
 */
export function coreTemplateIdFor(seedKey: string): string {
	const slug = seedKey
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
	return `core:template/${slug}@1`
}
