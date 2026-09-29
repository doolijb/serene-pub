import { describe, it, expect } from "vitest"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"

/**
 * The two pure Tasks of D-4a: the derived pick, and the room as options.
 *
 * Neither touches `ctx`, so both run here with `{}` for it — which is itself
 * the property being pinned. What a genre is relying on when it *derives* a
 * hidden fact rather than authoring it:
 *
 *  · the same key and the same list reach the same item, whatever order the
 *    rows arrived in, on every turn and in every process;
 *  · an empty list **halts** rather than publishing an `ok` whose ports read
 *    absent — "nobody did it" is not a case a mystery can carry on from;
 *  · `chosenKey` is the string the pick won under, so a later junction can
 *    compare an answer against it (`equalsPath`);
 *  · `cast-choices` keys its options by participant reference, which is what
 *    makes that comparison mean anything;
 *  · and it publishes the whole `{ question, options }` document, so it wires
 *    straight into `make-choices` with no model call between them (ruled (b),
 *    2026-09-17) — proved here by running the two handlers back to back.
 *
 * The ports are `scopeKey` and `pickIndex`, named the same night (R3, free
 * because neither definition had shipped): *key* alone is already an option
 * key, a candidate's identity and a settings field, and *index* is a database
 * index and a message's position.
 *
 * ⚠ **The definitions live in `serene-pub-sdk/contracts/src`, and this file
 * reads them through that package's `dist`.** A declaration edited in the
 * source reaches `reads<typeof C.pickByHash>` and `registryHashes.test.ts`
 * only after `npm run sdk:build`; the handlers themselves are plain functions
 * and run either way, which is why these tests pass through the lag.
 */

const pick = (input: any) =>
	coreBindings()["core:task/pick-by-hash@1"]!(input, {} as any) as any
const choices = (input: any) =>
	coreBindings()["core:task/cast-choices@1"]!(input, {} as any) as any

/** The cast document, in the shape `ctx.read("session_cast")` returns it. */
const cast = (over: Record<string, unknown> = {}) => ({
	sessionCharacters: [
		{
			character: { id: 11, name: "Vell", nickname: null },
			enabled: true,
			removedAt: null
		},
		{
			character: { id: 12, name: "Aro", nickname: null },
			enabled: true,
			removedAt: null
		}
	],
	sessionPersonas: [
		{ persona: { id: 20, name: "Rook" }, removedAt: null }
	],
	envoys: [{ slug: "narrator", name: { en: "Narrator" } }],
	...over
})

