/**
 * 🚧 One write predicate (`canWriteLorebook`) and the Apply verbs built on it:
 * Apply and Take back belong to the session's owner AND the lorebook's
 * writer. A live provided lorebook is read, never written, by anyone, the
 * enabling administrator included; a lorebook kept at uninstall is ordinary.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	defineAttributeSlot,
	_clearAttributeSlots
} from "@serene-pub/sdk"
import { genreKeeping } from "$lib/server/utils/testGenre"
import {
	liveProvidedBookSql,
	markedBook,
	primerRowEditRefusal,
	providedOwnerPresent
} from "$lib/server/plugins/providedMarks"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
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
const lore = () => import("$lib/server/lorebooks/ownBook")
const noEmit = () => {}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-ap1-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const socketOf = (userId: number, io: unknown = {}) =>
	({ user: { id: userId }, io }) as any

async function user(label: string, isAdmin = false) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const u = await createTestUser(db, `ap1-${label}-${++n}`)
	if (isAdmin)
		await db
			.update(schema.users)
			.set({ isAdmin: true })
			.where(eq(schema.users.id, u.id))
	return u
}

/** A session owned by `sessionOwner` on `bookId`, its notes holding `held` entries. */
async function sessionOn(bookId: number, sessionOwner: number, held = 3) {
	const suffix = `${++n}`
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: sessionOwner,
			isGroup: true,
			name: `Run ${suffix}`,
			lorebookId: bookId
		})
		.returning()
	const { insertOwnBook, ownBookFor } = await lore()
	await insertOwnBook(asDb(), {
		sessionId: session!.id,
		userId: sessionOwner,
		name: null,
		overlayOf: bookId,
		primaryRuleset: "core:ruleset/freeform@1",
		rulesetVersion: null
	})
	const notes = (await ownBookFor(asDb(), session!.id)).id
	const entries: number[] = []
	for (let i = 0; i < held; i++) {
		const [m] = await db
			.insert(schema.sessionMessages)
			.values({ sessionId: session!.id, role: "assistant", content: "…" })
			.returning()
		await db
			.insert(schema.messages)
			.values({ id: m!.id, sessionId: session!.id, role: "assistant" })
		const [entry] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: notes,
				typeId: WORLD_LORE_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: `Note ${suffix}-${i}`,
				content: "Something.",
				sourceMessageId: m!.id
			})
			.returning()
		entries.push(entry!.id)
	}
	return { session: session!, notes, entries }
}

async function ownedBook(ownerId: number) {
	await db
		.insert(schema.userSettings)
		.values({ userId: ownerId, loreWriteMode: "full" })
		.onConflictDoNothing()
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: ownerId, name: `World ${++n}` })
		.returning()
	return book!
}

async function insertPlugin(pluginId: string) {
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
}

/**
 * A plugin's provided book, owned by the first administrator, with one entry.
 * `live: false` leaves the plugin's row out (insert it with `insertPlugin`, or
 * never: the book is then one kept at uninstall).
 */
async function providedBook(
	opts: { disabled?: boolean; live?: boolean } = {}
) {
	const k = ++n
	const pluginId = `acme.ap1x${k}`
	const admin = await db.query.users.findFirst({
		where: (u, { eq }) => eq(u.isAdmin, true),
		orderBy: (u, { asc }) => [asc(u.id)]
	})
	if (opts.live !== false) await insertPlugin(pluginId)
	const uuid = crypto.randomUUID()
	const [book] = await db
		.insert(schema.lorebooks)
		.values({
			userId: admin!.id,
			name: `Provided ${k}`,
			uuid,
			extraJson: {
				provided: {
					plugin: pluginId,
					slug: "world",
					version: "0.1.0",
					sha256: "x",
					uuid,
					entries: {},
					...(opts.disabled ? { disabled: true } : {})
				}
			}
		} as any)
		.returning()
	await db.insert(schema.lorebookEntries).values({
		lorebookId: book!.id,
		typeId: WORLD_LORE_TYPE_ID,
		typeVersion: 1,
		position: 0,
		title: "Dragon",
		content: "v1 dragon",
		keys: ["dragon"],
		enabled: true
	} as any)
	return { book: book!, admin: admin!, pluginId }
}

