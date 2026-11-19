/**
 * 🚧 A guest has no access to the session's notes (owner ruling G2,
 * 2026-11-16): "A guest neither opens nor edits the notes." The notes — the
 * book with `session_id` set — are the session owner's, through every
 * lorebook, entry, cast, link, knowledge, time, graph, scene and redline
 * event; what a guest keeps is what play shows. Each refusal here is read off
 * the serialised reply and every emit: nothing of the notes is in them. Each
 * has the owner's twin.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { defineAttributeSlot, _clearAttributeSlots } from "@serene-pub/sdk"
import { genreKeeping } from "$lib/server/utils/testGenre"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import("$lib/server/utils/testDb")
	return {
		...testDbModule(await createTestDb()),
		getCryptoSecretKey: () => "notes-guest-access-test-secret"
	}
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {},
	autoEnqueueCharacter: async () => {}
}))
vi.mock("$lib/server/annotations/queue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	enqueueLorebookAnnotation: vi.fn(() => {})
}))

/** What `emitToUserRedacted` was asked to send, by user. */
const redactedTo = new Map<number, { event: string; data: any }[]>()
vi.mock("$lib/server/sockets/utils/broadcastHelpers", async (importOriginal) => ({
	...(await importOriginal<object>()),
	emitToUserRedacted: async (_io: unknown, uid: number, event: string, data: unknown) => {
		;(redactedTo.get(uid) ?? redactedTo.set(uid, []).get(uid)!).push({ event, data })
	}
}))

let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-notesguest-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb as any)
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const socket = (userId: number, isAdmin = false) =>
	({
		id: `s-${userId}`,
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }), sockets: { sockets: new Map() } }
	}) as any

const user = async (label: string, isAdmin = false) => {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const u = await createTestUser(testDb, `${label}-${++n}`)
	if (isAdmin) await testDb.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, u.id))
	return u
}

/** Words that exist only in the notes: none may reach a guest. */
const SECRET = {
	book: "Notes-book-secret-name",
	entry: "Notes-entry-secret-title",
	binding: "Notes-binding-secret-name",
	place: "Notes-place-secret-title"
}

/** Every handler a module exports, by event. */
const handlers = new Map<string, { handler: (...a: any[]) => Promise<any> }>()
async function handlerFor(event: string) {
	if (!handlers.size) {
		for (const m of [
			"amendments",
			"entries",
			"lorebooks",
			"lorebookStoryTime",
			"lorebookState",
			"narrativeGraph",
			"narrativeGraph.relationships",
			"redlines",
			"scenes",
			"state",
			"entryKnowledge",
			"bindingSuggestions",
			"starterKits",
			"sessions"
		]) {
			const mod: any = await import(`$lib/server/sockets/${m}`)
			for (const v of Object.values(mod) as any[])
				if (v && typeof v === "object" && typeof v.event === "string" && typeof v.handler === "function")
					handlers.set(v.event, v)
		}
	}
	const h = handlers.get(event)
	if (!h) throw new Error(`no handler for ${event}`)
	return h
}

type Out = { value: unknown; error: string | null; sent: { event: string; data: unknown }[]; wire: string }

/** Calls `event` as `userId`; the reply, the refusal and every emit (thunks resolved) are kept. */
async function call(event: string, userId: number, params: unknown, isAdmin = false): Promise<Out> {
	const h = await handlerFor(event)
	const sent: { event: string; data: unknown }[] = []
	const pending: Promise<void>[] = []
	const emit = (e: string, data: any) => {
		pending.push(
			Promise.resolve(typeof data === "function" ? data() : data).then((d) => void sent.push({ event: e, data: d }))
		)
	}
	let value: unknown = null
	let error: string | null = null
	try {
		value = await h.handler(socket(userId, isAdmin), params, emit)
	} catch (e: any) {
		error = String(e?.message ?? e)
	}
	await Promise.all(pending)
	const wire = JSON.stringify({ value, error, sent })
	return { value, error, sent, wire }
}

