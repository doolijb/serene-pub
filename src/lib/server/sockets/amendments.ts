/**
 * Dated overlays, over the wire.
 *
 * Ruled 2026-09-23; design of record
 * `~/.claude/plans/DESIGN-lore-amendments-branches.md`. An amendment says "from
 * this date, these fields read differently". Nothing here resolves anything —
 * resolution is `$lib/shared/lorebooks/amendments.ts`, called by both the
 * server's retrieval path and the workspace, so the two cannot disagree. This
 * file only stores and lists.
 *
 * ## One message per book, never per entry
 *
 * `amendments:list` answers with every overlay in the book. The pool resolves
 * every row it draws, so a call per entry would be a call per row in a list —
 * the cost the design names as "grouped client-side".
 *
 * ## Every write re-lists
 *
 * Create, update and delete all answer with the same shape as `list`. A partial
 * response would make the client merge two orderings of the same rows, and the
 * precedence these rows carry is the whole point of them.
 *
 * ⚠ **Ownership is checked on the BOOK, every time.** An amendment names an
 * entry id and a character id, and neither is a capability: without the book
 * check a crafted id would write an overlay onto somebody else's entry.
 */
import { and, eq, inArray } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import {
	compareDates,
	type StoryClock,
	type StoryDate
} from "$lib/shared/lorebooks/storyDate"
import {
	amendmentDateProblem,
	amendmentsForAppearance,
	castAsOf,
	NEVER_AMENDED,
	type AsOf
} from "$lib/shared/lorebooks/amendments"
import { appearancesOf } from "$lib/shared/lorebooks/presence"
import type { Handler } from "$lib/shared/events"
import { refusable } from "./refusable"
import {
	amendmentPatternLayers,
	assertDeclaredFields,
	assertNoRunawayPatterns,
	keysToArray,
	sweepLoreEntryRankings,
	touchesPatterns,
	withEverythingFiledUnder
} from "$lib/server/utils/lorebookEntries"
import type { KeyList } from "$lib/server/pipelines/ranking/signals"
import { verifyBindingTargetAccess } from "./lorebooks"
import { cardTakenBy, memberOfCard } from "$lib/server/utils/castMemberCards"
import type { NodeState, NodeVisibility } from "$lib/server/db/schema"
import { assertAnchorEntry, assertAnchorInBook } from "$lib/server/utils/anchorEntry"
import { foldRelationshipsUndatedBy } from "$lib/server/utils/relationshipGuards"
import {
	keepHistoryForForks,
	type KeptHistory
} from "$lib/server/utils/forkHistory"
import { relistEntries } from "./entries"
import { sceneListByLorebookHandler } from "./scenes"
import { narrativeGraphListHandler } from "./narrativeGraph"
import { lineOfBook } from "$lib/server/state/reading"
import {
	assertDateLands,
	bookCalendarOf,
	clockColumns,
	clockOf,
	clockProblem,
	lockBookCalendar
} from "$lib/server/state/storyTime"
import { deletePlaceStats } from "$lib/server/state/lorebookState"
import {
	clockPastDeleted,
	forkPastDeleted,
	forksThrough,
	survivingLineOf
} from "$lib/shared/lorebooks/lineReading"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { sessionEvents } from "@serene-pub/sdk"
import { broadcastToSessionUsers } from "./utils/broadcastHelpers"
import { broadcastSessionRow } from "$lib/server/sessions/rowPush"
import { assertOwnedBook } from "$lib/server/utils/ownedBook"
import { enqueueLorebookAnnotation } from "$lib/server/annotations/queue"
import { bookLinesReply } from "./lorebookStoryTime"

const iso = (d: Date | null | undefined) =>
	d instanceof Date ? d.toISOString() : new Date(0).toISOString()

/**
 * Everything overlaying one book, plus its branches.
 *
 * ⚠ Cast amendments belong to the book by construction: a cast member IS one
 * of its rows (`lorebook_bindings`), so there is no "true everywhere" case to
 * exclude. That was the `character_amendments` shape, retired 2026-09-23 —
 * amending a character CARD would have changed them in every book sharing it,
 * which is never what a dated change in one story means.
 */
export async function buildAmendmentsList(
	userId: number,
	lorebookId: number
): Promise<Sockets.Amendments.List.Response> {
	const book = await assertOwnedBook(db, userId, lorebookId)

	const [entries, cast, presences, branches] = await Promise.all([
		db
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.lorebookId, lorebookId)),
		db
			.select()
			.from(schema.castAmendments)
			.where(eq(schema.castAmendments.lorebookId, lorebookId)),
		db
			.select()
			.from(schema.castPresences)
			.where(eq(schema.castPresences.lorebookId, lorebookId)),
		db
			.select()
			.from(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.lorebookId, lorebookId))
	])

	return {
		lorebookId,
		entries: entries.map((a) => ({
			id: a.id,
			entryId: a.entryId,
			branchId: a.branchId ?? null,
			year: a.year,
			month: a.month ?? null,
			day: a.day ?? null,
			fields: (a.fields ?? {}) as Record<string, unknown>,
			historyEntryId: a.historyEntryId ?? null,
			createdAt: iso(a.createdAt),
			updatedAt: iso(a.updatedAt)
		})),
		cast: cast.map((a) => ({
			id: a.id,
			castId: a.lorebookBindingId,
			lorebookId: a.lorebookId,
			branchId: a.branchId ?? null,
			year: a.year,
			month: a.month ?? null,
			day: a.day ?? null,
			fields: (a.fields ?? {}) as Record<string, unknown>,
			historyEntryId: a.historyEntryId ?? null,
			// The personal axis: a change dated against her life applies
			// only to appearances at or past this point (design §4d).
			personalPosition: a.personalPosition ?? null,
			createdAt: iso(a.createdAt),
			updatedAt: iso(a.updatedAt)
		})),
		presences: presences.map((p) => ({
			id: p.id,
			castId: p.lorebookBindingId,
			branchId: p.branchId ?? null,
			personalPosition: p.personalPosition,
			fromYear: p.fromYear,
			fromMonth: p.fromMonth ?? null,
			fromDay: p.fromDay ?? null,
			untilYear: p.untilYear ?? null,
			untilMonth: p.untilMonth ?? null,
			untilDay: p.untilDay ?? null,
			note: p.note ?? null
		})),
		branches: branches.map((b) => ({
			id: b.id,
			lorebookId: b.lorebookId,
			name: b.name,
			forkedFromBranchId: b.forkedFromBranchId ?? null,
			forkYear: b.forkYear ?? null,
			forkMonth: b.forkMonth ?? null,
			forkDay: b.forkDay ?? null
		}))
	}
}

