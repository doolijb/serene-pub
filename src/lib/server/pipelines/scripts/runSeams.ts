/**
 * What a run has to know about its script seams before its first node
 * (PLAN-script-placement D4, and the connection-guard tier fix of 2026-10-10).
 *
 * The executor applies chains at DECLARED seams only (`seamsOf`), so a chain
 * whose seam is gone is never handed to the applier — nothing at run time
 * would notice it. This module is where the run notices, once, from the same
 * resolved configuration the executor will read:
 *
 * - an **unplaced** chain holding an enabled `text/stop` guard halts the run
 *   before it proceeds (R-O2): a guard that silently stops applying is the
 *   worst outcome, a halted reply naming it the readable one;
 * - any other unplaced chain is skipped with one receipt note.
 *
 * And, per node, which connection's stop guards join its `text/stop` seams:
 * the connection THAT step is configured to run on, not the instance default.
 */

import { inArray } from "drizzle-orm"
import {
	getDefinition,
	resolveConfig,
	seamsOf,
	type ConfigWorld,
	type ScriptPointDecl,
	type SpecDocument
} from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { budgetedProviderOf } from "$lib/server/pipelines/runtime/specShape"
import { i18nTextIn } from "$lib/shared/i18n/i18nText"
import { slotConnectionId, slotModelId } from "$lib/shared/connections/slotRef"
import {
	isUnplacedChain,
	type ChainNode
} from "$lib/server/pipelines/config/chainAddresses"
import {
	connectionStopsFor,
	SCRIPT_BUDGET_PARAM,
	type ConnectionStops
} from "$lib/server/pipelines/scripts/chains"

const STOP_KIND = "core:script:text/stop@1"

type DocNode = SpecDocument["nodes"][number] & {
	expose?: { label?: unknown }
	config?: Record<string, unknown>
}

/** The step's name, as a person reads it: its step label, else its definition's name. */
export function stepLabelOf(node: DocNode): string {
	const def = getDefinition(`${node.definitionId}@${node.definitionVersion}`) as
		| { i18n?: { name?: unknown } }
		| undefined
	const tail =
		node.definitionId.replace(/@\d+$/, "").split("/").pop() ?? node.definitionId
	const words = tail.split(/[-_]/).join(" ")
	return (
		i18nTextIn(node.expose?.label) ??
		i18nTextIn(def?.i18n?.name) ??
		words.charAt(0).toUpperCase() + words.slice(1)
	)
}

/** `scripts` / `each-draft` → `scripts/each-draft`; a slot's whole value → its slot name. */
const whereOf = (slot: string, path: string) => (path ? `${slot}/${path}` : slot)

export interface UnplacedAtStart {
	/** Set when an unplaced chain holds an enabled stop guard: the run must not proceed. */
	halt?: { nodeKey: string; reason: string }
	/** One receipt note per unplaced chain that is skipped. */
	notes: string[]
}

/**
 * The unplaced chains this run would carry, read off the resolved config.
 * Best-effort: a failed read costs the notes, never the turn — except that a
 * lost guard found is always reported.
 */
export async function unplacedAtStart(
	db: Db,
	doc: SpecDocument,
	world: ConfigWorld
): Promise<UnplacedAtStart> {
	const nodes = doc.nodes as DocNode[]
	const chainNodes = new Map<string, ChainNode>(
		nodes.map((n, i) => [
			n.key,
			{
				nodeKey: n.key,
				definitionId: n.definitionId,
				definitionVersion: (n.definitionVersion as number | undefined) ?? null,
				position: i,
				expose: n.expose ?? null,
				row: getDefinition(`${n.definitionId}@${n.definitionVersion}`) as
					| ChainNode["row"]
					| undefined
			}
		])
	)
	const resolved = resolveConfig(
		world,
		nodes.map((n) => n.key)
	)
	const found: Array<{ node: DocNode; slot: string; path: string; ids: number[] }> = []
	for (const node of nodes) {
		// A definition this build does not know cannot run at all — the
		// executor refuses it on its own terms; it is no unplaced chain.
		if (!chainNodes.get(node.key)?.row) continue
		for (const [slot, paths] of Object.entries(resolved[node.key] ?? {}))
			for (const [path, value] of Object.entries(paths ?? {})) {
				if (!isUnplacedChain(chainNodes, node.key, slot, path)) continue
				const ids = (Array.isArray(value) ? value : []).filter(
					(v): v is number => typeof v === "number"
				)
				if (ids.length) found.push({ node, slot, path, ids })
			}
	}
	if (!found.length) return { notes: [] }

	const rows = (await db
		.select({
			id: schema.pipelineScripts.id,
			name: schema.pipelineScripts.name,
			typeId: schema.pipelineScripts.typeId,
			enabled: schema.pipelineScripts.enabled
		})
		.from(schema.pipelineScripts)
		.where(
			inArray(
				schema.pipelineScripts.id,
				[...new Set(found.flatMap((f) => f.ids))]
			)
		)) as Array<{ id: number; name: string; typeId: string; enabled: boolean }>
	const byId = new Map(rows.map((r) => [r.id, r]))

	const out: UnplacedAtStart = { notes: [] }
	for (const f of found) {
		const label = stepLabelOf(f.node)
		const guard = f.ids
			.map((id) => byId.get(id))
			.find((r) => r && r.enabled && r.typeId === STOP_KIND)
		if (guard && !out.halt)
			out.halt = {
				nodeKey: f.node.key,
				reason: `stop guard "${guard.name}" has no place to run on step ${label}`
			}
		else if (!guard)
			out.notes.push(
				`scripts at ${whereOf(f.slot, f.path)} on ${label}: no longer here, skipped`
			)
	}
	return out
}

