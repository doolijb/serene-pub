/**
 * Core's shipped prompts, seeded from the catalog (24 T6b).
 *
 * `@serene-pub/core-catalog` is the system of record for the prose now —
 * `CORE_PROMPTS` was extracted byte-exact from what `db/defaults.ts` shipped
 * through the legacy tables, and the drift canary in this module's test
 * refuses a divergence between the two until the legacy seeds are deleted.
 *
 * ## One row per pool, not one bundle per pipeline
 *
 * The catalog is grouped by `(node type, slot)` because that is what a prompt
 * is scoped to. Nothing here reads a spec to decide *whether* to seed: a pool
 * belongs to a node type, and a node type exists whether or not any published
 * pipeline currently uses it. A spec is read only to resolve `createdForSpec`
 * into a grouping id, and a row whose spec is absent still seeds — with no
 * origin, which is exactly what "written for no pipeline in particular" means.
 *
 * ## Refresh-if-different, matched on `seedKey`
 *
 * Insert-only was the old rule and it had one failure that outlived every
 * install: core's own row could never be corrected once an instance had booted,
 * so a fresh install and an upgraded one shipped different prose from identical
 * settings. `seedContextTemplates` and `seedVariableTemplates` already learned
 * this; this is the same fix, matched on `seedKey`, which is **NULL for every
 * row a user ever wrote** — those are never read, never compared, never
 * touched.
 *
 * `seedKey`'s spelling changed exactly once, with migration 0180, which
 * recreated the table and so left no rows to re-match. From here it must never
 * change again: a new spelling would re-seed thirty duplicates beside thirty
 * orphans on every existing install.
 */

import { and, asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CORE_PROMPTS } from "@serene-pub/core-catalog"
import {
	poolKeyFor,
	promptPoolKeyFor
} from "$lib/server/pipelines/entities/promptPool"

type Db = { select: any; insert: any; update: any; delete: any }

export interface PromptSeedResult {
	/** `<node type>#<slot>` — the pool, for a log line and for the tests. */
	pool: string
	created: string[]
	present: string[]
	/** Rows whose shipped text had drifted from the catalog. */
	refreshed: string[]
}

/** Same-value comparison for the three fields a refresh may correct. */
const sameFields = (
	a: Record<string, string>,
	b: Record<string, string>
): boolean => {
	const ka = Object.keys(a).sort()
	const kb = Object.keys(b).sort()
	if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false
	return ka.every((k) => a[k] === b[k])
}

const sameList = (a: string[], b: string[]): boolean =>
	a.length === b.length && a.every((v, i) => v === b[i])

/** Seed each pool's shipped prompts from the catalog, idempotently. */
export async function seedPipelinePrompts(db: Db): Promise<PromptSeedResult[]> {
	const byPool = new Map<string, typeof CORE_PROMPTS>()
	for (const p of CORE_PROMPTS) {
		const pool = promptPoolKeyFor(p.nodeType, p.slot)
		if (!byPool.has(pool)) byPool.set(pool, [])
		byPool.get(pool)!.push(p)
	}

	// One read of the spec table for the whole pass. `createdForSpec` is a
	// grouping hint, not a gate, so a missing spec resolves to null rather than
	// skipping the row — a plugin shipping prose for a node core owns is the
	// case node scoping exists to allow.
	const specs = await db.select().from(schema.pipelineSpecs)
	const specIdBySlug = new Map<string, number>(
		(specs as any[]).map((s) => [s.slug, s.id])
	)

	const out: PromptSeedResult[] = []
	for (const [pool, prompts] of byPool) {
		const result: PromptSeedResult = {
			pool,
			created: [],
			present: [],
			refreshed: []
		}

		for (const prompt of prompts) {
			const createdForSpecId =
				(prompt.createdForSpec != null
					? specIdBySlug.get(prompt.createdForSpec)
					: null) ?? null

			const [existing] = await db
				.select()
				.from(schema.pipelinePrompts)
				.where(eq(schema.pipelinePrompts.seedKey, prompt.seedKey))
				.limit(1)

			if (existing) {
				// Corrected rather than left alone — see the header. Only the
				// fields the catalog is the authority for; `createdForSpecId`
				// is included because it is derived from the catalog too and
				// resolves to null on the boot before its spec is published.
				const drifted =
					existing.name !== prompt.name ||
					!sameFields(
						(existing.fields ?? {}) as Record<string, string>,
						prompt.fields
					) ||
					!sameList(
						(existing.defaultForSpecs ?? []) as string[],
						prompt.defaultForSpecs
					) ||
					(existing.createdForSpecId ?? null) !== createdForSpecId
				if (!drifted) {
					result.present.push(prompt.seedKey)
					continue
				}
				await db
					.update(schema.pipelinePrompts)
					.set({
						name: prompt.name,
						fields: prompt.fields,
						defaultForSpecs: prompt.defaultForSpecs,
						createdForSpecId,
						updatedAt: new Date()
					})
					.where(eq(schema.pipelinePrompts.id, existing.id))
				result.refreshed.push(prompt.seedKey)
				continue
			}

			await db.insert(schema.pipelinePrompts).values({
				nodeTypeId: poolKeyFor(prompt.nodeType),
				slot: prompt.slot,
				seedKey: prompt.seedKey,
				name: prompt.name,
				isImmutable: true,
				fields: prompt.fields,
				defaultForSpecs: prompt.defaultForSpecs,
				createdForSpecId
			})
			result.created.push(prompt.seedKey)
		}
		out.push(result)
	}
	return out
}

