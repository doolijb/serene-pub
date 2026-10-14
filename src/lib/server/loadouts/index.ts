/**
 * **Loadouts** — reading, resolving and merging (plan I12; DESIGN-image-
 * generation §11–§14).
 *
 * A loadout is a row naming the pair `(connection, model)`, a sampling config
 * and — for a template-payload image pair — a workflow. A node names one on its
 * oracle's `loadout` slot by id; the host resolves PER VALUE:
 *
 *   the node's explicit slot → its loadout, following `merged_into` to the
 *   root → if that root is **unfilled** (no pair), the transform's default
 *   loadout.
 *
 * "Unfilled" falls through WHOLE — pair and sampling together — so an unfilled
 * Extraction runs exactly as Reply does, never Reply's model with
 * Extraction's window (a model reload between neighbouring steps). That is the
 * beginner-first reading of §13: everything runs on one model until somebody
 * fills a specialist.
 *
 * The transform DEFAULT is the loadout whose `(default_for_input,
 * default_for_output)` names the transform; `connections/capabilityDefaults.ts`
 * is the storage boundary that reads it for every resolver.
 */

import { and, eq, isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	capabilityLabel,
	isTransformId,
	parseLoadoutId,
	type TransformId
} from "@serene-pub/sdk"
import { sidesOf, transformIdOf } from "$lib/shared/capabilities/sides"

export type LoadoutRow = typeof schema.loadouts.$inferSelect

/** The id grammar a row answers to: its seed key, or `pub:loadout/<slug>`. */
export function loadoutIdOf(row: Pick<LoadoutRow, "seedKey" | "owner" | "slug">): string {
	return row.seedKey ?? `${row.owner}:loadout/${row.slug}`
}

/** Is the pair set? An unfilled loadout falls back to its transform's default. */
export const isFilled = (row: Pick<LoadoutRow, "connectionId">): boolean =>
	row.connectionId != null

/** The transform a default-flagged row is the default for, or null. */
export function defaultTransformOf(
	row: Pick<LoadoutRow, "defaultForInput" | "defaultForOutput">
): TransformId | null {
	if (!row.defaultForInput || !row.defaultForOutput) return null
	return transformIdOf({
		input: row.defaultForInput,
		output: row.defaultForOutput
	})
}

/**
 * Find a loadout by whatever a stored value holds: a `loadout-ref` (`{ id }`),
 * its id string (`core:loadout/reply@1`, `acme.rp:loadout/x@1`,
 * `pub:loadout/my-slug`), or a row id. Null for anything that names nothing.
 */
export async function findLoadout(
	db: Db,
	ref: unknown
): Promise<LoadoutRow | null> {
	if (ref == null) return null
	if (typeof ref === "object" && "id" in (ref as object))
		return findLoadout(db, (ref as { id: unknown }).id)
	if (typeof ref === "number" || (typeof ref === "string" && /^\d+$/.test(ref))) {
		const [row] = await db
			.select()
			.from(schema.loadouts)
			.where(eq(schema.loadouts.id, Number(ref)))
			.limit(1)
		return row ?? null
	}
	if (typeof ref !== "string") return null
	const [bySeed] = await db
		.select()
		.from(schema.loadouts)
		.where(eq(schema.loadouts.seedKey, ref))
		.limit(1)
	if (bySeed) return bySeed
	const parts = parseLoadoutId(ref)
	if (!parts || parts.major !== null) return null
	const [byOwnerSlug] = await db
		.select()
		.from(schema.loadouts)
		.where(
			and(
				eq(schema.loadouts.owner, parts.owner),
				eq(schema.loadouts.slug, parts.name)
			)
		)
		.limit(1)
	return byOwnerSlug ?? null
}

export async function loadoutById(db: Db, id: number): Promise<LoadoutRow | null> {
	const [row] = await db
		.select()
		.from(schema.loadouts)
		.where(eq(schema.loadouts.id, id))
		.limit(1)
	return row ?? null
}

/** The default loadout for a transform, or null when none is flagged. */
export async function defaultLoadoutFor(
	db: Db,
	transform: string
): Promise<LoadoutRow | null> {
	if (!isTransformId(transform)) return null
	const { input, output } = sidesOf(transform as TransformId)
	const [row] = await db
		.select()
		.from(schema.loadouts)
		.where(
			and(
				eq(schema.loadouts.defaultForInput, input),
				eq(schema.loadouts.defaultForOutput, output)
			)
		)
		.limit(1)
	return row ?? null
}

/** Every default-flagged loadout, keyed by transform. */
export async function defaultLoadouts(db: Db): Promise<Map<string, LoadoutRow>> {
	const rows = await db
		.select()
		.from(schema.loadouts)
		.where(isNotNull(schema.loadouts.defaultForInput))
	const out = new Map<string, LoadoutRow>()
	for (const r of rows) {
		const t = defaultTransformOf(r)
		if (t) out.set(t, r)
	}
	return out
}

/**
 * Follow `merged_into` to the root. Returns the walk, requested row first.
 * A cycle cannot be written (`mergeLoadout` refuses it); one that exists
 * anyway (hand-edited rows) stops at the first repeat rather than looping.
 */
