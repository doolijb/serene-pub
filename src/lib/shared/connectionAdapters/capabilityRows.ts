/**
 * The capability panel's row model: one row per capability the connection's
 * ADAPTER DECLARES, carrying where the three-state control sits, what the server
 * resolved, and a sentence saying who decided that.
 *
 * A `.ts` and not a component on purpose. The control ships on two surfaces with
 * two design systems — the Connections sidebar and Document View's edit page —
 * and sharing MARKUP between those is what would actually drift. Sharing the
 * answers is what keeps the two honest, so both presentations render this and
 * neither computes anything of its own.
 *
 * ## Nothing here predicts a resolution
 *
 * `resolved` arrives from the server and is shown as given. This module never
 * calls `resolveCapabilities` or `closure`, both of which are importable from
 * client code and would be a one-line temptation: a second implementation of the
 * four layers is precisely the divergence the server-owned column exists to
 * prevent — the screen would say one thing and the run would do another.
 * `IMPLIES` and `EMULATABLE_VIA` ARE read below, but only ever to EXPLAIN an
 * answer that already came back, never to compute one.
 *
 * ## Three states, and the middle one is the default
 *
 * An override key may be ABSENT (auto — nobody stated an intent, so the preset
 * and the probe decide), a tier (on), or `false` (off). A two-state checkbox
 * collapses the first into the third and destroys auto with no way back, which
 * permanently blinds the row to what its backend reports. So `state` has three
 * values and "auto" is listed first: it is the resting position, not a reset.
 *
 * ## The adapter is a gate, not a default
 *
 * Rows come from `adapterCapabilities(type).supports` and nothing else. A key in
 * `resolved` or in `overrides` that the adapter does not declare gets no row —
 * the protocol has no field for it, so offering the switch would be a lie. That
 * is the structural half of "why is my LLM connection offering image generation".
 */

import {
	capabilityLabel,
	capabilityTagline,
	isBasicCapability,
	isTransformId,
	EMULATABLE_VIA,
	FEATURES,
	IMPLIES,
	TRANSFORMS,
	type CapabilityId,
	type CapabilityOverrides,
	type CapabilitySet,
	type Declared,
	type FeatureId,
	type ResolvedTier
} from "@serene-pub/sdk"
import { joinWithAnd } from "$lib/shared/utils/joinWithAnd"
import { presetLabel } from "$lib/shared/utils/connectionDefaults"
import { adapterCapabilities, PRESET_CAPABILITIES } from "./manifest"

/** Where the radio group sits. `auto` is an absent key, not a written value. */
export type OverrideState = "auto" | "on" | "off"

/**
 * The three positions, in the order they are rendered.
 *
 * `wire` is the whole three-state rule in one column: auto sends `null`, which
 * the handler reads as DELETE the key. Writing `false` there instead would look
 * identical on screen and quietly mean "off forever", because an explicit off
 * outranks every later probe.
 *
 * On sends `native` and never a tier the user chose: resolution clamps an
 * override down to what the adapter can actually express, so offering
 * `emulated` on write would be a promise the key space is free to refuse. The
 * tier is surfaced on READ, in the state chip, where it is an observation.
 */
export const OVERRIDE_STATES: readonly {
	value: OverrideState
	label: string
	wire: ResolvedTier | false | null
	hint: string
}[] = [
	{
		value: "auto",
		label: "Auto",
		wire: null,
		hint: "Let the preset and the last test decide."
	},
	{
		value: "on",
		label: "On",
		wire: "native",
		hint: "Offer this whatever the backend reports."
	},
	{
		value: "off",
		label: "Off",
		wire: false,
		hint: "Never offer this."
	}
]

/** Which layer had the last word — the answer to "why is this on?". */
export type CapabilityDecidedBy =
	| "override"
	| "probe"
	| "preset"
	| "default"
	| "adapter"

export interface CapabilityRow {
	id: CapabilityId
	/** Never the id: `text+image->text` is an address, not a name. */
	label: string
	tagline?: string
	kind: "transform" | "feature"
	/** `text->text` — pinned first and never muted, so a first-timer meets Chat. */
	basic: boolean
	/** Where the control sits. From `overrides` alone, never from `resolved`. */
	state: OverrideState
	/** What the SERVER resolved. Read-only here; the control does not predict it. */
	tier: ResolvedTier
	on: boolean
	/** "On", "On · by Serene Pub", "Off" — the chip, worded once for both surfaces. */
	stateLabel: string
	/**
	 * Nothing has answered for this key, so the tier shown is the adapter's own
	 * pessimism (`until`) rather than a fact. Renders as a dotted "Assumed", and
	 * exists so an untested connection cannot look authoritative.
	 */
	assumed: boolean
	decidedBy: CapabilityDecidedBy
	/** The provenance line. Required, not decoration — see the module header. */
	provenance: string
	/**
	 * The resolved answer contradicts the stated intent.
	 *
	 * Expect this on day one and render it honestly: an explicit off does not
	 * survive `closure()`, so KoboldCPP's `tools → Off` comes back `emulated`
	 * through its native grammar, and an `openai-official` `json_object → Off`
	 * comes back through `IMPLIES`. Whether an explicit `false` OUGHT to survive
	 * the closure is an SDK semantics ruling, deliberately not decided here — so
	 * the row names the lever instead of pretending the toggle worked.
	 */
	contested: boolean
	/** The native capabilities that can provide this one. Explanation, not math. */
	derivedVia: CapabilityId[]
	/** The one-liner for `derivedVia`, when there is anything to say. */
	derived?: string
}

