/**
 * 🚧 An entry's, a version's and a scene's **Edit history** on the wire
 * (`lore_redlines`, record module `lorebooks/redlines.ts`): list, Restore,
 * count and clear, and the admin's size and clear. Replies only; nothing is
 * pushed.
 *
 * - The list names a session only to a viewer who may open it, and never
 *   sends a run id, a model or a connection.
 * - Restore goes through the same save a person's save takes (`saveEntry`,
 *   `updateAmendment`), so every check of that save applies, and is itself
 *   recorded (cause `restore`).
 * - A scene's history is read and restored by whoever may edit its lorebook;
 *   Restore goes through the scene's own save. A scene has no clear of its
 *   own: the book's clear covers it.
 * - Clearing and counting are the lorebook owner's alone.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { i18nText } from "@serene-pub/sdk"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import { refusable } from "./refusable"
import { findOwnedBook } from "$lib/server/utils/ownedBook"
import {
	primerRowEditProblem,
	PROVIDED_BOOK_CAST_REFUSAL
} from "$lib/server/plugins/providedMarks"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import { dayOnly, formatDate } from "$lib/shared/lorebooks/storyDate"
import { bookCalendarOf } from "$lib/server/state/storyTime"
import { entryDeclaration } from "$lib/server/entries/declarations"
import { profileOf } from "$lib/shared/characters/profile"
import type { CharacterProfileV1 } from "$lib/shared/characters/profile"
import { cardColumnsOfProfile } from "$lib/server/characters/cardIO"
import { updateCastVersion } from "$lib/server/characters/versions"
import { readSceneCast } from "$lib/server/utils/sceneCast"
import { providedBookKeepsCast } from "$lib/server/lorebooks/castOwnNames"
import { retoldUpdateProblem } from "$lib/server/lorebooks/retold"
import { validateTimbre } from "$lib/server/characters/timbre"
import { canPickVoice } from "$lib/shared/characters/timbre"
import {
	VERSION_REDLINE_KEYS,
	type RedlineValue,
	clearAllRedlines,
	clearRedlines,
	countRedlines,
	redlineKeysOf,
	redlineSummary,
	type RedlineRow
} from "$lib/server/lorebooks/redlines"

const NOT_YOURS = "Entry not found or access denied."
const NOT_KEPT = "That edit is no longer kept."
const OWNER_ONLY = "Only the lorebook's owner can clear its edit history."

const NOT_THE_CHARACTER = "Character not found or access denied."

/** The entry and its book's owner, or a refusal when the asker may not open the book. */
async function entryAndBook(entryId: unknown, userId: number) {
	if (!Number.isInteger(entryId)) throw new Error(NOT_YOURS)
	const [row] = await db
		.select({
			id: schema.lorebookEntries.id,
			typeId: schema.lorebookEntries.typeId,
			lorebookId: schema.lorebookEntries.lorebookId,
			ownerId: schema.lorebooks.userId
		})
		.from(schema.lorebookEntries)
		.innerJoin(
			schema.lorebooks,
			eq(schema.lorebooks.id, schema.lorebookEntries.lorebookId)
		)
		.where(eq(schema.lorebookEntries.id, entryId as number))
	if (!row || !(await findOwnedBook(db, userId, row.lorebookId)))
		throw new Error(NOT_YOURS)
	return row
}

const labelOf = (typeId: string, key: string): string => {
	if (key === "name") return "Name"
	if (key === "content") return "Content"
	if (key === "keys") return "Keys"
	if (key === "secondaryKeys") return "Secondary keys"
	if (key === "decayRate") return "Decay"
	// A Beginning's parts, on a type that declares no date of its own.
	const declared = entryDeclaration(typeId)?.fields?.[key]?.label
	if (!declared && key === "year") return "Beginning: year"
	if (!declared && key === "month") return "Beginning: month"
	if (!declared && key === "day") return "Beginning: day"
	return (
		i18nText(entryDeclaration(typeId)?.fields?.[key]?.label as never) ?? key
	)
}

/**
 * How each row names its author to `asker`: "You", a person, or a routine or
 * an Apply by its session. A session is named only to someone who may open it;
 * never a run id, a model or a connection.
 */
