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

import type { CapabilitySet } from "@serene-pub/sdk"

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
 */
export function capabilitiesFromFlags(flags: KoboldCppFlags): CapabilitySet {
	return {
		"text->text": "native",
		"text->image": flags.txt2img ? "native" : "none",
		"text+image->text": flags.vision ? "native" : "none",
		"text->audio": flags.tts ? "native" : "none",
		"audio->text": flags.transcribe ? "native" : "none",
		"text->embedding": flags.embeddings ? "native" : "none"
	}
}