/** The administrator's session, write mode Full, on `bookId`. */
async function adminSessionOn(bookId: number, adminId: number, held = 1) {
	await db
		.insert(schema.userSettings)
		.values({ userId: adminId, loreWriteMode: "full" })
		.onConflictDoUpdate({
			target: schema.userSettings.userId,
			set: { loreWriteMode: "full" }
		})
	return sessionOn(bookId, adminId, held)
}

const rowsOf = async (lorebookId: number) =>
	JSON.stringify(
		await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
			.orderBy(schema.lorebookEntries.id)
	)

const imprintsOf = async (sessionId: number) =>
	JSON.stringify(
		await db
			.select()
			.from(schema.loreImprints)
			.where(eq(schema.loreImprints.sessionId, sessionId))
			.orderBy(schema.loreImprints.id)
	)

describe("canWriteLorebook", () => {
	it("is true for the owner only", async () => {
		const { canWriteLorebook } = await import("$lib/server/utils/ownedBook")
		const owner = await user("owner")
		const sharedWith = await user("shared")
		const member = await user("member")
		const admin = await user("admin", true)
		const guest = await user("guest")
		const book = await ownedBook(owner.id)
		await db
			.insert(schema.lorebookShares)
			.values({ lorebookId: book.id, userId: sharedWith.id })
		const { session } = await sessionOn(book.id, owner.id, 0)
		await db
			.insert(schema.sessionGuests)
			.values({ sessionId: session.id, userId: guest.id, isPlayer: true })
		const provided = await providedBook()
		const ordinary = { userId: book.userId, provided: false }
		const live = { userId: provided.book.userId, provided: true }

		expect(canWriteLorebook(owner.id, ordinary)).toBe(true)
		expect(canWriteLorebook(sharedWith.id, ordinary)).toBe(false)
		expect(canWriteLorebook(admin.id, ordinary)).toBe(false)
		expect(canWriteLorebook(guest.id, ordinary)).toBe(false)
		expect(canWriteLorebook(null, ordinary)).toBe(false)
		expect(canWriteLorebook(undefined, ordinary)).toBe(false)
		// A live provided lorebook is no one's to write: not the administrator
		// who enabled it (the row's stored owner), not another administrator,
		// not a member.
		expect(canWriteLorebook(provided.admin.id, live)).toBe(false)
		expect(canWriteLorebook(admin.id, live)).toBe(false)
		expect(canWriteLorebook(member.id, live)).toBe(false)
		// The same owner, the same row, once it is not provided: writable.
		expect(
			canWriteLorebook(provided.admin.id, { userId: provided.admin.id, provided: false })
		).toBe(true)
	})
})

