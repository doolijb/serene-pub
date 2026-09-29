/**
 * The six turn strategies and the pool (PLAN-turn-order §4.4, A6), at the
 * binding. The rename of `nextSpeaker.test.ts`: the decider it tested is
 * gone, and what it asserted about turn-taking is asserted here over the
 * vocabulary that replaced it — candidates in, entries out.
 *
 * What is pinned: no strategy halts, ever — an empty order is the answer;
 * round robin lists everyone who has not spoken since the person did, in
 * candidate order; user-split narrows to the last sender's own; random is a
 * function of the run seed (same seed, same entry — assert same-seed
 * equality, never cross-seed inequality); scripted keeps only entries whose
 * ref the pool admitted; manual prepares nothing; narrator prepares one
 * entry in nobody's name after a person's line and none after a reply. The
 * pool's four params and its two floors are here too, and the mentioned
 * orderer's rule lives in `speakerRotation.test.ts`.
 */

import { describe, it, expect } from "vitest"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"

const bindings = coreBindings() as Record<
	string,
	(input: any, ctx?: any) => Promise<any>
>

const ALL = [
	"core:task/turn-round-robin@1",
	"core:task/turn-user-split@1",
	"core:task/turn-random@1",
	"core:task/turn-scripted@1",
	"core:task/turn-manual@1",
	"core:task/turn-narrator@1"
]

/** Alice and Bram, in candidate order, plus one persona of user 1's. */
const candidates = [
	{ ref: "character:11", kind: "character", name: "Alice", position: 0, ownerUserId: 1 },
	{ ref: "character:12", kind: "character", name: "Bram", position: 1, ownerUserId: 2 },
	{ ref: "character:7", kind: "persona", name: "You", position: 0, ownerUserId: 1 }
]

const user = (personaId?: number) => ({
	role: "user",
	content: "hello",
	...(personaId ? { personaId } : {})
})
const reply = (characterId: number) => ({ role: "assistant", characterId })

/** A binding's `ok` value — `{ kind: 'ok', value: { main, order } }`. */
const ordered = (out: any): any[] => out.value.main

const run = (id: string, input: any, ctx: any = {}) =>
	bindings[id]!({ candidates, messages: [], ...input }, ctx)

describe("every strategy answers, and none of them halts", () => {
	it("an empty candidate list is an empty order, not a halt", async () => {
		for (const id of ALL) {
			const out = await run(id, { candidates: [] })
			expect(out.kind, `${id} halted`).toBe("ok")
			expect(ordered(out)).toEqual([])
		}
	})

	it("`main` and `order` carry the same value on every one", async () => {
		for (const id of ALL) {
			const out = await run(id, { messages: [user()] })
			expect(out.value.main, id).toEqual(out.value.order)
		}
	})
})

describe("round robin", () => {
	it("lists everyone who has not spoken since the person did, in candidate order", async () => {
		const out = await run("core:task/turn-round-robin@1", {
			messages: [user()]
		})
		expect(ordered(out).map((e: any) => e.ref)).toEqual([
			"character:11",
			"character:12",
			"character:7"
		])
	})

	it("drops a character that has already replied this round", async () => {
		const out = await run("core:task/turn-round-robin@1", {
			messages: [user(), reply(11)]
		})
		expect(ordered(out).map((e: any) => e.ref)).toEqual([
			"character:12",
			"character:7"
		])
	})

	it("a persona's own send consumes its turn (R15)", async () => {
		const out = await run("core:task/turn-round-robin@1", {
			messages: [user(7)]
		})
		expect(ordered(out).map((e: any) => e.ref)).toEqual([
			"character:11",
			"character:12"
		])
	})

	it("everyone having spoken is an empty order — the person's turn", async () => {
		const out = await run("core:task/turn-round-robin@1", {
			messages: [user(7), reply(11), reply(12)]
		})
		expect(ordered(out)).toEqual([])
	})

	it("an envoy's reply is recognised by its reference, not by an id", async () => {
		const withEnvoy = [
			...candidates,
			{ ref: "envoy:scribe", kind: "envoy", name: "Scribe", position: 0 }
		]
		const out = await run("core:task/turn-round-robin@1", {
			candidates: withEnvoy,
			messages: [
				user(),
				{ role: "assistant", metadata: { speaker: "envoy:scribe" } }
			]
		})
		expect(ordered(out).map((e: any) => e.ref)).not.toContain(
			"envoy:scribe"
		)
	})

	it("every entry says how it was decided", async () => {
		const out = await run("core:task/turn-round-robin@1", {
			messages: [user()]
		})
		for (const entry of ordered(out))
			expect(entry.via).toBe("strategy")
	})
})

