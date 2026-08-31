/**
 * Cloudflare Quick Tunnel supervisor (plan 26 §7, phase B).
 *
 * One process, one hostname — Socket.IO shares the app's HTTP server, so there
 * is a single port to expose. These tests assert the URL is captured off
 * cloudflared's real output shape, reaches the row, and that a process which
 * dies before announcing marks the row errored rather than leaving it claiming
 * `running` against a URL nobody can reach.
 *
 * `spawn` is mocked: the alternative is downloading a real cloudflared and
 * opening a real tunnel to the public internet from a test run.
 */
import { EventEmitter } from "events"
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi
} from "vitest"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import { LOCAL_SERVER_SLUG } from "$lib/shared/constants/Tunnels"

let testDb: TestDb
let serverId: number

class FakeProc extends EventEmitter {
	stdout = new EventEmitter()
	stderr = new EventEmitter()
	// Deliberately undefined: killProc() group-kills via a negative PID, and a
	// fabricated PID in a test would signal a real, unrelated process group.
	pid: number | undefined = undefined
	kill = vi.fn()
}

const spawned: { args: string[]; proc: FakeProc }[] = []
const spawnMock = vi.fn((_bin: string, args: string[]) => {
	const proc = new FakeProc()
	spawned.push({ args, proc })
	return proc as any
})

vi.mock("child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("child_process")>()
	return { ...actual, spawn: (...a: any[]) => (spawnMock as any)(...a) }
})

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	// start() enforces the accounts gate itself (26 §5) — auto-start never
	// passes through a socket handler, so a gate that lived only there would be
	// bypassed by exactly the path with nobody watching.
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1, isAccountsEnabled: true })
	const [server] = await testDb
		.insert(schema.servers)
		.values({
			slug: LOCAL_SERVER_SLUG,
			name: "This instance",
			isSeeded: true
		})
		.returning()
	serverId = server.id
	// Short-circuits the download entirely — an admin with cloudflared already
	// installed uses this same path.
	process.env.SERENE_PUB_CLOUDFLARED_PATH = process.execPath
	process.env.PORT = "3000"
}, 60_000)

beforeEach(() => {
	spawned.length = 0
	spawnMock.mockClear()
})

afterEach(async () => {
	const { stop, stopTtlSweep } = await import("./supervisor")
	stopTtlSweep()
	await stop().catch(() => {})
	await testDb.delete(schema.tunnels)
	await setAccounts(true)
	delete process.env.SERENE_PUB_PLATFORM
})

async function setAccounts(enabled: boolean) {
	await testDb
		.update(schema.systemSettings)
		.set({ isAccountsEnabled: enabled })
		.where(eq(schema.systemSettings.id, 1))
}

async function makeQuickTunnel() {
	const [row] = await testDb
		.insert(schema.tunnels)
		.values({
			serverId,
			provider: "cloudflare_quick",
			mode: "ephemeral"
		})
		.returning()
	return row
}

/** Feed cloudflared's real announcement shape through stderr. */
function announce(proc: FakeProc, hostname: string) {
	proc.stderr.emit(
		"data",
		Buffer.from(
			"2026-08-29T12:00:00Z INF +------------------------------------+\n" +
				"2026-08-29T12:00:00Z INF |  Your quick Tunnel has been created! |\n" +
				`2026-08-29T12:00:00Z INF |  https://${hostname}  |\n` +
				"2026-08-29T12:00:00Z INF +------------------------------------+\n"
		)
	)
}

/** Wait for cloudflared to be spawned, then announce its hostname. */
async function announceWhenSpawned(hostname: string) {
	for (let i = 0; i < 200 && spawned.length === 0; i++) {
		await new Promise((r) => setTimeout(r, 5))
	}
	if (spawned.length === 0) throw new Error("cloudflared never spawned")
	announce(spawned[0].proc, hostname)
}

describe("extractQuickTunnelHostname", () => {
	test("finds the hostname inside cloudflared's ASCII box, and ignores unrelated URLs", async () => {
		const { extractQuickTunnelHostname } = await import("./supervisor")
		expect(
			extractQuickTunnelHostname(
				"INF |  https://brave-cat-runs.trycloudflare.com  |"
			)
		).toBe("brave-cat-runs.trycloudflare.com")
		expect(
			extractQuickTunnelHostname("INF Requesting new quick Tunnel...")
		).toBeNull()
		expect(
			extractQuickTunnelHostname(
				"INF see https://developers.cloudflare.com"
			)
		).toBeNull()
	})
})

