import { describe, it, expect } from "vitest"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import {
	describesAsAuthor,
	keyTerms,
	undescribedAnswer
} from "$lib/server/pipelines/runtime/undescribedName"

/**
 * `core:task/undescribed-name@1` (lair pass R7, 2026-09-28): is a room name
 * already described — by an entry, or by recent prose — and where.
 *
 * Each branch of the brief, in its order (the first hit wins), plus the edges
 * that decide a knock: a delver-only mention, a paragraph too short to be a
 * description, a row outside the window, a channel not named, a hidden row.
 * The name rule itself (articles, punctuation, NFKC) is the SDK's and is
 * pinned in `serene-pub-sdk/sdk-tests/names.test.ts`; the cases here that
 * touch it prove the binding goes through it for names AND keys.
 */

const task = (input: any) =>
	coreBindings()["core:task/undescribed-name@1"]!(input, {} as any) as any

/** Fourteen words besides "the Sunken Vault": a description at the default 12. */
const DESCRIBED =
	"Water to the knee fills the Sunken Vault, and green light drips from cracked stone above."
/** Ten words besides the name: a mention at the default 12. */
const MENTIONED = "The party can see the Sunken Vault from the old broken stair."

const row = (id: number, over: Record<string, unknown> = {}) => ({
	id,
	role: "assistant",
	content: "",
	characterId: null,
	personaId: null,
	channel: "main",
	...over
})

const ROOMS = [
	{ id: 1, name: "The Old Well", keys: [] },
	{ id: 2, name: "The Stair", keys: ["stairway, steps"] }
]

describe("undescribed-name: the entry lookup", () => {
	it("an entry whose name normalises equal describes it", () => {
		expect(undescribedAnswer({ name: '"the stair."', locationEntries: ROOMS })).toEqual({
			undescribed: "",
			describedBy: "entry",
			entryId: 2,
			passage: ""
		})
	})

	it("a key term, comma-split out of a stored list item, describes it", () => {
		const a = undescribedAnswer({ name: "The Steps", locationEntries: ROOMS })
		expect(a.describedBy).toBe("entry")
		expect(a.entryId).toBe(2)
	})

	it("keys stored as a comma string split the same way", () => {
		expect(keyTerms("vault, the Deep Vault ,, ")).toEqual(["vault", "the Deep Vault"])
		expect(keyTerms(["a,b", "c"])).toEqual(["a", "b", "c"])
		expect(keyTerms(undefined)).toEqual([])
	})

	it("any entry type counts, on `entries`, when no location entry answers", () => {
		const book = [{ id: 9, name: "Brask's Journal", keys: "sunken vault" }]
		const a = undescribedAnswer({ name: "The Sunken Vault", locationEntries: ROOMS, entries: book })
		expect(a).toMatchObject({ describedBy: "entry", entryId: 9, undescribed: "" })
	})

	it("location entries are checked first", () => {
		const book = [{ id: 9, name: "The Stair" }]
		expect(
			undescribedAnswer({ name: "the stair", locationEntries: ROOMS, entries: book }).entryId
		).toBe(2)
	})

	it("whole equality, never a substring", () => {
		const a = undescribedAnswer({ name: "The Stair Down", locationEntries: ROOMS })
		expect(a.describedBy).toBe("")
		expect(a.undescribed).toBe("The Stair Down")
	})

	it("an entry beats prose that also describes it", () => {
		const a = undescribedAnswer({
			name: "The Stair",
			locationEntries: ROOMS,
			messages: [row(1, { role: "user", content: `The Stair ${DESCRIBED}` })]
		})
		expect(a.describedBy).toBe("entry")
	})
})