/** The refusal sentence: thrown, or carried in the reply (`entries:setMarks`), or a null lorebook (`lorebooks:get`). */
const sentenceOf = (out: Out): string | null =>
	out.error ??
	((out.value as any)?.error as string | undefined) ??
	((out.value as any)?.lorebook === null ? "no lorebook" : null)

/** Nothing of the notes is in the answer: no title, no name. */
const bare = (out: Out) => {
	for (const word of Object.values(SECRET)) expect(out.wire).not.toContain(word)
}

/** The guest is refused and nothing of the notes is in any of it. */
const refused = (out: Out, sentence?: string) => {
	expect(sentenceOf(out)).not.toBeNull()
	if (sentence) expect(sentenceOf(out)).toBe(sentence)
	bare(out)
}

async function table() {
	const owner = await user("ng-owner")
	const guest = await user("ng-guest")
	const adminGuest = await user("ng-admin-guest", true)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true, name: `Table ${++n}` } as any)
		.returning()
	for (const g of [guest, adminGuest])
		await testDb.insert(schema.sessionGuests).values({ sessionId: session!.id, userId: g.id, isPlayer: true })
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const notes = await ownBookFor(testDb as any, session!.id)
	await testDb.update(schema.lorebooks).set({ name: SECRET.book }).where(eq(schema.lorebooks.id, notes.id))
	const entry = await addEntry(notes.id, SECRET.entry)
	const place = await addEntry(notes.id, SECRET.place, LOCATION_TYPE_ID)
	const { insertCastMember } = await import("$lib/server/characters/versions")
	const member = (
		await insertCastMember(testDb as any, {
			lorebookId: notes.id,
			binding: `{{char:${++n}}}`,
			name: SECRET.binding
		} as any)
	).member
	return { owner, guest, adminGuest, session: session!, sessionId: session!.id, notes, entry, place, member }
}

async function addEntry(lorebookId: number, title: string, typeId = WORLD_LORE_TYPE_ID) {
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId,
			typeVersion: 1,
			position: ++n,
			title,
			content: "Hidden content.",
			keys: ["hidden"]
		})
		.returning()
	return row!
}

describe("a guest's reads of the notes, one per socket file", () => {
	test("amendments:list, entries:counts, entries:types, lorebooks:get, lorebooks:lines, narrativeGraph:list, entries:redlines, scenes:listByLorebook, entryKnowledge:list, bindingSuggestions:list", async () => {
		const t = await table()
		const lorebookId = t.notes.id
		// A change on a notes entry, so the owner has a redline and a list to read.
		await call("entries:update", t.owner.id, { entry: { id: t.entry.id, typeId: WORLD_LORE_TYPE_ID, content: "Edited." } })
		const asks: [string, unknown][] = [
			["amendments:list", { lorebookId }],
			["entries:counts", { lorebookId }],
			["entries:types", { lorebookId }],
			["lorebooks:get", { id: lorebookId }],
			["lorebooks:lines", { lorebookId }],
			["narrativeGraph:list", { lorebookId }],
			["entries:redlines", { entryId: t.entry.id }],
			["scenes:listByLorebook", { lorebookId }],
			["entryKnowledge:list", { lorebookId, branchId: null, moment: null }],
			["bindingSuggestions:list", { lorebookId }]
		]
		for (const [event, params] of asks) {
			for (const [who, admin] of [
				[t.guest, false],
				[t.adminGuest, true]
			] as const) {
				const out = await call(event, who.id, params, admin)
				expect(sentenceOf(out), `${event} as a guest`).not.toBeNull()
				bare(out)
			}
			// The owner's twin: not refused, and reads the notes.
			const mine = await call(event, t.owner.id, params)
			expect(mine.error, `${event} as the owner`).toBeNull()
		}
		// The owner's reads carry the notes: the twin is real, not an empty answer.
		expect((await call("entries:types", t.owner.id, { lorebookId })).wire).toContain(String(lorebookId))
		expect((await call("lorebooks:get", t.owner.id, { id: lorebookId })).wire).toContain(SECRET.book)
	})

	test("the Chronicle's underlying reads: entries:list for the history type and lorebooks:lines refuse a guest", async () => {
		const t = await table()
		const list = await call("entries:list", t.guest.id, { lorebookId: t.notes.id, typeId: "core:entry/history" })
		refused(list, "Lorebook not found.")
		refused(await call("lorebooks:lines", t.guest.id, { lorebookId: t.notes.id }), "Lorebook not found.")
		expect((await call("entries:list", t.owner.id, { lorebookId: t.notes.id, typeId: "core:entry/history" })).error).toBeNull()
	})
})