export async function mergeChain(db: Db, start: LoadoutRow): Promise<LoadoutRow[]> {
	const walk: LoadoutRow[] = [start]
	const seen = new Set<number>([start.id])
	let at = start
	while (at.mergedInto != null) {
		const parent = await loadoutById(db, at.mergedInto)
		if (!parent || seen.has(parent.id)) break
		walk.push(parent)
		seen.add(parent.id)
		at = parent
	}
	return walk
}

/** One step of a resolution, for the receipt and the Pipelines group. */
export interface LoadoutHop {
	id: number
	loadoutId: string
	name: string
	/** How this hop was reached: named by the node, a merge, or the unfilled fallback. */
	via: "named" | "merged" | "unfilled-fallback"
}

/**
 * What a named loadout resolves to.
 *
 * `effective` is the row whose pair/sampling/workflow apply — the merge root
 * when filled, else the transform default's root (when that one is filled),
 * else null (nothing set: the run refuses through `resolveCapabilityTarget`).
 */
export interface LoadoutResolution {
	requested: LoadoutRow
	hops: LoadoutHop[]
	effective: LoadoutRow | null
	/** True when the requested loadout's root had no pair. */
	fellBack: boolean
}

export async function resolveLoadout(
	db: Db,
	requested: LoadoutRow,
	transform?: string
): Promise<LoadoutResolution> {
	const chain = await mergeChain(db, requested)
	const hops: LoadoutHop[] = chain.map((r, i) => ({
		id: r.id,
		loadoutId: loadoutIdOf(r),
		name: r.name,
		via: i === 0 ? "named" : "merged"
	}))
	const root = chain[chain.length - 1]!
	if (isFilled(root)) return { requested, hops, effective: root, fellBack: false }

	const fallback = await defaultLoadoutFor(db, transform ?? root.transform)
	if (!fallback || chain.some((r) => r.id === fallback.id))
		return { requested, hops, effective: null, fellBack: true }
	const fallbackChain = await mergeChain(db, fallback)
	fallbackChain.forEach((r, i) =>
		hops.push({
			id: r.id,
			loadoutId: loadoutIdOf(r),
			name: r.name,
			via: i === 0 ? "unfilled-fallback" : "merged"
		})
	)
	const fbRoot = fallbackChain[fallbackChain.length - 1]!
	return {
		requested,
		hops,
		effective: isFilled(fbRoot) ? fbRoot : null,
		fellBack: true
	}
}

/**
 * The chain in receipt words: *Extraction (merged) → Reply (unfilled
 * fallback)*. `step` leads when given (*extract → …*).
 */
export function describeLoadoutChain(
	resolution: Pick<LoadoutResolution, "hops">,
	step?: string
): string {
	const words = resolution.hops.map((h) =>
		h.via === "merged"
			? `${h.name} (merged)`
			: h.via === "unfilled-fallback"
				? `${h.name} (unfilled fallback)`
				: h.name
	)
	return [...(step ? [step] : []), ...words].join(" → ")
}

/**
 * Merge `childId` into `parentId` — or unmerge with `parentId: null`.
 *
 * Refuses a cycle (the parent's own chain reaching the child), a self-merge,
 * and a parent of a different transform: a merged child resolves to its
 * parent's pair, so an image loadout merged into a text one would hand a text
 * model to a picture step.
 */
export async function mergeLoadout(
	db: Db,
	childId: number,
	parentId: number | null
): Promise<{ ok: true } | { ok: false; error: string }> {
	const child = await loadoutById(db, childId)
	if (!child) return { ok: false, error: "That loadout no longer exists." }
	if (parentId === null) {
		await db
			.update(schema.loadouts)
			.set({ mergedInto: null, updatedAt: new Date() })
			.where(eq(schema.loadouts.id, childId))
		return { ok: true }
	}
	if (parentId === childId)
		return { ok: false, error: "A loadout cannot be merged into itself." }
	const parent = await loadoutById(db, parentId)
	if (!parent) return { ok: false, error: "The parent loadout no longer exists." }
	if (parent.transform !== child.transform)
		return {
			ok: false,
			error:
				`${child.name} does ${capabilityLabel(child.transform as TransformId)} and ` +
				`${parent.name} does ${capabilityLabel(parent.transform as TransformId)} — ` +
				`a loadout merges only into one that does the same kind of work.`
		}
	const parentChain = await mergeChain(db, parent)
	if (parentChain.some((r) => r.id === childId))
		return {
			ok: false,
			error: `${parent.name} is already merged into ${child.name}; merging back would make a loop.`
		}
	await db
		.update(schema.loadouts)
		.set({ mergedInto: parentId, updatedAt: new Date() })
		.where(eq(schema.loadouts.id, childId))
	return { ok: true }
}

/** A slug from a name: lowercase, hyphens, the id grammar's name segment. */
export function slugifyLoadoutName(name: string): string {
	const s = name
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
	return s || "loadout"
}

/** A `pub` slug not yet taken: `name`, `name-2`, `name-3` … */
export async function freePubSlug(db: Db, wanted: string): Promise<string> {
	const base = slugifyLoadoutName(wanted)
	const taken = new Set(
		(
			await db
				.select({ slug: schema.loadouts.slug })
				.from(schema.loadouts)
				.where(eq(schema.loadouts.owner, "pub"))
		).map((r) => r.slug)
	)
	if (!taken.has(base)) return base
	let n = 2
	while (taken.has(`${base}-${n}`)) n++
	return `${base}-${n}`
}