describe("a provided lorebook", () => {
	it("a member's session reads it and cannot Apply into it", async () => {
		const {
			sessionsOverlayItemsHandler: items,
			sessionsApplyOverlayHandler: apply
		} = await import("$lib/server/sockets/sessions")
		const { applyHeldAutomatically } = await lore()
		const { foldInParent } = await import(
			"$lib/server/lorebooks/foldInParent"
		)
		const m = await user("m")
		const { book, pluginId } = await providedBook()
		const w = await sessionOn(book.id, m.id)
		const before = await rowsOf(book.id)

		const listed = await items.handler(
			socketOf(m.id),
			{ sessionId: w.session.id },
			noEmit
		)
		expect(listed.items).toHaveLength(3)
		expect(listed).toMatchObject({ mayApply: false, appliesItself: false })
		await expect(
			apply.handler(socketOf(m.id), { sessionId: w.session.id }, noEmit)
		).rejects.toThrow(primerRowEditRefusal(pluginId))
		expect(await rowsOf(book.id)).toBe(before)
		expect(
			await applyHeldAutomatically(asDb(), {
				sessionId: w.session.id,
				automatic: "scene-close"
			})
		).toBeNull()
		await foldInParent(asDb(), { sessionId: w.session.id, userId: m.id })
		expect(await rowsOf(book.id)).toBe(before)
	})

	it("observed: disabled after the session started, Apply is still refused and the merge still works", async () => {
		const {
			sessionsOverlayItemsHandler: items,
			sessionsApplyOverlayHandler: apply
		} = await import("$lib/server/sockets/sessions")
		const { foldInParent } = await import(
			"$lib/server/lorebooks/foldInParent"
		)
		const m = await user("m")
		const { book, pluginId } = await providedBook()
		const w = await sessionOn(book.id, m.id)
		const [row] = await db
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, book.id))
		const extra = row!.extraJson as any
		await db
			.update(schema.lorebooks)
			.set({
				extraJson: {
					...extra,
					provided: { ...extra.provided, disabled: true }
				}
			} as any)
			.where(eq(schema.lorebooks.id, book.id))
		const before = await rowsOf(book.id)

		expect(
			await items.handler(
				socketOf(m.id),
				{ sessionId: w.session.id },
				noEmit
			)
		).toMatchObject({
			mayApply: false,
			appliesItself: false
		})
		await expect(
			apply.handler(socketOf(m.id), { sessionId: w.session.id }, noEmit)
		).rejects.toThrow(primerRowEditRefusal(pluginId))
		expect(await rowsOf(book.id)).toBe(before)
		await foldInParent(asDb(), { sessionId: w.session.id, userId: m.id })
		expect(await rowsOf(book.id)).toBe(before)
	})

	it("the enabling administrator's own session never applies into a provided lorebook, and still merges it", async () => {
		const {
			sessionsOverlayItemsHandler: items,
			sessionsApplyOverlayHandler: apply
		} = await import("$lib/server/sockets/sessions")
		const { applyHeldAutomatically } = await lore()
		const { foldInParent } = await import(
			"$lib/server/lorebooks/foldInParent"
		)
		const { book, admin, pluginId } = await providedBook()
		const w = await adminSessionOn(book.id, admin.id, 1)
		const before = await rowsOf(book.id)

		const listed = await items.handler(
			socketOf(admin.id),
			{ sessionId: w.session.id },
			noEmit
		)
		expect(listed.items).toHaveLength(1)
		expect(listed).toMatchObject({ mayApply: false, appliesItself: false })
		await expect(
			apply.handler(socketOf(admin.id), { sessionId: w.session.id }, noEmit)
		).rejects.toThrow(primerRowEditRefusal(pluginId))
		expect(
			await applyHeldAutomatically(asDb(), {
				sessionId: w.session.id,
				automatic: "scene-close"
			})
		).toBeNull()
		expect(await rowsOf(book.id)).toBe(before)

		// Merge copies the lorebook into the notes; the lorebook is only read.
		const folded = await foldInParent(asDb(), {
			sessionId: w.session.id,
			userId: admin.id
		})
		expect(folded.foldedFrom.id).toBe(book.id)
		expect(await rowsOf(book.id)).toBe(before)
	})

	it("Take back is refused for a batch applied before the lorebook went live, and nothing changes", async () => {
		const {
			sessionsApplyOverlayHandler: apply,
			sessionsTakeBackApplyHandler: takeBack
		} = await import("$lib/server/sockets/sessions")
		const { book, admin, pluginId } = await providedBook({ live: false })
		const w = await adminSessionOn(book.id, admin.id, 2)
		const applied = await apply.handler(
			socketOf(admin.id),
			{ sessionId: w.session.id, entryIds: [w.entries[0]!] },
			noEmit
		)
		const batch = applied.batch!
		await insertPlugin(pluginId)
		const snap = async () => [
			await rowsOf(book.id),
			await rowsOf(w.notes),
			await imprintsOf(w.session.id)
		]
		const before = await snap()

		expect(
			await takeBack.handler(
				socketOf(admin.id),
				{ sessionId: w.session.id, batch },
				noEmit
			)
		).toEqual({
			sessionId: w.session.id,
			batch,
			refused: primerRowEditRefusal(pluginId)
		})
		expect(await snap()).toEqual(before)
	})

	it("routes the enabling administrator's writes to the session's notes, never the lorebook", async () => {
		const { loreWriteTargetFor, loreWriteBookIdOf, keepsValuesInOwnBook } =
			await lore()
		const { book, admin } = await providedBook()
		const w = await adminSessionOn(book.id, admin.id, 0)

		const target = await loreWriteTargetFor(asDb(), w.session.id, {
			fork: false
		})
		expect(target).toMatchObject({
			route: "own-book",
			lorebookId: w.notes,
			attachedId: book.id,
			mode: "full"
		})
		expect(await keepsValuesInOwnBook(asDb(), w.session.id)).toBe(true)
		expect(await loreWriteBookIdOf(asDb(), w.session.id)).toBe(w.notes)
	})

	it("the delete safeguard records nothing on it, while an ordinary book of the same administrator records", async () => {
		const { recordToTimeline } = await import("$lib/server/state/durable")
		const WEATHER = "core:slot/weather@1"
		const GENRE = "test:genre/ap1-delete"
		_clearAttributeSlots()
		genreKeeping(GENRE, {
			name: { en: "AP1 delete" },
			family: "test",
			slots: [
				defineAttributeSlot(WEATHER, {
					type: "enum",
					descriptor: "What the sky is doing.",
					appliesTo: ["world"],
					config: { of: ["clear", "storm"] }
				})
			],
			events: {}
		})
		const valuesOnBook = async (lorebookId: number) =>
			JSON.stringify(
				await db
					.select()
					.from(schema.attributeValues)
					.where(eq(schema.attributeValues.ownerId, lorebookId))
					.orderBy(schema.attributeValues.id)
			)
		/** A session of the administrator's holding one world value. */
		const withWorldValue = async (bookId: number, adminId: number) => {
			const w = await adminSessionOn(bookId, adminId, 0)
			await db
				.update(schema.sessions)
				.set({ genreId: GENRE })
				.where(eq(schema.sessions.id, w.session.id))
			const [m] = await db
				.insert(schema.sessionMessages)
				.values({ sessionId: w.session.id, role: "assistant", content: "…" })
				.returning()
			await db
				.insert(schema.messages)
				.values({ id: m!.id, sessionId: w.session.id, role: "assistant" })
			await db.insert(schema.attributeValues).values({
				ownerKind: "session",
				ownerId: w.session.id,
				slotId: WEATHER,
				value: { v: "storm" },
				sessionId: w.session.id,
				validFromMessageId: m!.id,
				updatedBy: "user"
			})
			return w
		}

		const { book, admin } = await providedBook()
		const w = await withWorldValue(book.id, admin.id)
		const before = [await rowsOf(book.id), await valuesOnBook(book.id)]
		const report = await recordToTimeline(asDb(), w.session.id, {
			reason: "delete"
		})
		expect(report).toMatchObject({
			recorded: false,
			route: null,
			values: 0,
			configs: 0
		})
		expect([await rowsOf(book.id), await valuesOnBook(book.id)]).toEqual(
			before
		)

		const kept = await providedBook({ live: false })
		const wk = await withWorldValue(kept.book.id, kept.admin.id)
		const recorded = await recordToTimeline(asDb(), wk.session.id, {
			reason: "delete"
		})
		expect(recorded).toMatchObject({ recorded: true, route: "book" })
		expect(recorded.values).toBeGreaterThan(0)
		_clearAttributeSlots()
	})

	it("a lorebook kept at uninstall is ordinary: the administrator's Apply lands in it and writes route to it", async () => {
		const { sessionsApplyOverlayHandler: apply } = await import(
			"$lib/server/sockets/sessions"
		)
		const { loreWriteTargetFor, loreWriteBookIdOf } = await lore()
		const { book, admin } = await providedBook({ live: false })
		const w = await adminSessionOn(book.id, admin.id, 1)

		expect(
			await loreWriteTargetFor(asDb(), w.session.id, { fork: false })
		).toMatchObject({ route: "book", lorebookId: book.id })
		expect(await loreWriteBookIdOf(asDb(), w.session.id)).toBe(book.id)
		const res = await apply.handler(
			socketOf(admin.id),
			{ sessionId: w.session.id },
			noEmit
		)
		expect(res.applied).toHaveLength(1)
		const inBook = await db
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, book.id))
		expect(inBook.map((r) => r.id)).toContain(w.entries[0])
	})

	it("a lorebook's own values: refused on a live provided lorebook for its administrator, allowed on a kept one and an ordinary one", async () => {
		const { assertBookOwner } = await import("$lib/server/state/write")
		const live = await providedBook()
		await expect(
			assertBookOwner(asDb(), live.book.id, live.admin.id)
		).rejects.toThrow(primerRowEditRefusal(live.pluginId))
		const kept = await providedBook({ live: false })
		await expect(
			assertBookOwner(asDb(), kept.book.id, kept.admin.id)
		).resolves.toBeUndefined()
		const own = await ownedBook(live.admin.id)
		await expect(
			assertBookOwner(asDb(), own.id, live.admin.id)
		).resolves.toBeUndefined()
	})
})

