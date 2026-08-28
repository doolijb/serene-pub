/**
 * Core's shipped prompts, seeded from the catalog (24 T6b).
 *
 * `@serene-pub/core-catalog` is the system of record for the prose now —
 * `CORE_PROMPTS` was extracted byte-exact from what `db/defaults.ts` shipped
 * through the legacy tables, and the drift canary in this module's test
 * refuses a divergence between the two until the legacy seeds are deleted.
 *
 * Idempotent by `seedKey`, whose spelling predates the move and must never
 * change: existing installs match rows they already wrote. A legacy row a
 * *user* created has no seed key and was never copied here — that is the
 * config migration's job, and it writes user-owned prompts rather than
 * immutable shipped ones.
 */

import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CORE_PROMPTS } from "@serene-pub/core-catalog"

type Db = { select: any; insert: any; update: any; delete: any }

export interface PromptSeedResult {
	specSlug: string
	created: string[]
	present: string[]
}

/** Seed each namespace's shipped prompts from the catalog, once. */
export async function seedPipelinePrompts(db: Db): Promise<PromptSeedResult[]> {
	const bySpec = new Map<string, typeof CORE_PROMPTS>()
	for (const p of CORE_PROMPTS) {
		if (!bySpec.has(p.spec)) bySpec.set(p.spec, [])
		bySpec.get(p.spec)!.push(p)
	}

	const out: PromptSeedResult[] = []
	for (const [specSlug, prompts] of bySpec) {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, specSlug))
			.limit(1)
		if (!spec) continue

		const result: PromptSeedResult = {
			specSlug,
			created: [],
			present: []
		}

		for (const prompt of prompts) {
			const [existing] = await db
				.select()
				.from(schema.pipelinePrompts)
				.where(eq(schema.pipelinePrompts.seedKey, prompt.seedKey))
				.limit(1)
			if (existing) {
				result.present.push(prompt.seedKey)
				continue
			}
			await db.insert(schema.pipelinePrompts).values({
				specId: spec.id,
				seedKey: prompt.seedKey,
				name: prompt.name,
				isImmutable: true,
				fields: prompt.fields
			})
			result.created.push(prompt.seedKey)
		}
		out.push(result)
	}
	return out
}

/**
 * The prompt a namespace's shipped config should point at.
 *
 * The legacy *default* where the system named one, and otherwise the first
 * shipped prompt in the namespace. Never nothing: a config whose prompt
 * reference is null renders a node with no instructions, which produces output
 * that looks like a model failure rather than a missing selection.
 */
export async function defaultPromptFor(
	db: Db,
	specId: number,
	preferredSeedKey?: string | null
): Promise<number | null> {
	if (preferredSeedKey) {
		const [preferred] = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.seedKey, preferredSeedKey))
			.limit(1)
		if (preferred?.specId === specId) return preferred.id
	}

	const [first] = await db
		.select()
		.from(schema.pipelinePrompts)
		.where(eq(schema.pipelinePrompts.specId, specId))
		.orderBy(asc(schema.pipelinePrompts.id))
		.limit(1)
	return first?.id ?? null
}
