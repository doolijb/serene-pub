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
import { and, eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import {
	compareDates,
	type StoryDate
} from "$lib/shared/lorebooks/storyDate"
import {
	amendmentsForAppearance,
	castAsOf,
	NEVER_AMENDED,
	type AsOf
} from "$lib/shared/lorebooks/amendments"
import { appearancesOf } from "$lib/shared/lorebooks/presence"
import type { Handler } from "$lib/shared/events"
import { assertDateLands } from "$lib/server/state/storyTime"
import {
	assertDeclaredFields,
	keysToArray
} from "$lib/server/utils/lorebookEntries"
import type { KeyList } from "$lib/server/pipelines/ranking/signals"
import { verifyBindingTargetAccess } from "./lorebooks"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { sessionEvents } from "@serene-pub/sdk"
import { broadcastToSessionUsers } from "./utils/broadcastHelpers"
import { broadcastSessionRow } from "$lib/server/sessions/rowPush"

/** The book, only if this user owns it. The one gate every handler passes. */
async function findOwnedBook(lorebookId: number, userId: number) {
	return db.query.lorebooks.findFirst({
		where: (l, { and: a, eq: e }) =>
			a(e(l.id, lorebookId), e(l.userId, userId)),
		columns: { id: true, userId: true }
	})
}

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
	const book = await findOwnedBook(lorebookId, userId)
	if (!book)
		throw new Error(
			"Lorebook not found or you do not have permission to read it."
		)

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
 * One cast member, resolved, for a session that holds their card.
 *
 * ⚠ **The one server-side resolution path. Never write a second.** Agreed with
 * the sprites session 2026-09-24: a face, a prompt block and a widget must all
 * be looking at the same person, and two paths would eventually disagree about
 * which card she is being drawn with. Everything here is the SAME pure
 * resolver the workspace uses (`castAsOf`, `appearancesOf`), so the server and
 * the screen cannot drift.
 *
 * ⚠ Keyed on the CARD, not on the member, because that is what a session holds
 * (`session_characters.character_id`). It is design §4bb's cascade, read
 * server-side: a book with a member for that card answers with the
 * member; a book without one, or no book at all, is not this function's
 * business — it answers null and the caller falls back to the card.
 *
 * ⚠ Returns **appearances**, plural. A member placed twice at one moment is
 * two people, and a caller that takes `[0]` will silently show one of them.
 */
export async function castMemberAsOf(
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
	const member = await dbOrTx.query.lorebookBindings.findFirst({
		where: (m, { and: a, eq: q }) =>
			a(
				q(m.lorebookId, params.lorebookId),
				q(m.characterId, params.characterId)
			)
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
 * A date the calendar can order.
 *
 * ⚠ The CHECK constraint refuses a day with no month, but it cannot refuse a
 * year that is not a number — an amendment IS a date, so a malformed one is
 * refused here rather than stored as a row nothing can place.
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
	if (day != null && month == null)
		throw new Error(
			"A day needs a month: the calendar narrows left to right."
		)
	return { year, month, day }
}

/**
 * An amendment's `fields`, as the server stores them.
 *
 * ⚠ Identity and bookkeeping columns (`NEVER_AMENDED`: id, book, type, branch,
 * position, timestamps) are DROPPED, matching `changedFields` on the client —
 * an overlay that re-pointed `branchId` or `lorebookId` would make a row read
 * as another line's or another book's at one date. A cast overlay naming a
 * card (`characterId`) must name one the caller could bind as a member; an
 * entry overlay's declared fields must be their declared type.
 */
async function cleanFields(
	raw: unknown,
	subject: { kind: "entry"; typeId: string } | { kind: "cast" },
	userId: number
): Promise<Record<string, unknown>> {
	const fields: Record<string, unknown> = {}
	if (raw && typeof raw === "object" && !Array.isArray(raw))
		for (const [key, value] of Object.entries(raw as Record<string, unknown>))
			if (!NEVER_AMENDED.has(key)) fields[key] = value
	if (subject.kind === "entry") {
		// Keys are stored as the list the column holds (finding #146): a list
		// is kept element for element, so a regex `\w{2,4}` stays one key; only
		// a legacy comma string is split, once, here at the boundary.
		for (const key of ["keys", "secondaryKeys"] as const)
			if (key in fields) fields[key] = keysToArray(fields[key] as KeyList)
		assertDeclaredFields(subject.typeId, fields)
	} else if (fields.characterId != null) {
		const characterId = Number(fields.characterId)
		if (
			!Number.isInteger(characterId) ||
			!(await verifyBindingTargetAccess({ characterId }, userId))
		)
			throw new Error("That card is not one this cast member can be drawn with.")
		fields.characterId = characterId
	}
	return fields
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
> = {
	event: "amendments:list",
	handler: async (socket, params, emitToUser) => {
		const res = await buildAmendmentsList(
			socket.user!.id,
			params.lorebookId
		)
		emitToUser("amendments:list", res)
		return res
	}
}

export const amendmentsCreateHandler: Handler<
	Sockets.Amendments.Create.Params,
	Sockets.Amendments.Create.Response
> = {
	event: "amendments:create",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const book = await findOwnedBook(params.lorebookId, userId)
		if (!book)
			throw new Error(
				"Lorebook not found or you do not have permission to amend it."
			)

		const { year, month, day } = assertDate(params)
		// Validated at entry against the book's calendar, when it declares
		// one (DESIGN-story-time §0), so the preflight list cannot refill.
		await assertDateLands(db, params.lorebookId, { year, month, day })
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
				columns: { id: true, typeId: true }
			})
			if (!entry) throw new Error("That entry is not in this lorebook.")
			const fields = await cleanFields(
				params.fields,
				{ kind: "entry", typeId: entry.typeId },
				userId
			)
			await db.insert(schema.entryAmendments).values({
				lorebookId: params.lorebookId,
				entryId: entry.id,
				branchId,
				year,
				month,
				day,
				fields,
				historyEntryId
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
			const fields = await cleanFields(params.fields, { kind: "cast" }, userId)
			await db.insert(schema.castAmendments).values({
				lorebookBindingId: member.id,
				lorebookId: params.lorebookId,
				// The personal axis, when the author dated it against her life
				// rather than against the world (design §4d).
				personalPosition: assertPersonalPosition(params.personalPosition),
				branchId,
				year,
				month,
				day,
				fields,
				historyEntryId
			})
		}

		const res = await buildAmendmentsList(userId, params.lorebookId)
		emitToUser("amendments:list", res)
		return res
	}
}

export const amendmentsUpdateHandler: Handler<
	Sockets.Amendments.Update.Params,
	Sockets.Amendments.Update.Response
> = {
	event: "amendments:update",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const book = await findOwnedBook(params.lorebookId, userId)
		if (!book)
			throw new Error(
				"Lorebook not found or you do not have permission to amend it."
			)

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
			await assertDateLands(db, params.lorebookId, patch as any)
		}
		if (params.fields !== undefined) {
			let subject: { kind: "entry"; typeId: string } | { kind: "cast" } = {
				kind: "cast"
			}
			if (params.subject === "entry") {
				const [row] = await db
					.select({ typeId: schema.lorebookEntries.typeId })
					.from(schema.entryAmendments)
					.innerJoin(
						schema.lorebookEntries,
						eq(schema.lorebookEntries.id, schema.entryAmendments.entryId)
					)
					.where(eq(schema.entryAmendments.id, params.id))
					.limit(1)
				subject = { kind: "entry", typeId: row?.typeId ?? "" }
			}
			patch.fields = await cleanFields(params.fields, subject, userId)
		}
		if (!Object.keys(patch).length) throw new Error("Nothing to change.")

		await db
			.update(table)
			.set(patch)
			.where(and(eq(table.id, params.id), eq(table.lorebookId, params.lorebookId)))

		const res = await buildAmendmentsList(userId, params.lorebookId)
		emitToUser("amendments:list", res)
		return res
	}
}