describe("liveProvidedBookSql", () => {
	it("agrees with the mark and its owner's presence, row by row", async () => {
		const k = ++n
		const present = `acme.ap1twin${k}`
		const absent = `acme.ap1gone${k}`
		await insertPlugin(present)
		const mark = (uuid: string, plugin: string, extra: object = {}) => ({
			provided: {
				plugin,
				slug: "world",
				version: "1.0.0",
				sha256: "x",
				uuid,
				entries: {},
				...extra
			}
		})
		const admin = await user("twin", true)
		const states: [string, (uuid: string) => unknown, boolean][] = [
			["core mark", (u) => mark(u, "core"), true],
			["plugin mark, plugin present", (u) => mark(u, present), true],
			["plugin mark, plugin row absent", (u) => mark(u, absent), false],
			[
				"mark of another row's uuid",
				() => mark(crypto.randomUUID(), "core"),
				false
			],
			[
				"mark missing version",
				(u) => {
					const m = mark(u, "core")
					delete (m.provided as any).version
					return m
				},
				false
			],
			["provided not an object", () => ({ provided: "yes" }), false],
			["no extra_json", () => undefined, false],
			[
				"disabled mark",
				(u) => mark(u, present, { disabled: { at: 1, by: admin.id, version: "1" } }),
				true
			]
		]
		const rows: { id: number; extraJson: unknown; uuid: string }[] = []
		for (const [label, make] of states) {
			const uuid = crypto.randomUUID()
			const extraJson = make(uuid)
			const [row] = await db
				.insert(schema.lorebooks)
				.values({
					userId: admin.id,
					name: `Twin ${label}`,
					uuid,
					...(extraJson === undefined ? {} : { extraJson })
				} as any)
				.returning()
			rows.push({ id: row!.id, extraJson: row!.extraJson, uuid })
		}
		const sql = await db
			.select({ id: schema.lorebooks.id, live: liveProvidedBookSql() })
			.from(schema.lorebooks)
			.where(
				inArray(
					schema.lorebooks.id,
					rows.map((r) => r.id)
				)
			)
		const liveOf = new Map(sql.map((r) => [r.id, r.live]))
		for (const [i, [label, , expected]] of states.entries()) {
			const r = rows[i]!
			const m = markedBook(r.extraJson, r.uuid)
			const js = !!m && (await providedOwnerPresent(asDb(), m.plugin))
			expect(js, `${label} (JS)`).toBe(expected)
			expect(liveOf.get(r.id), `${label} (SQL)`).toBe(expected)
		}
	})
})