describe("pick-by-hash", () => {
	it("picks the same entry for a key however the rows are ordered", async () => {
		const rows = [{ id: 11 }, { id: 12 }, { id: 13 }, { id: 14 }]
		const first = await pick({ items: rows, scopeKey: "session:41", params: {} })
		expect(first.kind).toBe("ok")
		expect(rows).toContainEqual(first.value.main)
		// Each candidate is scored on its own, so the query's row order cannot
		// move the answer — the property an index into a shuffled list lacks.
		const reversed = await pick({
			items: [...rows].reverse(),
			scopeKey: "session:41",
			params: {}
		})
		expect(reversed.value.main).toEqual(first.value.main)
		// And the index is into the list AS HANDED IN.
		expect(rows[first.value.pickIndex]).toEqual(first.value.main)
		expect(first.value.chosenKey).toBe(String(first.value.main.id))
	})

	it("another session reaches its own answer", async () => {
		const rows = [{ id: 11 }, { id: 12 }, { id: 13 }]
		const keys = new Set<string>()
		for (const session of [41, 42, 43, 44, 45, 46, 47, 48])
			keys.add(
				(await pick({ items: rows, scopeKey: `session:${session}`, params: {} }))
					.value.chosenKey
			)
		// Not a proof of the distribution — `sdk-tests/pick.test.ts` measures
		// that — just that the key is actually read.
		expect(keys.size).toBeGreaterThan(1)
	})

	it("`by` names the field the identity is taken from", async () => {
		const options = [
			{ key: "character:11", label: "Vell" },
			{ key: "character:12", label: "Aro" }
		]
		const r = await pick({
			items: options,
			scopeKey: "session:41",
			params: { by: "key" }
		})
		expect(r.value.chosenKey).toMatch(/^character:\d+$/)
		expect(r.value.chosenKey).toBe(r.value.main.key)
		// A plain string list is its own identity.
		const words = await pick({
			items: ["alpha", "beta", "gamma"],
			scopeKey: "session:41",
			params: {}
		})
		expect(words.value.chosenKey).toBe(words.value.main)
	})

	it("takes the session's scope as the key, which is how a spec wires it", async () => {
		// The wiring the node exists for: `$.input.sessionScope` straight into
		// `scopeKey`. The binding spells it `session:<id>` — the same string
		// `whodunitSessionKey` and Twenty Questions' picker use — so a pick
		// keyed on the scope and one keyed on the literal agree.
		const rows = [{ id: 11 }, { id: 12 }, { id: 13 }]
		const viaScope = await pick({
			items: rows,
			scopeKey: { sessionId: 41, currentCharacterId: null },
			params: {}
		})
		const viaLiteral = await pick({ items: rows, scopeKey: "session:41", params: {} })
		expect(viaScope.value.main).toEqual(viaLiteral.value.main)
		// A bare row id is NOT read as a session: it could name a character or
		// an entry just as well, and guessing would key two genres on one
		// number.
		const bare = await pick({ items: rows, scopeKey: 41, params: {} })
		expect(bare.kind).toBe("halt")
		expect(bare.reason).toContain("$.input.sessionScope")
	})

	it("halts on an empty list and on a missing key, never on a quiet ok", async () => {
		// The definition declares no `optional`, so these stop the run. An
		// `ok` with absent ports would be indistinguishable downstream from a
		// pick that genuinely chose nothing.
		const empty = await pick({ items: [], scopeKey: "session:41", params: {} })
		expect(empty.kind).toBe("halt")
		expect(empty.reason).toContain("nothing to pick from")
		const noKey = await pick({ items: [{ id: 1 }], scopeKey: "", params: {} })
		expect(noKey.kind).toBe("halt")
		expect(noKey.reason).toContain("nothing to pick under")
		// An entry with no identity is not a candidate, and a list of them is
		// an empty list — the sentence names the field that was asked for.
		const unnamed = await pick({
			items: [{ label: "Vell" }],
			scopeKey: "session:41",
			params: { by: "key" }
		})
		expect(unnamed.kind).toBe("halt")
		expect(unnamed.reason).toContain("`key`")
	})
})

