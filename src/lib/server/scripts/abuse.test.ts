/**
 * The abuse corpus (18 §10) — parity-corpus standing.
 *
 * "We chose a good engine" is the claim; this file staying green is the proof.
 * Every case asserts that a known trick fails **in the specific way it should**
 * — interrupted, out of memory, refused by the schema — because "it did not
 * work" is also what a silently broken sandbox looks like.
 *
 * Grown every time anyone finds a new trick. A case removed here is a claim
 * withdrawn, so removing one needs the same argument as adding one.
 */

import { describe, it, expect } from "vitest"
import {
	runScriptSource,
	SCRIPT_LOG_LINE_MAX
} from "$lib/server/pipelines/scripts/host"

// The production host: every script in the app runs through `runScriptSource`
// (a QuickJS worker with a wall-clock backstop), so the corpus proves that path.
const run = (
	source: string,
	over: Partial<Parameters<typeof runScriptSource>[0]> = {}
) =>
	runScriptSource({
		source,
		vars: { text: "hello" },
		seedLabel: "seed:abuse",
		nowMs: 1_700_000_000_000,
		...over
	})

/** The reason of a failed run ("" for a success). */
const reasonOf = (r: Awaited<ReturnType<typeof run>>) => (r.ok ? "" : r.reason)

/** The value of a successful run, typed loosely for `.text` reads. */
const val = (r: Awaited<ReturnType<typeof run>>) =>
	(r.ok ? r.value : undefined) as Record<string, unknown>

// Pins the engine the production host (`runScriptSource`) loads.
const PINNED_ENGINE = "0.32.0"

describe("the engine is the one we pinned", () => {
	it("matches package.json, so a bump cannot arrive unnoticed", async () => {
		// No lockfile here — deliberately, for multi-platform builds — so this
		// constant is the pin. A version check catches an accidental bump, not
		// a compromised tarball; hashing the binary is the follow-on once it is
		// vendored rather than resolved.
		const pkg = await import("../../../../package.json")
		expect((pkg.default as any).dependencies["quickjs-emscripten"]).toBe(
			PINNED_ENGINE
		)
	})
})

describe("escape attempts have nothing to walk to", () => {
	it("cannot reach a host global through the constructor chain", async () => {
		const r = await run(`
			try {
				var F = (function(){}).constructor;
				return { text: String(F("return typeof process")()) }
			} catch (e) { return { text: "threw: " + e.name } }
		`)
		// Either spelling is a pass: what must not happen is 'object'.
		expect(r.ok).toBe(true)
		expect(String(val(r).text)).not.toContain("object")
	})

	it('cannot reach the host realm via Function("return this")', async () => {
		const r = await run(`
			var g = Function("return this")();
			return { text: [typeof g.process, typeof g.require, typeof g.fetch,
			                typeof g.globalThis.Buffer].join(",") }
		`)
		expect(r.ok).toBe(true)
		expect(val(r).text).toBe("undefined,undefined,undefined,undefined")
	})

	it("has no module loader, no network and no clock to spin on", async () => {
		const r = await run(`
			return { text: ["require","import","fetch","XMLHttpRequest","setTimeout",
			                "setInterval","process","Buffer","WebAssembly"]
				.map(function (k) { return k + "=" + typeof globalThis[k] }).join(" ") }
		`)
		expect(r.ok).toBe(true)
		expect(String(val(r).text)).not.toMatch(/=(function|object)/)
	})

	it("cannot read the host's script through ctx", async () => {
		// `ctx` is the only host object in scope, and it holds exactly two
		// primitives-only callables. Anything else on it would be a door.
		const r = await run(`
			return { text: Object.getOwnPropertyNames(ctx).sort().join(",") }
		`)
		expect(val(r).text).toBe("log,random")
	})

	it("cannot make ctx.random or ctx.log return a host object", async () => {
		const r = await run(`
			return { text: typeof ctx.random() + "," + typeof ctx.log("x") }
		`)
		expect(val(r).text).toBe("number,undefined")
	})
})

describe("prototype pollution stays inside the sandbox", () => {
	it("can pollute within one evaluation, so the next case is not vacuous", async () => {
		// Asserted first, deliberately. If `Object.prototype` were frozen or
		// the write silently failed, the cross-evaluation case below would pass
		// for the wrong reason and prove nothing about context freshness.
		const r = await run(`
			Object.prototype.polluted = "yes";
			return { text: String(({}).polluted) }
		`)
		expect(val(r).text).toBe("yes")
	})

	it("cannot reach across evaluations, because each gets a fresh context", async () => {
		const first = await run(`
			Object.prototype.polluted = "yes";
			return { text: "set" }
		`)
		expect(first.ok).toBe(true)

		const second = await run(`
			return { text: String(({}).polluted) }
		`)
		// The security property, the purity law (F11) and the replay property,
		// all from the same move: no state survives between runs.
		expect(val(second).text).toBe("undefined")
	})

	it("cannot pollute the host process", async () => {
		await run(`Object.prototype.__hostPolluted = 1; return { text: "x" }`)
		expect(({} as Record<string, unknown>).__hostPolluted).toBeUndefined()
	})
})