/**
 * The member a card seats, resolved at a reading, with each of their
 * **appearances** — for a session that holds the card.
 *
 * ⚠ **One resolver, two server entry points — never a third.** Agreed with
 * the sprites session 2026-09-24: a face, a prompt block and a widget must all
 * be looking at the same person. The resolver is the pure `castAsOf` (and
 * `appearancesOf`), the same one the workspace uses, so the server and the
 * screen cannot drift. Its two server entry points differ in what they are
 * handed, not in how they resolve:
 *
 * - **`cardMemberAt`** (this) — keyed on a CARD, reads its own overlays and
 *   the member's presences, and answers every appearance, each at its own
 *   point of their life. For a reader that DRAWS one seated person (sprites).
 * - **`castMemberAt`** (`state/entriesOnReading.ts`) — handed a member row and
 *   the book's overlays already read (`castOverlaysFor`), synchronous, at no
 *   particular point of their life. For readers that resolve the whole cast
 *   at once (prompt, state, graph context).
 *
 * Renamed from `castMemberAsOf` (2026-10-02): the old docstring promised the
 * ONE server path while `castMemberAt` was a second; the names now say which
 * question each answers.
 *
 * ⚠ Keyed on the CARD, not on the member, because that is what a session holds
 * (`session_characters.character_id`). It is design §4bb's cascade, read
 * server-side: a book with a member for that card answers with the
 * member; a book without one, or no book at all, is not this function's
 * business — it answers null and the caller falls back to the card. Any card
 * of the member's finds them — the one they are linked to, or one a dated
 * change draws them with (`memberOfCard`, plan A25) — so a session seating
 * the keeper's card is seating the same person as one seating the novice's.
 *
 * ⚠ Returns **appearances**, plural. A member placed twice at one moment is
 * two people, and a caller that takes `[0]` will silently show one of them.
 */
export async function cardMemberAt(
	dbOrTx: Db,
	params: {
		lorebookId: number
		characterId: number
		/**
		 * The line and moment — `AsOf`, so a caller holding a session's
		 * reading passes its `line` (ancestor chain and every fork cut) and
		 * the resolver and the presences cut the same way (finding #39).
		 */
		at?: AsOf
	}
): Promise<{
	member: Record<string, unknown>
	appearances: {
		personalPosition: number | null
		member: Record<string, unknown>
	}[]
} | null> {
	const at = params.at ?? {}
	const memberId = await memberOfCard(
		dbOrTx,
		params.lorebookId,
		params.characterId
	)
	if (memberId == null) return null
	const member = await dbOrTx.query.lorebookBindings.findFirst({
		where: (m, { eq: q }) => q(m.id, memberId)
	})
	if (!member) return null

	const [overlays, presenceRows] = await Promise.all([
		dbOrTx
			.select()
			.from(schema.castAmendments)
			.where(eq(schema.castAmendments.lorebookBindingId, member.id)),
		dbOrTx
			.select()
			.from(schema.castPresences)
			.where(eq(schema.castPresences.lorebookBindingId, member.id))
	])

	// The personal position rides along so an appearance can narrow by it.
	const amendments = overlays.map((a) => ({
		id: a.id,
		branchId: a.branchId ?? null,
		year: a.year,
		month: a.month ?? null,
		day: a.day ?? null,
		fields: (a.fields ?? {}) as Record<string, unknown>,
		personalPosition: a.personalPosition ?? null
	}))
	const presences = presenceRows.map((p) => ({
		id: p.id,
		castId: p.lorebookBindingId,
		branchId: p.branchId ?? null,
		personalPosition: p.personalPosition,
		fromYear: p.fromYear,
		fromMonth: p.fromMonth ?? null,
		fromDay: p.fromDay ?? null,
		untilYear: p.untilYear ?? null,
		untilMonth: p.untilMonth ?? null,
		untilDay: p.untilDay ?? null
	}))

	// The member as the line reads them, before any one appearance narrows it.
	const resolved = castAsOf(member as Record<string, unknown>, amendments, at)
	const here = appearancesOf(member.id, presences, at)

	return {
		member: resolved,
		appearances: here.map((a) => ({
			personalPosition: a.personalPosition,
			// ⚠ An appearance resolves AGAIN at its own point of her life: two
			// of her at one world moment may legitimately read differently,
			// which is why this returns a list.
			member:
				a.personalPosition == null
					? resolved
					: castAsOf(
							member as Record<string, unknown>,
							// World-dated overlays apply to every appearance;
							// personally-dated ones only up to this point of
							// her life. That is what lets the fifty-year-old
							// and the thirty-four-year-old read differently at
							// one world moment. The workspace's roster calls
							// the same helper.
							amendmentsForAppearance(amendments, a.personalPosition),
							at
						)
		}))
	}
}

/**
 * A date the calendar can order: its parts read as numbers.
 *
 * ⚠ The CHECK constraint refuses a day with no month, but it cannot refuse a
 * year that is not a number — an amendment IS a date, so a malformed one is
 * refused here rather than stored as a row nothing can place. Everything past
 * "is it a number" — ranges, a day needs a month, the book's calendar — is
 * `assertDateLands`, which every caller runs next: one rule and one sentence
 * for every dated writer (`storyTimeProblem`), not a copy of it here.
 */
function assertDate(params: {
	year?: unknown
	month?: unknown
	day?: unknown
}): { year: number; month: number | null; day: number | null } {
	const year = Number(params.year)
	if (!Number.isInteger(year))
		throw new Error("An amendment needs a year: it is a dated change.")
	const month =
		params.month == null || params.month === ""
			? null
			: Number(params.month)
	const day =
		params.day == null || params.day === "" ? null : Number(params.day)
	if (month != null && !Number.isInteger(month))
		throw new Error("That month is not a number.")
	if (day != null && !Number.isInteger(day))
		throw new Error("That day is not a number.")
	return { year, month, day }
}

/** The entry an overlay amends, and the line its amendment is on. */
interface EntrySubject {
	kind: "entry"
	typeId: string
	lorebookId: number
	entryId: number
	/** The amendment's branch, else the entry's own (null = shared). */
	line: number | null
	/** On an update, the amendment being rewritten — not one more beside it. */
	amendmentId?: number
}

/** The member a cast amendment is about, for the card check. */
interface CastSubject {
	kind: "cast"
	lorebookId: number
	memberId: number
}

