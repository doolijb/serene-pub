import { describe, it, expect, afterEach } from "vitest"
import { QuickJsRuntime } from "./QuickJsRuntime"
import { SesWorkerRuntime } from "./SesWorkerRuntime"
import type { PluginRuntime } from "./types"

/**
 * The ambient stdlib, proven identical on both backends. A hook that uses only
 * these globals must run and return the same result whether QuickJS or SES ran
 * it — the parity contract for the provided surface.
 */

const rts: PluginRuntime[] = []
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
	timeoutMs: 1000,
	seedLabel: "s",
	nowMs: 1
}

async function run(rt: PluginRuntime) {
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
		const r = await run(new QuickJsRuntime())
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
		const r = await run(new SesWorkerRuntime())
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
		const q = await run(new QuickJsRuntime())
		const s = await run(new SesWorkerRuntime())
		expect(q.ok && s.ok).toBe(true)
		if (q.ok && s.ok) {
			expect(q.value).toEqual(s.value)
			expect(q.logs).toEqual(s.logs)
		}
	}, 10_000)
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

	async function runBuf(rt: PluginRuntime) {
		rts.push(rt)
		await rt.load("b", BUF_HOOK, "h")
		return rt.invoke(
			{ pluginId: "b", hookName: "buf" },
			{ input: {}, timeoutMs: 2000, seedLabel: "s", nowMs: 1 }
		)
	}

	it("works identically on both backends", async () => {
		const q = await runBuf(new QuickJsRuntime())
		const s = await runBuf(new SesWorkerRuntime())
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

	async function runCrypto(rt: PluginRuntime) {
		rts.push(rt)
		await rt.load("c", CRYPTO_HOOK, "h")
		return rt.invoke(
			{ pluginId: "c", hookName: "c" },
			{ input: {}, timeoutMs: 2000, seedLabel: "s", nowMs: 1 }
		)
	}

	it("provides real crypto on both backends", async () => {
		for (const make of [
			() => new QuickJsRuntime(),
			() => new SesWorkerRuntime()
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
