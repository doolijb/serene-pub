/**
 * 🚧 A scene's transcript as **units** (PROPOSAL-live-scenes §12.2, §14) —
 * the pure halves of `core:task/render-transcript@1` and
 * `core:task/batch-messages@2`.
 *
 * The template renders units, not one string, so a batch cut can never split
 * a line from what it carries: one `preamble` (rendered once, prefixed to
 * every batch), then one unit per story line, each followed by a unit per
 * aside row attached to it (the asides before the first story line lead).
 *
 * ## The template (the contract's `TRANSCRIPT_TEMPLATE_SCOPE`)
 *
 * One Handlebars source holding three inline partials —
 * `{{#*inline "preamble"}}`, `{{#*inline "line"}}`, `{{#*inline "aside"}}` —
 * each rendered on its own by invoking it over the source. Text outside the
 * partials is never rendered. A section the template does not define falls
 * back to the shipped Default's (`DEFAULT_TRANSCRIPT_SECTIONS`, cut from
 * core-catalog's `DEFAULT_TRANSCRIPT_TEMPLATE`).
 *
 * Variables: `preamble` sees `scene { name, place, date }` and `cast [{ name
 * }]`; `line` and `aside` see `messageId`, `name`, `role`, `text`, `channel`
 * — plus, from the message stamps, `clock` and (on a line) `dayChanged`. A
 * line also sees `attachments`: its files named after its text, as
 * `batch-messages@1` names them (`withAttachmentNames`); 🚧 an aside sees its
 * own the same way, from the `asideAttachments` read (lane E).
 */
import type { HistoryAttachmentV1 } from "@serene-pub/sdk"
import { DEFAULT_TRANSCRIPT_TEMPLATE } from "@serene-pub/core-catalog"
import { attachmentPlaceholder } from "$lib/server/attachments/placement"
import { compareDates, type StoryClock } from "$lib/shared/lorebooks/storyDate"

export interface TranscriptRow {
	id: number
	content?: string | null
	senderName?: string | null
	role?: string | null
	channel?: string | null
	clock?: StoryClock | null
	/** On an aside: the story line it follows (null = before the first). */
	afterMessageId?: number | null
}

export interface TranscriptUnit {
	messageId: number
	text: string
	tokens: number
}

export interface RenderedTranscript {
	preamble: string
	units: TranscriptUnit[]
}

/** Renders one Handlebars source with variables (the engine seam). */
export type SectionRenderer = (
	source: string,
	variables: Record<string, unknown>
) => Promise<string>

export type TranscriptSection = "preamble" | "line" | "aside"

const SECTIONS: TranscriptSection[] = ["preamble", "line", "aside"]

/** One inline partial of a template, whole — `{{#*inline "line"}}…{{/inline}}`. */
const partialOf = (source: string, section: TranscriptSection) =>
	new RegExp(
		`\\{\\{#\\*inline\\s+["']${section}["']\\s*\\}\\}[\\s\\S]*?\\{\\{/inline\\}\\}`
	).exec(source)?.[0]

/**
 * The shipped Default's three partials, cut from core-catalog's
 * `DEFAULT_TRANSCRIPT_TEMPLATE` (`shared/summarize/summarizeScene.ts`) — the
 * template the genre specs' Default preset carries — so the fallback for a
 * section a template leaves out can never drift from it.
 */
export const DEFAULT_TRANSCRIPT_SECTIONS: Record<TranscriptSection, string> =
	Object.fromEntries(
		SECTIONS.map((s) => {
			const partial = partialOf(DEFAULT_TRANSCRIPT_TEMPLATE, s)
			if (!partial)
				throw new Error(
					`core-catalog's DEFAULT_TRANSCRIPT_TEMPLATE defines no '${s}' partial`
				)
			return [s, partial]
		})
	) as Record<TranscriptSection, string>

const defines = (source: string, section: TranscriptSection) =>
	new RegExp(`\\{\\{#\\*inline\\s+["']${section}["']\\s*\\}\\}`).test(source)

/**
 * The source each section renders from: the template, with the Default's
 * partial put in front for any section it does not define.
 */
export function sectionSource(
	source: string,
	section: TranscriptSection
): string {
	const missing = SECTIONS.filter((s) => !defines(source, s)).map(
		(s) => DEFAULT_TRANSCRIPT_SECTIONS[s]
	)
	return `${missing.join("")}${source}{{> ${section}}}`
}

const nameOf = (r: TranscriptRow) =>
	String(r.senderName ?? "").trim() ||
	String(r.role ?? "").trim() ||
	"Someone"

const dayOf = (c: StoryClock) => ({
	year: c.year,
	month: c.month ?? null,
	day: c.month != null ? (c.day ?? null) : null
})

/** The cast as the preamble reads it: `[{ name }]`, from a session-cast read or a list. */
export function castNames(cast: unknown): Array<{ name: string }> {
	const names: string[] = []
	const take = (list: unknown) => {
		if (!Array.isArray(list)) return
		for (const m of list) {
			const n = (m as { name?: unknown; nickname?: unknown } | null)?.name
			if (typeof n === "string" && n.trim()) names.push(n.trim())
		}
	}
	if (Array.isArray(cast)) take(cast)
	else if (cast && typeof cast === "object") {
		const c = cast as Record<string, unknown>
		take(c.characters)
		take(c.personas)
	}
	return [...new Set(names)].map((name) => ({ name }))
}

