/**
 * Branching a session that reads its own notes alone on a line (★s4-fold2-2):
 * the branch's notes carry the notes' stat values, sheets and entry–entry
 * links that stand on main or the line, so the branch reads what its parent
 * read at the fork. Members ride (not copied); member–entry links are copied.
 * Hand-built own-notes session on a line (not a fold).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, asc, eq, isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"

const T = 60_000
vi.setConfig({ testTimeout: T, hookTimeout: T })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-own-book-branch-notes-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, T)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
const SHUT = "test:slot/own-line-shut@1"
const GENRE = "test:genre/own-notes-line"
const SAVE = { key: "save", definitionId: "core:outlet/create-lore-entry" }
const READ_NODE = {
	key: "lore",
	definitionId: "core:query/lorebook-triggers@1",
	definitionVersion: 1,
	kind: "query"
}

function declareSlots() {
	_clearAttributeSlots()
	const shut = defineAttributeSlot(SHUT, {
		type: "boolean",
		descriptor: "Whether the shop is shut.",
		appliesTo: ["world"],
		scope: "world",
		default: false
	})
	genreKeeping(GENRE, {
		name: { en: "Own notes line" },
		family: "test",
		slots: [shut],
		events: {}
	})
}

let n = 0
let order = 0

interface Opts {
	clock?: { year: number } | null
	/** Beside an attached book (owned by the person), on a line of it. */
	attached?: boolean
	/** Stand on a line of the own book. */
	line?: boolean
}

/**
 * A session with its own book. Main holds history at Year 5 and Year 15 (the
 * second after the line's fork at Year 10); the line holds Year 12 and Year 18.
 */
async function setup(opts: Opts = {}) {
	declareSlots()
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `own-line-${suffix}`)
	let attachedId: number | null = null
	let attachedBranchId: number | null = null
	if (opts.attached) {
		const [shared] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: user.id, name: `Shared ${suffix}` })
			.returning()
		attachedId = shared!.id
		const [b] = await testDb
			.insert(schema.lorebookBranches)
			.values({
				lorebookId: attachedId,
				name: "Shared line",
				forkYear: 10
			})
			.returning()
		attachedBranchId = b!.id
	}
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			genreId: GENRE,
			lorebookId: attachedId,
			lorebookBranchId: attachedBranchId,
			storyClockYear:
				opts.clock === null ? null : (opts.clock?.year ?? 15)
		})
		.returning()
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const own = await ownBookFor(db(), session!.id)
	const [lineRow] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: own.id, name: "Own line", forkYear: 10 })
		.returning()
	const line = lineRow!
	const mainFive = await history(own.id, "Main 5", 5)
	const mainFifteen = await history(own.id, "Main 15", 15)
	const lineTwelve = await history(own.id, "Line 12", 12, line.id)
	const lineEighteen = await history(own.id, "Line 18", 18, line.id)
	if (opts.line)
		await testDb
			.update(schema.sessions)
			.set({ lorebookBranchId: line.id })
			.where(eq(schema.sessions.id, session!.id))
	// A message to anchor the session's cast and durable writes to.
	const { insertLegacy } = await import("$lib/server/messages/store")
	await insertLegacy(db(), {
		sessionId: session!.id,
		role: "user",
		userId: user.id,
		content: "Hello."
	} as any)
	await insertLegacy(db(), {
		sessionId: session!.id,
		role: "assistant",
		userId: null,
		content: "Hi."
	} as any)
	return {
		user,
		session: session!,
		own,
		line,
		attachedId,
		mainFive,
		mainFifteen,
		lineTwelve,
		lineEighteen
	}
}
type Setup = Awaited<ReturnType<typeof setup>>

async function entry(
	bookId: number,
	title: string,
	extra: {
		typeId?: string
		fields?: Record<string, unknown>
		branchId?: number | null
	} = {}
) {
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: bookId,
			typeId: extra.typeId ?? HISTORY_TYPE_ID,
			typeVersion: 1,
			position: ++order,
			title,
			content: `${title}.`,
			fields: extra.fields ?? {},
			branchId: extra.branchId ?? null
		})
		.returning()
	return row!
}

const history = (
	bookId: number,
	title: string,
	year: number,
	branchId: number | null = null
) => entry(bookId, title, { fields: { year }, branchId })

