/**
 * 🚧 Converting a session's rules (M0, lane T4): 1.0.0 -> 2.0.0 with a
 * rename, a removal and an addition. Every write is anchored to the world's
 * open anchor, so `retractStateAnchoredTo` takes it back; the version is set
 * last; each refusal is a sentence.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	defineAttributeSlot,
	defineRuleset,
	getAttributeSlot,
	rulesetAttributeSlotId,
	_clearAttributeSlots,
	_withdrawRuleset
} from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
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
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-convert-ruleset-")
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

const OLD = "acme.lab:slot/old-nerve@1"
const NEW = "acme.lab:slot/nerve@1"
const GONE = "acme.lab:slot/gone@1"
const ADDED = "acme.lab:slot/focus@1"

function declareSlots() {
	_clearAttributeSlots()
	for (const id of [OLD, NEW, GONE, ADDED])
		defineAttributeSlot(id, {
			type: "integer",
			descriptor: `The ${id} number.`,
			appliesTo: ["world"],
			config: { min: 0, max: 20 }
		})
}

let n = 0

async function world(
	over: {
		pinned?: string | null
		published?: string | null
		upgrades?: unknown[]
	} = {}
) {
	declareSlots()
	const k = ++n
	const rulesetId = `acme.lab:ruleset/convert-${k}@1`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `convert-owner-${k}`)
	const other = await createTestUser(testDb, `convert-guest-${k}`)
	const published = over.published === undefined ? "2.0.0" : over.published
	const upgrades = over.upgrades ?? [
		{
			from: "1.0.0",
			to: "2.0.0",
			slots: {
				renamed: { [OLD]: NEW },
				removed: [GONE],
				added: { [ADDED]: 7 }
			}
		}
	]
	await testDb.insert(schema.rulesets).values({
		rulesetId,
		ownerSlug: "acme.lab",
		label: `Convert ${k}`,
		draft: {},
		published: published
			? { id: rulesetId, version: published, upgrades }
			: null,
		publishedVersion: published
	})
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${k}`,
			primaryRuleset: rulesetId,
			rulesetVersion: over.pinned === undefined ? "1.0.0" : over.pinned
		})
		.returning()
	return { user, other, session: session!, rulesetId }
}
type World = Awaited<ReturnType<typeof world>>

const owner = (w: World) => ({ kind: "session" as const, id: w.session.id })

const put = async (w: World, slotId: string, value: number) => {
	const { setValue } = await import("$lib/server/state/write")
	return setValue(
		testDb as unknown as Db,
		{ sessionId: w.session.id, updatedBy: "user", userId: w.user.id },
		{ owner: owner(w), slotId, value }
	)
}

const read = async (w: World, slotId: string) => {
	const { valueOf } = await import("$lib/server/state/resolve")
	return await valueOf(testDb as unknown as Db, {
		sessionId: w.session.id,
		owner: owner(w),
		slotId
	})
}

const convert = async (
	w: World,
	over: { to?: string; userId?: number } = {}
) => {
	const { convertSessionRuleset } = await import(
		"$lib/server/sessions/convertRuleset"
	)
	return convertSessionRuleset(testDb as unknown as Db, {
		sessionId: w.session.id,
		to: over.to ?? "2.0.0",
		userId: over.userId ?? w.user.id
	})
}

const versionOf = async (w: World) =>
	(
		await testDb
			.select({ v: schema.sessions.rulesetVersion })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, w.session.id))
	)[0]!.v

describe("converting a session's rules", () => {
	test("re-keys the renamed slot, clears the removed one, inserts the added default, sets the version", async () => {
		const w = await world()
		await put(w, OLD, 9)
		await put(w, GONE, 4)
		// A pinned session resolves before converting: its old values read as they were.
		expect(await read(w, OLD)).toBe(9)

		const out = await convert(w)
		expect(out).toEqual({
			rulesetId: w.rulesetId,
			from: "1.0.0",
			to: "2.0.0",
			slots: {
				renamed: { [OLD]: NEW },
				removed: [GONE],
				added: { [ADDED]: 7 }
			}
		})
		expect(await read(w, NEW)).toBe(9)
		expect(await read(w, OLD)).toBeUndefined()
		expect(await read(w, GONE)).toBeUndefined()
		expect(await read(w, ADDED)).toBe(7)
		expect(await versionOf(w)).toBe("2.0.0")
	})

	test("each change is anchored: retractStateAnchoredTo takes the old values back", async () => {
		const w = await world()
		await put(w, OLD, 9)
		const [message] = await testDb
			.insert(schema.messages)
			.values({
				sessionId: w.session.id,
				role: "assistant",
				content: "…"
			} as never)
			.returning()
		await convert(w)
		const rows = await testDb
			.select()
			.from(schema.attributeValues)
			.where(and(eq(schema.attributeValues.sessionId, w.session.id)))
		const anchors = new Set(
			rows
				.filter(
					(r) =>
						r.slotId !== OLD ||
						(r.value as { v: unknown }).v === null
				)
				.map((r) => r.validFromMessageId)
		)
		expect(anchors.has(message!.id)).toBe(true)
		const { retractStateAnchoredTo } = await import(
			"$lib/server/state/write"
		)
		await retractStateAnchoredTo(testDb as unknown as Db, message!.id, "replaced")
		expect(await read(w, OLD)).toBe(9)
		expect(await read(w, NEW)).toBeUndefined()
	})
})

describe("Back past a conversion", () => {
	const withMessage = async (w: World) =>
		(
			await testDb
				.insert(schema.messages)
				.values({
					sessionId: w.session.id,
					role: "assistant",
					content: "…"
				} as never)
				.returning()
		)[0]!

	test("retractStateAnchoredTo restores ruleset_version with the values; restoreRetractedState re-applies it", async () => {
		const w = await world()
		await put(w, OLD, 9)
		const message = await withMessage(w)
		await convert(w)
		expect(await versionOf(w)).toBe("2.0.0")
		const { retractStateAnchoredTo, restoreRetractedState } = await import(
			"$lib/server/state/write"
		)
		const undone = await retractStateAnchoredTo(
			testDb as unknown as Db,
			message.id,
			"replaced"
		)
		expect(undone.changed).toBe(true)
		expect(await versionOf(w)).toBe("1.0.0")
		expect(await read(w, OLD)).toBe(9)
		const conversions = async () =>
			(
				await testDb
					.select()
					.from(schema.sessionImprints)
					.where(eq(schema.sessionImprints.sessionId, w.session.id))
			).filter((r) => r.subjectKind === "ruleset-conversion")
		expect(await conversions()).toEqual([])
		await restoreRetractedState(testDb as unknown as Db, undone.taken)
		expect(await versionOf(w)).toBe("2.0.0")
		expect(await read(w, NEW)).toBe(9)
		expect(await conversions()).toMatchObject([
			{
				messageId: message.id,
				subjectKey: w.rulesetId,
				before: { v: "1.0.0" },
				after: { v: "2.0.0" },
				status: "standing"
			}
		])
	})
})

describe("Back and Forward through the history", () => {
	test("Back returns the old version with the values; Forward re-pins the new one with them (M1 E-fix T-3)", async () => {
		const w = await world()
		await put(w, OLD, 9)
		// a turn: the person's line, then a reply — the conversion anchors to the reply, the newest message
		const { insertLegacy } = await import("$lib/server/messages/store")
		await insertLegacy(
			testDb as unknown as Db,
			{
				sessionId: w.session.id,
				userId: w.user.id,
				role: "user",
				content: "hello",
				channel: "main"
			} as never
		)
		await insertLegacy(
			testDb as unknown as Db,
			{
				sessionId: w.session.id,
				role: "assistant",
				content: "…",
				channel: "main"
			} as never
		)
		await convert(w)
		expect(await versionOf(w)).toBe("2.0.0")
		const { rewindTurn, forwardTurn } = await import("./rewind")
		const back = await rewindTurn(testDb as unknown as Db, {
			sessionId: w.session.id,
			userId: w.user.id
		})
		expect(back).toMatchObject({ ok: true })
		expect(await versionOf(w)).toBe("1.0.0")
		expect(await read(w, OLD)).toBe(9)
		const fwd = await forwardTurn(testDb as unknown as Db, {
			sessionId: w.session.id,
			userId: w.user.id
		})
		expect(fwd).toMatchObject({ ok: true })
		expect(await versionOf(w)).toBe("2.0.0")
		expect(await read(w, NEW)).toBe(9)
	})
})

describe("autoConvert at open", () => {
	test("converts once for an owner under a genre that says so; a second open does nothing", async () => {
		const { genre } = await import("@serene-pub/sdk")
		const w = await world()
		const genreId = `test:genre/auto-convert-${n}`
		genre(genreId, {
			name: { en: "Auto" },
			family: "test",
			events: {},
			rulesets: { only: [w.rulesetId], autoConvert: true }
		} as never)
		await testDb
			.update(schema.sessions)
			.set({ genreId })
			.where(eq(schema.sessions.id, w.session.id))
		await put(w, OLD, 5)
		const { sessionsGetHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const socket = {
			user: { id: w.user.id },
			io: { to: () => ({ emit: () => {} }) }
		} as any
		await sessionsGetHandler.handler(
			socket,
			{ id: w.session.id } as any,
			() => {}
		)
		expect(await versionOf(w)).toBe("2.0.0")
		expect(await read(w, NEW)).toBe(5)
		const rowsAfterFirst = (
			await testDb
				.select()
				.from(schema.attributeValues)
				.where(eq(schema.attributeValues.sessionId, w.session.id))
		).length
		await sessionsGetHandler.handler(
			socket,
			{ id: w.session.id } as any,
			() => {}
		)
		expect(
			(
				await testDb
					.select()
					.from(schema.attributeValues)
					.where(eq(schema.attributeValues.sessionId, w.session.id))
			).length
		).toBe(rowsAfterFirst)
	})
})

describe("what is refused", () => {
	const refuses = async (
		w: World,
		sentence: string,
		over: { to?: string; userId?: number } = {}
	) => {
		const { StateRefusal } = await import("$lib/server/state/write")
		const err = await convert(w, over).catch((e) => e)
		expect(err).toBeInstanceOf(StateRefusal)
		expect((err as Error).message).toBe(sentence)
		expect(await versionOf(w)).toBe(w.session.rulesetVersion)
	}

	test("a session that has not pinned a version", async () => {
		await refuses(
			await world({ pinned: null }),
			"This session has not pinned a version of its rules yet, so there is nothing to convert from."
		)
	})
	test("rules with nothing published", async () => {
		await refuses(
			await world({ published: null }),
			"These rules have no published version to convert to."
		)
	})
	test("a target that is not the published version", async () => {
		await refuses(
			await world(),
			"Only version 2.0.0 of these rules is installed.",
			{ to: "3.0.0" }
		)
	})
	test("no step from the pin", async () => {
		await refuses(
			await world({ pinned: "1.5.0" }),
			"There is no upgrade from 1.5.0 towards 2.0.0 in these rules."
		)
	})
	test("rules whose plugin is gone", async () => {
		const w = await world()
		await testDb
			.delete(schema.rulesets)
			.where(eq(schema.rulesets.rulesetId, w.rulesetId))
		await refuses(
			w,
			"These rules came with a plugin that is no longer installed."
		)
	})
	test("someone who does not own the session", async () => {
		const w = await world()
		await refuses(w, "Only the session's owner can change its rules.", {
			userId: w.other.id
		})
	})
})

// needs ruleset_versions (M2b migration)
describe("a session pinned to an older kept version (M2b a7)", () => {
	const RS = "acme.lab:ruleset/kept-versions@1"
	const GENRE = "acme.lab:genre/kept-versions"
	const OLDS = rulesetAttributeSlotId(RS, "old-nerve")
	const NEWS = rulesetAttributeSlotId(RS, "nerve")
	const attr = (id: string) => ({
		id,
		name: { en: id },
		kind: "number",
		bounds: { min: 0, max: 20 },
		start: 0,
		owner: "world",
		prose: `${id}: a number.`
	})

	test("it is offered its pinned version's ids, spends under them, and the conversion keeps what was spent and what was written later", async () => {
		const { keepRulesetVersion, registerKeptRulesetSlots } = await import(
			"$lib/server/rulesets/versions"
		)
		const { vocabularyFor } = await import("$lib/server/state/resolve")
		const { genreKeeping } = await import("$lib/server/utils/testGenre")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		_clearAttributeSlots()
		const v1 = {
			id: RS,
			name: { en: "Kept" },
			version: "1.0.0",
			attributes: [attr("old-nerve")]
		}
		const v2 = {
			id: RS,
			name: { en: "Kept" },
			version: "1.1.0",
			attributes: [attr("nerve")],
			upgrades: [
				{
					from: "1.0.0",
					to: "1.1.0",
					slots: { renamed: { [OLDS]: NEWS } }
				}
			]
		}
		defineRuleset(RS, {
			name: { en: "Kept" },
			attributes: v2.attributes as never
		})
		genreKeeping(GENRE, {
			name: { en: "Kept" },
			family: "test",
			slots: [],
			events: {}
		})
		await testDb
			.insert(schema.rulesets)
			.values({
				rulesetId: RS,
				ownerSlug: "acme.lab",
				label: "Kept",
				draft: {},
				published: v2,
				publishedVersion: "1.1.0"
			})
		await keepRulesetVersion(testDb as unknown as Db, {
			rulesetId: RS,
			version: "1.0.0",
			document: v1,
			publishedBy: null
		})
		await keepRulesetVersion(testDb as unknown as Db, {
			rulesetId: RS,
			version: "1.1.0",
			document: v2,
			publishedBy: null
		})
		await registerKeptRulesetSlots(testDb as unknown as Db, RS)
		expect(getAttributeSlot(OLDS)).toBeDefined()

		const start = async (tag: string) => {
			const user = await createTestUser(testDb, `kept-${tag}-${++n}`)
			const [session] = await testDb
				.insert(schema.sessions)
				.values({
					userId: user.id,
					isGroup: false,
					name: `Kept ${tag}`,
					genreId: GENRE,
					primaryRuleset: RS,
					rulesetVersion: "1.0.0"
				})
				.returning()
			return { user, session: session! }
		}
		const w = await start("spend")
		const vocab = await vocabularyFor(testDb as unknown as Db, w.session.id)
		expect(vocab.entryFor(OLDS)).toBeDefined()
		expect(vocab.entryFor(NEWS)).toBeUndefined()

		const put = async (x: typeof w, slotId: string, value: number) => {
			const { setValue } = await import("$lib/server/state/write")
			return setValue(
				testDb as unknown as Db,
				{
					sessionId: x.session.id,
					updatedBy: "user",
					userId: x.user.id
				},
				{ owner: { kind: "session", id: x.session.id }, slotId, value }
			)
		}
		const get = async (x: typeof w, slotId: string) => {
			const { valueOf } = await import("$lib/server/state/resolve")
			return valueOf(testDb as unknown as Db, {
				sessionId: x.session.id,
				owner: { kind: "session", id: x.session.id },
				slotId
			})
		}
		const convertTo = async (x: typeof w) => {
			const { convertSessionRuleset } = await import(
				"$lib/server/sessions/convertRuleset"
			)
			return convertSessionRuleset(testDb as unknown as Db, {
				sessionId: x.session.id,
				to: "1.1.0",
				userId: x.user.id
			})
		}
		await put(w, OLDS, 9)
		await put(w, OLDS, 6) // the spend
		await convertTo(w)
		expect(await get(w, NEWS)).toBe(6)
		expect(await get(w, OLDS)).toBe(0) // cleared: it reads its declared start now
		const after = await vocabularyFor(testDb as unknown as Db, w.session.id)
		expect(after.entryFor(NEWS)).toBeDefined()

		// a value written under the NEW id after the old id's latest is not overwritten
		const x = await start("later")
		await put(x, OLDS, 4)
		await put(x, NEWS, 8)
		await convertTo(x)
		expect(await get(x, NEWS)).toBe(8)
		expect(await get(x, OLDS)).toBe(0) // cleared: its declared start
		_withdrawRuleset(RS)
	})
})

describe("a conversion and the write stamp", () => {
	// A session reads a story clock only through its book.
	const bookFor = async (w: World) => {
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: w.user.id, name: `Book ${w.session.id}` })
			.returning()
		await testDb
			.update(schema.sessions)
			.set({ lorebookId: book!.id })
			.where(eq(schema.sessions.id, w.session.id))
	}
	const setClock = (w: World, hour: number, minute: number) =>
		testDb
			.update(schema.sessions)
			.set({
				storyClockYear: 1204,
				storyClockMonth: 3,
				storyClockDay: 5,
				storyClockHour: hour,
				storyClockMinute: minute
			})
			.where(eq(schema.sessions.id, w.session.id))
	const rowsFor = async (w: World, slotId: string) =>
		(
			await testDb
				.select()
				.from(schema.attributeValues)
				.where(
					and(
						eq(schema.attributeValues.sessionId, w.session.id),
						eq(schema.attributeValues.slotId, slotId)
					)
				)
		).sort((a, b) => a.id - b.id)
	const columnsOf = (r: typeof schema.attributeValues.$inferSelect) => [
		r.storyClockYear,
		r.storyClockMonth,
		r.storyClockDay,
		r.storyClockHour,
		r.storyClockMinute
	]

	test("a renamed value keeps its old row's stamp and createdAt, and counts from the original write", async () => {
		const w = await world()
		await bookFor(w)
		await setClock(w, 9, 30)
		await put(w, OLD, 9)
		const [old] = await rowsFor(w, OLD)
		// The conversion happens half an hour of story later.
		await setClock(w, 10, 0)
		await convert(w)
		const renamed = (await rowsFor(w, NEW)).at(-1)!
		expect(columnsOf(renamed)).toEqual([1204, 3, 5, 9, 30])
		expect(columnsOf(renamed)).toEqual(columnsOf(old!))
		expect(renamed.createdAt).toEqual(old!.createdAt)

		await setClock(w, 11, 30)
		const { valueStampsOf } = await import("$lib/server/state/resolve")
		const stamp = (
			await valueStampsOf(testDb as unknown as Db, w.session.id, owner(w), [NEW])
		).get(NEW)
		expect(stamp).toEqual({
			clock: { year: 1204, month: 3, day: 5, hour: 9, minute: 30 },
			writtenAt: old!.createdAt
		})
		const { minutesBetween } = await import("$lib/server/rulesets/clockHours")
		const sessionNow = {
			year: 1204,
			month: 3,
			day: 5,
			hour: 11,
			minute: 30
		}
		// 120 from the original write; counting from the conversion would say 90.
		expect(minutesBetween(stamp!.clock!, sessionNow, null)).toBe(120)
	})

	test("an added default has no stamp", async () => {
		const w = await world()
		await bookFor(w)
		await setClock(w, 9, 30)
		await convert(w)
		const rows = await rowsFor(w, ADDED)
		expect(rows).toHaveLength(1)
		expect(columnsOf(rows[0]!)).toEqual([null, null, null, null, null])
	})

	// An ordinary `setValue` (no symbol) still stamps the session's clock now:
	// proved by valueStamp.int.test.ts "a session with a clock stamps all five".
})
