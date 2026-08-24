/**
 * The §9 performance budgets — acceptance numbers, measured (18 §9, U-S2/U-S4).
 *
 * The plan is explicit that these are "measured in CI against the WASM engine,
 * not reasoned about", and the reason is that the whole tier's viability rests
 * on one number: a stop script runs per flush tick of every streamed reply, and
 * everything else runs once per turn and disappears against model latency. If
 * the hot path is slow, scripts are a feature people turn off.
 *
 * ## What the first measurement found
 *
 * Both budgets are met with roughly an order of magnitude to spare, on a
 * *cold* context per evaluation:
 *
 * | measure | budget | measured p95 |
 * |---|---|---|
 * | cold instantiation | ≤ 5 ms | ~0.9 ms |
 * | stop evaluation, 2 KB tail | ≤ 1 ms | ~0.5 ms |
 *
 * That is worth more than the headroom itself. §7 item 1 allows a **warm
 * context per stream** for `text/stop` as a deliberate exception to
 * fresh-instance-per-evaluation, and notes that pooled reuse beyond that should
 * be "a profiling-justified decision taken knowingly, never a default". These
 * numbers say the exception may not be needed at all — and fresh-per-evaluation
 * is the stronger position, because it is simultaneously the security property,
 * the purity law (F11) and the replay property. Take the warm context only if a
 * later measurement demands it.
 *
 * Thresholds here are §9's own numbers rather than a multiple of what this
 * machine happens to do. A CI box several times slower than a laptop still
 * passes; a change that costs an order of magnitude does not, which is the
 * regression these exist to catch.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { runScript } from "$lib/server/scripts/run"
import { scriptEngine } from "$lib/server/scripts/engine"

const p95 = (xs: number[]): number =>
	[...xs].sort((a, b) => a - b)[
		Math.min(xs.length - 1, Math.floor(xs.length * 0.95))
	]!

beforeAll(async () => {
	// Module compile is the expensive half and is cached process-wide, so it is
	// paid here rather than inside the first sample. Measuring it as if it were
	// per-evaluation would report a number the runtime never actually sees.
	await scriptEngine()
	await runScript({ source: "return", input: {}, declaredOut: [] })
}, 60_000)

describe("§9 budgets", () => {
	it("instantiates a fresh context in under 5 ms", async () => {
		const samples: number[] = []
		for (let i = 0; i < 40; i++) {
			const t = performance.now()
			await runScript({ source: "return", input: {}, declaredOut: [] })
			samples.push(performance.now() - t)
		}
		expect(p95(samples)).toBeLessThan(5)
	}, 60_000)

	it("evaluates a stop script over a 2 KB tail in under 1 ms", async () => {
		// The only hot path in the tier. The tail window is what keeps a long
		// generation O(n) rather than O(n²): stop patterns are short, so the
		// script is shown the last 2 KB and not the whole accumulation.
		const tail = "the ashguard rode north. ".repeat(82).slice(0, 2048)
		const samples: number[] = []
		for (let i = 0; i < 60; i++) {
			const t = performance.now()
			const r = await runScript({
				source: `var i = text.indexOf("<|im_end|>"); return i < 0 ? undefined : i`,
				input: { text: tail },
				semantics: "verdict",
				declaredOut: []
			})
			samples.push(performance.now() - t)
			expect(r.result).toBe("ok")
		}
		expect(p95(samples)).toBeLessThan(1)
	}, 60_000)

	it("runs a five-link chain's worth of transforms in under 10 ms", async () => {
		// §9's "whole per-turn chain overhead, all hooks". Five links is a
		// realistic busy configuration — a slop filter, two replacements, a
		// trimmer and a guard — and the budget is for all of them together.
		const links = [
			`return { text: text.replace(/\\bslop\\b/g, "") }`,
			`return { text: text.replace(/  +/g, " ") }`,
			`if (!text.trim()) return; return { text: text.trim() }`,
			`return { text: text.split("").reverse().join("") }`,
			`ctx.log("checked"); return`
		]
		const samples: number[] = []
		for (let i = 0; i < 20; i++) {
			const t = performance.now()
			let text = "the slop  ashguard rode  north".repeat(20)
			for (const source of links) {
				const r = await runScript({
					source,
					input: { text },
					declaredOut: ["text"]
				})
				expect(r.result).toBe("ok")
				if (!r.passthrough && typeof r.value.text === "string")
					text = r.value.text
			}
			samples.push(performance.now() - t)
		}
		expect(p95(samples)).toBeLessThan(10)
	}, 60_000)
})
