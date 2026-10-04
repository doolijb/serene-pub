/**
 * The entry editor's writes, as arithmetic plus one wait.
 *
 * Two things live here so every call site shares them:
 *
 * 1. **An amendment names the line it was written on.** The server files an
 *    amendment with no `branchId` on main, so a change saved while reading a
 *    fork must carry that fork's id or it lands on every line. One builder
 *    makes the payload, so the Save-as-of and the Off-for-a-while halves
 *    cannot drift apart.
 * 2. **A base save a later amendment still overrides says so.** At now every
 *    dated amendment applies, so writing a field to the base that an
 *    amendment also sets changes nothing on screen. The save still happens
 *    (ruled: warn only); the author is told which amendment wins, and from
 *    when.
 *
 * Pure apart from `fileEntryAmendments`, which is `awaitReply` over the
 * builder.
 */
import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import { awaitReply } from "$lib/client/utils/awaitReply"
import { interestKey } from "$lib/shared/sockets/interest"
import { formatDate, type StoryDate } from "../sections/historyDates"
import { amendmentsOnLine, type Line } from "$lib/shared/lorebooks/lineReading"
import { amendmentDateProblem } from "$lib/shared/lorebooks/amendments"

export interface AmendmentTarget {
	lorebookId: number
	entryId: number
	/** The line being read. `null` is main. */
	branchId: number | null
}

export interface PlannedEntryAmendment {
	year: number
	month?: number | null
	day?: number | null
	fields: Record<string, unknown>
}

/** The one shape every `amendments:create` for an entry is sent in. */
export function entryAmendmentParams(
	target: AmendmentTarget,
	planned: PlannedEntryAmendment
): Sockets.Amendments.Create.Params {
	return {
		lorebookId: target.lorebookId,
		entryId: target.entryId,
		branchId: target.branchId,
		year: planned.year,
		month: planned.month ?? null,
		day: planned.day ?? null,
		fields: planned.fields
	}
}

/**
 * Whether a book's amendment list carries the row THIS create wrote.
 *
 * Every amendment write answers with the whole book's list, and so does every
 * other tab's write, so "a list arrived" proves nothing. The row must be new
 * (an id this editor had not seen for the entry) and be the one asked for:
 * same entry, same line, same date, same fields. A caller with no ids to hand
 * passes an empty set; the fields then keep another write from passing.
 */
export function isOurAmendment(
	list: Sockets.Amendments.List.Response,
	params: Sockets.Amendments.Create.Params,
	knownIds: ReadonlySet<number>
): boolean {
	if (list.lorebookId !== params.lorebookId) return false
	return list.entries.some(
		(a) =>
			!knownIds.has(a.id) &&
			a.entryId === params.entryId &&
			(a.branchId ?? null) === (params.branchId ?? null) &&
			a.year === params.year &&
			(a.month ?? null) === (params.month ?? null) &&
			(a.day ?? null) === (params.day ?? null) &&
			same(a.fields, params.fields)
	)
}

/**
 * Files each planned amendment in turn and waits for each to land.
 *
 * In order, one at a time: the Off-for-a-while pair is "off at the start, on
 * at the end", and a second half filed without the first would switch an
 * entry back on that was never switched off. Rejects with the first refusal
 * (or timeout); the halves already filed stay filed and are in the list.
 */
export async function fileEntryAmendments(
	socket: Pick<TypedSocket, "emit">,
	target: AmendmentTarget,
	plans: readonly PlannedEntryAmendment[],
	knownIds: Iterable<number>
): Promise<Sockets.Amendments.List.Response | null> {
	let known = new Set(knownIds)
	let last: Sockets.Amendments.List.Response | null = null
	for (const planned of plans) {
		const params = entryAmendmentParams(target, planned)
		const seen = known
		last = await awaitReply({
			socket,
			event: "amendments:create",
			params,
			// The create is answered on the LIST, scoped to the book.
			replyKey: interestKey("amendments:list", target.lorebookId),
			errorEvent: "amendments:create:error",
			fallbackError: "The amendment could not be saved.",
			match: (data) => isOurAmendment(data, params, seen)
		})
		known = new Set(
			last.entries
				.filter((a) => a.entryId === target.entryId)
				.map((a) => a.id)
		)
	}
	return last
}

