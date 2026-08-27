import { describe, it, expect, afterEach } from "vitest"
import {
	settingsSchemaOf,
	clientSettingsView,
	applySettingsWrite,
	hookSettingsFor
} from "./settingsHost"
import { RuntimeManager } from "./RuntimeManager"
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

		// The owning hook's resolution is the one place plaintext reappears.
		const resolved = hookSettingsFor(MANIFEST, next)!
		expect(resolved.apiKey).toBe("sk-live-123")
	})

	it("absent means unchanged; empty means cleared", () => {
		const first = applySettingsWrite(SCHEMA, {}, { apiKey: "one" })
		const kept = applySettingsWrite(
			SCHEMA,
			(first as any).next,
			{ region: "us" }
		)
		expect(hookSettingsFor(MANIFEST, (kept as any).next)!.apiKey).toBe(
			"one"
		)
		const cleared = applySettingsWrite(SCHEMA, (kept as any).next, {
			apiKey: ""
		})
		expect(
			hookSettingsFor(MANIFEST, (cleared as any).next)!.apiKey
		).toBeUndefined()
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
	let mgr: RuntimeManager
	afterEach(async () => {
		await mgr?.dispose()
	})

	it("a hook receives resolved settings as input.settings", async () => {
		const w = applySettingsWrite(SCHEMA, {}, { apiKey: "sk-live-123" })
		const settings = hookSettingsFor(MANIFEST, (w as any).next)!
		mgr = new RuntimeManager({ onInvocation: () => {} })
		mgr.register({
			id: "p",
			name: "Settings Test",
			bundleSource:
				"module.exports = { hooks: { v: (i) => ({ key: i.settings.apiKey, region: i.settings.region, n: i.n }) } }",
			bundleHash: "h-settings",
			backends: ["quickjs"],
			backend: "quickjs",
			sequential: false,
			settings
		})
		mgr.markReady()
		const r = await mgr.callHook("p", "v", { n: 7 }, { timeoutMs: 2000 })
		expect(r.ok).toBe(true)
		expect((r as any).value).toEqual({
			key: "sk-live-123",
			region: "eu",
			n: 7
		})
	})

	it("a settings-free descriptor leaves the input untouched", async () => {
		mgr = new RuntimeManager({ onInvocation: () => {} })
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
		const r = await mgr.callHook("q", "v", { n: 1 }, { timeoutMs: 2000 })
		expect(r.ok).toBe(true)
		expect((r as any).value).toEqual(["n"])
	})
})
