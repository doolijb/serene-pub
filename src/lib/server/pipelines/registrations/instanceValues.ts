/**
 * 🚧 **A pipeline's instance values** (R50, 2026-10-21; lane F1) — the
 * administrator's values for one pipeline on this pub
 * (`pipeline_specs.instance_values`), one layer of the value cascade:
 *
 *   declared defaults < **instance values** < genre < preset < session
 *
 * What the pipeline view writes for a pipeline no genre registers — a card
 * action (portrait, likeness) has only its declared defaults and these — and
 * where the 0110 data upgrade put the configuration the pub had selected for
 * any pipeline (configurations are retired; nothing reads them at run time).
 * A pipeline the genres' defaults register takes the view's edits into the
 * genre's defaults instead (`genreValues.ts`, A15); values left here by the
 * upgrade still sit under them.
 *
 * Stored in a registration's `values` shape (`{ [nodeKey]: { [slot]: value |
 * { [path]: value } } }`, `withAddress`), so `addressedValues` reads both.
 */
import { eq } from "drizzle-orm"
import type { RegistrationValues } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { withAddress } from "$lib/server/pipelines/registrations/genreValues"
import type { RegistrationValueRef } from "$lib/server/pipelines/registrations/values"

type Values = Record<string, Record<string, unknown>>

const valuesOf = (v: unknown): Values | null =>
	v && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length ? (v as Values) : null

/** A pipeline's instance values, by slug; null when none (or no such pipeline). */
export async function instanceValuesOf(db: Db, specSlug: string): Promise<RegistrationValues | null> {
	const [row] = await db
		.select({ values: schema.pipelineSpecs.instanceValues })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, specSlug))
		.limit(1)
	return valuesOf(row?.values) as RegistrationValues | null
}

/** Set (a value) or clear (`undefined`) one address of a pipeline's instance values. */
export async function setInstanceValue(
	db: Db,
	specSlug: string,
	address: { nodeKey: string; slot: string; path: string },
	value: unknown
): Promise<void> {
	const current = (await instanceValuesOf(db, specSlug)) as Values | null
	const next = withAddress(current, address.nodeKey, address.slot, address.path, value)
	await db
		.update(schema.pipelineSpecs)
		.set({ instanceValues: next })
		.where(eq(schema.pipelineSpecs.slug, specSlug))
}

/** Clear every instance value of a pipeline; how many addresses went. */
export async function resetInstanceValues(db: Db, specSlug: string): Promise<number> {
	const gone = (await instanceStoredValues(db, specSlug)).length
	await db
		.update(schema.pipelineSpecs)
		.set({ instanceValues: null })
		.where(eq(schema.pipelineSpecs.slug, specSlug))
	return gone
}

/** Every address a pipeline's instance values state, exploded to `{ nodeKey, slot, path, value }`. */
export async function instanceStoredValues(
	db: Db,
	specSlug: string
): Promise<Array<{ nodeKey: string; slot: string; path: string; value: unknown }>> {
	return explode((await instanceValuesOf(db, specSlug)) as Values | null)
}

function explode(values: Values | null): Array<{ nodeKey: string; slot: string; path: string; value: unknown }> {
	const out: Array<{ nodeKey: string; slot: string; path: string; value: unknown }> = []
	for (const [nodeKey, slots] of Object.entries(values ?? {}))
		for (const [slot, cur] of Object.entries(slots ?? {})) {
			if (cur && typeof cur === "object" && !Array.isArray(cur))
				for (const [path, value] of Object.entries(cur as Record<string, unknown>)) out.push({ nodeKey, slot, path, value })
			else out.push({ nodeKey, slot, path: "", value: cur })
		}
	return out
}

/**
 * Every instance value stored at one of `slots`, every pipeline — what the
 * delete guards of shared rows (prompts, context templates, layouts) scan
 * beside the registrations' values: a reference held here keeps its row. As
 * `RegistrationValueRef`s at scope `instance` (`scopeRef` the pipeline's slug,
 * `rowId` the negated spec id, so it never meets a registration row's).
 */
export async function instanceValueRefs(db: Db, slots: readonly string[]): Promise<RegistrationValueRef[]> {
	if (!slots.length) return []
	const want = new Set(slots)
	const rows = await db
		.select({ id: schema.pipelineSpecs.id, slug: schema.pipelineSpecs.slug, values: schema.pipelineSpecs.instanceValues })
		.from(schema.pipelineSpecs)
	const out: RegistrationValueRef[] = []
	for (const row of rows) {
		for (const v of explode(valuesOf(row.values)))
			if (want.has(v.slot))
				out.push({ rowId: -row.id, scopeKind: "instance", scopeRef: row.slug, key: "", ...v })
	}
	return out
}