/** A card-less cast member of `bookId` (its turn is the session's, so any open turn anchors its write). */
async function member(_s: Setup, bookId: number, name: string) {
	const { insertCastMember } = await import("$lib/server/characters/versions")
	return (
		await insertCastMember(db(), {
			lorebookId: bookId,
			binding: `{{char:${name}-${++n}}}`,
			characterId: null,
			name
		})
	).member
}

const MOOD = "test:slot/branch-notes-mood@1"
const LAMPS = "test:slot/branch-notes-lamps@1"
const HP = "test:slot/branch-notes-hp@1"

const put = (
	ownerKind: string,
	ownerId: number,
	slotId: string,
	v: unknown,
	extra: Record<string, unknown> = {}
) =>
	testDb
		.insert(schema.attributeValues)
		.values({ ownerKind, ownerId, slotId, value: { v }, ...extra } as any)
		.returning()

const read = async (
	sessionId: number,
	owner: { kind: any; id: number },
	slotId: string
) => {
	const { valueOf } = await import("$lib/server/state/resolve")
	return await valueOf(testDb as any, { sessionId, owner, slotId })
}

/** The entry–entry links the session reads, as "from -> to (name)". */
async function linksRead(sessionId: number) {
	const { readGraphEntryLinks } = await import(
		"$lib/server/utils/graphEntryLinks"
	)
	return ((await readGraphEntryLinks(db(), sessionId)) ?? [])
		.map((l) => `${l.from.name} -> ${l.to.name} (${l.name})`)
		.sort()
}

