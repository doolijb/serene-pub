/**
 * 🚧 `speakerInCast` on the two history reads (`core:query/earlier-scenes@1`,
 * `core:query/history-entries@1`), through the bindings map: on by default, the
 * stored cast of each scene decides (`sessions/speakerInCast.ts`), `false`
 * is today's read, and the receipt line says what was done.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import { insertLegacy } from "$lib/server/messages/store"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { applyEligibility } from "$lib/server/pipelines/ranking/eligibility"
import { createHost } from "$lib/server/pipelines/runtime/host"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "bindings-speaker-in-cast-secret" }
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
	autoEnqueueLorebook: async () => {}
}))
vi.mock("$lib/server/sessions/speakerInCast", async (importOriginal) => {
	const m =
		await importOriginal<
			typeof import("$lib/server/sessions/speakerInCast")
		>()
	return {
		...m,
		loadSessionSceneCasts: vi.fn(m.loadSessionSceneCasts),
		loadSpeakerOfRef: vi.fn(m.loadSpeakerOfRef)
	}
})
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-bindings-speaker-in-cast-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 120_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

const db = () => testDb as unknown as Db
let n = 0
const words = (t: string) => t.split(/\s+/).filter(Boolean).length

/**
 * Mira (speaker) and Bren seated, Rook a card-less member. Uncompiled closed
 * scenes S1 (Mira + Bren; Mira's line), S2 (Bren), S3 (cast never worked out),
 * S4 (Bren; Mira's line). `scene` makes more, with one line each.
 */
async function world() {
	const suffix = ++n
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `bsc-${suffix}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Book ${suffix}` } as never)
		.returning()
	const cards: Record<string, { id: number; member: number }> = {}
	for (const name of ["Mira", "Bren", "Stray"]) {
		const [card] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name, description: "…" } as never)
			.returning()
		const member = (
			await insertCastMember(testDb, {
				lorebookId: book!.id,
				binding: `{{char:${name}${suffix}}}`,
				characterId: card!.id,
				name
			})
		).member!
		cards[name] = { id: card!.id, member: member.id }
	}
	const rook = (
		await insertCastMember(testDb, {
			lorebookId: book!.id,
			binding: `{{char:Rook${suffix}}}`,
			characterId: null,
			name: "Rook"
		})
	).member!
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: true,
			name: `Run ${suffix}`,
			lorebookId: book!.id
		} as never)
		.returning()
	const sessionId = session!.id
	await testDb.insert(schema.sessionCharacters).values(
		["Mira", "Bren"].map((name, position) => ({
			sessionId,
			characterId: cards[name]!.id,
			castMemberId: cards[name]!.member,
			position,
			seatedByUserId: user.id
		})) as never
	)
	const scene = async (
		cast: number[],
		o: {
			by?: number | null
			resolved?: boolean
			open?: boolean
			summary?: string | null
			status?: string
			entryId?: number
			sessionId?: number
		} = {}
	) => {
		const sid = o.sessionId ?? sessionId
		const line = (
			await insertLegacy(db(), {
				sessionId: sid,
				role: "assistant",
				content: "…",
				castMemberId: o.by ?? null
			} as never)
		).id
		const [row] = await testDb
			.insert(schema.scenes)
			.values({
				sessionId: sid,
				lorebookId: book!.id,
				channel: "main",
				openedAtMessageId: line,
				closedAtMessageId: o.open ? null : line,
				summary:
					o.summary === undefined ? `Summary ${line}.` : o.summary,
				summaryStatus: o.status ?? "done",
				castResolvedAt: o.resolved === false ? null : new Date(),
				historyEntryId: o.entryId ?? null
			} as never)
			.returning()
		if (cast.length)
			await testDb.insert(schema.sceneCharacters).values(
				cast.map((bindingId, ordinal) => ({
					sceneId: row!.id,
					bindingId,
					role: "participant",
					ordinal
				})) as never
			)
		return row!.id
	}
	const mira = cards.Mira!.member
	const bren = cards.Bren!.member
	const S1 = await scene([mira, bren], { by: mira })
	const S2 = await scene([bren], { by: bren })
	const S3 = await scene([], { by: bren, resolved: false })
	const S4 = await scene([bren], { by: mira })
	const entry = async (title: string, content: string, constant = true) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: book!.id,
					typeId: HISTORY_TYPE_ID,
					typeVersion: 1,
					title,
					content,
					keys: [`${title.toLowerCase()}qqx`],
					constant,
					position: ++n,
					fields: { year: 1200 + n, month: null, day: null }
				} as never)
				.returning()
		)[0]!.id
	return {
		user,
		cards,
		rook,
		book: book!,
		sessionId,
		scene,
		entry,
		S: { S1, S2, S3, S4 },
		mira,
		bren
	}
}
type World = Awaited<ReturnType<typeof world>>

