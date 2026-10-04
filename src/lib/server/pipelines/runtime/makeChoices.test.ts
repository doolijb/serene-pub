/**
 * `core:task/make-choices@1` — an oracle's `{ addressee, question, options }`
 * as a `choices` block (plans/30 U5d; review W8, 2026-09-17).
 *
 * The addressee the model wrote is believed only when it names somebody in
 * THIS session: a name resolves against the cast and the members' presences
 * (a persona is a character row, 2026-09-17); a participant reference is
 * accepted only when it names a **seated** cast member, a live presence or
 * an envoy. `character:99` from a model, where 99 is nobody here — another
 * session's character, a deleted row, a guess — leaves the block
 * unaddressed rather than addressed to someone the resolver would call
 * nobody's. A role (`owner`) or a user is never a cast member and never a
 * form's addressee by the model's say-so. The `addressee` port, wired,
 * still wins.
 */
import { describe, expect, it } from "vitest"
import { coreBindings } from "./bindings"

const bindings = coreBindings()
const makeChoices = bindings["core:task/make-choices@1"]!

const ctx = {
	random: () => 0,
	signal: new AbortController().signal,
	progress: () => {},
	log: () => {}
} as any

const CAST = {
	sessionCharacters: [
		{ character: { id: 12, name: "Tom", nickname: "Tommy" } },
		{ character: { id: 13, name: "Verity" } },
		// Departed: no longer in the cast.
		{ character: { id: 14, name: "Alder" }, removedAt: "2026-09-17T00:00:00.000Z" }
	],
	sessionPersonas: [
		{ persona: { id: 7, name: "Jody", nickname: "Rook" } },
		// Departed: no longer anyone's presence here.
		{ persona: { id: 8, name: "Wren" }, removedAt: "2026-09-17T00:00:00.000Z" }
	],
	envoys: [{ slug: "mascot", name: { en: "The Mascot" } }]
}

const doc = (addressee: string) => ({
	addressee,
	question: "Will you come to the festival?",
	options: [
		{ key: "yes", label: "Yes" },
		{ key: "no", label: "No" }
	]
})

async function blockFor(addressee: string, over: Record<string, unknown> = {}) {
	const r = await makeChoices(
		{ json: doc(addressee), fn: "answer", cast: CAST, ...over } as any,
		ctx
	)
	expect(r.kind).toBe("ok")
	return (r as any).value
}

describe("make-choices: who the addressee names", () => {
	it("a cast member's name or nickname, case-insensitively", async () => {
		expect((await blockFor("tom")).addressee).toBe("character:12")
		expect((await blockFor("TOMMY")).addressee).toBe("character:12")
		expect((await blockFor("Verity")).addressee).toBe("character:13")
	})

	it("a member's presence by name or nickname — the player's persona is addressable", async () => {
		expect((await blockFor("Jody")).addressee).toBe("character:7")
		expect((await blockFor("rook")).addressee).toBe("character:7")
	})

	it("a departed participant of either kind is nobody: unaddressed, by name and by reference", async () => {
		// Owner-only for a block put to someone nobody portrays; open to the
		// action's audience for one put to nobody — so a departed seat must
		// resolve to nobody on both roads, the cast's as the presence's.
		expect((await blockFor("Alder")).addressee).toBeNull()
		expect((await blockFor("character:14")).addressee).toBeNull()
		expect((await blockFor("Wren")).addressee).toBeNull()
		expect((await blockFor("character:8")).addressee).toBeNull()
	})

	it("a name both a cast member and a presence bear goes to the cast", async () => {
		const cast = {
			...CAST,
			sessionCharacters: [...CAST.sessionCharacters, { character: { id: 15, name: "Rook" } }]
		}
		expect((await blockFor("rook", { cast })).addressee).toBe("character:15")
	})

	it("an envoy's slug or name", async () => {
		expect((await blockFor("mascot")).addressee).toBe("envoy:mascot")
		expect((await blockFor("the mascot")).addressee).toBe("envoy:mascot")
	})

	it("a participant reference only when it names a seated cast member or envoy (W8)", async () => {
		expect((await blockFor("character:12")).addressee).toBe("character:12")
		expect((await blockFor("envoy:mascot")).addressee).toBe("envoy:mascot")
		// Nobody here: unaddressed, not addressed to a stranger.
		expect((await blockFor("character:999")).addressee).toBeNull()
		expect((await blockFor("envoy:nobody")).addressee).toBeNull()
		// A live presence is addressable by reference like a cast member.
		expect((await blockFor("character:7")).addressee).toBe("character:7")
		// A role or a user is not a cast member at all.
		expect((await blockFor("owner")).addressee).toBeNull()
		expect((await blockFor("user:3")).addressee).toBeNull()
	})

	it("a name nobody bears leaves the block unaddressed, and the block is still a question", async () => {
		const out = await blockFor("Nobody")
		expect(out.addressee).toBeNull()
		expect(out.blocks).toHaveLength(1)
		expect(out.blocks[0]).toMatchObject({ kind: "choices", question: "Will you come to the festival?" })
		expect("addressee" in out.blocks[0]).toBe(false)
	})

	it("the addressee port, wired, wins over the document's", async () => {
		const out = await blockFor("Nobody", { addressee: "character:13" })
		expect(out.addressee).toBe("character:13")
		expect(out.blocks[0].addressee).toBe("character:13")
	})

	it("the options fire the function, keyed and labelled, with the named identity when one is wired", async () => {
		const out = await blockFor("Tom", { action: "core:spec/adventure-answer#answer" })
		expect(out.blocks[0].actions).toEqual([
			{ fn: "answer", action: "core:spec/adventure-answer#answer", label: "Yes", choice: "yes" },
			{ fn: "answer", action: "core:spec/adventure-answer#answer", label: "No", choice: "no" }
		])
	})
})

/**
 * Where a question was asked from (plan A27, 2026-09-30): the Lair's knock
 * stamps the room its planner said the party stood in, and *Answer the door*
 * reads it back through `read-answer@1` to link the new room when the world's
 * location names nowhere.
 */
describe("make-choices / read-answer: the vantage", () => {
	it("a non-blank vantage is stamped on the block, trimmed; anything else writes none", async () => {
		expect((await blockFor("Tom", { vantage: "  The Stair " })).blocks[0].vantage).toBe(
			"The Stair"
		)
		for (const vantage of [undefined, "", "   ", null, { entryId: 2 }, 7])
			expect(
				(await blockFor("Tom", { vantage })).blocks[0],
				JSON.stringify(vantage)
			).not.toHaveProperty("vantage")
	})

	it("read-answer hands the form's vantage back, null when it named nowhere", async () => {
		const readAnswer = bindings["core:task/read-answer@1"]!
		const form = { blockId: "b1", question: "Is there a room?", addressee: "owner" }
		const at = (await readAnswer({ form: { ...form, vantage: "The Stair" }, payload: {} } as any, ctx)) as any
		expect(at.value.vantage).toBe("The Stair")
		const none = (await readAnswer({ form, payload: {} } as any, ctx)) as any
		expect(none.value.vantage).toBeNull()
	})
})
