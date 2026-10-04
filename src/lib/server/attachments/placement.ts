/**
 * **Placement** — what each transcript line's attachments become in the
 * prompt (PLAN-composer-attachments §3.5; owner D2/D3, 2026-10-02). The pure
 * half of `core:task/place-attachments@1`; the binding hands it the lines,
 * the files by message, the call's `metadata.reads` and a token counter.
 *
 * Per file, in part order:
 *
 *  - an **image or PDF** the call reads, on a line within `mediaLookback`
 *    messages of the end → a media marker (`<@media:{uuid}>`), which the
 *    prompt parser lifts onto that line's own turn;
 *  - a **text file** → a fenced block under its name, cut to `textFileTokens`
 *    with a sentence saying so — never silently;
 *  - **anything else** — a kind the call cannot read, media older than the
 *    lookback, a file no model is offered → a placeholder (D3):
 *    `[image: cat.png — a grey cat]`, the person's description when given.
 *
 * A line with no files is returned as the SAME object, and no `attachments`
 * key is added to it: a transcript with no attachments renders byte for byte
 * what it did before this step existed (the parity guard).
 *
 * Every string copied out of a file — its name, its description, a text
 * file's body — is neutralised for media markers here, because the template
 * scope's neutraliser exempts exactly the value this produces.
 */
import type { ConnectionReadsV1, HistoryAttachmentV1 } from "@serene-pub/sdk"
import {
	mediaMarker,
	neutralizeMediaMarkers
} from "$lib/shared/utils/mediaMarkers"

/** The default estimate of what one placed image costs, when the pair says nothing. */
export const DEFAULT_TOKENS_PER_IMAGE = 1600

export const MEDIA_LOOKBACK_DEFAULT = 10
export const TEXT_FILE_TOKENS_DEFAULT = 4000

export interface PlacementLine {
	id?: unknown
	role?: unknown
	name?: unknown
	message?: unknown
	[key: string]: unknown
}

export interface PlacementInput {
	lines: readonly PlacementLine[]
	/** Files by message id — the record `core:query/history-attachments@1` publishes. */
	attachments: Record<string, readonly HistoryAttachmentV1[]> | null | undefined
	/** What the call reads; absent (an unwired slot) reads no media. */
	reads?: ConnectionReadsV1 | null
	mediaLookback?: number
	textFileTokens?: number
	/** The run's tokenizer; an estimate (chars / 4) when absent. */
	countTokens?: (text: string) => number
}

export interface PlacementResult {
	lines: PlacementLine[]
	notes: string[]
	/** Media markers placed, and their estimated prompt cost. */
	placed: { media: number; estimatedTokens: number }
}

const KIND_WORD = { image: "image", pdf: "PDF", text: "file" } as const
const KIND_PLURAL = { image: "images", pdf: "PDFs" } as const

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`

/** A name for the prompt — neutralised, single-line, never empty-looking. */
function cleanName(raw: unknown): string {
	if (typeof raw !== "string") return ""
	return neutralizeMediaMarkers(raw.replace(/[\r\n\]]+/g, " ").trim())
}

/**
 * A file as its name (D3): `[image: cat.png — a grey cat]`, `[file: notes.txt]`.
 * Exported for the summarize batch cut (`core:task/batch-messages@1`), which
 * names every file this way — a summary is drafted from text — so one
 * spelling serves both paths.
 */
export function attachmentPlaceholder(file: HistoryAttachmentV1): string {
	const word =
		file.attachmentKind === "image" || file.attachmentKind === "pdf"
			? KIND_WORD[file.attachmentKind]
			: "file"
	const name = cleanName(file.filename)
	const alt = cleanName(file.text)
	const label = name ? `${word}: ${name}` : word
	return `[${label}${alt ? ` — ${alt}` : ""}]`
}

/** The shortest backtick fence the body cannot close. */
function fenceFor(body: string): string {
	let longest = 0
	for (const run of body.match(/`+/g) ?? [])
		longest = Math.max(longest, run.length)
	return "`".repeat(Math.max(3, longest + 1))
}

function textBlock(
	file: HistoryAttachmentV1,
	budget: number,
	count: (text: string) => number
): { block: string; cut: boolean } {
	const name = cleanName(file.filename) || "untitled"
	let body = neutralizeMediaMarkers(
		(file.body ?? "").replace(/\r\n?/g, "\n")
	)
	let cut = file.bodyTruncated === true
	if (budget <= 0) {
		body = ""
		cut = true
	} else {
		const tokens = count(body)
		if (tokens > budget) {
			// Proportional, then back to a line or word boundary so the cut
			// does not land mid-word. An estimate — the sentence says "about".
			let end = Math.max(0, Math.floor((body.length * budget) / tokens))
			const boundary = Math.max(
				body.lastIndexOf("\n", end),
				body.lastIndexOf(" ", end)
			)
			if (boundary > end * 0.8) end = boundary
			body = body.slice(0, end).trimEnd()
			cut = true
		}
	}
	const fence = fenceFor(body)
	const lines = [`[file: ${name}]`, `${fence}text`, body, fence]
	if (cut)
		lines.push(
			`[${name} was cut to about its first ${budget} tokens; the rest is not shown.]`
		)
	return { block: lines.join("\n"), cut }
}

