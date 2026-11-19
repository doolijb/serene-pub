/**
 * 🚧 The merge (`foldInParent`) for the session's owner on a provided lorebook
 * the session reads: live, switched off, and kept at uninstall. The session's
 * own stored link is the proof of reading; nothing else is widened. A merged
 * live provided lorebook leaves the notes holding no card of the plugin's.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, inArray, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { FOLD_REFUSALS } from "$lib/shared/lorebooks/sessionNotes"
import { LOREBOOK_NOT_FOUND } from "$lib/server/utils/ownedBook"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

vi.mock(
	"$lib/server/pipelines/runtime/sessionEvents",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("$lib/server/pipelines/runtime/sessionEvents")
		>()),
		emitSessionEvent: () => {}
	})
)

let db: TestDb
let dataDir: string
let n = 0
const asDb = () => db as unknown as Db
const noEmit = () => {}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-foldprovided-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await db
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function user(label: string, isAdmin = false) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const u = await createTestUser(db, `fp-${label}-${++n}`)
	if (isAdmin)
		await db
			.update(schema.users)
			.set({ isAdmin: true })
			.where(eq(schema.users.id, u.id))
	return u
}

/**
 * A plugin's provided lorebook (kind `book`) with a hidden carrier card
 * (plugin-stamped), a member linked to it, a card-less member, a place whose
 * annotation names the card, and a member's session reading it, two seats and
 * two lines.
 */
async function world() {
	const { insertCard, insertCastMember } = await import(
		"$lib/server/characters/versions"
	)
	const { insertOwnBook, ownBookFor } = await import(
		"$lib/server/lorebooks/ownBook"
	)
	const admin = await user("admin", true)
	const m = await user("member")
	const k = ++n
	const pluginId = `acme.fp${k}`
	await db.insert(schema.plugins).values({
		pluginId,
		name: pluginId,
		version: "0.1.0",
		bundleSource: "",
		bundleHash: "x",
		enabled: true,
		manifest: {},
		adminDenied: []
	} as any)
	const uuid = crypto.randomUUID()
	const [book] = await db
		.insert(schema.lorebooks)
		.values({
			userId: admin.id,
			name: `Provided ${k}`,
			uuid,
			extraJson: {
				provided: {
					plugin: pluginId,
					slug: "world",
					version: "0.1.0",
					sha256: "x",
					uuid,
					entries: {}
				}
			}
		} as any)
		.returning()
	const { card } = await insertCard(asDb(), {
		userId: admin.id,
		name: `Pia ${k}`,
		description: "Pia keeps bees."
	})
	await db
		.update(schema.characters)
		.set({
			extensions: {
				serenepub: {
					provided: {
						plugin: pluginId,
						slug: "pia",
						version: "0.1.0",
						uuid: card.uuid
					}
				}
			}
		})
		.where(eq(schema.characters.id, card.id))
	const pia = await insertCastMember(asDb(), {
		lorebookId: book!.id,
		binding: "{{char:1}}",
		name: "",
		characterId: card.id
	} as any)
	const bruno = await insertCastMember(asDb(), {
		lorebookId: book!.id,
		binding: "{{char:2}}",
		name: "Bruno"
	} as any)
	await db
		.update(schema.lorebooks)
		.set({ nextBindingNumber: 3 })
		.where(eq(schema.lorebooks.id, book!.id))
	const [square] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book!.id,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: 1,
			title: "The square",
			content: "Pia sells honey here."
		} as any)
		.returning()
	await db.insert(schema.entryAnnotations).values([
		{
			entryId: square!.id,
			entityKey: `character:${card.id}`,
			surface: "Pia",
			normalized: "pia",
			tier: "gazetteer",
			characterId: card.id,
			extractorVersion: "t",
			sourceHash: "h",
			gazetteerHash: "g"
		},
		{
			entryId: square!.id,
			entityKey: `cast_member:${bruno.member.id}`,
			surface: "Bruno",
			normalized: "bruno",
			tier: "gazetteer",
			extractorVersion: "t",
			sourceHash: "h",
			gazetteerHash: "g"
		}
	] as any)
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: m.id,
			isGroup: false,
			name: `Run ${k}`,
			lorebookId: book!.id
		})
		.returning()
	await insertOwnBook(asDb(), {
		sessionId: session!.id,
		userId: m.id,
		name: null,
		overlayOf: book!.id,
		primaryRuleset: "core:ruleset/freeform@1",
		rulesetVersion: null
	})
	const notes = await ownBookFor(asDb(), session!.id)
	await db.insert(schema.sessionCharacters).values([
		{
			sessionId: session!.id,
			characterId: card.id,
			castMemberId: pia.member.id,
			isActive: true
		},
		{
			sessionId: session!.id,
			castMemberId: bruno.member.id,
			isActive: true,
			position: 1
		}
	] as any)
	const { insertSessionMessageRow } = await import(
		"$lib/server/pipelines/testing/fixtures"
	)
	await insertSessionMessageRow(db, session!.id, {
		role: "assistant",
		content: "Honey!",
		characterId: card.id,
		castMemberId: pia.member.id
	} as any)
	await insertSessionMessageRow(db, session!.id, {
		role: "assistant",
		content: "Grr.",
		castMemberId: bruno.member.id
	} as any)
	return {
		admin,
		m,
		pluginId,
		book: book!,
		card,
		pia: pia.member,
		bruno: bruno.member,
		session: session!,
		notesId: notes.id
	}
}
type World = Awaited<ReturnType<typeof world>>