async function whoReader(
	rows: RedlineRow[],
	asker: number
): Promise<(r: RedlineRow) => string> {
	const userIds = [
		...new Set(
			rows.map((r) => r.userId).filter((v): v is number => v != null)
		)
	]
	const people = userIds.length
		? await db
				.select({
					id: schema.users.id,
					displayName: schema.users.displayName,
					username: schema.users.username
				})
				.from(schema.users)
				.where(inArray(schema.users.id, userIds))
		: []
	const personName = new Map(
		people.map((p) => [
			p.id,
			p.displayName?.trim() || p.username || "Someone"
		])
	)

	// A session is named only to someone who may open it.
	const sessionIds = [
		...new Set(
			rows.map((r) => r.sessionId).filter((v): v is number => v != null)
		)
	]
	const sessionLine = new Map<number, string | null | "denied">()
	for (const id of sessionIds) {
		const session = await db.query.sessions.findFirst({
			where: eq(schema.sessions.id, id),
			columns: { name: true }
		})
		if (!session) sessionLine.set(id, null)
		else if (!(await checkSessionAccess(id, asker)).hasAccess)
			sessionLine.set(id, "denied")
		else sessionLine.set(id, session.name?.trim() || "a session")
	}
	const inSession = (
		id: number | null,
		lead: string,
		joiner: string
	): string => {
		if (id == null) return lead
		const line = sessionLine.get(id)
		if (line === null) return `${lead}${joiner}a session that was deleted`
		if (line === "denied" || line === undefined)
			return `${lead}${joiner}a session`
		return `${lead}${joiner}${line}`
	}

	return (r: RedlineRow): string => {
		if (r.userId != null)
			return r.userId === asker
				? "You"
				: (personName.get(r.userId) ?? "Someone")
		if (r.cause === "routine")
			return inSession(
				r.sessionId,
				r.shownAs?.trim() || "A routine",
				" in "
			)
		return inSession(r.sessionId, "By itself", ", from ")
	}
}

/** The entry's Edit history as `asker` reads it, newest first. */
async function buildRedlines(
	entryId: number,
	asker: number
): Promise<Sockets.Entries.Redlines.Response> {
	const entry = await entryAndBook(entryId, asker)
	const rows = (await db
		.select()
		.from(schema.loreRedlines)
		.where(eq(schema.loreRedlines.entryId, entryId))
		.orderBy(desc(schema.loreRedlines.id))) as RedlineRow[]

	const whoOf = await whoReader(rows, asker)

	const amendmentIds = [
		...new Set(
			rows.map((r) => r.amendmentId).filter((v): v is number => v != null)
		)
	]
	const dates = new Map<number, string>()
	if (amendmentIds.length) {
		const calendar = await bookCalendarOf(db, entry.lorebookId)
		const found = await db
			.select({
				id: schema.entryAmendments.id,
				year: schema.entryAmendments.year,
				month: schema.entryAmendments.month,
				day: schema.entryAmendments.day
			})
			.from(schema.entryAmendments)
			.where(inArray(schema.entryAmendments.id, amendmentIds))
		for (const a of found)
			dates.set(
				a.id,
				a.year == null
					? "a dated change"
					: `the change from ${formatDate(dayOnly({ year: a.year, month: a.month, day: a.day }), calendar)}`
			)
	}

	return {
		entryId,
		lorebookId: entry.lorebookId,
		canRestore:
			entry.ownerId === asker &&
			!(await primerRowEditProblem(db, entry.lorebookId)),
		canClear: entry.ownerId === asker,
		redlines: rows.map((r) => ({
			id: r.id,
			amendmentId: r.amendmentId,
			version:
				r.amendmentId == null
					? null
					: (dates.get(r.amendmentId) ?? "a dated change"),
			cause: r.cause as Sockets.RedlineView["cause"],
			who: whoOf(r),
			mine: r.userId === asker,
			at: (r.createdAt instanceof Date
				? r.createdAt
				: new Date(r.createdAt)
			).toISOString(),
			changes: Object.entries(r.changes).map(([key, c]) => ({
				key,
				label: labelOf(entry.typeId, key),
				before: c.before?.v ?? null,
				after: c.after?.v ?? null,
				wasAbsent: c.before == null,
				nowAbsent: c.after == null
			}))
		}))
	}
}

export const entryRedlinesHandler: Handler<
	Sockets.Entries.Redlines.Params,
	Sockets.Entries.Redlines.Response
