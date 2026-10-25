/**
 * 🚧 The transcription-adapter family (O9, 2026-10-21) — a model that HEARS:
 * audio in, the words it says out (`audio->text`, `transcribeAudio`).
 *
 * A fifth family beside text, image, embedding and NER, parallel to them for
 * the reason each of those gives: a transcription has no prompt to assemble,
 * no token budget and no sampling config, so a subclass of the text base
 * would inherit ten construction parameters it must ignore. What is SHARED is
 * the action — `transcribeAudio` comes from `$lib/server/adapters/actions`
 * like every other, so "this type can do `audio->text`" is derived from the
 * class (the conformance test), never asserted twice.
 *
 * ⚠ Bytes in hand, never a reference: the request carries the sound itself
 * (`TranscribeRequest.audio`), loaded and access-checked by the host. This
 * module stays out of the database's import graph, like every adapter.
 */

import type {
	AdapterActions,
	TranscribeRequest,
	TranscribeResult
} from "$lib/server/adapters/actions"

export type { TranscribeRequest, TranscribeResult }

/** What a concrete transcription-adapter module default-exports. */
export interface TranscriptionAdapterExports {
	Adapter: new (connection: AdapterConnection) => BaseTranscriptionAdapter
}

/**
 * The actions this family does not implement, merged on as an INTERFACE —
 * the other bases' mechanism, for their reason: their ABSENCE is the
 * statement (a transcription module implementing `generateText` would make a
 * hearing connection offerable as the chat default).
 */
export interface BaseTranscriptionAdapter
	extends Partial<Omit<AdapterActions, "transcribeAudio">> {}

export abstract class BaseTranscriptionAdapter implements AdapterActions {
	connection: AdapterConnection

	constructor(connection: AdapterConnection) {
		this.connection = connection
	}

	/** Hear one sound and write down what it says. `audio->text`. */
	abstract transcribeAudio(
		req: TranscribeRequest,
		opts?: { signal?: AbortSignal }
	): Promise<TranscribeResult>
}
