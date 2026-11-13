/**
 * 🚧 How long ago a stat was written, end to end (lane sense-age2): a test
 * ruleset's meter drains while its holder is awake and refills while asleep, by
 * the story minutes since the meter's own last write — read through
 * `resolveRulesetTurn`, a function body and the write gate. Idempotent within a
 * moment, honest across Back, silent without a clock, and handed real seconds
 * only to a function that declares it counts real time.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	defineRuleset,
	rulesetAttributeSlotId,
	type FunctionDecl
} from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const GENRE = "test:genre/written-ago-int"
const STORY = "test:ruleset/rest-story-int@1"
const REAL = "test:ruleset/rest-real-int@1"
const slotOf = (ruleset: string, attr: string) =>
	rulesetAttributeSlotId(ruleset, attr)
const d = () => db as unknown as Db

/** One body for both rulesets; the real-seconds line is told only when the key was handed. */
const BODY = `export function effects(ctx) {
	if (!ctx.owner || ctx.owner.kind !== "cast") return
	var w = ctx.bindings.what.writtenAgo.rest
	var lines = ["minutes=" + w.minutes]
	if ("realSeconds" in w) lines.push("real=" + w.realSeconds)
	var out = { lines: lines }
	if (w.minutes) {
		var asleep = ctx.bindings.state.values.asleep === true
		out.deltas = [{ attribute: "rest", op: "add", value: asleep ? w.minutes : -w.minutes }]
	}
	return out
}`

const module = (id: string, countsTime?: "real"): FunctionDecl =>
	({
		id,
		name: { en: "Rest" },
		meaning: {
			en: "A meter drains awake and refills asleep, a point a minute."
		},
		kind: "changing",
		bindings: { what: { to: "attribute" }, state: { to: "attribute" } },
		prose: "{{what}} drains while awake and refills while asleep.",
		phases: ["effects"],
		...(countsTime ? { countsTime } : {}),
		body: BODY
	}) as FunctionDecl

const declare = (ruleset: string, fnId: string, countsTime?: "real") =>
	defineRuleset(ruleset, {
		name: { en: "Rest" },
		attributes: [
			{
				id: "rest",
				name: { en: "Rest" },
				kind: "number",
				bounds: { min: 0, max: 100 },
				start: 50,
				prose: "How rested they are."
			},
			{
				id: "asleep",
				name: { en: "Asleep" },
				kind: "flag",
				prose: "Whether they are asleep."
			}
		],
		functions: [
			{
				ref: fnId,
				key: "meter",
				module: module(fnId, countsTime),
				bindings: { what: "rest", state: "asleep" }
			}
		]
	} as never)

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-written-ago-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	declare(STORY, "test:function/rest-story@1")
	declare(REAL, "test:function/rest-real@1", "real")
	genreKeeping(GENRE, {
		name: { en: "Rest" },
		family: "test",
		slots: [],
		events: {}
	})
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const T0 = { year: 1204, month: 3, day: 5, hour: 9, minute: 0 }
let n = 0

