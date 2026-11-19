/** 🚧 `entriesNamedIn` (`core:query/entries-named@1`): the entries the message lines name, as the session reads them. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-entries-named-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `named-${suffix}`)
	await db.insert(schema.userSettings).values({ userId: user.id, loreWriteMode: "full" })
	const [book] = await db.insert(schema.lorebooks).values({ userId: user.id, name: `World ${suffix}` }).returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${suffix}`, lorebookId: book!.id })
		.returning()
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const own = await ownBookFor(db as unknown as Db, session!.id)
	return { user, book: book!, session: session!, own }
}

async function lore(
	lorebookId: number,
	title: string,
	content: string,
	extra: Partial<typeof schema.lorebookEntries.$inferInsert> = {}
) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({ lorebookId, typeId: WORLD_LORE_TYPE_ID, typeVersion: 1, position: ++n, title, content, ...extra })
		.returning()
	return row!
}

const say = (...texts: string[]) => texts.map((content, i) => ({ id: i + 1, content }))

const named = async (
	w: Awaited<ReturnType<typeof world>>,
	messages: unknown,
	opts: Partial<{ typeIds: string[]; maxEntries: number; maxTokens: number | null; countTokens: (t: string) => number }> = {}
) => {
	const { entriesNamedIn } = await import("$lib/server/pipelines/runtime/loreMatch")
	return entriesNamedIn(db as unknown as Db, w.session.id, {
		typeIds: [WORLD_LORE_TYPE_ID],
		maxEntries: 12,
		maxTokens: null,
		messages,
		...opts
	})
}

describe("entriesNamedIn", () => {
	it("names by name and by key, within one message; a name split across two messages does not count", async () => {
		const w = await world()
		const mira = await lore(w.book.id, "Mira", "A baker.")
		const odo = await lore(w.book.id, "Odo", "A miller.", { keys: ["the mill"] })
		await lore(w.book.id, "Zed", "A smith.")
		expect((await named(w, say("I met mira today."))).map((r) => r.entryId)).toEqual([mira.id])
		expect((await named(w, say("We went to the mill."))).map((r) => r.entryId)).toEqual([odo.id])
		expect(await named(w, say("Zed", "smith"))).toHaveLength(1)
		const split = await lore(w.book.id, "Old Gate", "A gate.")
		expect((await named(w, say("The old", "gate stands."))).map((r) => r.entryId)).not.toContain(split.id)
		expect((await named(w, say("The old gate stands."))).map((r) => r.entryId)).toContain(split.id)
	})

	it("own book first, then the lorebook; ids in the same order", async () => {
		const w = await world()
		const inBook = await lore(w.book.id, "Mira", "Lorebook Mira.")
		const inNotes = await lore(w.own.id, "Odo", "Notes Odo.")
		const rows = await named(w, say("Mira and Odo met."))
		expect(rows.map((r) => r.entryId)).toEqual([inNotes.id, inBook.id])
		expect(rows[0]).toEqual({
			entryId: inNotes.id,
			entryType: WORLD_LORE_TYPE_ID,
			name: "Odo",
			content: "Notes Odo.",
			byPerson: true
		})
	})

	it("leaves out other entry types, switched-off and archived entries", async () => {
		const w = await world()
		const ok = await lore(w.book.id, "Mira", "A baker.")
		await lore(w.book.id, "Odo", "Off.", { enabled: false })
		await lore(w.book.id, "Zed", "Archived.", { archived: true })
		await db.insert(schema.lorebookEntries).values({
			lorebookId: w.book.id,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title: "Vault",
			content: "A place.",
			fields: { category: "Rooms" }
		})
		const rows = await named(w, say("Mira, Odo, Zed and the Vault."))
		expect(rows.map((r) => r.entryId)).toEqual([ok.id])
		const places = await named(w, say("Mira, Odo, Zed and the Vault."), { typeIds: [LOCATION_TYPE_ID] })
		expect(places.map((r) => r.name)).toEqual(["Vault"])
	})

	it("a held change's content is what is returned; a pipeline's entry is not by a person", async () => {
		const w = await world()
		const mira = await lore(w.book.id, "Mira", "A baker.", { provenance: "pipeline" })
		await db.insert(schema.entryAmendments).values({
			lorebookId: w.own.id,
			entryId: mira.id,
			branchId: null,
			year: null,
			month: null,
			day: null,
			fields: { content: "A widow." },
			base: { content: { v: "A baker." } },
			sourceMessageId: null
		} as any)
		const [row] = await named(w, say("Mira"))
		expect(row).toMatchObject({ content: "A widow.", byPerson: false })
	})

	it("caps by count, by tokens (skipping a long one, trying later ones), and 0 shows none", async () => {
		const w = await world()
		const a = await lore(w.book.id, "Aa", "x".repeat(400))
		const b = await lore(w.book.id, "Bb", "short")
		const c = await lore(w.book.id, "Cc", "short")
		const text = say("Aa Bb Cc")
		expect((await named(w, text, { maxEntries: 2 })).map((r) => r.entryId)).toEqual([a.id, b.id])
		expect(await named(w, text, { maxEntries: 0 })).toEqual([])
		const capped = await named(w, text, { maxTokens: 20, countTokens: (t) => Math.ceil(t.length / 4) })
		expect(capped.map((r) => r.entryId)).toEqual([b.id, c.id])
	})

	it("hidden and unstored rows are not read", async () => {
		const w = await world()
		await lore(w.book.id, "Mira", "A baker.")
		expect(await named(w, [{ id: 1, content: "Mira", isHidden: true }, { id: -1, content: "Mira" }])).toEqual([])
		expect(await named(w, [[{ id: 2, content: "Mira" }]])).toHaveLength(1)
	})
})

describe("core:query/entries-named@1 earmarks what it lists", () => {
	const run = async (runId: string | undefined, w: Awaited<ReturnType<typeof world>>, text: string) => {
		const { coreBindings } = await import("$lib/server/pipelines/runtime/bindings")
		const binding = coreBindings(runId ? { runId } : {})["core:query/entries-named@1"] as unknown as (
			input: unknown,
			ctx: unknown
		) => Promise<{ value: { main: Array<{ entryId: number }>; ids: number[] } }>
		return (await binding({ scope: { sessionId: w.session.id }, messages: say(text), params: {} }, {})).value
	}

	it("leaveOut: a left-out entry the lines name is not returned and is reported; one nobody names is not", async () => {
		const w = await world()
		const mira = await lore(w.book.id, "Mira", "A baker.")
		const odo = await lore(w.book.id, "Odo", "A miller.", { keys: ["the mill"] })
		const zed = await lore(w.book.id, "Zed", "A smith.")
		let skipped: number[] = []
		const rows = await named(w, say("Mira and the mill."), {
			leaveOut: new Set([odo.id, zed.id]),
			onLeftOut: (ids: number[]) => (skipped = ids)
		} as never)
		expect(rows.map((r) => r.entryId)).toEqual([mira.id])
		expect(skipped).toEqual([odo.id])
	})

	it("timeless: a history entry the lines name is not matched or returned and the receipt says so; on again it is back", async () => {
		const { HISTORY_TYPE_ID } = await import("$lib/shared/entries/types")
		const { historyValues } = await import("$lib/server/pipelines/testing/fixtures")
		const { eq } = await import("drizzle-orm")
		const w = await world()
		const mira = await lore(w.book.id, "Mira", "A baker.")
		const [war] = await db
			.insert(schema.lorebookEntries)
			.values(historyValues([{ lorebookId: w.book.id, year: 5, month: 1, day: 2, keys: ["the siege"] }] as never))
			.returning()
		const { coreBindings } = await import("$lib/server/pipelines/runtime/bindings")
		const binding = coreBindings({})["core:query/entries-named@1"] as unknown as (
			input: unknown,
			ctx: unknown
		) => Promise<{ value: { main: Array<{ entryId: number }>; ids: number[] } }>
		const ask = async () => {
			const log = vi.fn()
			const out = await binding(
				{
					scope: { sessionId: w.session.id },
					messages: say("Mira recalls the siege."),
					params: { entryTypes: [WORLD_LORE_TYPE_ID, HISTORY_TYPE_ID], knownToSpeaker: false }
				},
				{ log }
			)
			return { ids: out.value.ids, notes: log.mock.calls.map((c) => c[1]) }
		}
		const setTimeline = (on: boolean) =>
			db.update(schema.lorebooks).set({ timelineEnabled: on }).where(eq(schema.lorebooks.id, w.book.id))

		const on = await ask()
		expect(on.ids).toEqual(expect.arrayContaining([mira.id, war!.id]))
		expect(on.notes.join("\n")).not.toMatch(/history/)

		await setTimeline(false)
		const off = await ask()
		expect(off.ids).toEqual([mira.id])
		expect(off.notes).toContain("1 history entry left out: this lorebook keeps no timeline")

		await setTimeline(true)
		const back = await ask()
		expect(back.ids).toEqual(expect.arrayContaining([mira.id, war!.id]))
		expect(back.notes.join("\n")).not.toMatch(/history/)
	})

	it("earmarks exactly the ids it returns on the registered run", async () => {
		const reg = await import("$lib/server/pipelines/runtime/runRegistry")
		reg._reset()
		const w = await world()
		const mira = await lore(w.book.id, "Mira", "A baker.")
		const odo = await lore(w.book.id, "Odo", "A miller.")
		const zed = await lore(w.book.id, "Zed", "A smith.")
		reg.start({ runId: "earmark-run", userId: w.user.id, kind: "routine" })
		const out = await run("earmark-run", w, "Mira met Odo.")
		expect(out.ids).toEqual(expect.arrayContaining([mira.id, odo.id]))
		expect(out.ids).toHaveLength(2)
		for (const id of out.ids!) expect(reg.earmarkedBy("entry", id).map((h) => h.runId)).toEqual(["earmark-run"])
		expect(reg.earmarkedBy("entry", zed.id)).toEqual([])
		reg.finish("earmark-run")
		expect(reg.earmarkedBy("entry", mira.id)).toEqual([])
	})

	it("a dry run (an id no run is registered under) earmarks nothing", async () => {
		const reg = await import("$lib/server/pipelines/runtime/runRegistry")
		reg._reset()
		const w = await world()
		const mira = await lore(w.book.id, "Mira", "A baker.")
		const out = await run("dry-run-id", w, "Mira")
		expect(out.ids).toEqual([mira.id])
		expect(reg.earmarkedBy("entry", mira.id)).toEqual([])
		const bare = await run(undefined, w, "Mira")
		expect(bare.ids).toEqual([mira.id])
		expect(reg.earmarkedBy("entry", mira.id)).toEqual([])
	})
})
