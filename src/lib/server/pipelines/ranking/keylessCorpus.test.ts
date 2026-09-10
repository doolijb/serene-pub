/**
 * The keyless-book acceptance corpus.
 *
 * ## What this is, and why it is not a parity fixture
 *
 * The parity corpus measures 0.6 against legacy 0.5, and **it cannot validate
 * this change**: opening the admission gate admits entries 0.5 would not have,
 * so a byte-identical result would mean the feature did nothing. Past this
 * point parity is a regression alarm for the legacy path, not the quality gate
 * (design §10) — and what replaces it for §4 is this: *books with their keys
 * stripped must retrieve sensibly.* It is a new fixture class; nothing before
 * it covered the case at all.
 *
 * A fixture here is a whole small world — six or seven entries with **no keys
 * whatsoever**, a conversation that never names most of them, and a stated
 * expectation of what should reach the prompt and what should not. The
 * assertions are on the admitted *set*, because that is what the gate decides;
 * ordering is `select`'s and has its own tests.
 *
 * ## The four properties, and where each is asserted
 *
 * 1. *A keyless book works out of the box* — `the vocabulary mismatch` below,
 *    which is the design document's own example: an entry about the Ashguard,
 *    in a conversation that says "them" and "the wastes" and never once says
 *    "Ashguard".
 * 2. *The zero-cost path stays viable* — `no embedding model` runs the whole
 *    corpus with vector search unavailable, which is also how every other case
 *    here runs.
 * 3. *Determinism remains available* — `keys still guarantee` and
 *    `constant still bypasses`.
 * 4. *`admitThreshold` is a declared parameter* — its being read from a stored
 *    row is `loreAdmitThreshold.int.test.ts`'s subject, not this file's; here
 *    it is only ever passed in, and `the gate is off by default` is what holds
 *    the default where the parity corpus needs it.
 */

import { describe, it, expect } from "vitest"
import {
	keywordQuery,
	type LoreRow
} from "$lib/server/pipelines/ranking/keywordQuery"
import { DEFAULT_RETRIEVAL } from "$lib/server/pipelines/ranking/weights"

/** The value the control's own description recommends for "on". */
const ON = 0.3

interface Book {
	name: string
	entries: Array<{
		id: number
		name: string
		content: string
		source?: LoreRow["source"]
		bindingCharacterId?: number | null
	}>
	messages: Array<{
		id: number
		content: string
		characterId?: number | null
	}>
	cast?: Array<{ name: string; ref: { kind: "character"; id: number } }>
	/** Entry ids that must reach the prompt with the gate on. */
	wanted: number[]
	/** Entry ids that must not, at any threshold worth shipping. */
	unwanted: number[]
	/**
	 * Of `wanted`, the ids **nothing but evidence** can bring in.
	 *
	 * The distinction is the corpus's sharpest assertion, and it exists because
	 * the first draft of this file did not have it. `nameMatch` already admits
	 * an entry whose own title appears in the conversation, keys or no keys —
	 * so "Emberfall" was never the interesting case, and a fixture whose whole
	 * `wanted` set was admitted by name would have passed with the feature
	 * removed. These are the ones that fail without it.
	 */
	onlyEvidence: number[]
}

const scan = (book: Book, over: Record<string, unknown> = {}) =>
	keywordQuery({
		// ⚠ Every entry, with `keys: ""`. That is the whole point of the
		// corpus: today `keywordSignal` returns 0 for an entry with no keys and
		// the admission gate then drops it, so before this change every
		// assertion below about `wanted` was unsatisfiable by construction.
		entries: book.entries.map((e) => ({
			source: "worldLore" as const,
			keys: "",
			...e
		})),
		messages: book.messages,
		entityRefs: book.cast ?? [],
		retrieval: { ...DEFAULT_RETRIEVAL, admitThreshold: ON, ...over },
		// No embedding model anywhere in this file. Nothing here may become
		// dependent on one (design §11).
		countTokens: (text) => Math.ceil(text.length / 4)
	})

const admitted = (book: Book, over: Record<string, unknown> = {}) =>
	scan(book, over)
		.candidates.map((c) => c.id as number)
		.sort((a, b) => a - b)

/**
 * The design document's own example, built as a world.
 *
 * The conversation is *about* the Ashguard for eight messages and never names
 * them — "them", "the wastes", "we do". It names Emberfall once and Commander
 * Vell twice, which is what a real scene does, and the entry about the order
 * mentions both. That is the mechanism: an entry earns admission by naming what
 * the conversation is naming, which is the thing an author was previously
 * required to anticipate one key at a time.
 */
