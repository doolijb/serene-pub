/**
 * Remote access phase A (plan 26 §2–§3, §5, §7).
 *
 * The supervisor isn't built yet, so what's testable now is exactly the part
 * that has to be right *before* anything can be started: that the credential
 * never leaves the server, that the gates refuse rather than the UI merely
 * hiding, and that the DB itself won't hold two enabled tunnels for one server.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
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
let localServerId: number

// The supervisor is exercised for real in tunnels/supervisor.int.test.ts.
// Here it is stubbed so these tests stay about the *gates* — which of them
// refuse, in what order, and whether the mechanism is reached at all.
const supervisorStart = vi.fn(async (id: number) => {
	const [row] = await testDb
		.update(schema.tunnels)
		.set({
			enabled: true,
			status: "running",
			hostname: "abc.trycloudflare.com"
		})
		.where(eq(schema.tunnels.id, id))
		.returning()
	return row
})
const supervisorStop = vi.fn(async (id?: number) => {
	if (id === undefined) return
	await testDb
		.update(schema.tunnels)
		.set({
			enabled: false,
			status: "stopped",
			expiresAt: null,
			stoppedAt: new Date()
		})
		.where(eq(schema.tunnels.id, id))
})

vi.mock("$lib/server/tunnels/supervisor", () => ({
	start: (id: number) => supervisorStart(id),
	stop: (id?: number) => supervisorStop(id)
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	// systemSettingsGet and the accounts gate both query id=1 specifically.
	await testDb.insert(schema.systemSettings).values({ id: 1 })
	// What db/defaults.ts sync() seeds at boot.
	const [server] = await testDb
		.insert(schema.servers)
		.values({
			slug: LOCAL_SERVER_SLUG,
			name: "This instance",
			isSeeded: true
		})
		.returning()
	localServerId = server.id
}, 60_000)

afterEach(async () => {
	supervisorStart.mockClear()
	supervisorStop.mockClear()
	delete process.env.SERENE_PUB_PLATFORM
	await testDb.delete(schema.tunnels)
	await setAccounts(false)
})

afterAll(async () => {
	delete process.env.SERENE_PUB_PLATFORM
})

async function setAccounts(enabled: boolean) {
	await testDb
		.update(schema.systemSettings)
		.set({ isAccountsEnabled: enabled })
		.where(eq(schema.systemSettings.id, 1))
}

async function makeAdmin(username: string) {
	const [admin] = await testDb
		.insert(schema.users)
		.values({ username, isAdmin: true })
		.returning()
	return admin
}

function fakeSocket(userId: number, isAdmin = true) {
	return { user: { id: userId, isAdmin } } as any
}

const noopEmit = () => {}

const NAMED_CONFIG = {
	provider: "cloudflare_named",
	mode: "persistent",
	hostname: "chat.example.com"
}

const QUICK_CONFIG = {
	provider: "cloudflare_quick",
	mode: "ephemeral"
}

describe("tunnels — the credential never leaves the server", () => {
	test("updateConfig encrypts the credential at rest and the view exposes only credentialSet", async () => {
		const { tunnelsUpdateConfig, tunnelsGet } = await import("./tunnels")
		const admin = await makeAdmin("tunnel-credential-user")

		const res = await tunnelsUpdateConfig.handler(
			fakeSocket(admin.id),
			{ ...NAMED_CONFIG, credential: "cf-connector-token-abc123" },
			noopEmit
		)

		// Nothing resembling the token in the client-facing payload.
		expect(JSON.stringify(res.tunnel)).not.toContain("cf-connector-token")
		expect((res.tunnel as any).credential).toBeUndefined()
		expect(res.tunnel.credentialSet).toBe(true)

		const raw = await testDb.query.tunnels.findFirst()
		expect(raw?.credential).toBeTruthy()
		expect(JSON.stringify(raw!.credential)).not.toContain(
			"cf-connector-token"
		)
		expect(raw!.credential).toMatchObject({
			ciphertext: expect.any(String),
			iv: expect.any(String),
			authTag: expect.any(String)
		})

		const got = await tunnelsGet.handler(fakeSocket(admin.id), {}, noopEmit)
		expect((got.tunnel as any)?.credential).toBeUndefined()
		expect(got.tunnel?.credentialSet).toBe(true)
	})

	test("an omitted credential leaves the stored one untouched; an explicit null clears it", async () => {
		const { tunnelsUpdateConfig } = await import("./tunnels")
		const admin = await makeAdmin("tunnel-credential-patch-user")
		const socket = fakeSocket(admin.id)

		await tunnelsUpdateConfig.handler(
			socket,
			{ ...NAMED_CONFIG, credential: "original-token" },
			noopEmit
		)
		const first = await testDb.query.tunnels.findFirst()

		// Omitted — the client can't round-trip a write-only field, so
		// "absent" has to mean "unchanged" or every save would wipe it.
		const kept = await tunnelsUpdateConfig.handler(
			socket,
			{ ...NAMED_CONFIG, hostname: "other.example.com" },
			noopEmit
		)
		expect(kept.tunnel.credentialSet).toBe(true)
		const second = await testDb.query.tunnels.findFirst()
		expect(second!.credential).toEqual(first!.credential)
		expect(second!.hostname).toBe("other.example.com")

		const cleared = await tunnelsUpdateConfig.handler(
			socket,
			{ ...NAMED_CONFIG, credential: null },
			noopEmit
		)
		expect(cleared.tunnel.credentialSet).toBe(false)
		expect((await testDb.query.tunnels.findFirst())!.credential).toBeNull()
	})
})

describe("tunnels — config validation", () => {
	test("rejects a hostname carrying a scheme, port, path or wildcard", async () => {
		const { tunnelsUpdateConfig } = await import("./tunnels")
		const admin = await makeAdmin("tunnel-hostname-user")
		for (const hostname of [
			"https://chat.example.com",
			"chat.example.com:8080",
			"chat.example.com/path",
			"*.example.com",
			"chat example.com"
		]) {
			await expect(
				tunnelsUpdateConfig.handler(
					fakeSocket(admin.id),
					{ ...NAMED_CONFIG, hostname },
					noopEmit
				)
			).rejects.toThrow()
		}
	})

	test("rejects a provider/mode pair that disagrees, and a deferred provider", async () => {
		const { tunnelsUpdateConfig } = await import("./tunnels")
		const admin = await makeAdmin("tunnel-mode-user")
		await expect(
			tunnelsUpdateConfig.handler(
				fakeSocket(admin.id),
				{ provider: "cloudflare_quick", mode: "persistent" },
				noopEmit
			)
		).rejects.toThrow()
		await expect(
			tunnelsUpdateConfig.handler(
				fakeSocket(admin.id),
				{ provider: "tailscale_funnel", mode: "persistent" },
				noopEmit
			)
		).rejects.toThrow()
	})

	test("a named tunnel needs a hostname; a quick tunnel does not", async () => {
		const { tunnelsUpdateConfig } = await import("./tunnels")
		const admin = await makeAdmin("tunnel-hostname-required-user")
		await expect(
			tunnelsUpdateConfig.handler(
				fakeSocket(admin.id),
				{ provider: "cloudflare_named", mode: "persistent" },
				noopEmit
			)
		).rejects.toThrow(/hostname/i)

		const quick = await tunnelsUpdateConfig.handler(
			fakeSocket(admin.id),
			{ provider: "cloudflare_quick", mode: "ephemeral" },
			noopEmit
		)
		expect(quick.tunnel.hostname).toBeNull()
		// autoStart defaults off — an instance must never republish itself to
		// the internet on boot without an explicit opt-in (26 §4).
		expect(quick.tunnel.autoStart).toBe(false)
	})

	test("refuses to reconfigure a tunnel that is still enabled", async () => {
		const { tunnelsUpdateConfig } = await import("./tunnels")
		const admin = await makeAdmin("tunnel-live-reconfig-user")
		await tunnelsUpdateConfig.handler(
			fakeSocket(admin.id),
			NAMED_CONFIG,
			noopEmit
		)
		await testDb.update(schema.tunnels).set({ enabled: true })

		await expect(
			tunnelsUpdateConfig.handler(
				fakeSocket(admin.id),
				{ ...NAMED_CONFIG, hostname: "moved.example.com" },
				noopEmit
			)
		).rejects.toThrow(/Stop the running tunnel/)
	})

	test("accepts any auto-stop duration inside the allowed range", async () => {
		const { tunnelsUpdateConfig } = await import("./tunnels")
		const admin = await makeAdmin("tunnel-ttl-range-user")
		// 12 hours is a pre-fill, not the only option.
		for (const hours of [0.25, 1, 12, 72, 720]) {
			const res = await tunnelsUpdateConfig.handler(
				fakeSocket(admin.id),
				{ ...QUICK_CONFIG, ttlSeconds: Math.round(hours * 3600) },
				noopEmit
			)
			expect(res.tunnel.ttlSeconds).toBe(Math.round(hours * 3600))
		}
	})

	test("rejects a duration shorter than the launch itself can take", async () => {
		const { tunnelsUpdateConfig } = await import("./tunnels")
		const admin = await makeAdmin("tunnel-ttl-tiny-user")
		// The supervisor allows the launch alone 60s; a 30s TTL would expire a
		// tunnel before it finished starting.
		await expect(
			tunnelsUpdateConfig.handler(
				fakeSocket(admin.id),
				{ ...QUICK_CONFIG, ttlSeconds: 30 },
				noopEmit
			)
		).rejects.toThrow(/at least 15 minutes/i)
	})

	test("rejects a duration so long the timer is indistinguishable from none", async () => {
		const { tunnelsUpdateConfig } = await import("./tunnels")
		const admin = await makeAdmin("tunnel-ttl-huge-user")
		await expect(
			tunnelsUpdateConfig.handler(
				fakeSocket(admin.id),
				{ ...QUICK_CONFIG, ttlSeconds: 60 * 60 * 24 * 365 },
				noopEmit
			)
		).rejects.toThrow(/at most 30 days/i)
	})

	test("null still means no expiry at all", async () => {
		const { tunnelsUpdateConfig } = await import("./tunnels")
		const admin = await makeAdmin("tunnel-ttl-null-user")
		const res = await tunnelsUpdateConfig.handler(
			fakeSocket(admin.id),
			{ ...QUICK_CONFIG, ttlSeconds: null },
			noopEmit
		)
		expect(res.tunnel.ttlSeconds).toBeNull()
	})

	test("non-admins are refused", async () => {
		const { tunnelsGet, tunnelsUpdateConfig } = await import("./tunnels")
		const user = await makeAdmin("tunnel-non-admin-user")
		const socket = fakeSocket(user.id, false)
		await expect(tunnelsGet.handler(socket, {}, noopEmit)).rejects.toThrow(
			/Unauthorized/
		)
		await expect(
			tunnelsUpdateConfig.handler(socket, NAMED_CONFIG, noopEmit)
		).rejects.toThrow(/Unauthorized/)
	})
})

describe("tunnels — gates refuse server-side, not just in the UI", () => {
	test("the Android build refuses to configure or enable, and reports itself unavailable", async () => {
		const { tunnelsGet, tunnelsUpdateConfig, tunnelsEnable } = await import(
			"./tunnels"
		)
		const admin = await makeAdmin("tunnel-android-user")
		await setAccounts(true)
		process.env.SERENE_PUB_PLATFORM = "android"

		const got = await tunnelsGet.handler(fakeSocket(admin.id), {}, noopEmit)
		expect(got.available).toBe(false)
		expect(got.unavailableReason).toMatch(/Android/)

		await expect(
			tunnelsUpdateConfig.handler(
				fakeSocket(admin.id),
				NAMED_CONFIG,
				noopEmit
			)
		).rejects.toThrow(/Android/)
		await expect(
			tunnelsEnable.handler(fakeSocket(admin.id), {}, noopEmit)
		).rejects.toThrow(/Android/)
	})

	test("enable refuses while accounts are disabled — the state that must never be reachable", async () => {
		const { tunnelsUpdateConfig, tunnelsEnable } = await import("./tunnels")
		const admin = await makeAdmin("tunnel-accounts-off-user")
		await setAccounts(false)
		await tunnelsUpdateConfig.handler(
			fakeSocket(admin.id),
			NAMED_CONFIG,
			noopEmit
		)

		await expect(
			tunnelsEnable.handler(fakeSocket(admin.id), {}, noopEmit)
		).rejects.toThrow(/accounts must be enabled/i)

		// The gate refused *before* the mechanism was reached — the point of
		// checking server-side rather than hiding the switch.
		expect(supervisorStart).not.toHaveBeenCalled()
		const raw = await testDb.query.tunnels.findFirst()
		expect(raw?.enabled).toBe(false)
	})

	test("with every gate passed, enable hands off to the supervisor", async () => {
		const { tunnelsUpdateConfig, tunnelsEnable } = await import("./tunnels")
		const admin = await makeAdmin("tunnel-enable-user")
		await setAccounts(true)
		const created = await tunnelsUpdateConfig.handler(
			fakeSocket(admin.id),
			QUICK_CONFIG,
			noopEmit
		)

		const res = await tunnelsEnable.handler(
			fakeSocket(admin.id),
			{},
			noopEmit
		)
		expect(supervisorStart).toHaveBeenCalledWith(created.tunnel.id)
		expect(res.tunnel.enabled).toBe(true)
		// Still no credential on the way out, even on the enable path.
		expect((res.tunnel as any).credential).toBeUndefined()
	})

	test("enable refuses a provider the supervisor has not implemented, without starting anything", async () => {
		const { tunnelsUpdateConfig, tunnelsEnable } = await import("./tunnels")
		const admin = await makeAdmin("tunnel-unimplemented-user")
		await setAccounts(true)
		await tunnelsUpdateConfig.handler(
			fakeSocket(admin.id),
			NAMED_CONFIG,
			noopEmit
		)
		supervisorStart.mockRejectedValueOnce(
			new Error(
				"Cloudflare Named Tunnel is not implemented yet (plan 26, phase C)."
			)
		)
		await expect(
			tunnelsEnable.handler(fakeSocket(admin.id), {}, noopEmit)
		).rejects.toThrow(/phase C/)
	})

	test("disable always works — stopping must never be gated into a stranded row", async () => {
		const { tunnelsUpdateConfig, tunnelsDisable } = await import(
			"./tunnels"
		)
		const admin = await makeAdmin("tunnel-disable-user")
		await setAccounts(true)
		await tunnelsUpdateConfig.handler(
			fakeSocket(admin.id),
			NAMED_CONFIG,
			noopEmit
		)
		await testDb
			.update(schema.tunnels)
			.set({ enabled: true, status: "running", expiresAt: new Date() })

		// Accounts since turned off and the instance moved to Android: both
		// gates that block enable, neither of which may block stopping.
		await setAccounts(false)
		process.env.SERENE_PUB_PLATFORM = "android"

		const res = await tunnelsDisable.handler(
			fakeSocket(admin.id),
			{},
			noopEmit
		)
		expect(supervisorStop).toHaveBeenCalled()
		expect(res.tunnel.enabled).toBe(false)
		expect(res.tunnel.status).toBe("stopped")
		expect(res.tunnel.expiresAt).toBeNull()
	})
})

describe("tunnels — the database itself holds the one-enabled invariant", () => {
	test("a second enabled tunnel for the same server is rejected by the partial unique index", async () => {
		await testDb.insert(schema.tunnels).values({
			serverId: localServerId,
			provider: "cloudflare_quick",
			mode: "ephemeral",
			enabled: true
		})

		await expect(
			testDb.insert(schema.tunnels).values({
				serverId: localServerId,
				provider: "cloudflare_named",
				mode: "persistent",
				enabled: true
			})
		).rejects.toThrow()

		// Disabled rows are unconstrained — the index is partial on purpose.
		await expect(
			testDb.insert(schema.tunnels).values({
				serverId: localServerId,
				provider: "cloudflare_named",
				mode: "persistent",
				enabled: false
			})
		).resolves.toBeDefined()
	})
})
