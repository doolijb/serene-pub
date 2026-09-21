import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import fs from "fs"
import http from "http"
import os from "os"
import path from "path"
import { SesWorkerSandbox } from "./SesWorkerSandbox"
import { QuickJsSandbox } from "./QuickJsSandbox"
import type { PluginSandbox, SandboxKind } from "./types"

/**
 * The mediated fetch permission against a real local server, run identically on
 * **both** backends.
 *
 * Network used to be SES-only, because QuickJS had no way to hand a guest a
 * promise the host could settle. It has one now (`QuickJsSandbox`'s
 * `bridgeFetch`), and one `fetchHost.ts` source enforces the rules on both — so
 * every case here is a parity case, and the last describe asserts the *guest's*
 * view of a success and a refusal is byte-identical across the two.
 */

let server: http.Server
let baseUrl: string
let port = 0
const host = "127.0.0.1"
/** Paths the server actually served — proof of which hop a refusal landed on. */
let served: string[] = []

beforeAll(async () => {
	server = http.createServer((req, res) => {
		const url = req.url || "/"
		served.push(url)
		// Redirect to a host that is NOT in any test's allowlist — the classic
		// "allowlisted host bounces you to a forbidden target" SSRF.
		if (url.indexOf("/redir-external") === 0) {
			res.writeHead(302, { location: "http://blocked.example/evil" })
			return res.end()
		}
		// Redirect to the cloud-metadata endpoint (also not allowlisted).
		if (url.indexOf("/redir-metadata") === 0) {
			res.writeHead(302, {
				location: "http://169.254.169.254/latest/meta-data/"
			})
			return res.end()
		}
		// Redirect within the same (allowlisted) host — must be followed.
		if (url.indexOf("/redir-same") === 0) {
			res.writeHead(302, { location: "/final" })
			return res.end()
		}
		// Answers late, so a hook can return while its request is still open.
		if (url.indexOf("/slow") === 0) {
			setTimeout(() => {
				res.writeHead(200, { "content-type": "text/plain" })
				res.end("late")
			}, 400)
			return
		}
		res.writeHead(200, { "content-type": "text/plain" })
		res.end("hello:" + req.method + ":" + url)
	})
	await new Promise<void>((r) => server.listen(0, host, () => r()))
	const addr = server.address() as { port: number }
	port = addr.port
	baseUrl = `http://${host}:${addr.port}/`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

let rt: PluginSandbox
afterEach(async () => {
	await rt?.dispose()
	served = []
})

const make = (kind: SandboxKind): PluginSandbox =>
	kind === "ses" ? new SesWorkerSandbox() : new QuickJsSandbox()

const BACKENDS: SandboxKind[] = ["quickjs", "ses"]

const HOOK = `module.exports = { hooks: {
	get: async function (input, ctx) {
		var res = await ctx.fetch(input.url);
		return { status: res.status, ok: res.ok, body: res.body };
	}
} }`

// An oracle's ctx: the one kind granted `fetch` (hookCtx.ts, R-3).
const opts = (input: Record<string, unknown>) => ({
	input,
	kind: "oracle" as const,
	timeoutMs: 4000,
	seedLabel: "s",
	nowMs: 1
})

describe.each(BACKENDS)("fetch permission (%s)", (kind) => {
	it("fetches an allowed host", async () => {
		rt = make(kind)
		await rt.load("p", HOOK, "h", { networkHosts: [host] })
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "get" },
			opts({ url: baseUrl })
		)
		expect(r.ok).toBe(true)
		if (r.ok) {
			const v = r.value as { status: number; ok: boolean; body: string }
			expect(v.status).toBe(200)
			expect(v.ok).toBe(true)
			expect(v.body).toBe("hello:GET:/")
		}
	}, 15_000)

	it("denies a host not in the allowlist", async () => {
		rt = make(kind)
		await rt.load("p", HOOK, "h", { networkHosts: ["example.com"] })
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "get" },
			opts({ url: baseUrl })
		)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.reason).toMatch(/not permitted/)
		// Nothing left the process: the refusal is before the request, not after.
		expect(served).toEqual([])
	}, 15_000)

	it("denies fetch without a network grant", async () => {
		rt = make(kind)
		await rt.load("p", HOOK, "h") // no networkHosts
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "get" },
			opts({ url: baseUrl })
		)
		expect(r.ok).toBe(false)
		// The *named* refusal — never "host not permitted", which would leak
		// that the plugin had a network permission at all.
		if (!r.ok) expect(r.reason).toMatch(/permission not granted/)
	}, 15_000)

	// An allowlist an admin has emptied (every `network:<host>` denied) is not a
	// grant with nothing in it — the manager drops the whole permission, so the
	// hook hears the same "not granted" as a plugin that never asked.
	it("denies fetch when every host has been denied", async () => {
		rt = make(kind)
		await rt.load("p", HOOK, "h", { networkHosts: [] })
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "get" },
			opts({ url: baseUrl })
		)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.reason).toMatch(/permission not granted/)
	}, 15_000)

	it("rejects non-http(s) schemes", async () => {
		rt = make(kind)
		await rt.load("p", HOOK, "h", { networkHosts: [host] })
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "get" },
			opts({ url: "file:///etc/passwd" })
		)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.reason).toMatch(/only http\(s\)/)
	}, 15_000)

	// The internal-address gate, with no DNS in the way: the allowlist matches
	// (a bare `*` reaches the default web ports), and the request is refused
	// anyway because the target resolves internally and the entry that matched
	// was a wildcard rather than the literal target an admin named.
	it("refuses an internal address a wildcard grant happens to cover", async () => {
		rt = make(kind)
		await rt.load("p", HOOK, "h", { networkHosts: ["*"] })
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "get" },
			opts({ url: "http://169.254.169.254/latest/meta-data/" })
		)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.reason).toMatch(/private address/)
	}, 15_000)

	// The redirect-SSRF fix: the allowlist is re-checked on every hop, so an
	// allowlisted host cannot bounce the request to a forbidden target. The
	// `served` assertion is what makes it a *mid-chain* refusal — hop 1 really
	// happened, and hop 2 is where the check bit.
	it("refuses a redirect to a host outside the allowlist, mid-chain", async () => {
		rt = make(kind)
		await rt.load("p", HOOK, "h", { networkHosts: [host] })
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "get" },
			opts({ url: baseUrl + "redir-external" })
		)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.reason).toMatch(/not permitted/)
		expect(served).toEqual(["/redir-external"])
	}, 15_000)

	it("refuses a redirect to the cloud-metadata endpoint", async () => {
		rt = make(kind)
		await rt.load("p", HOOK, "h", { networkHosts: [host] })
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "get" },
			opts({ url: baseUrl + "redir-metadata" })
		)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.reason).toMatch(/not permitted/)
		expect(served).toEqual(["/redir-metadata"])
	}, 15_000)

	// Port scoping: an explicit host:port grant binds the request to that port.
	it("honours an explicit host:port grant and rejects the wrong port", async () => {
		rt = make(kind)
		await rt.load("p", HOOK, "h", { networkHosts: [`${host}:${port}`] })
		const ok = await rt.invoke(
			{ pluginId: "p", hookName: "get" },
			opts({ url: baseUrl })
		)
		expect(ok.ok).toBe(true)
		await rt.dispose()

		rt = make(kind)
		await rt.load("p", HOOK, "h", { networkHosts: [`${host}:1`] })
		const bad = await rt.invoke(
			{ pluginId: "p", hookName: "get" },
			opts({ url: baseUrl })
		)
		expect(bad.ok).toBe(false)
		if (!bad.ok) expect(bad.reason).toMatch(/not permitted/)
	}, 20_000)

	// A bare-hostname / wildcard grant reaches only the default web ports, so the
	// ephemeral test port is refused even though the host matches — closing the
	// any-port hole a bare grant used to leave open.
	it("refuses a wildcard grant on a non-web port", async () => {
		rt = make(kind)
		await rt.load("p", HOOK, "h", { networkHosts: ["*"] })
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "get" },
			opts({ url: baseUrl })
		)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.reason).toMatch(/not permitted/)
	}, 15_000)

	// The natural author pattern, and the one that asks most of the drive loop:
	// several guest promises the host has to settle independently while the hook
	// is parked on a single await.
	it("settles several concurrent fetches from one hook", async () => {
		rt = make(kind)
		await rt.load(
			"p",
			`module.exports = { hooks: { many: async function (input, ctx) {
				var rs = await Promise.all(input.urls.map(function (u) { return ctx.fetch(u); }));
				return rs.map(function (r) { return r.body; });
			} } }`,
			"h",
			{ networkHosts: [host] }
		)
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "many" },
			opts({ urls: [baseUrl + "a", baseUrl + "b", baseUrl + "c"] })
		)
		expect(r.ok).toBe(true)
		if (r.ok)
			expect(r.value).toEqual([
				"hello:GET:/a",
				"hello:GET:/b",
				"hello:GET:/c"
			])
	}, 15_000)

	it("still follows a redirect within an allowlisted host", async () => {
		rt = make(kind)
		await rt.load("p", HOOK, "h", { networkHosts: [host] })
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "get" },
			opts({ url: baseUrl + "redir-same" })
		)
		expect(r.ok).toBe(true)
		if (r.ok) {
			const v = r.value as { status: number; ok: boolean; body: string }
			expect(v.status).toBe(200)
			expect(v.body).toBe("hello:GET:/final") // landed on the redirect target
		}
		expect(served).toEqual(["/redir-same", "/final"])
	}, 15_000)
})