export function placeAttachments(input: PlacementInput): PlacementResult {
	const map = input.attachments ?? {}
	const lookback = Math.max(
		0,
		Math.floor(input.mediaLookback ?? MEDIA_LOOKBACK_DEFAULT)
	)
	const budget = Math.max(
		0,
		Math.floor(input.textFileTokens ?? TEXT_FILE_TOKENS_DEFAULT)
	)
	const count =
		input.countTokens ?? ((text: string) => Math.ceil(text.length / 4))
	const reads = input.reads ?? null
	const tokensPerImage =
		reads?.tokensPerImage && reads.tokensPerImage > 0
			? reads.tokensPerImage
			: DEFAULT_TOKENS_PER_IMAGE

	// How far from the end each real message line sits: 0 is the newest.
	// The seed (-2) and folio blocks (-3) are not messages and carry no files.
	const ages = new Map<number, number>()
	let age = 0
	for (let i = input.lines.length - 1; i >= 0; i--) {
		const id = input.lines[i]?.id
		if (typeof id === "number" && id > 0) ages.set(i, age++)
	}

	let placedMedia = 0
	let pastLookback = 0
	const unreadable = { image: 0, pdf: 0 }
	let unoffered = 0
	let cutFiles = 0

	const lines = input.lines.map((line, index) => {
		const id = line?.id
		if (typeof id !== "number" || id <= 0) return line
		const files = map[String(id)]
		if (!files?.length) return line
		const within = (ages.get(index) ?? Infinity) < lookback
		const pieces: string[] = []
		for (const file of files) {
			const kind = file.attachmentKind
			if (kind === "text") {
				const { block, cut } = textBlock(file, budget, count)
				if (cut) cutFiles++
				pieces.push(block)
			} else if (kind === "image" || kind === "pdf") {
				if (!reads?.[kind]) {
					unreadable[kind]++
					pieces.push(attachmentPlaceholder(file))
				} else if (!within) {
					pastLookback++
					pieces.push(attachmentPlaceholder(file))
				} else {
					placedMedia++
					pieces.push(mediaMarker(file.uuid))
				}
			} else {
				unoffered++
				pieces.push(attachmentPlaceholder(file))
			}
		}
		const text = typeof line.message === "string" ? line.message : ""
		const lead = text.trim() ? "\n" : ""
		return { ...line, attachments: lead + pieces.join("\n") }
	})

	const notes: string[] = []
	if (placedMedia)
		notes.push(
			`${plural(placedMedia, "file was", "files were")} sent to the model ` +
				`(about ${placedMedia * tokensPerImage} tokens, estimated).`
		)
	if (pastLookback)
		notes.push(
			`${plural(pastLookback, "file", "files")} older than the media lookback ` +
				`(${lookback} messages) ${pastLookback === 1 ? "was" : "were"} sent as ${pastLookback === 1 ? "its name" : "names"}.`
		)
	for (const kind of ["image", "pdf"] as const) {
		const n = unreadable[kind]
		if (!n) continue
		const why = reads?.why?.[kind]
		notes.push(
			`This step can't read ${KIND_PLURAL[kind]}: ${n} sent as ${n === 1 ? "a name" : "names"}.` +
				(why ? ` ${why}` : "")
		)
	}
	if (unoffered)
		notes.push(
			`${plural(unoffered, "file", "files")} of a type no model is sent ${unoffered === 1 ? "was" : "were"} shown as ${unoffered === 1 ? "its name" : "names"}.`
		)
	if (cutFiles)
		notes.push(
			`${plural(cutFiles, "text file was", "text files were")} cut to the text file budget (${budget} tokens).`
		)

	return {
		lines,
		notes,
		placed: {
			media: placedMedia,
			estimatedTokens: placedMedia * tokensPerImage
		}
	}
}

/**
 * The summarize batch transcript's half (attachments follow-ups, owner ruling
 * 2026-10-03): each message that shows files, with every file named after its
 * text — `Look at this\n[image: cat.png — a grey cat]`, or the name alone for a
 * message that is only a picture. A summary is drafted from text, so nothing is
 * sent as media and a text file is named, not inlined. Read by
 * `core:task/batch-messages@1` BEFORE its cut, so the names are counted.
 *
 * A message with no files is returned as the SAME object, so a transcript with
 * no attachments batches and drafts byte for byte as it did.
 */
export function withAttachmentNames<M extends { id?: unknown; content?: unknown }>(
	messages: readonly M[],
	attachments: Record<string, readonly HistoryAttachmentV1[]> | null | undefined
): M[] {
	const map = attachments ?? {}
	return messages.map((message) => {
		const id = message?.id
		const files = typeof id === "number" ? map[String(id)] : undefined
		if (!files?.length) return message
		const names = files.map(attachmentPlaceholder).join("\n")
		const text = typeof message.content === "string" ? message.content : ""
		return { ...message, content: text.trim() ? `${text}\n${names}` : names }
	})
}