const emberfall: Book = {
	name: "the vocabulary mismatch",
	cast: [{ name: "Alice", ref: { kind: "character", id: 7 } }],
	entries: [
		{
			id: 1,
			name: "The Ashguard",
			content:
				"An order of oathbound riders who patrol the ash wastes beyond Emberfall. They answer to Commander Vell and take no coin from the city."
		},
		{
			id: 2,
			name: "Emberfall",
			content:
				"A walled city built on the slope of a dormant volcano. Its foundries never cool, and its smoke can be seen for three days' ride."
		},
		{
			id: 3,
			name: "Commander Vell",
			content:
				"The Ashguard's commander. She never removes her helm in daylight and has not spoken her given name in twenty years."
		},
		{
			id: 4,
			name: "The Saltmarsh Road",
			content:
				"The old trade route south, abandoned since the bridge at Tarn collapsed. Smugglers still use the mudflats at low tide."
		},
		{
			id: 5,
			name: "Guild of Pewterers",
			content:
				"A minor craft guild in the lower quarter, chiefly known for a long feud with the glassblowers over water rights."
		},
		{
			id: 6,
			name: "Feast of Lanterns",
			content:
				"A midwinter festival. Households hang paper lanterns and the watch looks the other way for one night."
		}
	],
	messages: [
		{ id: 1, content: "How long have you ridden with them?" },
		{
			id: 2,
			content:
				"Since I was sixteen. My mother put me on a horse and pointed me at the wastes.",
			characterId: 7
		},
		{ id: 3, content: "And you never went back to the city?" },
		{
			id: 4,
			content:
				"Emberfall is not a place you go back to. The foundries make sure of that.",
			characterId: 7
		},
		{ id: 5, content: "What about your commander? Vell, is it?" },
		{
			id: 6,
			content: "Commander Vell does not take questions from strangers.",
			characterId: 7
		},
		{
			id: 7,
			content: "Fair enough. I only wondered who keeps the wastes."
		},
		{
			id: 8,
			content: "We do. Oathbound, unpaid, and out of the city's reach.",
			characterId: 7
		}
	],
	wanted: [1, 2, 3],
	// ⚠ The headline. Entries 2 and 3 are named outright in the conversation,
	// so `nameMatch` admits them today and 0.5 admitted them too. Entry 1 is
	// the design document's own example: eight messages about the Ashguard
	// that never say "Ashguard", and no key to bridge the gap. It reaches the
	// prompt because it names Emberfall and Commander Vell, which the
	// conversation does.
	onlyEvidence: [1],
	unwanted: [4, 5, 6]
}

/**
 * A book with nothing to do with the conversation.
 *
 * The corpus's own control. A gate that admits on relevance has to be capable
 * of admitting nothing, or "it works" only means "it lets everything in" — and
 * an admission rule that never says no would have passed every other case in
 * this file.
 */
const wrongScene: Book = {
	name: "nothing relevant",
	entries: emberfall.entries,
	messages: [
		{ id: 1, content: "Do you want the window open or shut?" },
		{ id: 2, content: "Shut. The draught gets under the door as it is." },
		{ id: 3, content: "I will find a rag for it, then." },
		{ id: 4, content: "There is one in the drawer by the basin." },
		{ id: 5, content: "That drawer sticks." },
		{ id: 6, content: "Lift it as you pull. It has always stuck." }
	],
	wanted: [],
	onlyEvidence: [],
	unwanted: [1, 2, 3, 4, 5, 6]
}

/**
 * No proper nouns anywhere, on either side.
 *
 * The entity tier can contribute nothing here, so this is the vocabulary term
 * on its own — and it is the case a gazetteer alone would fail. The scene is
 * about a debt, in a book where exactly one entry is.
 */