export const amendmentsDeleteHandler: Handler<
	Sockets.Amendments.Delete.Params,
	Sockets.Amendments.Delete.Response
> = {
	event: "amendments:delete",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const book = await findOwnedBook(params.lorebookId, userId)
		if (!book)
			throw new Error(
				"Lorebook not found or you do not have permission to amend it."
			)

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

		const res = await buildAmendmentsList(userId, params.lorebookId)
		emitToUser("amendments:list", res)
		return res
	}
}

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
> = {
	event: "amendments:fork",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const book = await findOwnedBook(params.lorebookId, userId)
		if (!book)
			throw new Error(
				"Lorebook not found or you do not have permission to branch it."
			)

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

		if (dated.year != null)
			await assertDateLands(db, params.lorebookId, dated as any, "The fork date")

		await db.insert(schema.lorebookBranches).values({
			lorebookId: params.lorebookId,
			name,
			forkedFromBranchId: from,
			forkYear: dated.year,
			forkMonth: dated.month,
			forkDay: dated.day
		})

		const res = await buildAmendmentsList(userId, params.lorebookId)
		emitToUser("amendments:list", res)
		return res
	}
}

export const amendmentsRenameBranchHandler: Handler<
	Sockets.Amendments.RenameBranch.Params,
	Sockets.Amendments.RenameBranch.Response
