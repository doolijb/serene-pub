/**
 * A session writing to its lorebook (plan A22, owner rulings 2026-09-30).
 *
 * Four claims:
 *
 *  1. **Where it lands.** A session's durable write — the lorebook's own
 *     value, a cast member's, a place's — lands on the session's LINE, dated
 *     at the latest history entry on that line at or before the session's
 *     story clock. Filed on main it leaked into every sibling line; filed
 *     undated it sat under every dated value the author wrote and was never
 *     read.
 *  2. **The mode decides what an automatic write does**: Full writes it,
 *     Review changes files a proposal, Off skips it and says why.
 *  3. **A proposal applies where it was made**, not where the session
 *     stands when somebody finally accepts it.
 *  4. **Off refuses what a person saves from a review screen**, in a
 *     sentence that says where the setting lives; and a person's own choice
 *     overrides the pub's until they reset it.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, genre, _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import { HISTORY_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { LORE_WRITES_OFF } from "$lib/shared/lorebooks/loreWriteMode"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-session-lore-writes-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	// The pub row the settings read (boot makes it; migrations do not).
	await testDb.insert(schema.systemSettings).values({ id: 1 }).onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const HP = "core:slot/hp@1"
const WEATHER = "core:slot/weather@1"
const GENRE = "test:genre/session-lore-writes"

function declareSlots() {
	_clearAttributeSlots()
	const hp = defineAttributeSlot(HP, {
		type: "integer",
		descriptor: "How much punishment they can still take.",
		appliesTo: ["cast"],
		config: { min: 0, max: 20 },
		default: 20
	})
	const weather = defineAttributeSlot(WEATHER, {
		type: "enum",
		descriptor: "What the sky is doing.",
		appliesTo: ["world"],
		config: { of: ["clear", "storm", "fog"] }
	})
	genre(GENRE, { name: { en: "Session lore writes" }, family: "test", slots: [hp, weather], events: {} })
}

let n = 0

/**
 * A book with two lines besides main, and a session playing one of them.
 *
 * - main: Year 2, and Year 5 — after the Fork's cut (Year 4), so the Fork
 *   never sees it;
 * - the Fork (the session's line): Year 3 and Year 9;
 * - the Sibling: Year 6 — a line the Fork is not.
 *
 * The session's clock stands at Year 7: between the Fork's Year 3 and Year 9.
 */
async function world() {
	declareSlots()
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `lore-writes-${suffix}`)
	const [verity] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: `Verity ${suffix}`, description: "…" })
		.returning()
	const [book] = await testDb.insert(schema.lorebooks).values({ userId: user.id, name: `World ${suffix}` }).returning()
	const [fork] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book!.id, name: `Fork ${suffix}`, forkYear: 4 })
		.returning()
	const [sibling] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book!.id, name: `Sibling ${suffix}`, forkYear: 4 })
		.returning()
	let position = 0
	const history = async (year: number, branchId: number | null) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: book!.id,
					typeId: HISTORY_TYPE_ID,
					typeVersion: 1,
					position: position++,
					title: `Year ${year}`,
					content: "…",
					fields: { year },
					branchId
				})
				.returning()
		)[0]!
	const mainY2 = await history(2, null)
	const mainY5 = await history(5, null)
	const forkY3 = await history(3, fork!.id)
	const forkY9 = await history(9, fork!.id)
	const siblingY6 = await history(6, sibling!.id)
	const [member] = await testDb
		.insert(schema.lorebookBindings)
		.values({ lorebookId: book!.id, characterId: verity!.id, binding: "{{char:1}}", name: verity!.name })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			genreId: GENRE,
			lorebookId: book!.id,
			lorebookBranchId: fork!.id,
			storyClockYear: 7
		})
		.returning()
	await testDb.insert(schema.sessionCharacters).values({ sessionId: session!.id, characterId: verity!.id })
	return { user, verity: verity!, book: book!, fork: fork!, sibling: sibling!, member: member!, session: session!, mainY2, mainY5, forkY3, forkY9, siblingY6 }
}
type World = Awaited<ReturnType<typeof world>>

/** This person's own mode; null follows the pub's. */
async function setOwnMode(userId: number, mode: "full" | "review" | "off" | null) {
	await testDb
		.insert(schema.userSettings)
		.values({ userId, loreWriteMode: mode })
		.onConflictDoUpdate({ target: schema.userSettings.userId, set: { loreWriteMode: mode } })
}

