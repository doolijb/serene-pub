/**
 * The **Loadout** row of a model call's settings group (I12; DESIGN-image-
 * generation §11, §12 "Suggestions", §14 item 4) — admin's Pipelines only.
 *
 * Three things, all read once per view:
 *
 *  · the picker's rows: every loadout doing this step's transform, each with
 *    the consequence words its pair would earn against this step's needs
 *    (`consequencesFor`) — never a grade;
 *  · the node's own loadout, resolved by the SAME functions the run uses
 *    (`findLoadout` → `resolveLoadout`, as `world.ts applyLoadoutLayer`
 *    does), so the chain and the slots' provenance say what the run will do;
 *  · the *Needs / Best with* line: needs derived from wiring and
 *    declarations only, *Best with* from the definition's `prefers`.
 *
 * Nothing here resolves a loadout by its own rule — a second copy of the
 * walk is the copy that disagrees with the run.
 */

import { asc } from "drizzle-orm"
import { capabilityLabel, type CapabilityId } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import {
	describeLoadoutChain,
	findLoadout,
	loadoutIdOf,
	resolveLoadout,
	type LoadoutResolution,
	type LoadoutRow
} from "$lib/server/loadouts"
import {
	consequencesFor,
	TIER_WORDS,
	type GradeSet,
	type StepNeeds
} from "$lib/shared/loadouts/consequence"
import { capabilityOfSlot, type SlotLoadout } from "$lib/server/pipelines/config/panel/provenance"
import type { Decl } from "$lib/server/pipelines/config/panel/types"

/** A loadout choice: the row id (what the picker selects) and the id the slot stores. */
export interface LoadoutChoice {
	id: number
	label: string
	description?: string
	/** The id a `loadout-ref` stores (`{ id: loadoutId }`). */
	loadoutId: string
}

/** The node's own loadout, resolved. */
export interface NodeLoadout {
	row: LoadoutRow
	resolution: LoadoutResolution
	chain: string
}

/** The slice of a stored document the needs read. */
export interface NeedsNode {
	key: string
	definitionId?: string
	definitionVersion?: number
	prefers?: { sampling?: string; tier?: string } | null
}
export interface NeedsEdge {
	to: string
	toPort?: string
}
export interface NeedsDefinition {
	ports?: { in?: Record<string, unknown> } | null
	policy?: Record<string, unknown> | null
}

