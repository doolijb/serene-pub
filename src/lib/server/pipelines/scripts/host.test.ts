/**
 * The sandbox contract (18 §6) and the abuse corpus (18 §10).
 *
 * The corpus has parity-corpus standing: every hostile input is asserted to
 * fail *in the specific way it should* — interrupt, memory error, schema
 * refusal — because "we chose a good engine" is the claim and this staying
 * green is the proof. Grown every time anyone finds a new trick.
 *
 * Evaluation runs through the worker pool by default; the last block pins
 * that the inline fallback (`SP_SCRIPTS_INLINE=1`) is behaviourally identical
 * — one evaluator source, two hosts, and this is the assertion that keeps
 * that sentence true.
 */

import { describe, it, expect } from "vitest"
import { runScriptSource } from "$lib/server/pipelines/scripts/host"

const run = (
	source: string,
	over: Partial<Parameters<typeof runScriptSource>[0]> = {}
) =>
	runScriptSource({
		source,
		vars: { text: "hello world" },
		seedLabel: "test:label",
		nowMs: 1_000_000,
		...over
	})

describe("the contract", () => {
	it("binds declared vars, returns the value, and nothing-returned means passthrough", async () => {
		const r = await run("return text.toUpperCase()")
		expect(r).toMatchObject({ ok: true, value: "HELLO WORLD" })

		const p = await run("if (text.length > 999) return 'never'")
		expect(p).toMatchObject({ ok: true, value: undefined })
	})

	it("ctx.log lands in the record, in order", async () => {
		const r = await run("ctx.log('one'); ctx.log(2); return text")
		expect(r.ok).toBe(true)
		expect(r.logs).toEqual(["one", "2"])
	})

	it("rolls are a pure function of the seed label; Date.now is pinned", async () => {
		const src = "return [Math.random(), ctx.random(), Date.now()]"
		const a = await run(src, { seedLabel: "label:a", nowMs: 42_000 })
		const b = await run(src, { seedLabel: "label:a", nowMs: 42_000 })
		const c = await run(src, { seedLabel: "label:c", nowMs: 42_000 })
		expect(a.ok && b.ok && c.ok).toBe(true)
		// Same label, same stream — on any thread, any replay.
		expect((a as any).value).toEqual((b as any).value)
		// A different label is a different stream.
		expect((a as any).value[0]).not.toBe((c as any).value[0])
		// Math.random *is* ctx.random — two draws from one stream differ.
		expect((a as any).value[0]).not.toBe((a as any).value[1])
		expect((a as any).value[2]).toBe(42_000)
	})

	it("extras ride on ctx and are readable", async () => {
		const r = await run("return ctx.speakerName + '/' + text", {
			extras: { speakerName: "Ash" }
		})
		expect((r as any).value).toBe("Ash/hello world")
	})

	it("a syntax error names itself instead of vanishing", async () => {
		const r = await run("return text.((")
		expect(r.ok).toBe(false)
		expect((r as any).reason).toMatch(/SyntaxError/i)
	})
})

describe("the abuse corpus", () => {
	it("while(1) hits the interrupt, not the server", async () => {
		const r = await run("while (true) {}", { timeoutMs: 150 })
		expect(r.ok).toBe(false)
		expect((r as any).reason).toMatch(/timeout after 150ms/)
	}, 10_000)

	it("an allocation bomb hits the memory cap inside the sandbox", async () => {
		const r = await run(
			"let s = 'x'; while (true) { s += s; } return s.length",
			{ timeoutMs: 2_000, memoryLimitBytes: 16 * 1024 * 1024 }
		)
		expect(r.ok).toBe(false)
	}, 10_000)

	it("there is no host to escape to", async () => {
		const r = await run(
			`return [
				typeof process,
				typeof require,
				typeof fetch,
				typeof XMLHttpRequest,
				globalThis.Function('return typeof process')()
			]`
		)
		expect(r.ok).toBe(true)
		expect((r as any).value).toEqual([
			"undefined",
			"undefined",
			"undefined",
			"undefined",
			"undefined"
		])
	})

	it("the constructor chain arrives nowhere", async () => {
		// The classic node:vm escape. Here `Function` is QuickJS's own — the
		// evaluated code runs in the same sandbox, so 'escaping' lands where it
		// started.
		const r = await run(
			`try { return typeof ({}).constructor.constructor('return process')() }
			catch (e) { return 'threw' }`
		)
		expect(r.ok).toBe(true)
		expect(["undefined", "threw"]).toContain((r as any).value)
	})

	it("an oversized return is refused as such", async () => {
		const r = await run("return 'x'.repeat(100000)", {
			maxOutputBytes: 50_000
		})
		expect(r.ok).toBe(false)
		expect((r as any).reason).toMatch(/output exceeds/)
	})

	it("a value JSON cannot carry is refused, not smuggled", async () => {
		// Functions serialize away under JSON — passthrough, the harmless
		// reading. A cyclic object throws inside the sandbox and surfaces as
		// the script's own error.
		const f = await run("return function(){}")
		expect(f).toMatchObject({ ok: true, value: undefined })
		const c = await run("const a = {}; a.self = a; return a")
		expect(c.ok).toBe(false)
	})

	it("⚠ regex backtracking: the interrupt must fire inside the regexp engine", async () => {
		// The gap-between-clocks probe (18 §13.2). If a future engine build
		// stops checking interrupts during a catastrophic backtrack, the
		// pool's wall-clock kill is the answer — and this test is what turns
		// an engine bump into a decision instead of a surprise.
		const r = await run(`return /^(a+)+$/.test('a'.repeat(40) + 'b')`, {
			timeoutMs: 300
		})
		expect(r.ok).toBe(false)
		expect((r as any).reason).toMatch(/timeout/)
	}, 15_000)
})

describe("one evaluator, two hosts", () => {
	it("the inline fallback is behaviourally identical to the pool", async () => {
		const src =
			"ctx.log('via'); return text + ':' + Math.random().toFixed(6)"
		const pooled = await run(src, { seedLabel: "host:parity" })
		process.env.SP_SCRIPTS_INLINE = "1"
		try {
			const inline = await run(src, { seedLabel: "host:parity" })
			expect(pooled.ok && inline.ok).toBe(true)
			expect((inline as any).value).toEqual((pooled as any).value)
			expect(inline.logs).toEqual(pooled.logs)
		} finally {
			delete process.env.SP_SCRIPTS_INLINE
		}
	})
})