/**
 * What a cast amendment may set (plan A25): what a member has to say at a
 * date — name, other names, summary, state, visibility, the card that draws
 * them and its sprite set. The rest of the row is identity (`binding`), the
 * graph's bookkeeping (`parentNodeId`, `sceneId`, `historyEntryId`), a
 * merge's record (`absorbedAliases`) or the vector's, and none of it can read
 * one way at Y10 and another at Y20. Dropped like `NEVER_AMENDED`: the member
 * form never sends them.
 */
export const CAST_AMENDABLE: ReadonlySet<string> = new Set([
	"name",
	"aliases",
	"summary",
	"nodeState",
	"nodeVisibility",
	"characterId",
	"spriteSet"
])

const CAST_STATES = {
	active: true,
	deceased: true,
	missing: true,
	departed: true
} satisfies Record<NodeState, true>

const CAST_VISIBILITIES = {
	normal: true,
	legendary: true,
	hidden: true
} satisfies Record<NodeVisibility, true>

const isTextOrNull = (v: unknown) => v === null || typeof v === "string"

/** A card id as a client may send it — a whole number above zero, or its digits. */
function cardIdOf(value: unknown): number | null {
	const n =
		typeof value === "number"
			? value
			: typeof value === "string" && /^\d+$/.test(value)
				? Number(value)
				: NaN
	return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * A cast overlay's fields, kept to `CAST_AMENDABLE` and refused, in words,
 * when one says something a member cannot be — a value is checked as itself,
 * never coerced into one (a list is not a state). A card must be one the
 * caller could link; `null` unlinks the card from that date. Whether another
 * member already has the card is asked under the book's lock, where the row
 * is written (`assertCardFree`).
 *
 * An overlay left with nothing to say is refused: it would list as a change
 * that changes nothing.
 */
async function cleanCastFields(
	fields: Record<string, unknown>,
	userId: number
): Promise<Record<string, unknown>> {
	for (const [key, value] of Object.entries(fields))
		if (!CAST_AMENDABLE.has(key) || value === undefined) delete fields[key]
	if ("name" in fields && typeof fields.name !== "string")
		throw new Error("A cast member's name is text.")
	if (
		"aliases" in fields &&
		!(
			Array.isArray(fields.aliases) &&
			fields.aliases.every((a) => typeof a === "string")
		)
	)
		throw new Error("A cast member's other names are a list of names.")
	if ("summary" in fields && !isTextOrNull(fields.summary))
		throw new Error("A cast member's summary is text.")
	if (
		"nodeState" in fields &&
		!(
			typeof fields.nodeState === "string" &&
			Object.hasOwn(CAST_STATES, fields.nodeState)
		)
	)
		throw new Error("That is not a state a cast member can be in.")
	if (
		"nodeVisibility" in fields &&
		!(
			typeof fields.nodeVisibility === "string" &&
			Object.hasOwn(CAST_VISIBILITIES, fields.nodeVisibility)
		)
	)
		throw new Error("That is not a visibility a cast member can have.")
	if ("spriteSet" in fields && !isTextOrNull(fields.spriteSet))
		throw new Error("A sprite set is named in text.")
	if ("characterId" in fields && fields.characterId !== null) {
		const characterId = cardIdOf(fields.characterId)
		if (
			characterId == null ||
			!(await verifyBindingTargetAccess({ characterId }, userId))
		)
			throw new Error("That card is not one this cast member can be drawn with.")
		fields.characterId = characterId
	}
	if (!Object.keys(fields).length)
		throw new Error(
			"That change sets nothing a cast member can have at a date: their name, other names, summary, state, visibility, card or sprite set."
		)
	return fields
}

/**
 * Refuses a card another member of the book already has — linked, or drawn
 * with from a date — since a card is one member's (plan A25). Called on the
 * write's transaction after the book's lock (`lockBookCalendar`), the lock
 * every cast writer takes, so two tabs cannot both give one card away.
 */
async function assertCardFree(
	tx: Db,
	subject: CastSubject,
	fields: Record<string, unknown>
): Promise<void> {
	if (typeof fields.characterId !== "number") return
	const holder = await cardTakenBy(
		tx,
		subject.lorebookId,
		fields.characterId,
		subject.memberId
	)
	if (holder)
		throw new Error(
			`${holder.name} already has that card in this lorebook, and a card draws one cast member.`
		)
}

/**
 * An amendment's `fields`, as the server stores them.
 *
 * ⚠ Identity and bookkeeping columns (`NEVER_AMENDED`: id, book, type, branch,
 * position, timestamps) are DROPPED, matching `changedFields` on the client —
 * an overlay that re-pointed `branchId` or `lorebookId` would make a row read
 * as another line's or another book's at one date. An entry overlay naming a
 * date part (`ENTRY_DATE_PARTS`, also `NEVER_AMENDED`) is REFUSED: re-dating
 * is editing the entry (A18(b)). A cast overlay keeps only
 * `CAST_AMENDABLE` (`cleanCastFields`); an entry overlay's declared fields
 * must be their declared type.
 *
 * An entry overlay's `anchorEntryId` — a dated re-parent, "Save as of" on
 * Part of — goes through `assertAnchorEntry`, exactly as `entries:update`'s
 * does and under the same book lock (`assertOverlayAnchor`, run by the
 * caller on its write's transaction; here it is only read as an id), for
 * every entry type (plan B0, places-graph 2026-09-29). Unchecked, a
 * dated overlay could file an entry under its own child, under itself, or
 * under another user's entry at one date. The overlay is read on the
 * amendment's line (else the entry's), so its parent may be anything that
 * line reads — its own rows, an ancestor fork's, or shared ones — and never
 * a sibling fork's. Its `lorebookBindingId` — the other anchor — must name a
 * member of this book, as `entries:update` requires.
 */
async function cleanFields(
	raw: unknown,
	subject: EntrySubject | CastSubject,
	userId: number
): Promise<Record<string, unknown>> {
	const fields: Record<string, unknown> = {}
	if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		// A date is the entry's, never an amendment's (A18(b)): refused in a
		// sentence rather than dropped, since a re-date dropped silently is an
		// edit the author believes they made.
		const dated =
			subject.kind === "entry" ? amendmentDateProblem(raw as Record<string, unknown>) : null
		if (dated) throw new Error(dated)
		for (const [key, value] of Object.entries(raw as Record<string, unknown>))
			if (!NEVER_AMENDED.has(key)) fields[key] = value
	}
	if (subject.kind === "entry") {
		// Keys are stored as the list the column holds (finding #146): a list
		// is kept element for element, so a regex `\w{2,4}` stays one key; only
		// a legacy comma string is split, once, here at the boundary.
		for (const key of ["keys", "secondaryKeys"] as const)
			if (key in fields) fields[key] = keysToArray(fields[key] as KeyList)
		assertDeclaredFields(subject.typeId, fields)
		// An overlay's keys run as the entry's keys at its date, so a runaway
		// pattern is refused here as `entries:update` refuses it (plan S3) —
		// judged against the entry AND its other amendments, since the mode
		// one date reads can come from one overlay and its keys from another.
		if (touchesPatterns(fields)) {
			const others = await amendmentPatternLayers(db, subject.entryId)
			const replaces =
				subject.amendmentId != null ? (others.get(subject.amendmentId) ?? null) : null
			if (subject.amendmentId != null) others.delete(subject.amendmentId)
			assertNoRunawayPatterns(
				fields,
				(await db.query.lorebookEntries.findFirst({
					where: (e, { eq: q }) => q(e.id, subject.entryId),
					columns: {
						keys: true,
						secondaryKeys: true,
						matchMode: true,
						useRegex: true
					}
				})) ?? null,
				{ overlays: [...others.values()], overlay: { replaces } }
			)
		}
		if ("anchorEntryId" in fields && fields.anchorEntryId != null) {
			const anchorEntryId = Number(fields.anchorEntryId)
			if (!Number.isInteger(anchorEntryId))
				throw new Error("That parent is not an entry of this lorebook.")
			// Its place in the tree is checked on the write's transaction,
			// under the book's lock (`assertOverlayAnchor`).
			fields.anchorEntryId = anchorEntryId
		}
		if ("lorebookBindingId" in fields && fields.lorebookBindingId != null) {
			const bindingId = Number(fields.lorebookBindingId)
			if (!Number.isInteger(bindingId))
				throw new Error("That cast member is not in this lorebook.")
			await assertAnchorInBook(bindingId, subject.lorebookId)
			fields.lorebookBindingId = bindingId
		}
	} else return cleanCastFields(fields, userId)
	return fields
}