> = refusable(
	"entries:redlines",
	async (socket, params: Sockets.Entries.Redlines.Params, emitToUser) => {
		const res = await buildRedlines(params.entryId, socket.user!.id)
		emitToUser("entries:redlines", res)
		return res
	},
	"The edit history could not be read.",
	undefined,
	(params) => ({ entryId: (params as { entryId?: unknown } | null)?.entryId })
)

export const entryRestoreRedlineHandler: Handler<
	Sockets.Entries.RestoreRedline.Params,
	Sockets.Entries.RestoreRedline.Response
> = refusable(
	"entries:restoreRedline",
	async (
		socket,
		params: Sockets.Entries.RestoreRedline.Params,
		emitToUser
	) => {
		const userId = socket.user!.id
		if (!Number.isInteger(params?.redlineId)) throw new Error(NOT_KEPT)
		const [row] = (await db
			.select()
			.from(schema.loreRedlines)
			.where(eq(schema.loreRedlines.id, params.redlineId))
			.limit(1)) as RedlineRow[]
		if (!row) throw new Error(NOT_KEPT)
		const entry = await entryAndBook(row.entryId, userId)
		const keys = Object.keys(row.changes)

		if (row.amendmentId == null) {
			const restorable = new Set(await redlineKeysOf(entry.typeId, keys))
			const gone = keys.find((k) => !restorable.has(k))
			if (gone)
				throw new Error(
					`${labelOf(entry.typeId, gone)} is no longer part of this kind of entry.`
				)
			const entryPatch: Record<string, unknown> = {
				id: entry.id,
				typeId: entry.typeId
			}
			for (const key of keys) {
				const before = row.changes[key].before
				if (before) entryPatch[key] = before.v
			}
			// Loaded at call time: `entries.ts` imports this module to register its handlers.
			const { saveEntry } = await import("./entries")
			await saveEntry(
				socket,
				{ entry: entryPatch } as Sockets.Entries.Update.Params,
				emitToUser,
				"restore"
			)
		} else {
			const [amendment] = await db
				.select({ fields: schema.entryAmendments.fields })
				.from(schema.entryAmendments)
				.where(
					and(
						eq(schema.entryAmendments.id, row.amendmentId),
						eq(schema.entryAmendments.lorebookId, entry.lorebookId),
						eq(schema.entryAmendments.entryId, entry.id)
					)
				)
				.limit(1)
			if (!amendment)
				throw new Error(
					"The dated change that edit was made on is gone."
				)
			const fields: Record<string, unknown> = {
				...((amendment.fields ?? {}) as Record<string, unknown>)
			}
			for (const key of keys) {
				const before = row.changes[key].before
				if (before) fields[key] = before.v
				else delete fields[key]
			}
			// Loaded at call time, as `saveEntry` is: this module is imported by `entries.ts`.
			const { updateAmendment } = await import("./amendments")
			await updateAmendment(
				socket,
				{
					lorebookId: entry.lorebookId,
					id: row.amendmentId,
					subject: "entry",
					fields
				},
				emitToUser,
				"restore"
			)
		}

		const res: Sockets.Entries.RestoreRedline.Response = {
			redlineId: row.id,
			entryId: entry.id,
			lorebookId: entry.lorebookId
		}
		emitToUser("entries:restoreRedline", res)
		emitToUser("entries:redlines", await buildRedlines(entry.id, userId))
		return res
	},
	"That edit could not be restored.",
	undefined,
	(params) => ({
		redlineId: (params as { redlineId?: unknown } | null)?.redlineId
	})
)

/** A scope the asker owns: an entry's book or a lorebook, owner only. */
async function ownedScope(
	params: { entryId?: unknown; lorebookId?: unknown } | null | undefined,
	userId: number
): Promise<{ lorebookId: number; entryId: number | null }> {
	if (params?.entryId !== undefined) {
		const entry = await entryAndBook(params.entryId, userId)
		if (entry.ownerId !== userId) throw new Error(OWNER_ONLY)
		return { lorebookId: entry.lorebookId, entryId: entry.id }
	}
	const [book] = Number.isInteger(params?.lorebookId)
		? await db
				.select({
					id: schema.lorebooks.id,
					userId: schema.lorebooks.userId
				})
				.from(schema.lorebooks)
				.where(eq(schema.lorebooks.id, params!.lorebookId as number))
		: []
	if (!book || !(await findOwnedBook(db, userId, book.id)))
		throw new Error(NOT_YOURS)
	if (book.userId !== userId) throw new Error(OWNER_ONLY)
	return { lorebookId: book.id, entryId: null }
}

