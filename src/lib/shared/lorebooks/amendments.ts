/**
 * What was true, and when.
 *
 * An amendment is a **dated overlay**, never a version. The base row is what
 * was true first; each amendment says "from this date, these fields read
 * differently". Resolving one entry at one moment is: the base, then every
 * amendment that has happened by then, later winning per field.
 *
 * Ruled 2026-09-23; design of record
 * `~/.claude/plans/DESIGN-lore-amendments-branches.md`.
 *
 * ## Two subjects, one resolver
 *
 * Entries and cast members are both amendable, and they are two TABLES —
 * `entry_amendments` and `cast_amendments` — because a deleted subject must
 * not leave dated overlays behind and a polymorphic subject column cannot
 * cascade. The precedence logic is written once, here, and both wrap it.
 *
 * ⚠ The second subject was `character_amendments` until 2026-09-23. It is the
 * CAST MEMBER that shifts over a story, card included; see `castAsOf`.
 *
 * ## Precedence
 *
 * 1. the base row
 * 2. every **main** amendment dated at or before the moment (and the fork
 *    cut), in date order
 * 3. every amendment on each **ancestor branch**, oldest ancestor first, same
 * 4. every amendment **on the branch being read**, same
 *
 * Later wins per field, and a nearer line always wins over an ancestor at the
 * same date — that is the whole point of a branch. The chain and its cuts are
 * `$lib/shared/lorebooks/lineReading.ts` (owner ruling 5, 2026-09-28). Ties inside a group break on `id`, so
 * two amendments written the same day resolve the same way on every read.
 *
 * ⚠ **`moment = null` means now, and now applies EVERY dated amendment** —
 * including one dated after the latest dated thing in the book. The future does
 * not exist in a book; there is only dated and undated, and an undated change
 * is an edit to the base, not an amendment. The `year` column is `NOT NULL`
 * for that reason.
 *
 * ⚠ **An absent key and a null value are different.** A key the amendment does
 * not mention is passed through from below; a key set to `null` sets null. That
 * is what lets an amendment clear a field, and what makes a time RANGE two
 * amendments rather than one — `enabled: false` at one date, `enabled: true` at
 * another.
 *
 * ⚠ Pure. No database, no Svelte, no socket: the server resolves for retrieval
 * and the workspace resolves for reading, and they must agree.
 */
import { compareDates, type StoryDate } from "./storyDate"
import {
	amendmentsAheadOnLine,
	amendmentsOnLine,
	asLine,
	lineFromFork,
	MAIN_LINE,
	stepOf,
	type Line
} from "./lineReading"

/** One dated overlay, as both tables carry it. */
export interface Amendment {
	id: number
	/** NULL = main, the shared line. */
	branchId: number | null
	year: number
	month?: number | null
	day?: number | null
	/** A partial of the subject's writable columns. Present keys overlay. */
	fields: Record<string, unknown>
}

/** Which line, and how far along it, a subject is being read at. */
export interface AsOf {
	/** `null` = now: every dated amendment applies. */
	moment?: StoryDate | null
	/** `null` = main. */
	branchId?: number | null
	/**
	 * Where this branch left the line it forked from.
	 *
	 * ⚠ Supplying it CUTS main off at the fork: main's amendments after that
	 * date do not reach the branch, which is the only reading under which a
	 * branch is insulated from what main went on to do. Omitting it lets all of
	 * main through, which is the reading for main itself (no fork) and the
	 * conservative default for a caller that does not know.
	 *
	 * ⚠ One level only: it cannot see a grandparent. Pass `line` instead.
	 */
	forkedAt?: StoryDate | null
	/**
	 * The whole ancestor chain (`lineOf` in `./lineReading`). When given it
	 * is authoritative and `branchId`/`forkedAt` are ignored — a fork of a
	 * branch reads its parent's amendments before its own fork date, and the
	 * grandparent's before the earlier cut (owner ruling 5, 2026-09-28).
	 */
	line?: Line
}

/** The line an `AsOf` names: its `line`, or the one-level line it spells. */
export function lineOfAsOf(at: AsOf = {}): Line {
	return at.line ?? lineFromFork(at.branchId ?? null, at.forkedAt ?? null)
}