/**
 * The prompt a pipeline's shipped config should point at, for one pool.
 *
 * Four steps, and the order is the whole design:
 *
 *  1. **A row in this pool claiming this spec** (`default_for_specs`). The only
 *     step that can express "one pool, several pipelines, a different starting
 *     row for each" — which is the shape the summarize specs actually have:
 *     `summarize-batch` holds the world, character and scene drafting prompts
 *     side by side, and the scene row is where two specs begin.
 *  2. **The immutable row written for this spec** (`created_for_spec_id`), for
 *     a pool where nobody said which row is the start but one row plainly
 *     belongs here.
 *  3. **The oldest immutable row in the pool** — a plugin's node, where core
 *     knows nothing and the first shipped row is a better answer than none.
 *  4. Null.
 *
 * Never a user's row, at any step: `is_immutable` is required from step 2 on,
 * because a shipped config starting on something a person can edit or delete
 * would make "back to defaults" mean whatever they last typed.
 *
 * Deliberately not "lowest id in the pool". That was the old rule and it worked
 * only because a pool *was* a pipeline; applied to a shared pool it hands
 * summarize-character the world summarizer's wording, silently, on a screen
 * that shows the right name.
 */
export async function defaultPromptFor(
	db: Db,
	nodeTypeId: string,
	slot: string,
	/**
	 * The pipeline asking, both halves. They do not substitute for each other:
	 * `default_for_specs` holds slugs — one row is the shipped default for two
	 * summarizers at once, which no single owning id can say — while
	 * `created_for_spec_id` holds an id. Passed as one object so a caller
	 * cannot supply the id of one spec and the slug of another.
	 */
	spec: { id: number; slug: string }
): Promise<number | null> {
	// One read of the pool, then the four steps in memory. The pool is a
	// handful of rows, and `default_for_specs` is a json array — asking
	// Postgres for containment would be a second spelling of the same
	// question for no gain.
	const rows = (await db
		.select()
		.from(schema.pipelinePrompts)
		.where(
			and(
				eq(schema.pipelinePrompts.nodeTypeId, poolKeyFor(nodeTypeId)),
				eq(schema.pipelinePrompts.slot, slot)
			)
		)
		.orderBy(asc(schema.pipelinePrompts.id))) as any[]

	const claimed = rows.find((r) =>
		((r.defaultForSpecs ?? []) as string[]).includes(spec.slug)
	)
	if (claimed) return claimed.id

	const owned = rows.find(
		(r) => r.isImmutable && r.createdForSpecId === spec.id
	)
	if (owned) return owned.id

	const shipped = rows.find((r) => r.isImmutable)
	return shipped?.id ?? null
}
