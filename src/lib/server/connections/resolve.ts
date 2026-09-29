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
 *
 * ⚠ And a cache written by an OLDER BUILD cannot name a capability that build
 * had never heard of, which is a different staleness from the one the bind
 * guard's intersection handles and needs the opposite move. The two readers that
 * matter both make it now: everything in this file resolves LIVE from the row
 * (see `resolveWireMode` and `resolveContinueRefusal` below), and the capability
 * panel's row model resolves the keys its cache does not name through this same
 * `resolveCapabilities` over these same four layers — `capabilityRows`'
 * `effectiveCapabilities`, which is a READ and writes nothing back. Refreshing
 * the stored cache is a write path's job and no write path does it on load
 * today, so an upgrading install's column keeps predating the key until a test
 * or an edit rewrites it.
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
import { wireModeFor } from "$lib/shared/connectionAdapters/wireMode"
import { continueRefusal } from "$lib/shared/connectionAdapters/continueReply"
import type { WireMode } from "@serene-pub/sdk"

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
 * built from — a row that resolved `text->image` before OPENAI lost the key
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
	/**
	 * ⚠ Only the COLUMN, not a `CapabilityRow`.
	 *
	 * It was `CapabilityRow`, which additionally requires `type` — and this
	 * function reads neither `type` nor `preset`, because it does not resolve
	 * anything; it defaults and returns what is stored. The tighter type stopped
	 * being merely redundant when 0114 added a second table with the same
	 * column: a `connection_models` row HAS no `type` (its key space belongs to
	 * the endpoint it hangs off), so `layerCapabilities` could not ask this one
	 * function about both halves of a pair. Widened to what it actually reads;
	 * every existing caller still satisfies it.
	 */
	row: { capabilities?: Record<string, unknown> | null } | null | undefined
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

/**
 * Which METHOD this connection wants to be called by: chat or completion.
 *
 * ## Resolved LIVE, from the row, rather than read off the cached set
 *
 * Everything else that asks what a connection can do reads
 * `capabilities.resolved` — the cache — because the picker asks it for every row
 * against every slot and re-resolving there would be wasteful. This does not,
 * for one reason that outranks that: the cache on an existing row was written by
 * a build in which these two keys did not exist, so it names neither mode, and
 * every connection on every upgrading install would answer "no wire mode" until
 * something happened to re-resolve it. Resolving here from the row's own four
 * layers costs a handful of object iterations, is immune to a cache written by
 * an older build, and needs no backfill.
 *
 * ⚠ This is THE server-side answer, and both readers must take it from here.
 * `config/world.ts` puts it on the connection descriptor the assemble node
 * renders against, and `withWireMode` puts it on the connection an adapter is
 * handed — so the shape the prompt is BUILT in and the shape it is SENT in are
 * one value resolved once, not two that have to agree. Two readings of this
 * question disagreeing is the entire defect wire mode exists to close.
 */
export function resolveWireMode(row: CapabilityRow): WireMode {
	return wireModeFor(row?.type, resolveConnectionCapabilities(row))
}

/**
 * Why this connection will not continue a partial reply, or `null` when it will.
 *
 * ## Resolved LIVE, from the row — the same reason `resolveWireMode` is
 *
 * And more sharply, because `continue_reply` is NEW: every existing row's
 * `capabilities.resolved` cache was written by a build in which this key did not
 * exist, so reading it from the cache would answer "off" for every connection on
 * every upgrading install until each was tested or saved again. Resolving here
 * from the row's own four layers costs a handful of object iterations and needs
 * no backfill.
 *
 * ## Two questions, one answer
 *
 * `continueRefusal` composes them: whether this connection MAY continue (the
 * capability, through the four layers) and whether the wire it is sent on CAN
 * (the type's `continuesIn`). The sentence it returns is the one the verb hands
 * back and the one the button wears as its title, so there is exactly one
 * wording of each refusal — see that module's header for why all three readers
 * take it from there.
 */
export function resolveContinueRefusal(row: CapabilityRow): string | null {
	return continueRefusal(row?.type, resolveConnectionCapabilities(row))
}

/**
 * A connection row with its wire mode attached, for an adapter to read back.
 *
 * The `withCompletionTemplate` precedent exactly: an adapter has no database and
 * no accessor on it may become async, so a fact it needs is resolved where the
 * connection is already being LOADED for a run and travels with the row it was
 * going to receive anyway. Called at the same two sites — `resolveCapabilityTarget`
 * and `resolveStepConfigs` — for the same reason, and no construction site gains
 * a parameter.
 *
 * ⚠ Returns a NEW object rather than mutating, so a caller holding the row it
 * passed in still holds a plain row.
 */