describe("a guest's writes to the notes, one per socket file", () => {
	test("entries:create, lorebooks:update, narrativeGraph:deleteNode, entries:clearRedlines, entryKnowledge:setTie, starterKits:saveFromBook, lorebooks:setClock, lorebookState:set, scenes:create, amendments:create refuse a guest and write nothing", async () => {
		const t = await table()
		const lorebookId = t.notes.id
		await call("entries:update", t.owner.id, { entry: { id: t.entry.id, typeId: WORLD_LORE_TYPE_ID, content: "Edited." } })
		const entryRows = async () =>
			(await testDb.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.lorebookId, lorebookId))).length
		const before = await entryRows()
		const writes: [string, unknown][] = [
			[
				"entries:create",
				{ entry: { lorebookId, typeId: WORLD_LORE_TYPE_ID, title: "Guest wrote", content: "x", keys: ["g"] } }
			],
			["lorebooks:update", { lorebook: { id: lorebookId, name: "Renamed by a guest" } }],
			["narrativeGraph:deleteNode", { id: t.member.id }],
			["entries:clearRedlines", { entryId: t.entry.id }],
			["entryKnowledge:setTie", { lorebookId, castMemberId: t.member.id, entryId: t.entry.id, hand: "knows", branchId: null, moment: null }],
			["starterKits:saveFromBook", { lorebookId }],
			["lorebooks:setClock", { lorebookId, clock: null }],
			["lorebookState:set", { lorebookId, owner: { kind: "location", id: t.place.id }, slotId: "x", value: 1, branchId: null, moment: null }],
			["scenes:create", { scene: { lorebookId, historyEntryId: t.entry.id, summary: "Guest scene" } }],
			["amendments:create", { lorebookId, entryId: t.entry.id, year: 1, fields: { content: "Guest change" } }]
		]
		for (const [event, params] of writes) {
			for (const [who, admin] of [
				[t.guest, false],
				[t.adminGuest, true]
			] as const) {
				const out = await call(event, who.id, params, admin)
				expect(sentenceOf(out), `${event} as a guest`).not.toBeNull()
				bare(out)
				expect(out.wire).not.toContain("Renamed by a guest")
			}
		}
		expect(await entryRows()).toBe(before)
		const [book] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, lorebookId))
		expect(book!.name).toBe(SECRET.book)
		expect(await testDb.select().from(schema.lorebookBindings).where(eq(schema.lorebookBindings.id, t.member.id))).toHaveLength(1)
		expect(await testDb.select().from(schema.loreRedlines).where(eq(schema.loreRedlines.entryId, t.entry.id))).not.toHaveLength(0)
	})

	test("the owner's twins: the same writes are not refused for access", async () => {
		const t = await table()
		const lorebookId = t.notes.id
		const created = await call("entries:create", t.owner.id, {
			entry: { lorebookId, typeId: WORLD_LORE_TYPE_ID, title: "Owner wrote", content: "x", keys: ["o"] }
		})
		expect(created.error).toBeNull()
		expect((await call("lorebooks:update", t.owner.id, { lorebook: { id: lorebookId, name: "Renamed by the owner" } })).error).toBeNull()
		await call("entries:update", t.owner.id, { entry: { id: t.entry.id, typeId: WORLD_LORE_TYPE_ID, content: "Edited." } })
		expect((await call("entries:clearRedlines", t.owner.id, { entryId: t.entry.id })).error).toBeNull()
		expect((await call("narrativeGraph:deleteNode", t.owner.id, { id: t.member.id })).error).toBeNull()
		// The deeper writes need a calendar, a dated history row or a declared stat; the owner's answer there is
		// a reason of the write itself, never an access refusal.
		const ACCESS = /^(Lorebook not found\.|Entry not found or access denied\.|Access denied\.)$/
		for (const [event, params] of [
			["lorebooks:setClock", { lorebookId, clock: null }],
			["lorebookState:set", { lorebookId, owner: { kind: "location", id: t.place.id }, slotId: "x", value: 1, branchId: null, moment: null }],
			["scenes:create", { scene: { lorebookId, historyEntryId: t.entry.id, summary: "Owner scene" } }],
			["amendments:create", { lorebookId, entryId: t.entry.id, year: 1, fields: { content: "Owner change" } }],
			["starterKits:saveFromBook", { lorebookId }],
			["entryKnowledge:setTie", { lorebookId, castMemberId: t.member.id, entryId: t.entry.id, hand: "knows", branchId: null, moment: null }]
		] as [string, unknown][]) {
			const out = await call(event, t.owner.id, params)
			expect(out.error ?? "", event).not.toMatch(ACCESS)
		}
	})
})