describe("supervisor.start", () => {
	test("spawns one cloudflared pointed at the app port and records the hostname", async () => {
		const { start } = await import("./supervisor")
		const tunnel = await makeQuickTunnel()

		const started = start(tunnel.id)
		await announceWhenSpawned("app-host.trycloudflare.com")
		const row = await started

		// One process, because there is one port. Socket.IO shares the app's
		// HTTP server, so there is no second listener to front.
		expect(spawnMock).toHaveBeenCalledTimes(1)
		expect(spawned[0].args).toEqual([
			"tunnel",
			"--no-autoupdate",
			"--url",
			"http://127.0.0.1:3000"
		])

		expect(row.enabled).toBe(true)
		expect(row.status).toBe("running")
		expect(row.hostname).toBe("app-host.trycloudflare.com")
		expect(row.lastError).toBeNull()
	})

	test("grants the dev server exactly the hostname it was given, and nothing wider", async () => {
		const granted: string[] = []
		;(globalThis as any).__SERENE_PUB_ALLOW_DEV_HOST__ = (h: string) =>
			granted.push(h)
		try {
			const { start } = await import("./supervisor")
			const tunnel = await makeQuickTunnel()
			const started = start(tunnel.id)
			await announceWhenSpawned("app-host.trycloudflare.com")
			await started

			// Vite refuses unrecognised Host headers, and a quick tunnel's is
			// generated per run. Granting the exact hostname is what keeps that
			// from becoming a domain-wide `.trycloudflare.com` entry, which
			// would trust every quick tunnel on the internet.
			expect(granted).toEqual(["app-host.trycloudflare.com"])
		} finally {
			delete (globalThis as any).__SERENE_PUB_ALLOW_DEV_HOST__
		}
	})

	test("a tunnelled socket handshake is same-origin, so it needs no allowlist entry", async () => {
		const { start } = await import("./supervisor")
		const { isOriginAllowed } = await import(
			"$lib/server/sockets/originAllowlist"
		)
		const tunnel = await makeQuickTunnel()

		const started = start(tunnel.id)
		await announceWhenSpawned("app-host.trycloudflare.com")
		await started

		// The page and the socket share one hostname now, so the zero-config
		// same-hostname default covers a tunnel with no configuration at all —
		// this is what collapsing to a single listener bought.
		expect(
			isOriginAllowed(
				"https://app-host.trycloudflare.com",
				"app-host.trycloudflare.com"
			)
		).toBe(true)
		// A genuinely different site is still refused.
		expect(
			isOriginAllowed(
				"https://attacker.example.com",
				"app-host.trycloudflare.com"
			)
		).toBe(false)
	})

	test("a process that dies before announcing marks the row errored rather than running", async () => {
		const { start } = await import("./supervisor")
		const tunnel = await makeQuickTunnel()

		const started = start(tunnel.id)
		for (let i = 0; i < 200 && spawned.length === 0; i++) {
			await new Promise((r) => setTimeout(r, 5))
		}
		spawned[0].proc.emit("exit", 1, null)

		await expect(started).rejects.toThrow(/exited with code 1/)

		const row = await testDb.query.tunnels.findFirst({
			where: eq(schema.tunnels.id, tunnel.id)
		})
		expect(row?.enabled).toBe(false)
		expect(row?.status).toBe("error")
		expect(row?.lastError).toMatch(/exited with code 1/)
		expect(row?.hostname).toBeNull()
	})

	test("refuses a deferred provider before spawning anything", async () => {
		const { start } = await import("./supervisor")
		const [row] = await testDb
			.insert(schema.tunnels)
			.values({
				serverId,
				provider: "tailscale_funnel",
				mode: "persistent",
				hostname: "chat.example.com"
			})
			.returning()

		await expect(start(row.id)).rejects.toThrow(/not implemented/)
		expect(spawnMock).not.toHaveBeenCalled()
	})

	test("refuses on the Android build even though the socket gate already checked", async () => {
		const { start } = await import("./supervisor")
		const tunnel = await makeQuickTunnel()
		process.env.SERENE_PUB_PLATFORM = "android"
		try {
			await expect(start(tunnel.id)).rejects.toThrow(/Android/)
			expect(spawnMock).not.toHaveBeenCalled()
		} finally {
			delete process.env.SERENE_PUB_PLATFORM
		}
	})
})

