/**
 * The people-sentence mark at the raise sites of the P rows of
 * `plans/INVENTORY-halt-sentences-2026-11-17.md`: each refusal a person in the
 * session can act on is recorded under its run with no `key: ` prefix, the
 * thrown or returned words stay as they were, and an unmarked sibling stays
 * unmarked. The mark is read back the way `runSpec` reads it:
 * `takePeopleSentence(runId, <the words the halt said>)`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { entryInsert, WORLD_LORE_TYPE_ID } from "$lib/server/utils/lorebookEntries"
import { peopleSentenceOf, takePeopleSentence } from "$lib/server/pipelines/runtime/host.types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))
// The lore-write date reads as undatable to the outlets; the backstop reads the truth.
vi.mock("$lib/server/state/storyTime", async (orig) => ({
	...(await orig<typeof import("$lib/server/state/storyTime")>()),
	loreWriteDateOf: vi.fn(async () => ({ kind: "undatable" }))
}))

/** The shapes the test genres declare; `getSessionGenre` answers from here. */
const GENRES: Record<string, { name: string; shape: unknown }> = {
	"test:genre/reference": { name: "Reference", shape: { writes: { lore: false, seats: false } } },
	"test:genre/library": {
		name: "Library",
		shape: { writes: { lore: true, library: { characters: true, lorebooks: true } } }
	}
}
vi.mock("$lib/server/pipelines/entities/sessionGenres", async (importOriginal) => {
	const real = await importOriginal<typeof import("$lib/server/pipelines/entities/sessionGenres")>()
	return {
		...real,
		getSessionGenre: async (_db: unknown, id: string) => {
			const g = GENRES[id]
			return g ? { genreId: id, ...g } : null
		}
	}
})

let db: TestDb
let dataDir: string
let n = 0

const node = (definitionId: string) => ({ key: "step", definitionId, definitionVersion: 1 }) as never

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-people-sentence-rows-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function user(tag: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return (await createTestUser(db, `${tag}-${++n}`)).id
}

async function session(userId: number, extra: Record<string, unknown> = {}) {
	const [row] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: `rows ${++n}`, ...extra } as never)
		.returning()
	return row!
}

async function message(sessionId: number, extra: Record<string, unknown> = {}) {
	const { insertLegacy } = await import("$lib/server/messages/store")
	const row = (await insertLegacy(db as unknown as Db, {
		sessionId,
		role: "assistant",
		content: "The gate is old.",
		channel: "main",
		...extra
	} as never)) as { id: number }
	return row.id
}

async function hostFor(sessionId: number, userId: number | undefined, extra: Record<string, unknown> = {}) {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const runId = `rows-run-${++n}`
	const host = createHost(db as never, { sessionId, userId, runId, ...extra } as never)
	return { host, runId }
}

/** Commit; return what a run's record says about the halt (the thrown message or the returned `halt`). */
async function commitHalt(
	host: Awaited<ReturnType<typeof hostFor>>,
	definitionId: string,
	payload: Record<string, unknown>
): Promise<{ said: string; people: string | undefined }> {
	let said: string
	try {
		const out = (await host.host.commit!(payload, node(definitionId))) as { halt?: string }
		if (typeof out?.halt !== "string") throw new Error(`no halt: ${JSON.stringify(out)}`)
		said = out.halt
	} catch (e) {
		if (!(e instanceof Error) || e.message.startsWith("no halt: ")) throw e
		said = e.message
	}
	return { said, people: takePeopleSentence(host.runId, said) }
}

