/**
 * 🚧 `membersAsRead` / `castVersionsInForce` reading cast members from their
 * character versions (plan §32 §6, §33), over a real database. Version rows
 * are inserted directly: the writer is another module's.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { MAIN_HEAD } from "$lib/server/state/entriesOnReading"
import { lineOfBook } from "$lib/server/state/reading"
import { castVersionsInForce, membersAsRead } from "./memberAsRead"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

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
		path.join(os.tmpdir(), "serene-pub-vitest-memberAsReadVersions-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

afterEach(() => {
	vi.restoreAllMocks()
})

const db = () => testDb as unknown as Db
let n = 0
const uniq = (label: string) => `${label}-${++n}`
let order = 0

async function world() {
	const [user] = await testDb
		.insert(schema.users)
		.values({ username: uniq("mav-user") })
		.returning()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user!.id, name: uniq("Book") })
		.returning()
	return { user: user!, book: book! }
}
type World = Awaited<ReturnType<typeof world>>

async function card(w: World, name: string) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId: w.user.id, name, description: `${name} card.` })
		.returning()
	return row!
}

async function cardVersion(
	cardId: number,
	number: number,
	extra: Partial<typeof schema.characterVersions.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.characterVersions)
		.values({
			cardId,
			number,
			label: `${number}.0`,
			writeOrder: ++order,
			...extra
		})
		.returning()
	return row!
}

async function member(
	w: World,
	characterId: number | null,
	extra: Partial<typeof schema.lorebookBindings.$inferInsert> = {},
	lorebookId = w.book.id
) {
	const [row] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId,
			binding: uniq("{{char:x}}"),
			characterId,
			name: "",
			...extra
		})
		.returning()
	return row!
}

/** A cast version of `memberId` held in `lorebookId`. */
async function castVersion(
	memberId: number,
	lorebookId: number,
	extra: Partial<typeof schema.characterVersions.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.characterVersions)
		.values({
			castMemberId: memberId,
			lorebookId,
			nodeState: "active",
			nodeVisibility: "normal",
			writeOrder: ++order,
			...extra
		})
		.returning()
	return row!
}

async function readOne(
	memberId: number,
	opts: Parameters<typeof membersAsRead>[2] = { reading: MAIN_HEAD }
) {
	return (await membersAsRead(db(), [memberId], opts)).get(memberId)!
}