function ctxFor(w: World, over: Record<string, (q?: unknown) => unknown> = {}) {
	const host = createHost(db(), { sessionId: w.sessionId, userId: w.user.id })
	const log = vi.fn()
	const tables: string[] = []
	return {
		log,
		tables,
		ctx: {
			read: (t: string, q?: unknown) => {
				tables.push(t)
				return over[t] ? over[t]!(q) : (host as any).read(t, q)
			},
			log,
			countTokens: words
		} as never
	}
}
const bindings = async () =>
	(await import("$lib/server/pipelines/runtime/bindings")).coreBindings()
const asMira = (w: World) => ({
	sessionId: w.sessionId,
	currentCharacterId: w.cards.Mira!.id
})
const lines = (log: ReturnType<typeof vi.fn>) =>
	log.mock.calls.map((c) => c[1] as string)

async function earlier(
	w: World,
	extra: Record<string, unknown> = {},
	params: Record<string, unknown> = {}
) {
	const { ctx, log } = ctxFor(w)
	const r = (await (
		await bindings()
	)["core:query/earlier-scenes@1"]!(
		{
			scope: asMira(w),
			budget: { total: 1000 },
			params,
			...extra
		} as never,
		ctx
	)) as any
	expect(r.kind).toBe("ok")
	return {
		ids: (r.value.main.scenes as { sceneId: number }[]).map(
			(s) => s.sceneId
		),
		log
	}
}

async function days(
	w: World,
	extra: Record<string, unknown> = {},
	params: Record<string, unknown> = {}
) {
	const { ctx, log } = ctxFor(w)
	const r = (await (
		await bindings()
	)["core:query/history-entries@1"]!(
		{ scope: asMira(w), params, ...extra } as never,
		ctx
	)) as any
	expect(r.kind).toBe("ok")
	const day = (id: number) =>
		(r.value.main as any[]).find(
			(c) => c.source === "history" && c.id === id
		)
	return {
		r,
		value: r.value,
		exclusions: r.value.exclusions as any[],
		day,
		log
	}
}