describe("supervisor.stop", () => {
	test("kills the process and marks the row stopped", async () => {
		const { start, stop, isRunning } = await import("./supervisor")
		const tunnel = await makeQuickTunnel()

		const started = start(tunnel.id)
		await announceWhenSpawned("app-host.trycloudflare.com")
		await started
		expect(isRunning()).toBe(true)

		await stop(tunnel.id)

		expect(spawned[0].proc.kill).toHaveBeenCalled()
		expect(isRunning()).toBe(false)

		const row = await testDb.query.tunnels.findFirst({
			where: eq(schema.tunnels.id, tunnel.id)
		})
		expect(row?.enabled).toBe(false)
		expect(row?.status).toBe("stopped")
		expect(row?.stoppedAt).not.toBeNull()
	})

	test("is safe to call when nothing is running — the ungated disable path reaches it", async () => {
		const { stop } = await import("./supervisor")
		const tunnel = await makeQuickTunnel()
		await expect(stop(tunnel.id)).resolves.toBeUndefined()
		const row = await testDb.query.tunnels.findFirst({
			where: eq(schema.tunnels.id, tunnel.id)
		})
		expect(row?.status).toBe("stopped")
	})
})

describe("named tunnels (phase C)", () => {
	const TOKEN = "eyJhIjoiTEST-connector-token-abc123"

	async function makeNamedTunnel(withCredential = true) {
		const { encryptToken, TUNNEL_CREDENTIAL_KEY_INFO } = await import(
			"$lib/server/utils/tokenCrypto"
		)
		const [row] = await testDb
			.insert(schema.tunnels)
			.values({
				serverId,
				provider: "cloudflare_named",
				mode: "persistent",
				hostname: "chat.example.com",
				credential: withCredential
					? encryptToken(TOKEN, TUNNEL_CREDENTIAL_KEY_INFO)
					: null
			})
			.returning()
		return row
	}

	/** cloudflared's readiness line for a connector that reached the edge. */
	function announceRegistered(proc: FakeProc) {
		proc.stderr.emit(
			"data",
			Buffer.from(
				"2026-08-29T12:00:00Z INF Starting tunnel tunnelID=abc\n" +
					"2026-08-29T12:00:01Z INF Registered tunnel connection connIndex=0 connection=7f3a location=iad\n"
			)
		)
	}

	test("runs the connector with the saved token and reports the configured hostname", async () => {
		const { start } = await import("./supervisor")
		const tunnel = await makeNamedTunnel()

		const started = start(tunnel.id)
		for (let i = 0; i < 200 && spawned.length === 0; i++) {
			await new Promise((r) => setTimeout(r, 5))
		}
		announceRegistered(spawned[0].proc)
		const row = await started

		// A named tunnel is `run --token`; there is no --url, because which
		// hostname routes where is configured in the Cloudflare dashboard.
		expect(spawned[0].args).toEqual([
			"tunnel",
			"--no-autoupdate",
			"run",
			"--token",
			TOKEN
		])
		expect(row.status).toBe("running")
		expect(row.enabled).toBe(true)
		// No URL was announced — the hostname is the admin's own record of
		// what they pointed at this tunnel.
		expect(row.hostname).toBe("chat.example.com")
	})

	test("never writes the connector token to the log", async () => {
		const { start, stop } = await import("./supervisor")
		const logged: string[] = []
		const spy = vi
			.spyOn(console, "log")
			.mockImplementation((...args: any[]) => {
				logged.push(args.join(" "))
			})
		try {
			const tunnel = await makeNamedTunnel()
			const started = start(tunnel.id)
			for (let i = 0; i < 200 && spawned.length === 0; i++) {
				await new Promise((r) => setTimeout(r, 5))
			}
			// A line that echoes the whole command back, the realistic way a
			// secret in argv leaks into logs.
			spawned[0].proc.stderr.emit(
				"data",
				Buffer.from(
					`ERR failed running: cloudflared tunnel run --token ${TOKEN}\n`
				)
			)
			announceRegistered(spawned[0].proc)
			await started
			await stop(tunnel.id)
		} finally {
			spy.mockRestore()
		}

		const all = logged.join("\n")
		expect(all).toContain("«token»")
		expect(all).not.toContain(TOKEN)
	})

	test("refuses to start with no token saved, without spawning", async () => {
		const { start } = await import("./supervisor")
		const tunnel = await makeNamedTunnel(false)
		await expect(start(tunnel.id)).rejects.toThrow(/no connector token/i)
		expect(spawnMock).not.toHaveBeenCalled()
	})

	test("fails fast on a rejected token instead of waiting out the launch timeout", async () => {
		const { start } = await import("./supervisor")
		const tunnel = await makeNamedTunnel()

		const started = start(tunnel.id)
		for (let i = 0; i < 200 && spawned.length === 0; i++) {
			await new Promise((r) => setTimeout(r, 5))
		}
		spawned[0].proc.stderr.emit(
			"data",
			Buffer.from(
				"2026-08-29T12:00:00Z ERR Unauthorized: invalid tunnel token\n"
			)
		)

		await expect(started).rejects.toThrow(/rejected the connector token/i)
		expect(spawned[0].proc.kill).toHaveBeenCalled()

		const row = await testDb.query.tunnels.findFirst({
			where: eq(schema.tunnels.id, tunnel.id)
		})
		expect(row?.status).toBe("error")
		expect(row?.lastError).toMatch(/rejected the connector token/i)
	})

	test("readiness and fatal-error detection are heuristics over log text", async () => {
		const { indicatesNamedTunnelReady, extractFatalLaunchError } =
			await import("./supervisor")

		expect(
			indicatesNamedTunnelReady(
				"INF Registered tunnel connection connIndex=0"
			)
		).toBe(true)
		expect(
			indicatesNamedTunnelReady("INF Connection 7f3a1b2c99 registered")
		).toBe(true)
		expect(indicatesNamedTunnelReady("INF Starting tunnel")).toBe(false)

		expect(extractFatalLaunchError("ERR Unauthorized")).toMatch(
			/rejected the connector token/i
		)
		expect(extractFatalLaunchError("ERR tunnel not found")).toMatch(
			/could not find that tunnel/i
		)
		expect(extractFatalLaunchError("INF Starting tunnel")).toBeNull()
	})
})

