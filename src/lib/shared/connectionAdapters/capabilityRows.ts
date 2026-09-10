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
 * writes a second implementation of the four layers — that is precisely the
 * divergence the server-owned column exists to prevent, the screen saying one
 * thing while the run does another. `IMPLIES` and `EMULATABLE_VIA` ARE read
 * below, but only ever to EXPLAIN an answer that already came back, never to
 * compute one.
 *
 * The one exception is `effectiveCapabilities` below, and it is narrow on
 * purpose: for a key the cache does NOT name, there is no server answer to show,
 * so it resolves that key through the SDK's own `resolveCapabilities` — the same
 * function `connections/resolve.ts` calls, over the same four layers, off the
 * same row. Not a second implementation: the same one, reached for the keys the
 * cache is silent about. See its own note for why that is the honest reading of
 * silence and what it costs.
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
 *
 * And the gate is now CI-CHECKED against the implementations rather than
 * hand-maintained: the transform half of `supports` is derived from which named
 * actions a type's adapter modules define, and
 * `server/connectionAdapters/manifest.conformance.test.ts` fails the build when
 * the two disagree. Nothing in this file changed to gain that — which is the
 * point. An adapter that grows an action gets its override row for free, and one
 * that loses an action stops offering a switch that could not have worked.
 */

import {
	BAND,
	bandOf,
	capabilityLabel,
	capabilityTagline,
	gradeLetter,
	isBasicCapability,
	isTransformId,
	resolveCapabilities,
	topGrade,
	EMULATABLE_VIA,
	FEATURES,
	IMPLIES,
	TRANSFORMS,
	WIRE_CAPABILITY,
	WIRE_MODE_ORDER,
	type AdapterCapabilities,
	type Band,
	type CapabilityId,
	type CapabilityOverrides,
	type CapabilitySet,
	type Declared,
	type FeatureId,
	type Grade,
	type PresetCapabilities
} from "@serene-pub/sdk"
import { joinWithAnd } from "$lib/shared/utils/joinWithAnd"
import { presetLabel } from "$lib/shared/utils/connectionDefaults"
import { adapterCapabilities, PRESET_CAPABILITIES } from "./manifest"
import { wireModeFor, type WireMode } from "./wireMode"
import { CONTINUE_REPLY, continueWireModes } from "./continueReply"

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
 * On sends `native` and never a grade the user chose: resolution clamps an
 * override down to what the adapter can actually express, so offering
 * `emulated` on write would be a promise the key space is free to refuse. The
 * grade is surfaced on READ, in the state chip, where it is an observation.
 *
 * ⚠ A BAND NAME on the wire, while the column stores a grade NUMBER. That is
 * what keeps this table static: "on" means the capability's TOP band, and the
 * top is 2 for `tools` and 1 for `text->image`, so there is no one number this
 * column could hold. The handler turns the name into that capability's own
 * number at the point of write, which is also where the key-space gate is.
 */