describe("a member read from its version in force", () => {
	test("the followed fields read the parent card version, the rest are the version's own", async () => {
		const w = await world()
		const maren = await card(w, "Maren")
		const v1 = await cardVersion(maren.id, 1, {
			name: "Maren",
			nickname: "Mare",
			description: "Card v1 description.",
			personality: "Card v1 personality.",
			scenario: "Card v1 scenario.",
			exampleDialogues: ["A: hi", "B: bye"],
			greetings: [{ text: "Card hello." }],
			faceMediaId: null
		})
		const tag = (
			await testDb
				.insert(schema.tags)
				.values({ userId: w.user.id, name: "smith" })
				.returning()
		)[0]!
		await testDb
			.insert(schema.characterTags)
			.values({ characterId: maren.id, tagId: tag.id })
		await testDb.insert(schema.spriteSets).values({
			characterId: maren.id,
			name: "card-calm",
			isDefault: true,
			position: 0
		})
		const m = await member(w, maren.id, { name: "stale" })
		const base = await castVersion(m.id, w.book.id, {
			parentVersionId: v1.id,
			follows: [
				"name",
				"nickname",
				"description",
				"personality",
				"exampleDialogues",
				"greetings"
			],
			summary: "Own summary.",
			aliases: ["Mar"],
			scenario: "Own scenario.",
			// A followed field's own column is ignored.
			description: "ignored own description"
		})

		const r = await readOne(m.id)
		expect(r).toMatchObject({
			castMemberId: m.id,
			castVersionId: base.id,
			cardVersion: { id: v1.id, number: 1, label: "1.0" },
			linkedCardId: maren.id,
			activeCardId: maren.id,
			cardless: false,
			behindCard: false,
			nodeState: "active",
			nodeVisibility: "normal",
			name: "Maren",
			nickname: "Mare",
			shownName: "Mare",
			description: "Card v1 description.",
			personality: "Card v1 personality.",
			scenario: "Own scenario.",
			summary: "Own summary.",
			aliases: ["Mar"],
			exampleDialogues: ["A: hi", "B: bye"],
			follows: [
				"name",
				"nickname",
				"description",
				"personality",
				"exampleDialogues",
				"greetings"
			],
			followsCard: [
				"description",
				"personality",
				"firstMessage",
				"alternateGreetings",
				"exampleDialogues"
			],
			tags: ["smith"],
			spriteSetsFrom: "card"
		})
		expect(r.spriteSets.map((s) => s.name)).toEqual(["card-calm"])
	})

	test("a version parented on an older card version is behind the card; a newer one is not", async () => {
		const w = await world()
		const c = await card(w, "Maren")
		const v1 = await cardVersion(c.id, 1, { name: "Maren v1" })
		const m = await member(w, c.id)
		await castVersion(m.id, w.book.id, {
			parentVersionId: v1.id,
			follows: ["name"]
		})
		expect(await readOne(m.id)).toMatchObject({
			name: "Maren v1",
			behindCard: false
		})

		const v2 = await cardVersion(c.id, 2, {
			name: "Maren v2",
			label: "2.0"
		})
		expect(await readOne(m.id)).toMatchObject({
			name: "Maren v1",
			cardVersion: { id: v1.id, number: 1 },
			behindCard: true
		})

		await castVersion(m.id, w.book.id, {
			year: 20,
			parentVersionId: v2.id,
			follows: ["name"]
		})
		const late = await readOne(m.id)
		expect(late).toMatchObject({
			name: "Maren v2",
			cardVersion: { id: v2.id, number: 2, label: "2.0" },
			behindCard: false
		})
	})

	test("the card a version's parent belongs to is the active card, whatever the member links", async () => {
		const w = await world()
		const old = await card(w, "Verity old")
		const young = await card(w, "Verity young")
		const vOld = await cardVersion(old.id, 1, { name: "Verity old" })
		const vYoung = await cardVersion(young.id, 1, { name: "Verity young" })
		const m = await member(w, old.id)
		await castVersion(m.id, w.book.id, {
			parentVersionId: vOld.id,
			follows: ["name"]
		})
		await castVersion(m.id, w.book.id, {
			year: 20,
			parentVersionId: vYoung.id,
			follows: ["name"]
		})
		expect(await readOne(m.id)).toMatchObject({
			linkedCardId: old.id,
			activeCardId: young.id,
			name: "Verity young"
		})
		expect(
			await readOne(m.id, {
				reading: {
					...MAIN_HEAD,
					moment: { year: 5, month: null, day: null }
				}
			})
		).toMatchObject({ activeCardId: old.id, name: "Verity old" })
	})

	test("a dated version reads from its date; a branch version only on its line", async () => {
		const w = await world()
		const m = await member(w, null)
		await castVersion(m.id, w.book.id, { name: "Base" })
		await castVersion(m.id, w.book.id, {
			name: "Dated",
			year: 30,
			month: 2
		})
		const at = (year: number, month: number | null = null) => ({
			reading: { ...MAIN_HEAD, moment: { year, month, day: null } }
		})
		expect((await readOne(m.id, at(29))).name).toBe("Base")
		expect((await readOne(m.id, at(30, 1))).name).toBe("Base")
		expect((await readOne(m.id, at(30, 2))).name).toBe("Dated")
		expect((await readOne(m.id)).name).toBe("Dated")

		const [branch] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: w.book.id, name: uniq("what-if") })
			.returning()
		await castVersion(m.id, w.book.id, {
			name: "On the branch",
			branchId: branch!.id,
			year: 3
		})
		const line = await lineOfBook(db(), w.book.id, branch!.id)
		const onBranch = await readOne(m.id, {
			reading: {
				branchId: branch!.id,
				moment: null,
				forkedAt: null,
				line
			}
		})
		expect(onBranch.name).toBe("Dated")
		// Dated 3 on the branch loses to the later main row; dated later it wins.
		await castVersion(m.id, w.book.id, {
			name: "Branch later",
			branchId: branch!.id,
			year: 40
		})
		expect(
			(
				await readOne(m.id, {
					reading: {
						branchId: branch!.id,
						moment: null,
						forkedAt: null,
						line
					}
				})
			).name
		).toBe("Branch later")
		// Main never sees the branch's rows.
		expect((await readOne(m.id)).name).toBe("Dated")
	})

	test("appearance narrows by life point; null reads every one", async () => {
		const w = await world()
		const m = await member(w, null)
		await castVersion(m.id, w.book.id, { name: "Base" })
		await castVersion(m.id, w.book.id, {
			name: "Young",
			year: 10,
			personalPosition: 2
		})
		await castVersion(m.id, w.book.id, {
			name: "Old",
			year: 10,
			personalPosition: 5
		})
		const at = (appearance: number | null) => ({
			reading: MAIN_HEAD,
			appearance
		})
		expect((await readOne(m.id)).name).toBe("Old")
		expect((await readOne(m.id, at(null))).name).toBe("Old")
		expect((await readOne(m.id, at(3))).name).toBe("Young")
		expect((await readOne(m.id, at(5))).name).toBe("Old")
		expect((await readOne(m.id, at(1))).name).toBe("Base")
	})

	test("a later deceased version wins: node state is data, never a filter", async () => {
		const w = await world()
		const m = await member(w, null)
		await castVersion(m.id, w.book.id, { name: "Tom" })
		await castVersion(m.id, w.book.id, {
			name: "Tom",
			year: 50,
			nodeState: "deceased",
			nodeVisibility: "legendary"
		})
		expect(await readOne(m.id)).toMatchObject({
			nodeState: "deceased",
			nodeVisibility: "legendary"
		})
		expect(
			await readOne(m.id, {
				reading: {
					...MAIN_HEAD,
					moment: { year: 40, month: null, day: null }
				}
			})
		).toMatchObject({ nodeState: "active", nodeVisibility: "normal" })
	})

	test("a follower with no parent reads those fields empty and warns once per version", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const w = await world()
		const m = await member(w, null)
		const v = await castVersion(m.id, w.book.id, {
			name: "Own name",
			description: "ignored",
			follows: ["description"]
		})
		const r = await readOne(m.id)
		expect(r).toMatchObject({
			castVersionId: v.id,
			cardless: true,
			activeCardId: null,
			cardVersion: null,
			follows: [],
			followsCard: [],
			name: "Own name",
			description: null
		})
		await readOne(m.id)
		const lines = warn.mock.calls
			.map((c) => String(c[0]))
			.filter((l) => l.includes(`character version ${v.id} `))
		expect(lines).toEqual([
			`[cast] character version ${v.id} follows its card but the card version is gone; those fields read empty`
		])
	})

	test("greetings are the merged list; the old three are derived", async () => {
		const w = await world()
		const m = await member(w, null)
		await castVersion(m.id, w.book.id, {
			greetings: [
				{ text: "Hello." },
				{ text: "Or this." },
				{ text: "Group hello.", groupOnly: true }
			],
			postHistoryInstructions: "Stay in voice.",
			creatorNotes: { text: "Notes.", variants: {} },
			extensions: { foo: 1 }
		})
		const r = await readOne(m.id)
		expect(r.greetings).toEqual([
			{ text: "Hello." },
			{ text: "Or this." },
			{ text: "Group hello.", groupOnly: true }
		])
		expect(r).toMatchObject({
			firstMessage: "Hello.",
			alternateGreetings: ["Or this."],
			groupOnlyGreetings: ["Group hello."],
			postHistoryInstructions: "Stay in voice.",
			creatorNotes: { text: "Notes.", variants: {} },
			extensions: { foo: 1 },
			strokes: [],
			likeness: null
		})
	})

	test("voiceFrom: the member's own, the card's, or none", async () => {
		const w = await world()
		const c = await card(w, "Singer")
		const withTimbre = await cardVersion(c.id, 1, {
			timbre: { description: "card alto" }
		})
		const bare = await cardVersion((await card(w, "Mute")).id, 1)
		const own = await member(w, null)
		await castVersion(own.id, w.book.id, {
			timbre: { description: "own bass" }
		})
		const fromCard = await member(w, c.id)
		await castVersion(fromCard.id, w.book.id, {
			parentVersionId: withTimbre.id,
			follows: ["timbre"],
			timbre: { description: "ignored" }
		})
		const followsNothingThere = await member(w, null)
		await castVersion(followsNothingThere.id, w.book.id, {
			parentVersionId: bare.id,
			follows: ["timbre"]
		})
		const none = await member(w, null)
		await castVersion(none.id, w.book.id, {})
		const read = await membersAsRead(
			db(),
			[own.id, fromCard.id, followsNothingThere.id, none.id],
			{ reading: MAIN_HEAD }
		)
		expect(read.get(own.id)).toMatchObject({
			voiceFrom: "member",
			timbre: { description: "own bass" }
		})
		expect(read.get(fromCard.id)).toMatchObject({
			voiceFrom: "card",
			timbre: { description: "card alto" }
		})
		expect(read.get(followsNothingThere.id)).toMatchObject({
			voiceFrom: null,
			timbre: null
		})
		expect(read.get(none.id)).toMatchObject({
			voiceFrom: null,
			timbre: null
		})
	})

	test("a member whose only version is dated after the reading is absent and logged as an error", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {})
		const w = await world()
		const m = await member(w, null, { name: "Late" })
		await castVersion(m.id, w.book.id, { name: "Late", year: 50 })
		const read = await readOne(m.id, {
			reading: {
				...MAIN_HEAD,
				moment: { year: 5, month: null, day: null }
			}
		})
		expect(read).toBeUndefined()
		const lines = error.mock.calls
			.map((l) => String(l[0]))
			.filter((l) => l.includes(`cast member ${m.id} `))
		expect(lines).toEqual([
			`[cast] cast member ${m.id} has character versions, but none reads on this reading; it is left out`
		])
	})

	test("a member with no version is absent and logged once as an error", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {})
		const w = await world()
		const c = await card(w, "Old Maren")
		const m = await member(w, c.id, { name: "Old Maren" })
		const [mine, other] = await Promise.all([readOne(m.id), readOne(m.id)])
		expect(mine).toBeUndefined()
		expect(other).toBeUndefined()
		const lines = error.mock.calls
			.map((l) => String(l[0]))
			.filter((l) => l.includes(`cast member ${m.id} `))
		expect(lines).toEqual([
			`[cast] cast member ${m.id} has no character version at all; it is left out`
		])
		error.mockRestore()
	})
})