const scopeEcho = (params: unknown) => {
	const p = params as { entryId?: unknown; lorebookId?: unknown } | null
	return { entryId: p?.entryId, lorebookId: p?.lorebookId }
}

export const entryClearRedlinesHandler: Handler<
	Sockets.Entries.ClearRedlines.Params,
	Sockets.Entries.ClearRedlines.Response
> = refusable(
	"entries:clearRedlines",
	async (
		socket,
		params: Sockets.Entries.ClearRedlines.Params,
		emitToUser
	) => {
		const userId = socket.user!.id
		const scope = await ownedScope(params, userId)
		const cleared = await clearRedlines(
			db,
			scope.entryId != null
				? { entryId: scope.entryId }
				: { lorebookId: scope.lorebookId }
		)
		const res: Sockets.Entries.ClearRedlines.Response = {
			...scope,
			cleared
		}
		emitToUser("entries:clearRedlines", res)
		if (scope.entryId != null)
			emitToUser(
				"entries:redlines",
				await buildRedlines(scope.entryId, userId)
			)
		return res
	},
	"The edit history could not be cleared.",
	undefined,
	scopeEcho
)

export const entryRedlineCountHandler: Handler<
	Sockets.Entries.RedlineCount.Params,
	Sockets.Entries.RedlineCount.Response
> = refusable(
	"entries:redlineCount",
	async (socket, params: Sockets.Entries.RedlineCount.Params, emitToUser) => {
		const scope = await ownedScope(params, socket.user!.id)
		const count = await countRedlines(
			db,
			scope.entryId != null
				? { entryId: scope.entryId }
				: { lorebookId: scope.lorebookId }
		)
		const res: Sockets.Entries.RedlineCount.Response = { ...scope, count }
		emitToUser("entries:redlineCount", res)
		return res
	},
	"The edit history could not be counted.",
	undefined,
	scopeEcho
)

// ── A card version's or a cast version's edit history ───────────────────────

const VERSION_LABELS: Record<string, string> = {
	name: "Name",
	nickname: "Nickname",
	aliases: "Aliases",
	summary: "Summary",
	description: "Description",
	personality: "Personality",
	scenario: "Scenario",
	greetings: "Greetings",
	exampleDialogues: "Example dialogues",
	postHistoryInstructions: "Post-history instructions",
	creatorNotes: "Creator notes",
	likeness: "Likeness",
	timbre: "Voice",
	faceMediaId: "Face"
}
const versionLabel = (key: string): string => VERSION_LABELS[key] ?? key

const isFollow = (v: unknown): boolean =>
	!!v &&
	typeof v === "object" &&
	!Array.isArray(v) &&
	(v as { follow?: unknown }).follow === true

/** One side of a version change as the list shows it. */
function versionSide(
	key: string,
	c: RedlineValue
): { value: unknown; follows: boolean } {
	const v = c?.v
	if (key === "faceMediaId") return { value: null, follows: false }
	if (isFollow(v)) return { value: null, follows: true }
	if (c == null) return { value: null, follows: false }
	if (key === "greetings")
		return {
			value: Array.isArray(v)
				? v.map((g) => (g as { text?: unknown })?.text ?? "")
				: [],
			follows: false
		}
	if (key === "creatorNotes")
		return {
			value: (v as { text?: unknown } | null)?.text ?? null,
			follows: false
		}
	return { value: v ?? null, follows: false }
}

/** The version and what `userId` may do with it, or a refusal. A card version: its card's owner. A cast version: whoever may open its lorebook. */
/**
 * The member page's own refusals, for what a Restore is about to put back on
 * a cast version: a provided book keeps its cast's names and faces; a face
 * must be a picture this member may wear; a voice is the asker's to pick.
 * Throws the save's sentence.
 */