describe("TTL and boot reconciliation (phase D)", () => {
	async function startRunning(ttlSeconds: number | null = null) {
		const { start } = await import("./supervisor")
		const [row] = await testDb
			.insert(schema.tunnels)
			.values({
				serverId,
				provider: "cloudflare_quick",
				mode: "ephemeral",
				ttlSeconds
			})
			.returning()
		const started = start(row.id)
		await announceWhenSpawned("app-host.trycloudflare.com")
		return await started
	}

	test("computes the run's deadline from ttlSeconds at start, rather than inheriting one", async () => {
		// A stale deadline left on the row from a previous run must not be
		// reused — it would either expire the tunnel seconds after start or
		// never, depending on which way the clock fell.
		const stale = new Date(Date.now() - 60_000)
		const { start } = await import("./supervisor")
		const [row] = await testDb
			.insert(schema.tunnels)
			.values({
				serverId,
				provider: "cloudflare_quick",
				mode: "ephemeral",
				ttlSeconds: 3600,
				expiresAt: stale
			})
			.returning()

		const started = start(row.id)
		await announceWhenSpawned("app-host.trycloudflare.com")
		const fresh = await started

		expect(fresh.expiresAt).not.toBeNull()
		expect(fresh.expiresAt!.getTime()).toBeGreaterThan(Date.now())
		expect(fresh.expiresAt!.getTime()).toBeGreaterThan(stale.getTime())
	})

	test("no TTL means no deadline at all", async () => {
		const row = await startRunning(null)
		expect(row.expiresAt).toBeNull()
	})

	test("the sweep stops a tunnel whose deadline has passed", async () => {
		const { sweepExpiredTunnels, isRunning } = await import("./supervisor")
		const row = await startRunning(3600)
		expect(isRunning()).toBe(true)

		// Move the deadline into the past rather than waiting an hour.
		await testDb
			.update(schema.tunnels)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(schema.tunnels.id, row.id))

		await sweepExpiredTunnels()

		const after = await testDb.query.tunnels.findFirst({
			where: eq(schema.tunnels.id, row.id)
		})
		expect(after?.enabled).toBe(false)
		expect(after?.status).toBe("stopped")
		expect(after?.expiresAt).toBeNull()
		expect(isRunning()).toBe(false)
	})

	test("the sweep leaves a tunnel that is still inside its window alone", async () => {
		const { sweepExpiredTunnels, isRunning } = await import("./supervisor")
		await startRunning(3600)
		await sweepExpiredTunnels()
		expect(isRunning()).toBe(true)
	})

	test("boot reconciliation stops an expired row BEFORE auto-start considers it", async () => {
		const { reconcileOnBoot } = await import("./supervisor")
		// The exact state an ungraceful shutdown leaves behind: still marked
		// enabled, deadline already passed, and set to auto-start.
		const [row] = await testDb
			.insert(schema.tunnels)
			.values({
				serverId,
				provider: "cloudflare_quick",
				mode: "ephemeral",
				enabled: true,
				status: "running",
				autoStart: true,
				ttlSeconds: 3600,
				expiresAt: new Date(Date.now() - 1000)
			})
			.returning()

		const reconciled = reconcileOnBoot()
		// Auto-start does run — reconciliation stopped the stale row first,
		// then started a fresh run with a fresh deadline. Getting the order
		// wrong is what silently resurrects an expired tunnel.
		await announceWhenSpawned("app-host.trycloudflare.com")
		await reconciled

		const after = await testDb.query.tunnels.findFirst({
			where: eq(schema.tunnels.id, row.id)
		})
		expect(after?.status).toBe("running")
		expect(after?.expiresAt!.getTime()).toBeGreaterThan(Date.now())
	})

	test("boot resets a row left claiming it is running", async () => {
		const { reconcileOnBoot, isRunning } = await import("./supervisor")
		// Exactly what an ungraceful shutdown leaves: the row survives, the
		// cloudflared it describes does not.
		const [row] = await testDb
			.insert(schema.tunnels)
			.values({
				serverId,
				provider: "cloudflare_quick",
				mode: "ephemeral",
				enabled: true,
				status: "running",
				hostname: "ghost.trycloudflare.com"
			})
			.returning()

		await reconcileOnBoot()

		const after = await testDb.query.tunnels.findFirst({
			where: eq(schema.tunnels.id, row.id)
		})
		expect(after?.enabled).toBe(false)
		expect(after?.status).toBe("stopped")
		expect(isRunning()).toBe(false)
		expect(spawnMock).not.toHaveBeenCalled()
	})

	test("isSupervising is false for a row this process never started", async () => {
		const { isSupervising } = await import("./supervisor")
		const tunnel = await makeQuickTunnel()
		await testDb
			.update(schema.tunnels)
			.set({ enabled: true, status: "running" })
			.where(eq(schema.tunnels.id, tunnel.id))
		// The row says running; the authority says otherwise.
		expect(isSupervising(tunnel.id)).toBe(false)
	})

	test("auto-start does nothing for a row that did not ask for it", async () => {
		const { reconcileOnBoot } = await import("./supervisor")
		await testDb.insert(schema.tunnels).values({
			serverId,
			provider: "cloudflare_quick",
			mode: "ephemeral",
			autoStart: false
		})
		await reconcileOnBoot()
		expect(spawnMock).not.toHaveBeenCalled()
	})

	test("auto-start refuses while accounts are disabled, and says so on the row", async () => {
		const { reconcileOnBoot } = await import("./supervisor")
		await setAccounts(false)
		const [row] = await testDb
			.insert(schema.tunnels)
			.values({
				serverId,
				provider: "cloudflare_quick",
				mode: "ephemeral",
				autoStart: true
			})
			.returning()

		await reconcileOnBoot()

		expect(spawnMock).not.toHaveBeenCalled()
		const after = await testDb.query.tunnels.findFirst({
			where: eq(schema.tunnels.id, row.id)
		})
		expect(after?.enabled).toBe(false)
		expect(after?.lastError).toMatch(/accounts are disabled/i)
	})

	test("auto-start does not run on the Android build", async () => {
		const { reconcileOnBoot } = await import("./supervisor")
		await testDb.insert(schema.tunnels).values({
			serverId,
			provider: "cloudflare_quick",
			mode: "ephemeral",
			autoStart: true
		})
		process.env.SERENE_PUB_PLATFORM = "android"
		await reconcileOnBoot()
		expect(spawnMock).not.toHaveBeenCalled()
	})
})