const setState = async (runId = "run-a22") => {
	const { stateBindings } = await import("$lib/server/pipelines/runtime/bindings.state")
	return stateBindings({ runId })["core:task/set-state@1"]!
}

const weatherChange = (w: World, value: string) => ({
	owner: { kind: "lorebook", id: w.book.id },
	slotId: WEATHER,
	value
})

const bookRows = async (w: World) =>
	await testDb
		.select()
		.from(schema.attributeValues)
		.where(and(eq(schema.attributeValues.ownerKind, "lorebook"), eq(schema.attributeValues.ownerId, w.book.id)))

const proposalsOf = async (w: World) =>
	await testDb.select().from(schema.stateProposals).where(eq(schema.stateProposals.sessionId, w.session.id))

describe("a session's durable write lands on its line, dated where it stands", () => {
	test("a set-state write from a branch session between two history entries is dated at the earlier one on that branch", async () => {
		const w = await world()
		await setOwnMode(w.user.id, "full")
		// What the author wrote on main at Year 2 — dated, so an undated
		// session write would sit under it and never be read.
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "lorebook",
			ownerId: w.book.id,
			slotId: WEATHER,
			value: { v: "clear" },
			updatedBy: "user",
			historyEntryId: w.mainY2.id
		})
		const out: any = await (await setState())(
			{ scope: { sessionId: w.session.id }, params: { mode: "apply" }, changes: [weatherChange(w, "storm")] },
			{} as any
		)
		expect(out.value.refused ?? []).toEqual([])
		expect(out.value.applied).toHaveLength(1)

		const row = (await bookRows(w)).find((r) => r.id === out.value.applied[0])!
		// On the Fork — never main, which every sibling line reads.
		expect(row.branchId).toBe(w.fork.id)
		// The Fork's Year 3: the latest on its line at or before Year 7. Not
		// main's Year 5 (cut at the fork), not the Sibling's Year 6, not the
		// Fork's own Year 9 (after the clock).
		expect(row.historyEntryId).toBe(w.forkY3.id)

		// And the session reads what it wrote, over the author's Year 2.
		const { valueOf } = await import("$lib/server/state/resolve")
		expect(
			await valueOf(testDb as unknown as Db, {
				sessionId: w.session.id,
				owner: { kind: "session", id: w.session.id },
				slotId: WEATHER
			})
		).toBe("storm")
	})
})