/**
 * A fetch outliving the call that started it.
 *
 * On QuickJS the guest's promise is a pair of handles into a per-call runtime
 * that is disposed the moment the hook returns — so a hook that fires a request
 * and does not await it leaves the host holding resolvers for a context that no
 * longer exists. Settling into one would be a use-after-free inside WASM, i.e. a
 * dead worker and every other plugin sharing it going with it. The bridge drops
 * the settle instead; this proves the worker is still there afterwards.
 */
const ABANDON = `module.exports = { hooks: {
	fireAndForget: function (input, ctx) {
		ctx.fetch(input.url);      // deliberately not awaited
		return { returned: true };
	},
	get: async function (input, ctx) {
		var res = await ctx.fetch(input.url);
		return { status: res.status, ok: res.ok, body: res.body };
	}
} }`

describe.each(BACKENDS)("a fetch outliving its call (%s)", (kind) => {
	it("is dropped, and the sandbox survives to serve the next call", async () => {
		rt = make(kind)
		await rt.load("p", ABANDON, "h", { networkHosts: [host] })
		const first = await rt.invoke(
			{ pluginId: "p", hookName: "fireAndForget" },
			opts({ url: baseUrl + "slow" })
		)
		expect(first.ok).toBe(true)
		// Let the abandoned request land on a torn-down context.
		await new Promise((r) => setTimeout(r, 700))
		const second = await rt.invoke(
			{ pluginId: "p", hookName: "get" },
			opts({ url: baseUrl })
		)
		expect(second.ok).toBe(true)
		if (second.ok)
			expect((second.value as { body: string }).body).toBe("hello:GET:/")
	}, 20_000)
})

