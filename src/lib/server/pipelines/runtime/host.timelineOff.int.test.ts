/**
 * The host's dated writes on a lorebook whose timeline is off
 * (`lorebooks/timeline.ts`): no history day is written (a sentence in the run's
 * notes, and the run goes on), a row is written undated, a change is held
 * undated, the clock outlet moves nothing and says so on its receipt; nothing
 * dated that is stored is touched.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { TIMELINE_OFF_SENTENCES } from "$lib/server/lorebooks/timeline"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0

const CREATE = {
	key: "file",
	definitionId: "core:outlet/create-lore-entry"
} as any
const UPDATE = {
	key: "change",
	definitionId: "core:outlet/update-lore-entry"
} as any
const ADVANCE = {
	key: "advance",
	definitionId: "core:outlet/advance-story-clock",
	definitionVersion: 1
} as any
const CALENDAR = {
	months: [
		{ name: "Thaw", days: 30 },
		{ name: "Bloom", days: 31 }
	],
	yearLabel: "Year"
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-host-timeline-off-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `host-timeline-off-${suffix}`)
	await db
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: "full" })
	const [book] = await db
		.insert(schema.lorebooks)
		.values({
			userId: user.id,
			name: `World ${suffix}`,
			storyCalendar: CALENDAR as any,
			storyClockYear: 9,
			timelineEnabled: false
		})
		.returning()
	const [fork] = await db
		.insert(schema.lorebookBranches)
		.values({
			lorebookId: book!.id,
			name: `Fork ${suffix}`,
			forkYear: 2,
			storyClockYear: 6
		})
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			lorebookId: book!.id,
			storyClockYear: 8,
			storyClockMonth: 2,
			storyClockDay: 3
		})
		.returning()
	const [legacy] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId: session!.id, role: "assistant", content: "…" })
		.returning()
	await db
		.insert(schema.messages)
		.values({ id: legacy!.id, sessionId: session!.id, role: "assistant" })
	const entry = async (
		typeId: string,
		title: string | null,
		fields: Record<string, unknown>
	) =>
		(
			await db
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: book!.id,
					typeId,
					typeVersion: 1,
					position: ++n,
					title,
					content: `${title ?? "day"}, as written.`,
					fields
				})
				.returning()
		)[0]!
	const day = await entry(HISTORY_TYPE_ID, null, {
		year: 3,
		month: 1,
		day: 4
	})
	const vault = await entry(LOCATION_TYPE_ID, "The Vault", {
		category: "Rooms"
	})
	await db.insert(schema.entryAmendments).values({
		lorebookId: book!.id,
		entryId: vault.id,
		year: 3,
		month: 1,
		day: 4,
		fields: { content: "Sealed, from year 3." },
		historyEntryId: day.id
	})
	const host = async (runId: string) => {
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		return createHost(db as unknown as Db, {
			sessionId: session!.id,
			userId: user.id,
			runId
		})
	}
	return {
		user,
		book: book!,
		fork: fork!,
		session: session!,
		day,
		vault,
		host,
		suffix
	}
}

/** Every dated thing stored on the book and its session, as JSON, to compare byte for byte. */
async function datedSnapshot(w: Awaited<ReturnType<typeof world>>) {
	const l = schema
	const [book] = await db
		.select()
		.from(l.lorebooks)
		.where(eq(l.lorebooks.id, w.book.id))
	const [session] = await db
		.select()
		.from(l.sessions)
		.where(eq(l.sessions.id, w.session.id))
	return JSON.stringify({
		entryAmendments: await db
			.select()
			.from(l.entryAmendments)
			.where(eq(l.entryAmendments.lorebookId, w.book.id))
			.orderBy(l.entryAmendments.id),
		castAmendments: await db
			.select()
			.from(l.castAmendments)
			.where(eq(l.castAmendments.lorebookId, w.book.id))
			.orderBy(l.castAmendments.id),
		characterVersions: await db
			.select()
			.from(l.characterVersions)
			.where(
				and(
					eq(l.characterVersions.lorebookId, w.book.id),
					isNotNull(l.characterVersions.year)
				)
			)
			.orderBy(l.characterVersions.id),
		history: await db
			.select()
			.from(l.lorebookEntries)
			.where(
				and(
					eq(l.lorebookEntries.lorebookId, w.book.id),
					eq(l.lorebookEntries.typeId, HISTORY_TYPE_ID)
				)
			)
			.orderBy(l.lorebookEntries.id),
		calendar: book!.storyCalendar,
		bookClock: [
			book!.storyClockYear,
			book!.storyClockMonth,
			book!.storyClockDay,
			book!.storyClockHour,
			book!.storyClockMinute
		],
		branchClocks: await db
			.select()
			.from(l.lorebookBranches)
			.where(eq(l.lorebookBranches.lorebookId, w.book.id))
			.orderBy(l.lorebookBranches.id),
		sessionClock: [
			session!.storyClockYear,
			session!.storyClockMonth,
			session!.storyClockDay,
			session!.storyClockHour,
			session!.storyClockMinute
		]
	})
}