describe("the mode decides what an automatic write does", () => {
	const run = async (w: World) =>
		(await (await setState())(
			{
				scope: { sessionId: w.session.id },
				params: { mode: "apply" },
				changes: [weatherChange(w, "storm"), { owner: { kind: "session_cast", id: w.verity.id }, slotId: HP, value: 9 }]
			},
			{} as any
		)) as any

	test("Full writes it", async () => {
		const w = await world()
		await setOwnMode(w.user.id, "full")
		const out = await run(w)
		expect(out.value.applied).toHaveLength(2)
		expect(out.value.proposed).toHaveLength(0)
		expect(await bookRows(w)).toHaveLength(1)
		expect(await proposalsOf(w)).toHaveLength(0)
	})

	test("Review changes files a proposal carrying the line and the dating, and writes nothing", async () => {
		const w = await world()
		await setOwnMode(w.user.id, "review")
		const out = await run(w)
		// The session's own stat is play, and applies as asked.
		expect(out.value.applied).toHaveLength(1)
		expect(out.value.proposed).toHaveLength(1)
		expect(await bookRows(w)).toHaveLength(0)
		const [proposal] = await proposalsOf(w)
		expect(proposal!.status).toBe("pending")
		expect(proposal!.branchId).toBe(w.fork.id)
		expect(proposal!.historyEntryId).toBe(w.forkY3.id)

		// Its line says it is the lorebook's, not the session's weather.
		const { listedProposals } = await import("$lib/server/state/write")
		const { describeProposal } = await import("$lib/shared/state/ledgerLines")
		const [listed] = await listedProposals(testDb as unknown as Db, w.session.id)
		expect(describeProposal(listed as any, { ownerLabel: () => undefined, slotLabel: () => "Weather" })).toBe(
			"Lorebook · Weather → storm"
		)
	})

	test("the pub default is Review changes", async () => {
		const w = await world()
		const out = await run(w)
		expect(out.value.proposed).toHaveLength(1)
		expect(await bookRows(w)).toHaveLength(0)
	})

	test("Off skips it, and the receipt names the mode", async () => {
		const w = await world()
		await setOwnMode(w.user.id, "off")
		const out = await run(w)
		expect(out.value.applied).toHaveLength(1)
		expect(out.value.proposed).toHaveLength(0)
		expect(out.value.refused).toHaveLength(1)
		expect(out.value.refused[0]).toMatch(/Lorebook writes from sessions are off/)
		expect(await bookRows(w)).toHaveLength(0)
		expect(await proposalsOf(w)).toHaveLength(0)
	})

	test("recording onto the world: Full writes, Review changes proposes, Off skips", async () => {
		const { recordToTimeline } = await import("$lib/server/state/durable")
		const record = async (mode: "full" | "review" | "off") => {
			const w = await world()
			await setOwnMode(w.user.id, mode)
			await testDb.insert(schema.attributeValues).values({
				ownerKind: "session",
				ownerId: w.session.id,
				slotId: WEATHER,
				value: { v: "fog" },
				sessionId: w.session.id,
				updatedBy: "user"
			})
			const report = await recordToTimeline(testDb as unknown as Db, w.session.id, { reason: "mark" })
			return { w, report, rows: await bookRows(w), proposals: await proposalsOf(w) }
		}

		const full = await record("full")
		expect(full.report).toMatchObject({ recorded: true, mode: "full" })
		expect(full.rows).toHaveLength(1)
		expect(full.rows[0]!.branchId).toBe(full.w.fork.id)
		expect(full.rows[0]!.historyEntryId).toBe(full.w.forkY3.id)

		const review = await record("review")
		expect(review.report).toMatchObject({ recorded: false, mode: "review", proposed: 1 })
		expect(review.rows).toHaveLength(0)
		expect(review.proposals).toHaveLength(1)
		expect(review.proposals[0]!.payload).toMatchObject({ owner: { kind: "lorebook", id: review.w.book.id }, slotId: WEATHER, value: "fog" })
		expect(review.proposals[0]!.branchId).toBe(review.w.fork.id)
		expect(review.proposals[0]!.historyEntryId).toBe(review.w.forkY3.id)

		const off = await record("off")
		expect(off.report).toMatchObject({ recorded: false, mode: "off", values: 0, proposed: 0 })
		expect(off.rows).toHaveLength(0)
		expect(off.proposals).toHaveLength(0)
	})

	test("the delete safeguard cannot be reviewed (its proposals would go with the session): Review changes writes it, Off does not", async () => {
		const { recordToTimeline } = await import("$lib/server/state/durable")
		for (const mode of ["review", "off"] as const) {
			const w = await world()
			await setOwnMode(w.user.id, mode)
			await testDb.insert(schema.attributeValues).values({
				ownerKind: "session",
				ownerId: w.session.id,
				slotId: WEATHER,
				value: { v: "fog" },
				sessionId: w.session.id,
				updatedBy: "user"
			})
			await recordToTimeline(testDb as unknown as Db, w.session.id, { reason: "delete" })
			const rows = await bookRows(w)
			expect(await proposalsOf(w)).toHaveLength(0)
			if (mode === "off") expect(rows).toHaveLength(0)
			else {
				expect(rows).toHaveLength(1)
				expect(rows[0]).toMatchObject({ branchId: w.fork.id, historyEntryId: w.forkY3.id })
			}
		}
	})
})

describe("a proposal applies where it was made", () => {
	test("made at Year 7 on the Fork, accepted after the clock moved to Year 10 and the session moved to main, it lands at Year 7's dating on the Fork", async () => {
		const w = await world()
		await setOwnMode(w.user.id, "review")
		const out: any = await (await setState())(
			{ scope: { sessionId: w.session.id }, params: { mode: "apply" }, changes: [weatherChange(w, "storm")] },
			{} as any
		)
		expect(out.value.proposed).toHaveLength(1)

		// The story moves on: at Year 10 the latest on the Fork is Year 9.
		await testDb
			.update(schema.sessions)
			.set({ storyClockYear: 10, lorebookBranchId: null })
			.where(eq(schema.sessions.id, w.session.id))

		const { decideProposal } = await import("$lib/server/state/write")
		const decided = await decideProposal(testDb as unknown as Db, out.value.proposed[0], true, w.user.id)
		expect(decided.status).toBe("accepted")
		const row = (await bookRows(w)).find((r) => r.id === decided.appliedId)!
		expect(row.branchId).toBe(w.fork.id)
		expect(row.historyEntryId).toBe(w.forkY3.id)
	})
})

