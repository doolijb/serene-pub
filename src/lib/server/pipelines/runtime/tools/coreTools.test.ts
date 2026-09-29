import { describe, it, expect } from "vitest"
import {
	getEntry,
	grepTranscript,
	readSummary,
	searchEntries
} from "$lib/server/pipelines/runtime/tools/coreTools"
import { ToolError } from "$lib/server/pipelines/runtime/tools"

/**
 * The four tools an install has with no extensions.
 *
 * Read through a stand-in `ctx.read`, which is what the host hands them — so
 * what is under test is the tool's own judgement (what it searches, what it
 * returns, when it narrows) rather than the queries, which are the host's and
 * are tested where they live.
 */

const ENTRIES = [
	{
		id: 1,
		source: "worldLore",
		name: "The Ashguard",
		keys: "ashguard",
		content: "Riders who patrol the ash wastes under Captain Vell."
	},
	{
		id: 2,
		source: "characterLore",
		name: "Vell's oath",
		keys: "vell",
		content: "She swore never to ride south of the Rill."
	},
	{
		id: 3,
		source: "history",
		name: "The long winter",
		keys: "",
		content: "Snow closed the passes for a year."
	}
]

const ctxWith = (messages: any[] = [], scenes: any[] = []) => ({
	sessionId: 1,
	currentCharacterId: null,
	async read(table: string) {
		if (table === "lorebook_entries") return ENTRIES
		if (table === "session_messages") return messages
		if (table === "graph_scenes") return scenes
		return []
	}
})

const line = (id: number, content: string, sender = "Ash") => ({
	id,
	content,
	senderName: sender
})

describe("search_entries", () => {
	it("matches title, keys and text, and returns an excerpt rather than the entry", async () => {
		const r: any = await searchEntries.run(
			{ query: "captain vell" },
			ctxWith() as any
		)
		expect(r.found).toBe(1)
		expect(r.entries[0].id).toBe(1)
		expect(r.entries[0].excerpt).toContain("Captain Vell")
		// The id is what get_entry takes — a search that returned everything in
		// full would spend the next prompt's budget narrowing one question.
		expect(r.entries[0].content).toBeUndefined()
	})

	it("asks the host for live entries only — Off and archived are never offered (finding #149)", async () => {
		// A stand-in host that honours the listing posture the way the real
		// read does (`lorebookListing.int.test.ts` pins that half).
		const book = [
			...ENTRIES,
			{ id: 4, source: "worldLore", name: "The Old Mill", keys: ["mill"], content: "Burned.", enabled: false },
			{ id: 5, source: "worldLore", name: "The Drowned Quarter", keys: [], content: "Cut.", archived: true }
		]
		const asked: any[] = []
		const ctx = {
			sessionId: 1,
			currentCharacterId: null,
			async read(table: string, query: any) {
				asked.push({ table, query })
				if (table !== "lorebook_entries") return []
				return book.filter(
					(e: any) =>
						(query.enabled !== true || e.enabled !== false) &&
						(query.archived !== false || e.archived !== true)
				)
			}
		}
		expect(asked).toEqual([])
		const found: any = await searchEntries.run({ query: "the" }, ctx as any)
		expect(found.entries.map((e: any) => e.id)).not.toContain(4)
		expect(found.entries.map((e: any) => e.id)).not.toContain(5)
		expect(asked[0].query).toMatchObject({ enabled: true, archived: false })
		await expect(getEntry.run({ id: 4 }, ctx as any)).rejects.toBeInstanceOf(ToolError)
		await expect(getEntry.run({ id: 5 }, ctx as any)).rejects.toBeInstanceOf(ToolError)
	})

	it("reads a key list as one line of keys", async () => {
		const ctx = {
			sessionId: 1,
			currentCharacterId: null,
			async read(table: string) {
				return table === "lorebook_entries"
					? [{ id: 9, source: "worldLore", name: "Echo", keys: ["(ab){1,2}c", "Smith, John"], content: "x" }]
					: []
			}
		}
		const r: any = await searchEntries.run({ query: "smith, john" }, ctx as any)
		expect(r.found).toBe(1)
	})

	it("no query is a refusal the model can act on", async () => {
		await expect(
			searchEntries.run({}, ctxWith() as any)
		).rejects.toBeInstanceOf(ToolError)
	})
})

describe("get_entry", () => {
	it("reads one entry in full", async () => {
		const r: any = await getEntry.run({ id: 2 }, ctxWith() as any)
		expect(r.content).toContain("south of the Rill")
	})

	it("an id outside this session's lorebook is refused, not fetched", async () => {
		// The scoping rule falls out of reading the session's own entries: there
		// is no second query for a stray id to reach.
		await expect(
			getEntry.run({ id: 4040 }, ctxWith() as any)
		).rejects.toThrow(/no entry 4040/)
	})
})

describe("grep_transcript", () => {
	it("counts hits per message and shows the text around the first", async () => {
		const r: any = await grepTranscript.run(
			{ text: "ashguard" },
			ctxWith([
				line(1, "The ashguard rode past. The ashguard always ride."),
				line(2, "Nothing to see."),
				line(3, "Ashguard again?")
			]) as any
		)
		expect(r.found).toBe(2)
		expect(r.totalHits).toBe(3)
		// Newest first: "when did we last talk about this" is the question.
		expect(r.messages[0].messageId).toBe(3)
		expect(r.messages[1].hits).toBe(2)
		expect(r.messages[1].excerpt).toContain("rode past")
		expect(r.narrowed).toBeUndefined()
	})

	it("narrows itself to whole words when the phrase is everywhere, and says so", async () => {
		const messages = [
			line(1, "The ash is everywhere."),
			line(2, "Ashen skies."),
			line(3, "Ashguard riders."),
			line(4, "An ash tree stands alone.")
		]
		const r: any = await grepTranscript.run(
			{ text: "ash" },
			ctxWith(messages) as any
		)
		expect(r.narrowed).toMatch(/whole-word/)
		// Only the two where `ash` stands as a word of its own.
		expect(r.messages.map((m: any) => m.messageId).sort()).toEqual([1, 4])
	})

	it("does not narrow to nothing — a noisy answer beats a wrong one", async () => {
		// Every message matches, and none of them as a whole word: narrowing
		// would report "never said" about something said constantly.
		const messages = [
			line(1, "Ashen."),
			line(2, "Ashguard."),
			line(3, "Ashes.")
		]
		const r: any = await grepTranscript.run(
			{ text: "ash" },
			ctxWith(messages) as any
		)
		expect(r.narrowed).toBeUndefined()
		expect(r.found).toBe(3)
	})
})

describe("read_summary", () => {
	it("reads the session's summarised scenes", async () => {
		const r: any = await readSummary.run(
			{ kind: "scene" },
			ctxWith(
				[],
				[
					{
						id: 1,
						name: "The ride out",
						summary: "They left at dawn."
					},
					{ id: 2, name: "Unsummarised", summary: null }
				]
			) as any
		)
		expect(r.found).toBe(1)
		expect(r.summaries[0].summary).toBe("They left at dawn.")
	})

	it("reads standing lore by band, and refuses a band it does not have", async () => {
		const world: any = await readSummary.run(
			{ kind: "world" },
			ctxWith() as any
		)
		expect(world.summaries.map((s: any) => s.id)).toEqual([1])

		await expect(
			readSummary.run({ kind: "vibes" }, ctxWith() as any)
		).rejects.toThrow(/vibes/)
	})
})