const lowercaseOnly: Book = {
	name: "vocabulary alone",
	entries: [
		{
			id: 1,
			name: "moneylending",
			content:
				"A debt sworn before witnesses cannot be forgiven, only transferred. The ledger is kept in the counting house and the interest is reckoned at each quarter."
		},
		{
			id: 2,
			name: "falconry",
			content:
				"Hawks are flown at dawn and hooded between casts. A bird that refuses the lure is not punished, merely fed less on the following day."
		},
		{
			id: 3,
			name: "boatbuilding",
			content:
				"Hulls are planked in oak and caulked with tarred hemp. A keel laid in autumn is left to season through the winter before it is raised."
		}
	],
	messages: [
		{ id: 1, content: "How much of the debt is left?" },
		{ id: 2, content: "The interest was reckoned again at the quarter." },
		{ id: 3, content: "Then it is more than it was." },
		{
			id: 4,
			content:
				"It is. The ledger says so, and the ledger was sworn before witnesses."
		},
		{ id: 5, content: "Can it be forgiven?" },
		{ id: 6, content: "Transferred. Never forgiven." }
	],
	wanted: [1],
	// No proper noun on either side, so the entity tier contributes nothing and
	// the entry's own title ("moneylending") is never said. Vocabulary alone.
	onlyEvidence: [1],
	unwanted: [2, 3]
}

describe("a keyless book retrieves sensibly", () => {
	for (const book of [emberfall, wrongScene, lowercaseOnly]) {
		it(`${book.name}: brings in what the scene is about`, () => {
			const got = admitted(book)
			for (const id of book.wanted)
				expect(
					got,
					`entry ${id} is what this scene is about and no key exists to say so`
				).toContain(id)
			for (const id of book.unwanted)
				expect(
					got,
					`entry ${id} has nothing to do with this scene — a gate that admits it admits everything`
				).not.toContain(id)
		})

		it(`${book.name}: cannot reach those entries with the gate off`, () => {
			// The shipped default, and the reason the parity corpus is
			// untouched by any of this. What is left admitted here is what a
			// key-only engine could already find — an entry whose own title the
			// conversation happened to say.
			const off = admitted(book, { admitThreshold: 0 })
			for (const id of book.onlyEvidence)
				expect(
					off,
					`entry ${id} is admitted without the gate, so this fixture ` +
						`would pass with the feature removed`
				).not.toContain(id)
			// Never fewer with the gate on: evidence adds a way in, it does not
			// take one away.
			for (const id of off) expect(admitted(book)).toContain(id)
		})
	}

	it("names what it found, so the receipt can say why", () => {
		const r = scan(emberfall)
		expect(r.diagnostics.admitThreshold).toBe(ON)
		// One of the three — the other two came in by name, which is the
		// distinction `onlyEvidence` above is about.
		expect(r.diagnostics.admittedByEvidence).toBe(1)
		expect(r.diagnostics.entities).toContain("Emberfall")
		expect(r.diagnostics.entities).toContain("Commander Vell")
		expect(r.diagnostics.extractorVersion).toBe(
			"core:extract/entities-heuristic@2"
		)
	})

	it("says how close a near miss came, not just that no key matched", () => {
		const r = scan(emberfall)
		const missed = r.skipped.find((s) => s.id === 5)
		expect(missed?.reason).toMatch(
			/its relevance scored 0\.\d\d against a threshold of 0\.30/
		)
	})

	it("is monotone in the threshold", () => {
		// Not a tuning assertion — a shape one. Raising the bar can only ever
		// take entries away, and a combination that failed this would be one
		// nobody could reason about from the control.
		const wide = admitted(emberfall, { admitThreshold: 0.05 })
		const narrow = admitted(emberfall, { admitThreshold: 0.55 })
		for (const id of narrow) expect(wide).toContain(id)
		expect(narrow.length).toBeLessThan(wide.length)
	})
})

describe("the zero-cost path", () => {
	it("needs no embedding model", () => {
		// Level 0 of the retrieval plan §4: a lorebook with no keywords at all,
		// found by a scan with nothing installed.
		//
		// ⚠ This used to be arranged as a proof — rows stating `rag`, a node
		// `defaultStrategy` beside them, an `availability` saying no vectors —
		// because an entry could once be routed *away* from this mechanism. It cannot:
		// `retrievalMode` went in migration 0203 and the per-entry
		// `retrieval_strategy` column in 0204, and this mechanism is no longer handed
		// availability at all. What is left is the plain statement that the
		// keyless corpus is admitted with no model in the picture.
		const r = keywordQuery({
			entries: emberfall.entries.map((e) => ({
				source: "worldLore" as const,
				keys: "",
				...e
			})),
			messages: emberfall.messages,
			retrieval: { ...DEFAULT_RETRIEVAL, admitThreshold: ON },
			countTokens: (text) => Math.ceil(text.length / 4)
		})
		expect(r.candidates.map((c) => c.id).sort()).toEqual([1, 2, 3])
	})
})