async function world(opts: { clock: boolean; ruleset?: string }) {
	const suffix = `${++n}`
	const ruleset = opts.ruleset ?? STORY
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `written-ago-${suffix}`)
	const [ann] = await db
		.insert(schema.characters)
		.values({
			userId: user.id,
			name: `Ann ${suffix}`,
			description: "A baker."
		})
		.returning()
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Rest ${suffix}`,
			genreId: GENRE,
			primaryRuleset: ruleset,
			rigour: "mechanics",
			lorebookId: lorebook!.id,
			storyClockYear: opts.clock ? T0.year : null,
			storyClockMonth: opts.clock ? T0.month : null,
			storyClockDay: opts.clock ? T0.day : null,
			storyClockHour: opts.clock ? T0.hour : null,
			storyClockMinute: opts.clock ? T0.minute : null
		})
		.returning()
	await db
		.insert(schema.sessionCharacters)
		.values({ sessionId: session!.id, characterId: ann!.id })
	const message = async (role: "assistant" | "user" = "assistant") => {
		const [legacy] = await db
			.insert(schema.sessionMessages)
			.values({
				sessionId: session!.id,
				role,
				characterId: role === "assistant" ? ann!.id : null,
				userId: role === "user" ? user.id : null,
				content: "…"
			})
			.returning()
		await db.insert(schema.messages).values({
			id: legacy!.id,
			sessionId: session!.id,
			characterId: role === "assistant" ? ann!.id : null,
			role
		})
		return legacy!
	}
	const owner = { kind: "session_cast" as const, id: ann!.id }
	const write = async (attr: string, value: unknown, messageId?: number) => {
		const { setValue } = await import("$lib/server/state/write")
		await setValue(
			d(),
			{
				sessionId: session!.id,
				updatedBy: "user" as const,
				userId: user.id,
				...(messageId !== undefined
					? { messageId, ownAnchor: true }
					: {})
			},
			{ owner, slotId: slotOf(ruleset, attr), value } as never
		)
	}
	const advance = async (minutes: number) => {
		const { advanceSessionStoryClock } = await import(
			"$lib/server/state/storyTime"
		)
		await advanceSessionStoryClock(d(), session!.id, minutes, "minutes")
	}
	const moment = async (mode: "apply" | "resolve") => {
		const { resolveRulesetTurn } = await import("./resolve")
		const res = await resolveRulesetTurn(
			db as any,
			{
				owners: [`session:${session!.id}`, `character:${ann!.id}`],
				mode,
				...(mode === "apply" ? { deltas: [], emits: false } : {})
			},
			{ runId: `written-ago-${suffix}-${++n}` }
		)
		if ("halt" in res) throw new Error(res.halt)
		const fns = (res.ok.facts.functions ?? {}) as {
			lines?: { text: string }[]
			failed?: unknown[]
			realNow?: string
		}
		return { fns, lines: (fns.lines ?? []).map((l) => l.text) }
	}
	const rest = async () => {
		const { stateFor } = await import("$lib/server/state/resolve")
		const state = await stateFor(d(), session!.id)
		return (state.cast.byId[String(ann!.id)] as any)?.rest as
			| number
			| undefined
	}
	return {
		user,
		ann: ann!,
		session: session!,
		message,
		write,
		advance,
		moment,
		rest
	}
}

describe("the sleep meter, by the minutes since its own write", () => {
	test("drains while awake, and a second moment with no time passed changes nothing", async () => {
		const w = await world({ clock: true })
		await w.message()
		await w.write("rest", 50)
		await w.advance(30)
		const first = await w.moment("apply")
		expect(first.lines).toContain("minutes=30")
		expect(await w.rest()).toBe(20)
		// The apply wrote the meter at the new clock: nothing has passed since.
		const second = await w.moment("apply")
		expect(second.lines).toContain("minutes=0")
		expect(await w.rest()).toBe(20)
	}, 60_000)

	test("refills while asleep; writing the state does not restart the count", async () => {
		const w = await world({ clock: true })
		await w.message()
		await w.write("rest", 20)
		await w.advance(4)
		await w.write("asleep", true)
		await w.advance(6)
		const res = await w.moment("apply")
		expect(res.lines).toContain("minutes=10")
		expect(await w.rest()).toBe(30)
	}, 60_000)

	test("Back past the write answers the minutes since the older write; Forward puts the newer back", async () => {
		const w = await world({ clock: true })
		const { rewindTurn, forwardTurn } = await import(
			"$lib/server/sessions/rewind"
		)
		await w.message("user")
		const a = await w.message()
		await w.write("rest", 50, a.id)
		await w.advance(20)
		await w.message("user")
		const b = await w.message()
		await w.write("rest", 40, b.id)
		await w.advance(15)
		// The clock now stands 35 minutes past T0, 15 past B's write.
		expect((await w.moment("resolve")).lines).toContain("minutes=15")

		const back = await rewindTurn(d(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		expect(back).toMatchObject({ ok: true })
		// Whatever the clock reads after Back, the meter now answers A's write at T0.
		const [row] = await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, w.session.id))
		const sinceT0 =
			(row!.storyClockDay! - T0.day) * 1440 +
			(row!.storyClockHour! - T0.hour) * 60 +
			(row!.storyClockMinute! - T0.minute)
		expect(sinceT0).toBeGreaterThan(0)
		expect((await w.moment("resolve")).lines).toContain(
			`minutes=${sinceT0}`
		)

		const forward = await forwardTurn(d(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		expect(forward).toMatchObject({ ok: true })
		const [after] = await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, w.session.id))
		const sinceB =
			(after!.storyClockDay! - T0.day) * 1440 +
			(after!.storyClockHour! - T0.hour) * 60 +
			(after!.storyClockMinute! - T0.minute) -
			20
		expect((await w.moment("resolve")).lines).toContain(`minutes=${sinceB}`)
	}, 60_000)

	test("a session with no story clock changes nothing, says minutes=null, and fails nothing", async () => {
		const w = await world({ clock: false })
		await w.message()
		await w.write("rest", 50)
		const res = await w.moment("apply")
		expect(res.lines).toEqual(["minutes=null"])
		expect(res.fns.failed ?? []).toEqual([])
		expect(await w.rest()).toBe(50)
	}, 60_000)
})

describe("real seconds, only for a function that counts real time", () => {
	test("a `real` function is handed the whole seconds and the instant; one that is not sees neither", async () => {
		const NOW = Date.parse("2030-01-01T12:00:00.000Z")
		// 4521.9 real seconds before NOW: the whole seconds are 4521.
		const WROTE = new Date(NOW - 4_521_900)
		const real = await world({ clock: true, ruleset: REAL })
		const plain = await world({ clock: true })
		for (const w of [real, plain]) {
			await w.message()
			await w.write("rest", 50)
			await db
				.update(schema.attributeValues)
				.set({ createdAt: WROTE })
				.where(eq(schema.attributeValues.sessionId, w.session.id))
		}
		const spy = vi.spyOn(Date, "now").mockReturnValue(NOW)
		try {
			const counted = await real.moment("resolve")
			expect(counted.lines).toContain("real=4521")
			expect(counted.fns.realNow).toBe("2030-01-01T12:00:00.000Z")
			const story = await plain.moment("resolve")
			expect(story.lines.some((l) => l.startsWith("real="))).toBe(false)
			expect(story.fns.realNow).toBeUndefined()
		} finally {
			spy.mockRestore()
		}
	}, 60_000)
})