describe("the lorebook's owner who is not the session's owner", () => {
	for (const standing of ["a guest", "a non-member"] as const) {
		it(`${standing} is refused Apply and Take back, and nothing changes`, async () => {
			const {
				sessionsApplyOverlayHandler: apply,
				sessionsTakeBackApplyHandler: takeBack
			} = await import("$lib/server/sockets/sessions")
			const { APPLY_OVERLAY_REFUSALS } = await lore()
			const o = await user("o")
			const m = await user("m")
			const book = await ownedBook(o.id)
			const w = await sessionOn(book.id, o.id, 3)
			const applied = await apply.handler(
				socketOf(o.id),
				{ sessionId: w.session.id, entryIds: [w.entries[0]!] },
				noEmit
			)
			const batch = applied.batch!
			await db
				.update(schema.sessions)
				.set({ userId: m.id })
				.where(eq(schema.sessions.id, w.session.id))
			if (standing === "a guest")
				await db.insert(schema.sessionGuests).values({
					sessionId: w.session.id,
					userId: o.id,
					isPlayer: true
				})
			const snap = async () => [
				await rowsOf(book.id),
				await rowsOf(w.notes),
				await imprintsOf(w.session.id)
			]
			const before = await snap()

			await expect(
				apply.handler(
					socketOf(o.id),
					{ sessionId: w.session.id },
					noEmit
				)
			).rejects.toThrow(APPLY_OVERLAY_REFUSALS.notSessionOwner)
			expect(
				await takeBack.handler(
					socketOf(o.id),
					{ sessionId: w.session.id, batch },
					noEmit
				)
			).toEqual({
				sessionId: w.session.id,
				batch,
				refused: APPLY_OVERLAY_REFUSALS.notSessionOwner
			})
			expect(await snap()).toEqual(before)
		})
	}
})