export interface CapabilityRowsInput {
	/** The SAVED row's type. The key space belongs to it, not to a `<select>`. */
	type?: string | null
	preset?: string | null
	/** The `connections.capabilities` column, verbatim. */
	capabilities?: {
		resolved?: CapabilitySet
		overrides?: CapabilityOverrides
		probe?: { found?: CapabilitySet; at?: string }
	} | null
	/** Injected so "3d ago" is testable rather than clock-dependent. */
	now?: number
}

export interface CapabilityRowsView {
	/** False when no manifest entry declares this type — no key space, no rows. */
	declared: boolean
	/** Always shown: at most six, and one of them is the reported bug. */
	transforms: CapabilityRow[]
	/** Behind the Advanced disclosure. */
	features: CapabilityRow[]
	tested: boolean
	probedAt?: string
	/** "Never tested" / "Last tested 3d ago" — the panel's honesty line. */
	testedText: string
	/** Names the disclosure can put in its summary, so it says what is on. */
	featuresOnLabels: string[]
}

/** A duration, coarsely. Same steps as the vectorization queue's own. */
export function relativeAge(iso: string, now: number = Date.now()): string {
	const s = Math.floor((now - new Date(iso).getTime()) / 1000)
	if (!Number.isFinite(s)) return "at an unknown time"
	if (s < 60) return "just now"
	const m = Math.floor(s / 60)
	if (m < 60) return `${m}m ago`
	const h = Math.floor(m / 60)
	if (h < 24) return `${h}h ago`
	return `${Math.floor(h / 24)}d ago`
}

/** `probed` declarations carry what to assume; plain ones state it outright. */
const isProbedDeclaration = (d: Declared): boolean => typeof d !== "string"

const TRANSFORM_ORDER = Object.keys(TRANSFORMS)

/**
 * Declaration order, with the basic transform pinned to the front.
 *
 * `isBasicCapability` is used to PIN rather than to filter. A strict basic-only
 * cut would leave an A1111 connection with no rows at all — it has no
 * `text->text` — so the disclosure boundary is transforms-vs-features, and
 * "basic" only decides what leads and what stays unmuted.
 */
function ordered(ids: CapabilityId[], canonical: string[]): CapabilityId[] {
	const rank = (id: string) => {
		const i = canonical.indexOf(id)
		return i < 0 ? canonical.length : i
	}
	return ids
		.slice()
		.sort(
			(a, b) =>
				Number(isBasicCapability(b)) - Number(isBasicCapability(a)) ||
				rank(a) - rank(b) ||
				a.localeCompare(b)
		)
}

/**
 * The native capabilities that can supply this one, per the SDK's two tables.
 *
 * A lookup over what the server already resolved — never a re-derivation of it.
 * Transforms are in neither table, which is why `text->image → Off` sticks while
 * `tools → Off` does not, and why this returns nothing for them.
 */
function leversFor(id: CapabilityId, resolved: CapabilitySet): CapabilityId[] {
	if (isTransformId(id)) return []
	const out: CapabilityId[] = []
	for (const via of EMULATABLE_VIA[id as FeatureId] ?? [])
		if (resolved[via] === "native") out.push(via)
	for (const [source, implied] of Object.entries(IMPLIES)) {
		if (!implied.includes(id as FeatureId)) continue
		const tier = resolved[source as FeatureId]
		if (tier && tier !== "none") out.push(source as FeatureId)
	}
	return [...new Set(out)]
}

function stateOf(
	overrides: CapabilityOverrides | undefined,
	id: CapabilityId
): { state: OverrideState; stated: boolean } {
	// `in` rather than a truthiness test: `false` is a VALUE here (an explicit
	// off) and an absent key is the auto state, so the two must not collapse.
	const stated =
		!!overrides &&
		Object.prototype.hasOwnProperty.call(overrides, id) &&
		overrides[id] !== undefined
	if (!stated) return { state: "auto", stated: false }
	return { state: overrides![id] === false ? "off" : "on", stated: true }
}