const basePort = (p: string | undefined) => (p ?? "").split(/[.[]/)[0] ?? ""

/** What a step needs, from its wiring and its definition's ports — never declared. */
export function stepNeedsOf(
	node: NeedsNode,
	edges: readonly NeedsEdge[],
	def: NeedsDefinition | undefined
): StepNeeds & { attachments?: boolean } {
	const wired = new Set(edges.filter((e) => e.to === node.key).map((e) => basePort(e.toPort)))
	const declared = new Set(Object.keys(def?.ports?.in ?? {}))
	const needs: StepNeeds & { attachments?: boolean } = {}
	if (
		/^core:oracle\/generate-json(@|$)/.test(node.definitionId ?? "") ||
		wired.has("schema")
	)
		needs.structured = true
	if (declared.has("tools") || wired.has("tools")) needs.tools = true
	if (wired.has("attachments")) needs.attachments = true
	if (wired.has("references")) needs.references = true
	return needs
}

/** The *Needs* words: the transform's label first, then each derived need. */
export function needsWords(
	transform: string | undefined,
	needs: StepNeeds & { attachments?: boolean }
): string[] {
	const out: string[] = []
	if (transform) out.push(capabilityLabel(transform as CapabilityId))
	if (needs.structured) out.push("a structured answer")
	if (needs.tools) out.push("tool calls")
	if (needs.attachments) out.push("attachments")
	if (needs.references) out.push("reference pictures")
	return out
}

/** The *Best with* words, from a placement's `prefers` or its definition's. */
export function bestWithWords(
	prefers: { sampling?: string; tier?: string } | null | undefined,
	samplingNameBySeed: ReadonlyMap<string, string>
): string[] {
	if (!prefers) return []
	const out: string[] = []
	if (prefers.sampling) {
		const name = samplingNameBySeed.get(prefers.sampling)
		if (name) out.push(`${name} sampling`)
	}
	if (prefers.tier && TIER_WORDS[prefers.tier]) out.push(TIER_WORDS[prefers.tier]!)
	return out
}

/** The transform a model call does: its connection slot's `requires`, else its sampling shape. */
export function transformOfNode(
	decls: readonly Pick<Decl, "nodeKey" | "control" | "requires" | "shape">[],
	nodeKey: string
): string | undefined {
	const own = decls.filter((d) => d.nodeKey === nodeKey)
	const conn = own.find((d) => d.control === "connection-ref")
	const samp = own.find((d) => d.control === "sampling-ref")
	return (conn && capabilityOfSlot(conn)) ?? (samp && capabilityOfSlot(samp)) ?? undefined
}

/**
 * Everything the Loadout rows of one view need, loaded once. `resolve` is
 * memoised per row: a spec with four model calls asks about the same handful
 * of loadouts four times.
 */
export async function loadoutPanel(db: Db) {
	const rows = await db.select().from(schema.loadouts).orderBy(asc(schema.loadouts.name))
	const samplingNameBySeed = new Map<string, string>()
	for (const s of await db
		.select({ seedKey: schema.samplingConfigs.seedKey, name: schema.samplingConfigs.name })
		.from(schema.samplingConfigs))
		if (s.seedKey) samplingNameBySeed.set(s.seedKey, s.name)

	const memo = new Map<number, Promise<LoadoutResolution>>()
	const resolve = (row: LoadoutRow) => {
		if (!memo.has(row.id)) memo.set(row.id, resolveLoadout(db, row))
		return memo.get(row.id)!
	}

	/** The node's loadout as a stored value names it, resolved — null for none. */
	const nodeLoadout = async (value: unknown): Promise<NodeLoadout | null> => {
		if (value == null) return null
		const row = await findLoadout(db, value)
		if (!row) return null
		const resolution = await resolve(row)
		return { row, resolution, chain: describeLoadoutChain(resolution) }
	}

	/** The picker rows for a step doing `transform` with `needs`. */
	const choices = async (
		transform: string | undefined,
		needs: StepNeeds,
		gradesOf: (connectionId: number) => GradeSet | undefined
	): Promise<LoadoutChoice[]> => {
		const out: LoadoutChoice[] = []
		for (const row of rows) {
			if (transform && row.transform !== transform) continue
			const r = await resolve(row)
			const words: string[] = []
			if (r.fellBack) {
				const fallback = r.hops.find((h) => h.via === "unfilled-fallback")
				words.push(
					fallback
						? `Unfilled — falls back to ${fallback.name}`
						: "Unfilled — nothing to fall back to yet"
				)
			}
			if (r.effective?.connectionId != null)
				words.push(...consequencesFor(gradesOf(r.effective.connectionId), needs))
			out.push({
				id: row.id,
				label: row.name,
				...(words.length ? { description: words.join(" · ") } : {}),
				loadoutId: loadoutIdOf(row)
			})
		}
		return out
	}

	return { rows, samplingNameBySeed, nodeLoadout, choices }
}

/**
 * What a node's loadout supplies to one of its slots, for `readingOf`:
 * `undefined` when the node has no loadout slot, `null` when it has one but
 * names nothing (or names a loadout that supplies nothing here).
 */
export function slotLoadoutOf(
	nl: NodeLoadout | null,
	slot: "connection" | "sampling"
): SlotLoadout | null {
	const eff = nl?.resolution.effective
	if (!nl || !eff) return null
	const supplies =
		slot === "connection"
			? { id: String(eff.connectionId), modelId: eff.connectionModelId ?? null }
			: (eff.samplingConfigId ?? undefined)
	if (supplies == null) return null
	const fallback = nl.resolution.fellBack
		? nl.resolution.hops.find((h) => h.via === "unfilled-fallback")
		: undefined
	return {
		name: nl.row.name,
		supplies,
		...(fallback ? { fallbackName: fallback.name } : {})
	}
}