export function withWireMode<T extends CapabilityRow>(
	connection: T
): T & { wireMode: WireMode } {
	return { ...connection, wireMode: resolveWireMode(connection) }
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
	db: Db,
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

/** Order-insensitive equality for two resolved capability sets. */
function sameResolved(
	a: Record<string, unknown> | null | undefined,
	b: Record<string, unknown> | null | undefined
): boolean {
	const ak = Object.keys(a ?? {}).sort()
	const bk = Object.keys(b ?? {}).sort()
	if (ak.length !== bk.length) return false
	return ak.every(
		(k, i) =>
			k === bk[i] &&
			JSON.stringify((a ?? {})[k]) === JSON.stringify((b ?? {})[k])
	)
}

/**
 * Rebuild every connection's cached `resolved` set from the CURRENT manifest.
 *
 * This is the write path this file's header says does not exist: *"no write
 * path does it on load today, so an upgrading install's column keeps predating
 * the key until a test or an edit rewrites it."* And the picker's `satisfies()`
 * reads that cache, so a capability added to the manifest was invisible to
 * every existing row in exactly the place people choose a connection — while
 * every test stayed green. Ollama gaining `text->embedding` (2026-09-25) was
 * the first time it would have shipped broken; this closes it for every type.
 *
 * Through `persistCapabilities`, the one write path, so each row's probe and
 * the person's own toggles survive exactly as they are.
 *
 * ⚠ **A type the manifest declares nothing for is skipped.** For those
 * (`openai-embeddings`, `local-onnx`) `resolveConnectionCapabilities` answers
 * `{}` and `persistCapabilities`' empty-rebuild guard keeps the stored cache —
 * the one 0175 determined from the old modality column. Refreshing them would
 * only rewrite the same value on every boot, and "settled installs do no
 * writes" is the property that makes this safe to run at startup.
 *
 * Idempotent; a row whose rebuilt set matches its stored one is not written.
 */
export async function refreshConnectionCapabilityCaches(
	db: Db,
	options: { types?: readonly string[] } = {}
): Promise<{ refreshed: number }> {
	const rows = await db
		.select({
			id: schema.connections.id,
			type: schema.connections.type,
			preset: schema.connections.preset,
			capabilities: schema.connections.capabilities
		})
		.from(schema.connections)
	let refreshed = 0
	for (const row of rows) {
		if (options.types && !options.types.includes(row.type)) continue
		if (adapterCapabilities(row.type) === undefined) continue
		const next = resolveConnectionCapabilities(row)
		if (sameResolved(column(row).resolved, next)) continue
		await persistCapabilities(db, row.id, { resolved: next })
		refreshed++
	}
	return { refreshed }
}

/**
 * The same write, for one MODEL's capability column (0114).
 *
 * ## Why a second function and not a table parameter
 *
 * The two writes differ in the one place that matters: the KEY SPACE. A
 * connection resolves against its own `type` and `preset`; a model has neither
 * column, and the key space it must be judged in belongs to the ENDPOINT it
 * hangs off — an OpenAI-compatible protocol's `supports` map is what gates every
 * layer, and a model cannot widen it. So this reads the parent row to resolve,
 * and a `(table, idColumn)` parameterisation of `persistCapabilities` would have
 * had to grow that join as a conditional anyway.
 *
 * The empty-rebuild guard above is deliberately NOT repeated here, and that is
 * the second difference. It exists because 0175 determined `text->embedding` for
 * types the manifest declares nothing for, and an unrelated edit writing `{}`
 * back would undo it. A model row has no such determined-from-elsewhere state:
 * it was created empty by the 0114 backfill, everything it holds a person put
 * there, and an empty rebuild on a model IS the answer — switching the last
 * override off on a model whose endpoint declares nothing should cache nothing.
 *
 * ⚠ `resolved` here is the MODEL's layer alone, not the pair's. The pair is
 * `layerCapabilities` in `connections/models.ts` and is resolved live at every
 * run; caching it on either row would be a third copy of a fact that is already
 * derived from two, and the first of the three to go stale would be the one
 * everything reads.
 */
export async function persistModelCapabilities(
	db: Db,
	connectionModelId: number,
	next: PersistCapabilitiesInput
): Promise<StoredCapabilities> {
	const [row] = await db
		.select({
			capabilities: schema.connectionModels.capabilities
		})
		.from(schema.connectionModels)
		.where(eq(schema.connectionModels.id, connectionModelId))
		.limit(1)
	const current = column(row)
	const capabilities: StoredCapabilities = {
		resolved: next.resolved,
		// A fresh probe REPLACES the stored one, and an absent argument keeps it
		// — `persistCapabilities`' rule verbatim, for the reason given there.
		probe: next.probe
			? { found: next.probe, at: new Date().toISOString() }
			: current.probe,
		// `undefined` means "keep what is stored", so a caller clearing the last
		// override must pass `{}`. Same trap, same door.
		overrides: next.overrides ?? current.overrides
	}
	await db
		.update(schema.connectionModels)
		.set({ capabilities })
		.where(eq(schema.connectionModels.id, connectionModelId))
	return capabilities
}