describe("host writes on a book whose timeline is off", () => {
	it("a history day writes nothing, answers with the sentence, and the run goes on", async () => {
		const w = await world()
		const before = await datedSnapshot(w)
		const h = await w.host(`run-a-${w.suffix}`)
		const out: any = await h.commit!(
			{
				content: "The gate fell.",
				params: { entryType: HISTORY_TYPE_ID },
				fields: { year: 4, month: 1, day: 1 }
			},
			CREATE
		)
		expect(out.written).toBe(false)
		expect(out.notes).toEqual([TIMELINE_OFF_SENTENCES.history])
		const sourced: any = await h.commit!(
			{
				content: "The bells rang.",
				params: { entryType: HISTORY_TYPE_ID }
			},
			CREATE
		)
		expect(sourced.notes).toEqual([TIMELINE_OFF_SENTENCES.history])
		expect(await datedSnapshot(w)).toBe(before)
	})

	it("a non-history entry is written undated", async () => {
		const w = await world()
		const before = await datedSnapshot(w)
		const out: any = await (
			await w.host(`run-b-${w.suffix}`)
		).commit!(
			{
				name: "The Cellar",
				content: "Cold.",
				params: { entryType: LOCATION_TYPE_ID },
				fields: { category: "Rooms" }
			},
			CREATE
		)
		const [made] = await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, out.id ?? out.entryId))
		expect(made!.title).toBe("The Cellar")
		expect((made!.fields as Record<string, unknown>).year).toBeUndefined()
		expect(
			await db
				.select()
				.from(schema.entryAmendments)
				.where(
					and(
						isNotNull(schema.entryAmendments.year),
						eq(schema.entryAmendments.entryId, made!.id)
					)
				)
		).toEqual([])
		expect(await datedSnapshot(w)).toBe(before)
	})

	it("a held change to an entry is written with no date", async () => {
		const w = await world()
		await db
			.update(schema.userSettings)
			.set({ loreWriteMode: "review" })
			.where(eq(schema.userSettings.userId, w.user.id))
		const before = await datedSnapshot(w)
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(db as unknown as Db, w.session.id)
		await (
			await w.host(`run-c-${w.suffix}`)
		).commit!({ entry: w.vault.id, content: "Open." }, UPDATE)
		const held = await db
			.select()
			.from(schema.entryAmendments)
			.where(
				and(
					eq(schema.entryAmendments.lorebookId, own.id),
					isNotNull(schema.entryAmendments.base)
				)
			)
		expect(held).toHaveLength(1)
		expect([held[0]!.year, held[0]!.month, held[0]!.day]).toEqual([
			null,
			null,
			null
		])
		expect(await datedSnapshot(w)).toBe(before)
	})

	it("a change to a history entry drops its date parts and keeps the rest; a date alone changes nothing", async () => {
		const w = await world()
		const day = async () =>
			(await db.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, w.day.id)))[0]!
		await (
			await w.host(`run-e-${w.suffix}`)
		).commit!({ entry: w.day.id, content: "The gate stood.", fields: { year: 9, month: 2, day: 7 } }, UPDATE)
		expect((await day()).content).toBe("The gate stood.")
		expect((await day()).fields).toMatchObject({ year: 3, month: 1, day: 4 })
		await (await w.host(`run-f-${w.suffix}`)).commit!({ entry: w.day.id, fields: { year: 8 } }, UPDATE)
		expect((await day()).fields).toMatchObject({ year: 3, month: 1, day: 4 })
		expect((await day()).content).toBe("The gate stood.")
	})

	it("an update moving a history entry onto a day another history entry holds writes the rest and keeps the date; on, it is refused", async () => {
		const w = await world()
		const [other] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.book.id,
				typeId: HISTORY_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: null,
				content: "Another day.",
				fields: { year: 5, month: 2, day: 6 }
			})
			.returning()
		expect(other).toBeTruthy()
		const day = async () =>
			(await db.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, w.day.id)))[0]!
		await (
			await w.host(`run-h-${w.suffix}`)
		).commit!({ entry: w.day.id, content: "Kept going.", fields: { year: 5, month: 2, day: 6 } }, UPDATE)
		expect((await day()).content).toBe("Kept going.")
		expect((await day()).fields).toMatchObject({ year: 3, month: 1, day: 4 })
		await db.update(schema.lorebooks).set({ timelineEnabled: true }).where(eq(schema.lorebooks.id, w.book.id))
		await expect(
			(await w.host(`run-i-${w.suffix}`)).commit!(
				{ entry: w.day.id, content: "Refused.", fields: { year: 5, month: 2, day: 6 } },
				UPDATE
			)
		).rejects.toThrow()
		expect((await day()).content).toBe("Kept going.")
	})

	it("with the timeline on the same date change is not dropped: the host answers it as it always did", async () => {
		const w = await world()
		await db.update(schema.lorebooks).set({ timelineEnabled: true }).where(eq(schema.lorebooks.id, w.book.id))
		await expect(
			(await w.host(`run-g-${w.suffix}`)).commit!({ entry: w.day.id, fields: { year: 9 } }, UPDATE)
		).rejects.toThrow("keeps its date in the lorebook")
	})

	it("the clock outlet moves nothing and reports the sentence, whatever onRefusal says", async () => {
		const w = await world()
		const before = await datedSnapshot(w)
		const h = await w.host(`run-d-${w.suffix}`)
		const halted: any = await h.commit!({ by: 3, unit: "hours" }, ADVANCE)
		expect(halted).toMatchObject({
			skipped: TIMELINE_OFF_SENTENCES.clock,
			moved: 0,
			clock: null
		})
		const skipped: any = await h.commit!(
			{ by: 1, unit: "days", onRefusal: "skip" },
			ADVANCE
		)
		expect(skipped.skipped).toBe(TIMELINE_OFF_SENTENCES.clock)
		const to: any = await h.commit!({ to: { hour: 9 } }, ADVANCE)
		expect(to.skipped).toBe(TIMELINE_OFF_SENTENCES.clock)
		expect(await datedSnapshot(w)).toBe(before)
		const ledger = await db
			.select()
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.sessionId, w.session.id))
		expect(ledger).toEqual([])
	})
})