describe("undescribed-name: the prose lookup", () => {
	it("a person's paragraph with >= 12 other words describes it; the passage is that paragraph", () => {
		const a = undescribedAnswer({
			name: "The Sunken Vault",
			locationEntries: ROOMS,
			messages: [row(1, { role: "user", content: `They go on.\n\n${DESCRIBED}\n\nThen quiet.` })]
		})
		expect(a).toEqual({
			undescribed: "",
			describedBy: "prose",
			entryId: null,
			passage: DESCRIBED
		})
	})

	it("an envoy's row counts (the Castellan)", () => {
		const a = undescribedAnswer({
			name: "Sunken Vault",
			messages: [row(1, { speaker: "envoy:castellan", content: DESCRIBED })]
		})
		expect(a.describedBy).toBe("prose")
	})

	it("a speakerless reply counts (a stored narrator row)", () => {
		const a = undescribedAnswer({
			name: "Sunken Vault",
			messages: [row(1, { isNarratorResponse: true, content: DESCRIBED })]
		})
		expect(a.describedBy).toBe("prose")
	})

	it("a delver-only mention never describes it, however long", () => {
		const a = undescribedAnswer({
			name: "Sunken Vault",
			messages: [
				row(1, { characterId: 11, content: DESCRIBED }),
				row(2, { speaker: "character:12", content: DESCRIBED })
			]
		})
		expect(a).toMatchObject({ describedBy: "", undescribed: "Sunken Vault" })
	})

	it("a 10-word paragraph is a mention, not a description", () => {
		const a = undescribedAnswer({
			name: "Sunken Vault",
			messages: [row(1, { role: "user", content: MENTIONED })]
		})
		expect(a.describedBy).toBe("")
		// …unless minWords is tuned down to it.
		const tuned = undescribedAnswer({
			name: "Sunken Vault",
			messages: [row(1, { role: "user", content: MENTIONED })],
			params: { minWords: 10 }
		})
		expect(tuned.passage).toBe(MENTIONED)
	})

	it("the newest qualifying row wins", () => {
		const older = `Long ago: ${DESCRIBED}`
		const a = undescribedAnswer({
			name: "Sunken Vault",
			messages: [
				row(1, { role: "user", content: older }),
				row(2, { role: "user", content: DESCRIBED }),
				row(3, { characterId: 11, content: `Brask says ${DESCRIBED}` })
			]
		})
		expect(a.passage).toBe(DESCRIBED)
	})

	it("only the newest `window` rows of the named channels are read (default 40)", () => {
		const filler = Array.from({ length: 40 }, (_, n) =>
			row(n + 2, { role: "user", content: "nothing here" })
		)
		const messages = [row(1, { role: "user", content: DESCRIBED }), ...filler]
		expect(undescribedAnswer({ name: "Sunken Vault", messages }).describedBy).toBe("")
		expect(
			undescribedAnswer({ name: "Sunken Vault", messages, params: { window: 41 } })
				.describedBy
		).toBe("prose")
	})

	it("the window counts rows on the named channels only", () => {
		const aside = Array.from({ length: 50 }, (_, n) =>
			row(n + 2, { role: "user", channel: "sanctum", content: "chatter" })
		)
		const messages = [row(1, { role: "user", content: DESCRIBED }), ...aside]
		expect(undescribedAnswer({ name: "Sunken Vault", messages }).describedBy).toBe("prose")
	})

	it("`channels` defaults to main; a side channel counts only when named", () => {
		const messages = [row(1, { role: "user", channel: "sanctum", content: DESCRIBED })]
		expect(undescribedAnswer({ name: "Sunken Vault", messages }).describedBy).toBe("")
		expect(
			undescribedAnswer({
				name: "Sunken Vault",
				messages,
				params: { channels: ["main", "sanctum"] }
			}).describedBy
		).toBe("prose")
	})

	it("a bare slug is every lane of it; `slug:n` is that lane only", () => {
		const messages = [row(1, { role: "user", channel: "sanctum:2", content: DESCRIBED })]
		const on = (channels: string[]) =>
			undescribedAnswer({ name: "Sunken Vault", messages, params: { channels } }).describedBy
		expect(on(["sanctum"])).toBe("prose")
		expect(on(["sanctum:2"])).toBe("prose")
		expect(on(["sanctum:3"])).toBe("")
	})

	it("a hidden row, and the composer's uncommitted draft, never describe", () => {
		const a = undescribedAnswer({
			name: "Sunken Vault",
			messages: [
				row(1, { role: "user", isHidden: true, content: DESCRIBED }),
				row(-1, { role: "user", content: DESCRIBED })
			]
		})
		expect(a.describedBy).toBe("")
	})

	it("rows from two reads (a list of lists) merge by id", () => {
		const a = undescribedAnswer({
			name: "Sunken Vault",
			messages: [
				[row(2, { characterId: 11, content: DESCRIBED })],
				[row(1, { role: "user", channel: "sanctum", content: DESCRIBED })]
			],
			params: { channels: ["main", "sanctum"] }
		})
		expect(a.describedBy).toBe("prose")
	})
})

describe("undescribed-name: undescribed, and no name", () => {
	it("nothing describes it: `undescribed` is the name, trimmed", () => {
		expect(
			undescribedAnswer({ name: "  The Drowned Hall ", locationEntries: ROOMS, messages: [] })
		).toEqual({ undescribed: "The Drowned Hall", describedBy: "", entryId: null, passage: "" })
	})

	it("anything but a string is no name, and nothing is undescribed", () => {
		for (const name of [undefined, null, 3, { n: 1 }, "   "])
			expect(undescribedAnswer({ name, locationEntries: ROOMS }).undescribed).toBe("")
	})
})

describe("describesAsAuthor", () => {
	it("a person, an envoy or a speakerless reply; never a character", () => {
		expect(describesAsAuthor({ role: "user" })).toBe(true)
		expect(describesAsAuthor({ role: "user", personaId: 4 } as any)).toBe(true)
		expect(describesAsAuthor({ role: "assistant", speaker: "envoy:castellan" })).toBe(true)
		expect(describesAsAuthor({ role: "assistant", characterId: null })).toBe(true)
		expect(describesAsAuthor({ role: "assistant", characterId: 11 })).toBe(false)
		expect(describesAsAuthor({ role: "assistant", speaker: "character:11" })).toBe(false)
	})
})

describe("the binding", () => {
	it("publishes main = undescribed and the four answer ports", async () => {
		const out = await task({ name: "The Drowned Hall", locationEntries: ROOMS, messages: [] })
		expect(out.kind).toBe("ok")
		expect(out.value).toEqual({
			main: "The Drowned Hall",
			undescribed: "The Drowned Hall",
			describedBy: "",
			entryId: null,
			passage: ""
		})
	})

	it("unlisted-name@1 is not bound (renamed, no alias)", () => {
		expect(coreBindings()["core:task/unlisted-name@1"]).toBeUndefined()
	})
})