async function castRestoreProblem(
	user: Parameters<typeof canPickVoice>[0],
	userId: number,
	lorebookId: number,
	version: typeof schema.characterVersions.$inferSelect,
	changes: Record<string, unknown>
): Promise<void> {
	if ("name" in changes || "nickname" in changes || "faceMediaId" in changes) {
		const [book] = await db
			.select({
				uuid: schema.lorebooks.uuid,
				extraJson: schema.lorebooks.extraJson
			})
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, lorebookId))
			.limit(1)
		if (book && (await providedBookKeepsCast(db, book)))
			throw new Error(PROVIDED_BOOK_CAST_REFUSAL)
	}
	const profile = profileOf(version) as unknown as Record<string, unknown>
	if (changes.faceMediaId != null) {
		const [member] = await db
			.select({ characterId: schema.lorebookBindings.characterId })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, version.castMemberId!))
			.limit(1)
		const problem = await retoldUpdateProblem(
			db,
			{ faceMediaId: changes.faceMediaId },
			{
				id: version.castMemberId!,
				lorebookId,
				characterId: member?.characterId ?? null,
				faceMediaId: (profile.faceMediaId as number | null) ?? null
			},
			userId
		)
		if (problem) throw new Error(problem)
	}
	if (changes.timbre != null) {
		const result = await validateTimbre(changes.timbre, {
			db,
			canPickVoice: canPickVoice(user),
			previous: (profile.timbre ?? {}) as never
		})
		if (!result.ok) throw new Error(result.reason)
		changes.timbre = result.timbre
	}
}

async function versionAccess(versionId: unknown, userId: number) {
	if (!Number.isInteger(versionId)) throw new Error(NOT_THE_CHARACTER)
	const [row] = await db
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.id, versionId as number))
	if (!row) throw new Error(NOT_THE_CHARACTER)
	if (row.cardId != null) {
		const card = await db.query.characters.findFirst({
			where: and(
				eq(schema.characters.id, row.cardId),
				eq(schema.characters.userId, userId)
			),
			columns: { id: true }
		})
		if (!card) throw new Error(NOT_THE_CHARACTER)
		return { row, cardId: row.cardId, lorebookId: null, owner: true }
	}
	const book =
		row.lorebookId != null
			? await findOwnedBook(db, userId, row.lorebookId)
			: undefined
	if (!book) throw new Error(NOT_THE_CHARACTER)
	return {
		row,
		cardId: null,
		lorebookId: book.id,
		owner: book.userId === userId
	}
}

/** A version's Edit history as `asker` reads it, newest first. */
async function buildVersionRedlines(
	versionId: number,
	asker: number
): Promise<Sockets.CharacterVersions.Redlines.Response> {
	const access = await versionAccess(versionId, asker)
	const rows = (await db
		.select()
		.from(schema.loreRedlines)
		.where(eq(schema.loreRedlines.characterVersionId, versionId))
		.orderBy(desc(schema.loreRedlines.id))) as RedlineRow[]
	const whoOf = await whoReader(rows, asker)
	return {
		characterVersionId: versionId,
		cardId: access.cardId,
		lorebookId: access.lorebookId,
		canRestore:
			access.cardId != null ||
			(access.owner && !(await primerRowEditProblem(db, access.lorebookId!))),
		canClear: access.owner,
		redlines: rows.map((r) => ({
			id: r.id,
			amendmentId: null,
			version: null,
			cause: r.cause as Sockets.RedlineView["cause"],
			who: whoOf(r),
			mine: r.userId === asker,
			at: (r.createdAt instanceof Date
				? r.createdAt
				: new Date(r.createdAt)
			).toISOString(),
			changes: Object.entries(r.changes).map(([key, c]) => {
				const before = versionSide(key, c.before)
				const after = versionSide(key, c.after)
				return {
					key,
					label: versionLabel(key),
					before: before.value,
					after: after.value,
					wasAbsent: c.before == null,
					nowAbsent: c.after == null,
					...(before.follows ? { beforeFollows: true } : {}),
					...(after.follows ? { afterFollows: true } : {}),
					...(key === "faceMediaId" ? { noPreview: true } : {})
				}
			})
		}))
	}
}

const versionEcho = (params: unknown) => ({
	characterVersionId: (params as { characterVersionId?: unknown } | null)
		?.characterVersionId
})

export const characterVersionRedlinesHandler: Handler<
	Sockets.CharacterVersions.Redlines.Params,
	Sockets.CharacterVersions.Redlines.Response
> = refusable(
	"characterVersions:redlines",
	async (
		socket,
		params: Sockets.CharacterVersions.Redlines.Params,
		emitToUser
	) => {
		const res = await buildVersionRedlines(
			params?.characterVersionId,
			socket.user!.id
		)
		emitToUser("characterVersions:redlines", res)
		return res
	},
	"The edit history could not be read.",
	undefined,
	versionEcho
)

