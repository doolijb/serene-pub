/**
 * 🚧 **Which audio a reply cannot hear** — the pure half of
 * `core:oracle/transcribe-audio@1` (O9, PROPOSAL-layering §13).
 *
 * The transcribe step runs BEFORE placement: it is handed the processed
 * lines, the files by message (`core:query/history-attachments@1`) and what
 * the reply's call reads (`hears`, the context budget's `reads`). This decides
 * which files need hearing — and, once heard, puts the words back on the
 * record placement reads. The host does the hearing (`host.ts`).
 *
 * A file is wanted when ALL of these hold:
 *
 *  - it is a sound (`attachmentKind: "audio"`);
 *  - it sits on a line within `mediaLookback` messages of the end — older
 *    audio is named by placement, as older pictures are;
 *  - it is a person's, not the model's own spoken reply: a reply's text IS
 *    what it said (O13);
 *  - it carries no transcript yet (cached on the file — heard once);
 *  - the call cannot hear it: the pair reads no audio, or not this format.
 *
 * Nothing wanted is the ordinary turn: the step then sends nothing and hands
 * the record on as it came.
 */
import {
	connectionReadsKind,
	type ConnectionReadsV1,
	type HistoryAttachmentV1
} from "@serene-pub/sdk"
import { MEDIA_LOOKBACK_DEFAULT, type PlacementLine } from "./placement"

export interface TranscriptionPlanInput {
	lines: readonly PlacementLine[]
	attachments: Record<string, readonly HistoryAttachmentV1[]> | null | undefined
	/** What the reply's call reads; absent reads no media. */
	hears?: ConnectionReadsV1 | null
	mediaLookback?: number
}

export interface TranscriptionPlan {
	/** The files to hear, each once, in transcript order. */
	wanted: HistoryAttachmentV1[]
}

/** Can the call hear this sound itself — the pair reads audio, in this format? */
export function callHears(
	hears: ConnectionReadsV1 | null | undefined,
	file: Pick<HistoryAttachmentV1, "mime">
): boolean {
	const read = connectionReadsKind(hears, "audio")
	if (!read.reads) return false
	return !read.accepts || read.accepts.includes(String(file.mime))
}

export function planTranscription(input: TranscriptionPlanInput): TranscriptionPlan {
	const map = input.attachments ?? {}
	const lookback = Math.max(
		0,
		Math.floor(input.mediaLookback ?? MEDIA_LOOKBACK_DEFAULT)
	)
	// How far from the end each real message line sits — placement's count.
	const ages = new Map<number, number>()
	let age = 0
	for (let i = input.lines.length - 1; i >= 0; i--) {
		const id = input.lines[i]?.id
		if (typeof id === "number" && id > 0) ages.set(i, age++)
	}
	const wanted: HistoryAttachmentV1[] = []
	const seen = new Set<string>()
	input.lines.forEach((line, index) => {
		const id = line?.id
		if (typeof id !== "number" || id <= 0) return
		if ((ages.get(index) ?? Infinity) >= lookback) return
		if (line.role === "assistant") return
		for (const file of map[String(id)] ?? []) {
			if (file.attachmentKind !== "audio") continue
			if (file.transcript) continue
			if (callHears(input.hears, file)) continue
			if (seen.has(file.uuid)) continue
			seen.add(file.uuid)
			wanted.push(file)
		}
	})
	return { wanted }
}

/**
 * The record with the words put back — every appearance of a heard file,
 * whichever message shows it. `text` takes the words too when the person
 * gave no description of their own. A record with nothing heard is returned
 * as the same object.
 */
export function withTranscripts(
	attachments: Record<string, readonly HistoryAttachmentV1[]> | null | undefined,
	transcripts: Readonly<Record<string, string>>
): Record<string, HistoryAttachmentV1[]> {
	const map = (attachments ?? {}) as Record<string, HistoryAttachmentV1[]>
	if (!Object.keys(transcripts).length) return map
	const out: Record<string, HistoryAttachmentV1[]> = {}
	for (const [messageId, files] of Object.entries(map))
		out[messageId] = files.map((file) => {
			const words = transcripts[file.uuid]
			if (!words) return file
			return {
				...file,
				transcript: words,
				...(file.text ? {} : { text: words })
			}
		})
	return out
}

/** The receipt's sentences for one transcribe step. */
export function transcriptionNotes(r: {
	heard: number
	failed: number
	unheard: number
	why?: string
}): string[] {
	const notes: string[] = []
	const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`
	if (r.heard)
		notes.push(
			`${n(r.heard, "audio file was", "audio files were")} transcribed, so the reply reads what ${r.heard === 1 ? "it says" : "they say"}.`
		)
	if (r.failed)
		notes.push(
			`${n(r.failed, "audio file", "audio files")} could not be transcribed and ${r.failed === 1 ? "is" : "are"} sent as ${r.failed === 1 ? "its name" : "names"}.`
		)
	if (r.unheard)
		notes.push(
			`${n(r.unheard, "audio file", "audio files")} the reply cannot hear ${r.unheard === 1 ? "was" : "were"} sent as ${r.unheard === 1 ? "its name" : "names"}` +
				(r.why ? `: ${r.why}` : ".")
		)
	return notes
}