describe("the clocks hold", () => {
	it("interrupts a bare infinite loop", async () => {
		const r = await run(`while (true) {}`, { timeoutMs: 150 })
		expect(r.ok).toBe(false)
		expect(reasonOf(r)).toMatch(/timeout after \d+ms/)
	})

	it("interrupts catastrophic regex backtracking", async () => {
		// ⚠ The case §7 item 3 says to test rather than assume. The interrupt
		// runs between VM instructions, and a regex engine that backtracks
		// inside one native call would never yield to it — a hostile ReDoS
		// pattern would then be a gap *between* the two clocks.
		//
		// It is not, on this build: the interrupt fires mid-`exec`, with the
		// native frame in the stack. Deleting this case is withdrawing that
		// claim, and the answer is engine-version-specific.
		const r = await run(
			`var s = new Array(41).join("a") + "b"; return { text: String(/^(a+)+$/.test(s)) }`,
			{ timeoutMs: 200 }
		)
		expect(r.ok).toBe(false)
		expect(reasonOf(r)).toMatch(/timeout after \d+ms/)
	})

	it("interrupts a loop that swallows its own exceptions", async () => {
		// The obvious way to try to outlive an interrupt: catch whatever it
		// throws and keep going. The interrupt is not a catchable exception in
		// the script's sense — it unwinds the whole evaluation.
		const r = await run(`while (true) { try { null.x } catch (e) {} }`, {
			timeoutMs: 150
		})
		expect(r.ok).toBe(false)
	})

	it("still finishes fast work well inside the budget", async () => {
		// The corpus must not pass by refusing everything.
		const r = await run(`return { text: text.toUpperCase() }`)
		expect(r.ok).toBe(true)
		expect(val(r).text).toBe("HELLO")
	})
})

describe("allocation bombs surface as script errors, not host pressure", () => {
	// ⚠ A generous CPU budget on purpose. These asserted only `result: 'err'`
	// at first, and a mutation that removed the memory limit entirely left them
	// green — the *interrupt* was catching the bombs, so the cases proved
	// nothing about §7 item 4. The budget is now far past what the allocation
	// takes, and the reason is asserted, so only the memory cap can pass them.
	const ROOMY = { timeoutMs: 30_000, memoryLimitBytes: 2 * 1024 * 1024 }

	// Two different engine guards, and both count. An allocation that grows the
	// heap trips the memory cap; one that grows a single string trips a
	// separate string-length limit first. What must *not* appear in either
	// reason is "interrupted" — that would mean the clock caught it and this
	// section is testing the clock again.
	const ALLOCATION_GUARD = /out of memory|string too long/i

	it("stops a runaway allocation, and says it ran out of memory", async () => {
		const r = await run(
			`var a = []; while (true) { a.push({ x: 1, y: 2, z: [1, 2, 3] }) }`,
			ROOMY
		)
		expect(r.ok).toBe(false)
		expect(reasonOf(r)).toMatch(ALLOCATION_GUARD)
		expect(reasonOf(r)).not.toMatch(
			/interrupt|timeout after|too long and was/i
		)
	})

	it("stops a runaway string concatenation the same way", async () => {
		const r = await run(
			`var s = "x"; while (true) { s = s + s } return { text: s }`,
			ROOMY
		)
		expect(r.ok).toBe(false)
		expect(reasonOf(r)).toMatch(ALLOCATION_GUARD)
		expect(reasonOf(r)).not.toMatch(
			/interrupt|timeout after|too long and was/i
		)
	})

	it("keeps the cap per context, so the next script has its full budget", async () => {
		// The cap is per context and contexts are per evaluation, so a bomb
		// must not leave the *next* script poorer. If the runtime leaked, this
		// would start failing intermittently rather than obviously.
		const after = await run(
			`var a = []; for (var i = 0; i < 5000; i++) a.push(i); return { text: String(a.length) }`,
			ROOMY
		)
		expect(after.ok).toBe(true)
		expect(val(after).text).toBe("5000")
	})
})

describe("output is bounded like network input", () => {
	it("refuses a return over the ceiling, and says the numbers", async () => {
		const r = await run(`return { text: new Array(200000).join("x") }`, {
			maxOutputBytes: 1024
		})
		expect(r.ok).toBe(false)
		// Production words the ceiling `output exceeds <n> bytes` (was `over its ceiling of 1024`).
		expect(reasonOf(r)).toMatch(/output exceeds 1024 bytes/)
	})
})