describe("round robin by user", () => {
	it("narrows to the last sender's own candidates", async () => {
		const out = await run("core:task/turn-user-split@1", {
			messages: [user(7)]
		})
		// Persona 7 is user 1's, so user 1's candidates answer — and the
		// persona's own turn was consumed by the send.
		expect(ordered(out).map((e: any) => e.ref)).toEqual([
			"character:11"
		])
	})

	it("falls back to the flat rotation when the sender holds none", async () => {
		const out = await run("core:task/turn-user-split@1", {
			messages: [{ role: "user", content: "hi", personaId: 99 }]
		})
		expect(ordered(out).map((e: any) => e.ref)).toEqual([
			"character:11",
			"character:12",
			"character:7"
		])
	})
})

describe("random", () => {
	it("prepares exactly one entry, and the same one for the same seed", async () => {
		const ctx = { random: () => 0.9 }
		const a = await run("core:task/turn-random@1", { messages: [user()] }, ctx)
		const b = await run("core:task/turn-random@1", { messages: [user()] }, ctx)
		expect(ordered(a).length).toBe(1)
		expect(ordered(a)).toEqual(ordered(b))
	})

	it("draws only from the not-yet-spoken", async () => {
		const out = await run(
			"core:task/turn-random@1",
			{ messages: [user(7), reply(11)] },
			{ random: () => 0 }
		)
		expect(ordered(out)[0].ref).toBe("character:12")
	})
})

describe("scripted", () => {
	it("keeps the round-robin order when the chain declines", async () => {
		const out = await run(
			"core:task/turn-scripted@1",
			{ messages: [user()] },
			{ scripts: { apply: async () => null } }
		)
		expect(ordered(out).map((e: any) => e.ref)).toEqual([
			"character:11",
			"character:12",
			"character:7"
		])
	})

	it("takes the chain's order, marking what it changed", async () => {
		const out = await run(
			"core:task/turn-scripted@1",
			{ messages: [user()] },
			{
				scripts: {
					apply: async () => ({ order: [{ ref: "character:12" }] })
				},
				log: () => {}
			}
		)
		expect(ordered(out)).toEqual([
			{ ref: "character:12", via: "script" }
		])
	})

	it("refuses a ref the pool did not admit, and says so", async () => {
		const notes: string[] = []
		const out = await run(
			"core:task/turn-scripted@1",
			{ messages: [user()] },
			{
				scripts: {
					apply: async () => ({
						order: [{ ref: "character:999" }, { ref: "character:11" }]
					})
				},
				log: (_level: string, text: string) => notes.push(text)
			}
		)
		expect(ordered(out).map((e: any) => e.ref)).toEqual([
			"character:11"
		])
		expect(notes.join(" ")).toContain("character:999")
	})

	it("admits a narrator entry, which names nobody", async () => {
		const out = await run(
			"core:task/turn-scripted@1",
			{ messages: [user()] },
			{
				scripts: { apply: async () => ({ order: [{ ref: null }] }) },
				log: () => {}
			}
		)
		expect(ordered(out)).toEqual([{ ref: null, via: "script" }])
	})
})

describe("manual and narrator", () => {
	it("manual prepares nothing, whatever the history", async () => {
		for (const messages of [[], [user()], [user(), reply(11)]]) {
			const out = await run("core:task/turn-manual@1", { messages })
			expect(ordered(out)).toEqual([])
		}
	})

	it("narrator prepares one entry in nobody's name after a person's line", async () => {
		const out = await run("core:task/turn-narrator@1", {
			candidates: [],
			messages: [user()]
		})
		expect(ordered(out)).toEqual([{ ref: null, via: "voice" }])
	})

	it("narrator prepares nothing after a reply", async () => {
		const out = await run("core:task/turn-narrator@1", {
			candidates: [],
			messages: [user(), { role: "assistant", isNarratorResponse: true }]
		})
		expect(ordered(out)).toEqual([])
	})

	/**
	 * The entry spans channels (lair re-plan R5): one per channel whose
	 * newest visible row is a person's, newest line first, so a line on a
	 * side channel puts its entry at the head and auto-advance answers it.
	 * `main`'s entry carries no `channel`, so a history that reads only
	 * `main` (Adventure, Whodunit) gets the order it always got.
	 */
	describe("on more than one channel (R5)", () => {
		const on = (channel: string, row: Record<string, unknown>) => ({ ...row, channel })

		it("one entry per channel whose newest row is a person's, newest line first", async () => {
			const out = await run("core:task/turn-narrator@1", {
				candidates: [],
				messages: [
					on("main", user()),
					on("sanctum", { role: "assistant", speaker: "envoy:castellan" }),
					on("sanctum", user())
				]
			})
			expect(ordered(out)).toEqual([
				{ ref: null, via: "voice", channel: "sanctum" },
				{ ref: null, via: "voice" }
			])
		})

		it("a main line newer than the side channel's heads the order", async () => {
			const out = await run("core:task/turn-narrator@1", {
				candidates: [],
				messages: [on("sanctum", user()), on("main", user())]
			})
			expect(ordered(out)).toEqual([
				{ ref: null, via: "voice" },
				{ ref: null, via: "voice", channel: "sanctum" }
			])
		})

		it("an answered channel prepares nothing, and a hidden line counts for nobody", async () => {
			const out = await run("core:task/turn-narrator@1", {
				candidates: [],
				messages: [
					on("main", user()),
					on("main", { role: "assistant", isNarratorResponse: true }),
					on("sanctum", user()),
					on("sanctum", { role: "assistant", isHidden: true })
				]
			})
			// The hidden reply is not an answer: the Sanctum line is still due.
			expect(ordered(out)).toEqual([
				{ ref: null, via: "voice", channel: "sanctum" }
			])
		})

		it("a row with no channel is main's, and main's entry never names it", async () => {
			const out = await run("core:task/turn-narrator@1", {
				candidates: [],
				messages: [user(), on("main:1", user())]
			})
			expect(ordered(out)).toEqual([{ ref: null, via: "voice" }])
		})
	})
})