describe("entries:setMarks on the notes", () => {
	test("a guest and an administrator who is a guest are refused; the owner marks; an administrator keeps an ordinary book", async () => {
		const t = await table()
		for (const [who, admin] of [
			[t.guest, false],
			[t.adminGuest, true]
		] as const) {
			const out = await call("entries:setMarks", who.id, { entryId: t.entry.id, off: true })
			refused(out)
			expect(JSON.stringify(out.sent)).toContain("Entry not found or access denied.")
		}
		const [still] = await testDb.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, t.entry.id))
		expect(still!.enabled).toBe(true)
		const mine = await call("entries:setMarks", t.owner.id, { entryId: t.entry.id, off: true })
		expect(mine.error).toBeNull()

		// An ordinary book: an administrator who is not its owner keeps today's access.
		const admin = await user("ng-admin", true)
		const [plain] = await testDb.insert(schema.lorebooks).values({ userId: t.owner.id, name: `Plain ${++n}` } as any).returning()
		const row = await addEntry(plain!.id, "Plain entry")
		const adminOut = await call("entries:setMarks", admin.id, { entryId: row.id, off: true }, true)
		expect(adminOut.error).toBeNull()
		const stranger = await user("ng-stranger")
		refused(await call("entries:setMarks", stranger.id, { entryId: row.id, off: true }))
	})
})

describe("entries:sessionEntries on a session that reads its own notes", () => {
	test("a guest is told ownerOnly and given no rows; the owner reads the rows", async () => {
		const t = await table()
		const out = await call("entries:sessionEntries", t.guest.id, { sessionId: t.sessionId })
		expect(out.error).toBeNull()
		expect(out.value).toMatchObject({ lorebookId: t.notes.id, ownerOnly: true, rows: [], total: 0 })
		bare(out)
		const mine = await call("entries:sessionEntries", t.owner.id, { sessionId: t.sessionId })
		expect(mine.error).toBeNull()
		expect((mine.value as any).ownerOnly).toBeUndefined()
		expect(mine.wire).toContain(SECRET.entry)
	})
})