describe("branching a session on its own notes keeps the notes' stats and links", () => {
	test(
		"the branch reads what its parent read at the fork; the parent reads as before",
		async () => {
			// Declared here, after `setup` declared its own slots.
			const s = await setup({ line: true })
			const { defineAttributeSlot } = await import("@serene-pub/sdk")
			const mood = defineAttributeSlot(MOOD, {
				type: "text",
				descriptor: "Mood.",
				appliesTo: ["world"],
				scope: "world"
			})
			const lamps = defineAttributeSlot(LAMPS, {
				type: "integer",
				descriptor: "Lamps.",
				appliesTo: ["location"],
				scope: "world"
			})
			const hp = defineAttributeSlot(HP, {
				type: "integer",
				descriptor: "Hit points.",
				appliesTo: ["cast"],
				scope: "world",
				default: 10
			})
			genreKeeping(GENRE, {
				name: { en: "Own notes line" },
				family: "test",
				slots: [mood, lamps, hp],
				events: {}
			})

			const hall = await entry(s.own.id, "Hall", {
				typeId: LOCATION_TYPE_ID
			})
			const cellar = await entry(s.own.id, "Cellar", {
				typeId: LOCATION_TYPE_ID
			})
			const maren = await member(s, s.own.id, "Maren")
			const msgs = await testDb
				.select({ id: schema.messages.id })
				.from(schema.messages)
				.where(eq(schema.messages.sessionId, s.session.id))
				.orderBy(asc(schema.messages.id))
			const fork = msgs[msgs.length - 1]!
			const { insertLegacy } = await import("$lib/server/messages/store")
			const after = await insertLegacy(db(), {
				sessionId: s.session.id,
				role: "user",
				userId: s.user.id,
				content: "After the fork."
			} as any)
			const afterId = (after as any).id ?? (after as any)[0]?.id

			// Main's rows, then the line's, which win.
			await put("lorebook", s.own.id, MOOD, "calm")
			await put("lorebook", s.own.id, MOOD, "stormy", {
				branchId: s.line.id,
				historyEntryId: s.lineTwelve.id
			})
			await put("location", hall.id, LAMPS, 3)
			await put("cast_member", maren.id, HP, 7, {
				branchId: s.line.id,
				historyEntryId: s.lineTwelve.id
			})
			// Anchored after the fork: the parent reads it, the branch does not.
			await put("location", cellar.id, LAMPS, 9, {
				validFromMessageId: afterId
			})
			const [sheetRow] = await testDb
				.insert(schema.attributeSheets)
				.values({ id: `test:sheet/branch-notes-${++n}@1` })
				.returning()
			await testDb.insert(schema.ownerSheets).values([
				{
					ownerKind: "lorebook",
					ownerId: s.own.id,
					sheetId: sheetRow!.id
				},
				{
					ownerKind: "location",
					ownerId: hall.id,
					sheetId: sheetRow!.id
				}
			])
			const link = {
				lorebookId: s.own.id,
				fromEntryId: hall.id,
				toEntryId: cellar.id,
				relationshipType: "leads to",
				title: "the stair",
				branchId: s.line.id,
				historyEntryId: s.lineTwelve.id
			}
			await testDb
				.insert(schema.narrativeRelationships)
				.values(link as any)
			// A member–entry link: copied, its member end kept.
			await testDb.insert(schema.narrativeRelationships).values({
				lorebookId: s.own.id,
				fromNodeId: maren.id,
				toEntryId: hall.id,
				relationshipType: "keeps",
				branchId: s.line.id,
				historyEntryId: s.lineTwelve.id
			} as any)

			const world = { kind: "session", id: s.session.id }
			const before = {
				mood: await read(s.session.id, world, MOOD),
				lamps: await read(
					s.session.id,
					{ kind: "location", id: hall.id },
					LAMPS
				),
				hp: await read(
					s.session.id,
					{ kind: "cast_member", id: maren.id },
					HP
				),
				links: await linksRead(s.session.id)
			}
			expect(before.mood).toBe("stormy")
			expect(before.lamps).toBe(3)
			expect(before.hp).toBe(7)
			expect(before.links).toContain("Hall -> Cellar (the stair)")

			const { branchSession } = await import(
				"$lib/server/sessions/branch"
			)
			const branch = await branchSession(db(), {
				sessionId: s.session.id,
				fromMessageId: fork.id,
				title: "Branched"
			})
			const bookId = (await ownBookOfSession(branch.id)).id
			const copiedHall = (
				await testDb
					.select()
					.from(schema.lorebookEntries)
					.where(
						and(
							eq(schema.lorebookEntries.lorebookId, bookId),
							eq(schema.lorebookEntries.title, "Hall")
						)
					)
			)[0]!

			expect(
				await read(branch.id, { kind: "session", id: branch.id }, MOOD)
			).toBe(before.mood)
			expect(
				await read(
					branch.id,
					{ kind: "location", id: copiedHall.id },
					LAMPS
				)
			).toBe(before.lamps)
			expect(
				await read(branch.id, { kind: "cast_member", id: maren.id }, HP)
			).toBe(before.hp)
			expect(await linksRead(branch.id)).toEqual(before.links)
			// The sheets came across; the value dated after the fork stayed behind.
			const sheets = await testDb
				.select()
				.from(schema.ownerSheets)
				.where(eq(schema.ownerSheets.sheetId, sheetRow!.id))
			expect(
				sheets.filter(
					(r) => r.ownerKind === "lorebook" && r.ownerId === bookId
				)
			).toHaveLength(1)
			expect(
				sheets.filter(
					(r) =>
						r.ownerKind === "location" &&
						r.ownerId === copiedHall.id
				)
			).toHaveLength(1)
			const cellarCopy = (
				await testDb
					.select()
					.from(schema.lorebookEntries)
					.where(
						and(
							eq(schema.lorebookEntries.lorebookId, bookId),
							eq(schema.lorebookEntries.title, "Cellar")
						)
					)
			)[0]!
			expect(
				await read(
					branch.id,
					{ kind: "location", id: cellarCopy.id },
					LAMPS
				)
			).not.toBe(9)
			// The member's line row is copied once (main's rows are shared, none here), onto the branch's line; the member–entry link was copied.
			const heldByMember = await testDb
				.select()
				.from(schema.attributeValues)
				.where(
					and(
						eq(schema.attributeValues.ownerKind, "cast_member"),
						eq(schema.attributeValues.ownerId, maren.id),
						eq(schema.attributeValues.slotId, HP)
					)
				)
			expect(heldByMember).toHaveLength(2)
			expect(new Set(heldByMember.map((r) => r.branchId)).size).toBe(2)
			const memberLinks = await testDb
				.select()
				.from(schema.narrativeRelationships)
				.where(
					and(
						eq(schema.narrativeRelationships.lorebookId, bookId),
						isNotNull(schema.narrativeRelationships.fromNodeId)
					)
				)
			expect(memberLinks).toHaveLength(1)
			expect(memberLinks[0]!.fromNodeId).toBe(maren.id)


			// The parent reads exactly as before.
			expect(await read(s.session.id, world, MOOD)).toBe(before.mood)
			expect(
				await read(
					s.session.id,
					{ kind: "location", id: hall.id },
					LAMPS
				)
			).toBe(before.lamps)
			expect(
				await read(
					s.session.id,
					{ kind: "cast_member", id: maren.id },
					HP
				)
			).toBe(before.hp)
			expect(await linksRead(s.session.id)).toEqual(before.links)
			expect(
				await read(
					s.session.id,
					{ kind: "location", id: cellar.id },
					LAMPS
				)
			).toBe(9)
		},
		T
	)
})