export function buildCapabilityRows(
	input: CapabilityRowsInput
): CapabilityRowsView {
	const adapter = input.type ? adapterCapabilities(input.type) : undefined
	const stored = input.capabilities ?? {}
	const resolved = stored.resolved ?? {}
	const overrides = stored.overrides
	const probeFound = stored.probe?.found
	const probedAt = stored.probe?.at
	const tested = !!stored.probe
	const testedText = !tested
		? "Nothing has tested this connection yet, so anything below that has not been switched by hand is an assumption."
		: probedAt
			? `Last tested ${relativeAge(probedAt, input.now)}.`
			: "Tested, at an unrecorded time."

	if (!adapter) {
		return {
			declared: false,
			transforms: [],
			features: [],
			tested,
			probedAt,
			testedText,
			featuresOnLabels: []
		}
	}

	const presetCaps = input.preset
		? PRESET_CAPABILITIES[input.preset]
		: undefined
	const defaults = new Set<string>(adapter.defaults ?? [])

	const row = (id: CapabilityId): CapabilityRow => {
		const declared = adapter.supports[id]!
		const { state, stated } = stateOf(overrides, id)
		const tier = resolved[id] ?? "none"
		const on = tier !== "none"

		// The four layers, read backwards: whoever spoke LAST is who decided.
		// A probe only counts where the adapter declared `probed` — resolution
		// ignores an answer to a question it never asked, and crediting one here
		// would explain the row by a layer that had no effect on it.
		const probeSpoke =
			isProbedDeclaration(declared) &&
			!!probeFound &&
			probeFound[id] !== undefined
		const presetSpoke = !!presetCaps && presetCaps[id] !== undefined
		const decidedBy: CapabilityDecidedBy = stated
			? "override"
			: probeSpoke
				? "probe"
				: presetSpoke
					? "preset"
					: defaults.has(id)
						? "default"
						: "adapter"

		// Only where the tier shown is the adapter's own `until` guess and
		// nothing has answered — a preset asserting something is a claim, not an
		// assumption, and an override is a decision.
		const assumed =
			isProbedDeclaration(declared) &&
			(decidedBy === "default" || decidedBy === "adapter")

		const provenance =
			decidedBy === "override"
				? state === "off"
					? "You switched this off."
					: "You switched this on."
				: decidedBy === "probe"
					? probedAt
						? `The backend reported this when it was tested, ${relativeAge(probedAt, input.now)}.`
						: "The backend reported this the last time it was tested."
					: decidedBy === "preset"
						? `The ${presetLabel(input.preset)} preset sets this.`
						: decidedBy === "default"
							? assumed
								? "On by default for this connection type, until a test says otherwise."
								: "On by default for this connection type."
							: assumed
								? "Assumed off — nothing has tested this connection yet."
								: "Not offered by this connection type's defaults."

		const derivedVia = leversFor(id, resolved)
		const contested = (state === "off" && on) || (state === "on" && !on)
		const viaNames = joinWithAnd(derivedVia.map((v) => capabilityLabel(v)))
		const derived =
			contested && state === "off"
				? viaNames
					? `Still on: Serene Pub supplies it through ${viaNames}. Switching that off is what removes it.`
					: "Still on: something else on this connection supplies it."
				: contested && state === "on"
					? "Off anyway: this connection type has no way to express it."
					: tier === "emulated" && viaNames
						? `Serene Pub supplies this through ${viaNames}.`
						: undefined

		return {
			id,
			label: capabilityLabel(id),
			tagline: capabilityTagline(id),
			kind: isTransformId(id) ? "transform" : "feature",
			basic: isBasicCapability(id),
			state,
			tier,
			on,
			stateLabel:
				tier === "emulated"
					? "On · by Serene Pub"
					: tier === "native"
						? "On"
						: "Off",
			assumed,
			decidedBy,
			provenance,
			contested,
			derivedVia,
			...(derived ? { derived } : {})
		}
	}

	const declaredIds = Object.keys(adapter.supports).filter(
		(id) => adapter.supports[id as CapabilityId] !== undefined
	) as CapabilityId[]
	const transforms = ordered(
		declaredIds.filter((id) => isTransformId(id)),
		TRANSFORM_ORDER
	).map(row)
	const features = ordered(
		declaredIds.filter((id) => !isTransformId(id)),
		FEATURES as unknown as string[]
	).map(row)

	return {
		declared: true,
		transforms,
		features,
		tested,
		probedAt,
		testedText,
		featuresOnLabels: features.filter((f) => f.on).map((f) => f.label)
	}
}