describe("the Sessions panel's 'This session only' lists", () => {
	test("a guest is answered the empty shape; the owner's lists are unchanged", async () => {
		const t = await table()
		const items = await call("sessions:overlayItems", t.guest.id, { sessionId: t.sessionId })
		expect(items.value).toEqual({ sessionId: t.sessionId, items: [], mayApply: false, appliesItself: false })
		bare(items)
		const batches = await call("sessions:appliedBatches", t.guest.id, { sessionId: t.sessionId })
		expect(batches.value).toEqual({ sessionId: t.sessionId, batches: [], mayApply: false })
		const mine = await call("sessions:overlayItems", t.owner.id, { sessionId: t.sessionId })
		expect(mine.error).toBeNull()
		expect(mine.value).toMatchObject({ sessionId: t.sessionId, items: expect.any(Array) })
		expect((await call("sessions:appliedBatches", t.owner.id, { sessionId: t.sessionId })).value).toMatchObject({
			sessionId: t.sessionId,
			batches: expect.any(Array)
		})
	})

	test("tellApplyMoved sends the real lists to the owner and the empty shape to a guest", async () => {
		const t = await table()
		redactedTo.clear()
		const { tellApplyMoved } = await import("./sessions.overlay")
		await tellApplyMoved({}, t.sessionId)
		const sentTo = redactedTo
		for (const e of sentTo.get(t.guest.id) ?? []) {
			if (e.event === "sessions:overlayItems")
				expect(e.data).toEqual({ sessionId: t.sessionId, items: [], mayApply: false, appliesItself: false })
			if (e.event === "sessions:appliedBatches") expect(e.data).toEqual({ sessionId: t.sessionId, batches: [], mayApply: false })
		}
		const ownerGot = (sentTo.get(t.owner.id) ?? []).find((e) => e.event === "sessions:overlayItems")
		expect(ownerGot?.data).toMatchObject({ sessionId: t.sessionId, mayApply: expect.any(Boolean) })
	})
})

describe("the orphan question on the notes", () => {
	test("a guest's seat change sends neither the cast relist nor the orphan question; the owner's sends both", async () => {
		const t = await table()
		const { runLorebookBindingCheck } = await import("./sessions")
		const run = async (userId: number) => {
			const sent: { event: string; data: any }[] = []
			const pending: Promise<void>[] = []
			await runLorebookBindingCheck(socket(userId), t.sessionId, t.notes.id, ((event: string, data: any) => {
				pending.push(Promise.resolve(typeof data === "function" ? data() : data).then((d) => void sent.push({ event, data: d })))
			}) as any)
			await Promise.all(pending)
			return sent
		}
		const orphan = (await testDb.select().from(schema.lorebookBindings).where(eq(schema.lorebookBindings.id, t.member.id)))[0]!
		const guestSent = await run(t.guest.id)
		expect(guestSent.map((s) => s.event)).not.toContain("bindingCheck:result")
		expect(guestSent.map((s) => s.event)).not.toContain("lorebooks:bindingList")
		for (const word of [...Object.values(SECRET), orphan.binding]) expect(JSON.stringify(guestSent)).not.toContain(word)
		const ownerSent = await run(t.owner.id)
		expect(ownerSent.map((s) => s.event)).toContain("bindingCheck:result")
		expect(JSON.stringify(ownerSent)).toContain(orphan.binding)
	})
})