describe("a member's value on the notes' main reads the same in the branch at the fork", () => {
	async function build(opts: Opts) {
		const s = await setup(opts)
		const { defineAttributeSlot } = await import("@serene-pub/sdk")
		const hp = defineAttributeSlot(HP, {
			type: "integer",
			descriptor: "Hit points.",
			appliesTo: ["cast"],
			scope: "world",
			default: 10
		})
		genreKeeping(GENRE, {
			name: { en: "Own notes line" },
			family: "test",
			slots: [hp],
			events: {}
		})
		return s
	}

	/** Read each member's HP in the parent, in a branch at the last message, and in the parent again. */
	async function forkAndRead(s: Setup, members: { id: number }[]) {
		const msgs = await testDb
			.select({ id: schema.messages.id })
			.from(schema.messages)
			.where(eq(schema.messages.sessionId, s.session.id))
			.orderBy(asc(schema.messages.id))
		const fork = msgs[msgs.length - 1]!
		const { insertLegacy } = await import("$lib/server/messages/store")
		const readAll = async (sessionId: number) => {
			const out: unknown[] = []
			for (const m of members)
				out.push(
					await read(sessionId, { kind: "cast_member", id: m.id }, HP)
				)
			return out
		}
		const parentBefore = await readAll(s.session.id)
		await insertLegacy(db(), {
			sessionId: s.session.id,
			role: "user",
			userId: s.user.id,
			content: "After the fork."
		} as any)
		const { branchSession } = await import("$lib/server/sessions/branch")
		const branch = await branchSession(db(), {
			sessionId: s.session.id,
			fromMessageId: fork.id,
			title: "Branched"
		})
		const inBranch = await readAll(branch.id)
		const parentAfter = await readAll(s.session.id)
		return { parentBefore, inBranch, parentAfter }
	}

	test("parent on its notes' main: the later date wins, undated reads", async () => {
		const s = await build({ line: false })
		const m = await member(s, s.own.id, "Mara")
		const nn = await member(s, s.own.id, "Nils")
		await put("cast_member", m.id, HP, 4, {
			historyEntryId: s.mainFifteen.id
		})
		await put("cast_member", m.id, HP, 3, {
			historyEntryId: s.mainFive.id
		})
		await put("cast_member", nn.id, HP, 6)
		const r = await forkAndRead(s, [m, nn])
		expect(r.parentBefore).toEqual([4, 6])
		expect(r.inBranch).toEqual(r.parentBefore)
		expect(r.parentAfter).toEqual(r.parentBefore)
	})

	test("parent on a line of its notes: main after the fork is cut", async () => {
		const s = await build({ line: true })
		const m = await member(s, s.own.id, "Mara")
		const nn = await member(s, s.own.id, "Nils")
		await put("cast_member", m.id, HP, 3, {
			historyEntryId: s.mainFive.id
		})
		await put("cast_member", m.id, HP, 4, {
			historyEntryId: s.mainFifteen.id
		})
		await put("cast_member", nn.id, HP, 6)
		const r = await forkAndRead(s, [m, nn])
		expect(r.parentBefore).toEqual([3, 6])
		expect(r.inBranch).toEqual(r.parentBefore)
		expect(r.parentAfter).toEqual(r.parentBefore)
	})

	test("parent at an early moment: a later-dated row is not yet in force", async () => {
		const s = await build({ line: false, clock: { year: 3 } })
		const m = await member(s, s.own.id, "Mara")
		await put("cast_member", m.id, HP, 3, {
			historyEntryId: s.mainFive.id
		})
		const r = await forkAndRead(s, [m])
		expect(r.parentBefore).toEqual([10])
		expect(r.inBranch).toEqual(r.parentBefore)
		expect(r.parentAfter).toEqual(r.parentBefore)
	})

	// ★s4-verify-3 (fixed): a parent's post-fork turn-tied member row is cut from the branch's reading
	test(
		"a parent's post-fork turn-tied row does not reach the branch",
		async () => {
			const s = await build({ line: false })
			const m = await member(s, s.own.id, "Mara")
			await put("cast_member", m.id, HP, 6)
			const msgs = await testDb
				.select({ id: schema.messages.id })
				.from(schema.messages)
				.where(eq(schema.messages.sessionId, s.session.id))
				.orderBy(asc(schema.messages.id))
			const fork = msgs[msgs.length - 1]!
			const { insertLegacy } = await import("$lib/server/messages/store")
			const after = await insertLegacy(db(), {
				sessionId: s.session.id,
				role: "user",
				userId: s.user.id,
				content: "After the fork."
			} as any)
			await put("cast_member", m.id, HP, 9, {
				validFromMessageId: after.id
			})
			const { branchSession } = await import(
				"$lib/server/sessions/branch"
			)
			const branch = await branchSession(db(), {
				sessionId: s.session.id,
				fromMessageId: fork.id,
				title: "Branched"
			})
			expect(
				await read(branch.id, { kind: "cast_member", id: m.id }, HP)
			).toBe(6)
		}
	)

	test("a non-branch reading still reads the parent's turn-tied row; one at the fork reaches the branch", async () => {
		const s = await build({ line: false })
		const m = await member(s, s.own.id, "Mara")
		const msgs = await testDb
			.select({ id: schema.messages.id })
			.from(schema.messages)
			.where(eq(schema.messages.sessionId, s.session.id))
			.orderBy(asc(schema.messages.id))
		const fork = msgs[msgs.length - 1]!
		const { insertLegacy } = await import("$lib/server/messages/store")
		const after = await insertLegacy(db(), {
			sessionId: s.session.id,
			role: "user",
			userId: s.user.id,
			content: "After the fork."
		} as any)
		await put("cast_member", m.id, HP, 5, { validFromMessageId: fork.id })
		await put("cast_member", m.id, HP, 9, { validFromMessageId: after.id })
		const { branchSession } = await import("$lib/server/sessions/branch")
		const branch = await branchSession(db(), {
			sessionId: s.session.id,
			fromMessageId: fork.id,
			title: "Branched"
		})
		const owner = { kind: "cast_member", id: m.id }
		// The parent (no session cuts) reads the later row; the branch the one at the fork.
		expect(await read(s.session.id, owner, HP)).toBe(9)
		expect(await read(branch.id, owner, HP)).toBe(5)
	})
})

