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
	"SOCKETS_ALLOWED_ORIGINS",
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

	// "Which address do I point my proxy at for websockets" is the question
	// this banner most often gets read for, and the answer changed: there is no
	// separate address, and the port to route to is PORT.
	test("tells the operator to route /socket.io/ to the app's own port", async () => {
		process.env.PUBLIC_URL = "https://tunnel.example.com"
		process.env.PORT = "8080"
		const { buildStartupBanner } = await load()
		const banner = buildStartupBanner().join("\n")
		expect(banner).toContain("Socket URL:  same origin as above")
		expect(banner).toContain("route /socket.io/ to port 8080")
		expect(banner).not.toContain("3001")
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
		// SERENE_PUB_SECURE_COOKIES is the only genuinely deprecated-but-honored
		// hosting variable left: it declares "TLS terminates here", a fact with
		// no HTTP-derivable signal, so unlike the retired socket variables it is
		// still read.
		process.env.SERENE_PUB_SECURE_COOKIES = "true"
		const { buildLegacyMigrationNotice } = await load()
		const notice = buildLegacyMigrationNotice()!.join("\n")
		expect(notice).toContain("DEPRECATED")
		expect(notice).toContain("SERENE_PUB_SECURE_COOKIES=true")
		expect(notice).toContain("PUBLIC_URL=https://<your public hostname>")
		expect(notice).toContain("docs/hosting.md")
		// Retired, not deprecated — must not be described as still working.
		expect(notice).not.toContain("SOCKETS_HTTP_MODE")
		expect(notice).not.toContain("ALLOWED_ORIGINS")
	})

	// The second-listener variables are a different fact from the deprecated
	// ones: they are not honored at all any more, so a notice that lumps them
	// in with "these still work" would be actively wrong. An operator whose
	// compose file still carries SOCKETS_PORT: 3001 has to be told it does
	// nothing rather than left to assume it does.
	test("reports the retired socket variables as IGNORED, not deprecated", async () => {
		process.env.SOCKETS_PORT = "3001"
		process.env.PUBLIC_SOCKETS_ENDPOINT = "https://s.example.com"
		const { buildLegacyMigrationNotice } = await load()
		const notice = buildLegacyMigrationNotice()!.join("\n")
		expect(notice).toContain("IGNORED")
		expect(notice).toContain("SOCKETS_PORT=3001")
		expect(notice).toContain(
			"PUBLIC_SOCKETS_ENDPOINT=https://s.example.com"
		)
		// Must not be described as still working.
		expect(notice).not.toContain(
			"SOCKETS_PORT=3001 — no effect, still works"
		)
	})

	test("says nothing is broken — these still work", async () => {
		process.env.SERENE_PUB_SECURE_COOKIES = "true"
		const { buildLegacyMigrationNotice } = await load()
		expect(buildLegacyMigrationNotice()!.join("\n")).toContain("still work")
	})

	// ALLOWED_ORIGINS is the first RETIRED entry with no replacement to point
	// at: every other one is a thing to re-express under a new name, whereas
	// origin trust is derived now and there is nothing left to set. An operator
	// told only "ignored" would go looking for the new spelling.
	test("reports the retired origin variables as IGNORED with no replacement", async () => {
		process.env.ALLOWED_ORIGINS = "example.com"
		process.env.SOCKETS_ALLOWED_ORIGINS = "*"
		const { buildLegacyMigrationNotice } = await load()
		const notice = buildLegacyMigrationNotice()!.join("\n")
		expect(notice).toContain("IGNORED")
		expect(notice).toContain("ALLOWED_ORIGINS=example.com")
		expect(notice).toContain("SOCKETS_ALLOWED_ORIGINS=*")
		expect(notice).toContain("NO replacement variable")
		expect(notice).toContain("automatic")
		// Must not appear in the "these still work" half.
		expect(notice).not.toContain("DEPRECATED")
	})

	test("reports the retired protocol variables as IGNORED, pointing at PUBLIC_URL", async () => {
		process.env.SOCKETS_HTTPS_HOSTS = "tunnel.example.com"
		process.env.SOCKETS_HTTP_MODE = "https"
		const { buildLegacyMigrationNotice } = await load()
		const notice = buildLegacyMigrationNotice()!.join("\n")
		expect(notice).toContain("IGNORED")
		expect(notice).toContain("SOCKETS_HTTPS_HOSTS=tunnel.example.com")
		expect(notice).toContain("SOCKETS_HTTP_MODE=https")
		expect(notice).toContain("PUBLIC_URL=https://<your public hostname>")
		expect(notice).not.toContain("DEPRECATED")
	})
})

// describe("buildWildcardWarning") lived here. Nothing can set the origin
// wildcard any more, so the warning has no reachable condition and the function
// is gone; ALLOWED_ORIGINS is reported through RETIRED_VARS above instead,
// which the two IGNORED tests cover.