export const characterVersionRestoreRedlineHandler: Handler<
	Sockets.CharacterVersions.RestoreRedline.Params,
	Sockets.CharacterVersions.RestoreRedline.Response
> = refusable(
	"characterVersions:restoreRedline",
	async (
		socket,
		params: Sockets.CharacterVersions.RestoreRedline.Params,
		emitToUser
	) => {
		const userId = socket.user!.id
		if (!Number.isInteger(params?.redlineId)) throw new Error(NOT_KEPT)
		const [row] = (await db
			.select()
			.from(schema.loreRedlines)
			.where(eq(schema.loreRedlines.id, params.redlineId))
			.limit(1)) as RedlineRow[]
		if (!row || row.characterVersionId == null) throw new Error(NOT_KEPT)
		const access = await versionAccess(row.characterVersionId, userId)
		const keys = Object.keys(row.changes)
		const counted = new Set<string>(VERSION_REDLINE_KEYS)
		const gone = keys.find((k) => !counted.has(k))
		if (gone)
			throw new Error(
				`${versionLabel(gone)} is no longer part of a character profile.`
			)

		let versionId = row.characterVersionId
		if (access.cardId != null) {
			// Loaded at call time: `characters.ts` is a large module of its own.
			const { saveCard, restoreCardFace } = await import("./characters")
			const textKeys = keys.filter((k) => k !== "faceMediaId")
			if (textKeys.length) {
				// The version as the editor sends a card, each key's *before* laid over.
				const profile = { ...profileOf(access.row) } as Record<string, unknown>
				const blank = profileOf({}) as unknown as Record<string, unknown>
				for (const key of textKeys) {
					const before = row.changes[key].before
					profile[key] = before ? before.v : blank[key]
				}
				const {
					strokes: _strokes,
					avatarMediaId: _face,
					...columns
				} = cardColumnsOfProfile(profile as unknown as CharacterProfileV1)
				await saveCard(
					socket,
					{
						character: { id: access.cardId, ...columns },
						cardVersionId: versionId,
						...(textKeys.includes("likeness")
							? {
									likeness: profile.likeness as
										| Sockets.Characters.Update.Params["likeness"]
										| null
								}
							: {})
					} as unknown as Sockets.Characters.Update.Params,
					emitToUser,
					"restore"
				)
			}
			if (keys.includes("faceMediaId"))
				await restoreCardFace(
					socket,
					{
						cardId: access.cardId,
						versionId,
						mediaId:
							(row.changes.faceMediaId.before?.v as number | null) ?? null
					},
					emitToUser
				)
		} else {
			const lorebookId = access.lorebookId!
			if (!access.owner) throw new Error(NOT_THE_CHARACTER)
			const problem = await primerRowEditProblem(db, lorebookId)
			if (problem) throw new Error(problem)
			const changes: Record<string, unknown> = {}
			for (const key of keys) {
				const before = row.changes[key].before
				if (before) changes[key] = before.v
			}
			if (!Object.keys(changes).length) throw new Error(NOT_KEPT)
			await castRestoreProblem(socket.user, userId, lorebookId, access.row, changes)
			const updated = await db.transaction(async (txn) => {
				const tx = txn as unknown as Db
				await tx.execute(sql`select pg_advisory_xact_lock(${lorebookId})`)
				return updateCastVersion(
					tx,
					versionId,
					{ changes: changes as never },
					{ redline: { by: { userId }, cause: "restore" } }
				)
			})
			versionId = updated.id
			// What the member page's save sends after it, so the Member tab and the amendments list refresh.
			const { tellMemberSessions } = await import(
				"$lib/server/sessions/memberSessions"
			)
			const { relistBindings } = await import("./lorebooks")
			const { buildAmendmentsList } = await import("./amendments")
			await tellMemberSessions(
				socket.io,
				db,
				lorebookId,
				updated.castMemberId!
			)
			await relistBindings(socket, lorebookId, emitToUser)
			await emitToUser("amendments:list", () =>
				buildAmendmentsList(userId, lorebookId)
			)
		}

		// The reply is scoped on the version asked about; an edit that retired
		// and copied it sends the copy's list as well.
		const asked = row.characterVersionId
		const res: Sockets.CharacterVersions.RestoreRedline.Response = {
			redlineId: row.id,
			characterVersionId: asked
		}
		emitToUser("characterVersions:restoreRedline", res)
		for (const id of new Set([asked, versionId]))
			emitToUser(
				"characterVersions:redlines",
				await buildVersionRedlines(id, userId)
			)
		return res
	},
	"That edit could not be restored.",
	undefined,
	(params) => ({
		redlineId: (params as { redlineId?: unknown } | null)?.redlineId
	})
)