describe("the declared-I/O rule has teeth", () => {
	it("gives the script only what it declared", async () => {
		const r = await run(`return { text: typeof secret }`, {
			vars: { text: "hi" }
		})
		// `secret` was never serialized in, so it is not merely unreadable —
		// it is not there. Least privilege at the data level.
		expect(val(r).text).toBe("undefined")
	})

	it("treats a bare return as passthrough, not as an empty write", async () => {
		const r = await run(`if (text.length > 0) return; return { text: "" }`)
		expect(r.ok).toBe(true)
		// Production answers a bare return as `value === undefined` (was `passthrough: true, value: {}`).
		expect(r.ok && r.value).toBeUndefined()
	})
})

describe("nothing ambient survives, so a script replays", () => {
	it("leaves an explicit date alone — only the ambient one is pinned", async () => {
		const r = await run(
			`return { text: String(new Date(86400000).getTime()) }`
		)
		expect(val(r).text).toBe("86400000")
	})

	it("pins a bare new Date() and Date() to the run's start, like Date.now (★K-3)", async () => {
		const r = await run(`
			return {
				text: [
					new Date().getTime(),
					Date.now(),
					new Date(Date()).getTime() === new Date(new Date().toString()).getTime(),
					new Date(0).getTime()
				].join(",")
			}
		`)
		expect(val(r).text).toBe("1700000000000,1700000000000,true,0")
		const later = await run(
			`return { text: String(new Date().getTime()) }`,
			{
				nowMs: 1_700_000_005_000
			}
		)
		expect(val(later).text).toBe("1700000005000")
	})

	it("gives the same run seed the same numbers, twice", async () => {
		const src = `return { text: [ctx.random(), Math.random()].join(",") }`
		const a = await run(src, { seedLabel: "seed:replay" })
		const b = await run(src, { seedLabel: "seed:replay" })
		const c = await run(src, { seedLabel: "seed:different" })
		expect(val(a).text).toBe(val(b).text)
		expect(val(a).text).not.toBe(val(c).text)
	})

	it("remaps Math.random onto the same stream rather than removing it", async () => {
		// A script using Math.random is not doing anything wrong. It just must
		// not be the one thing in a replayed run that differs.
		const r = await run(
			`return { text: String(Math.random() === Math.random()) }`
		)
		expect(val(r).text).toBe("false")
		const same = await run(`
			var a = ctx.random(), b = Math.random();
			return { text: String(a !== b) }
		`)
		expect(val(same).text).toBe("true")
	})
})

describe("a log line is bounded (★K-3)", () => {
	it("cuts one line at the cap and keeps the rest of the log", async () => {
		const r = await run(`
			ctx.log(new Array(${SCRIPT_LOG_LINE_MAX} + 101).join("x"));
			ctx.log("after");
			return { text: "ok" }
		`)
		expect(r.logs).toHaveLength(2)
		expect(r.logs[0]).toHaveLength(SCRIPT_LOG_LINE_MAX)
		expect(r.logs[1]).toBe("after")
	})
})

describe("the deleted in-process path's other guarantees, where the chain holds them instead (★K-3, 2026-11-14)", () => {
	// `pipelines/scripts/chains.ts:516-548`: a transform that returns a value for
	// a subject its step does not declare is kept, recorded "read-only, value
	// kept"; `validShape` refuses a scalar where the type declares an object.
	it.todo(
		"a return carrying an undeclared out — the chain keeps the value and records the reason, not an error"
	)
	it.todo(
		"a transform returning a scalar for an object type — `validShape` refuses it in the chain, not the host"
	)
	it.todo(
		"a verdict operation returning a scalar — the chain never merges it"
	)
	it.todo(
		"ctx.log lines from a link that then failed — the chain records `logs` on the failed link"
	)
})

describe("a failing link degrades, it does not throw (S2)", () => {
	it("reports a thrown Error as a reason a user can act on", async () => {
		const r = await run(`throw new Error("my filter is broken")`)
		expect(r.ok).toBe(false)
		expect(reasonOf(r)).toContain("my filter is broken")
	})

	it("reports a thrown non-Error without rendering [object Object]", async () => {
		const r = await run(`throw { weird: true }`)
		expect(r.ok).toBe(false)
		expect(reasonOf(r)).not.toContain("[object Object]")
	})

	it("reports a syntax error rather than crashing the host", async () => {
		const r = await run(`this is not javascript`)
		expect(r.ok).toBe(false)
		expect(reasonOf(r)).toBeTruthy()
	})
})
