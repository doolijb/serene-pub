/**
 * The cast board's writes and what it says about them.
 *
 * The cast twin of `editor/entrySave.ts`, so a member behaves like an entry:
 *
 * 1. **An amendment names the line it was written on.** The server files an
 *    amendment with no `branchId` on main, so a change to a member saved
 *    while reading a fork must carry that fork's id or it lands on every
 *    line (finding #105).
 * 2. **A save waits for ITS reply** before it says anything (`awaitReply`).
 * 3. **A base save a later amendment still overrides says so** (#113) —
 *    warn only, naming the amendment and its date.
 * 4. **Deleting a member asks about their private lore** (ruling 4): kept
 *    lore becomes unassigned, and unassigned lore is narrator-visible.
 */
import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import { awaitReply } from "$lib/client/utils/awaitReply"
import { interestKey } from "$lib/shared/sockets/interest"
import { formatDate, type StoryDate } from "../sections/historyDates"

export interface CastAmendmentTarget {
	lorebookId: number
	castId: number
	/** The line being read. `null` is main. */
	branchId: number | null
}

export interface PlannedCastAmendment {
	year: number
	month?: number | null
	day?: number | null
	fields: Record<string, unknown>
}

/** The one shape every `amendments:create` for a member is sent in. */
export function castAmendmentParams(
	target: CastAmendmentTarget,
	planned: PlannedCastAmendment
): Sockets.Amendments.Create.Params {
	return {
		lorebookId: target.lorebookId,
		castId: target.castId,
		branchId: target.branchId,
		year: planned.year,
		month: planned.month ?? null,
		day: planned.day ?? null,
		fields: planned.fields
	}
}