/**
 * A dated re-parent's parent, checked as `entries:update` checks a stored one
 * (`assertAnchorEntry`, read on the overlay's line) — and, like it, on the
 * write's transaction after the book's lock (`lockBookCalendar`). The lock is
 * what stops two re-parents closing a cycle: each walk passes alone, and run
 * apart from the write, two of them (dated or not) could each pass and
 * together file an entry under its own child. A no-op for a cast overlay or
 * one that does not re-parent.
 */
async function assertOverlayAnchor(
	tx: Db,
	subject: EntrySubject | CastSubject | null,
	fields: Record<string, unknown> | undefined
): Promise<void> {
	if (subject?.kind !== "entry" || fields?.anchorEntryId == null) return
	await assertAnchorEntry(
		fields.anchorEntryId as number,
		subject.lorebookId,
		subject.entryId,
		subject.line,
		subject.typeId,
		tx,
		await lineOfBook(tx, subject.lorebookId, subject.line)
	)
}

/** The event an amendment hangs from must be a history entry of this book. */
async function assertHistoryEvent(
	historyEntryId: number | null | undefined,
	lorebookId: number
): Promise<number | null> {
	if (historyEntryId == null) return null
	const event = await db.query.lorebookEntries.findFirst({
		where: (e, { and: a, eq: q }) =>
			a(q(e.id, historyEntryId), q(e.lorebookId, lorebookId)),
		columns: { id: true, typeId: true }
	})
	if (!event || event.typeId !== HISTORY_TYPE_ID)
		throw new Error("That event is not in this lorebook.")
	return event.id
}

/** A point in a member's own life: a whole number, or none. */
function assertPersonalPosition(raw: unknown): number | null {
	if (raw == null) return null
	const position = Number(raw)
	if (!Number.isInteger(position))
		throw new Error(
			"A point in their life is a number you count in: a whole number."
		)
	return position
}

/** A branch, only if it belongs to this book. */
async function assertBranch(
	branchId: number | null | undefined,
	lorebookId: number
): Promise<number | null> {
	if (branchId == null) return null
	const branch = await db.query.lorebookBranches.findFirst({
		where: (b, { and: a, eq: e }) =>
			a(e(b.id, branchId), e(b.lorebookId, lorebookId)),
		columns: { id: true }
	})
	if (!branch) throw new Error("That branch is not a line of this book.")
	return branch.id
}

export const amendmentsListHandler: Handler<
	Sockets.Amendments.List.Params,
	Sockets.Amendments.List.Response
> = refusable(
	"amendments:list",
	async (socket, params: Sockets.Amendments.List.Params, emitToUser) => {
		const res = await buildAmendmentsList(
			socket.user!.id,
			params.lorebookId
		)
		emitToUser("amendments:list", res)
		return res
	},
	"The book's amendments could not be read."
)

export const amendmentsCreateHandler: Handler<
	Sockets.Amendments.Create.Params,
	Sockets.Amendments.Create.Response