describe("cast-choices", () => {
	it("keys every option by participant reference, cast before presences", async () => {
		const r = await choices({ cast: cast(), params: {} })
		expect(r.kind).toBe("ok")
		expect(r.value.main).toEqual([
			{ key: "character:11", label: "Vell" },
			{ key: "character:12", label: "Aro" },
			{ key: "character:20", label: "Rook" }
		])
		// Both ports, one value: `main` is what an unrefined reference
		// resolves to and `options` is what a spec names when it says so.
		expect(r.value.options).toEqual(r.value.main)
	})

	it("leaves out one half at a time, and never the envoy", async () => {
		const noPersonas = await choices({
			cast: cast(),
			params: { exclude: "personas" }
		})
		expect(noPersonas.value.main.map((o: any) => o.key)).toEqual([
			"character:11",
			"character:12"
		])
		const noCharacters = await choices({
			cast: cast(),
			params: { exclude: "characters" }
		})
		expect(noCharacters.value.main.map((o: any) => o.key)).toEqual([
			"character:20"
		])
		// An envoy is in the cast read and is never an option: `exclude` has
		// no value that would take it back out again.
		for (const r of [noPersonas, noCharacters, await choices({ cast: cast(), params: {} })])
			expect(r.value.main.some((o: any) => o.key.startsWith("envoy:"))).toBe(false)
	})

	it("offers live seats only", async () => {
		const r = await choices({
			cast: cast({
				sessionCharacters: [
					{
						character: { id: 11, name: "Vell" },
						enabled: true,
						removedAt: null
					},
					{
						character: { id: 12, name: "Aro" },
						enabled: true,
						removedAt: new Date()
					},
					{
						character: { id: 13, name: "Ines" },
						enabled: false,
						removedAt: null
					}
				],
				sessionPersonas: [
					{ persona: { id: 20, name: "Rook" }, removedAt: new Date() }
				]
			}),
			params: {}
		})
		expect(r.value.main).toEqual([{ key: "character:11", label: "Vell" }])
	})

	it("a nameless seat is no option, and nobody is offered twice", async () => {
		const r = await choices({
			cast: cast({
				sessionCharacters: [
					{ character: { id: 11, name: "  " }, enabled: true, removedAt: null },
					{
						character: { id: 12, name: null, nickname: "The Warden" },
						enabled: true,
						removedAt: null
					},
					{ character: { id: 12, name: "Aro" }, enabled: true, removedAt: null }
				],
				sessionPersonas: [{ persona: { id: 12, name: "Aro" }, removedAt: null }]
			}),
			params: {}
		})
		expect(r.value.main).toEqual([{ key: "character:12", label: "The Warden" }])
	})

	it("publishes the document `make-choices` reads, question and all", async () => {
		// Ruled (b): the shaping happens here, because `make-choices` reads the
		// question and the options off ONE `json` port and a second in-port
		// there would move the hash of a node already wired into shipped specs.
		const r = await choices({
			cast: cast(),
			question: "Who do you accuse?",
			params: { exclude: "personas" }
		})
		expect(r.value.json).toEqual({
			question: "Who do you accuse?",
			options: [
				{ key: "character:11", label: "Vell" },
				{ key: "character:12", label: "Aro" }
			]
		})
		// The same list on both ports — `options` is the bare list for a spec
		// that wants to pick over it, `json` is what the question is asked with.
		expect(r.value.json.options).toEqual(r.value.options)
		// No `addressee`: the document's is a NAME `make-choices` resolves
		// against the cast, and this node has no more idea who the question is
		// for than the cast document does.
		expect(Object.keys(r.value.json)).toEqual(["question", "options"])
		// Unwired, the question is the empty string — and `make-choices`
		// publishes no block for a document with no question, rather than a
		// block asking nothing.
		expect((await choices({ cast: cast(), params: {} })).value.json.question).toBe("")
	})

	it("reaches a choices block with no model call in between", async () => {
		// The saving, run rather than described: both Whodunit pickers spend a
		// `generate-json` call whose entire job is to read the cast back out as
		// JSON — a request, a schema and a wait for a fact the run already held,
		// with a model free to misspell a suspect or invent one.
		const make = (input: any) =>
			coreBindings()["core:task/make-choices@1"]!(input, {} as any) as any
		const shaped = await choices({
			cast: cast(),
			question: "Who do you accuse?",
			params: { exclude: "personas" }
		})
		const block = await make({ json: shaped.value.json, fn: "accuse" })
		expect(block.kind).toBe("ok")
		expect(block.value.blocks).toEqual([
			{
				kind: "choices",
				question: "Who do you accuse?",
				actions: [
					{ fn: "accuse", label: "Vell", choice: "character:11" },
					{ fn: "accuse", label: "Aro", choice: "character:12" }
				]
			}
		])
		expect(block.value.text).toBe("Who do you accuse?")
	})

	it("an absent cast is an empty list, not a failure", async () => {
		// A pure shaper has nothing to halt about: the emptiness travels to
		// `make-choices`, which publishes no block for it.
		expect((await choices({ params: {} })).value.main).toEqual([])
		expect((await choices({ cast: {}, params: {} })).value.main).toEqual([])
	})

	it("composes with pick-by-hash: an option key is what the pick wins under", async () => {
		// The wiring the Whodunit follow-up depends on — the culprit is
		// derived over the same list the accusation is chosen from, so the
		// verdict can compare the two with `equalsPath`.
		const options = (await choices({ cast: cast(), params: { exclude: "personas" } }))
			.value.main
		const culprit = await pick({
			items: options,
			scopeKey: "session:41",
			params: { by: "key" }
		})
		expect(options.map((o: any) => o.key)).toContain(culprit.value.chosenKey)
	})
})
