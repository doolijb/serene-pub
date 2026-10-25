/**
 * The resolver's merge, pure (PLAN-layering D7, R2, R24, R33, A11, A15): the
 * three layers over rows as stored, judged against a published set.
 */
import { describe, expect, it } from "vitest"
import { mergeLayers } from "./resolve"
import {
	actionRegistration,
	eventRegistration,
	genreChangeKey,
	rowOfChange,
	rowOfDecl,
	rowOfDrop,
	type RegistrationRow
} from "./rows"
import type { RegistrationInsert } from "./rows"

let id = 0
const row = (r: RegistrationInsert): RegistrationRow =>
	({
		id: ++id,
		state: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		presetId: null,
		sessionId: null,
		...r
	}) as RegistrationRow

const RESPOND = "core:event/message-respond@1"
const ADDED = "core:event/member-added@1"
const G = { kind: "genre" as const, genreId: "core:genre/story" }
const P = { kind: "preset" as const, presetId: 7 }
const S = { kind: "session" as const, sessionId: 9 }

const reply = eventRegistration(RESPOND, "core:spec/story-respond")
const order = eventRegistration(ADDED, "core:spec/story-turn-order")
const look = actionRegistration("core:spec/story-look#look")
const rest = actionRegistration("core:spec/story-rest#rest")
const genreRows = () => [reply, order, look, rest].map((d) => row(rowOfDecl(d, G, "genre")))
const all = new Set(["core:spec/story-respond", "core:spec/story-turn-order", "core:spec/story-look", "core:spec/story-rest", "acme:spec/reply"])

describe("mergeLayers", () => {
	it("🚧 a ruleset's actions join the genre's layer (D6): published, dropped by key like any other", () => {
		const draw = actionRegistration("core:spec/rules-action#draw-up")
		const play = actionRegistration("core:spec/rules-action#play-card")
		const withRules = new Set([...all, "core:spec/rules-action"])
		const m = mergeLayers({ genre: genreRows(), preset: [], session: [row(rowOfDrop(play.key, S, "owner"))] }, withRules, null, [draw, play])
		const keys = (l: { key: string }[]) => l.map((r) => r.key)
		expect(keys(m.defaults)).toEqual(expect.arrayContaining([draw.key, play.key]))
		expect(m.defaults.find((r) => r.key === draw.key)!.origin).toBe("genre")
		expect(keys(m.effective)).toContain(draw.key)
		expect(keys(m.effective)).not.toContain(play.key)
		// Unpublished, they are stale, never run.
		expect(keys(mergeLayers({ genre: genreRows(), preset: [], session: [] }, all, null, [draw]).effective)).not.toContain(draw.key)
	})

	it("the genre's defaults alone, ordered by order then key (R24)", () => {
		const m = mergeLayers({ genre: genreRows(), preset: [], session: [] }, all, null)
		expect(m.effective.map((r) => r.key)).toEqual([...m.effective.map((r) => r.key)].sort())
		expect(m.effective.every((r) => r.origin === "genre")).toBe(true)
		expect(m.offered).toEqual(m.effective)
	})

	it("a preset drops and registers; a session drops what the preset offers", () => {
		const alt = eventRegistration(RESPOND, "acme:spec/reply")
		const preset = [row(rowOfDrop(reply.key, P, "admin")), row(rowOfDecl(alt, P, "admin")), row(rowOfDrop(rest.key, P, "admin"))]
		const session = [row(rowOfDrop(look.key, S, "owner"))]
		const m = mergeLayers({ genre: genreRows(), preset, session }, all, { id: 7, name: "Mine" })
		const keys = (l: { key: string }[]) => l.map((r) => r.key)
		expect(keys(m.offered)).toEqual(expect.arrayContaining([alt.key, order.key, look.key]))
		expect(keys(m.offered)).not.toContain(reply.key)
		expect(keys(m.offered)).not.toContain(rest.key)
		expect(keys(m.effective)).not.toContain(look.key)
		expect(m.effective.find((r) => r.key === alt.key)?.origin).toBe("preset")
		expect(m.fallbacks).toEqual([])
	})

	it("a preset registration whose pipeline is not published falls back to the genre's, out loud (A11)", () => {
		const gone = eventRegistration(RESPOND, "test:spec/gone")
		const preset = [row(rowOfDrop(reply.key, P, "admin")), row(rowOfDecl(gone, P, "admin"))]
		const m = mergeLayers({ genre: genreRows(), preset, session: [] }, all, { id: 7, name: "Went stale" })
		expect(m.effective.filter((r) => r.trigger.family === "event" && r.trigger.event === RESPOND).map((r) => r.pipeline)).toEqual([
			"core:spec/story-respond"
		])
		expect(m.fallbacks).toEqual([
			{ presetId: 7, preset: "Went stale", event: RESPOND, bound: "test:spec/gone", reason: expect.stringMatching(/not published/) }
		])
		expect(m.stale.map((s) => s.registration.key)).toEqual([gone.key])
		expect(m.stale[0]!.fallback).toBe("core:spec/story-respond")
	})

	it("many registrations on one event run in their declared order (R24)", () => {
		const second = { ...eventRegistration(ADDED, "acme:spec/reply"), order: -1 }
		const m = mergeLayers({ genre: genreRows(), preset: [row(rowOfDecl(second, P, "admin"))], session: [] }, all, null)
		expect(m.effective.filter((r) => r.trigger.family === "event" && r.trigger.event === ADDED).map((r) => r.pipeline)).toEqual([
			"acme:spec/reply",
			"core:spec/story-turn-order"
		])
	})

	it("an administrator's change to the genre's defaults folds into the genre layer (A15)", () => {
		const change = row(rowOfChange({ key: genreChangeKey(reply.key), values: { generate: { params: { maxTokens: 9 } } } }, G, "admin"))
		const m = mergeLayers({ genre: [...genreRows(), change], preset: [], session: [] }, all, null)
		expect(m.defaults.find((r) => r.key === reply.key)?.values).toEqual({ generate: { params: { maxTokens: 9 } } })
	})

	it("a session's change carries its mode and values over the preset's", () => {
		const preset = [row(rowOfChange({ key: reply.key, values: { reading: { params: { scene: false } } } }, P, "preset"))]
		const session = [row(rowOfChange({ key: reply.key, values: { reading: { params: { lore: false } } } }, S, "owner"))]
		const m = mergeLayers({ genre: genreRows(), preset, session }, all, null)
		expect(m.effective.find((r) => r.key === reply.key)?.values).toEqual({ reading: { params: { lore: false } } })
		expect(m.effective.find((r) => r.key === reply.key)?.changedBy).toEqual(["preset", "session"])
		expect(m.offered.find((r) => r.key === reply.key)?.values).toEqual({ reading: { params: { scene: false } } })
	})
})
