/**
 * The correspondence between a capability and a sampling config's shape.
 *
 * Shared rather than server-only because both halves of the app need it and the
 * two were drifting: `SamplingSidebar.svelte` could not import the server copy
 * (it pulls in Drizzle and the schema), so it re-implemented the mapping as
 * `s === S.imageGen ? "text->image" : "text->text"` — which silently sends a TTS
 * config's default to the text capability, starring it as the chat default. Two
 * spellings of one correspondence is how the image shape ends up pointing at the
 * text default on the day somebody adds a capability to only one of them.
 *
 * The two directions are NOT symmetric, and the asymmetry is the point:
 *
 *   - capability → shape is TOTAL over transforms, and derived: the output kind
 *     names the vocabulary, so `text+image->image` and `image->image` get the
 *     image samplers without either being named anywhere.
 *   - shape → capability is a PARTIAL inverse. Three shapes, three canonical
 *     representatives. It cannot be derived, because `S.imageGen` does not say
 *     which of the three image transforms a person meant.
 *
 * Hence `capabilityForSamplingShape` stays a hand-written table of three and
 * `samplingShapeForCapability` reads `parseTransform`. Writing the forward
 * direction as comparisons too was the temptation and the bug: it would need a
 * new line for every transform anyone ever adds, and the line that never gets
 * added is the one that silently falls into the `else`.
 */

import { S, isTransformId, parseTransform, type IoKind } from "@serene-pub/sdk"

/**
 * The capability id, or `undefined` for a shape that names none.
 *
 * ⚠ `undefined` rather than a `text->text` catch-all. This is also asked about
 * CONNECTION slots, whose shape space is wider than sampling's three:
 * `core:shape/embeddings@1` and `core:shape/mcp@1` are both real connection
 * shapes, and answering "text" for them would layer the instance's default TEXT
 * connection and sampling config onto an embeddings or MCP slot — handing a
 * temperature to a backend that has never heard of one.
 *
 * An ABSENT shape is the one case that still means text: a slot that declared
 * nothing at all is a spec authored before any of this existed, and it should
 * keep getting the answer it always got.
 */
export function capabilityForSamplingShape(
	shape?: string | null
): string | undefined {
	if (shape === S.imageGen) return "text->image"
	if (shape === S.tts) return "text->audio"
	if (shape === S.textGen) return "text->text"
	return shape ? undefined : "text->text"
}

/**
 * What a capability PRODUCES, as a single kind.
 *
 * Read through `parseTransform` rather than compared against a list of ids, so
 * a transform this build has never heard of — a plugin's `text->video` — still
 * files itself under a heading the admin screen can render. A hand-written
 * comparison would put every unknown combo in "Other" forever.
 *
 * ⚠ `undefined` for a multi-kind output side, deliberately, and not because it
 * is hard. `text->text+image` genuinely has two vocabularies and no way to
 * choose between them; naming the first one would hand image samplers to
 * something that mostly writes prose, and the group heading would say a thing
 * that is half false. There are no such transforms today, so the cost of the
 * honest answer is zero and the cost of the guess is a wrong default nobody
 * would ever look for. Also `undefined` for anything that is not a transform
 * id at all — a feature has no output.
 */
export function outputKindOf(capability: string): IoKind | undefined {
	if (!isTransformId(capability)) return undefined
	const { out } = parseTransform(capability)
	return out.length === 1 ? out[0] : undefined
}

/**
 * Which sampling vocabulary a capability's configs speak, or `undefined` when
 * this build has none for it.
 *
 * `undefined` is a real answer and not a gap: `text->embedding` has no
 * parameters to set, and `resolveSampling(null)` already means "send nothing
 * and let the backend use its own defaults". So a capability landing here
 * renders NO sampling picker rather than an empty one — an empty picker reads
 * as "we lost your configs", which is a different and untrue sentence.
 *
 * Asked of `SAMPLING_SCHEMAS`' three shapes through the output kind, so
 * `text+image->image` and `image->image` reach the image samplers without being
 * named. That fan-out is the whole reason this exists: the star on a sampling
 * config has to register the same choice against every image transform, and a
 * control that says "the image default" while writing one of three rows is a
 * lie on screen.
 */
export function samplingShapeForCapability(
	capability: string
): string | undefined {
	switch (outputKindOf(capability)) {
		case "text":
			return S.textGen
		case "image":
			return S.imageGen
		case "audio":
			return S.tts
		default:
			return undefined
	}
}