/**
 * The amendments that apply, already in the order they must be applied.
 *
 * Exported because the UI needs the same answer the resolver used — "1
 * amendment dated Y3 Thaw 2, which has not happened yet at this moment" is the
 * complement of this list, and computing it twice by different rules is how the
 * two come to disagree. The rule itself is `amendmentsOnLine`.
 */
export function amendmentsAsOf(
	amendments: readonly Amendment[],
	at: AsOf = {}
): Amendment[] {
	return amendmentsOnLine(amendments, lineOfAsOf(at), at.moment ?? null)
}

/**
 * The subject as it reads at that moment on that line.
 *
 * ⚠ A shallow merge, deliberately. A `fields` value is replaced whole, not
 * merged into: an amendment that sets `keys` sets the whole list, because "add
 * one keyword as of Y2" is not a thing the author can express or read back. If
 * per-item history is ever wanted it is a different feature, not a deeper
 * merge.
 */
export function applyAmendments<T extends object>(
	base: T,
	amendments: readonly Amendment[],
	at: AsOf = {}
): T {
	const applies = amendmentsAsOf(amendments, at)
	if (!applies.length) return base
	const out = { ...base } as Record<string, unknown>
	for (const amendment of applies)
		for (const [key, value] of Object.entries(amendment.fields))
			out[key] = value
	return out as T
}

/**
 * The amendments that have NOT happened yet at this moment, soonest first.
 *
 * What the entry's own view says out loud: "1 amendment dated Y3 Thaw 2, which
 * has not happened yet at this moment". Reading as of `now` leaves this empty
 * by construction — at now, everything dated has happened.
 */
export function amendmentsAfter(
	amendments: readonly Amendment[],
	at: AsOf = {}
): Amendment[] {
	return amendmentsAheadOnLine(amendments, lineOfAsOf(at), at.moment ?? null)
}

/** An entry, as it read then. A thin wrapper; the rules live above. */
export function entryAsOf<T extends object>(
	entry: T,
	amendments: readonly Amendment[],
	at: AsOf = {}
): T {
	return applyAmendments(entry, amendments, at)
}

/**
 * A cast member, as they read then.
 *
 * ⚠ **The subject is the cast member, not the character card** (ruled
 * 2026-09-23, superseding ruling 5's wording). A card is a reusable asset
 * several books may share; the person in THIS story is the
 * `lorebook_bindings` row. Amending the card would change them everywhere it
 * is used, which is not what a dated change in one story means.
 *
 * ⚠ Which card represents them is itself amendable: `characterId` is one of
 * the columns `fields` may overlay, so "the older card from Y20" is an
 * ordinary amendment and needs no mechanism of its own.
 */
export function castAsOf<T extends object>(
	member: T,
	amendments: readonly Amendment[],
	at: AsOf = {}
): T {
	return applyAmendments(member, amendments, at)
}

/**
 * The cast overlays that apply to ONE appearance of a member.
 *
 * World-dated overlays (`personalPosition` null) apply to every appearance;
 * one dated against her own life applies only at or past that point of it.
 * That is what lets the fifty-year-old and the thirty-four-year-old read
 * differently at one world moment. An appearance at no particular point
 * (`null`) reads every overlay, as a member with no presences always has.
 *
 * ⚠ The one filter. `castMemberAsOf` (server) and the workspace roster both
 * call it — two copies is how the roster and the prompt came to disagree.
 */
export function amendmentsForAppearance<
	A extends { personalPosition?: number | null }
>(amendments: readonly A[], personalPosition: number | null): A[] {
	if (personalPosition == null) return [...amendments]
	return amendments.filter(
		(m) => m.personalPosition == null || m.personalPosition <= personalPosition
	)
}

/**
 * Group a book's amendments by the id they hang off.
 *
 * The pool reads every amendment in a book in ONE query and resolves each row
 * against its own slice — one query per entry would be a query per row in a
 * list, which is the cost the design's "grouped client-side" names.
 */