describe("Off refuses what a person saves from a review screen", () => {
	const socketOf = (w: World) => ({ user: { id: w.user.id }, io: { to: () => ({ emit: () => {} }) } }) as any
	const emitted = () => {
		const out: Array<{ event: string; data: any }> = []
		return { out, emit: (event: string, data: any) => void out.push({ event, data }) }
	}

	test("a summarize: its start, and its saves into the book", async () => {
		const w = await world()
		await setOwnMode(w.user.id, "off")
		const { sessionLoreWrite } = await import("$lib/server/messages/writes")
		await expect(
			sessionLoreWrite(testDb as unknown as Db, { sessionId: w.session.id, userId: w.user.id, lorebookId: w.book.id })
		).rejects.toThrow(LORE_WRITES_OFF)

		const { sceneCreateHandler } = await import("$lib/server/sockets/scenes")
		const scene = emitted()
		await expect(
			sceneCreateHandler.handler(
				socketOf(w),
				{ scene: { sessionId: w.session.id, lorebookId: w.book.id, historyEntryId: w.forkY3.id, name: "The bell" } } as any,
				scene.emit
			)
		).rejects.toThrow(LORE_WRITES_OFF)
		expect(scene.out).toContainEqual({ event: "scenes:create:error", data: expect.objectContaining({ error: LORE_WRITES_OFF }) })
		expect(await testDb.select().from(schema.scenes).where(eq(schema.scenes.lorebookId, w.book.id))).toHaveLength(0)

		const { sessionsSummarizeHandler } = await import("$lib/server/sockets/summarize")
		await expect(
			sessionsSummarizeHandler.handler(socketOf(w), { sessionId: w.session.id, messageIds: [], loreType: "world" } as any, () => {})
		).rejects.toThrow(LORE_WRITES_OFF)
	})

	test("a compile, a graph build and a graph apply", async () => {
		const w = await world()
		await setOwnMode(w.user.id, "off")
		const { sceneCompileHandler } = await import("$lib/server/sockets/scenes")
		const compile = emitted()
		await expect(
			sceneCompileHandler.handler(socketOf(w), { historyEntryId: w.mainY2.id, branchId: null, moment: null } as any, compile.emit)
		).rejects.toThrow(LORE_WRITES_OFF)
		// A scoped error carries its scope key: the history entry it answers.
		expect(compile.out).toContainEqual({
			event: "scenes:compile:error",
			data: { error: LORE_WRITES_OFF, historyEntryId: w.mainY2.id }
		})

		const { narrativeGraphBuildHandler, narrativeGraphApplyProposalHandler } = await import(
			"$lib/server/sockets/narrativeGraph"
		)
		const build = emitted()
		await narrativeGraphBuildHandler.handler(socketOf(w), { lorebookId: w.book.id, mode: "replace" } as any, build.emit).catch(() => {})
		expect(build.out).toContainEqual({ event: "narrativeGraph:build:error", data: expect.objectContaining({ error: LORE_WRITES_OFF }) })

		const apply = emitted()
		await expect(
			narrativeGraphApplyProposalHandler.handler(
				socketOf(w),
				{ lorebookId: w.book.id, activityId: "no-such-build", proposal: { nodes: [], relationships: [] } } as any,
				apply.emit
			)
		).rejects.toThrow()
		expect(apply.out).toContainEqual({
			event: "narrativeGraph:applyProposal:error",
			data: expect.objectContaining({ error: LORE_WRITES_OFF })
		})
	})

	test("a person's own edit of the book from the session, and an Accept — Reject still works", async () => {
		const w = await world()
		await setOwnMode(w.user.id, "review")
		const out: any = await (await setState())(
			{ scope: { sessionId: w.session.id }, params: { mode: "apply" }, changes: [weatherChange(w, "storm"), weatherChange(w, "fog")] },
			{} as any
		)
		expect(out.value.proposed).toHaveLength(2)
		await setOwnMode(w.user.id, "off")

		const { setValue, decideProposal } = await import("$lib/server/state/write")
		await expect(
			setValue(
				testDb as unknown as Db,
				{ sessionId: w.session.id, updatedBy: "user", userId: w.user.id },
				weatherChange(w, "clear") as any
			)
		).rejects.toThrow(LORE_WRITES_OFF)
		await expect(decideProposal(testDb as unknown as Db, out.value.proposed[0], true, w.user.id)).rejects.toThrow(
			LORE_WRITES_OFF
		)
		expect((await decideProposal(testDb as unknown as Db, out.value.proposed[1], false, w.user.id)).status).toBe("rejected")
		expect(await bookRows(w)).toHaveLength(0)
	})

	test("Full and Review changes save as they always did", async () => {
		for (const mode of ["full", "review"] as const) {
			const w = await world()
			await setOwnMode(w.user.id, mode)
			const { sessionLoreWrite } = await import("$lib/server/messages/writes")
			const write = await sessionLoreWrite(testDb as unknown as Db, {
				sessionId: w.session.id,
				userId: w.user.id,
				lorebookId: w.book.id
			})
			expect(write.branchId).toBe(w.fork.id)
		}
	})
})