describe("host raise sites: the sentence reaches the run's record with no node-key prefix", () => {
	it("row 4: a guest may not change the owner's message; row 6: a message still being written", async () => {
		const owner = await user("owner")
		const guest = await user("guest")
		const s = await session(owner)
		const reply = await message(s.id)
		const { MESSAGE_ACTION_REFUSAL } = await import("$lib/server/messages/permissions")

		const refused = await commitHalt(await hostFor(s.id, guest), "core:outlet/edit-message", {
			target: reply,
			text: "x"
		})
		expect(refused.said).toBe(`step: ${MESSAGE_ACTION_REFUSAL}`)
		expect(refused.people).toBe(MESSAGE_ACTION_REFUSAL)

		const live = await message(s.id, { isGenerating: true })
		const sentence = `message ${live} is still being written — stop it first, or wait.`
		for (const [definitionId, payload] of [
			["core:outlet/edit-message", { target: live, text: "x" }],
			["core:outlet/swipe-message", { target: live }]
		] as const) {
			const out = await commitHalt(await hostFor(s.id, owner), definitionId, payload)
			expect(out.said).toBe(`step: ${sentence}`)
			expect(out.people).toBe(sentence)
		}
	})

	it("row 5: only the owner may branch", async () => {
		const owner = await user("owner")
		const guest = await user("guest")
		const s = await session(owner)
		const reply = await message(s.id)
		const out = await commitHalt(await hostFor(s.id, guest), "core:outlet/branch-session", {
			fromMessage: reply,
			title: "Fork"
		})
		expect(out.said).toBe("step: only the session's owner may branch it.")
		expect(out.people).toBe("only the session's owner may branch it.")
	})

	it("row 7: a retraction below the settle line says so for people", async () => {
		const owner = await user("owner")
		const s = await session(owner)
		const reply = await message(s.id)
		await db
			.update(schema.sessions)
			.set({ settledMessageId: reply } as never)
			.where((await import("drizzle-orm")).eq(schema.sessions.id, s.id))
		const { SETTLED_SENTENCE } = await import("$lib/server/sessions/settle")
		const out = await commitHalt(await hostFor(s.id, owner), "core:outlet/delete-message", {
			target: reply
		})
		expect(out.said).toBe(`step: ${SETTLED_SENTENCE}`)
		expect(out.people).toBe(SETTLED_SENTENCE)
	})

	it("row 9: a bench refusal is a returned halt carrying its sentence", async () => {
		const owner = await user("owner")
		const [character] = await db
			.insert(schema.characters)
			.values({ userId: owner, name: "Alice", description: "A knight." })
			.returning()
		const s = await session(owner, { genreId: "test:genre/library" })
		GENRES["test:genre/library"]!.shape = {
			writes: { lore: true, seats: true, library: { characters: true, lorebooks: true } }
		}
		const [seat] = await db
			.insert(schema.sessionCharacters)
			.values({ sessionId: s.id, characterId: character!.id, isActive: true, removedAt: new Date() } as never)
			.returning()
		const out = await commitHalt(await hostFor(s.id, owner), "core:outlet/set-seat-bench", {
			seat: `character:${seat!.id}`,
			benched: true
		})
		GENRES["test:genre/library"]!.shape = {
			writes: { lore: true, library: { characters: true, lorebooks: true } }
		}
		const sentence = "That seat has left this session. Seat them again to bring them back."
		expect(out.said).toBe(sentence)
		expect(out.people).toBe(sentence)
	})

	it("row 17: a convert-ruleset refusal is a returned halt carrying its sentence", async () => {
		const owner = await user("owner")
		const s = await session(owner)
		const out = await commitHalt(await hostFor(s.id, owner), "core:outlet/convert-ruleset", { to: "2.0.0" })
		expect(out.said).toMatch(/^This session has not pinned a version of its rules yet/)
		expect(out.people).toBe(out.said)
	})

	it("row 15: an undated clock move is for people; a missing session is not", async () => {
		const owner = await user("owner")
		const [book] = await db
			.insert(schema.lorebooks)
			.values({ userId: owner, name: `Clockless ${++n}`, timelineEnabled: true })
			.returning()
		const s = await session(owner, { lorebookId: book!.id })
		const { UNDATED_MOVE_SENTENCE, advanceSessionStoryClock } = await import("$lib/server/state/storyTime")
		const out = await commitHalt(await hostFor(s.id, owner), "core:outlet/advance-story-clock", {
			by: 1,
			unit: "hours",
			cause: "action"
		})
		expect(out.said).toBe(`step: ${UNDATED_MOVE_SENTENCE}`)
		expect(out.people).toBe(UNDATED_MOVE_SENTENCE)

		const missing = await advanceSessionStoryClock(db as never, 987654, 1, "hours").catch((e) => e)
		expect(missing.message).toBe("There is no session 987654.")
		expect(peopleSentenceOf(missing)).toBeUndefined()
	})

	it("row 10: an undated lore write on a dated story, at all three sites", async () => {
		const { UNDATED_LORE_WRITE_SENTENCE } = await import("$lib/server/state/storyTime")
		const { ITEM_TYPE_ID, LOCATION_TYPE_ID } = await import("$lib/shared/entries/types")
		const owner = await user("owner")
		await db.insert(schema.userSettings).values({ userId: owner, loreWriteMode: "full" })
		const [book] = await db
			.insert(schema.lorebooks)
			.values({ userId: owner, name: `World ${++n}`, timelineEnabled: true })
			.returning()
		const s = await session(owner, {
			lorebookId: book!.id,
			storyClockYear: 10,
			storyClockMonth: 2,
			storyClockDay: 5
		})
		const [vault] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: book!.id,
				typeId: LOCATION_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: "The Vault",
				content: "The Vault, as written.",
				fields: { category: "Rooms" }
			})
			.returning()
		await message(s.id)
		// An attached entry's in-place change, and a new dated entry.
		for (const [definitionId, payload] of [
			["core:outlet/update-lore-entry", { entry: vault!.id, content: "Sealed." }],
			["core:outlet/create-lore-entry", { name: "A key", content: "A key.", params: { entryType: ITEM_TYPE_ID } }]
		] as const) {
			const out = await commitHalt(await hostFor(s.id, owner), definitionId, payload)
			expect(out.said).toBe(`step: ${UNDATED_LORE_WRITE_SENTENCE}`)
			expect(out.people).toBe(UNDATED_LORE_WRITE_SENTENCE)
		}
	})

	it("the genre-shape guards: lore, seats and library refusals are for people; the plugin guard is not", async () => {
		const owner = await user("owner")
		const { loreWriteRefusal, seatWriteRefusal, libraryWriteRefusal, PLUGIN_LIBRARY_REFUSAL } = await import(
			"$lib/server/messages/writes"
		)
		const reference = await session(owner, { genreId: "test:genre/reference" })
		await message(reference.id)

		const lore = (await loreWriteRefusal(db as never, reference.id))!
		const noLore = await commitHalt(await hostFor(reference.id, owner), "core:outlet/update-lore-entry", {
			entry: 1,
			content: "x"
		})
		expect(noLore.said).toBe(`step: ${lore}`)
		expect(noLore.people).toBe(lore)

		const seats = (await seatWriteRefusal(db as never, reference.id))!
		const noSeats = await commitHalt(await hostFor(reference.id, owner), "core:outlet/set-seat-bench", {
			seat: "character:1",
			benched: true
		})
		expect(noSeats.said).toBe(seats)
		expect(noSeats.people).toBe(seats)

		const library = (await libraryWriteRefusal(db as never, reference.id, "characters"))!
		const noLibrary = await commitHalt(await hostFor(reference.id, owner), "core:outlet/create-character", {
			card: { name: "Zed" }
		})
		expect(noLibrary.said).toBe(`step: ${library}`)
		expect(noLibrary.people).toBe(library)

		// Unmarked sibling: a plugin's run is refused before the genre is asked.
		const plugin = await commitHalt(
			await hostFor(reference.id, owner, { ownerPluginId: "some-plugin" }),
			"core:outlet/create-character",
			{ card: { name: "Zed" } }
		)
		expect(plugin.said).toBe(`step: ${PLUGIN_LIBRARY_REFUSAL}`)
		expect(plugin.people).toBeUndefined()
	})

	it("row 36: a library write's permission reason is for people; other library refusals are not", async () => {
		const owner = await user("owner")
		const other = await user("other")
		const [card] = await db
			.insert(schema.characters)
			.values({ userId: other, name: "Cass", description: "" })
			.returning()
		const s = await session(owner, { genreId: "test:genre/library" })
		const may = await commitHalt(await hostFor(s.id, owner), "core:outlet/update-character", {
			characterId: card!.id,
			changes: { description: "Changed." }
		})
		expect(may.said.startsWith("step: ")).toBe(true)
		expect(may.people).toBe(may.said.slice("step: ".length))
		const names = await commitHalt(await hostFor(s.id, owner), "core:outlet/update-character", {
			characterId: "not a number",
			changes: { description: "Changed." }
		})
		expect(names.said).toBe("step: That names no character.")
		expect(names.people).toBeUndefined()
	})

	it("rows 30, 31: only the ownership sentences of the picture outlets are for people", async () => {
		const owner = await user("owner")
		const other = await user("other")
		const [card] = await db
			.insert(schema.characters)
			.values({ userId: other, name: "Cass", description: "" })
			.returning()
		const s = await session(owner)
		for (const [definitionId, sentence] of [
			["core:outlet/offer-media", "only the card's owner or an admin can add pictures to its gallery."],
			["core:outlet/attach-sprite", "only the card's owner or an admin can add sprites to it."]
		] as const) {
			const out = await commitHalt(await hostFor(s.id, owner), definitionId, {
				characterId: card!.id,
				media: []
			})
			expect(out.said).toBe(`step: refused — ${sentence}`)
			expect(out.people).toBe(sentence)
		}
	})

	it("row 32: a backdrop picture that is neither the session's nor the person's is for people", async () => {
		const owner = await user("owner")
		const other = await user("other")
		const s = await session(owner)
		const [file] = await db
			.insert(schema.files)
			.values({ userId: other, kind: "image", name: "x.png", mimeType: "image/png", path: "x.png", hash: `hash-${++n}` } as never)
			.returning()
		const sentence = "That picture belongs to neither this session nor you, so it cannot be its backdrop."
		const out = await commitHalt(await hostFor(s.id, owner), "core:outlet/set-backdrop", {
			media: [{ uuid: (file as { uuid: string }).uuid, kind: "image" }]
		})
		expect(out.said).toBe(`step: refused — ${sentence}`)
		expect(out.people).toBe(sentence)
	})
})