> = refusable(
	"amendments:create",
	async (socket, params: Sockets.Amendments.Create.Params, emitToUser) => {
		const userId = socket.user!.id
		const book = await assertOwnedBook(db, userId, params.lorebookId)

		const { year, month, day } = assertDate(params)
		/**
		 * The row, written with its date validated against the book's
		 * calendar, when it declares one (DESIGN-story-time §0), so the
		 * preflight list cannot refill — in one transaction under the book's
		 * lock (`lockBookCalendar`, A18(d)), so a calendar is never declared
		 * between the check and the row.
		 */
		const writeDated = (insert: (tx: Db) => Promise<unknown>) =>
			db.transaction(async (tx) => {
				await lockBookCalendar(tx, params.lorebookId)
				await assertDateLands(tx, params.lorebookId, { year, month, day })
				await insert(tx)
			})
		const branchId = await assertBranch(params.branchId, params.lorebookId)
		const historyEntryId = await assertHistoryEvent(
			params.historyEntryId,
			params.lorebookId
		)

		// Exactly one subject. Both, or neither, is a row no reader could place.
		const hasEntry = params.entryId != null
		const hasCast = params.castId != null
		if (hasEntry === hasCast)
			throw new Error(
				"An amendment is about one entry or one cast member, not both."
			)

		if (hasEntry) {
			// ⚠ The entry must be IN this book. Without it a crafted id writes
			// an overlay onto an entry the caller does not own.
			const entry = await db.query.lorebookEntries.findFirst({
				where: (e, { and: a, eq: q }) =>
					a(
						q(e.id, params.entryId!),
						q(e.lorebookId, params.lorebookId)
					),
				columns: { id: true, typeId: true, branchId: true }
			})
			if (!entry) throw new Error("That entry is not in this lorebook.")
			const subject: EntrySubject = {
				kind: "entry",
				typeId: entry.typeId,
				lorebookId: params.lorebookId,
				entryId: entry.id,
				line: branchId ?? entry.branchId ?? null
			}
			const fields = await cleanFields(params.fields, subject, userId)
			await writeDated(async (tx) => {
				await assertOverlayAnchor(tx, subject, fields)
				await tx.insert(schema.entryAmendments).values({
					lorebookId: params.lorebookId,
					entryId: entry.id,
					branchId,
					year,
					month,
					day,
					fields,
					historyEntryId
				})
			})
		} else {
			// ⚠ The member must be IN this book, exactly as an entry must be.
			// A cast member is a row OF the book, so the ownership check the
			// handler already passed is the whole gate — there is no second
			// owner to consult, which is what amending a shared card would
			// have needed.
			const member = await db.query.lorebookBindings.findFirst({
				where: (m, { and: a, eq: q }) =>
					a(
						q(m.id, params.castId!),
						q(m.lorebookId, params.lorebookId)
					),
				columns: { id: true }
			})
			if (!member)
				throw new Error("That cast member is not in this lorebook.")
			const subject: CastSubject = {
				kind: "cast",
				lorebookId: params.lorebookId,
				memberId: member.id
			}
			const personalPosition = assertPersonalPosition(params.personalPosition)
			const fields = await cleanFields(params.fields, subject, userId)
			await writeDated(async (tx) => {
				await assertCardFree(tx, subject, fields)
				await tx.insert(schema.castAmendments).values({
					lorebookBindingId: member.id,
					lorebookId: params.lorebookId,
					// The personal axis, when the author dated it against her
					// life rather than against the world (design §4d).
					personalPosition,
					branchId,
					year,
					month,
					day,
					fields,
					historyEntryId
				})
			})
		}

		// The book's vocabulary reads amended names (plan C1): an amendment
		// written, moved or gone re-annotates whatever its names change.
		enqueueLorebookAnnotation(book.id, book.name)
		const res = await buildAmendmentsList(userId, params.lorebookId)
		emitToUser("amendments:list", res)
		return res
	},
	"That amendment could not be saved."
)

export const amendmentsUpdateHandler: Handler<
	Sockets.Amendments.Update.Params,
	Sockets.Amendments.Update.Response
> = refusable(
	"amendments:update",
	async (socket, params: Sockets.Amendments.Update.Params, emitToUser) => {
		const userId = socket.user!.id
		const book = await assertOwnedBook(db, userId, params.lorebookId)

		// ⚠ Scoped by lorebook as well as id: the id alone would let one book's
		// amendment be edited from another book's screen.
		const table =
			params.subject === "entry"
				? schema.entryAmendments
				: schema.castAmendments
		const [stored] = await db
			.select({
				year: table.year,
				month: table.month,
				day: table.day
			})
			.from(table)
			.where(and(eq(table.id, params.id), eq(table.lorebookId, params.lorebookId)))
			.limit(1)
		if (!stored) throw new Error("That amendment is not in this lorebook.")

		const patch: Record<string, unknown> = {}
		// A re-date is merged over the stored date, part by part: a year-only
		// patch keeps the month and day it had, a month-only patch keeps the
		// year. Clearing the month clears the day with it — the calendar
		// narrows left to right, so a day cannot outlive its month.
		if (
			params.year !== undefined ||
			params.month !== undefined ||
			params.day !== undefined
		) {
			const month = params.month !== undefined ? params.month : stored.month
			const day =
				params.day !== undefined
					? params.day
					: params.month === null
						? null
						: stored.day
			Object.assign(
				patch,
				assertDate({ year: params.year ?? stored.year, month, day })
			)
		}
		let subject: EntrySubject | CastSubject | null = null
		if (params.fields !== undefined) {
			if (params.subject !== "entry") {
				const [cast] = await db
					.select({ memberId: schema.castAmendments.lorebookBindingId })
					.from(schema.castAmendments)
					.where(eq(schema.castAmendments.id, params.id))
					.limit(1)
				if (!cast) throw new Error("That amendment is not in this lorebook.")
				subject = {
					kind: "cast",
					lorebookId: params.lorebookId,
					memberId: cast.memberId
				}
			} else {
				const [row] = await db
					.select({
						typeId: schema.lorebookEntries.typeId,
						entryId: schema.entryAmendments.entryId,
						amendmentBranchId: schema.entryAmendments.branchId,
						entryBranchId: schema.lorebookEntries.branchId
					})
					.from(schema.entryAmendments)
					.innerJoin(
						schema.lorebookEntries,
						eq(schema.lorebookEntries.id, schema.entryAmendments.entryId)
					)
					.where(eq(schema.entryAmendments.id, params.id))
					.limit(1)
				if (!row) throw new Error("That amendment is not in this lorebook.")
				subject = {
					kind: "entry",
					typeId: row.typeId,
					lorebookId: params.lorebookId,
					entryId: row.entryId,
					line: row.amendmentBranchId ?? row.entryBranchId ?? null,
					amendmentId: params.id
				}
			}
			patch.fields = await cleanFields(params.fields, subject, userId)
		}
		if (!Object.keys(patch).length) throw new Error("Nothing to change.")

		// A re-date is checked against the book's calendar and written in one
		// transaction under the book's lock (`lockBookCalendar`, A18(d)).
		await db.transaction(async (tx) => {
			await lockBookCalendar(tx, params.lorebookId)
			if ("year" in patch)
				await assertDateLands(tx, params.lorebookId, patch as unknown as StoryDate)
			if (subject?.kind === "cast")
				await assertCardFree(tx, subject, patch.fields as Record<string, unknown>)
			await assertOverlayAnchor(
				tx,
				subject,
				patch.fields as Record<string, unknown> | undefined
			)
			await tx
				.update(table)
				.set(patch)
				.where(and(eq(table.id, params.id), eq(table.lorebookId, params.lorebookId)))
		})

		// The book's vocabulary reads amended names (plan C1): an amendment
		// written, moved or gone re-annotates whatever its names change.
		enqueueLorebookAnnotation(book.id, book.name)
		const res = await buildAmendmentsList(userId, params.lorebookId)
		emitToUser("amendments:list", res)
		return res
	},
	"That amendment could not be saved."
)