describe("the per-user override, and its reset", () => {
	test("a person follows the pub until they choose, keeps their choice when the pub moves, and follows it again on reset", async () => {
		const w = await world()
		const { loreWriteModeFor } = await import("$lib/server/state/loreWriteMode")
		const { systemSettingsUpdateLoreWriteModeDefault } = await import("$lib/server/sockets/systemSettings")
		const { userSettingsUpdateLoreWriteMode } = await import("$lib/server/sockets/userSettings")
		const admin = { user: { id: w.user.id, isAdmin: true } } as any
		const person = { user: { id: w.user.id } } as any
		const pub = async (mode: string) =>
			systemSettingsUpdateLoreWriteModeDefault.handler(admin, { mode } as any, () => {})
		const own = async (mode: string | null) => userSettingsUpdateLoreWriteMode.handler(person, { mode } as any, () => {})

		await pub("review")
		expect(await loreWriteModeFor(testDb as unknown as Db, w.user.id)).toBe("review")
		// Following: the pub moves them.
		await pub("full")
		expect(await loreWriteModeFor(testDb as unknown as Db, w.user.id)).toBe("full")
		// Their own choice holds when the pub moves again.
		const chose: any = await own("off")
		expect(chose).toMatchObject({ mode: "off", effectiveMode: "off" })
		await pub("review")
		expect(await loreWriteModeFor(testDb as unknown as Db, w.user.id)).toBe("off")
		// Reset: back to following.
		const reset: any = await own(null)
		expect(reset).toMatchObject({ mode: null, effectiveMode: "review" })
		expect(await loreWriteModeFor(testDb as unknown as Db, w.user.id)).toBe("review")

		// Nothing else is stored, and only an admin moves the pub.
		await expect(own("sometimes")).rejects.toThrow(/Full, Review changes or Off/)
		await expect(pub("never")).rejects.toThrow(/Full, Review changes or Off/)
		await expect(
			systemSettingsUpdateLoreWriteModeDefault.handler({ user: { id: w.user.id, isAdmin: false } } as any, { mode: "off" } as any, () => {})
		).rejects.toThrow()
		expect(await loreWriteModeFor(testDb as unknown as Db, w.user.id)).toBe("review")
	})
})