describe("a member–entry link reaches a branch", () => {
	test("the branch lists it with its member end named; the parent reads it once", async () => {
		const s = await setup({ line: false })
		const hall = await entry(s.own.id, "Hall", { typeId: LOCATION_TYPE_ID })
		const maren = await member(s, s.own.id, "Maren")
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId: s.own.id,
			fromNodeId: maren.id,
			toEntryId: hall.id,
			relationshipType: "keeps",
			title: "the keys"
		} as any)
		const msgs = await testDb
			.select({ id: schema.messages.id })
			.from(schema.messages)
			.where(eq(schema.messages.sessionId, s.session.id))
			.orderBy(asc(schema.messages.id))
		const { branchSession } = await import("$lib/server/sessions/branch")
		const branch = await branchSession(db(), {
			sessionId: s.session.id,
			fromMessageId: msgs[msgs.length - 1]!.id,
			title: "Branched"
		})
		expect(await linksRead(s.session.id)).toEqual(["Maren -> Hall (the keys)"])
		expect(await linksRead(branch.id)).toEqual(["Maren -> Hall (the keys)"])
	})
})

async function ownBookOfSession(sessionId: number) {
	const { ownBookOf } = await import("$lib/server/lorebooks/ownBook")
	return (await ownBookOf(db(), sessionId))!
}
