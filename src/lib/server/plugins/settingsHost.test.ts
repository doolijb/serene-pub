import { describe, it, expect, afterEach } from "vitest"
import {
	settingsSchemaOf,
	clientSettingsView,
	applySettingsWrite,
	hookSettingsFor
} from "./settingsHost"
import { SandboxManager } from "./SandboxManager"
import type { SettingsSchema } from "@serene-pub/sdk"

/**
 * The app half of plugin settings (12 §6, 13 §6): storage shape, the one
 * encrypt path, the three audiences. The SDK's own suite covers the pure
 * judgements (checkValues, reconcile, forClient); what is pinned here is what
 * only the app knows — that a secret round-trips through the instance's
 * crypto, that plaintext appears exactly once (the owning hook's resolution),
 * and that the manager delivers the resolved values into a hook's input.
 */

const SCHEMA: SettingsSchema = {
	apiKey: { type: "secret", label: "API key", required: true },
	region: { type: "enum", of: ["eu", "us"], default: "eu" },
	limit: { type: "integer", default: 5, min: 1, max: 10 }
}

const MANIFEST = { settings: SCHEMA }

describe("settingsSchemaOf", () => {
	it("reads tolerantly and drops undeclarable fields", () => {
		expect(settingsSchemaOf(null)).toEqual({})
		expect(settingsSchemaOf({ settings: [1, 2] })).toEqual({})
		expect(
			Object.keys(
				settingsSchemaOf({
					settings: {
						good: { type: "string" },
						bad: { type: "blob" },
						worse: 7
					}
				})
			)
		).toEqual(["good"])
	})
})

describe("the write path", () => {
	it("encrypts a secret at rest and resolves plaintext only for the hook", () => {
		const w = applySettingsWrite(SCHEMA, {}, { apiKey: "sk-live-123" })
		expect(w.ok).toBe(true)
		const next = (w as any).next
		// At rest: the typed envelope, never the plaintext.
		expect(next.apiKey).toMatchObject({ $secret: true })
		expect(JSON.stringify(next)).not.toContain("sk-live-123")

		// The hook holds a handle; the plaintext stays host-side (R63).
		const resolved = hookSettingsFor(MANIFEST, next)!
		expect(resolved.settings.apiKey).toBe(`\u27E6secret:apiKey:${resolved.nonce}\u27E7`)
		expect(JSON.stringify(resolved.settings)).not.toContain("sk-live-123")
		expect(resolved.secrets.apiKey).toBe("sk-live-123")
		expect(resolved.lent).toEqual([])
	})

	it("absent means unchanged; empty means cleared", () => {
		const first = applySettingsWrite(SCHEMA, {}, { apiKey: "one-key" })
		const kept = applySettingsWrite(
			SCHEMA,
			(first as any).next,
			{ region: "us" }
		)
		expect(hookSettingsFor(MANIFEST, (kept as any).next)!.secrets.apiKey).toBe(
			"one-key"
		)
		const cleared = applySettingsWrite(SCHEMA, (kept as any).next, {
			apiKey: ""
		})
		const after = hookSettingsFor(MANIFEST, (cleared as any).next)!
		expect(after.secrets.apiKey).toBeUndefined()
		expect(after.settings.apiKey).toBeUndefined()
	})

	it("refuses an undeclared field and a mistyped value, by name", () => {
		const unknown = applySettingsWrite(SCHEMA, {}, { nope: 1 })
		expect(unknown).toMatchObject({ ok: false })
		expect((unknown as any).error).toMatch(/'nope'/)

		const mistyped = applySettingsWrite(SCHEMA, {}, { limit: 99 })
		expect(mistyped).toMatchObject({ ok: false })
		expect((mistyped as any).error).toMatch(/maximum/)
	})

	it("an incomplete config saves — needs-configuration is a state, not an error", () => {
		const w = applySettingsWrite(SCHEMA, {}, { region: "us" })
		expect(w.ok).toBe(true)
		const view = clientSettingsView(MANIFEST, (w as any).next)!
		expect(view.state).toMatchObject({
			state: "needs-configuration",
			missing: ["apiKey"]
		})
	})
})

describe("the client view", () => {
	it("masks secrets to set/unset and never carries ciphertext", () => {
		const w = applySettingsWrite(SCHEMA, {}, { apiKey: "sk-live-123" })
		const view = clientSettingsView(MANIFEST, (w as any).next)!
		expect(view.values.apiKey).toEqual({ $secretSet: true })
		expect(JSON.stringify(view)).not.toContain("sk-live-123")
		expect(JSON.stringify(view)).not.toContain("ciphertext")
		// Declared defaults arrive filled, so the form shows what will run.
		expect(view.values.region).toBe("eu")
		expect(view.state).toEqual({ state: "ready" })
	})

	it("is null when the manifest declares nothing", () => {
		expect(clientSettingsView({}, {})).toBeNull()
		expect(hookSettingsFor({}, {})).toBeUndefined()
	})
})

