/**
 * The graph build reads and writes on ONE line (plan A3 and its review).
 *
 * The build read every line's scenes and direct history entries by book, then
 * applied to main — so a scene played only on a branch put its ties on main,
 * where every other line reads them. The build's line is:
 *
 * - **main**, for **Rebuild**;
 * - **the line the Graph lens is reading**, for **Extend graph**;
 * - **the session's line**, for **Extend from this session**.
 *
 * It reads that line's OWN writing — the scenes captured on it and its history
 * entries with no scene of its own — and seeds from the ties the line reads
 * (its own, and its ancestors' up to each fork). A scene an ancestor holds is
 * the ancestor's: its ties are filed there by that line's build, and reach the
 * branch through the line. Apply writes what the person approved on the same
 * line; a branch's telling of a tie it inherited is its own version, at that
 * version's date, which the branch then reads in place of the inherited one.
 * The Replace wipe keeps today's scope (every line's cast ties — the owner has
 * not ruled on a branch Rebuild).
 *
 * The builder itself is a stand-in: what is asserted is what the socket layer
 * hands it and what apply writes, which no LLM is needed for.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { activityStore } from "$lib/server/utils/activityStore"
import { applyAtReview } from "./fixtures/graphReview"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

/** What each build handed the builder, in call order. */
const captured: Array<{
	sceneIds: number[]
	directEntryIds: number[]
	seedTies: string[]
}> = []
/** What the stand-in builder proposes next. */
let nextProposal: any = { nodes: [], relationships: [] }

