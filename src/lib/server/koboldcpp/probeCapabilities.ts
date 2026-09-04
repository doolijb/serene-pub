/**
 * KoboldCPP's `/api/extra/version` flags, as capabilities.
 *
 * KoboldCPP is the reason the capability model exists. One process writes
 * replies, draws pictures, reads images, speaks and transcribes, and it will
 * tell you which of those it can do right now — the answer depends on which
 * models were loaded, not on which software is running. A single `modality`
 * scalar on the connection cannot represent that, and `isImage("koboldcpp")`
 * answering `false` is what refused an image node the one backend this whole
 * milestone targets.
 *
 * The flags were already being read, in `sockets/koboldcpp.ts`, and rendered as
 * badges on the KoboldCPP settings tab — but that reading never reached the
 * connection row. This module is the shared middle the plan asked for, so the
 * badges and the stored capability set cannot disagree about the same server.
 *
 * ## No extra request
 *
 * `KoboldCppAdapter.testConnection` already fetches this exact endpoint and uses
 * one field of the response (`version`), discarding the rest. Mapping what it
 * already has in hand costs nothing.
 */

import {
	topGrade,
	type CapabilityId,
	type CapabilitySet,
	type Grade
} from "@serene-pub/sdk"

/** The flags the version endpoint reports, as the settings tab renders them. */
export interface KoboldCppFlags {
	txt2img: boolean
	vision: boolean
	tts: boolean
	transcribe: boolean
	embeddings: boolean
	multiplayer: boolean
	websearch: boolean
	adminEnabled: boolean
}

export const NO_FLAGS: KoboldCppFlags = {
	txt2img: false,
	vision: false,
	tts: false,
	transcribe: false,
	embeddings: false,
	multiplayer: false,
	websearch: false,
	adminEnabled: false
}

/** The version payload's capability flags, normalized. */
export function flagsFrom(data: unknown): KoboldCppFlags {
	const d = (data ?? {}) as Record<string, unknown>
	return {
		txt2img: !!d.txt2img,
		vision: !!d.vision,
		tts: !!d.tts,
		transcribe: !!d.transcribe,
		embeddings: !!d.embeddings,
		multiplayer: !!d.multiplayer,
		websearch: !!d.websearch,
		adminEnabled: !!d.admin
	}
}

/**
 * The flags as a capability set.
 *
 * Every transform is reported either way round — `false` becomes an explicit
 * `none`, not an omission. A probe is an ANSWER, and "the server says it cannot
 * draw" has to be able to switch off a capability a preset turned on; leaving
 * the key out would let the older, more optimistic layer stand.
 *
 * `text->text` is always native and is not conditional on a flag: this endpoint
 * answering at all is a KoboldCPP that generates text. `multiplayer`,
 * `websearch` and `admin` are deliberately absent — they are server features,
 * not things a model turns one kind of data into.
 *
 * ## ⚠ Three of these answers are currently DISCARDED, and that is correct
 *
 * `text->audio`, `audio->text` and `text->embedding` are no longer declared in
 * `ADAPTER_MANIFEST` for either KoboldCPP type, because no adapter implements
 * `synthesizeSpeech`, `transcribeAudio` or `embedText` — the manifest's key
 * space is derived from which actions exist, so a capability nothing can call
 * cannot be declared. `resolveCapabilities` iterates `supports` only, so it
 * ignores an answer to a question that was never asked.
 *
 * They are still fetched and still written to the durable `probe.found` on
 * purpose. The probe records what the SERVER said, which outlives what this app
 * can currently do with it: the day one of those actions lands, the manifest key
 * returns and every already-tested connection resolves it immediately, with no
 * re-test. Do not "clean up" this mapping to match what resolution consumes —
 * that would trade a fact for a derived detail, and would have to be undone.
 */
export function capabilitiesFromFlags(flags: KoboldCppFlags): CapabilitySet {
	// `topGrade(id)` rather than a literal, because "as good as this gets" is a
	// different NUMBER per capability — 1 for a transform, 2 for a feature the app
	// can emulate. A flag is a yes/no about the backend, so the two ends of that
	// capability's own scale are the only honest readings of one.
	const graded = (id: CapabilityId, on: boolean): Grade =>
		on ? topGrade(id) : 0
	return {
		"text->text": graded("text->text", true),
		"text->image": graded("text->image", flags.txt2img),
		"text+image->text": graded("text+image->text", flags.vision),
		// Recorded, not currently resolved — see the note above.
		"text->audio": graded("text->audio", flags.tts),
		"audio->text": graded("audio->text", flags.transcribe),
		"text->embedding": graded("text->embedding", flags.embeddings)
	}
}