/** The scene as the preamble reads it, from the request (`request.scene`) or the scene itself. */
export function sceneOf(input: unknown): Record<string, unknown> | null {
	const v = input as Record<string, unknown> | null | undefined
	if (!v || typeof v !== "object") return null
	const scene = (
		v.scene && typeof v.scene === "object" ? v.scene : v
	) as Record<string, unknown>
	const pick = (k: string) =>
		typeof scene[k] === "string" && (scene[k] as string).trim()
			? (scene[k] as string)
			: undefined
	const out: Record<string, unknown> = {}
	for (const k of ["name", "place", "date"]) {
		const val = pick(k)
		if (val !== undefined) out[k] = val
	}
	return Object.keys(out).length ? out : null
}

/**
 * A story line's files, named for the `line` section's `attachments`
 * (`core:query/history-attachments@1`, by message id): one placeholder per
 * file on a line of its own — `[image: cat.png — a grey cat]` — led by a line
 * break when the message has text, so `{{{text}}}{{{attachments}}}` renders
 * exactly what `batch-messages@1` batches (`withAttachmentNames`). Empty when
 * the message shows none.
 */
export function attachmentNamesOf(
	row: TranscriptRow,
	text: string,
	attachments: unknown
): string {
	if (!attachments || typeof attachments !== "object") return ""
	const files = (attachments as Record<string, unknown>)[String(row.id)]
	if (!Array.isArray(files) || !files.length) return ""
	const names = (files as HistoryAttachmentV1[])
		.map(attachmentPlaceholder)
		.join("\n")
	return text ? `\n${names}` : names
}

/** Render the transcript into `{ preamble, units }`. */
export async function renderTranscript(
	input: {
		messages: TranscriptRow[]
		asides?: TranscriptRow[]
		/** The story rows' files by message id (`history-attachments@1`). */
		attachments?: unknown
		/** 🚧 The aside rows' files by message id, the same read over the asides (lane E). */
		asideAttachments?: unknown
		cast?: unknown
		scene?: unknown
	},
	source: string | null,
	render: SectionRenderer,
	countTokens: (text: string) => number
): Promise<RenderedTranscript> {
	const template = source?.trim() ? source : ""
	const sources = Object.fromEntries(
		SECTIONS.map((s) => [s, sectionSource(template, s)])
	) as Record<TranscriptSection, string>

	const preamble = (
		await render(sources.preamble, {
			scene: sceneOf(input.scene) ?? {},
			cast: castNames(input.cast)
		})
	).trim()

	const byAfter = new Map<number | null, TranscriptRow[]>()
	for (const a of input.asides ?? []) {
		const key = a.afterMessageId ?? null
		const list = byAfter.get(key) ?? []
		list.push(a)
		byAfter.set(key, list)
	}

	const units: TranscriptUnit[] = []
	const push = (messageId: number, text: string) => {
		const t = text.trim()
		if (t) units.push({ messageId, text: t, tokens: countTokens(t) })
	}
	const rowVars = (r: TranscriptRow) => ({
		messageId: r.id,
		name: nameOf(r),
		role: String(r.role ?? ""),
		text: String(r.content ?? "").trim(),
		channel: String(r.channel ?? "main"),
		clock: r.clock ?? null
	})
	const renderAsides = async (rows: TranscriptRow[]) => {
		for (const a of rows) {
			const vars = rowVars(a)
			push(
				a.id,
				await render(sources.aside, {
					...vars,
					attachments: attachmentNamesOf(a, vars.text, input.asideAttachments)
				})
			)
		}
	}

	await renderAsides(byAfter.get(null) ?? [])
	let previous: StoryClock | null = null
	for (const [i, m] of (input.messages ?? []).entries()) {
		const clock = m.clock ?? null
		const dayChanged =
			i > 0 &&
			!!clock &&
			!!previous &&
			compareDates(dayOf(clock), dayOf(previous)) !== 0
		const vars = rowVars(m)
		push(
			m.id,
			await render(sources.line, {
				...vars,
				attachments: attachmentNamesOf(m, vars.text, input.attachments),
				dayChanged
			})
		)
		if (clock) previous = clock
		await renderAsides(byAfter.get(m.id) ?? [])
	}
	return { preamble, units }
}

/**
 * Cut units into batches (`batch-messages@2`): never inside a unit, the
 * preamble opening every batch and counted in its budget, at least
 * `minBatch` units per batch unless the source runs out. A unit larger than
 * the budget ships alone. No units, no batches.
 */
export function batchUnits(
	preamble: string,
	units: Array<{ text: string; tokens?: number }>,
	budget: number,
	minBatch: number,
	countTokens: (text: string) => number
): string[] {
	const head = preamble.trim()
	const headCost = head ? countTokens(head) + 2 : 0
	const batches: string[][] = []
	let current: string[] = []
	let tokens = headCost
	for (const unit of units) {
		const text = String(unit?.text ?? "")
		const cost =
			(typeof unit?.tokens === "number" && unit.tokens >= 0
				? unit.tokens
				: countTokens(text)) + 1
		if (current.length >= minBatch && tokens + cost > budget) {
			batches.push(current)
			current = [text]
			tokens = headCost + cost
		} else {
			current.push(text)
			tokens += cost
		}
	}
	if (current.length) batches.push(current)
	return batches.map((b) =>
		head ? `${head}\n\n${b.join("\n")}` : b.join("\n")
	)
}