/**
 * Each node's connection stop guards, for every node with a seam that
 * accepts `text/stop` — resolved through the step's own configured
 * connection (tier 2), exactly as `dispatch.ts` resolves the generate step's.
 * A step that runs on no model of its own (an outlet's `in:text` seam) takes
 * the run's text provider's; a `connection` slot wired to another node's
 * (`slot.connectionOf`) follows the reference, as the budget's tokenizer does.
 */
export async function stopGuardsByNode(
	db: Db,
	doc: SpecDocument,
	world: ConfigWorld
): Promise<Record<string, ConnectionStops | undefined>> {
	const nodes = doc.nodes as DocNode[]
	const guarded = nodes.filter((n) => {
		const def = getDefinition(`${n.definitionId}@${n.definitionVersion}`) as
			| { slots?: Record<string, unknown>; scriptPoints?: ScriptPointDecl[] }
			| undefined
		return (
			!!def &&
			seamsOf({ slots: def.slots, scriptPoints: def.scriptPoints }).some((s) =>
				s.accepts.includes(STOP_KIND)
			)
		)
	})
	if (!guarded.length) return {}
	// Whose `connection` slot decides: the guarded step's own, when its
	// definition declares one; else the run's text provider — the node the
	// budget pairs its connection with, else the first preview provider — which
	// is where the text a write-side seam guards came from (core's stop
	// seams sit on the outlets, `in:text`, and an outlet runs on no model).
	const provider = budgetedProviderOf(doc)?.key
	const followRef = (n: DocNode): string => {
		const ref = n.config?.["connection"] as
			| { __ref?: unknown; ofNode?: unknown }
			| undefined
		return ref && ref.__ref === "slot" && typeof ref.ofNode === "string"
			? ref.ofNode
			: n.key
	}
	const owners = guarded.map((n) => {
		const def = getDefinition(`${n.definitionId}@${n.definitionVersion}`) as
			| { slots?: Record<string, { kind?: unknown }> }
			| undefined
		const ownsConnection = Object.values(def?.slots ?? {}).some(
			(sl) => sl?.kind === "connection"
		)
		if (ownsConnection) return followRef(n)
		const p = provider ? nodes.find((x) => x.key === provider) : undefined
		return p ? followRef(p) : n.key
	})
	const resolved = resolveConfig(world, [...new Set(owners)])
	const memo = new Map<string, Promise<ConnectionStops | undefined>>()
	const out: Record<string, ConnectionStops | undefined> = {}
	for (let i = 0; i < guarded.length; i++) {
		const stored = resolved[owners[i]!]?.["connection"]?.[""]
		const candidate =
			stored == null
				? null
				: {
						connectionId: slotConnectionId(stored),
						connectionModelId: slotModelId(stored)
					}
		const key = JSON.stringify(candidate)
		if (!memo.has(key)) memo.set(key, connectionStopsFor(db, candidate))
		out[guarded[i]!.key] = await memo.get(key)!
	}
	return out
}

/**
 * Per step, the script time limit its own `params.budgetMs` sets (plan
 * 2026-10-12 §5) — for every node whose definition declares both a `scripts`
 * slot and that parameter (`core:task/run-script@1` today). Resolved through
 * the same scope chain the executor reads, so the drawer's value and the
 * run's agree; a value outside the declared bounds is clamped to them, and a
 * step with nothing usable is left out, so the seam default applies there.
 */
export function scriptBudgetsByNode(
	doc: SpecDocument,
	world: ConfigWorld
): Record<string, number> {
	type Field = { default?: unknown; min?: unknown; max?: unknown }
	const owners = (doc.nodes as DocNode[]).flatMap((n) => {
		const slots = (
			getDefinition(`${n.definitionId}@${n.definitionVersion}`) as
				| { slots?: Record<string, { kind?: unknown; schema?: Record<string, Field> }> }
				| undefined
		)?.slots
		const entry = Object.entries(slots ?? {}).find(
			([, s]) => s?.kind === "parameters" && s.schema?.[SCRIPT_BUDGET_PARAM]
		)
		const field = entry?.[1].schema?.[SCRIPT_BUDGET_PARAM]
		const hasScripts = Object.values(slots ?? {}).some(
			(s) => s?.kind === "scripts"
		)
		return entry && field && hasScripts
			? [{ key: n.key, slot: entry[0], field }]
			: []
	})
	if (!owners.length) return {}
	const resolved = resolveConfig(
		world,
		owners.map((o) => o.key)
	)
	const out: Record<string, number> = {}
	for (const { key, slot, field } of owners) {
		const stored = resolved[key]?.[slot]?.[SCRIPT_BUDGET_PARAM]
		const raw = typeof stored === "number" ? stored : field.default
		if (typeof raw !== "number" || !Number.isFinite(raw)) continue
		const min = typeof field.min === "number" ? field.min : 1
		const max = typeof field.max === "number" ? field.max : Infinity
		out[key] = Math.min(max, Math.max(min, Math.floor(raw)))
	}
	return out
}