export const characterVersionClearRedlinesHandler: Handler<
	Sockets.CharacterVersions.ClearRedlines.Params,
	Sockets.CharacterVersions.ClearRedlines.Response
> = refusable(
	"characterVersions:clearRedlines",
	async (
		socket,
		params: Sockets.CharacterVersions.ClearRedlines.Params,
		emitToUser
	) => {
		const userId = socket.user!.id
		const access = await versionAccess(params?.characterVersionId, userId)
		if (!access.owner) throw new Error(OWNER_ONLY)
		const cleared = await clearRedlines(db, {
			characterVersionId: access.row.id
		})
		const res: Sockets.CharacterVersions.ClearRedlines.Response = {
			characterVersionId: access.row.id,
			cleared
		}
		emitToUser("characterVersions:clearRedlines", res)
		emitToUser(
			"characterVersions:redlines",
			await buildVersionRedlines(access.row.id, userId)
		)
		return res
	},
	"The edit history could not be cleared.",
	undefined,
	versionEcho
)

// ── A scene's edit history ──────────────────────────────────────────────────

const NOT_THE_SCENE = "Scene not found or access denied."
const GONE_MEMBER = "a cast member no longer in this lorebook"
const SCENE_LABELS: Record<string, string> = {
	participantCharacters: "Present",
	mentionedCharacters: "Mentioned"
}

/** The scene and its lorebook when `userId` may edit it, or a refusal. */
async function sceneAccess(sceneId: unknown, userId: number) {
	if (!Number.isInteger(sceneId)) throw new Error(NOT_THE_SCENE)
	const [scene] = await db
		.select({ id: schema.scenes.id, lorebookId: schema.scenes.lorebookId })
		.from(schema.scenes)
		.where(eq(schema.scenes.id, sceneId as number))
		.limit(1)
	if (!scene || !(await findOwnedBook(db, userId, scene.lorebookId)))
		throw new Error(NOT_THE_SCENE)
	return scene
}

const idList = (v: unknown): number[] =>
	Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n)) : []

/** A scene's Edit history as `asker` reads it, newest first; member ids shown as names. */
async function buildSceneRedlines(
	sceneId: number,
	asker: number
): Promise<Sockets.Scenes.Redlines.Response> {
	const scene = await sceneAccess(sceneId, asker)
	const rows = (await db
		.select()
		.from(schema.loreRedlines)
		.where(eq(schema.loreRedlines.sceneId, sceneId))
		.orderBy(desc(schema.loreRedlines.id))) as RedlineRow[]
	const whoOf = await whoReader(rows, asker)

	const ids = new Set<number>()
	for (const r of rows)
		for (const c of Object.values(r.changes))
			for (const side of [c.before, c.after])
				for (const id of idList(side?.v)) ids.add(id)
	const members = ids.size
		? await db
				.select({
					id: schema.lorebookBindings.id,
					name: schema.lorebookBindings.name,
					binding: schema.lorebookBindings.binding
				})
				.from(schema.lorebookBindings)
				.where(
					and(
						eq(schema.lorebookBindings.lorebookId, scene.lorebookId),
						inArray(schema.lorebookBindings.id, [...ids])
					)
				)
		: []
	const nameOf = new Map(members.map((m) => [m.id, m.name || m.binding]))
	const names = (v: unknown): string[] =>
		idList(v).map((id) => nameOf.get(id) ?? GONE_MEMBER)

	return {
		sceneId,
		lorebookId: scene.lorebookId,
		canRestore: !(await primerRowEditProblem(db, scene.lorebookId)),
		redlines: rows.map((r) => ({
			id: r.id,
			amendmentId: null,
			version: null,
			cause: r.cause as Sockets.RedlineView["cause"],
			who: whoOf(r),
			mine: r.userId === asker,
			at: (r.createdAt instanceof Date
				? r.createdAt
				: new Date(r.createdAt)
			).toISOString(),
			changes: Object.entries(r.changes).map(([key, c]) => ({
				key,
				label: SCENE_LABELS[key] ?? key,
				before: names(c.before?.v),
				after: names(c.after?.v),
				wasAbsent: c.before == null,
				nowAbsent: c.after == null
			}))
		}))
	}
}