describe("class refusals: the constructor flag marks only the people sites", () => {
	it("rows 8, 15, 30–32, 36: the flag marks, its absence does not", async () => {
		const { SeatNameRefusal } = await import("$lib/server/sessions/seatName")
		const { StoryClockRefusal } = await import("$lib/server/state/storyTime")
		const { OfferMediaRefusal } = await import("$lib/server/characters/portrait")
		const { AttachSpriteRefusal } = await import("$lib/server/sprites/attach")
		const { BackdropRefusal } = await import("$lib/server/sessions/backdrop")
		const { LibraryWriteRefusal } = await import("$lib/server/library/writes")
		for (const Cls of [
			SeatNameRefusal,
			StoryClockRefusal,
			OfferMediaRefusal,
			AttachSpriteRefusal,
			BackdropRefusal,
			LibraryWriteRefusal
		]) {
			const marked = new Cls("words", { forPeople: true })
			expect(marked.message).toBe("words")
			expect(peopleSentenceOf(marked)).toBe("words")
			expect(peopleSentenceOf(new Cls("words"))).toBeUndefined()
			expect(peopleSentenceOf(new Cls("words", { forPeople: false }))).toBeUndefined()
		}
	})

	it("row 8: the seat-name raise sites mark; the wrap of any other error does not", async () => {
		const owner = await user("owner")
		const s = await session(owner)
		const { writeSeatName, seatNamed, SeatNameRefusal } = await import("$lib/server/sessions/seatName")
		const named = await writeSeatName(db as never, {
			sessionId: s.id,
			userId: owner,
			isOwner: true,
			name: null,
			retireSeatId: 1
		}).catch((e: unknown) => e)
		expect((named as Error).message).toBe("A new character needs a name.")
		expect(peopleSentenceOf(named)).toBe("A new character needs a name.")

		const wrapped = await seatNamed(db as never, 987654, owner, "Nobody", 0).catch((e: unknown) => e)
		expect(wrapped).toBeInstanceOf(SeatNameRefusal)
		expect(peopleSentenceOf(wrapped)).toBeUndefined()
	})

	it("row 17: the convert-ruleset raise sites mark a StateRefusal", async () => {
		const owner = await user("owner")
		const s = await session(owner)
		const { convertSessionRuleset } = await import("$lib/server/sessions/convertRuleset")
		const err = await convertSessionRuleset(db as never, { sessionId: s.id, userId: owner, to: "2.0.0" } as never).catch(
			(e: unknown) => e
		)
		expect((err as Error).message).toMatch(/has not pinned a version/)
		expect(peopleSentenceOf(err)).toBe((err as Error).message)
	})
})

