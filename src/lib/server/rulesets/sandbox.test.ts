/**
 * 🚧 The rules sandbox (D3, 2026-10-23): one context per moment, modules
 * loaded once by hash, handlers called as often as needed, one budget per
 * turn, seeded randomness per call — on the worker and inline alike.
 */
import { afterEach, describe, expect, it } from "vitest"
import { moduleBodyProgram, openRulesSandbox, sandboxStats, sourceHash, withRulesSandbox } from "./sandbox"

const BODY = `
export function effects(ctx) { return { deltas: [{ attribute: "mood", op: "add", value: ctx.options.by }], lines: ["felt " + ctx.owner.name] } }
export const derived = (ctx) => ({ values: { twice: ctx.values.base * 2 } })
function helper(x) { return x + 1 }
export function after(ctx) { return { roll: Math.random(), again: ctx.random(), now: Date.now(), plus: helper(1) } }
`

describe("the program a module body becomes", () => {
	it("strips export keywords and hands the handlers back by name", () => {
		const p = moduleBodyProgram(BODY)
		expect(p).not.toMatch(/\bexport\b/)
		expect(p).toContain(`effects: typeof effects === "function" ? effects : undefined`)
		expect(p).toContain(`members: typeof members === "function" ? members : undefined`)
	})
	it("hashes by form and source", () => {
		expect(sourceHash("module", "a")).toBe(sourceHash("module", "a"))
		expect(sourceHash("module", "a")).not.toBe(sourceHash("legacy", "a"))
	})
})

for (const mode of ["worker", "inline"] as const) {
	describe(`one context per moment (${mode})`, () => {
		const before = process.env.SP_SCRIPTS_INLINE
		afterEach(() => {
			if (before === undefined) delete process.env.SP_SCRIPTS_INLINE
			else process.env.SP_SCRIPTS_INLINE = before
		})
		const open = () => {
			if (mode === "inline") process.env.SP_SCRIPTS_INLINE = "1"
			else delete process.env.SP_SCRIPTS_INLINE
			return openRulesSandbox({ budgetMs: 2000 })
		}

		it("loads a module once and calls its handlers many times", async () => {
			const opened = sandboxStats.opened
			const sb = await open()
			try {
				const a = await sb.load("module", BODY)
				const b = await sb.load("module", BODY)
				expect(a).toEqual(b)
				expect(sb.spent().loads).toBe(1)
				if (!a.ok) throw new Error(a.reason)
				const e1 = await sb.call(a.key, "effects", { owner: { name: "Ann" }, options: { by: 2 } }, "l:1")
				const e2 = await sb.call(a.key, "effects", { owner: { name: "Bo" }, options: { by: -1 } }, "l:2")
				expect(e1).toMatchObject({ ok: true, value: { deltas: [{ attribute: "mood", op: "add", value: 2 }], lines: ["felt Ann"] } })
				expect(e2).toMatchObject({ ok: true, value: { deltas: [{ value: -1 }], lines: ["felt Bo"] } })
				const d = await sb.call(a.key, "derived", { values: { base: 21 } }, "l:3")
				expect(d).toMatchObject({ ok: true, value: { values: { twice: 42 } } })
				// A handler the module does not export is missing, never a failure.
				const m = await sb.call(a.key, "render", {}, "l:4")
				expect(m).toMatchObject({ ok: true, missing: true })
				expect(sb.spent().calls).toBe(4)
			} finally {
				await sb.close()
			}
			expect(sandboxStats.opened).toBe(opened + 1)
		})

		it("seeds each call by its label, whatever ran before; Date.now is 0", async () => {
			await withRulesSandbox({}, async (sb) => {
				const { key } = (await sb.load("module", BODY)) as { key: string }
				const x = await sb.call(key, "after", {}, "seed:x")
				await sb.call(key, "after", {}, "seed:other")
				const x2 = await sb.call(key, "after", {}, "seed:x")
				const y = await sb.call(key, "after", {}, "seed:y")
				const v = (r: typeof x) => (r.ok ? (r.value as Record<string, number>) : {})
				expect(v(x)).toEqual(v(x2))
				expect(v(x).roll).not.toBe(v(y).roll)
				expect(v(x).roll).not.toBe(v(x).again)
				expect(v(x).now).toBe(0)
				expect(v(x).plus).toBe(2)
			})
		})

		it("reads a seeded script as a module: a body handed value and ctx", async () => {
			await withRulesSandbox({}, async (sb) => {
				const l = await sb.load("legacy", "ctx.log('hi'); return { n: value.n + 1, r: ctx.random() < 1 }")
				if (!l.ok) throw new Error(l.reason)
				const r = await sb.call(l.key, "legacy", { n: 41 }, "s")
				expect(r).toMatchObject({ ok: true, value: { n: 42, r: true }, logs: ["hi"] })
			})
		})

		it("a module cannot take the door from another", async () => {
			await withRulesSandbox({}, async (sb) => {
				const bad = await sb.load("module", `globalThis.__rules = null; export function effects() { return 1 }`)
				expect(bad.ok).toBe(false)
				const good = await sb.load("module", BODY)
				expect(good.ok).toBe(true)
			})
		})
	})
}

describe("one budget per turn", () => {
	it("a runaway call stops at its cap; the turn's budget runs out and later calls are refused", async () => {
		const sb = await openRulesSandbox({ budgetMs: 300, callCapMs: 120 })
		try {
			const l = await sb.load("module", `export function effects() { for (;;) {} }`)
			if (!l.ok) throw new Error(l.reason)
			const first = await sb.call(l.key, "effects", {}, "a")
			expect(first.ok).toBe(false)
			expect(!first.ok && first.reason).toMatch(/timeout/)
			await sb.call(l.key, "effects", {}, "b")
			await sb.call(l.key, "effects", {}, "c")
			const last = await sb.call(l.key, "effects", {}, "d")
			expect(last.ok).toBe(false)
			expect(!last.ok && last.reason).toMatch(/budget .* is spent/)
			expect(sb.remaining()).toBe(0)
		} finally {
			await sb.close()
		}
	}, 30_000)
})