export const amendmentsDeleteHandler: Handler<
	Sockets.Amendments.Delete.Params,
	Sockets.Amendments.Delete.Response
> = refusable(
	"amendments:delete",
	async (socket, params: Sockets.Amendments.Delete.Params, emitToUser) => {
		const userId = socket.user!.id
		const book = await assertOwnedBook(db, userId, params.lorebookId)

		const table =
			params.subject === "entry"
				? schema.entryAmendments
				: schema.castAmendments
		const gone = await db
			.delete(table)
			.where(and(eq(table.id, params.id), eq(table.lorebookId, params.lorebookId)))
			.returning({ id: table.id })
		// A delete that found nothing is not a success: an id from another
		// book, or one already gone.
		if (!gone.length) throw new Error("That amendment is not in this lorebook.")

		// The book's vocabulary reads amended names (plan C1): an amendment
		// written, moved or gone re-annotates whatever its names change.
		enqueueLorebookAnnotation(book.id, book.name)
		const res = await buildAmendmentsList(userId, params.lorebookId)
		emitToUser("amendments:list", res)
		return res
	},
	"That amendment could not be deleted."
)

/**
 * A branch name the book can hold.
 *
 * ⚠ `main` is refused here as well as by the CHECK constraint. The constraint
 * is what makes it impossible; this is what makes it a sentence the author can
 * read instead of a database error.
 */
function assertBranchName(raw: unknown): string {
	const name = typeof raw === "string" ? raw.trim() : ""
	if (!name) throw new Error("A branch needs a name.")
	if (name.toLowerCase() === "main")
		throw new Error(
			"main is the line every book already has; a fork needs its own name."
		)
	if (name.length > 60) throw new Error("That name is too long.")
	return name
}

export const amendmentsForkHandler: Handler<
	Sockets.Amendments.Fork.Params,
	Sockets.Amendments.Fork.Response
> = refusable(
	"amendments:fork",
	async (socket, params: Sockets.Amendments.Fork.Params, emitToUser) => {
		const userId = socket.user!.id
		const book = await assertOwnedBook(db, userId, params.lorebookId)

		const name = assertBranchName(params.name)
		// The line being left must be one of this book's, or main.
		const from = await assertBranch(
			params.forkedFromBranchId,
			params.lorebookId
		)

		const clash = await db.query.lorebookBranches.findFirst({
			where: (b, { and: a, eq: e }) =>
				a(e(b.lorebookId, params.lorebookId), e(b.name, name)),
			columns: { id: true }
		})
		if (clash)
			throw new Error(`This book already has a line called ${name}.`)

		// A fork date is optional, but a partial one still has to be a date.
		const dated =
			params.forkYear == null
				? { year: null, month: null, day: null }
				: assertDate({
						year: params.forkYear,
						month: params.forkMonth,
						day: params.forkDay
					})

		// Checked and written under the book's lock (`lockBookCalendar`,
		// A18(d)), as every dated write is.
		await db.transaction(async (tx) => {
			await lockBookCalendar(tx, params.lorebookId)
			if (dated.year != null)
				await assertDateLands(tx, params.lorebookId, dated as StoryDate, "The fork date")
			await tx.insert(schema.lorebookBranches).values({
				lorebookId: params.lorebookId,
				name,
				forkedFromBranchId: from,
				forkYear: dated.year,
				forkMonth: dated.month,
				forkDay: dated.day
			})
		})

		// The book's vocabulary reads amended names (plan C1): an amendment
		// written, moved or gone re-annotates whatever its names change.
		enqueueLorebookAnnotation(book.id, book.name)
		const res = await buildAmendmentsList(userId, params.lorebookId)
		emitToUser("amendments:list", res)
		// A new line: the lines read re-sent too (plan B6). LAZY, like every
		// cascade — built only for a tab holding the book's key.
		await emitToUser("lorebooks:lines", () => bookLinesReply(params.lorebookId))
		return res
	},
	"The new line could not be started."
)

export const amendmentsRenameBranchHandler: Handler<
	Sockets.Amendments.RenameBranch.Params,
	Sockets.Amendments.RenameBranch.Response
> = refusable(
	"amendments:renameBranch",
	async (socket, params: Sockets.Amendments.RenameBranch.Params, emitToUser) => {
		const userId = socket.user!.id
		const book = await assertOwnedBook(db, userId, params.lorebookId)
		const name = assertBranchName(params.name)
		await assertBranch(params.id, params.lorebookId)

		const clash = await db.query.lorebookBranches.findFirst({
			where: (b, { and: a, eq: e, ne: n }) =>
				a(
					e(b.lorebookId, params.lorebookId),
					e(b.name, name),
					n(b.id, params.id)
				),
			columns: { id: true }
		})
		if (clash)
			throw new Error(`This book already has a line called ${name}.`)

		await db
			.update(schema.lorebookBranches)
			.set({ name })
			.where(
				and(
					eq(schema.lorebookBranches.id, params.id),
					eq(schema.lorebookBranches.lorebookId, params.lorebookId)
				)
			)

		const res = await buildAmendmentsList(userId, params.lorebookId)
		emitToUser("amendments:list", res)
		await emitToUser("lorebooks:lines", () => bookLinesReply(params.lorebookId))
		return res
	},
	"The line could not be renamed."
)

export const amendmentsDeleteBranchHandler: Handler<
	Sockets.Amendments.DeleteBranch.Params,
	Sockets.Amendments.DeleteBranch.Response