/** The provided lorebook's own rows, as stored. */
async function rowsOf(bookId: number) {
	const entries = await db
		.select()
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, bookId))
		.orderBy(schema.lorebookEntries.id)
	return JSON.stringify({
		book: await db
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, bookId)),
		entries,
		members: await db
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, bookId))
			.orderBy(schema.lorebookBindings.id),
		annotations: await db
			.select()
			.from(schema.entryAnnotations)
			.where(
				inArray(
					schema.entryAnnotations.entryId,
					entries.map((e) => e.id)
				)
			)
			.orderBy(
				schema.entryAnnotations.entryId,
				schema.entryAnnotations.entityKey
			)
	})
}

async function reads(w: World) {
	const { sessionEntriesAsRead } = await import(
		"$lib/server/lorebooks/ownBook"
	)
	const read = await sessionEntriesAsRead(asDb(), w.session.id, "session", [
		LOCATION_TYPE_ID
	])
	return read.map((e) => e.name)
}

async function sessionRow(w: World) {
	const [row] = await db
		.select()
		.from(schema.sessions)
		.where(eq(schema.sessions.id, w.session.id))
	return row!
}

async function notesRow(w: World) {
	const [row] = await db
		.select()
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, w.notesId))
	return row!
}

const fold = async (w: World, userId = w.m.id) => {
	const { foldInParent } = await import("$lib/server/lorebooks/foldInParent")
	return foldInParent(asDb(), { sessionId: w.session.id, userId })
}

async function switchOff(w: World) {
	const { setProvidedBookDisabled } = await import(
		"$lib/server/plugins/providedBooks"
	)
	await setProvidedBookDisabled(asDb(), w.pluginId, "world", true, w.admin.id)
}

/** The uninstall that keeps: the plugin's lorebook stays (a session reads it), its cards go, then the plugin's row. */
async function keepAtUninstall(w: World) {
	const { deleteProvidedBooks } = await import(
		"$lib/server/plugins/providedBooks"
	)
	const out = await deleteProvidedBooks(asDb(), w.pluginId)
	expect(out.kept).toEqual([w.book.name])
	await db
		.delete(schema.plugins)
		.where(eq(schema.plugins.pluginId, w.pluginId))
}

async function notesMembers(w: World) {
	return db
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, w.notesId))
		.orderBy(schema.lorebookBindings.id)
}