/** Same value, for the scalars and small arrays a member field holds. */
function same(a: unknown, b: unknown): boolean {
	if (a === b) return true
	if (a == null || b == null) return a == null && b == null
	if (typeof a !== "object" || typeof b !== "object") return false
	return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Whether a book's amendment list carries the row THIS create wrote.
 *
 * Every amendment write, from any tab, answers with the whole book's list, so
 * the row must be new (an id not seen before) and be the one asked for: same
 * member, same line, same date, same fields.
 */
export function isOurCastAmendment(
	list: Sockets.Amendments.List.Response,
	params: Sockets.Amendments.Create.Params,
	knownIds: ReadonlySet<number>
): boolean {
	if (list.lorebookId !== params.lorebookId) return false
	return (list.cast ?? []).some(
		(a) =>
			!knownIds.has(a.id) &&
			a.castId === params.castId &&
			(a.branchId ?? null) === (params.branchId ?? null) &&
			a.year === params.year &&
			(a.month ?? null) === (params.month ?? null) &&
			(a.day ?? null) === (params.day ?? null) &&
			same(a.fields, params.fields)
	)
}

/**
 * Files one dated change to a member and waits for it to land.
 *
 * Rejects with the server's refusal, or with the timeout; a caller keeps the
 * author's draft either way.
 */
export function fileCastAmendment(
	socket: Pick<TypedSocket, "emit">,
	target: CastAmendmentTarget,
	planned: PlannedCastAmendment,
	knownIds: Iterable<number>
): Promise<Sockets.Amendments.List.Response> {
	const params = castAmendmentParams(target, planned)
	const seen = new Set(knownIds)
	return awaitReply({
		socket,
		event: "amendments:create",
		params,
		// The create is answered on the LIST, scoped to the book.
		replyKey: interestKey("amendments:list", target.lorebookId),
		errorEvent: "amendments:create:error",
		fallbackError: "The amendment could not be saved.",
		match: (data) => isOurCastAmendment(data, params, seen)
	})
}

/** How a member's field is named in a sentence. Unknown keys read as themselves. */
const CAST_FIELD_WORDS: Record<string, string> = {
	name: "the name",
	aliases: "the other names",
	summary: "the summary",
	nodeState: "the state",
	nodeVisibility: "the visibility",
	spriteSet: "the sprite set",
	characterId: "the card"
}

export function castFieldWord(field: string): string {
	return CAST_FIELD_WORDS[field] ?? field
}

function joinWords(words: readonly string[]): string {
	if (words.length <= 1) return words[0] ?? ""
	return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`
}

/**
 * What a base save to a member says when an amendment still overrides part
 * of it (#113). Null when nothing is masked.
 *
 * `masks` pairs each masked field with the amendment still setting it — found
 * with `maskedFields` + `maskingAmendment` from the entry editor, which read
 * a cast overlay exactly as they read an entry's.
 */
export function castMaskedWarning(
	masks: readonly {
		field: string
		amendment: (StoryDate & { year: number }) | null
	}[]
): { title: string; description: string } | null {
	if (!masks.length) return null
	const byDate = new Map<string, string[]>()
	for (const m of masks) {
		const date = m.amendment ? formatDate(m.amendment) : "an earlier date"
		const words = byDate.get(date) ?? []
		const word = castFieldWord(m.field)
		if (!words.includes(word)) words.push(word)
		byDate.set(date, words)
	}
	const clauses = [...byDate].map(
		([date, words]) =>
			`an amendment dated ${date} still sets ${joinWords(words)}`
	)
	return {
		title: "Saved to the member, but an amendment still wins",
		description:
			`Saved, but ${joinWords(clauses)}, so they read the same as before. ` +
			"Edit or delete that amendment to change what it says from then on."
	}
}

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`

export type PrivateLoreChoice = "keep" | "delete"

export interface DeleteMemberFacts {
	name: string
	linked: boolean
	relationshipCount: number
	/** The pre-check's answer; null while it is on its way. */
	check: Sockets.NarrativeGraph.CheckNodeMergeReferences.Response | null
}

export interface DeleteMemberCopy {
	title: string
	/** What goes with them whatever is chosen. */
	message: string
	/** A past merge names them. */
	mergeWarning: string | null
	/**
	 * The keep-or-delete question about their private lore (ruling 4), or
	 * null when they have none — a plain confirm.
	 */
	lore: {
		lead: string
		keep: string
		keepDetail: string
		remove: string
		removeDetail: string
	} | null
}

/**
 * The delete-member dialog's sentences.
 *
 * ⚠ Lore anchored to them is NOT deleted unless the author says so: the
 * anchor is `ON DELETE SET NULL`, so kept lore becomes unassigned, and
 * unassigned lore is narrator-visible. The dialog says that plainly and
 * never claims the lore is deleted (#6, #108).
 */
export function deleteMemberCopy(facts: DeleteMemberFacts): DeleteMemberCopy {
	const { name, linked, relationshipCount, check } = facts
	const goes: string[] = []
	if (relationshipCount > 0)
		goes.push(
			`${relationshipCount === 1 ? "the" : "all"} ${plural(relationshipCount, "relationship", "relationships")} they are in`
		)
	else goes.push("every relationship they are in")
	goes.push("their dated changes", "their places in scenes")
	const message =
		(linked
			? `This removes ${name} from this lorebook and deletes ${joinWords(goes)}. Their character card is not touched.`
			: `This deletes ${name}, with ${joinWords(goes)}.`) +
		" This cannot be undone."

	const mergeWarning = check?.referencedByMergeLog
		? "A past merge names them, so deleting them permanently disables that merge's undo."
		: null

	const open = check?.privateLoreCount ?? 0
	const archived = check?.archivedPrivateLoreCount ?? 0
	const total = open + archived
	if (!check || total === 0)
		return { title: `Delete ${name}?`, message, mergeWarning, lore: null }

	const lead =
		open > 0
			? `${name} has ${plural(open, "lore entry", "lore entries")} private to them` +
				(archived > 0 ? `, and ${archived} archived.` : ".")
			: `${name} has ${plural(archived, "archived lore entry", "archived lore entries")} private to them.`
	return {
		title: `Delete ${name}?`,
		message,
		mergeWarning,
		lore: {
			lead,
			keep: "Keep their lore",
			keepDetail:
				total === 1
					? "It becomes unassigned, and the narrator can see it."
					: "It becomes unassigned, and the narrator can see all of it.",
			remove: "Delete their lore too",
			removeDetail:
				archived > 0
					? `Deletes all ${plural(total, "entry", "entries")}, the archived ones included.`
					: `Deletes ${total === 1 ? "that entry" : `all ${total} entries`}.`
		}
	}
}

/** What a finished delete says. */
export function deletedMemberToast(
	name: string,
	deletedLoreCount: number
): string {
	return deletedLoreCount > 0
		? `${name} deleted, with ${plural(deletedLoreCount, "lore entry", "lore entries")}`
		: `${name} deleted`
}

/**
 * What an undone merge says: who is back, and what could not come back with
 * them. An undo that put everything back is a success; one that could not is
 * a warning that names what is missing.
 */
export function undoMergeToast(msg: Sockets.NarrativeGraph.UndoMerge.Response): {
	kind: "success" | "warning"
	title: string
	description: string
} {
	const links = msg.unrestoredLinkCount ?? 0
	const story = msg.unrestoredStoryCount ?? 0
	const parts = [`"${msg.restoredNode.name}" restored.`]
	if (links > 0)
		parts.push(
			`${plural(links, "relationship", "relationships")} could not be put back: one end, or the line it was on, has been deleted since.`
		)
	if (story > 0)
		parts.push(
			`${plural(story, "dated change, placement or attribute", "dated changes, placements or attributes")} of theirs could not be put back: the line or session ${story === 1 ? "it" : "they"} belonged to has been deleted since.`
		)
	return {
		kind: links > 0 || story > 0 ? "warning" : "success",
		title: links > 0 || story > 0 ? "Merge undone, not all of it" : "Merge undone",
		description: parts.join(" ")
	}
}