> = refusable(
	"amendments:deleteBranch",
	async (socket, params: Sockets.Amendments.DeleteBranch.Params, emitToUser) => {
		const userId = socket.user!.id
		const book = await assertOwnedBook(db, userId, params.lorebookId)
		await assertBranch(params.id, params.lorebookId)

		// ⚠ The line's OWN rows go with it, by cascade: its amendments, the
		// entries written on it, its scenes, its edges, its placements and
		// its recorded stats. Shared rows have a NULL `branch_id` and are
		// untouched. The places written on it take their stats from every
		// line and session with them (`deletePlaceStats`): an owner id has no
		// key to cascade on.
		//
		// Sessions played on it move to the line it left (`survivingLineOf`:
		// main, when it left main). A stored clock stays where the new line
		// reads what the session read — at or before this line's fork date
		// — and goes back to that date when it was past it
		// (`clockPastDeleted`): past it, the parent holds history this line
		// never had. A clock the calendar cannot place is cleared, and the
		// session follows its new line's present, as a session with no clock
		// does. The column's `set null` is only the backstop.
		//
		// Every line forked FROM it moves past it first (`forkPastDeleted`):
		// it now leaves from the deleted line's parent at the earlier of the
		// two fork dates, so it reads what it read before, less the deleted
		// line's own rows. The column's `set null` alone would turn a fork of
		// a fork into a fork of main at its own date — main rows that were
		// never its past, and no grandparent at all.
		//
		// Except the history entries a fork's own rows point at — its stats
		// and links are dated by them, its scenes filed under them: those
		// stay, as the fork's own (`keepHistoryForForks`), so a fork's rows
		// keep their dates and its scenes.
		//
		// A link on any other line (main, say) may still be dated by a
		// history entry written on this one; the cascade un-dates it
		// (`set null`), and a link standing twice would fail the delete — so
		// those fold first, in the delete's transaction.
		const { movedSessions, rereadSessions, kept } = await db.transaction(
			async (tx) => {
				// Locked, so no fork can leave one of these lines mid-delete.
				const lines = await tx
					.select({
						id: schema.lorebookBranches.id,
						forkedFromBranchId: schema.lorebookBranches.forkedFromBranchId,
						forkYear: schema.lorebookBranches.forkYear,
						forkMonth: schema.lorebookBranches.forkMonth,
						forkDay: schema.lorebookBranches.forkDay
					})
					.from(schema.lorebookBranches)
					.where(eq(schema.lorebookBranches.lorebookId, params.lorebookId))
					.for("update")
				const deleted = lines.find((b) => b.id === params.id)
				if (!deleted) throw new Error("That branch is not a line of this book.")
				// Every line whose chain runs through this one: children, theirs.
				const through = [...forksThrough(params.id, lines).values()].flat()

				// The sessions, asked BEFORE they move: after it nothing can say
				// who moved (#136).
				const moved = await tx
					.select({
						id: schema.sessions.id,
						storyClockYear: schema.sessions.storyClockYear,
						storyClockMonth: schema.sessions.storyClockMonth,
						storyClockDay: schema.sessions.storyClockDay,
						storyClockHour: schema.sessions.storyClockHour,
						storyClockMinute: schema.sessions.storyClockMinute
					})
					.from(schema.sessions)
					.where(eq(schema.sessions.lorebookBranchId, params.id))
				const reread = through.length
					? await tx
							.select({ id: schema.sessions.id })
							.from(schema.sessions)
							.where(inArray(schema.sessions.lorebookBranchId, through))
					: []

				// Read against the lines as they stand, before any moves.
				const kept = await keepHistoryForForks(
					tx,
					params.lorebookId,
					params.id,
					lines
				)
				for (const child of lines)
					if (child.forkedFromBranchId === params.id && child.id !== params.id)
						await tx
							.update(schema.lorebookBranches)
							.set(forkPastDeleted(child, deleted))
							.where(eq(schema.lorebookBranches.id, child.id))

				const movedTo = survivingLineOf(
					params.id,
					lines,
					lines.filter((b) => b.id !== params.id)
				)
				const calendar = moved.length
					? await bookCalendarOf(tx, params.lorebookId)
					: null
				/** Session → the clock it moves with (null: cleared), for the ones that change. */
				const clockMoved = new Map<number, StoryClock | null>()
				for (const s of moved) {
					const clock = clockOf(s)
					if (clock === null) continue
					const kept = clockPastDeleted(clock, deleted)
					if (clockProblem(clock, calendar) !== null) clockMoved.set(s.id, null)
					else if (kept !== clock)
						clockMoved.set(s.id, clockProblem(kept, calendar) === null ? kept : null)
				}
				if (moved.length)
					await tx
						.update(schema.sessions)
						.set({ lorebookBranchId: movedTo })
						.where(eq(schema.sessions.lorebookBranchId, params.id))
				for (const [sessionId, clock] of clockMoved)
					await tx
						.update(schema.sessions)
						.set(clockColumns(clock))
						.where(eq(schema.sessions.id, sessionId))

				// Read after the forks kept their history entries: what is
				// still on the line now is what goes with it.
				const onLine = await tx
					.select({ id: schema.lorebookEntries.id })
					.from(schema.lorebookEntries)
					.where(eq(schema.lorebookEntries.branchId, params.id))
				const goneWithLine = await withEverythingFiledUnder(
					tx,
					onLine.map((e) => e.id)
				)
				await deletePlaceStats(tx, goneWithLine)
				// Their ranking evidence too: no foreign key to cascade on.
				await sweepLoreEntryRankings(tx, goneWithLine)
				await foldRelationshipsUndatedBy(
					tx,
					eq(schema.lorebookEntries.branchId, params.id)
				)
				await tx
					.delete(schema.lorebookBranches)
					.where(
						and(
							eq(schema.lorebookBranches.id, params.id),
							eq(schema.lorebookBranches.lorebookId, params.lorebookId)
						)
					)
				return {
					movedSessions: moved.map((s) => ({
						id: s.id,
						clockMoved: clockMoved.has(s.id)
					})),
					rereadSessions: reread.map((s) => s.id),
					kept
				}
			}
		)

		// The book's vocabulary reads amended names (plan C1): an amendment
		// written, moved or gone re-annotates whatever its names change.
		enqueueLorebookAnnotation(book.id, book.name)
		const res = await buildAmendmentsList(userId, params.lorebookId)
		emitToUser("amendments:list", res)
		await emitToUser("lorebooks:lines", () => bookLinesReply(params.lorebookId))
		await relistKeptHistory(socket, params.lorebookId, kept, emitToUser)
		const io = (socket as any).io
		await announceSessionsMoved(io, movedSessions, userId)
		await announceReadingMoved(io, rereadSessions)
		return res
	},
	"The line could not be deleted."
)

/**
 * The book's lists, re-sent after a delete that kept history entries for its
 * forks: a view holds each entry with its line, and one moved to a fork, or
 * copied onto one, would otherwise read as the deleted line's — off every
 * line — until a reload. A copy also moves the fork's scenes and links onto
 * it. Best-effort: the delete has landed.
 */
async function relistKeptHistory(
	socket: any,
	lorebookId: number,
	kept: KeptHistory,
	emitToUser: (event: string, data: any) => void
): Promise<void> {
	if (kept.moved.size === 0 && kept.copied.length === 0) return
	try {
		await relistEntries(socket, lorebookId, HISTORY_TYPE_ID, emitToUser)
		if (kept.copied.length === 0) return
		await sceneListByLorebookHandler.handler(socket, { lorebookId }, emitToUser)
		await narrativeGraphListHandler.handler(socket, { lorebookId }, emitToUser)
	} catch (err) {
		console.warn("[amendments:deleteBranch] list refresh failed:", err)
	}
}