describe("core:query/earlier-scenes@1 with speakerInCast", () => {
	test("the speaker's turn: scenes it is not in are left out; open and unresolved cast stay", async () => {
		const w = await world()
		const r = await earlier(w)
		expect(r.ids).toEqual([w.S.S1, w.S.S3])
		expect(lines(r.log)).toEqual([
			"2 scene summaries left out: Mira is not in their cast"
		])
	})

	test("in every scene: nothing left out, said so", async () => {
		const w = await world()
		const r = await earlier(w, {
			scope: {
				sessionId: w.sessionId,
				currentCharacterId: w.cards.Bren!.id
			}
		})
		expect(r.ids).toEqual([w.S.S1, w.S.S2, w.S.S3, w.S.S4])
		expect(lines(r.log)).toEqual([
			"No scene summaries left out: Bren is in the cast of every one"
		])
	})

	test("missed one: the singular receipt", async () => {
		const w = await world()
		await testDb.delete(schema.scenes).where(eq(schema.scenes.id, w.S.S4))
		const r = await earlier(w)
		expect(r.ids).toEqual([w.S.S1, w.S.S3])
		expect(lines(r.log)).toEqual([
			"1 scene summary left out: Mira is not in its cast"
		])
	})

	test("a card in no seat reads everything; a card-less member in no cast keeps only the unresolved scene", async () => {
		const w = await world()
		const r = await earlier(w, {
			scope: {
				sessionId: w.sessionId,
				currentCharacterId: w.cards.Stray!.id
			}
		})
		// The card is in no seat: it reads everything.
		expect(r.ids).toEqual([w.S.S1, w.S.S2, w.S.S3, w.S.S4])
		expect(lines(r.log)).toEqual([
			"Reads everything: not one cast member's turn"
		])
		const rook = await earlier(w, {
			scope: { sessionId: w.sessionId, currentCastMemberId: w.rook.id }
		})
		expect(rook.ids).toEqual([w.S.S3])
		expect(lines(rook.log)).toEqual([
			"3 scene summaries left out: Rook is not in their cast"
		])
	})

	test("a card-less seat's turn that is in a scene's cast", async () => {
		const w = await world()
		await testDb.insert(schema.sceneCharacters).values({
			sceneId: w.S.S2,
			bindingId: w.rook.id,
			role: "participant",
			ordinal: 5
		} as never)
		const rook = await earlier(w, {
			scope: { sessionId: w.sessionId, currentCastMemberId: w.rook.id }
		})
		expect(rook.ids).toEqual([w.S.S2, w.S.S3])
	})

	test("a narrator turn (no character) reads everything and says so", async () => {
		const w = await world()
		const r = await earlier(w, { scope: { sessionId: w.sessionId } })
		expect(r.ids).toEqual([w.S.S1, w.S.S2, w.S.S3, w.S.S4])
		expect(lines(r.log)).toEqual([
			"Reads everything: not one cast member's turn"
		])
	})

	test("a scene resolved with an empty cast is kept, like one never worked out", async () => {
		const w = await world()
		const empty = await w.scene([], { by: w.bren })
		const r = await earlier(w)
		expect(r.ids).toEqual([w.S.S1, w.S.S3, empty])
		expect(lines(r.log)).toEqual([
			"2 scene summaries left out: Mira is not in their cast"
		])
	})

	test("no scenes: the speaker-in-cast step is skipped, no read and no receipt", async () => {
		const w = await world()
		await testDb
			.delete(schema.scenes)
			.where(eq(schema.scenes.sessionId, w.sessionId))
		const { ctx, log, tables } = ctxFor(w)
		const r = (await (
			await bindings()
		)["core:query/earlier-scenes@1"]!(
			{ scope: asMira(w), budget: { total: 1000 }, params: {} } as never,
			ctx
		)) as any
		expect(r.value.main.scenes).toEqual([])
		expect(tables).not.toContain("speaker_in_cast")
		expect(log).not.toHaveBeenCalled()
	})

	test("param off: today's scenes, and no receipt line", async () => {
		const w = await world()
		const r = await earlier(w, {}, { speakerInCast: false })
		expect(r.ids).toEqual([w.S.S1, w.S.S2, w.S.S3, w.S.S4])
		expect(r.log).not.toHaveBeenCalled()
	})

	test("firsthand wired beside it: firsthand first, then the param on what is left", async () => {
		const w = await world()
		const r = await earlier(w, { firsthandFor: w.cards.Mira!.id })
		// Firsthand keeps what Mira spoke in (S1, S4); the cast then drops S4.
		expect(r.ids).toEqual([w.S.S1])
		expect(lines(r.log)).toEqual([
			"2 scene summaries left out: Mira was not there",
			"1 scene summary left out: Mira is not in its cast"
		])
		const off = await earlier(
			w,
			{ firsthandFor: w.cards.Mira!.id },
			{ speakerInCast: false }
		)
		expect(off.ids).toEqual([w.S.S1, w.S.S4])
		expect(lines(off.log)).toEqual([
			"2 scene summaries left out: Mira was not there"
		])
	})
})

