/**
 * The read-only allowed-hosts surface (plan 26 §9, re-scoped).
 *
 * What matters here is provenance and honesty: every host the page shows must
 * be one enforcement actually consults, each labelled with where it came from,
 * and the wildcard must be reported as "the list is off" rather than folded in
 * as though it were one more allowed hostname.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const ORIGINAL_ENV = { ...process.env }

let activeTunnelHostname: string | null = null
vi.mock("$lib/server/tunnels/supervisor", () => ({
	getActiveTunnelHostname: () => activeTunnelHostname
}))

beforeEach(() => {
	delete process.env.ALLOWED_ORIGINS
	activeTunnelHostname = null
})

afterEach(() => {
	process.env = { ...ORIGINAL_ENV }
})

const noopEmit = () => {}
const adminSocket = { user: { id: 1, isAdmin: true } } as any

describe("allowedHosts:get", () => {
	test("refuses a non-admin", async () => {
		const { allowedHostsGet } = await import("./allowedHosts")
		await expect(
			allowedHostsGet.handler(
				{ user: { id: 2, isAdmin: false } } as any,
				{},
				noopEmit
			)
		).rejects.toThrow(/Unauthorized/)
	})

	test("reports the built-in hosts with no configuration", async () => {
		const { allowedHostsGet } = await import("./allowedHosts")
		const res = await allowedHostsGet.handler(adminSocket, {}, noopEmit)
		expect(res.wildcard).toBe(false)
		expect(res.hosts).toEqual([
			{ hostname: "localhost", source: "builtin" },
			{ hostname: "127.0.0.1", source: "builtin" },
			{ hostname: "::1", source: "builtin" }
		])
	})

	test("attributes an environment-configured host to ALLOWED_ORIGINS", async () => {
		process.env.ALLOWED_ORIGINS = "serene.example.com"
		const { allowedHostsGet } = await import("./allowedHosts")
		const res = await allowedHostsGet.handler(adminSocket, {}, noopEmit)
		expect(res.hosts).toContainEqual({
			hostname: "serene.example.com",
			source: "env"
		})
	})

	test("attributes a running tunnel's hostname to the tunnel", async () => {
		// It is reachable and allowed, but via the same-hostname rule rather
		// than the list — labelling it "tunnel" says so without implying an
		// entry an admin could delete here.
		activeTunnelHostname = "brave-cat-runs.trycloudflare.com"
		const { allowedHostsGet } = await import("./allowedHosts")
		const res = await allowedHostsGet.handler(adminSocket, {}, noopEmit)
		expect(res.hosts).toContainEqual({
			hostname: "brave-cat-runs.trycloudflare.com",
			source: "tunnel"
		})
	})

	test("does not list the tunnel twice when it is also in ALLOWED_ORIGINS", async () => {
		process.env.ALLOWED_ORIGINS = "brave-cat-runs.trycloudflare.com"
		activeTunnelHostname = "brave-cat-runs.trycloudflare.com"
		const { allowedHostsGet } = await import("./allowedHosts")
		const res = await allowedHostsGet.handler(adminSocket, {}, noopEmit)
		expect(
			res.hosts.filter(
				(h) => h.hostname === "brave-cat-runs.trycloudflare.com"
			)
		).toHaveLength(1)
	})

	test("reports the wildcard as a flag, never as an allowed hostname", async () => {
		process.env.ALLOWED_ORIGINS = "*,serene.example.com"
		const { allowedHostsGet } = await import("./allowedHosts")
		const res = await allowedHostsGet.handler(adminSocket, {}, noopEmit)
		expect(res.wildcard).toBe(true)
		expect(res.hosts.map((h) => h.hostname)).not.toContain("*")
		// The other entries are still reported — the page's job is to say they
		// are inert, not to pretend they were never configured.
		expect(res.hosts).toContainEqual({
			hostname: "serene.example.com",
			source: "env"
		})
	})
})
