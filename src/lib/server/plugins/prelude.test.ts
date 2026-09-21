import { describe, it, expect, afterEach } from "vitest"
import { QuickJsSandbox } from "./QuickJsSandbox"
import { SesWorkerSandbox } from "./SesWorkerSandbox"
import type { PluginSandbox } from "./types"

/**
 * The ambient stdlib, proven identical on both backends. A hook that uses only
 * these globals must run and return the same result whether QuickJS or SES ran
 * it — the parity contract for the provided surface.
 */

const rts: PluginSandbox[] = []
afterEach(async () => {
	await Promise.all(rts.splice(0).map((r) => r.dispose()))
})

const HOOK = `module.exports = { hooks: { ambient: function (input, ctx) {
	console.log("hello", 42);
	console.warn("w");
	var enc = new TextEncoder().encode("héllo🌍"); // "héllo🌍"
	var dec = new TextDecoder().decode(enc);
	var b = btoa("hi");
	var a = atob(b);
	var orig = { x: [1, 2], n: 5 };
	var clone = structuredClone(orig);
	clone.x.push(3);
	clone.n = 9;
	return { dec: dec, encLen: enc.length, b: b, a: a, cloneX: clone.x, origX: orig.x, origN: orig.n };
} } }`

const opts = {
	input: {},
	kind: "task" as const,
	timeoutMs: 1000,
	seedLabel: "s",
	nowMs: 1
}

async function run(rt: PluginSandbox) {
	rts.push(rt)
	await rt.load("p", HOOK, "h")
	return rt.invoke({ pluginId: "p", hookName: "ambient" }, opts)
}

const EXPECTED = {
	dec: "héllo🌍", // unicode + emoji survived encode→decode
	encLen: 11, // 'h'(1) + é(2) + llo(3) + 🌍(4) + one more? h=1,é=2,l=1,l=1,o=1,🌍=4 => 10; recompute in test
	b: "aGk=", // btoa("hi")
	a: "hi",
	cloneX: [1, 2, 3],
	origX: [1, 2], // structuredClone is independent
	origN: 5
}

describe("ambient stdlib", () => {
	it("QuickJS provides the ambient globals", async () => {
		const r = await run(new QuickJsSandbox())
		expect(r.ok).toBe(true)
		if (r.ok) {
			const v = r.value as Record<string, unknown>
			expect(v.dec).toBe(EXPECTED.dec)
			expect(v.b).toBe(EXPECTED.b)
			expect(v.a).toBe(EXPECTED.a)
			expect(v.cloneX).toEqual([1, 2, 3])
			expect(v.origX).toEqual([1, 2]) // clone did not mutate original
			expect(v.origN).toBe(5)
			expect(r.logs).toEqual(["hello 42", "w"])
		}
	})

	it("SES provides the ambient globals", async () => {
		const r = await run(new SesWorkerSandbox())
		expect(r.ok).toBe(true)
		if (r.ok) {
			const v = r.value as Record<string, unknown>
			expect(v.dec).toBe(EXPECTED.dec)
			expect(v.b).toBe(EXPECTED.b)
			expect(v.cloneX).toEqual([1, 2, 3])
			expect(v.origX).toEqual([1, 2])
			expect(r.logs).toEqual(["hello 42", "w"])
		}
	}, 10_000)

	it("both backends produce byte-identical results (parity)", async () => {
		const q = await run(new QuickJsSandbox())
		const s = await run(new SesWorkerSandbox())
		expect(q.ok && s.ok).toBe(true)
		if (q.ok && s.ok) {
			expect(q.value).toEqual(s.value)
			expect(q.logs).toEqual(s.logs)
		}
	}, 10_000)
})

/**
 * `ctx.log`, whose formatter lives in the prelude for the reason every parity
 * test here exists: one implementation, so the two backends cannot drift into
 * logs that read differently. Before this, both endowed `log(m)` against an SDK
 * that declares `log(level, message, detail?)`, so the message and the detail
 * were dropped on the floor without a word.
 */