/** A compiled day: scenes → entry. */
async function dayWorld() {
	const w = await world()
	const { mira, bren } = w
	const text = (label: string) =>
		`${label} day as the history entry itself wrote it, with its own long words.`
	const e = {
		all: await w.entry("All", text("All")),
		mixed: await w.entry("Mixed", text("Mixed")),
		none: await w.entry("None", text("None")),
		hand: await w.entry("Hand", text("Hand")),
		elsewhere: await w.entry("Elsewhere", text("Elsewhere")),
		foreign: await w.entry("Foreign", text("Foreign")),
		open: await w.entry("Open", text("Open")),
		unresolved: await w.entry("Unresolved", text("Unresolved")),
		side: await w.entry("Side", text("Side"), false)
	}
	await w.scene([mira, bren], { entryId: e.all, summary: "All one." })
	await w.scene([mira], { entryId: e.all, summary: "All two." })
	// Mixed: the earlier scene (Mira in) and the later (Bren only), summaries out of id order.
	const mixedLate = await w.scene([bren], {
		entryId: e.mixed,
		summary: "Mixed late, Bren alone."
	})
	const mixedEarly = await w.scene([mira, bren], {
		entryId: e.mixed,
		summary: "  Mixed early.  "
	})
	await testDb
		.update(schema.scenes)
		.set({ openedAtMessageId: 1_000_000 } as never)
		.where(eq(schema.scenes.id, mixedLate))
	await w.scene([bren], { entryId: e.none, summary: "None one." })
	await w.scene([bren], { entryId: e.none, summary: "None two." })
	const [other] = await testDb
		.insert(schema.sessions)
		.values({
			userId: w.user.id,
			isGroup: true,
			name: "Other run",
			lorebookId: w.book.id
		} as never)
		.returning()
	await w.scene([bren], { entryId: e.elsewhere, sessionId: other!.id })
	await w.scene([mira], { entryId: e.foreign })
	await w.scene([bren], { entryId: e.foreign, sessionId: other!.id })
	await w.scene([bren], { entryId: e.open, open: true })
	await w.scene([bren], { entryId: e.unresolved, resolved: false })
	await w.scene([mira], { entryId: e.side, summary: "Side kept." })
	await w.scene([bren], { entryId: e.side, summary: "Side missed." })
	return { w, e, mixedEarly, other: other! }
}