vi.mock("$lib/server/utils/graphBuilder", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/server/utils/graphBuilder")>()
	return {
		...actual,
		buildGraphFromScenes: async (opts: any) => {
			captured.push({
				sceneIds: opts.scenes
					.filter((s: any) => s.sourceHistoryEntryId == null)
					.map((s: any) => s.id)
					.sort((a: number, b: number) => a - b),
				directEntryIds: opts.scenes
					.filter((s: any) => s.sourceHistoryEntryId != null)
					.map((s: any) => s.sourceHistoryEntryId)
					.sort((a: number, b: number) => a - b),
				seedTies: (opts.seedRelationships ?? [])
					.map((r: any) => r.relationshipType)
					.sort()
			})
			return {
				proposal: nextProposal,
				resolvedSceneCast: [],
				sceneLabels: [],
				seedTempIdMap: {},
				seedNodeNames: {}
			}
		}
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-graph-line-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb

	// The instance's text default — the build refuses before reading a scene
	// without one.
	const [connection] = await testDb
		.insert(schema.connections)
		.values({ name: "Graph default", type: "ollama" })
		.returning()
	const [sampling] = await testDb
		.insert(schema.samplingConfigs)
		.values({ name: "Graph sampling", isImmutable: false })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const model = await ensureConnectionModel(testDb as any, connection.id, "graph-7b")
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(testDb as any, "text->text", {
		connectionId: connection.id,
		connectionModelId: model!.id,
		samplingConfigId: sampling.id
	})
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

beforeEach(() => {
	captured.length = 0
	nextProposal = { nodes: [], relationships: [] }
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

/**
 * A book with main, a fork of main at year 5, and a sibling fork.
 *
 * Scenes: `main` (main, year 1), `forkEarlyOnMain` (the fork session's, on
 * main at year 1 — before the cut), `forkLateOnMain` (the fork session's, on
 * main at year 9 — past the cut), `fork` (on the fork), `sibling` (the fork
 * session's, on the sibling). Direct history entries: one per line, and
 * `mainOnlyForked` — main's entry whose one scene was played on the fork.
 */
async function makeBook(label: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `line-${label}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: label, userId: user.id })
		.returning()
	const member = async (name: string, n: number) =>
		(
			await testDb
				.insert(schema.lorebookBindings)
				.values({ lorebookId: lorebook.id, binding: `{{char:${n}}}`, name })
				.returning()
		)[0]
	const aria = await member("Aria", 1)
	const bram = await member("Bram", 2)
	const cole = await member("Cole", 3)
	// Aria and Bram are cards, so a session can speak as them and read the
	// graph the way a prompt does.
	const [ariaCard, bramCard] = await testDb
		.insert(schema.characters)
		.values([
			{ userId: user.id, name: "Aria", description: "…" },
			{ userId: user.id, name: "Bram", description: "…" }
		] as any)
		.returning()
	await testDb
		.update(schema.lorebookBindings)
		.set({ characterId: ariaCard.id })
		.where(eq(schema.lorebookBindings.id, aria.id))
	await testDb
		.update(schema.lorebookBindings)
		.set({ characterId: bramCard.id })
		.where(eq(schema.lorebookBindings.id, bram.id))

	const [fork] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: lorebook.id, name: "What if", forkYear: 5 })
		.returning()
	const [sibling] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: lorebook.id, name: "Other road" })
		.returning()

	const history = async (
		year: number,
		content: string,
		branchId: number | null = null
	) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values(historyValues([{ lorebookId: lorebook.id, year, content, branchId }]))
				.returning()
		)[0]
	const hMain1 = await history(1, "")
	const hMain9 = await history(9, "")
	const hFork = await history(6, "", fork.id)
	const hSibling = await history(6, "", sibling.id)
	const direct = {
		main: await history(2, "Aria was promoted."),
		fork: await history(7, "Bram left.", fork.id),
		sibling: await history(7, "Cole stayed.", sibling.id),
		mainOnlyForked: await history(3, "Aria and Cole made peace.")
	}

	const [forkSession] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: true,
			lorebookId: lorebook.id,
			lorebookBranchId: fork.id
		})
		.returning()
	const [mainSession] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: true, lorebookId: lorebook.id })
		.returning()

	const scene = async (
		name: string,
		historyEntryId: number,
		branchId: number | null,
		sessionId: number | null = null
	) =>
		(
			await testDb
				.insert(schema.scenes)
				.values({
					lorebookId: lorebook.id,
					name,
					summary: `${name}.`,
					historyEntryId,
					branchId,
					sessionId
				})
				.returning()
		)[0]
	const scenes = {
		main: await scene("On main", hMain1.id, null),
		forkEarlyOnMain: await scene("Before the fork", hMain1.id, null, forkSession.id),
		forkLateOnMain: await scene("Main, after the fork", hMain9.id, null, forkSession.id),
		fork: await scene("On the fork", hFork.id, fork.id, forkSession.id),
		sibling: await scene("On the sibling", hSibling.id, sibling.id, forkSession.id),
		forkUnderMainEntry: await scene(
			"Played on the fork, filed under main's entry",
			direct.mainOnlyForked.id,
			fork.id
		)
	}

	const tie = async (
		fromNodeId: number,
		toNodeId: number,
		relationshipType: string,
		branchId: number | null,
		over: Record<string, unknown> = {}
	) =>
		(
			await testDb
				.insert(schema.narrativeRelationships)
				.values({
					lorebookId: lorebook.id,
					fromNodeId,
					toNodeId,
					relationshipType,
					description: "",
					visibility: "acknowledged",
					status: "active",
					branchId,
					...over
				} as any)
				.returning()
		)[0]

	return {
		user,
		lorebook,
		aria,
		bram,
		cole,
		ariaCard,
		bramCard,
		fork,
		sibling,
		hMain1,
		hMain9,
		hFork,
		forkSession,
		mainSession,
		direct,
		scenes,
		scene,
		tie
	}
}

type Book = Awaited<ReturnType<typeof makeBook>>

async function build(
	book: Book,
	mode: "replace" | "extend",
	sessionId?: number,
	branchId?: number
) {
	const { narrativeGraphBuildHandler } = await import("./narrativeGraph")
	return narrativeGraphBuildHandler.handler(
		fakeSocket(book.user.id),
		{
			lorebookId: book.lorebook.id,
			mode,
			...(sessionId ? { sessionId } : {}),
			...(branchId ? { branchId } : {})
		} as any,
		noopEmit as any
	)
}

/** The graph build's activity for this book, whatever its status. */
const buildActivity = (book: Book): any =>
	activityStore
		.getFor(book.user.id, false)
		.find((a: any) => a.kind === "graph_build" && a.lorebookId === book.lorebook.id)

/** What a session speaking as Aria reads of the graph, as a prompt does. */
async function ariaReads(book: Book, sessionId: number) {
	const { buildGraphRelationshipRows } = await import(
		"$lib/server/utils/graphContextFormatter"
	)
	return (
		(await buildGraphRelationshipRows({
			sessionId,
			lorebookId: book.lorebook.id,
			speakerCharacterId: book.ariaCard.id,
			db: testDb as any
		})) ?? []
	)
}

const graphedScene = async (id: number) =>
	(
		await testDb
			.select({ graphed: schema.scenes.graphed })
			.from(schema.scenes)
			.where(eq(schema.scenes.id, id))
	)[0].graphed

const graphedEntry = async (id: number) =>
	(
		(
			await testDb
				.select({ fields: schema.lorebookEntries.fields })
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.id, id))
		)[0].fields as any
	)?.graphed ?? false

const rel = (book: Book, over: Record<string, unknown> = {}) => ({
	fromTempId: `existing_${book.aria.id}`,
	toTempId: `existing_${book.bram.id}`,
	relationshipType: "ally",
	description: "",
	visibility: "acknowledged",
	status: "active",
	...over
})

const proposalOf = (...relationships: any[]) => ({
	nodes: [],
	relationships,
	updatedNodes: [],
	resolvedSceneCast: []
})

/** The build parked at review for this book, as its activity. */
const parkedBuild = (book: Book): any =>
	activityStore
		.getFor(book.user.id, false)
		.find(
			(a: any) =>
				a.kind === "graph_build" &&
				a.lorebookId === book.lorebook.id &&
				a.status === "review"
		)

async function applyParked(book: Book, proposal: any) {
	const { narrativeGraphApplyProposalHandler } = await import("./narrativeGraph")
	const activity = parkedBuild(book)
	expect(activity, "the build is at review").toBeTruthy()
	return narrativeGraphApplyProposalHandler.handler(
		fakeSocket(book.user.id),
		{ lorebookId: book.lorebook.id, activityId: activity.id, proposal } as any,
		noopEmit as any
	)
}

const tiesOf = async (book: Book) =>
	testDb
		.select()
		.from(schema.narrativeRelationships)
		.where(eq(schema.narrativeRelationships.lorebookId, book.lorebook.id))

const ids = (...rows: Array<{ id: number }>) =>
	rows.map((r) => r.id).sort((a, b) => a - b)

describe("the graph build reads its own line", () => {
	test("Rebuild reads main's scenes and direct history entries only", async () => {
		const book = await makeBook("rebuild-reads-main")
		await build(book, "replace")
		expect(captured).toHaveLength(1)
		expect(captured[0].sceneIds).toEqual(
			ids(book.scenes.main, book.scenes.forkEarlyOnMain, book.scenes.forkLateOnMain)
		)
		// Main's entry whose one scene was played on the fork is main's own
		// writing: on main it has no scene, so it is read as a direct entry.
		expect(captured[0].directEntryIds).toEqual(
			ids(book.direct.main, book.direct.mainOnlyForked)
		)
	}, 60_000)

	test("Extend graph from the lorebook reads main's line too, and seeds main's ties only", async () => {
		const book = await makeBook("extend-reads-main")
		await book.tie(book.aria.id, book.bram.id, "ally", null)
		await book.tie(book.aria.id, book.cole.id, "rival", book.fork.id)
		await build(book, "extend")
		expect(captured[0].sceneIds).toEqual(
			ids(book.scenes.main, book.scenes.forkEarlyOnMain, book.scenes.forkLateOnMain)
		)
		expect(captured[0].directEntryIds).toEqual(
			ids(book.direct.main, book.direct.mainOnlyForked)
		)
		expect(captured[0].seedTies).toEqual(["ally"])
	}, 60_000)

	test("Extend from a session on a fork reads that session's scenes on the fork, and seeds from the fork's line", async () => {
		const book = await makeBook("extend-reads-fork")
		await book.tie(book.aria.id, book.bram.id, "ally", null)
		await book.tie(book.aria.id, book.cole.id, "rival", book.fork.id)
		await book.tie(book.bram.id, book.cole.id, "enemy", book.sibling.id)
		await build(book, "extend", book.forkSession.id)
		// Not the scenes it played on main (main's build reads those), not
		// the sibling's, not another session's on the fork.
		expect(captured[0].sceneIds).toEqual(ids(book.scenes.fork))
		// A session-scoped extend reads no direct entries, as before.
		expect(captured[0].directEntryIds).toEqual([])
		expect(captured[0].seedTies).toEqual(["ally", "rival"])
		expect(parkedBuild(book)?.branchId).toBe(book.fork.id)
	}, 60_000)

	test("a fork session's Extend leaves the scenes it played on main to main's build", async () => {
		const book = await makeBook("fork-session-leaves-main")
		await build(book, "extend", book.forkSession.id)
		await applyParked(book, proposalOf())
		expect(await graphedScene(book.scenes.forkEarlyOnMain.id)).toBe(false)
		expect(await graphedScene(book.scenes.fork.id)).toBe(true)
		await build(book, "extend")
		expect(captured[1].sceneIds).toContain(book.scenes.forkEarlyOnMain.id)
		expect(captured[1].sceneIds).not.toContain(book.scenes.fork.id)
	}, 60_000)

	test("Extend graph on a branch reads that branch's own scenes and history entries, and seeds from its line", async () => {
		const book = await makeBook("extend-reads-branch")
		await book.tie(book.aria.id, book.bram.id, "ally", null)
		await book.tie(book.aria.id, book.cole.id, "rival", book.fork.id)
		await book.tie(book.bram.id, book.cole.id, "enemy", book.sibling.id)
		await build(book, "extend", undefined, book.fork.id)
		// Every session's scene on the fork, and none of main's.
		expect(captured[0].sceneIds).toEqual(
			ids(book.scenes.fork, book.scenes.forkUnderMainEntry)
		)
		expect(captured[0].directEntryIds).toEqual(ids(book.direct.fork))
		expect(captured[0].seedTies).toEqual(["ally", "rival"])
		expect(parkedBuild(book)?.branchId).toBe(book.fork.id)
		await applyParked(book, proposalOf())
		expect(await graphedEntry(book.direct.fork.id)).toBe(true)
		expect(await graphedEntry(book.direct.main.id)).toBe(false)
		expect(await graphedScene(book.scenes.forkUnderMainEntry.id)).toBe(true)
		expect(await graphedScene(book.scenes.forkEarlyOnMain.id)).toBe(false)
	}, 60_000)

	test("Rebuild on a branch is refused before anything starts: it reads and writes main", async () => {
		const book = await makeBook("rebuild-branch-refused")
		await expect(build(book, "replace", undefined, book.fork.id)).rejects.toThrow(
			/Rebuild reads and writes main/
		)
		expect(captured).toHaveLength(0)
	}, 60_000)

	test("Extend graph on a line this book does not have is refused", async () => {
		const book = await makeBook("extend-foreign-branch")
		const other = await makeBook("extend-foreign-branch-other")
		await expect(build(book, "extend", undefined, other.fork.id)).rejects.toThrow(
			/not a line of this lorebook/
		)
		expect(captured).toHaveLength(0)
	}, 60_000)

	test("a session whose unread scenes are all on other lines is told where they are", async () => {
		const book = await makeBook("extend-offline-scenes")
		await testDb
			.update(schema.scenes)
			.set({ graphed: true })
			.where(eq(schema.scenes.id, book.scenes.fork.id))
		await build(book, "extend", book.forkSession.id)
		expect(captured).toHaveLength(0)
		expect(buildActivity(book)?.errorMessage).toMatch(
			/3 of this session's scenes were played on another line/
		)
		expect(await graphedScene(book.scenes.forkLateOnMain.id)).toBe(false)
	}, 60_000)

	test("a session that does not read this book is refused before anything starts", async () => {
		const book = await makeBook("extend-foreign-session")
		const [elsewhere] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Elsewhere", userId: book.user.id })
			.returning()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: book.user.id, isGroup: true, lorebookId: elsewhere.id })
			.returning()
		await expect(build(book, "extend", session.id)).rejects.toThrow(
			/does not read this lorebook/
		)
		expect(captured).toHaveLength(0)
	}, 60_000)
})

describe("the graph build writes on its own line", () => {
	test("a tie applied from a fork session's build lands on the fork, and main's version is left alone", async () => {
		const book = await makeBook("apply-writes-fork")
		const onMain = await book.tie(book.aria.id, book.bram.id, "ally", null)
		const proposal = {
			nodes: [],
			relationships: [
				{
					fromTempId: `existing_${book.aria.id}`,
					toTempId: `existing_${book.bram.id}`,
					relationshipType: "ally",
					description: "They swore it again on the fork.",
					visibility: "acknowledged",
					status: "active",
					sceneId: book.scenes.fork.id,
					historyEntryId: book.hFork.id
				}
			],
			updatedNodes: [],
			resolvedSceneCast: []
		}
		nextProposal = proposal
		await build(book, "extend", book.forkSession.id)
		await applyParked(book, proposal)

		const rows = await tiesOf(book)
		const main = rows.find((r) => r.id === onMain.id)!
		expect(main.description).toBe("")
		const written = rows.filter((r) => r.id !== onMain.id)
		expect(written).toHaveLength(1)
		expect(written[0].branchId).toBe(book.fork.id)
		expect(written[0].description).toBe("They swore it again on the fork.")
	}, 60_000)

	test("an Extend on a fork updates the fork's own version of a tie, never adding a main row", async () => {
		const book = await makeBook("apply-updates-fork")
		const onFork = await book.tie(book.aria.id, book.cole.id, "rival", book.fork.id, {
			historyEntryId: book.hFork.id,
			sceneId: book.scenes.fork.id
		})
		const proposal = {
			nodes: [],
			relationships: [
				{
					fromTempId: `existing_${book.aria.id}`,
					toTempId: `existing_${book.cole.id}`,
					relationshipType: "rival",
					description: "Sharper now.",
					visibility: "acknowledged",
					status: "active",
					sceneId: book.scenes.fork.id,
					historyEntryId: book.hFork.id
				}
			],
			updatedNodes: [],
			resolvedSceneCast: []
		}
		nextProposal = proposal
		await build(book, "extend", book.forkSession.id)
		await applyParked(book, proposal)

		const rows = await tiesOf(book)
		expect(rows).toHaveLength(1)
		expect(rows[0].id).toBe(onFork.id)
		expect(rows[0].branchId).toBe(book.fork.id)
		expect(rows[0].description).toBe("Sharper now.")
	}, 60_000)

	test("a relationship filed at a scene on another line is refused, and nothing is written", async () => {
		const book = await makeBook("apply-refuses-other-line")
		const { narrativeGraphApplyProposalHandler } = await import("./narrativeGraph")
		const proposal = {
			nodes: [],
			relationships: [
				{
					fromTempId: `existing_${book.aria.id}`,
					toTempId: `existing_${book.bram.id}`,
					relationshipType: "ally",
					description: "",
					visibility: "acknowledged",
					status: "active",
					// A main build, filed at the sibling's scene.
					sceneId: book.scenes.sibling.id
				}
			],
			updatedNodes: [],
			resolvedSceneCast: []
		}
		await expect(
			narrativeGraphApplyProposalHandler.handler(
				fakeSocket(book.user.id),
				applyAtReview(book.user.id, {
					lorebookId: book.lorebook.id,
					mode: "extend",
					proposal
				} as any),
				noopEmit as any
			)
		).rejects.toThrow(/another line of this lorebook/)
		expect(await tiesOf(book)).toHaveLength(0)
	}, 60_000)

	test("a fork build's relationship filed at a main scene or entry dated past the fork is refused", async () => {
		const book = await makeBook("apply-refuses-past-cut")
		const { narrativeGraphApplyProposalHandler } = await import("./narrativeGraph")
		const at = async (over: Record<string, unknown>) =>
			narrativeGraphApplyProposalHandler.handler(
				fakeSocket(book.user.id),
				applyAtReview(book.user.id, {
					lorebookId: book.lorebook.id,
					mode: "extend",
					branchId: book.fork.id,
					proposal: proposalOf(rel(book, over)) as any
				}),
				noopEmit as any
			)
		// Main's scene at year 9, after the fork's cut at year 5.
		await expect(at({ sceneId: book.scenes.forkLateOnMain.id })).rejects.toThrow(
			/scene this proposal came from is on another line/
		)
		await expect(at({ historyEntryId: book.hMain9.id })).rejects.toThrow(
			/history entry this proposal came from is on another line/
		)
		expect(await tiesOf(book)).toHaveLength(0)
	}, 60_000)

	test("a fork's telling of a tie it inherited at the same date is the fork's own version, read in place of main's there", async () => {
		const book = await makeBook("apply-overlays-same-date")
		// The fork session played a scene filed under main's year-1 entry,
		// where main already holds the tie.
		const underMain = await book.scene("On the fork, under main's year 1", book.hMain1.id, book.fork.id, book.forkSession.id)
		const onMain = await book.tie(book.aria.id, book.bram.id, "ally", null, {
			historyEntryId: book.hMain1.id,
			description: "friends",
			reason: "they grew up together"
		})
		nextProposal = proposalOf(
			rel(book, { sceneId: underMain.id, historyEntryId: book.hMain1.id, description: "estranged" })
		)
		await build(book, "extend", book.forkSession.id)
		expect(captured[0].seedTies).toEqual(["ally"])
		await applyParked(book, nextProposal)

		const rows = await tiesOf(book)
		expect(rows).toHaveLength(2)
		const main = rows.find((r) => r.id === onMain.id)!
		expect(main.description).toBe("friends")
		const forks = rows.filter((r) => r.id !== onMain.id)
		expect(forks.map((r) => [r.branchId, r.historyEntryId, r.description, r.reason])).toEqual([
			[book.fork.id, book.hMain1.id, "estranged", "they grew up together"]
		])
		const onFork = await ariaReads(book, book.forkSession.id)
		expect(onFork.map((r: any) => r.id)).toEqual([forks[0].id])
		const onMainLine = await ariaReads(book, book.mainSession.id)
		expect(onMainLine.map((r: any) => r.id)).toEqual([onMain.id])
	}, 60_000)

	test("an undated telling of an undated inherited tie is the fork's own, carrying what it leaves unsaid", async () => {
		const book = await makeBook("apply-overlays-undated")
		const onMain = await book.tie(book.aria.id, book.bram.id, "ally", null, {
			description: "friends"
		})
		nextProposal = proposalOf(rel(book, { description: undefined, status: "resolved" }))
		await build(book, "extend", book.forkSession.id)
		await applyParked(book, nextProposal)

		const rows = await tiesOf(book)
		const main = rows.find((r) => r.id === onMain.id)!
		expect([main.description, main.status]).toEqual(["friends", "active"])
		const forks = rows.filter((r) => r.id !== onMain.id)
		expect(forks.map((r) => [r.branchId, r.historyEntryId, r.description, r.status])).toEqual([
			[book.fork.id, null, "friends", "resolved"]
		])
		expect((await ariaReads(book, book.forkSession.id)).map((r: any) => r.id)).toEqual([forks[0].id])
	}, 60_000)

	test("a branch's secret telling of a tie hides the acknowledged one it inherited from the cast-wide read", async () => {
		const book = await makeBook("secret-telling-hides")
		const onMain = await book.tie(book.aria.id, book.bram.id, "ally", null, {
			description: "friends"
		})
		await book.tie(book.aria.id, book.bram.id, "ally", book.fork.id, {
			description: "a grudge she hides",
			visibility: "secret"
		})
		for (const sessionId of [book.forkSession.id, book.mainSession.id])
			await testDb.insert(schema.sessionCharacters).values([
				{ sessionId, characterId: book.ariaCard.id },
				{ sessionId, characterId: book.bramCard.id }
			])
		const { buildCastRelationshipRows } = await import(
			"$lib/server/utils/graphContextFormatter"
		)
		const castRead = async (sessionId: number) =>
			(
				(await buildCastRelationshipRows({
					sessionId,
					lorebookId: book.lorebook.id,
					db: testDb as any
				})) ?? []
			).map((r: any) => r.id)
		expect(await castRead(book.forkSession.id)).toEqual([])
		expect(await castRead(book.mainSession.id)).toEqual([onMain.id])
	}, 60_000)

	test("a second Extend on the fork updates the fork's version rather than adding a third", async () => {
		const book = await makeBook("apply-overlay-then-update")
		await book.tie(book.aria.id, book.bram.id, "ally", null, { description: "friends" })
		nextProposal = proposalOf(rel(book, { description: "wary" }))
		await build(book, "extend", book.forkSession.id)
		await applyParked(book, nextProposal)
		await testDb
			.update(schema.scenes)
			.set({ graphed: false })
			.where(eq(schema.scenes.id, book.scenes.fork.id))
		nextProposal = proposalOf(rel(book, { description: "estranged" }))
		await build(book, "extend", book.forkSession.id)
		await applyParked(book, nextProposal)
		const forks = (await tiesOf(book)).filter((r) => r.branchId === book.fork.id)
		expect(forks.map((r) => r.description)).toEqual(["estranged"])
	}, 60_000)

	test("a build whose branch was deleted while it waited is refused, and nothing is written", async () => {
		const book = await makeBook("apply-branch-gone")
		const { narrativeGraphApplyProposalHandler } = await import("./narrativeGraph")
		const [gone] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: book.lorebook.id, name: "Short-lived" })
			.returning()
		const params = applyAtReview(book.user.id, {
			lorebookId: book.lorebook.id,
			mode: "extend",
			branchId: gone.id,
			proposal: {
				nodes: [],
				relationships: [
					{
						fromTempId: `existing_${book.aria.id}`,
						toTempId: `existing_${book.bram.id}`,
						relationshipType: "ally",
						description: "",
						visibility: "acknowledged",
						status: "active"
					}
				],
				updatedNodes: [],
				resolvedSceneCast: []
			} as any
		})
		await testDb
			.delete(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.id, gone.id))
		await expect(
			narrativeGraphApplyProposalHandler.handler(
				fakeSocket(book.user.id),
				params,
				noopEmit as any
			)
		).rejects.toThrow(/built on has been deleted/)
		expect(await tiesOf(book)).toHaveLength(0)
	}, 60_000)

	test("a book-wide Extend stamps what it read graphed, and no fork row", async () => {
		const book = await makeBook("apply-stamps-read")
		nextProposal = { nodes: [], relationships: [] }
		await build(book, "extend")
		await applyParked(book, {
			nodes: [],
			relationships: [],
			updatedNodes: [],
			resolvedSceneCast: []
		})
		const [entry] = await testDb
			.select({ fields: schema.lorebookEntries.fields })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, book.direct.mainOnlyForked.id))
		expect((entry.fields as any)?.graphed).toBe(true)
		const [forkEntry] = await testDb
			.select({ fields: schema.lorebookEntries.fields })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, book.direct.fork.id))
		expect((forkEntry.fields as any)?.graphed ?? false).toBe(false)
		const [forkScene] = await testDb
			.select({ graphed: schema.scenes.graphed })
			.from(schema.scenes)
			.where(eq(schema.scenes.id, book.scenes.fork.id))
		expect(forkScene.graphed).toBe(false)
	}, 60_000)

	test("Rebuild keeps today's wipe: every line's cast ties go, and the new ones are on main", async () => {
		const book = await makeBook("rebuild-wipe-scope")
		await book.tie(book.aria.id, book.cole.id, "rival", book.fork.id)
		await book.tie(book.bram.id, book.cole.id, "enemy", book.sibling.id)
		const proposal = {
			nodes: [],
			relationships: [
				{
					fromTempId: `existing_${book.aria.id}`,
					toTempId: `existing_${book.bram.id}`,
					relationshipType: "ally",
					description: "",
					visibility: "acknowledged",
					status: "active",
					sceneId: book.scenes.main.id
				}
			],
			updatedNodes: [],
			resolvedSceneCast: []
		}
		nextProposal = proposal
		await build(book, "replace")
		await applyParked(book, proposal)
		const rows = await tiesOf(book)
		expect(rows.map((r) => [r.relationshipType, r.branchId])).toEqual([
			["ally", null]
		])
		// The fork's scenes wait, ungraphed, for a session on the fork.
		const graphed = new Map(
			(
				await testDb
					.select({ id: schema.scenes.id, graphed: schema.scenes.graphed })
					.from(schema.scenes)
					.where(eq(schema.scenes.lorebookId, book.lorebook.id))
			).map((r) => [r.id, r.graphed])
		)
		expect(graphed.get(book.scenes.main.id)).toBe(true)
		expect(graphed.get(book.scenes.fork.id)).toBe(false)
		expect(graphed.get(book.scenes.sibling.id)).toBe(false)
	}, 60_000)
})

describe("the graph list counts what a book-wide build reads", () => {
	test("each branch's own scenes and direct history entries are counted for it", async () => {
		const book = await makeBook("list-counts-branches")
		const { narrativeGraphListHandler } = await import("./narrativeGraph")
		const list: any = await narrativeGraphListHandler.handler(
			fakeSocket(book.user.id),
			{ lorebookId: book.lorebook.id } as any,
			noopEmit as any
		)
		const of = (branchId: number) =>
			list.branchCounts.find((c: any) => c.branchId === branchId)
		expect(of(book.fork.id)).toMatchObject({
			ungraphedSceneCount: 2,
			totalSummarizedCount: 2,
			ungraphedUnsummarizedCount: 0,
			ungraphedHistoryEntryCount: 1,
			totalDirectHistoryEntryCount: 1
		})
		expect(of(book.sibling.id)).toMatchObject({
			ungraphedSceneCount: 1,
			ungraphedHistoryEntryCount: 1
		})
	}, 60_000)

	test("scenes and direct history entries are main's", async () => {
		const book = await makeBook("list-counts-main")
		const { narrativeGraphListHandler } = await import("./narrativeGraph")
		const list: any = await narrativeGraphListHandler.handler(
			fakeSocket(book.user.id),
			{ lorebookId: book.lorebook.id } as any,
			noopEmit as any
		)
		expect(list.totalSummarizedCount).toBe(3)
		expect(list.ungraphedSceneCount).toBe(3)
		expect(list.totalDirectHistoryEntryCount).toBe(2)
		expect(list.ungraphedHistoryEntryCount).toBe(2)
	}, 60_000)
})
