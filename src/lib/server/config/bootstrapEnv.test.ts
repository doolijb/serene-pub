/**
 * The banner is the answer to "why is my socket URL wrong" — before it, the
 * resolved hosting configuration was unknowable without curling an internal
 * API route. So the contract worth testing is that the Public URL line is
 * ALWAYS present, in every branch, and that the deprecation notice appears
 * exactly when a deprecated variable is actually set.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

// bootstrapEnv calls dotenv.config() at module scope when no preload marker is
// present, which would read the developer's real .env and make these
// assertions depend on whatever is in it. Stubbed so each test owns its env.
vi.mock("dotenv", () => ({ default: { config: () => ({ parsed: {} }) } }))

// These assertions describe a BUILT server. The late-load warning is
// deliberately suppressed under `vite dev`, where there is no adapter-node
// reading env at module scope and the warning would be pure noise — vitest
// otherwise reports dev: true, which would make that branch untestable here.
vi.mock("$app/environment", () => ({ dev: false, building: false }))

const ORIGINAL_ENV = { ...process.env }

const HOSTING_VARS = [
	"PUBLIC_URL",
	"SERENE_PUB_PUBLIC_URL",
	"ORIGIN",
	"SOCKETS_ENDPOINT",
	"PUBLIC_SOCKETS_ENDPOINT",
	"SOCKETS_HTTPS_HOSTS",
	"SOCKETS_HTTP_MODE",
	"SOCKETS_PORT",
	"ALLOWED_ORIGINS",
	"TRUSTED_PROXIES",
	"SERENE_PUB_SECURE_COOKIES",
	"PORT"
]

beforeEach(() => {
	for (const key of HOSTING_VARS) delete process.env[key]
	delete (globalThis as any).__serenePubEnvPreloaded
	vi.resetModules()
})

afterEach(() => {
	process.env = { ...ORIGINAL_ENV }
	vi.restoreAllMocks()
})

// The module runs bootstrap() on import; silence it so importing for the pure
// builders doesn't spray the test output.
async function load() {
	vi.spyOn(console, "log").mockImplementation(() => {})
	vi.spyOn(console, "warn").mockImplementation(() => {})
	return await import("./bootstrapEnv")
}

describe("buildStartupBanner", () => {
	test("always reports a Public URL line, even fully unconfigured", async () => {
		const { buildStartupBanner } = await load()
		const banner = buildStartupBanner().join("\n")
		expect(banner).toContain("Public URL:")
		expect(banner).toContain("not set — resolved per request")
	})

	test("reports the configured public URL and its source", async () => {
		process.env.PUBLIC_URL = "https://tunnel.example.com"
		const { buildStartupBanner } = await load()
		const banner = buildStartupBanner().join("\n")
		expect(banner).toContain("Public URL:  https://tunnel.example.com")
		expect(banner).toContain("(from PUBLIC_URL)")
	})

	test("tells the operator their proxy must route /socket.io/ when same-origin", async () => {
		process.env.PUBLIC_URL = "https://tunnel.example.com"
		const { buildStartupBanner } = await load()
		const banner = buildStartupBanner().join("\n")
		expect(banner).toContain("Socket URL:  https://tunnel.example.com")
		expect(banner).toContain("must route /socket.io/ to port 3001")
	})

	test("reports the default trust rule when TRUSTED_PROXIES is unset", async () => {
		const { buildStartupBanner } = await load()
		expect(buildStartupBanner().join("\n")).toContain(
			"Trusted proxies: private ranges (default"
		)
	})

	test("reports declared proxies and anything derived from them", async () => {
		process.env.TRUSTED_PROXIES = "10.0.0.0/8"
		;(globalThis as any).__serenePubEnvPreloaded = {
			derived: { ADDRESS_HEADER: "x-forwarded-for" }
		}
		const { buildStartupBanner } = await load()
		const banner = buildStartupBanner().join("\n")
		expect(banner).toContain("Trusted proxies: 10.0.0.0/8")
		expect(banner).toContain("ADDRESS_HEADER=x-forwarded-for")
	})

	test("warns when .env was loaded too late for the framework to see it", async () => {
		// No __serenePubEnvPreloaded marker => build/index.js's preload did not
		// run, so adapter-level variables from .env never applied.
		const { buildStartupBanner } = await load()
		expect(buildStartupBanner().join("\n")).toContain(
			".env was loaded late"
		)
	})

	test("no late-load warning once the preload has run", async () => {
		;(globalThis as any).__serenePubEnvPreloaded = { derived: {} }
		const { buildStartupBanner } = await load()
		expect(buildStartupBanner().join("\n")).not.toContain(
			".env was loaded late"
		)
	})
})

describe("buildLegacyMigrationNotice", () => {
	test("null when nothing deprecated is set — a modern install stays quiet", async () => {
		const { buildLegacyMigrationNotice } = await load()
		expect(buildLegacyMigrationNotice()).toBeNull()
	})

	test("lists exactly the deprecated variables that are set, with replacements", async () => {
		process.env.SOCKETS_HTTPS_HOSTS = "tunnel.example.com"
		const { buildLegacyMigrationNotice } = await load()
		const notice = buildLegacyMigrationNotice()!.join("\n")
		expect(notice).toContain("DEPRECATED")
		expect(notice).toContain("SOCKETS_HTTPS_HOSTS=tunnel.example.com")
		expect(notice).toContain("PUBLIC_URL=https://tunnel.example.com")
		// Not set, so must not be mentioned.
		expect(notice).not.toContain("SOCKETS_HTTP_MODE")
		expect(notice).toContain("docs/hosting.md")
	})

	test("covers each deprecated variable", async () => {
		process.env.SOCKETS_HTTP_MODE = "https"
		process.env.SERENE_PUB_SECURE_COOKIES = "true"
		process.env.PUBLIC_SOCKETS_ENDPOINT = "https://s.example.com"
		const { buildLegacyMigrationNotice } = await load()
		const notice = buildLegacyMigrationNotice()!.join("\n")
		expect(notice).toContain("SOCKETS_HTTP_MODE")
		expect(notice).toContain("SERENE_PUB_SECURE_COOKIES")
		expect(notice).toContain("PUBLIC_SOCKETS_ENDPOINT")
		expect(notice).toContain("SOCKETS_ENDPOINT=<same value>")
	})

	test("says nothing is broken — these still work", async () => {
		process.env.SOCKETS_HTTPS_HOSTS = "x.example.com"
		const { buildLegacyMigrationNotice } = await load()
		expect(buildLegacyMigrationNotice()!.join("\n")).toContain("still work")
	})
})

describe("buildWildcardWarning", () => {
	test("null unless the wildcard is actually active", async () => {
		const { buildWildcardWarning } = await load()
		expect(buildWildcardWarning()).toBeNull()

		process.env.ALLOWED_ORIGINS = "example.com"
		expect(buildWildcardWarning()).toBeNull()
	})

	test("fires on ALLOWED_ORIGINS=*", async () => {
		process.env.ALLOWED_ORIGINS = "*"
		const { buildWildcardWarning } = await load()
		expect(buildWildcardWarning()!.join("\n")).toContain(
			"origin allowlist is disabled"
		)
	})
})