describe("core:query/history-entries@1 with speakerInCast", () => {
	test("each case for the speaker's turn", async () => {
		const { w, e } = await dayWorld()
		const plain = await days(w, {}, { speakerInCast: false })
		const r = await days(w)
		// Fully attended, hand-written, another session's only, other session's scene beside the speaker's, open, unresolved: untouched.
		// The density signal is relative to the other days' lengths, which moved.
		for (const id of [
			e.all,
			e.hand,
			e.elsewhere,
			e.foreign,
			e.open,
			e.unresolved
		])
			expect(r.day(id).payload).toEqual(plain.day(id).payload)
		// Missed some: the day reads as the kept scenes' summary, under the same date fields.
		const mixed = r.day(e.mixed)
		expect(mixed.payload.content).toBe("Mixed early.")
		expect(mixed.tokens).toBe(2)
		expect(mixed.payload.title).toBe(plain.day(e.mixed).payload.title)
		expect(mixed.payload.fields).toEqual(plain.day(e.mixed).payload.fields)
		expect(mixed.tokens).toBeLessThanOrEqual(plain.day(e.mixed).tokens)
		expect(
			r.value.hits.find((c: any) => c.id === e.mixed).payload.content
		).toBe("Mixed early.")
		// In the cast of none: gone from the read itself, and nothing is published on exclusions.
		expect(r.day(e.none)).toBeUndefined()
		expect(r.exclusions).toEqual(plain.exclusions)
		expect(lines(r.log)).toContain(
			"History for Mira: 2 days shown as the scenes Mira was in, 1 left out"
		)
	})

	test("the host's read hands every asker the judged day; the shared book read is never mutated", async () => {
		const { w, e } = await dayWorld()
		const { ctx } = ctxFor(w)
		const read = (q: Record<string, unknown>) =>
			(ctx as any).read("lorebook_entries", {
				sessionId: w.sessionId,
				currentCharacterId: w.cards.Mira!.id,
				...q
			}) as Promise<any[]>
		const on = await read({})
		const side = on.find((x) => x.id === e.side)
		// The day the lane would not even return (not constant) reads as the kept summary.
		expect(side.content).toBe("Side kept.")
		expect(on.find((x) => x.id === e.none)).toBeUndefined()
		const off = await read({ speakerInCast: false })
		expect(off.find((x) => x.id === e.side).content).toContain(
			"Side day as the history entry itself wrote it"
		)
		expect(off.find((x) => x.id === e.none)).toBeTruthy()
		// Asked again with the judgement on, the same.
		expect((await read({})).find((x) => x.id === e.side).content).toBe(
			"Side kept."
		)
	})

	test("in every scene: no entry changed, said so", async () => {
		const w = await world()
		const all = await w.entry("Whole", "Whole day text here.")
		await w.scene([w.mira], { entryId: all })
		const plain = await days(w, {}, { speakerInCast: false })
		const r = await days(w)
		expect(JSON.stringify(r.value)).toBe(JSON.stringify(plain.value))
		expect(lines(r.log)).toContain("No history entries changed for Mira")
	})

	test("the cut keeps the start: the first summaries stay, the last goes, said cut short", async () => {
		const w = await world()
		// The day's own text is 17 characters; the cap is twice that, 34.
		const cut = await w.entry("Cut", "w1 w2 w3 w4 w5 w6")
		await w.scene([w.mira], {
			entryId: cut,
			summary: "alpha beta gamma delta"
		})
		await w.scene([w.mira], { entryId: cut, summary: "epsilon zeta eta" })
		await w.scene([w.bren], { entryId: cut, summary: "theta" })
		const r = await days(w)
		expect(r.day(cut).payload.content).toBe("alpha beta gamma delta")
		expect(r.day(cut).tokens).toBe(4)
		expect(lines(r.log)).toContain(
			"History for Mira: 1 day shown as the scenes Mira was in, 1 cut short"
		)
		// 23 characters, cap 46: both summaries fit, nothing cut.
		const fits = await w.entry("Fits", "w1 w2 w3 w4 w5 w6 w7 w8")
		await w.scene([w.mira], { entryId: fits, summary: "one two" })
		await w.scene([w.mira], { entryId: fits, summary: "three four" })
		await w.scene([w.bren], { entryId: fits, summary: "five" })
		const r2 = await days(w)
		expect(r2.day(fits).payload.content).toBe("one two\n\nthree four")
		expect(r2.day(fits).tokens).toBe(words("one two\n\nthree four"))
	})

	test("two of three scenes: both summaries stay though together longer than the day's own text", async () => {
		const w = await world()
		const day = await w.entry("Two", "The day as the chronicler wrote.")
		await w.scene([w.mira], {
			entryId: day,
			summary: "First part told at length."
		})
		await w.scene([w.mira], {
			entryId: day,
			summary: "Second part told too."
		})
		await w.scene([w.bren], { entryId: day, summary: "Bren alone." })
		const r = await days(w)
		const text = r.day(day).payload.content as string
		expect(text).toBe("First part told at length.\n\nSecond part told too.")
		expect(text.length).toBeGreaterThan(
			"The day as the chronicler wrote.".length
		)
	})

	test("the first summary is kept whole even alone over the cap; no usable summary leaves the day out", async () => {
		const w = await world()
		const small = await w.entry("Small", "tiny")
		await w.scene([w.mira], { entryId: small, summary: "two words" })
		await w.scene([w.bren], { entryId: small })
		const blank = await w.entry(
			"Blank",
			"A day with a long text of its own here."
		)
		await w.scene([w.mira], { entryId: blank, summary: "   " })
		await w.scene([w.bren], { entryId: blank })
		const r = await days(w)
		expect(r.day(small).payload.content).toBe("two words")
		expect(r.day(blank)).toBeUndefined()
		expect(r.exclusions).toEqual([])
	})

	test("a scene resolved with an empty cast is kept in a day", async () => {
		const w = await world()
		const day = await w.entry(
			"Empty",
			"The day of the empty cast, in its own words."
		)
		await w.scene([w.bren], { entryId: day, summary: "Bren only." })
		await w.scene([], { entryId: day, summary: "Nobody listed." })
		const r = await days(w)
		expect(r.day(day).payload.content).toBe("Nobody listed.")
	})

	test("a narrator turn, a card in no seat: reads everything", async () => {
		const { w } = await dayWorld()
		const plain = await days(
			w,
			{ scope: { sessionId: w.sessionId } },
			{ speakerInCast: false }
		)
		for (const scope of [
			{ sessionId: w.sessionId },
			{ sessionId: w.sessionId, currentCharacterId: w.cards.Stray!.id }
		]) {
			const r = await days(w, { scope })
			expect(JSON.stringify(r.value)).toBe(JSON.stringify(plain.value))
			expect(lines(r.log).at(-1)).toBe(
				"Reads everything: not one cast member's turn"
			)
		}
	})

	test("a card-less seat's turn is judged by its member", async () => {
		const { w, e } = await dayWorld()
		const r = await days(w, {
			scope: { sessionId: w.sessionId, currentCastMemberId: w.rook.id }
		})
		for (const id of [e.all, e.mixed, e.none])
			expect(r.day(id), `day ${id}`).toBeUndefined()
		expect(r.day(e.hand)).toBeTruthy()
		expect(lines(r.log).some((l) => l.startsWith("History for Rook"))).toBe(
			true
		)
	})

	test("param off: byte-identical to the read with no speaker, no receipt line", async () => {
		const { w } = await dayWorld()
		const off = await days(w, {}, { speakerInCast: false })
		const again = await days(w, {}, { speakerInCast: false })
		expect(JSON.stringify(off.r)).toBe(JSON.stringify(again.r))
		expect(
			lines(off.log).filter(
				(l) =>
					l.includes("History for") ||
					l.includes("No history entries")
			)
		).toEqual([])
	})

	test("a world with no scene behind any day loads nothing and says nothing", async () => {
		const w = await world()
		await w.entry("Hand", "A hand-written day.")
		const { ctx, log } = ctxFor(w)
		const sessions = await import("$lib/server/sessions/speakerInCast")
		vi.mocked(sessions.loadSpeakerOfRef).mockClear()
		await (
			await bindings()
		)["core:query/history-entries@1"]!(
			{ scope: asMira(w), params: {} } as never,
			ctx
		)
		expect(sessions.loadSpeakerOfRef).not.toHaveBeenCalled()
		expect(lines(log).filter((l) => l.startsWith("History for"))).toEqual(
			[]
		)
	})

	test("firsthand wired beside it: both receipts, and an entry firsthand left out is published once", async () => {
		const { w, e } = await dayWorld()
		const r = await days(w, { firsthandFor: w.cards.Mira!.id })
		const l = lines(r.log)
		expect(l.some((x) => x.includes("was not there"))).toBe(true)
		expect(l.some((x) => x.startsWith("History for Mira"))).toBe(true)
		const ids = r.exclusions.map((x) => `${x.source}:${x.id}`)
		expect(new Set(ids).size).toBe(ids.length)
		expect(ids).toContain(`history:${e.none}`)
	})
})