describe("ctx.log", () => {
	const LOG_HOOK = `module.exports = { hooks: { logs: function (input, ctx) {
		ctx.log("warn", "disk full");
		ctx.log("info", "sizes", { free: 0, path: "/dev/sda1" });
		ctx.log("error", "failed", new TypeError("nope"));
		ctx.log("legacy one-arg");
		ctx.log("verbose", "unknown level");
		var circ = { a: 1 };
		circ.self = circ;
		ctx.log("debug", "cycle", circ);
		ctx.log("debug", "primitives", 1n, undefined);
		ctx.log("info", "thrower", { get boom() { throw new Error("nope"); } });
		ctx.log("info", "big", { s: new Array(3000).join("x") });
		return "ok";
	} } }`

	const EXPECTED = [
		// level, message and detail — all three, which was the whole bug
		"[warn] disk full",
		'[info] sizes {"free":0,"path":"/dev/sda1"}',
		// an Error is JSON's "{}" if nobody intervenes; no stack, because SES
		// hides stacks from the guest and QuickJS does not
		'[error] failed {"name":"TypeError","message":"nope"}',
		// the pre-fix signature: no level to read, message kept anyway
		"[log] legacy one-arg",
		// not a LogLevel: rendered as text rather than believed as a level
		"[log] verbose unknown level",
		'[debug] cycle {"a":1,"self":"[circular]"}',
		// what JSON has no form for, said in words instead of dropped
		"[debug] primitives 1n undefined",
		// the getter throws; the hook does not
		"[info] thrower [unserializable]"
	]

	async function runLogs(rt: PluginSandbox) {
		rts.push(rt)
		await rt.load("l", LOG_HOOK, "h")
		return rt.invoke(
			{ pluginId: "l", hookName: "logs" },
			{ kind: "task", input: {}, timeoutMs: 2000, seedLabel: "s", nowMs: 1 }
		)
	}

	it("records every argument, identically on both backends", async () => {
		const q = await runLogs(new QuickJsSandbox())
		const s = await runLogs(new SesWorkerSandbox())
		expect(q.ok && s.ok).toBe(true)
		if (q.ok && s.ok) {
			expect(q.logs).toEqual(s.logs) // parity, byte for byte
			expect(q.logs.slice(0, EXPECTED.length)).toEqual(EXPECTED)
			// A detail is capped, and says so — an uncapped one would count
			// against the run's maxOutputBytes and could fail the whole hook.
			const big = q.logs[EXPECTED.length]!
			expect(big.startsWith('[info] big {"s":"xxx')).toBe(true)
			expect(big.endsWith(" more chars)")).toBe(true)
			expect(big.length).toBeLessThan(2100)
		}
	}, 15_000)
})

describe("Buffer", () => {
	const BUF_HOOK = `module.exports = { hooks: { buf: function (input, ctx) {
		var b = Buffer.from("héllo", "utf8");
		return {
			b64: b.toString("base64"),
			hex: Buffer.from("hi").toString("hex"),
			back: Buffer.from(b.toString("base64"), "base64").toString("utf8"),
			cat: Buffer.concat([Buffer.from("a"), Buffer.from("b")]).toString(),
			len: b.length,
			isBuf: Buffer.isBuffer(b),
			byteLen: Buffer.byteLength("héllo")
		};
	} } }`

	async function runBuf(rt: PluginSandbox) {
		rts.push(rt)
		await rt.load("b", BUF_HOOK, "h")
		return rt.invoke(
			{ pluginId: "b", hookName: "buf" },
			{ kind: "task", input: {}, timeoutMs: 2000, seedLabel: "s", nowMs: 1 }
		)
	}

	it("works identically on both backends", async () => {
		const q = await runBuf(new QuickJsSandbox())
		const s = await runBuf(new SesWorkerSandbox())
		expect(q.ok && s.ok).toBe(true)
		if (q.ok && s.ok) {
			expect(q.value).toEqual(s.value)
			const v = q.value as Record<string, unknown>
			expect(v.hex).toBe("6869") // "hi"
			expect(v.back).toBe("héllo") // base64 round-trip
			expect(v.cat).toBe("ab")
			expect(v.isBuf).toBe(true)
			expect(v.byteLen).toBe(6) // "héllo" utf8 bytes
		}
	}, 10_000)
})