/**
 * The parity contract, at the only altitude where it means anything: what the
 * **hook** sees. The two hosts wrap a thrown error differently on the way out
 * (QuickJS names it, SES does not), so a comparison of `r.reason` would be
 * comparing the backends' error reporting rather than the permission. This
 * compares the values a hook can observe from inside — the success object it
 * gets back, and the message of the error it catches.
 */
const PROBE = `module.exports = { hooks: {
	probe: async function (input, ctx) {
		var out = { ok: null, refused: null, denied: null };
		var res = await ctx.fetch(input.url);
		out.ok = { status: res.status, ok: res.ok, body: res.body, ct: res.headers["content-type"] };
		try { await ctx.fetch(input.blocked); }
		catch (e) { out.refused = { name: e.name, message: e.message, isError: e instanceof Error }; }
		return out;
	}
} }`

describe("the two backends are indistinguishable from inside a hook", () => {
	it("returns byte-identical success and refusal shapes", async () => {
		const seen: Record<string, unknown> = {}
		for (const kind of BACKENDS) {
			rt = make(kind)
			await rt.load("p", PROBE, "h", { networkHosts: [host] })
			const r = await rt.invoke(
				{ pluginId: "p", hookName: "probe" },
				opts({ url: baseUrl, blocked: "http://blocked.example/" })
			)
			expect(r.ok).toBe(true)
			if (r.ok) seen[kind] = r.value
			await rt.dispose()
		}
		expect(seen.quickjs).toEqual({
			ok: {
				status: 200,
				ok: true,
				body: "hello:GET:/",
				ct: "text/plain"
			},
			refused: {
				name: "Error",
				message: "fetch: host not permitted: blocked.example",
				isError: true
			},
			denied: null
		})
		// …and the other backend agrees, to the byte.
		expect(JSON.stringify(seen.ses)).toBe(JSON.stringify(seen.quickjs))
	}, 30_000)

	it("refuses a plugin with no grant in the same words on both", async () => {
		const seen: string[] = []
		for (const kind of BACKENDS) {
			rt = make(kind)
			await rt.load("p", DENIED_PROBE, "h") // no networkHosts
			const r = await rt.invoke(
				{ pluginId: "p", hookName: "probe" },
				opts({ url: baseUrl })
			)
			expect(r.ok).toBe(true)
			if (r.ok) seen.push(JSON.stringify(r.value))
			await rt.dispose()
		}
		expect(seen[0]).toBe(
			JSON.stringify({
				name: "Error",
				message: "network: permission not granted",
				// The refusal *throws*; it never resolves to a response object,
				// so a hook cannot mistake a denial for a failed request.
				threwSynchronously: true
			})
		)
		expect(seen[1]).toBe(seen[0])
	}, 30_000)
})

