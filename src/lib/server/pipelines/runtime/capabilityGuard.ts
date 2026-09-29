/**
 * Can the connection a dispatcher was handed do what the call needs?
 *
 * All three dispatchers asked this as a modality question — `isImage` on the
 * connection type for images, and nothing at all on the text side — and one
 * scalar cannot answer it. KoboldCPP writes replies and draws pictures from the
 * same process, so `isImage` calls it a text connection and an image node bound
 * to it is refused for being what it is not. What a connection can do is a set,
 * resolved once and stored on the row (0175); this reads that set.
 *
 * Shared by the three rather than written out three times, because the part
 * worth getting right is not the lookup — it is the undetermined case below, and
 * three copies of that would drift.
 */

import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	MODALITY_FOR_STAR_CAPABILITY,
	modalityOfTransform,
	SECTION_STAR_CAPABILITIES
} from "$lib/shared/constants/connectionSections"
import { adapterCapabilities } from "$lib/shared/connectionAdapters/manifest"
import {
	capabilityLabel,
	isTransformId,
	satisfies,
	type CapabilityId,
	type CapabilitySet,
	type Grade
} from "@serene-pub/sdk"

/**
 * The effective set the row carries, INTERSECTED with what its adapter can still
 * express.
 *
 * `capabilities.resolved` is a cache of the four resolution layers (schema.ts),
 * and reading the cache is what keeps this off the adapter modules — they are
 * lazily imported because one of them cannot be loaded on Android at all.
 *
 * ## Why the intersection, rather than reading the cache straight
 *
 * A cache outlives the thing it caches. Dropping a key from the manifest stops
 * resolution from GRANTING it, but does nothing about what was already granted
 * and written to a row: an OpenAI connection that resolved
 * `text->image: "native"` under the old declaration keeps clearing this guard
 * until something happens to re-resolve it, and then fails minutes later with
 * `No image adapter for connection type` out of a loader. Intersecting on READ
 * makes the manifest authoritative at the point of use, which is exactly what
 * its header already claims for it ("a gate, not a default"). No migration, no
 * revision stamp, no boot sweep — and it stays correct for every future key that
 * is ever withdrawn, which a one-time fix would not.
 *
 * ⚠ The `declared` guard is not optional. `resolveConnectionCapabilities`
 * returns `{}` for a type no manifest entry describes, and intersecting such a
 * type down to `{}` makes the emptiness test below read "not determined yet" and
 * fall through to `modalityAllows`, which is permissive by design.
 * `persistCapabilities` guards the same hazard with the same `declares` test;
 * the comment there explains the other half of it.
 *
 * ⚠ Every type a star can name MUST have a manifest entry.
 * `connections:setDefault` judges the row with `capabilityRefusal`, and a type
 * the manifest does not describe can be granted nothing — so the three embedding
 * types are declared, their cached `text->embedding` survives the intersection
 * on its own merits, and `modalityAllows` covers the emptiness half. See its own
 * note.
 */
export function storedCapabilities(connection: {
	type: string
	capabilities?: unknown
}): CapabilitySet {
	const resolved = (connection?.capabilities as { resolved?: unknown })
		?.resolved
	const cached =
		resolved && typeof resolved === "object"
			? (resolved as CapabilitySet)
			: {}

	const declared = adapterCapabilities(connection?.type)
	if (!declared) return cached

	// Only TRANSFORM ids are stripped.
	//
	// `resolveCapabilities` ends in `closure()`, which deliberately GROWS keys
	// that are not in `supports` — native `grammar` yields `json_schema:
	// emulated`, `strict_schema` implies `json_object`. Intersecting on
	// `supports` alone would delete those on every read, so a connection that
	// genuinely does structured output would be refused for it, and the cause
	// would look like the closure table rather than this line.
	//
	// A transform is different: it is either in the API's key space or it is not,
	// and nothing derives one from another (transforms appear in neither IMPLIES
	// nor EMULATABLE_VIA). So a cached transform the manifest no longer declares
	// is stale and must go.
	const out: CapabilitySet = {}
	for (const [id, grade] of Object.entries(cached)) {
		const key = id as CapabilityId
		if (isTransformId(key) && declared.supports[key] === undefined) continue
		out[key] = grade as Grade
	}
	return out
}

/**
 * What the old modality column would have said, for a row whose capabilities
 * nobody has determined yet.
 *
 * ⚠ **This JUDGES a connection somebody chose. It must never SELECT one.**
 *
 * The distinction is the whole of the no-implicit-pickup ruling and this
 * function is the most promotable thing in the codebase against it: it is a
 * cheap predicate over a type string that answers "would this do?" for any row
 * you hand it, so a `connections.find(c => modalityAllows(c.type, cap))` reads
 * like an obvious convenience and would quietly restore the behaviour eleven
 * separate call sites were deleted to remove — a connection running because it
 * exists and happens to fit. Which connection runs is decided in
 * `connections/capabilityTarget.ts`, from what somebody actually set, and
 * nowhere else.
 *
 * It also cannot bear that weight even if it were allowed to: it is transitional
 * (see `capabilityRefusal` below) and permissive by design — on an undetermined
 * row it still answers yes to `text->audio`, vision and every feature.
 *
 * ## What it is NOT permissive about: a section's star
 *
 * A capability that some section's star registers belongs to that section's
 * modality and to no other, and this is the only place that has to say so for an
 * undetermined row. ⚠ It must never be written as a comparison against one
 * modality: a row created by SQL carries `capabilities = '{}'` (a migration
 * cannot run `resolveConnectionCapabilities`), so every modality's rows reach
 * this predicate undetermined, and an expression naming only images answers "yes,
 * it can chat" for an embedding endpoint.
 *
 * Read from `CONNECTION_SECTIONS` rather than re-spelled here, so adding a
 * modality closes its own half of this without an edit in a file about guards.
 */