export const sceneRedlinesHandler: Handler<
	Sockets.Scenes.Redlines.Params,
	Sockets.Scenes.Redlines.Response
> = refusable(
	"scenes:redlines",
	async (socket, params: Sockets.Scenes.Redlines.Params, emitToUser) => {
		const res = await buildSceneRedlines(params?.sceneId, socket.user!.id)
		emitToUser("scenes:redlines", res)
		return res
	},
	"The edit history could not be read.",
	undefined,
	(params) => ({ sceneId: (params as { sceneId?: unknown } | null)?.sceneId })
)

export const sceneRestoreRedlineHandler: Handler<
	Sockets.Scenes.RestoreRedline.Params,
	Sockets.Scenes.RestoreRedline.Response
> = refusable(
	"scenes:restoreRedline",
	async (
		socket,
		params: Sockets.Scenes.RestoreRedline.Params,
		emitToUser
	) => {
		const userId = socket.user!.id
		if (!Number.isInteger(params?.redlineId)) throw new Error(NOT_KEPT)
		const [row] = (await db
			.select()
			.from(schema.loreRedlines)
			.where(eq(schema.loreRedlines.id, params.redlineId))
			.limit(1)) as RedlineRow[]
		if (!row || row.sceneId == null) throw new Error(NOT_KEPT)
		const scene = await sceneAccess(row.sceneId, userId)

		// A role the row holds goes back to its earlier list; the other keeps its current one.
		const current = await readSceneCast(scene.id)
		const cast = {
			participantCharacters: row.changes.participantCharacters
				? idList(row.changes.participantCharacters.before?.v)
				: current.participantCharacters,
			mentionedCharacters: row.changes.mentionedCharacters
				? idList(row.changes.mentionedCharacters.before?.v)
				: current.mentionedCharacters
		}

		// Loaded at call time: `scenes.ts` is a large module of its own.
		const { saveSceneSummary } = await import("./scenes")
		const { scene: saved } = await saveSceneSummary({
			by: "person",
			userId,
			params: { scene: { id: scene.id, ...cast } } as Sockets.Scenes.Update.Params,
			io: socket.io,
			emitToUser,
			cause: "restore"
		})

		emitToUser("scenes:update", { scene: saved })
		const res: Sockets.Scenes.RestoreRedline.Response = {
			redlineId: row.id,
			sceneId: scene.id,
			lorebookId: scene.lorebookId
		}
		emitToUser("scenes:restoreRedline", res)
		emitToUser("scenes:redlines", await buildSceneRedlines(scene.id, userId))
		return res
	},
	"That edit could not be restored.",
	undefined,
	(params) => ({
		redlineId: (params as { redlineId?: unknown } | null)?.redlineId
	})
)

export function registerRedlineHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, entryRedlinesHandler, emitToUser)
	register(socket, entryRestoreRedlineHandler, emitToUser)
	register(socket, entryClearRedlinesHandler, emitToUser)
	register(socket, entryRedlineCountHandler, emitToUser)
	register(socket, characterVersionRedlinesHandler, emitToUser)
	register(socket, characterVersionRestoreRedlineHandler, emitToUser)
	register(socket, characterVersionClearRedlinesHandler, emitToUser)
	register(socket, sceneRedlinesHandler, emitToUser)
	register(socket, sceneRestoreRedlineHandler, emitToUser)
}

// ── Admin → Data ────────────────────────────────────────────────────────────

export const adminRedlineSummaryHandler: Handler<
	Sockets.Admin.RedlineSummary.Params,
	Sockets.Admin.RedlineSummary.Response
> = {
	event: "admin:redlineSummary",
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const res = await redlineSummary(db as unknown as Db)
		emitToUser("admin:redlineSummary", res)
		return res
	}
}

export const adminClearRedlinesHandler: Handler<
	Sockets.Admin.ClearRedlines.Params,
	Sockets.Admin.ClearRedlines.Response
> = {
	event: "admin:clearRedlines",
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const res = { cleared: await clearAllRedlines(db as unknown as Db) }
		emitToUser("admin:clearRedlines", res)
		return res
	}
}

export function registerAdminRedlineHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, adminRedlineSummaryHandler, emitToUser)
	register(socket, adminClearRedlinesHandler, emitToUser)
}