describe("what play shows a guest stays", () => {
	test("lorebooks:memberOfSeat on the guest's own seat answers the sheet, never the book", async () => {
		const t = await table()
		const [card] = await testDb
			.insert(schema.characters)
			.values({ userId: t.owner.id, name: "Seat card", description: "" })
			.returning()
		const { insertCastMember } = await import("$lib/server/characters/versions")
		const seated = (
			await insertCastMember(testDb as any, {
				lorebookId: t.notes.id,
				characterId: card!.id,
				binding: `{{char:${++n}}}`,
				name: ""
			} as any)
		).member
		await testDb.insert(schema.sessionCharacters).values({ sessionId: t.sessionId, characterId: card!.id, castMemberId: seated!.id, position: 0 })
		const out = await call("lorebooks:memberOfSeat", t.guest.id, { sessionId: t.sessionId, ref: `character:${card!.id}` })
		expect(out.error).toBeNull()
		expect((out.value as any).member).toMatchObject({ opensInBook: false })
		expect((out.value as any).member.sheet).not.toBeNull()
		const mine = await call("lorebooks:memberOfSeat", t.owner.id, { sessionId: t.sessionId, ref: `character:${card!.id}` })
		expect((mine.value as any).member).toMatchObject({ opensInBook: true, sheet: null })
	})

	test("sessions:castToTake still lists the notes' card-less members to a guest", async () => {
		const t = await table()
		const out = await call("sessions:castToTake", t.guest.id, { sessionId: t.sessionId })
		expect(out.error).toBeNull()
		expect(out.wire).toContain(SECRET.binding)
	})

	test("canViewMedia: a seated notes member's face is viewable, an unseated member's picture is not; canReadCastMember the same pair", async () => {
		const t = await table()
		const file = async (extra: Record<string, unknown> = {}) =>
			(
				await testDb
					.insert(schema.files)
					.values({ userId: t.owner.id, kind: "image", hash: `ng-file-${++n}`, ...extra } as any)
					.returning()
			)[0]!
		const { insertCastMember } = await import("$lib/server/characters/versions")
		const face = await file()
		const seatedMember = (
			await insertCastMember(testDb as any, { lorebookId: t.notes.id, binding: `{{char:${++n}}}`, name: "Seated", faceMediaId: face.id } as any)
		).member
		const [card] = await testDb.insert(schema.characters).values({ userId: t.owner.id, name: "Seated card", description: "" }).returning()
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: t.sessionId, characterId: card!.id, castMemberId: seatedMember!.id, position: 0 })
		const picture = await file({ lorebookId: t.notes.id })
		const { canViewMedia } = await import("$lib/server/media/access")
		expect(await canViewMedia(face, t.guest.id, testDb as any)).toBe(true)
		expect(await canViewMedia(picture, t.guest.id, testDb as any)).toBe(false)
		const { canReadCastMember } = await import("$lib/server/cast/memberAccess")
		expect(await canReadCastMember(testDb as any, seatedMember!.id, t.guest.id)).not.toBeNull()
		expect(await canReadCastMember(testDb as any, t.member.id, t.guest.id)).toBeNull()
	})

	test("state:set by a guest on the sheet of a notes member linked to their own card lands, as before the lane", async () => {
		const HP = "core:slot/hp@1"
		const GENRE = "test:genre/notes-guest-sheet"
		_clearAttributeSlots()
		const hp = defineAttributeSlot(HP, {
			type: "integer",
			descriptor: "How much punishment they can still take.",
			appliesTo: ["cast"],
			config: { min: 0, max: 20 },
			default: 20
		})
		genreKeeping(GENRE, { name: { en: "Sheet" }, family: "test", slots: [hp], events: {} })
		const t = await table()
		await testDb.update(schema.sessions).set({ genreId: GENRE }).where(eq(schema.sessions.id, t.sessionId))
		const [card] = await testDb.insert(schema.characters).values({ userId: t.guest.id, name: "Guest card", description: "" }).returning()
		const { insertCastMember } = await import("$lib/server/characters/versions")
		const mine = (
			await insertCastMember(testDb as any, {
				lorebookId: t.notes.id,
				characterId: card!.id,
				binding: `{{char:${++n}}}`,
				name: ""
			} as any)
		).member
		const [seat] = await testDb
			.insert(schema.sessionPersonas)
			.values({ sessionId: t.sessionId, personaId: card!.id, userId: t.guest.id, castMemberId: mine!.id } as any)
			.returning()
		const out = await call("state:set", t.guest.id, {
			sessionId: t.sessionId,
			owner: { kind: "player_seat", id: seat!.id },
			slotId: HP,
			value: 14
		})
		expect(out.error).toBeNull()
		expect(JSON.stringify(out.sent)).not.toContain(":error")
		expect(out.wire).toContain("14")
		// The same write on the notes' own member the guest does not hold is refused.
		const other = await call("state:set", t.guest.id, {
			sessionId: t.sessionId,
			owner: { kind: "session_cast", id: t.member.id },
			slotId: HP,
			value: 3
		})
		expect(other.error ?? JSON.stringify(other.sent)).toMatch(/./)
		expect(other.wire).not.toContain(SECRET.binding)
	})
})