async function notesAnnotationKeys(w: World) {
	const rows = await db
		.select({
			key: schema.entryAnnotations.entityKey,
			characterId: schema.entryAnnotations.characterId
		})
		.from(schema.entryAnnotations)
		.innerJoin(
			schema.lorebookEntries,
			eq(schema.lorebookEntries.id, schema.entryAnnotations.entryId)
		)
		.where(eq(schema.lorebookEntries.lorebookId, w.notesId))
	return rows
}

/** What each merge leaves: the session unlinked, the notes standing alone. */
async function expectMerged(w: World) {
	expect((await sessionRow(w)).lorebookId).toBeNull()
	expect((await notesRow(w)).overlayOf).toBeNull()
	expect(await reads(w)).toEqual(["The square"])
}

describe("the merge on a provided lorebook the session reads", () => {
	it("live: a member's own merge works, the lorebook is untouched, the notes hold no card of the plugin's", async () => {
		const w = await world()
		expect(await reads(w)).toEqual(["The square"])
		const before = await rowsOf(w.book.id)
		const seatNames = await seatReads(w)

		const out = await fold(w)
		expect(out.foldedFrom.id).toBe(w.book.id)
		await expectMerged(w)
		expect(await rowsOf(w.book.id)).toBe(before)

		const members = await notesMembers(w)
		expect(members).toHaveLength(2)
		expect(members.every((x) => x.characterId == null)).toBe(true)
		const keys = await notesAnnotationKeys(w)
		expect(keys.some((k) => k.key.startsWith("character:"))).toBe(false)
		expect(keys.every((k) => k.characterId !== w.card.id)).toBe(true)
		expect(keys.map((k) => k.key).every((k) => k.startsWith("cast_member:"))).toBe(
			true
		)

		const seats = await seatsOf(w)
		expect(seats.every((s) => s.castMemberId != null)).toBe(true)
		expect(
			seats.every((s) => members.some((x) => x.id === s.castMemberId))
		).toBe(true)
		expect(await seatReads(w)).toEqual(seatNames)

		// What still names the plugin's card afterwards: the session's seat and
		// lines, which the merge does not rewrite.
		const left = await survivors(w)
				expect(left.sessionCharacters).toBe(1)
		expect(left.sessionMessages).toBe(1)
		expect(left.notesMembers).toBe(0)
		expect(left.notesAnnotations).toBe(0)
		expect(left.notesVersionsFollowing).toBe(0)
	})

	it("switched off: the merge works the same", async () => {
		const w = await world()
		await switchOff(w)
		expect(await reads(w)).toEqual(["The square"])
		const before = await rowsOf(w.book.id)

		await fold(w)
		await expectMerged(w)
		expect(await rowsOf(w.book.id)).toBe(before)
		expect(
			(await notesMembers(w)).every((x) => x.characterId == null)
		).toBe(true)
		expect(
			(await notesAnnotationKeys(w)).some((k) => k.key.startsWith("character:"))
		).toBe(false)
		expect((await seatsOf(w)).every((s) => s.castMemberId != null)).toBe(true)
		const left = await survivors(w)
		expect(left.notesMembers).toBe(0)
		expect(left.notesAnnotations).toBe(0)
	})

	it("kept at uninstall: the merge keeps what the lorebook holds, as an ordinary lorebook's does", async () => {
		const w = await world()
		await keepAtUninstall(w)
		const { lorebookAccessFor } = await import("$lib/server/utils/ownedBook")
		expect(
			await lorebookAccessFor(w.book.id, w.m.id, { db: asDb(), isAdmin: false })
		).toBeNull()
		// Its members were made card-less at uninstall.
		const heldBefore = await db
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, w.book.id))
		expect(heldBefore.every((x) => x.characterId == null)).toBe(true)
		expect(await reads(w)).toEqual(["The square"])
		const before = await rowsOf(w.book.id)

		await fold(w)
		await expectMerged(w)
		expect(await rowsOf(w.book.id)).toBe(before)
		const members = await notesMembers(w)
		expect(members).toHaveLength(2)
		expect(members.every((x) => x.characterId == null)).toBe(true)
		const keys = await notesAnnotationKeys(w)
		const bookKeys = await db
			.select({ key: schema.entryAnnotations.entityKey })
			.from(schema.entryAnnotations)
			.innerJoin(
				schema.lorebookEntries,
				eq(schema.lorebookEntries.id, schema.entryAnnotations.entryId)
			)
			.where(eq(schema.lorebookEntries.lorebookId, w.book.id))
		const shape = (rows: Array<{ key: string }>) =>
			rows.map((k) => k.key.replace(/:\d+$/, ":#")).sort()
		expect(shape(keys)).toEqual(shape(bookKeys))
		expect(keys.some((k) => k.key === `character:${w.card.id}`)).toBe(true)
	})

	it("someone else: refused, and nothing they can read or list changes", async () => {
		const w = await world()
		await switchOff(w)
		const other = await user("other")
		const { lorebookAccessFor, assertReadableBook } = await import(
			"$lib/server/utils/ownedBook"
		)
		const { providedBooksReadableBy } = await import(
			"$lib/server/plugins/providedMarks"
		)
		const { lorebooksListHandler } = await import("$lib/server/sockets/lorebooks")
		const listed = async () =>
			(
				await lorebooksListHandler.handler(
					{ user: { id: other.id } } as any,
					{},
					noEmit
				)
			).lorebookList.map((l) => l.id)
		const readable = async () => [
			...(await providedBooksReadableBy(asDb(), other.id))
		]

		const listBefore = await listed()
		const readableBefore = await readable()
		await expect(fold(w, other.id)).rejects.toThrow(FOLD_REFUSALS.notOwner)
		expect(
			await lorebookAccessFor(w.book.id, other.id, { db: asDb(), isAdmin: false })
		).toBeNull()
		await expect(
			assertReadableBook(asDb(), other.id, w.book.id, { isAdmin: false })
		).rejects.toThrow(LOREBOOK_NOT_FOUND)

		await fold(w)
		expect(
			await lorebookAccessFor(w.book.id, other.id, { db: asDb(), isAdmin: false })
		).toBeNull()
		expect(await readable()).toEqual(readableBefore)
		expect(readableBefore).not.toContain(w.book.id)
		expect(await listed()).toEqual(listBefore)
		expect(listBefore).not.toContain(w.book.id)
	})

	it("the plugin disabled (the lorebook not switched off) hides nothing, and the merge works", async () => {
		const w = await world()
		const { providedBooksReadableBy } = await import(
			"$lib/server/plugins/providedMarks"
		)
		const other = await user("other")
		await db
			.update(schema.plugins)
			.set({ enabled: false })
			.where(eq(schema.plugins.pluginId, w.pluginId))
		expect([...(await providedBooksReadableBy(asDb(), other.id))]).toContain(
			w.book.id
		)
		expect(await reads(w)).toEqual(["The square"])
		const before = await rowsOf(w.book.id)

		await fold(w)
		await expectMerged(w)
		expect(await rowsOf(w.book.id)).toBe(before)
		expect(
			(await notesMembers(w)).every((x) => x.characterId == null)
		).toBe(true)
	})

	it("merged, then the plugin is uninstalled: the session still loads, seats named, earlier lines keep their speaker", async () => {
		const w = await world()
		await fold(w)
		const seatNames = await seatReads(w)
		const linesBefore = await db
			.select({ id: schema.sessionMessages.id, castMemberId: schema.sessionMessages.castMemberId })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, w.session.id))
			.orderBy(schema.sessionMessages.id)

		// Nothing reads the lorebook any more, so uninstall removes it and the card.
		const { deleteProvidedBooks } = await import("$lib/server/plugins/providedBooks")
		const out = await deleteProvidedBooks(asDb(), w.pluginId)
		expect(out.kept).toEqual([])
		expect(out.books).toBe(1)
		// A hard delete of the card too: both columns clear to null, no row is lost.
		await db.delete(schema.characters).where(eq(schema.characters.id, w.card.id))
		await db.delete(schema.plugins).where(eq(schema.plugins.pluginId, w.pluginId))

		const seats = await seatsOf(w)
		expect(seats).toHaveLength(2)
		expect(seats.every((x) => x.characterId == null && x.castMemberId != null)).toBe(true)
		expect(await seatReads(w)).toEqual(seatNames)
		expect(seatNames.map((x) => x[0]).every((x) => typeof x === "string" && x.length > 0)).toBe(true)
		const lines = await db
			.select({ id: schema.sessionMessages.id, castMemberId: schema.sessionMessages.castMemberId, characterId: schema.sessionMessages.characterId })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, w.session.id))
			.orderBy(schema.sessionMessages.id)
		expect(lines.map((l) => [l.id, l.castMemberId])).toEqual(
			linesBefore.map((l) => [l.id, l.castMemberId])
		)
		expect(lines.every((l) => l.characterId == null)).toBe(true)
		const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
		const speakers = await membersAsRead(asDb(), lines.map((l) => l.castMemberId!))
		expect([...speakers.values()].every((r) => !!r.name)).toBe(true)
	})

	it("an ordinary lorebook's merge keeps its members' cards", async () => {
		const w = await world()
		// The lorebook is the administrator's ordinary lorebook: no mark.
		await db
			.update(schema.lorebooks)
			.set({ extraJson: {} })
			.where(eq(schema.lorebooks.id, w.book.id))
		await fold(w)
		await expectMerged(w)
		const members = await notesMembers(w)
		expect(members).toHaveLength(2)
		expect(members.filter((x) => x.characterId === w.card.id)).toHaveLength(1)
		expect(
			(await notesAnnotationKeys(w)).some(
				(k) => k.key === `character:${w.card.id}`
			)
		).toBe(true)
	})
})