/** The line's name as the reply knows it, for a toast. `null` is main. */
export function lineName(
	list: Sockets.Amendments.List.Response | null,
	branchId: number | null
): string | null {
	if (branchId === null) return null
	return list?.branches.find((b) => b.id === branchId)?.name ?? "this line"
}

/** How a field is named in a sentence. Unknown keys read as themselves. */
const FIELD_WORDS: Record<string, string> = {
	name: "the name",
	content: "the content",
	summary: "the summary",
	keys: "the keywords",
	secondaryKeys: "the secondary keywords",
	enabled: "whether it is on",
	constant: "whether it is pinned",
	priority: "the priority",
	archived: "whether it is archived",
	year: "the date",
	month: "the date",
	day: "the date"
}

export function fieldWord(field: string): string {
	return FIELD_WORDS[field] ?? field
}

/** Same value, for the scalars and small arrays a draft field holds. */
function same(a: unknown, b: unknown): boolean {
	if (a === b) return true
	if (a == null || b == null) return a == null && b == null
	if (typeof a !== "object" || typeof b !== "object") return false
	return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * The fields of a base write that still read differently once resolved.
 *
 * `resolved` is the base-with-this-write, run through the same resolver the
 * list uses — so this is exactly the set of fields whose edit would not show.
 */
export function maskedFields(
	fields: Record<string, unknown>,
	resolved: Record<string, unknown>
): string[] {
	return Object.keys(fields).filter((key) => !same(fields[key], resolved[key]))
}

type OverlayRow = {
	id: number
	branchId: number | null
	year: number
	month?: number | null
	day?: number | null
	fields: Record<string, unknown>
}

/**
 * The amendment that is still setting `field`, for naming it.
 *
 * Detection is the resolver's (see `maskedFields`); this only picks the
 * culprit to name: of the overlays that APPLY on the line being read — its
 * own, and its ancestors' up to each fork cut (`amendmentsOnLine`, ruling 5)
 * — the last in apply order that sets this field to the value that won.
 *
 * `line` is the chain the resolver read (the shell's `lineOf`), so a fork of
 * a branch reads through its parent. `moment` null is the head.
 */
export function maskingAmendment(
	field: string,
	winning: unknown,
	overlays: readonly OverlayRow[],
	line: Line,
	moment: StoryDate | null = null
): OverlayRow | null {
	let best: OverlayRow | null = null
	for (const a of amendmentsOnLine(overlays, line, moment))
		if (field in a.fields && same(a.fields[field], winning)) best = a
	return best
}

/**
 * What a base save says when an amendment still overrides part of it.
 *
 * Null when nothing is masked — the ordinary success toast is then the
 * whole of it.
 */
export function maskedBaseWarning(
	masks: readonly { field: string; amendment: OverlayRow | null }[]
): { title: string; description: string } | null {
	if (!masks.length) return null
	const byDate = new Map<string, string[]>()
	for (const m of masks) {
		const date = m.amendment
			? formatDate(m.amendment as StoryDate)
			: "an earlier date"
		const words = byDate.get(date) ?? []
		const word = fieldWord(m.field)
		if (!words.includes(word)) words.push(word)
		byDate.set(date, words)
	}
	const clauses = [...byDate].map(
		([date, words]) =>
			`an amendment dated ${date} still sets ${joinWords(words)}`
	)
	return {
		title: "Saved to the entry, but an amendment still wins",
		description:
			`Saved, but ${joinWords(clauses)}, so the entry reads the same as before. ` +
			"Edit or delete that amendment to change what it says from then on."
	}
}

/**
 * The toast a Save as of earns when the change re-dates the entry, or null
 * (A18(b)). A date is part of the entry — when it happened — so it is saved
 * with Change the base and moves on every line; it is never an amendment.
 * Asked before anything is sent: the server refuses one
 * (`amendmentDateProblem`), and a re-date left out of the amendment would be
 * an edit the author believes they made.
 */
export function amendmentDateToast(
	fields: Record<string, unknown>
): { title: string; description: string } | null {
	if (!amendmentDateProblem(fields)) return null
	return {
		title: "A date can't be amended",
		description:
			"When an entry happened is part of the entry. To re-date it, use " +
			"Change the base in the save menu: it moves on every line."
	}
}

function joinWords(words: readonly string[]): string {
	if (words.length <= 1) return words[0] ?? ""
	return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`
}