describe("the review round", () => {
	/** One reply in the session — the newest, which an open anchor falls to. */
	const say = async (w: World) => {
		const [row] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: w.session.id, role: "assistant", characterId: w.verity.id, content: "…" })
			.returning()
		await testDb
			.insert(schema.messages)
			.values({ id: row!.id, sessionId: w.session.id, characterId: w.verity.id, role: "assistant" })
		return row!.id
	}
	const sessionFog = async (w: World) =>
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "session",
			ownerId: w.session.id,
			slotId: WEATHER,
			value: { v: "fog" },
			sessionId: w.session.id,
			updatedBy: "user"
		})
	const applyStorm = async (w: World) =>
		(await (await setState())(
			{ scope: { sessionId: w.session.id }, params: { mode: "apply" }, changes: [weatherChange(w, "storm")] },
			{} as any
		)) as any

	test("a recording's proposals belong to no reply: regenerating the newest reply keeps them", async () => {
		const w = await world()
		await setOwnMode(w.user.id, "review")
		const reply = await say(w)
		await sessionFog(w)
		const { recordToTimeline } = await import("$lib/server/state/durable")
		const report = await recordToTimeline(testDb as unknown as Db, w.session.id, { reason: "scene" })
		expect(report.proposed).toBe(1)

		const { retractStateAnchoredTo } = await import("$lib/server/state/write")
		await retractStateAnchoredTo(testDb as unknown as Db, reply)
		const left = await proposalsOf(w)
		expect(left).toHaveLength(1)
		expect(left[0]!.messageId).toBeNull()
		expect(left[0]!.status).toBe("pending")
	})

	test("only the lorebook's owner decides a change to it: a guest's Reject is refused, a guest still decides the session's own", async () => {
		const w = await world()
		await setOwnMode(w.user.id, "review")
		const out = await applyStorm(w)
		const [proposalId] = out.value.proposed
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const guest = await createTestUser(testDb, `lore-writes-guest-${++n}`)
		const { decideProposal, proposeChange } = await import("$lib/server/state/write")

		await expect(decideProposal(testDb as unknown as Db, proposalId, false, guest.id)).rejects.toThrow(
			/only whoever owns the lorebook/
		)
		expect((await proposalsOf(w)).find((p) => p.id === proposalId)!.status).toBe("pending")
		expect((await decideProposal(testDb as unknown as Db, proposalId, false, w.user.id)).status).toBe("rejected")

		// The session's own layer is play, which a guest takes part in.
		const own = await proposeChange(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "user" },
			{ owner: { kind: "session_cast", id: w.verity.id }, slotId: HP, value: 9 } as any
		)
		expect((await decideProposal(testDb as unknown as Db, own, false, guest.id)).status).toBe("rejected")
	})

	test("a session following its line's present is dated at that present — where it reads, and where the prompt says it stands", async () => {
		const w = await world()
		await setOwnMode(w.user.id, "full")
		// The Fork's present is set at Year 7, between its Year 3 and Year 9,
		// and the session follows it.
		await testDb.update(schema.lorebookBranches).set({ storyClockYear: 7 }).where(eq(schema.lorebookBranches.id, w.fork.id))
		await testDb.update(schema.sessions).set({ storyClockYear: null }).where(eq(schema.sessions.id, w.session.id))
		// What the author wrote at the Fork's Year 9: after the present.
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "lorebook",
			ownerId: w.book.id,
			slotId: WEATHER,
			value: { v: "clear" },
			updatedBy: "user",
			branchId: w.fork.id,
			historyEntryId: w.forkY9.id
		})

		const { sessionStoryNowOf } = await import("$lib/server/state/storyTime")
		expect(await sessionStoryNowOf(testDb as unknown as Db, w.session.id)).toMatchObject({ year: 7 })

		const out = await applyStorm(w)
		const row = (await bookRows(w)).find((r) => r.id === out.value.applied[0])!
		expect(row).toMatchObject({ branchId: w.fork.id, historyEntryId: w.forkY3.id })

		const { valueOf } = await import("$lib/server/state/resolve")
		const read = async (sessionId: number) =>
			await valueOf(testDb as unknown as Db, { sessionId, owner: { kind: "session", id: sessionId }, slotId: WEATHER })
		// The session reads its own write, not the author's Year 9 …
		expect(await read(w.session.id)).toBe("storm")
		// … and so does a session standing at Year 7 on the Fork by its own clock.
		const [atSeven] = await testDb
			.insert(schema.sessions)
			.values({ userId: w.user.id, isGroup: false, genreId: GENRE, lorebookId: w.book.id, lorebookBranchId: w.fork.id, storyClockYear: 7 })
			.returning()
		expect(await read(atSeven!.id)).toBe("storm")
	})

	test("a lore link a session draws is dated where it stands, on its line", async () => {
		const w = await world()
		await setOwnMode(w.user.id, "full")
		const place = async (title: string) =>
			(
				await testDb
					.insert(schema.lorebookEntries)
					.values({ lorebookId: w.book.id, typeId: WORLD_LORE_TYPE_ID, typeVersion: 1, position: 1000 + ++n, title, content: "…" })
					.returning()
			)[0]!.id
		const hall = await place(`Hall ${n}`)
		const cellar = await place(`Cellar ${n}`)
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const h = await createHost(testDb as any, { sessionId: w.session.id })
		const res = (await h.commit!(
			{ from: hall, to: cellar },
			{ key: "link", definitionId: "core:outlet/link-lore-entries" } as any
		)) as { id: number }
		const [row] = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, res.id))
		// The Fork's Year 3: the latest on its line at or before Year 7 — a
		// session at Year 2 on the Fork has not reached it.
		expect(row).toMatchObject({ branchId: w.fork.id, historyEntryId: w.forkY3.id })
	})

	test("under Review changes, the same change asked again while it waits is not filed twice", async () => {
		const w = await world()
		await setOwnMode(w.user.id, "review")
		const first = await applyStorm(w)
		const second = await applyStorm(w)
		const third = await applyStorm(w)
		const pending = (await proposalsOf(w)).filter((p) => p.status === "pending")
		expect(pending).toHaveLength(1)
		expect(second.value.proposed).toEqual(first.value.proposed)
		expect(third.value.proposed).toEqual(first.value.proposed)
		// A different change is its own proposal.
		await (await setState())(
			{ scope: { sessionId: w.session.id }, params: { mode: "apply" }, changes: [weatherChange(w, "fog")] },
			{} as any
		)
		expect((await proposalsOf(w)).filter((p) => p.status === "pending")).toHaveLength(2)
	})

	test("moving the pub default reaches every open tab, not only the admin's", async () => {
		const w = await world()
		const sent: Array<{ to: string; event: string; data: any }> = []
		const io = {
			to: (to: string) => ({ emit: (event: string, data: any) => void sent.push({ to, event, data }) }),
			sockets: {
				sockets: new Map([
					["someone-else", { id: "someone-else", user: { id: w.user.id + 100_000 }, interest: new Set(["systemSettings:get"]) }]
				])
			}
		}
		const { systemSettingsUpdateLoreWriteModeDefault } = await import("$lib/server/sockets/systemSettings")
		try {
			await systemSettingsUpdateLoreWriteModeDefault.handler(
				{ user: { id: w.user.id, isAdmin: true }, io } as any,
				{ mode: "off" } as any,
				() => {}
			)
			const told = sent.find((s) => s.to === "someone-else" && s.event === "systemSettings:get")
			expect(told?.data?.systemSettings?.loreWriteModeDefault ?? told?.data?.loreWriteModeDefault).toBe("off")
		} finally {
			await testDb.update(schema.systemSettings).set({ loreWriteModeDefault: "review" }).where(eq(schema.systemSettings.id, 1))
		}
	})

	test("under Off, a summarize's new cast name is refused before it mints a member; the workspace's own still adds one", async () => {
		const w = await world()
		await setOwnMode(w.user.id, "off")
		const { resolveOrCreateBindingByNameHandler } = await import("$lib/server/sockets/lorebooks")
		const socket = { user: { id: w.user.id }, io: { to: () => ({ emit: () => {} }), sockets: { sockets: new Map() } } } as any
		const members = async () =>
			(await testDb.select().from(schema.lorebookBindings).where(eq(schema.lorebookBindings.lorebookId, w.book.id))).length
		const before = await members()
		await expect(
			resolveOrCreateBindingByNameHandler.handler(
				socket,
				{ lorebookId: w.book.id, name: `Stranger ${n}`, requestId: "r1", sessionId: w.session.id } as any,
				() => {}
			)
		).rejects.toThrow(LORE_WRITES_OFF)
		expect(await members()).toBe(before)
		await resolveOrCreateBindingByNameHandler.handler(
			socket,
			{ lorebookId: w.book.id, name: `Stranger ${n}`, requestId: "r2" } as any,
			() => {}
		)
		expect(await members()).toBe(before + 1)
	})

	test("the Off refusal names whose setting it is: the lorebook owner's, not the reader's", () => {
		expect(LORE_WRITES_OFF).toMatch(/^Lorebook writes from sessions are off/)
		expect(LORE_WRITES_OFF).toMatch(/owner/)
	})
})
