/**
 * A connection ROW's capabilities: resolving them, reading them, storing them.
 *
 * The SDK's `resolveCapabilities` is pure and knows nothing about this app — it
 * takes four layers and collapses them. This is the app-side wrapper that knows
 * where those layers live: the adapter's declaration in the static manifest, the
 * preset slug on the row, the probe the last successful test wrote, and the
 * person's own toggles.
 *
 * The split between the two halves of the `capabilities` column is the thing to
 * keep straight while reading this file:
 *
 *   - `overrides` and `probe` are DURABLE INTENT. Nothing recomputes them; a
 *     writer that was not handed one must leave the stored one alone.
 *   - `resolved` is a CACHE of the other two plus the static manifest. It exists
 *     because the config picker reads every connection against every slot, and
 *     deriving it there would mean importing an adapter module per row — which is
 *     exactly what `manifest.ts` exists to avoid (`@lmstudio/sdk` cannot be
 *     statically imported on Android at all).
 *
 * So every write goes through `persistCapabilities`, which rebuilds the cache
 * from whichever durable halves it was given and keeps the rest.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	BAND_ORDER,
	gradeOf,
	resolveCapabilities,
	topGrade,
	type Band,
	type CapabilityId,
	type CapabilityOverrides,
	type CapabilitySet
} from "@serene-pub/sdk"
import {
	adapterCapabilities,
	PRESET_CAPABILITIES
} from "$lib/shared/connectionAdapters/manifest"

/** What `connections.capabilities` holds (0175). */
export type StoredCapabilities = {
	/** The effective set `satisfies()` reads. Derived — never the source. */
	resolved?: CapabilitySet
	/** What a person switched by hand. `false` is an explicit off. */
	overrides?: CapabilityOverrides
	/** What the last successful test answered, and when it answered. */
	probe?: { found: CapabilitySet; at?: string }
}

/**
 * Everything resolution needs from a connection.
 *
 * Deliberately not `SelectConnection`: `connections:test` resolves UNSAVED form
 * state, which has no id and may never have been a row at all.
 */
export interface CapabilityRow {
	type: string
	preset?: string | null
	capabilities?: Record<string, unknown> | null
}

const column = (
	row: { capabilities?: unknown } | null | undefined
): StoredCapabilities =>
	(row?.capabilities as StoredCapabilities | null | undefined) ?? {}

/**
 * The WHOLE column, defaulted — both durable halves and the cache.
 *
 * ⚠ This is NOT the function that answers "what can this connection do". That is
 * `storedCapabilities` in `pipelines/runtime/capabilityGuard.ts`, and the
 * difference is load-bearing: it INTERSECTS the cached `resolved` set with the
 * live manifest key space, because the cache outlives the declaration it was
 * built from — a row that resolved `text->image` before OPENAI_CHAT lost the key
 * still carries it. There used to be a second `storedCapabilities` HERE that
 * returned `.resolved` straight, exported and imported by nothing; the two names
 * were identical, so the first person to reach for "the effective set" had even
 * odds of picking the one that reopens that hole. One fact, one spelling: the
 * un-intersected read is gone and this returns the raw column, which is a
 * different question with a different name.
 *
 * The capability panel and the toggle handler are what need all three halves:
 * the overrides ARE the control's position, and `probe.at` is what stops an
 * untested connection from looking authoritative.
 */
export function capabilityColumn(
	row: CapabilityRow | null | undefined
): StoredCapabilities {
	return column(row)
}

/**
 * The four layers for this row, collapsed.
 *
 * `probe` is an argument as well as a stored half because a test resolves with
 * an answer that is not written yet — and, for an unsaved connection, never will
 * be. An absent argument falls back to the stored one rather than to nothing, so
 * re-resolving on edit does not silently discard what the backend already said.
 */
export function resolveConnectionCapabilities(
	row: CapabilityRow,
	probe?: CapabilitySet
): CapabilitySet {
	const adapter = adapterCapabilities(row?.type)
	// A type no entry declares can express nothing nameable — an honest empty
	// set, not a guess, so a slot refuses it at bind rather than at the request.
	if (!adapter) return {}
	const stored = column(row)
	return resolveCapabilities({
		adapter,
		preset: row.preset ? PRESET_CAPABILITIES[row.preset] : undefined,
		probe: probe ?? stored.probe?.found,
		overrides: stored.overrides
	})
}

const BAND_NAMES = new Set<string>(BAND_ORDER)

/**
 * An adapter's `extra.capabilities` read as a probe, or `undefined` if it said
 * nothing this resolver can use.
 *
 * Adapters answer over the untyped `extra` passthrough, so the values arrive as
 * whatever the backend's own endpoint made convenient — KoboldCPP's version
 * response is a bag of booleans, and the image adapters state a band by name.
 * Normalizing here, once, keeps the DURABLE half of the column free of anything
 * `resolveCapabilities` cannot read: a probe outlives by months the test that
 * produced it.
 *
 * All three spellings land on a GRADE, on that capability's own scale. `true`
 * means the capability's top band, which is 1 for `text->image` and 2 for
 * `tools` — so a boolean answer cannot accidentally claim a middling grade, and
 * cannot accidentally claim a grade the capability does not have either.
 *
 * ⚠ Band NAMES stay readable here on purpose. `extra` is the adapter's untyped
 * bag; `A1111Adapter` and `KoboldCppManagedImageAdapter` both write
 * `{"text->image": "native"}` into it, and normalizing that spelling is this
 * function's stated job rather than something for each adapter to remember.
 */