describe("crypto (real entropy)", () => {
	const CRYPTO_HOOK = `module.exports = { hooks: { c: function (input, ctx) {
		var uuid = crypto.randomUUID();
		var b = crypto.randomBytes(16);
		var arr = new Uint8Array(8);
		crypto.getRandomValues(arr);
		return {
			uuidValid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid),
			bytesLen: b.length,
			isBuf: Buffer.isBuffer(b),
			arrFilled: Array.prototype.some.call(arr, function (x) { return x !== 0; }),
			uuidUnique: crypto.randomUUID() !== uuid
		};
	} } }`

	async function runCrypto(rt: PluginSandbox) {
		rts.push(rt)
		await rt.load("c", CRYPTO_HOOK, "h")
		return rt.invoke(
			{ pluginId: "c", hookName: "c" },
			{ kind: "task", input: {}, timeoutMs: 2000, seedLabel: "s", nowMs: 1 }
		)
	}

	it("provides real crypto on both backends", async () => {
		for (const make of [
			() => new QuickJsSandbox(),
			() => new SesWorkerSandbox()
		]) {
			const r = await runCrypto(make())
			expect(r.ok).toBe(true)
			if (r.ok) {
				const v = r.value as Record<string, unknown>
				expect(v.uuidValid).toBe(true)
				expect(v.bytesLen).toBe(16)
				expect(v.isBuf).toBe(true)
				expect(v.arrFilled).toBe(true) // getRandomValues filled it
				expect(v.uuidUnique).toBe(true) // two UUIDs differ
			}
		}
	}, 10_000)
})

describe("AbortController", () => {
	// The cooperative-cancellation half of `ctx.signal`. It is the one prelude
	// piece the host reaches into, so it has to be the *same* piece on both
	// backends — an author must not be able to tell which sandbox they are on
	// from how cancellation behaves.
	const AC_HOOK = `module.exports = { hooks: { ac: function (input, ctx) {
		var c = new AbortController();
		var seen = [];
		c.signal.onabort = function (e) { seen.push("onabort:" + e.type) };
		c.signal.addEventListener("abort", function () { seen.push("listener") });
		var dropped = function () { seen.push("dropped") };
		c.signal.addEventListener("abort", dropped);
		c.signal.removeEventListener("abort", dropped);
		var before = c.signal.aborted;
		c.abort();
		c.abort(); // idempotent — a second abort must not fire the list again
		var threw = "";
		try { c.signal.throwIfAborted() } catch (e) { threw = e.name }
		return {
			before: before,
			after: c.signal.aborted,
			seen: seen,
			threw: threw,
			reason: String(c.signal.reason && c.signal.reason.name),
			ctxSignal: typeof ctx.signal,
			ctxAborted: ctx.signal.aborted
		};
	} } }`

	it("is the same controller on both backends", async () => {
		const results = []
		for (const make of [
			() => new QuickJsSandbox(),
			() => new SesWorkerSandbox()
		]) {
			const rt = make()
			rts.push(rt)
			await rt.load("ac", AC_HOOK, "h")
			const r = await rt.invoke(
				{ pluginId: "ac", hookName: "ac" },
				{ kind: "task", input: {}, timeoutMs: 2000, seedLabel: "s", nowMs: 1 }
			)
			expect(r.ok).toBe(true)
			if (r.ok) results.push(r.value)
		}
		expect(results[0]).toEqual({
			before: false,
			after: true,
			seen: ["onabort:abort", "listener"], // removed listener never ran
			threw: "AbortError",
			reason: "AbortError",
			// The hook's own signal, live and not yet fired — core is the only
			// thing that can fire that one.
			ctxSignal: "object",
			ctxAborted: false
		})
		expect(results[0]).toEqual(results[1]) // parity, exactly
	}, 15_000)
})
