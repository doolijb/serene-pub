/**
 * 🚧 Core's shipped scripts, seeded from the catalog (2026-10-15).
 *
 * `CORE_SCRIPTS` (`@serene-pub/core-catalog`, `seed/scripts.ts`) lists the
 * `pipeline_scripts` rows core ships — Dungeon Crawler's round script and its
 * script steps, and the generic `core:script/read-path`. A spec names one in
 * its author preset by **seed key** (`PresetBuilder.scripts`); the shipped
 * config stores the row id this pass gave it (`named.ts`, `refDefaults`), so
 * no document carries an instance's id.
 *
 * The prompts' rule, one table over (`seedPrompts.ts`): **matched on
 * `seedKey`**, which is NULL for every row a person wrote, so theirs are never
 * read or touched; **refreshed when different** (source, name, declared reads,
 * immutable, enabled), so an upgrade carries a corrected script to an install
 * that booted before it; a person's row holding the name takes precedence and
 * the shipped one is called "(Built-in)" (`shippedName.ts`; scripts are unique
 * by `(type_id, name)`). Never at a fixed id.
 *
 * Runs before the configs (`seedCoreSpecs` pass 2c): a shipped config names
 * these rows. A row the catalog stopped shipping stays as it is.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CORE_SCRIPTS } from "@serene-pub/core-catalog"
import {
	namesTakenBesides,
	shippedNameFor
} from "$lib/server/pipelines/boot/shippedName"

export interface ScriptSeedResult {
	created: string[]
	present: string[]
	refreshed: string[]
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
	a.length === b.length && a.every((v, i) => v === b[i])

/** Seed every script core ships, idempotently, by seed key. */
export async function seedCoreScripts(db: Db): Promise<ScriptSeedResult> {
	const result: ScriptSeedResult = { created: [], present: [], refreshed: [] }
	for (const script of CORE_SCRIPTS) {
		// The names this script's type already holds, for the yield.
		const pool = (await db
			.select({ id: schema.pipelineScripts.id, name: schema.pipelineScripts.name })
			.from(schema.pipelineScripts)
			.where(eq(schema.pipelineScripts.typeId, script.typeId))) as Array<{
			id: number
			name: string
		}>
		const [existing] = await db
			.select()
			.from(schema.pipelineScripts)
			.where(eq(schema.pipelineScripts.seedKey, script.seedKey))
			.limit(1)
		const varsIn = [...script.varsIn]
		const varsOut = [...script.varsOut]

		if (existing) {
			const name = shippedNameFor(script.name, namesTakenBesides(pool, existing.id))
			const drifted =
				!existing.isImmutable ||
				!existing.enabled ||
				existing.typeId !== script.typeId ||
				existing.name !== name ||
				existing.source !== script.source ||
				!sameList((existing.varsIn ?? []) as string[], varsIn) ||
				!sameList((existing.varsOut ?? []) as string[], varsOut)
			if (!drifted) {
				result.present.push(script.seedKey)
				continue
			}
			await db
				.update(schema.pipelineScripts)
				.set({
					typeId: script.typeId,
					name,
					source: script.source,
					varsIn,
					varsOut,
					isImmutable: true,
					enabled: true,
					updatedAt: new Date()
				})
				.where(eq(schema.pipelineScripts.id, existing.id))
			result.refreshed.push(script.seedKey)
			continue
		}

		await db.insert(schema.pipelineScripts).values({
			typeId: script.typeId,
			seedKey: script.seedKey,
			name: shippedNameFor(script.name, namesTakenBesides(pool, null)),
			source: script.source,
			varsIn,
			varsOut,
			isImmutable: true,
			enabled: true
		})
		result.created.push(script.seedKey)
	}
	return result
}

/** The seeded row a seed key names, or null where this install has none. */
export async function scriptIdFor(db: Db, seedKey: string): Promise<number | null> {
	const [row] = await db
		.select({ id: schema.pipelineScripts.id })
		.from(schema.pipelineScripts)
		.where(eq(schema.pipelineScripts.seedKey, seedKey))
		.limit(1)
	return row?.id ?? null
}