describe("determinism remains available", () => {
	const keyed: LoreRow[] = [
		{
			id: 1,
			source: "worldLore",
			name: "The Ashguard",
			keys: "ashguard",
			content: "An order of oathbound riders."
		},
		{
			id: 2,
			source: "worldLore",
			name: "Feast of Lanterns",
			keys: "lanterns",
			content: "A midwinter festival of paper lanterns."
		}
	]
	const messages = [
		{ id: 1, content: "the ashguard rode north" },
		{ id: 2, content: "quiet, after that" }
	]
	const run = (admitThreshold: number, entries = keyed) =>
		keywordQuery({
			entries,
			messages,
			retrieval: { ...DEFAULT_RETRIEVAL, admitThreshold },
			countTokens: (text) => Math.ceil(text.length / 4)
		})

	it("an authored key fires exactly as before", () => {
		const off = run(0)
		const on = run(ON)
		expect(off.candidates.map((c) => c.id)).toEqual([1])
		// The keyed entry is still admitted by its key, with the same signals —
		// evidence adds, it never replaces.
		expect(on.candidates[0]!.signals).toEqual(off.candidates[0]!.signals)
		expect(on.diagnostics.admittedByEvidence).toBe(0)
	})

	it("a constant entry bypasses retrieval whatever the threshold", () => {
		const entries: LoreRow[] = [{ ...keyed[1]!, keys: "", constant: true }]
		for (const threshold of [0, ON, 1]) {
			const r = run(threshold, entries)
			expect(r.candidates.map((c) => c.pinned)).toEqual([true])
			// ⚠ Pinned, not scored in: `constant` means bypass retrieval, and
			// it must not become a large evidence score (design §11).
			expect(r.diagnostics.admittedByEvidence).toBe(0)
		}
	})

	it("the same scan twice is the same answer", () => {
		expect(admitted(emberfall)).toEqual(admitted(emberfall))
	})
})

/**
 * Bug 16's split, carried into admission.
 *
 * 0.5 asked world lore whether the entry names a cast member and character lore
 * whether the entry's own character **spoke in the guaranteed window**. The
 * admission gate honours the same split rather than growing a third definition:
 * character lore's entity term is the speaker answer, so an entry bound to
 * somebody who has not said anything is judged on its vocabulary alone.
 */
describe("character lore keeps its own question", () => {
	/**
	 * Two entries with **identical text**, bound to different characters.
	 *
	 * Identical on purpose: the vocabulary term cannot tell them apart, so the
	 * only thing that can is who spoke, which is the whole of bug 16's split.
	 * The text deliberately shares almost nothing with the scene, so the
	 * speaker fact is doing the work rather than riding on a coincidence.
	 */
	const oath =
		"She rode out at sixteen and has not gone back to the city since."
	const entries: LoreRow[] = [
		{
			id: 1,
			source: "characterLore",
			name: "The oath",
			keys: "",
			bindingCharacterId: 7,
			content: oath
		},
		{
			id: 2,
			source: "characterLore",
			name: "The oath, remembered",
			keys: "",
			bindingCharacterId: 9,
			content: oath
		}
	]
	const run = (admitThreshold: number) =>
		keywordQuery({
			entries,
			messages: emberfall.messages,
			entityRefs: emberfall.cast,
			retrieval: { ...DEFAULT_RETRIEVAL, admitThreshold },
			countTokens: (text) => Math.ceil(text.length / 4)
		})

	it("admits the speaker's lore and not a silent character's", () => {
		expect(run(ON).candidates.map((c) => c.id)).toEqual([1])
		// At any threshold at all: `presence` is a multiplier, so a character
		// who has said nothing scores zero however well the words match.
		expect(run(0.01).candidates.map((c) => c.id)).toEqual([1])
	})

	it("does not admit the speaker's whole book regardless of relevance", () => {
		/**
		 * ⚠ The reason the speaker answer multiplies instead of joining the
		 * noisy-or. Folded in as an evidence term it is worth 1 by itself, so
		 * every keyless entry of a present character clears every threshold —
		 * a character with forty of them would empty the band on relevance
		 * nobody assessed. Here the entry is bound to somebody in the scene and
		 * still has to be about something the scene is about.
		 */
		expect(run(0.99).candidates.map((c) => c.id)).toEqual([])
	})
})
