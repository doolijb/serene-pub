/**
 * Where a definition's script chains are stored, read off its registry row
 * (PLAN-script-placement D1/D4).
 *
 * A chain lives at one of two storage addresses, unchanged since 18 §4: a
 * `scripts`-kind slot's whole value (`config[nodeKey][slotName]['']`), or an
 * interior point under the `scripts` facet (`config[nodeKey].scripts[point]`).
 * `seamsOf` is the one reader of which of those a definition declares; this
 * module turns it into storage addresses, so the panel, the reconcile and the
 * run all ask the same question the same way.
 *
 * Two questions, deliberately apart:
 *
 * - `declaredChainAddresses` — the addresses this definition declares a seam
 *   at. A stored chain at one of them runs.
 * - `isChainAddress` — whether an address is SHAPED like a chain's, declared
 *   or not. A stored chain at a chain-shaped address absent from the definition's
 *   declares is **unplaced** (D4): kept and marked, never culled. Every other
 *   undeclared address is culled as before — the exception is scoped by
 *   address, not by guesswork.
 */

import { eq } from "drizzle-orm"
import { seamsOf, type ScriptPointDecl } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"

/** The registry row fields a seam is read from — rows carry them verbatim. */
export interface ChainRow {
	slots?: Record<string, unknown> | null
	scriptPoints?: ReadonlyArray<ScriptPointDecl> | null
}

/** `${slot}\u0000${path}` — joined on NUL for the reason `addr` is. */
export const chainKey = (slot: string, path: string): string =>
	`${slot}\u0000${path}`

/** The storage addresses this definition declares a seam at, as `chainKey`s. */
export function declaredChainAddresses(row: ChainRow | null | undefined): Set<string> {
	const out = new Set<string>()
	if (!row) return out
	for (const seam of seamsOf({
		slots: (row.slots ?? {}) as Record<string, unknown>,
		scriptPoints: (row.scriptPoints ?? []) as ScriptPointDecl[]
	}))
		out.add(
			seam.kind === "point"
				? chainKey("scripts", seam.at)
				: chainKey(seam.slot!, "")
		)
	return out
}

/**
 * Is `slot`/`path` a script chain's storage address on this definition —
 * a `scripts`-kind slot's whole value, or anything under the `scripts`
 * facet — whether or not a seam is declared there today?
 *
 * A `scripts` slot absent from the definition altogether cannot be
 * recognised by kind; the `scripts` facet still can, since that name is the
 * storage convention for interior points.
 */
export function isChainAddress(
	row: ChainRow | null | undefined,
	slot: string,
	path: string
): boolean {
	if (slot === "scripts") return true
	if (path !== "") return false
	const decl = (row?.slots ?? {})[slot] as { kind?: unknown } | undefined
	return decl?.kind === "scripts"
}

/** One node of a spec version, beside its definition's registry row. */
export interface ChainNode {
	nodeKey: string
	definitionId: string
	definitionVersion: number | null
	position: number
	/** The spec's step label for this node (`expose.label`), when it gave one. */
	expose: { label?: unknown } | null
	/** The pinned definition's registry row; undefined when it is not registered. */
	row: (ChainRow & { i18n?: { name?: unknown } | null; kind?: unknown; ports?: unknown }) | undefined
}

/**
 * Every node of a spec version with its registry row, keyed by node key —
 * what "the node is still in the spec" is asked against, and the row a chain
 * address is checked on.
 */
export async function chainNodesFor(
	db: Db,
	specVersionId: number
): Promise<Map<string, ChainNode>> {
	const nodes = await db
		.select()
		.from(schema.pipelineNodes)
		.where(eq(schema.pipelineNodes.specVersionId, specVersionId))
	const registry = await db.select().from(schema.pipelineDefinitionRegistry)
	const byPin = new Map<string, any>(
		(registry as any[]).map((r) => [`${r.definitionId}@${r.version}`, r])
	)
	return new Map(
		(nodes as any[]).map((n) => [
			n.nodeKey as string,
			{
				nodeKey: n.nodeKey,
				definitionId: n.definitionId,
				definitionVersion: n.definitionVersion ?? null,
				position: n.position ?? 0,
				expose: (n.expose ?? null) as ChainNode["expose"],
				row: byPin.get(`${n.definitionId}@${n.definitionVersion}`)
			}
		])
	)
}

/**
 * Is a stored value at this address an **unplaced** chain (D4)? The node is
 * still in the spec, the address is chain-shaped, and no seam is declared
 * there. A node that is gone answers false: its values are culled as before.
 */
export function isUnplacedChain(
	nodes: Map<string, ChainNode>,
	nodeKey: string,
	slot: string,
	path: string
): boolean {
	const node = nodes.get(nodeKey)
	if (!node) return false
	return (
		isChainAddress(node.row, slot, path) &&
		!declaredChainAddresses(node.row).has(chainKey(slot, path))
	)
}