describe("rows 12, 13: lore-write sentences", () => {
	it("row 13: a link that stands ended is refused for people", async () => {
		const owner = await user("owner")
		await db.insert(schema.userSettings).values({ userId: owner, loreWriteMode: "full" })
		const [book] = await db.insert(schema.lorebooks).values({ name: `Ended ${++n}`, userId: owner }).returning()
		const s = await session(owner, { lorebookId: book!.id })
		const entries = []
		for (const [position, name] of [[1, "Hall"], [2, "Cellar"]] as const)
			entries.push(
				(
					await db
						.insert(schema.lorebookEntries)
						.values(
							entryInsert({
								typeId: WORLD_LORE_TYPE_ID,
								lorebookId: book!.id,
								name,
								content: name,
								position
							} as never)
						)
						.returning({ id: schema.lorebookEntries.id })
				)[0]!
			)
		await db.insert(schema.narrativeRelationships).values({
			lorebookId: book!.id,
			fromEntryId: entries[0]!.id,
			toEntryId: entries[1]!.id,
			relationshipType: "leads to",
			status: "ended"
		} as never)
		const out = await commitHalt(await hostFor(s.id, owner), "core:outlet/link-lore-entries", {
			from: entries[0]!.id,
			to: entries[1]!.id
		})
		expect(out.said).toMatch(/^step: .* That link is ended, and a pipeline never reopens a link\.$/)
		expect(out.people).toBe(out.said.slice("step: ".length))
	})

	it("row 12: a name that picks two entries is refused for people", async () => {
		const owner = await user("owner")
		await db.insert(schema.userSettings).values({ userId: owner, loreWriteMode: "full" })
		const [book] = await db.insert(schema.lorebooks).values({ name: `Twins ${++n}`, userId: owner }).returning()
		const s = await session(owner, { lorebookId: book!.id })
		for (const position of [1, 2])
			await db.insert(schema.lorebookEntries).values(
				entryInsert({
					typeId: WORLD_LORE_TYPE_ID,
					lorebookId: book!.id,
					name: "The Twin",
					content: "One of two.",
					position
				} as never)
			)
		await db.insert(schema.lorebookEntries).values(
			entryInsert({
				typeId: WORLD_LORE_TYPE_ID,
				lorebookId: book!.id,
				name: "Other",
				content: "Another.",
				position: 3
			} as never)
		)
		const out = await commitHalt(await hostFor(s.id, owner), "core:outlet/link-lore-entries", {
			from: "The Twin",
			to: "Other"
		})
		expect(out.said).toMatch(/is the name of more than one entry in this session's lorebook/)
		expect(out.people).toBe(out.said.replace(/^[^“]*/, ""))
	})
})

describe("row 33: the binding road", () => {
	it("read-answer with no form notes its halt for people under its run; the words are unchanged", async () => {
		const { coreBindings } = await import("$lib/server/pipelines/runtime/bindings")
		const runId = `rows-binding-${++n}`
		const readAnswer = coreBindings({ runId })["core:task/read-answer@1"]!
		const ctx = { random: () => 0, signal: new AbortController().signal, progress: () => {}, log: () => {} } as never
		const out = (await readAnswer({ payload: {} } as never, ctx)) as { halt?: string; ok?: boolean }
		const sentence =
			"nothing to answer — this action was fired with no form; it answers a question a message put to you"
		expect(JSON.stringify(out)).toContain(sentence)
		expect(takePeopleSentence(runId, sentence)).toBe(sentence)
	})
})