/**
 * Tell every tab of the sessions on a line forked from a deleted one that
 * what their line reads changed: the deleted line's rows left their chain.
 * Their own line and clock did not, so it is `state:changed` alone — no
 * settings `session-updated`, no row. Best-effort: the delete has landed.
 */
async function announceReadingMoved(
	io: any,
	sessionIds: readonly number[]
): Promise<void> {
	if (!io) return
	for (const sessionId of sessionIds) {
		try {
			await broadcastToSessionUsers(io, sessionId, "state:changed", {
				sessionId
			} satisfies Sockets.State.Changed.Response)
		} catch (err) {
			console.warn("[amendments:deleteBranch] state:changed emit failed:", err)
		}
	}
}

/**
 * Tell every tab of the sessions a deleted line moved to the line it left
 * that their line moved (#136) — and their clock, when it went back to the
 * fork date or was cleared — the same `state:changed` + settings
 * `session-updated` pair `sessions:setLorebook` announces, and the session
 * row for the lists. Open settings forms and the lorebook workspace then stop
 * holding a dead line id. Best-effort: the delete has already landed.
 */
async function announceSessionsMoved(
	io: any,
	sessions: readonly { id: number; clockMoved: boolean }[],
	userId: number
): Promise<void> {
	if (!io || sessions.length === 0) return
	for (const { id: sessionId, clockMoved } of sessions) {
		try {
			await broadcastToSessionUsers(io, sessionId, "state:changed", {
				sessionId
			} satisfies Sockets.State.Changed.Response)
			const { emitSessionEvent } = await import(
				"$lib/server/pipelines/runtime/sessionEvents"
			)
			await emitSessionEvent(db, {
				sessionId,
				userId,
				event: sessionEvents.sessionUpdated,
				payload: {
					sessionId,
					changed: clockMoved
						? ["lorebookBranchId", "storyClock"]
						: ["lorebookBranchId"],
					cause: { kind: "settings", userId }
				},
				io
			})
		} catch (err) {
			console.warn("[amendments:deleteBranch] session-updated emit failed:", err)
		}
		broadcastSessionRow(io, sessionId)
	}
}

/** The member must be in this book — the same gate an amendment passes. */
async function assertMember(castId: number, lorebookId: number) {
	const member = await db.query.lorebookBindings.findFirst({
		where: (m, { and: a, eq: q }) =>
			a(q(m.id, castId), q(m.lorebookId, lorebookId)),
		columns: { id: true }
	})
	if (!member) throw new Error("That cast member is not in this lorebook.")
	return member
}

export const amendmentsPlaceHandler: Handler<
	Sockets.Amendments.Place.Params,
	Sockets.Amendments.Place.Response
> = refusable(
	"amendments:place",
	async (socket, params: Sockets.Amendments.Place.Params, emitToUser) => {
		const userId = socket.user!.id
		const book = await assertOwnedBook(db, userId, params.lorebookId)
		const member = await assertMember(params.castId, params.lorebookId)
		const branchId = await assertBranch(params.branchId, params.lorebookId)

		const position = Number(params.personalPosition)
		if (!Number.isInteger(position))
			throw new Error(
				"A placement needs a point in their life: a number you count in."
			)

		const from = assertDate({
			year: params.fromYear,
			month: params.fromMonth,
			day: params.fromDay
		})
		// ⚠ An end is optional; a half-given one is not. A month with no year
		// is not a date, and the CHECK cannot say so in words.
		const hasUntil = params.untilYear != null
		const until = hasUntil
			? assertDate({
					year: params.untilYear,
					month: params.untilMonth,
					day: params.untilDay
				})
			: null
		if (!hasUntil && (params.untilMonth != null || params.untilDay != null))
			throw new Error("An end needs a year to be an end.")
		// ⚠ `compareDates`, not `dateValue`: the packed scalar is a PLACEMENT
		// value — it keeps order, but squeezes a month or a day past 99 so
		// close to the next that it cannot be trusted to tell them apart.
		if (until && compareDates(until, from) <= 0)
			throw new Error("They would leave before they arrived.")

		// Both ends checked against the calendar and written under the book's
		// lock (`lockBookCalendar`, A18(d)), as every dated write is.
		await db.transaction(async (tx) => {
			await lockBookCalendar(tx, params.lorebookId)
			await assertDateLands(tx, params.lorebookId, from, "The arrival")
			if (until)
				await assertDateLands(tx, params.lorebookId, until, "The departure")
			await tx.insert(schema.castPresences).values({
				lorebookBindingId: member.id,
				lorebookId: params.lorebookId,
				branchId,
				personalPosition: position,
				fromYear: from.year,
				fromMonth: from.month,
				fromDay: from.day,
				untilYear: until?.year ?? null,
				untilMonth: until?.month ?? null,
				untilDay: until?.day ?? null,
				note: params.note ?? null
			})
		})

		const res = await buildAmendmentsList(userId, params.lorebookId)
		emitToUser("amendments:list", res)
		return res
	},
	"That placement could not be saved."
)

export const amendmentsUnplaceHandler: Handler<
	Sockets.Amendments.Unplace.Params,
	Sockets.Amendments.Unplace.Response
> = refusable(
	"amendments:unplace",
	async (socket, params: Sockets.Amendments.Unplace.Params, emitToUser) => {
		const userId = socket.user!.id
		const book = await assertOwnedBook(db, userId, params.lorebookId)
		// ⚠ Scoped by book as well as id: the id alone would let one book's
		// placement be removed from another book's screen.
		await db
			.delete(schema.castPresences)
			.where(
				and(
					eq(schema.castPresences.id, params.id),
					eq(schema.castPresences.lorebookId, params.lorebookId)
				)
			)
		const res = await buildAmendmentsList(userId, params.lorebookId)
		emitToUser("amendments:list", res)
		return res
	},
	"That placement could not be removed."
)

export function registerAmendmentHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, amendmentsListHandler, emitToUser)
	register(socket, amendmentsCreateHandler, emitToUser)
	register(socket, amendmentsUpdateHandler, emitToUser)
	register(socket, amendmentsDeleteHandler, emitToUser)
	register(socket, amendmentsForkHandler, emitToUser)
	register(socket, amendmentsRenameBranchHandler, emitToUser)
	register(socket, amendmentsDeleteBranchHandler, emitToUser)
	register(socket, amendmentsPlaceHandler, emitToUser)
	register(socket, amendmentsUnplaceHandler, emitToUser)
}
