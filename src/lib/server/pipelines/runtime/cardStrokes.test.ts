/**
 * `core:task/card-strokes@1` (DESIGN-card-strokes A.4): every stroked card's
 * keyword strokes marked fired or not against the last `scanDepth` messages,
 * through the lore keyword matcher — substring by default, word, regex, case.
 */

import { describe, expect, it, vi } from "vitest"

// Strokes are paused (`strokesFlag.ts`, owner 2026-10-11); this file tests the
// paused feature's own behaviour, so it runs with the flag ON.
vi.mock("$lib/shared/characters/strokesFlag", () => ({ STROKES_ENABLED: true }))
import type { Stroke } from "@serene-pub/sdk"
import { coreBindings } from "./bindings"
import {
	resolveCastStrokes,
	strokeMatcher
} from "$lib/server/pipelines/prompt/cardStrokes"
import { buildScanWindow } from "$lib/server/pipelines/ranking/signals"

const cardStrokes = coreBindings()["core:task/card-strokes@1"]!

const ctx = {
	random: () => 0,
	signal: new AbortController().signal,
	progress: () => {},
	log: () => {}
} as any

const kw = (
	keys: string[],
	over: Partial<{ matchMode: "substring" | "word" | "regex"; caseSensitive: boolean }> = {}
): Stroke => ({
	kind: "description",
	text: keys.join("/"),
	when: { mode: "keywords", keys, ...over }
})

const castOf = (strokes: Stroke[] | undefined) => ({
	sessionId: 7,
	sessionCharacters: [
		{ enabled: true, character: { id: 1, name: "Alice", description: "A knight.", strokes } },
		{ enabled: true, character: { id: 2, name: "Bran", description: "A smith." } }
	]
})

const MESSAGES = [
	{ id: 1, content: "Long ago, at the River Gate." },
	{ id: 2, content: "The ferryman waits by the hearth." },
	{ id: 3, content: "Alice draws her blade." }
]

const firedOf = async (strokes: Stroke[], params: Record<string, unknown> = {}) => {
	const r: any = await cardStrokes(
		{ cast: castOf(strokes), messages: MESSAGES, params } as any,
		ctx
	)
	expect(r.kind).toBe("ok")
	const out = r.value
	const alice = out.cast.sessionCharacters[0].character
	expect(out.main).toBe(out.cast)
	return alice.strokes.map((s: any) => s.fired)
}

describe("core:task/card-strokes@1", () => {
	it("stamps always true, off false, and keyword strokes by the matcher", async () => {
		expect(
			await firedOf([
				{ kind: "description", text: "a", when: { mode: "always" } },
				{ kind: "description", text: "b", when: { mode: "off" } },
				kw(["ferry"]),
				kw(["dragon"])
			])
		).toEqual([true, false, true, false])
	})

	it("matches by substring by default — `art` fires on hearth", async () => {
		expect(await firedOf([kw(["art"])])).toEqual([true])
	})

	it("word mode needs a whole word", async () => {
		expect(
			await firedOf([kw(["art"], { matchMode: "word" }), kw(["blade"], { matchMode: "word" })])
		).toEqual([false, true])
	})

	it("regex mode runs the pattern", async () => {
		expect(
			await firedOf([
				kw(["ferry(man|boat)"], { matchMode: "regex" }),
				kw(["^dragons?$"], { matchMode: "regex" })
			])
		).toEqual([true, false])
	})

	it("is case-insensitive unless asked", async () => {
		expect(
			await firedOf([
				kw(["river gate"]),
				kw(["river gate"], { caseSensitive: true }),
				kw(["River Gate"], { caseSensitive: true })
			])
		).toEqual([true, false, true])
	})

	it("reads only the last scanDepth messages", async () => {
		expect(await firedOf([kw(["river"])], { scanDepth: 2 })).toEqual([false])
		expect(await firedOf([kw(["river"])], { scanDepth: 3 })).toEqual([true])
		// The declared default is ten: all three here.
		expect(await firedOf([kw(["river"])])).toEqual([true])
	})

	it("leaves a runaway pattern unfired rather than running it", async () => {
		expect(await firedOf([kw(["(a+)+$"], { matchMode: "regex" })])).toEqual([false])
	})

	it("passes a cast with no stroked card through as the same object", async () => {
		const cast = castOf(undefined)
		const r: any = await cardStrokes({ cast, messages: MESSAGES } as any, ctx)
		expect(r.kind).toBe("ok")
		expect(r.value.cast).toBe(cast)
		expect(resolveCastStrokes(cast, MESSAGES)).toBe(cast)
	})

	it("leaves an unstroked seat untouched beside a stroked one", () => {
		const cast = castOf([kw(["ferry"])])
		const out = resolveCastStrokes(cast, MESSAGES)
		expect(out.sessionCharacters[1]).toBe(cast.sessionCharacters[1])
		expect(cast.sessionCharacters[0]!.character.strokes![0]).not.toHaveProperty("fired")
	})
})

describe("the stroke matcher", () => {
	it("is the lore matcher over the scan window", () => {
		const window = buildScanWindow(MESSAGES, 10)
		const match = strokeMatcher(window)
		expect(match({ mode: "keywords", keys: ["FERRY"] })).toBe(true)
		expect(match({ mode: "keywords", keys: [] })).toBe(false)
		expect(match({ mode: "keywords", keys: ["dragon", "blade"] })).toBe(true)
	})
})
