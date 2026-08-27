import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import { RuntimeManager } from "./RuntimeManager"

/**
 * The tool substrate, end to end at the manager (20 §9): a sandboxed plugin
 * hook — the canonical tool — running async on SES, reaching the network
 * through its granted fetchHost, reading its settings from the reserved
 * input key, under the seeded RNG. This is the whole stack an AI-called tool
 * stands on; the advertise/parse tasks only decide when it is invoked.
 *
 * Also pins the discovery that made Phase 5 a verification instead of a
 * build: the SES worker awaits thenable hook results by design — the "async
 * hooks require the capability bridge" refusal is QuickJS's alone, which is
 * the security/speed dial working, not a gap.
 */

let server: http.Server
let host: string
let baseUrl: string
let mgr: RuntimeManager

const TOOL = `module.exports = { hooks: {
	// A realistic tool: authenticated lookup against a granted host, with a
	// deterministic roll mixed in — async end to end.
	lookup: async function (input, ctx) {
		var res = await ctx.fetch(input.args.url + "?q=" + input.args.q);
		var body = JSON.parse(res.body);
		return {
			answer: body.answer,
			usedKey: input.settings.apiKey,
			roll: Math.floor(ctx.random() * 20) + 1
		};
	}
} }`

beforeAll(async () => {
	server = http.createServer((req, res) => {
		res.setHeader("content-type", "application/json")
		res.end(JSON.stringify({ answer: `looked up ${req.url}` }))
	})
	host = "127.0.0.1"
	await new Promise<void>((r) => server.listen(0, host, () => r()))
	const port = (server.address() as any).port
	baseUrl = `http://${host}:${port}`

	mgr = new RuntimeManager({ onInvocation: () => {} })
	mgr.register({
		id: "acme/tools",
		name: "Acme Tools",
		bundleSource: TOOL,
		bundleHash: "h-tool",
		backends: ["ses"],
		backend: "ses",
		sequential: false,
		networkHosts: [host],
		settings: { apiKey: "sk-tool-1" }
	})
	mgr.markReady()
}, 60_000)

afterAll(async () => {
	await mgr?.dispose()
	server?.close()
})

describe("a sandboxed tool hook", () => {
	it("runs async on SES with fetch grant, settings, and seeded rolls", async () => {
		const r = await mgr.callHook(
			"acme/tools",
			"lookup",
			{ args: { url: baseUrl, q: "brand" } },
			{ timeoutMs: 8000, seedLabel: "run1:tool:0" }
		)
		expect(r.ok).toBe(true)
		const v: any = (r as any).value
		expect(v.answer).toBe("looked up /?q=brand")
		expect(v.usedKey).toBe("sk-tool-1")
		expect(v.roll).toBeGreaterThanOrEqual(1)
		expect(v.roll).toBeLessThanOrEqual(20)

		// Deterministic under the seed label — the replayable-roll law.
		const again = await mgr.callHook(
			"acme/tools",
			"lookup",
			{ args: { url: baseUrl, q: "brand" } },
			{ timeoutMs: 8000, seedLabel: "run1:tool:0" }
		)
		expect((again as any).value.roll).toBe(v.roll)
	}, 30_000)

	it("an ungranted host is refused inside the sandbox, not silently fetched", async () => {
		mgr.register({
			id: "acme/greedy",
			name: "Greedy",
			bundleSource: TOOL,
			bundleHash: "h-greedy",
			backends: ["ses"],
			backend: "ses",
			sequential: false,
			// No networkHosts: the fetch capability is simply never derived.
			settings: { apiKey: "x" }
		})
		const r = await mgr.callHook(
			"acme/greedy",
			"lookup",
			{ args: { url: baseUrl, q: "steal" } },
			{ timeoutMs: 8000 }
		)
		expect(r.ok).toBe(false)
		expect((r as any).reason).toMatch(/network|permission/i)
	}, 30_000)
})