describe("the pool", () => {
	const cast = {
		sessionCharacters: [
			{
				enabled: true,
				position: 0,
				removedAt: null,
				character: { id: 11, name: "Alice", userId: 1 }
			},
			{
				enabled: false,
				position: 1,
				removedAt: null,
				character: { id: 12, name: "Bram", userId: 2 }
			},
			{
				enabled: true,
				position: 2,
				removedAt: new Date(),
				character: { id: 13, name: "Gone", userId: 1 }
			}
		],
		sessionPersonas: [
			{ position: 0, removedAt: null, persona: { id: 7, name: "You", userId: 1 } }
		],
		envoys: [
			{ slug: "scribe", position: 0, speaks: "in-turn", name: { en: "Scribe" } },
			{ slug: "oracle", position: 1, speaks: "on-action", name: { en: "Oracle" } }
		]
	}
	const pool = (params: Record<string, unknown> = {}, messages: any[] = []) =>
		bindings["core:task/turn-pool@1"]!({ cast, messages, params }, {})

	it("admits active characters, personas and in-turn envoys, in that order", async () => {
		const out = await pool()
		expect(ordered(out).map((c: any) => [c.ref, c.kind])).toEqual([
			["character:11", "character"],
			["character:7", "persona"],
			["envoy:scribe", "envoy"]
		])
	})

	it("never admits a removed row or an on-action envoy, whatever the params", async () => {
		const out = await pool({ characters: "all", envoys: "only", envoySlugs: ["oracle"] })
		const refs = ordered(out).map((c: any) => c.ref)
		expect(refs).not.toContain("character:13")
		expect(refs).not.toContain("envoy:oracle")
	})

	it("`characters: 'all'` admits one switched off in the cast", async () => {
		const out = await pool({ characters: "all" })
		expect(ordered(out).map((c: any) => c.ref)).toContain(
			"character:12"
		)
	})

	it("`characters: 'none'` admits none of them", async () => {
		const out = await pool({ characters: "none" })
		expect(
			ordered(out).filter((c: any) => c.kind === "character")
		).toEqual([])
	})

	it("`personas: 'none'` leaves the people out", async () => {
		const out = await pool({ personas: "none" })
		expect(ordered(out).map((c: any) => c.ref)).not.toContain(
			"character:7"
		)
	})

	it("`personas: 'others'` leaves out whoever just wrote", async () => {
		const out = await pool({ personas: "others" }, [
			{ role: "user", content: "hi", personaId: 7 }
		])
		expect(ordered(out).map((c: any) => c.ref)).not.toContain(
			"character:7"
		)
	})

	it("`envoys: 'none'` and `'except'` leave them out", async () => {
		expect(ordered(await pool({ envoys: "none" })).map((c: any) => c.ref)).not.toContain(
			"envoy:scribe"
		)
		const except = await pool({ envoys: "except", envoySlugs: ["scribe"] })
		expect(ordered(except).map((c: any) => c.ref)).not.toContain(
			"envoy:scribe"
		)
	})

	it("a candidate carries the name a mention would match, and its owner", async () => {
		const out = await pool()
		const alice = ordered(out).find(
			(c: any) => c.ref === "character:11"
		)
		expect(alice).toMatchObject({ name: "Alice", ownerUserId: 1, position: 0 })
	})
})