export const OVERRIDE_STATES: readonly {
	value: OverrideState
	label: string
	wire: Band | false | null
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
	grade: Grade
	/**
	 * The best THIS capability can be, so a renderer can read `grade` at all.
	 *
	 * Carried rather than looked up by the two presentations, for the same reason
	 * everything else here is: a grade is meaningless without the scale, and two
	 * surfaces deriving the scale separately is two chances to disagree about
	 * whether a full-strength `text->image` is full strength.
	 */
	top: Grade
	/**
	 * The grade as a letter, `A` being this capability's own best.
	 *
	 * Derived here and never stored, sent or compared — a two-band capability's
	 * grade 1 is an `A`, not a `B`. Absent at grade 0, where there is no quality
	 * to letter and the chip says "Off".
	 */
	letter?: string
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
	/**
	 * Which METHOD this connection is actually called by.
	 *
	 * Absent when the type declares no wire mode at all — an A1111 connection is
	 * not "sent as chat messages", and saying so would be a fresh untruth in the
	 * panel that exists to remove them.
	 */
	wireMode?: WireMode
	/** The one-line answer to "which of these two switches is in effect?". */
	wireModeText?: string
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

/**
 * Unproven declarations carry what to assume; plain ones state it outright.
 *
 * ⚠ `typeof d === "object"` and not `!== "string"`. A `Declared` is a band name,
 * a grade NUMBER, or the unproven object — so the negative test that was correct
 * against the old string-only vocabulary would now call every numeric
 * declaration unproven, crediting a probe for an outright one and printing
 * "Assumed" over a fact.
 */
const isUnprovenDeclaration = (d: Declared): boolean =>
	typeof d === "object" && d !== null

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
	// "Native" is each service's OWN top band, not a shared number: `grammar`
	// tops out at 1 and `json_schema` at 2, and comparing either against a
	// literal would credit the wrong lever — or none at all.
	for (const via of EMULATABLE_VIA[id as FeatureId] ?? [])
		if (resolved[via] === topGrade(via)) out.push(via)
	for (const [source, implied] of Object.entries(IMPLIES)) {
		if (!implied.includes(id as FeatureId)) continue
		if (resolved[source as FeatureId]) out.push(source as FeatureId)
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

/**
 * The stored cache, plus a live answer for every key the manifest declares that
 * the cache does not name.
 *
 * ## The silence this reads, and why it is not "off"
 *
 * `capabilities.resolved` is a cache, and a cache written by an older build
 * cannot name a capability that build had never heard of. `continue_reply` is
 * exactly that: it landed after every existing row's column was written, so the
 * cache on an upgrading install names neither an on nor an off for it, and
 * reading absence as off made every row on every install read Off — with the
 * provenance line underneath it still saying "On by default for this connection
 * type", because provenance comes from the LAYERS and only the grade came from
 * the cache. A row that contradicts itself is the failure this panel exists to
 * remove, and it would have stood until each connection happened to be tested or
 * saved again. Every server-side answer already resolves live from the row for
 * this reason — `resolveWireMode` and `resolveContinueRefusal` both say so at
 * length — so the panel reading the cache was also the one reader disagreeing
 * with the run.
 *
 * ## What it fills, and with what
 *
 * Keys the cache NAMES are shown exactly as given: this never re-resolves an
 * answer the server already has, so a stale grade stays visible rather than
 * being quietly corrected out from under the person looking at it. Only the
 * silence is filled, and only for keys `adapter.supports` declares — the row
 * space, so nothing appears that could not have had a row anyway.
 *
 * The fill is `resolveCapabilities` over the row's own four layers, which is the
 * same function and the same layers `resolveConnectionCapabilities` uses on the
 * server. So what it shows for an unnamed key is precisely what the column would
 * hold if it were rewritten right now: a stored override still wins (layer 4
 * reads the same `overrides`), the last probe still speaks (layer 3 reads the
 * same stored `probe.found`), and an absence that really did mean "resolved to
 * 0" resolves to 0 again and stays absent. Nothing is written back — see
 * `persistCapabilities`, which is the column's only writer; refreshing the cache
 * belongs to a write path, not to the render.
 *
 * ⚠ It does NOT reach the bind guard, which reads the same cache through
 * `pipelines/runtime/capabilityGuard.ts`. Two reasons, and the first is
 * structural: that function is handed `{type, capabilities}` and no preset, so
 * it cannot resolve these four layers even if it wanted to. The second is that
 * it GRANTS rather than displays — changing what it reads changes which
 * connections may run. The visible cost is a newly declared TRANSFORM, which
 * would read on here and still be refused at bind until something rewrites the
 * column; the cure for that is persistence from a write path, not a second live
 * read in the guard.
 */
function effectiveCapabilities(
	adapter: AdapterCapabilities,
	preset: PresetCapabilities | undefined,
	stored: NonNullable<CapabilityRowsInput["capabilities"]>
): CapabilitySet {
	const cached = stored.resolved ?? {}
	const unnamed = (Object.keys(adapter.supports) as CapabilityId[]).filter(
		(id) => adapter.supports[id] !== undefined && cached[id] === undefined
	)
	// The ordinary case on a current install: the cache names everything the
	// manifest declares, and this costs one pass over the key space and nothing
	// else. Returning `cached` itself rather than a copy is deliberate — the
	// answer is the stored one, unaltered.
	if (!unnamed.length) return cached
	const live = resolveCapabilities({
		adapter,
		preset,
		probe: stored.probe?.found,
		overrides: stored.overrides
	})
	const out: CapabilitySet = { ...cached }
	// Key by key, and only the unnamed ones. Merging `live` wholesale would
	// overwrite the cache with a prediction — including keys `closure()` grows
	// that the manifest never declared — which is the divergence the module
	// header forbids.
	for (const id of unnamed) if (live[id] !== undefined) out[id] = live[id]!
	return out
}

export function buildCapabilityRows(
	input: CapabilityRowsInput
): CapabilityRowsView {
	const adapter = input.type ? adapterCapabilities(input.type) : undefined
	const stored = input.capabilities ?? {}
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
	// The cache, with the manifest's newer keys resolved rather than read as
	// off. Below this line `resolved` is the panel's one answer — the wire mode
	// sentence, every row's grade and `leversFor` all read it.
	const resolved = effectiveCapabilities(adapter, presetCaps, stored)

	/**
	 * Which wire mode is IN EFFECT — computed before the rows, because one of
	 * them depends on it.
	 *
	 * See the long note further down for why this is `wireModeFor` and never a
	 * tie-break of this file's own. It is read twice now: once for the panel's
	 * own sentence, and once by the `continue_reply` row, whose effective answer
	 * is the capability AND the wire together.
	 */
	const declaresWire = WIRE_MODE_ORDER.some(
		(m) => adapter.supports[WIRE_CAPABILITY[m]] !== undefined
	)
	const wireMode = declaresWire
		? wireModeFor(input.type, resolved)
		: undefined
	const modeName = (m: WireMode) => capabilityLabel(WIRE_CAPABILITY[m])

	/**
	 * The wire modes that carry a continuation, when this row's answer needs
	 * qualifying — empty for every capability but one.
	 *
	 * ⚠ Applying it here is an OBSERVATION about an answer that already came
	 * back, not a re-derivation of it: the grade the four layers resolved is read
	 * as given, and this only says whether the request it would ride on can carry
	 * it. The same function the verb and the adapter read, so the panel cannot
	 * promise a Continue button the server refuses — which was the whole failure
	 * mode, since `continue_reply` is ON by default for every OpenAI-compatible
	 * connection and chat wire cannot prefill.
	 */
	const continueWires = continueWireModes(input.type)

	const row = (id: CapabilityId): CapabilityRow => {
		const declared = adapter.supports[id]!
		const { state, stated } = stateOf(overrides, id)
		const top = topGrade(id)
		// The wire this connection is actually sent on cannot carry a
		// continuation, so whatever the layers resolved has no effect. Zeroed
		// rather than annotated: a row reading "On" beside a Continue button the
		// server refuses is the screen-says-one-thing failure this panel exists
		// to remove, and `wireBlocked` below is what says so in words.
		const wireBlocked =
			id === CONTINUE_REPLY &&
			(resolved[id] ?? 0) > 0 &&
			!!wireMode &&
			!continueWires.includes(wireMode)
		const grade = wireBlocked ? 0 : (resolved[id] ?? 0)
		const on = grade > 0

		// The four layers, read backwards: whoever spoke LAST is who decided.
		// A probe only counts where the adapter declared `probed` — resolution
		// ignores an answer to a question it never asked, and crediting one here
		// would explain the row by a layer that had no effect on it.
		const probeSpoke =
			isUnprovenDeclaration(declared) &&
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
			isUnprovenDeclaration(declared) &&
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
		// The BAND rather than "below top": only the emulated band is a claim that
		// Serene Pub is the one supplying this, and a capability with no such band
		// has nothing to say here however many grades it grows.
		const emulated = bandOf(id, grade) === BAND.emulated
		const derived = wireBlocked
			? // Named rather than counted, and both modes in the sentence: "change
				// the wire mode" without saying which one is a hunt through a
				// panel that has two switches for it.
				`Sent as ${modeName(wireMode!)}, so this has no effect: a reply can only be continued ` +
				`when this connection is sent as ${continueWires.map(modeName).join(" or ")}.`
			: contested && state === "off"
				? viaNames
					? `Still on: Serene Pub supplies it through ${viaNames}. Switching that off is what removes it.`
					: "Still on: something else on this connection supplies it."
				: contested && state === "on"
					? "Off anyway: this connection type has no way to express it."
					: emulated && viaNames
						? `Serene Pub supplies this through ${viaNames}.`
						: undefined

		return {
			id,
			label: capabilityLabel(id),
			tagline: capabilityTagline(id),
			kind: isTransformId(id) ? "transform" : "feature",
			basic: isBasicCapability(id),
			state,
			grade,
			top,
			...(gradeLetter(id, grade)
				? { letter: gradeLetter(id, grade) }
				: {}),
			on,
			stateLabel: !on ? "Off" : emulated ? "On · by Serene Pub" : "On",
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

	/**
	 * Which wire mode is IN EFFECT, said out loud.
	 *
	 * Both switches can read "On" at once — that is the ordinary case for every
	 * OpenAI-compatible type, whose defaults list both — and a documented
	 * tie-break then picks one. Until this line, nothing on the panel said which:
	 * two live controls with one silent outcome, which is the "no control without
	 * an effect" failure approached from the other side.
	 *
	 * ⚠ `wireModeFor` and no tie-break of its own. That is the same function the
	 * server's `resolveWireMode` calls and the same one `connectionWireMode`
	 * calls for the completion-template picker, and the order it reads lives in
	 * the SDK's `WIRE_MODE_ORDER`. A second spelling of the rule here is exactly
	 * how the screen and the run come to disagree — the module header's standing
	 * warning, and it applies to this answer as much as to the four layers.
	 * Counting how many modes came back ON is an OBSERVATION about the answer,
	 * not a re-derivation of it, the same way `leversFor` reads `IMPLIES`.
	 *
	 * `wireMode` itself is resolved above the rows, because the `continue_reply`
	 * row reads it too — one answer, not two.
	 */
	const modesOn = WIRE_MODE_ORDER.filter(
		(m) => (resolved[WIRE_CAPABILITY[m]] ?? 0) > 0
	)
	const otherOn = modesOn.filter((m) => m !== wireMode)
	const wireModeText = !wireMode
		? undefined
		: !modesOn.length
			? // Neither key resolved: both switched off by hand, or a type that
				// declares a wire mode without defaulting it. (A column written
				// by a build that predated these keys used to land here too, and
				// no longer does — `effectiveCapabilities` resolves a declared
				// key the cache does not name, so that column now has a real
				// answer instead of a fallback.) `wireModeFor` answers from the
				// type's own declaration, which is a fallback and not a fact.
				`No wire mode is on, so this falls back to what the connection type declares: sent as ${modeName(wireMode)}.`
			: otherOn.length
				? // Named rather than counted ("both"), and the winner repeated
					// rather than pronouned: the sentence has two mode names in it
					// and an "it" or a "that" lands on the wrong one, which would
					// tell somebody to switch off precisely the mode they want.
					`${joinWithAnd(modesOn.map(modeName))} are on, so the tie-break decides: sent as ${modeName(wireMode)}. Switch ${modeName(wireMode)} off to send ${joinWithAnd(otherOn.map((m) => modeName(m).toLowerCase()))} instead.`
				: `Sent as ${modeName(wireMode)} — the only wire mode on.`

	return {
		declared: true,
		transforms,
		features,
		tested,
		probedAt,
		testedText,
		...(wireMode ? { wireMode } : {}),
		...(wireModeText ? { wireModeText } : {}),
		featuresOnLabels: features.filter((f) => f.on).map((f) => f.label)
	}
}