export function probedCapabilities(extra: unknown): CapabilitySet | undefined {
	const found = (extra as { capabilities?: unknown } | null | undefined)
		?.capabilities
	if (!found || typeof found !== "object") return undefined
	const out: CapabilitySet = {}
	for (const [key, value] of Object.entries(
		found as Record<string, unknown>
	)) {
		const id = key as CapabilityId
		if (typeof value === "boolean") out[id] = value ? topGrade(id) : 0
		else if (typeof value === "number" && Number.isFinite(value))
			out[id] = gradeOf(id, value)
		else if (typeof value === "string" && BAND_NAMES.has(value))
			out[id] = gradeOf(id, value as Band)
	}
	return Object.keys(out).length ? out : undefined
}

export interface PersistCapabilitiesInput {
	/** The rebuilt cache. Always written. */
	resolved: CapabilitySet
	/** A fresh probe, if this write is a test. Omit to keep the stored one. */
	probe?: CapabilitySet
	/**
	 * New toggles, if this write is a person's. Omit to keep the stored ones.
	 *
	 * A caller that MEANS "there are no overrides any more" must pass `{}` and
	 * not `undefined`: undefined is read as "keep what is stored", so clearing
	 * the last one would be a no-op that springs back on the next load.
	 */
	overrides?: CapabilityOverrides
}

/**
 * Write the column back, keeping the durable halves this caller did not touch.
 *
 * Read-then-write rather than a JSON patch: the column is one value, and the two
 * writers that meet here (a test, and an edit) each know only their own half —
 * an edit that wrote the whole column from what it knew would erase the probe of
 * every test that came before it.
 *
 * A fresh probe REPLACES rather than merges with the stored one. It answers for
 * the model loaded right now, so a capability the backend has stopped reporting
 * is an answer too, and keeping the old key would outlive the truth of it.
 *
 * Returns what it WROTE, which the toggle handler answers with. Building that
 * response from `next` instead would be right almost always and wrong at the one
 * place worth guarding — the `determined` fallback below can keep a cache this
 * caller did not hand it, and a response that disagreed with the row would put
 * the panel one toggle behind the truth. The two older callers ignore it.
 */
export async function persistCapabilities(
	db: any,
	connectionId: number,
	next: PersistCapabilitiesInput
): Promise<StoredCapabilities> {
	const [row] = await db
		// `type` as well as the column: the empty-rebuild guard below has to know
		// whether the manifest declares anything for this row, and emptiness alone
		// cannot tell it.
		.select({
			capabilities: schema.connections.capabilities,
			type: schema.connections.type
		})
		.from(schema.connections)
		.where(eq(schema.connections.id, connectionId))
		.limit(1)
	const current = column(row)
	// An empty rebuild keeps the stored cache ONLY when the type declares nothing
	// — never merely because the rebuild came out empty.
	//
	// The case this protects is real: `resolveConnectionCapabilities` returns `{}`
	// for a type no manifest entry declares, and `openai-embeddings` and
	// `local-onnx` are exactly that. 0175 determined `text->embedding` for those
	// rows from their old modality column, and without the guard the
	// first unrelated edit would write `{}` back, which the bind guard reads as
	// "not determined yet" and falls through to the modality test — quietly making
	// an embeddings connection acceptable for chat again.
	//
	// ⚠ But keying on EMPTINESS made a deliberate answer indistinguishable from an
	// unknown type, and on an image-only connection those are the same rebuild.
	// KOBOLDCPP_MANAGED_IMAGE declares exactly `{"text->image": "native"}` and A1111
	// has only `text->image` in its defaults, so switching Image generation OFF
	// resolves to `{}` — and the old guard wrote the PRE-toggle cache straight back.
	// The override was stored correctly and the cache everything actually reads
	// disagreed with it, so the connection kept being offered in every image picker
	// while the panel claimed something else was supplying it. That is precisely
	// the switch this panel exists for.
	//
	// So: ask WHY it is empty. A declared adapter resolving to nothing is an
	// answer and is written.
	const declares = adapterCapabilities(row?.type) !== undefined
	const determined =
		Object.keys(next.resolved).length || declares
			? next.resolved
			: (current.resolved ?? next.resolved)
	const capabilities: StoredCapabilities = {
		resolved: determined,
		probe: next.probe
			? { found: next.probe, at: new Date().toISOString() }
			: current.probe,
		overrides: next.overrides ?? current.overrides
	}
	await db
		.update(schema.connections)
		.set({ capabilities })
		.where(eq(schema.connections.id, connectionId))
	return capabilities
}