export function groupAmendments<A extends { [k: string]: any }>(
	amendments: readonly A[],
	key: keyof A
): Map<number, A[]> {
	const out = new Map<number, A[]>()
	for (const a of amendments) {
		const id = a[key] as number
		const list = out.get(id)
		if (list) list.push(a)
		else out.set(id, [a])
	}
	return out
}

/**
 * Columns that belong to the row, never to what the row SAYS.
 *
 * An amendment overlays what an entry says at a date. Its identity, its book,
 * its type and its bookkeeping are not things that can read differently at one
 * moment and another — an entry that is a different row at Y2 is a different
 * entry — so a change to one of these is never an amendment.
 */
export const NEVER_AMENDED: ReadonlySet<string> = new Set([
	"id",
	"lorebookId",
	"typeId",
	"branchId",
	"position",
	"createdAt",
	"updatedAt"
])

/** Same value, for the scalars and the small arrays a draft field holds. */
function same(a: unknown, b: unknown): boolean {
	if (a === b) return true
	if (a == null || b == null) return a == null && b == null
	if (typeof a !== "object" || typeof b !== "object") return false
	return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * What the author actually changed, and nothing else.
 *
 * The editor draws the entry as it READS at the moment — base plus whatever
 * has already been amended — so the draft it hands back is a whole entry, not
 * a change. Saving that whole thing would fold every other amendment's value
 * into wherever it landed. The diff is what both save actions write: as an
 * amendment's `fields`, or as a patch to the base.
 *
 * ⚠ Compared against the draft as it was BUILT, not against the stored row.
 * `toDraft` may normalise, and a normalisation the author never saw is not a
 * change they made.
 *
 * ⚠ An empty result means "nothing to save", which both callers must treat as
 * a refusal rather than writing an amendment that says nothing.
 */
export function changedFields(
	draft: Record<string, unknown>,
	pristine: Record<string, unknown>
): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(draft)) {
		if (NEVER_AMENDED.has(key)) continue
		if (!same(value, pristine[key])) out[key] = value
	}
	return out
}

/**
 * Whether a row belongs to the line being read (its branch is in the chain).
 *
 * A row with no branch is **shared**: it reads the same on every line, which
 * is what makes a branch cheap — the entries both lines agree about are one
 * row, not two. A row with a branch belongs to that line and to the lines
 * forked from it (ruling 5), so main never sees what a fork wrote and no fork
 * sees a sibling's.
 *
 * ⚠ Pass a `Line` (`lineOf`). A bare branch id is read as a one-level fork of
 * main and cannot see a grandparent's rows. Dates are not considered here —
 * `rowReadsOnLine` in `./lineReading` is the date-aware form (a shared row
 * dated after the fork is cut from the branch).
 */
export function onLine<T extends { branchId?: number | null }>(
	row: T,
	line: Line | number | null | undefined
): boolean {
	return stepOf(asLine(line), row.branchId) !== undefined
}

/** The rows of a list that the line being read can see. */
export function rowsOnLine<T extends { branchId?: number | null }>(
	rows: readonly T[],
	line: Line | number | null | undefined
): T[] {
	const l = asLine(line)
	return rows.filter((row) => stepOf(l, row.branchId) !== undefined)
}

/** One amendment to write: a date and the fields that begin at it. */
export interface PlannedAmendment {
	year: number
	month: number | null
	day: number | null
	fields: Record<string, unknown>
}

/**
 * "Off from D1 until D2", as the amendments that actually say it.
 *
 * An amendment sets a value **from a date forward**, so a window is two of
 * them: the field changes at the start and changes back at the end. The author
 * thinks in a period; the book only holds step changes; this is the one place
 * that translation happens, so the two save paths cannot disagree about it.
 *
 * ⚠ **`until` is exclusive, and that is the reading a period has.** "Off until
 * Y6" means Y6 is the day it is back — the entry reads OFF at every moment
 * before Y6 and ON at Y6 itself. Making it inclusive would need a "day after"
 * that the book's calendar does not define (a month has no length here).
 *
 * ⚠ No `until` is not an error: "off from Y3" is a perfectly good thing to say,
 * and it is one amendment. Only the closing one is conditional.
 *
 * ⚠ Nothing here writes. The caller files each of these with
 * `amendments:create`, so both halves land through the same door — and a window
 * whose halves were written by two different code paths could not be trusted to
 * resolve as one.
 */