const modalityAllows = (type: string, capability: CapabilityId): boolean => {
	const modality = CONNECTION_TYPE.modalityOf(type)
	if (SECTION_STAR_CAPABILITIES.has(capability))
		return MODALITY_FOR_STAR_CAPABILITY[capability] === modality
	// Everything a section does not star keeps the old answer, which an
	// undetermined TEXT row depends on: vision, documents, speech and every
	// feature were permitted before the column existed and must stay permitted
	// until something resolves the row.
	return modality === "text-gen"
}

/**
 * Whether the MODEL half of a pair is the kind of model this transform needs.
 *
 * One endpoint can serve several modalities — an Ollama host chats and embeds,
 * a managed KoboldCPP chats and draws — so the endpoint's capability layers say
 * yes to every transform the host can express, for every model behind it. The
 * model's own modality (`connection_models.modality`, written by the sync from
 * what the host says about each model) is what keeps `nomic-embed-text` out of
 * the chat picker and a chat checkpoint out of the embeddings one.
 *
 * Null modality is ungated: the host said nothing, and refusing on silence
 * would break every endpoint whose listing carries no such fact. A feature
 * (`tools`, `streaming`) is never gated here — it rides on a transform, and
 * that transform is judged on its own.
 */
export function modelModalityAllows(
	modality: string | null | undefined,
	capability: CapabilityId
): boolean {
	if (!modality || !isTransformId(capability)) return true
	return modalityOfTransform(capability) === modality
}

/**
 * The refusal sentence, or null when the connection can do it.
 *
 * A sentence rather than a throw because each dispatcher's failures carry its
 * own error class and callers key on those.
 *
 * ## It names no connection, and that is the whole design
 *
 * It used to open `"Studio" cannot do Image generation.` — one string feeding
 * six sinks, four of which reach somebody who is not an administrator: the draft
 * preview's error, all three dispatchers' error classes, `receipt.haltReason`,
 * and the activity cards. Connections are invisible to non-admins
 * (`connections/visibility.ts`), and a key-shaped projection cannot see a name
 * inside a sentence, so the name had to leave the sentence.
 *
 * Not a second, redacted variant of the sentence — ONE sentence, safe wherever
 * it lands. Two variants would need a reader identity this function has never
 * had and cannot get (it is called from `resolveCapabilityTarget`, which judges
 * a chain, not a person), and they would need to be kept in step forever. The
 * identity a caller wants for an administrator travels as a FIELD instead:
 * `connectionIdentity(connection)` under the key `connection`, which the
 * projection already removes at every egress.
 *
 * The consequence to know about: this sentence is concatenated into larger
 * strings at six sites and passes through two string-only contracts
 * (`Error.message` and the SDK's `Receipt.haltReason`). Nothing downstream could
 * still tell where a name had been, so composing it out later was never
 * available — safe by construction is the only form that survives the journey.
 */
export function capabilityRefusal(
	connection: {
		name?: string | null
		type: string
		capabilities?: unknown
		/** The merged pair's model modality — see `modelModalityAllows`. */
		connectionModelModality?: string | null
	},
	capability: CapabilityId
): string | null {
	// Before the endpoint's layers, and not overridable by them: a switch on
	// the endpoint says what the HOST can do, never that an embedding model
	// can chat.
	if (!modelModalityAllows(connection.connectionModelModality, capability))
		return (
			`This model cannot do ${capabilityLabel(capability)}. ` +
			`Choose a model that can.`
		)

	const have = storedCapabilities(connection)

	// Transitional, and keyed on "capabilities not yet determined" rather than on
	// modality: 0175 backfilled an empty set for every row it could not resolve —
	// an unknown type, or one nobody has ever tested. Refusing those outright
	// would break working setups on upgrade until every connection had been
	// re-tested, so a row with nothing determined is judged the way it was before
	// the column existed. It stops being empty the first time it is resolved.
	// An explicit override is an ANSWER, and outranks the emptiness fallback.
	//
	// Emptiness means "nobody has determined this yet" only when nobody has
	// spoken. On a connection type whose adapter declares ONE capability — an
	// image-only type is exactly that — switching that capability off resolves to
	// `{}`, which is indistinguishable from undetermined by count alone. The
	// fallback then answered from the modality column and the Off switch did
	// nothing, which is the same shape of bug `persistCapabilities` already
	// guards against on the WRITE path with its `declares` check. This is the
	// read half of it.
	const override = ((
		connection?.capabilities as { overrides?: Record<string, unknown> }
	)?.overrides ?? {})[capability]
	// Grade 0 is an off as much as `false` is. Nothing writes one today — the
	// setCapability handler refuses anything but a band name or `false` — but the
	// stored half is a loose JSON column that predates that gate, and reading a
	// zero as "on" is the one direction that fails open.
	const ok =
		override !== undefined
			? override !== false && override !== 0
			: Object.keys(have).length
				? satisfies({ requires: [capability] }, have).ok
				: modalityAllows(connection.type, capability)
	if (ok) return null

	// The capability in the words the connection screen showed, never its id:
	// somebody who switched "Image generation" off has no way to connect
	// `text->image` back to the toggle they touched.
	//
	// "This connection", never `connection.name` — see the header. It reads for
	// both audiences: on an administrator's picker it means the row they just
	// clicked, and everywhere else `resolveCapabilityTarget` appends the tier
	// that chose it ("It is set in Admin → Defaults."), which is the half a
	// person can actually act on.
	return (
		`This connection cannot do ${capabilityLabel(capability)}. ` +
		`Enable it on the connection, or choose one that can.`
	)
}