> = {
	event: "amendments:renameBranch",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const book = await findOwnedBook(params.lorebookId, userId)
		if (!book)
			throw new Error(
				"Lorebook not found or you do not have permission to change it."
			)
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
		return res
	}
}

export const amendmentsDeleteBranchHandler: Handler<
	Sockets.Amendments.DeleteBranch.Params,
	Sockets.Amendments.DeleteBranch.Response
> = {
	event: "amendments:deleteBranch",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const book = await findOwnedBook(params.lorebookId, userId)
		if (!book)
			throw new Error(
				"Lorebook not found or you do not have permission to change it."
			)
		await assertBranch(params.id, params.lorebookId)

		// The sessions on this line, asked BEFORE the delete: the cascade
		// nulls their column, after which nothing can say who moved (#136).
		const movedSessions = await db
			.select({ id: schema.sessions.id })
			.from(schema.sessions)
			.where(eq(schema.sessions.lorebookBranchId, params.id))

		// ⚠ The line's OWN rows go with it, by cascade: its amendments, the
		// entries written on it, its scenes, its edges, its placements and
		// its recorded stats. Shared rows have a NULL `branch_id` and are
		// untouched. Sessions played on it fall back to main (`set null`), and
		// branches forked FROM it become children of main rather than
		// vanishing — both are declared on the columns.
		await db
			.delete(schema.lorebookBranches)
			.where(
				and(
					eq(schema.lorebookBranches.id, params.id),
					eq(schema.lorebookBranches.lorebookId, params.lorebookId)
				)
			)

		const res = await buildAmendmentsList(userId, params.lorebookId)
		emitToUser("amendments:list", res)
		await announceSessionsMovedToMain(
			(socket as any).io,
			movedSessions.map((s) => s.id),
			userId
		)
		return res
	}
}

/**
 * Tell every tab of the sessions a deleted line took back to main that their
 * line moved (#136) — the same `state:changed` + settings `session-updated`
 * pair `sessions:setLorebook` announces, and the session row for the lists.
 * Open settings forms and the lorebook workspace then stop holding a dead
 * line id. Best-effort: the delete has already landed.
 */
async function announceSessionsMovedToMain(
	io: any,
	sessionIds: readonly number[],
	userId: number
): Promise<void> {
	if (!io || sessionIds.length === 0) return
	for (const sessionId of sessionIds) {
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
					changed: ["lorebookBranchId"],
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
> = {
	event: "amendments:place",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const book = await findOwnedBook(params.lorebookId, userId)
		if (!book)
			throw new Error(
				"Lorebook not found or you do not have permission to change it."
			)
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
		await assertDateLands(db, params.lorebookId, from, "The arrival")
		if (until)
			await assertDateLands(db, params.lorebookId, until, "The departure")
		// ⚠ `compareDates`, not `dateValue`: the packed scalar is a PLACEMENT
		// value and lies about order once a month or a day passes 100, which
		// a book numbering days of the year does on day 100.
		if (until && compareDates(until, from) <= 0)
			throw new Error("They would leave before they arrived.")

		await db.insert(schema.castPresences).values({
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

		const res = await buildAmendmentsList(userId, params.lorebookId)
		emitToUser("amendments:list", res)
		return res
	}
}

export const amendmentsUnplaceHandler: Handler<
	Sockets.Amendments.Unplace.Params,
	Sockets.Amendments.Unplace.Response
> = {
	event: "amendments:unplace",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const book = await findOwnedBook(params.lorebookId, userId)
		if (!book)
			throw new Error(
				"Lorebook not found or you do not have permission to change it."
			)
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
	}
}

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