export function offWindowAmendments(
	from: StoryDate,
	until?: StoryDate | null,
	field = "enabled"
): PlannedAmendment[] {
	const at = (d: StoryDate, value: boolean): PlannedAmendment => ({
		year: d.year,
		month: d.month ?? null,
		day: d.day ?? null,
		fields: { [field]: value }
	})
	const out = [at(from, false)]
	if (until) out.push(at(until, true))
	return out
}

/**
 * Why this window cannot be written, in a sentence, or null when it can.
 *
 * Returned rather than thrown: this answers a form on every keystroke, and the
 * sentence is what the button's title says while it is disabled.
 */
export function offWindowProblem(
	from: Partial<StoryDate> | null,
	until?: Partial<StoryDate> | null
): string | null {
	if (!from || !Number.isInteger(from.year))
		return "A window needs a date to start at."
	if (from.day != null && from.month == null)
		return "A day needs a month: the calendar narrows left to right."
	if (!until || until.year == null) return null
	if (!Number.isInteger(until.year))
		return "That end date is not a year the calendar can place."
	if (until.day != null && until.month == null)
		return "A day needs a month: the calendar narrows left to right."
	const order = compareDates(from as StoryDate, until as StoryDate)
	if (order === 0)
		return "It would switch off and back on at the same moment."
	if (order > 0) return "It would come back on before it went off."
	return null
}

/** How one row differs between a line and main. */
export interface LineDifference<T> {
	id: number
	/**
	 * `only` — the row exists on this line and nowhere else, so main has
	 * nothing to put beside it. `differs` — a SHARED row the two lines read
	 * differently.
	 */
	kind: "only" | "differs"
	/** The columns that read differently. Empty for an `only` row. */
	fields: string[]
	/** The row as main reads it, or null when main does not have it. */
	main: T | null
	/** The row as this line reads it. */
	line: T
}

/**
 * What this line has that main does not, and what the two read differently.
 *
 * The whole of "compare against main". Two readings of the same rows, put side
 * by side — never a merge, and there is deliberately no function here that
 * could become one. The design's sentence: *no merge, ever.*
 *
 * ⚠ **Main is read WITHOUT the fork cut, the line WITH it.** That is not a
 * detail: main is not cut off from itself, so `forkedAt` belongs only to the
 * line's reading. Passing it to both would compare a line against a main that
 * had been frozen at the fork, and every later change on main would vanish
 * from the comparison instead of showing up as a difference.
 *
 * ⚠ A row on a SIBLING line is not a difference, it is somebody else's story.
 * It is skipped, exactly as `rowsOnLine` skips it.
 */
export function compareLines<
	T extends { id: number; branchId?: number | null }
>(
	rows: readonly T[],
	overlaysFor: (id: number) => readonly Amendment[],
	branchId: number,
	at: Omit<AsOf, "branchId"> = {}
): LineDifference<T>[] {
	const line = at.line ?? lineFromFork(branchId, at.forkedAt ?? null)
	const out: LineDifference<T>[] = []
	for (const row of rows) {
		// A row on a line outside the chain is somebody else's story.
		if (!stepOf(line, row.branchId)) continue
		// On this line or an ancestor branch: main has nothing beside it.
		if (row.branchId != null) {
			out.push({
				id: row.id,
				kind: "only",
				fields: [],
				main: null,
				line: row
			})
			continue
		}
		const overlays = overlaysFor(row.id)
		if (!overlays.length) continue
		const main = applyAmendments(row, overlays, {
			moment: at.moment,
			line: MAIN_LINE
		})
		const lineRead = applyAmendments(row, overlays, {
			moment: at.moment,
			line
		})
		const fields = Object.keys(lineRead as Record<string, unknown>).filter(
			(key) =>
				!same(
					(lineRead as Record<string, unknown>)[key],
					(main as Record<string, unknown>)[key]
				)
		)
		if (fields.length)
			out.push({ id: row.id, kind: "differs", fields, main, line: lineRead })
	}
	return out
}