describe("delivery through the manager", () => {
	let mgr: SandboxManager
	afterEach(async () => {
		await mgr?.dispose()
	})

	it("a hook receives resolved settings as input.settings", async () => {
		const w = applySettingsWrite(SCHEMA, {}, { apiKey: "sk-live-123" })
		const settings = hookSettingsFor(MANIFEST, (w as any).next)!
		mgr = new SandboxManager({ onInvocation: () => {} })
		mgr.register({
			id: "p",
			name: "Settings Test",
			bundleSource:
				"module.exports = { hooks: { v: (i) => ({ key: i.settings.apiKey, region: i.settings.region, n: i.n }) } }",
			bundleHash: "h-settings",
			backends: ["quickjs"],
			backend: "quickjs",
			sequential: false,
			settings: settings.settings,
			secrets: settings.secrets,
			lentSecrets: settings.lent,
			secretNonce: settings.nonce
		})
		mgr.markReady()
		const r = await mgr.callHook("p", "v", { n: 7 }, { kind: "task", timeoutMs: 2000 })
		expect(r.ok).toBe(true)
		// A handle, never the key (R63) — and a handle is scrubbed from any
		// output too, so its nonce goes no further than the plugin.
		expect((r as any).value).toEqual({
			key: "\u2039secret\u203A",
			region: "eu",
			n: 7
		})
	})

	it("a value the plugin got hold of anyway is scrubbed from its output and logs (R63)", async () => {
		const w = applySettingsWrite(SCHEMA, {}, { apiKey: "sk-live-123" })
		const settings = hookSettingsFor(MANIFEST, (w as any).next)!
		mgr = new SandboxManager({ onInvocation: () => {} })
		mgr.register({
			id: "leaky",
			name: "Leaky",
			// Stands in for a response that echoed the key back.
			bundleSource:
				"module.exports = { hooks: { v: (i, ctx) => { ctx.log('info', 'got sk-live-123'); return { said: 'token=sk-live-123;' } } } }",
			bundleHash: "h-leaky",
			backends: ["quickjs"],
			backend: "quickjs",
			sequential: false,
			settings: settings.settings,
			secrets: settings.secrets,
			secretNonce: settings.nonce
		})
		mgr.markReady()
		const r: any = await mgr.callHook("leaky", "v", {}, { kind: "task", timeoutMs: 2000 })
		expect(r.ok).toBe(true)
		expect(r.value).toEqual({ said: "token=\u2039secret\u203A;" })
		expect(JSON.stringify(r)).not.toContain("sk-live-123")
	})

	it("a settings-free descriptor leaves the input untouched", async () => {
		mgr = new SandboxManager({ onInvocation: () => {} })
		mgr.register({
			id: "q",
			name: "No Settings",
			bundleSource:
				"module.exports = { hooks: { v: (i) => Object.keys(i) } }",
			bundleHash: "h-none",
			backends: ["quickjs"],
			backend: "quickjs",
			sequential: false
		})
		mgr.markReady()
		const r = await mgr.callHook("q", "v", { n: 1 }, { kind: "task", timeoutMs: 2000 })
		expect(r.ok).toBe(true)
		expect((r as any).value).toEqual(["n"])
	})
})

describe("R63 · a node in another package's pipeline gets only what its owner lends", () => {
	it("secretsForCall: all for the plugin's own work, the lent ones elsewhere", async () => {
		const { secretsForCall } = await import("./SandboxManager")
		const desc = { secrets: { apiKey: "sk-one", shared: "sk-two" }, lentSecrets: ["shared"], secretNonce: "n0" }
		expect(secretsForCall(desc, false)).toEqual({ nonce: "n0", values: { apiKey: "sk-one", shared: "sk-two" } })
		expect(secretsForCall(desc, true)).toEqual({ nonce: "n0", values: { shared: "sk-two" } })
		expect(secretsForCall({}, true)).toBeUndefined()
	})

	it("a secret too short to scrub is refused at write", () => {
		const w = applySettingsWrite(SCHEMA, {}, { apiKey: "abc" })
		expect(w).toMatchObject({ ok: false })
		expect((w as any).error).toMatch(/too short/)
	})
})