/** Catches the no-grant refusal and reports whether it threw before awaiting. */
const DENIED_PROBE = `module.exports = { hooks: {
	probe: async function (input, ctx) {
		var sync = false;
		try {
			var p = ctx.fetch(input.url);
			sync = false;
			await p;
		} catch (e) {
			return { name: e.name, message: e.message, threwSynchronously: !sync };
		}
		return { name: null, message: null, threwSynchronously: false };
	}
} }`

/**
 * What a hook may still do once its `ctx.signal` has fired.
 *
 * The cancellation grace (`hookGrace.ts`) gives an aborted hook a window to wind
 * itself down before core kills it, and that window has to be for *winding
 * down* — otherwise declaring an abort handler becomes a way to keep working for
 * another two seconds after the person pressed Cancel. So the line is drawn at
 * new **outbound** work, which is fetch, and nowhere else: local computation and
 * the hook's own scoped storage stay open, because managing local data is the
 * whole point of the window.
 */
const WIND_DOWN = `module.exports = { hooks: {
	windDown: async function (input, ctx) {
		var before = await ctx.fetch(input.url);
		await new Promise(function (res) {
			ctx.signal.addEventListener("abort", function () { res(1) });
		});
		var saved = ctx.storage.write("wound-down.txt", "flushed");
		var after = null;
		try { await ctx.fetch(input.url); }
		catch (e) { after = String(e && e.message); }
		return { beforeStatus: before.status, saved: saved, after: after };
	}
} }`

describe.each(BACKENDS)(
	"permissions during the cancellation grace (%s)",
	(kind) => {
		it("refuses new fetches once aborted, and still lets storage flush", async () => {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-winddown-"))
			try {
				rt = make(kind)
				await rt.load("p", WIND_DOWN, "h", {
					networkHosts: [host],
					storageDir: dir,
					quotaBytes: 10_000
				})
				const running = rt.invoke(
					{ pluginId: "p", hookName: "windDown" },
					{
						...opts({ url: baseUrl }),
						jobId: "wd",
						timeoutMs: 20_000
					}
				)
				await new Promise((r) => setTimeout(r, 300)) // let the first fetch land
				expect(rt.abort("wd")).toBe(true)
				const r = await running
				expect(r.ok).toBe(true)
				if (r.ok) {
					const v = r.value as {
						beforeStatus: number
						saved: boolean
						after: string
					}
					// The same permission, the same URL, before and after the abort.
					expect(v.beforeStatus).toBe(200)
					expect(v.after).toMatch(/cancelled/)
					expect(v.saved).toBe(true)
				}
				// …and the wind-down write is real, not merely un-refused.
				expect(
					fs.readFileSync(path.join(dir, "wound-down.txt"), "utf8")
				).toBe("flushed")
			} finally {
				fs.rmSync(dir, { recursive: true, force: true })
			}
		}, 30_000)
	}
)
