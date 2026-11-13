/**
 * 🚧 When the session's line forks (plan §32 §5a): inside the write's
 * transaction, after its checks. A refused write forks nothing; a proposal
 * never forks, and its accept does, taking the session's other pending
 * proposals onto the new line; `recordToTimeline` forks on its first row.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-fork-timing-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const WEATHER = "core:slot/weather@1"
const OMEN = "fork-timing:slot/omen@1"
const GENRE = "test:genre/fork-timing"
const db = () => testDb as unknown as Db

function declareSlots() {
	_clearAttributeSlots()
	const weather = defineAttributeSlot(WEATHER, {
		type: "enum",
		descriptor: "What the sky is doing.",
		appliesTo: ["world"],
		config: { of: ["clear", "storm", "fog"] }
	})
	const omen = defineAttributeSlot(OMEN, {
		type: "enum",
		descriptor: "What the birds say.",
		appliesTo: ["world"],
		config: { of: ["good", "bad"] }
	})
	genreKeeping(GENRE, {
		name: { en: "Fork timing" },
		family: "test",
		slots: [weather, omen],
		events: {}
	})
}

let n = 0

/** A book with a Fork, and a branch session riding the Fork (it forks its own on first write). */
async function world() {
	declareSlots()
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `fork-timing-${suffix}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const [fork] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book!.id, name: `Fork ${suffix}`, forkYear: 4 })
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
			lineOnFirstWrite: true,
			storyClockYear: 7,
			storyClockMonth: 2,
			storyClockDay: 3
		})
		.returning()
	const [legacy] = await testDb
		.insert(schema.sessionMessages)
		.values({ sessionId: session!.id, role: "assistant", content: "…" })
		.returning()
	await testDb.insert(schema.messages).values({
		id: legacy!.id,
		sessionId: session!.id,
		role: "assistant"
	})
	return {
		user,
		book: book!,
		fork: fork!,
		session: session!,
		message: legacy!
	}
}
type World = Awaited<ReturnType<typeof world>>

const ctxOf = (w: World) => ({
	sessionId: w.session.id,
	updatedBy: `user:${w.user.id}`,
	userId: w.user.id,
	// Names no reply: a change to the book is held under none.
	messageId: null
})
const change = (w: World, slotId: string, value: string) => ({
	owner: { kind: "lorebook" as const, id: w.book.id },
	slotId,
	value
})

const linesOf = (bookId: number) =>
	testDb
		.select()
		.from(schema.lorebookBranches)
		.where(eq(schema.lorebookBranches.lorebookId, bookId))
const sessionOf = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, id))
	)[0]!
const proposalOf = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.id, id))
	)[0]!
const valueRow = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.id, id))
	)[0]!

/** Nothing forked: no new line, the session still rides. */
async function expectNoFork(w: World) {
	expect(await linesOf(w.book.id)).toHaveLength(1)
	const s = await sessionOf(w.session.id)
	expect(s.lineOnFirstWrite).toBe(true)
	expect(s.lorebookBranchId).toBe(w.fork.id)
}

describe("a refused write forks nothing", () => {
	test("setValue refused by validateValue", async () => {
		const w = await world()
		const { setValue } = await import("$lib/server/state/write")
		await expect(
			setValue(db(), ctxOf(w), change(w, WEATHER, "hail"))
		).rejects.toThrow()
		await expectNoFork(w)
	})

	test("setValue refused by its base check", async () => {
		const w = await world()
		const { setValue } = await import("$lib/server/state/write")
		await expect(
			setValue(db(), ctxOf(w), {
				...change(w, WEATHER, "storm"),
				base: -1
			})
		).rejects.toThrow(/changed since/)
		await expectNoFork(w)
	})

	test("configure refused", async () => {
		const w = await world()
		const { configure } = await import("$lib/server/state/write")
		await expect(
			configure(db(), ctxOf(w), {
				owner: { kind: "lorebook", id: w.book.id },
				slotId: WEATHER,
				config: { notAKey: 1 } as never
			})
		).rejects.toThrow()
		await expectNoFork(w)
	})

	test("a write that passes forks, and lands on the new line", async () => {
		const w = await world()
		const { setValue } = await import("$lib/server/state/write")
		const id = await setValue(db(), ctxOf(w), change(w, WEATHER, "storm"))
		const s = await sessionOf(w.session.id)
		expect(s.lineOnFirstWrite).toBe(false)
		expect(s.lorebookBranchId).not.toBe(w.fork.id)
		expect((await valueRow(id)).branchId).toBe(s.lorebookBranchId)
	})
})

describe("a proposal never forks; its accept does", () => {
	test("held at the riding line; accepted, it forks and the value lands on the new line", async () => {
		const w = await world()
		const { proposeChange, decideProposal } = await import(
			"$lib/server/state/write"
		)
		const id = await proposeChange(
			db(),
			ctxOf(w),
			change(w, WEATHER, "storm")
		)
		await expectNoFork(w)
		expect((await proposalOf(id)).branchId).toBe(w.fork.id)

		const out = await decideProposal(db(), id, true, w.user.id)
		expect(out.status).toBe("accepted")
		const s = await sessionOf(w.session.id)
		expect(s.lineOnFirstWrite).toBe(false)
		expect(s.lorebookBranchId).not.toBe(w.fork.id)
		expect(await linesOf(w.book.id)).toHaveLength(2)
		expect((await valueRow(out.appliedId!)).branchId).toBe(
			s.lorebookBranchId
		)
	})

	test("a second pending proposal follows the fork and lands on the new line", async () => {
		const w = await world()
		const { proposeChange, decideProposal } = await import(
			"$lib/server/state/write"
		)
		const first = await proposeChange(
			db(),
			ctxOf(w),
			change(w, WEATHER, "storm")
		)
		const second = await proposeChange(
			db(),
			ctxOf(w),
			change(w, OMEN, "bad")
		)
		expect((await proposalOf(second)).branchId).toBe(w.fork.id)

		await decideProposal(db(), first, true, w.user.id)
		const line = (await sessionOf(w.session.id)).lorebookBranchId
		expect(line).not.toBe(w.fork.id)
		expect((await proposalOf(second)).branchId).toBe(line)

		const out = await decideProposal(db(), second, true, w.user.id)
		expect(out.status).toBe("accepted")
		expect((await valueRow(out.appliedId!)).branchId).toBe(line)
		expect(await linesOf(w.book.id)).toHaveLength(2)
	})
})

describe("recordToTimeline forks on its first row", () => {
	const sessionValue = async (w: World, value: unknown) =>
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "session",
			ownerId: w.session.id,
			slotId: WEATHER,
			value: { v: value },
			sessionId: w.session.id,
			validFromMessageId: w.message.id,
			updatedBy: "user"
		})

	test("nothing storable, or every value refused: no fork", async () => {
		const { recordToTimeline } = await import("$lib/server/state/durable")
		const empty = await world()
		await recordToTimeline(db(), empty.session.id, { reason: "mark" })
		await expectNoFork(empty)

		const refused = await world()
		await sessionValue(refused, "hail")
		const report = await recordToTimeline(db(), refused.session.id, {
			reason: "mark"
		})
		expect(report.refused).toHaveLength(1)
		await expectNoFork(refused)
	})

	test("a value forks the line and the row is filed on it", async () => {
		const { recordToTimeline } = await import("$lib/server/state/durable")
		const w = await world()
		await sessionValue(w, "storm")
		const report = await recordToTimeline(db(), w.session.id, {
			reason: "mark"
		})
		expect(report.recorded).toBe(true)
		const s = await sessionOf(w.session.id)
		expect(s.lineOnFirstWrite).toBe(false)
		expect(s.lorebookBranchId).not.toBe(w.fork.id)
		const [row] = await testDb
			.select()
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.ownerKind, "lorebook"),
					eq(schema.attributeValues.ownerId, w.book.id)
				)
			)
		expect(row!.branchId).toBe(s.lorebookBranchId)
	})
})