/** A session on `w.book` with its own book; an overlay binding of `attached` in that book. */
async function sessionWithOverlay(
	w: World,
	attached: { id: number },
	extra: Partial<typeof schema.sessions.$inferInsert> = {}
) {
	const [s] = await testDb
		.insert(schema.sessions)
		.values({
			userId: w.user.id,
			isGroup: false,
			name: uniq("Run"),
			lorebookId: w.book.id,
			...extra
		} as any)
		.returning()
	const [own] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: w.user.id, name: uniq("Own"), sessionId: s!.id })
		.returning()
	const overlay = await member(w, null, { overlayOf: attached.id }, own!.id)
	return { session: s!, own: own!, overlay }
}

describe("the overlay chain and the session cuts", () => {
	test("an own-book overlay row outranks the attached row of the same date; a reader with no session never sees it", async () => {
		const w = await world()
		const m = await member(w, null)
		await castVersion(m.id, w.book.id, { name: "Base" })
		const attached = await castVersion(m.id, w.book.id, {
			name: "Attached",
			year: 10
		})
		const { session, own, overlay } = await sessionWithOverlay(w, m)
		const mine = await castVersion(overlay.id, own.id, {
			name: "Overlay",
			year: 10
		})

		expect((await readOne(m.id, { sessionId: session.id })).name).toBe(
			"Overlay"
		)
		expect((await readOne(m.id)).name).toBe("Attached")
		expect((await readOne(m.id, { reading: MAIN_HEAD })).name).toBe(
			"Attached"
		)

		const picked = await castVersionsInForce(db(), [m.id], {
			sessionId: session.id
		})
		expect(picked.get(m.id)).toMatchObject({
			overlayDepth: 0,
			version: { id: mine.id }
		})
		const plain = await castVersionsInForce(db(), [m.id, 987654], {
			reading: MAIN_HEAD
		})
		expect([...plain.keys()]).toEqual([m.id])
		expect(plain.get(m.id)).toMatchObject({
			overlayDepth: null,
			version: { id: attached.id }
		})
		expect(await castVersionsInForce(db(), [])).toEqual(new Map())

		// A dated attached row beats an undated overlay row: date comes first.
		await castVersion(m.id, w.book.id, { name: "Attached later", year: 11 })
		expect((await readOne(m.id, { sessionId: session.id })).name).toBe(
			"Attached later"
		)
	})

	test("an ancestor's own-book row reads through the branch's cut, and the branch's Back lowers it", async () => {
		const w = await world()
		const m = await member(w, null)
		await castVersion(m.id, w.book.id, { name: "Base" })
		const parent = await sessionWithOverlay(w, m)
		const ofParent = {
			sourceSessionId: parent.session.id,
			lorebookId: parent.own.id
		}
		await castVersion(parent.overlay.id, parent.own.id, {
			name: "Seen",
			sourceSessionId: ofParent.sourceSessionId,
			sourceMessageId: 8,
			writeOrder: 20
		})
		await castVersion(parent.overlay.id, parent.own.id, {
			name: "Past the copied lines",
			sourceSessionId: ofParent.sourceSessionId,
			sourceMessageId: 12,
			writeOrder: 30
		})
		await castVersion(parent.overlay.id, parent.own.id, {
			name: "Written after the fork",
			sourceSessionId: ofParent.sourceSessionId,
			sourceMessageId: 9,
			writeOrder: 50
		})
		const [branch] = await testDb
			.insert(schema.sessions)
			.values({
				userId: w.user.id,
				isGroup: false,
				name: uniq("Branch"),
				lorebookId: w.book.id,
				branchAncestry: [{ sessionId: parent.session.id, mark: 40 }]
			} as any)
			.returning()
		const [copied] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: branch!.id,
				role: "assistant",
				content: "copied",
				originSessionId: parent.session.id,
				originMessageId: 10
			} as any)
			.returning()

		// The parent reads its own book whole: the last write wins.
		expect(
			(await readOne(m.id, { sessionId: parent.session.id })).name
		).toBe("Written after the fork")
		// The branch reads the parent's book through its cut.
		const viaBranch = await castVersionsInForce(db(), [m.id], {
			sessionId: branch!.id
		})
		expect(viaBranch.get(m.id)).toMatchObject({
			overlayDepth: 0,
			version: { name: "Seen" }
		})
		expect((await readOne(m.id, { sessionId: branch!.id })).name).toBe(
			"Seen"
		)

		// Back on the branch: its copied line is rewound, nothing of the parent's reads.
		await testDb
			.update(schema.sessionMessages)
			.set({ rewindOrdinal: 1 })
			.where(eq(schema.sessionMessages.id, copied!.id))
		expect((await readOne(m.id, { sessionId: branch!.id })).name).toBe(
			"Base"
		)
	})

	test("a session with no attached book reads Main with its session cuts", async () => {
		const w = await world()
		const m = await member(w, null)
		await castVersion(m.id, w.book.id, { name: "Base" })
		const parent = await sessionWithOverlay(w, m)
		await castVersion(parent.overlay.id, parent.own.id, {
			name: "Parent's",
			sourceSessionId: parent.session.id,
			sourceMessageId: 4,
			writeOrder: 10
		})
		const [bookless] = await testDb
			.insert(schema.sessions)
			.values({
				userId: w.user.id,
				isGroup: false,
				name: uniq("Bookless"),
				branchAncestry: [{ sessionId: parent.session.id, mark: 40 }]
			} as any)
			.returning()
		// Nothing copied across: the cut is closed, so the parent's row is out.
		expect((await readOne(m.id, { sessionId: bookless!.id })).name).toBe(
			"Base"
		)
		await testDb.insert(schema.sessionMessages).values({
			sessionId: bookless!.id,
			role: "assistant",
			content: "copied",
			originSessionId: parent.session.id,
			originMessageId: 6
		} as any)
		expect((await readOne(m.id, { sessionId: bookless!.id })).name).toBe(
			"Parent's"
		)
	})
})