describe("the judged day reaches every path that reads lore", () => {
	const hitText = (hits: any[], id: number) =>
		hits.find((h) => h.id === id)?.payload?.content as string | undefined

	test("search by meaning: the half-missed day reads as the kept summary, never its whole text", async () => {
		const { w, e } = await dayWorld()
		const hit = (id: number) => ({
			id,
			source: "historyEntry",
			score: 0.9,
			content: "x"
		})
		const hits = [hit(e.mixed), hit(e.side), hit(e.none)]
		const over = {
			embedding_status: () => ({ available: true, model: "m" }),
			vector_search: () => ({
				candidates: hits,
				lists: [hits],
				similarity: hits.map(() => hits.map(() => 0)),
				truncated: []
			})
		}
		const { ctx } = ctxFor(w, over)
		const r = (await (
			await bindings()
		)["core:query/vector-search@1"]!(
			{
				scope: asMira(w),
				vectors: [[1, 0]],
				params: { maxEntries: 10 }
			} as never,
			ctx
		)) as any
		const found = r.value.hits as any[]
		expect(hitText(found, e.mixed)).toBe("Mixed early.")
		expect(hitText(found, e.side)).toBe("Side kept.")
		expect(found.map((h) => h.id)).not.toContain(e.none)
		expect(JSON.stringify(found)).not.toContain(
			"day as the history entry itself wrote it"
		)
	})

	test("the triggers read (Look, narration, the side-character turn's source): the day reads judged", async () => {
		const { w, e } = await dayWorld()
		const { ctx } = ctxFor(w)
		const run = async (scope: Record<string, unknown>) =>
			(await (
				await bindings()
			)["core:query/lorebook-triggers@1"]!(
				{ scope, params: {} } as never,
				ctx
			)) as any
		const mira = await run(asMira(w))
		const mixed = (mira.value.hits as any[]).find(
			(h) => h.source === "history" && h.id === e.mixed
		)
		expect(mixed.payload.content).toBe("Mixed early.")
		const narrator = await run({ sessionId: w.sessionId })
		const whole = (narrator.value.hits as any[]).find(
			(h) => h.source === "history" && h.id === e.mixed
		)
		expect(whole.payload.content).toContain(
			"day as the history entry itself wrote it"
		)
	})

	test("a keyword chain into the day: a key only in the missed part is not chained on the speaker's turn", async () => {
		const w = await world()
		const day = await w.entry(
			"Chain",
			"Bren found the xylophonekey in the cellar."
		)
		await w.scene([w.mira], { entryId: day, summary: "Mira kept watch." })
		await w.scene([w.bren], { entryId: day, summary: "Bren went below." })
		const { WORLD_LORE_TYPE_ID } = await import("$lib/shared/entries/types")
		const [chained] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.book.id,
				typeId: WORLD_LORE_TYPE_ID,
				typeVersion: 1,
				title: "Cellar",
				content: "The cellar is damp.",
				keys: ["xylophonekey"],
				constant: false,
				position: 900
			} as never)
			.returning()
		const lane = async (scope: Record<string, unknown>) => {
			const { ctx } = ctxFor(w)
			const r = (await (
				await bindings()
			)["core:query/world-lore@1"]!(
				{ scope, params: { maxRecursionDepth: 3 } } as never,
				ctx
			)) as any
			return (r.value.hits as any[]).map((h) => h.id)
		}
		expect(await lane({ sessionId: w.sessionId })).toContain(chained!.id)
		expect(await lane(asMira(w))).not.toContain(chained!.id)
	})
})

describe("one load per run", () => {
	test("a Story turn with scenes loads the casts once and the speaker once, for both reads", async () => {
		const { w } = await dayWorld()
		const sessions = await import("$lib/server/sessions/speakerInCast")
		vi.mocked(sessions.loadSessionSceneCasts).mockClear()
		vi.mocked(sessions.loadSpeakerOfRef).mockClear()
		const { ctx } = ctxFor(w)
		const b = await bindings()
		await b["core:query/history-entries@1"]!(
			{ scope: asMira(w), params: {} } as never,
			ctx
		)
		await b["core:query/earlier-scenes@1"]!(
			{ scope: asMira(w), budget: { total: 1000 }, params: {} } as never,
			ctx
		)
		await b["core:query/world-lore@1"]!(
			{ scope: asMira(w), params: {} } as never,
			ctx
		)
		expect(sessions.loadSessionSceneCasts).toHaveBeenCalledTimes(1)
		expect(sessions.loadSpeakerOfRef).toHaveBeenCalledTimes(1)
	})
})