async function seatsOf(w: World) {
	return db
		.select()
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, w.session.id))
		.orderBy(schema.sessionCharacters.id)
}

/** Each seat's member as read: the name and description the prompt would use. */
async function seatReads(w: World) {
	const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
	const seats = await seatsOf(w)
	const read = await membersAsRead(
		asDb(),
		seats.map((s) => s.castMemberId!).filter((id) => id != null)
	)
	return seats.map((s) => {
		const r = read.get(s.castMemberId!)
		return [r?.name, r?.description]
	})
}

/** What names the plugin's card (or its members), counted. */
async function survivors(w: World) {
	const count = async (query: ReturnType<typeof sql>) =>
		Number((await db.execute(query)).rows[0]!.n)
	const cardId = w.card.id
	return {
		sessionCharacters: await count(
			sql`select count(*) n from session_characters where session_id = ${w.session.id} and character_id = ${cardId}`
		),
		sessionMessages: await count(
			sql`select count(*) n from session_messages where session_id = ${w.session.id} and character_id = ${cardId}`
		),
		messages: await count(
			sql`select count(*) n from messages where session_id = ${w.session.id} and character_id = ${cardId}`
		),
		notesMembers: await count(
			sql`select count(*) n from lorebook_bindings where lorebook_id = ${w.notesId} and character_id = ${cardId}`
		),
		notesAnnotations: await count(
			sql`select count(*) n from entry_annotations a join lorebook_entries e on e.id = a.entry_id where e.lorebook_id = ${w.notesId} and (a.character_id = ${cardId} or a.entity_key = ${`character:${cardId}`})`
		),
		notesVersionsFollowing: await count(
			sql`select count(*) n from character_versions v join lorebook_bindings b on b.id = v.cast_member_id where b.lorebook_id = ${w.notesId} and cardinality(v.follows) > 0`
		),
		spriteSets: await count(
			sql`select count(*) n from sprite_sets s join lorebook_bindings b on b.id = s.cast_member_id where b.lorebook_id = ${w.notesId} and s.character_id = ${cardId}`
		),
		cardVersions: await count(
			sql`select count(*) n from character_versions where card_id = ${cardId}`
		),
		cardFkColumns: (
			await db.execute(sql`
				select c.conrelid::regclass::text as tbl, a.attname as col
				from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
				where c.contype = 'f' and c.confrelid = 'characters'::regclass
			`)
		).rows.map((r: any) => `${r.tbl}.${r.col}`)
	}
}