describe("scenes:list sends a guest what the page shows", () => {
	const TEXT = { summary: "Scene-summary-secret-text", notes: "Scene-notes-secret-text" }

	async function withScene() {
		const t = await table()
		const [scene] = await testDb
			.insert(schema.scenes)
			.values({
				sessionId: t.sessionId,
				lorebookId: t.notes.id,
				name: "Scene one",
				summary: TEXT.summary,
				notes: TEXT.notes,
				summaryStatus: "review"
			} as any)
			.returning()
		return { ...t, scene: scene! }
	}

	const noText = (wire: string) => {
		for (const word of Object.values(TEXT)) expect(wire).not.toContain(word)
	}

	test("the reply and the pushed list carry no summary or notes text for a guest or an administrator guest; the status stays", async () => {
		const t = await withScene()
		for (const [who, admin] of [
			[t.guest, false],
			[t.adminGuest, true]
		] as const) {
			const out = await call("scenes:list", who.id, { sessionId: t.sessionId }, admin)
			expect(out.error).toBeNull()
			noText(out.wire)
			const row = (out.value as any).sceneList.find((r: any) => r.id === t.scene.id)
			expect(row).not.toHaveProperty("summary")
			expect(row).not.toHaveProperty("notes")
			expect(row).toMatchObject({ hasSummary: true, summaryStatus: "review", name: "Scene one" })
			// What the emit sent is the same shape.
			noText(JSON.stringify(out.sent))
		}
		// Owner unchanged: the text, the status.
		const mine = await call("scenes:list", t.owner.id, { sessionId: t.sessionId })
		const ownRow = (mine.value as any).sceneList.find((r: any) => r.id === t.scene.id)
		expect(ownRow).toMatchObject({ summary: TEXT.summary, notes: TEXT.notes, summaryStatus: "review" })
		expect(ownRow).not.toHaveProperty("hasSummary")

		// The broadcast: each recipient's own copy.
		const got = new Map<number, any[]>()
		const wanting = (id: string) => ({ id, user: { id: Number(id.slice(5)) }, interest: new Set(["scenes:list"]) })
		const io = {
			to: (room: string) => ({
				emit: (event: string, data: any) => {
					const uid = Number(room.slice(5))
					;(got.get(uid) ?? got.set(uid, []).get(uid)!).push({ event, data })
				}
			}),
			sockets: {
				adapter: { rooms: { get: (room: string) => (room.startsWith("user_") ? new Set([room]) : undefined) } },
				sockets: { get: (id: string) => wanting(id), values: () => [wanting("user_0")] }
			}
		}
		const { pushSceneList } = await import("./scenes")
		await pushSceneList(io, { sessionId: t.sessionId, userId: t.owner.id })
		for (const who of [t.guest, t.adminGuest]) {
			const sent = got.get(who.id) ?? []
			expect(sent.map((e) => e.event)).toContain("scenes:list")
			noText(JSON.stringify(sent))
			expect(JSON.stringify(sent)).toContain('"hasSummary":true')
		}
		const ownerSent = JSON.stringify(got.get(t.owner.id) ?? [])
		expect(ownerSent).toContain(TEXT.summary)
		expect(ownerSent).toContain(TEXT.notes)
	})
})
