import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

/**
 * Guards the distinction that stops Document View becoming a browser's
 * permanent default by accident: activating it for a visit must NOT write the
 * localStorage preference, and only the explicit opt-in may.
 *
 * Before this split, src/routes/document-view/+layout.svelte called
 * enableAccessibility() on any landing, so a bookmark, a shared URL or the
 * /document-view/help link inside the in-app docs silently made Document View
 * the default — with the only off-switch buried in Document View's own
 * settings page.
 *
 * vitest runs `environment: "node"` (vitest.config.ts), so there is no DOM:
 * `window`, `localStorage` and `sessionStorage` are stubbed here. The module
 * reads them through its own `typeof window === "undefined"` guards, so the
 * stubs have to exist before it is imported — hence the dynamic import with a
 * fresh module registry per test.
 */

const MODE_KEY = "serene-pub:a11y-mode"
const PAUSED_KEY = "serene-pub:a11y-paused"

function makeStorage() {
	const map = new Map<string, string>()
	return {
		getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
		setItem: (k: string, v: string) => void map.set(k, String(v)),
		removeItem: (k: string) => void map.delete(k),
		clear: () => map.clear(),
		get size() {
			return map.size
		}
	}
}

let localStorageStub: ReturnType<typeof makeStorage>
let sessionStorageStub: ReturnType<typeof makeStorage>

async function loadModule() {
	// Fresh copy each time: the store singleton and its $state fields persist
	// across imports otherwise, so one test's enable() would leak into the next.
	vi.resetModules()
	return await import("./state.svelte")
}

beforeEach(() => {
	localStorageStub = makeStorage()
	sessionStorageStub = makeStorage()
	vi.stubGlobal("window", {
		localStorage: localStorageStub,
		sessionStorage: sessionStorageStub,
		requestAnimationFrame: (cb: FrameRequestCallback) => {
			cb(0)
			return 0
		}
	})
	vi.stubGlobal("localStorage", localStorageStub)
	vi.stubGlobal("sessionStorage", sessionStorageStub)
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("activateForSession", () => {
	it("turns Document View on without recording a preference", async () => {
		const m = await loadModule()

		m.activateForSession()

		expect(m.accessibilityModeStore.enabled).toBe(true)
		expect(m.accessibilityModeStore.persisted).toBe(false)
		expect(localStorageStub.getItem(MODE_KEY)).toBeNull()
	})

	it("leaves the next load on the standard site", async () => {
		const m = await loadModule()

		m.activateForSession()

		// What the root layout reads on the following page load.
		expect(m.isAccessibilityEnabled()).toBe(false)
	})

	it("is idempotent", async () => {
		const m = await loadModule()

		m.activateForSession()
		m.activateForSession()

		expect(m.accessibilityModeStore.enabled).toBe(true)
		expect(localStorageStub.size).toBe(0)
	})
})

describe("enableAccessibility", () => {
	it("records the preference so it survives the next load", async () => {
		const m = await loadModule()

		m.enableAccessibility()

		expect(m.accessibilityModeStore.enabled).toBe(true)
		expect(m.accessibilityModeStore.persisted).toBe(true)
		expect(localStorageStub.getItem(MODE_KEY)).toBe("true")
		expect(m.isAccessibilityEnabled()).toBe(true)
	})

	it("clears a paused session so the redirect isn't suppressed", async () => {
		const m = await loadModule()
		m.pause()
		expect(sessionStorageStub.getItem(PAUSED_KEY)).toBe("true")

		m.enableAccessibility()

		expect(sessionStorageStub.getItem(PAUSED_KEY)).toBeNull()
	})
})

describe("disableAccessibility", () => {
	it("records an explicit opt-out", async () => {
		const m = await loadModule()
		m.enableAccessibility()

		m.disableAccessibility()

		expect(m.accessibilityModeStore.enabled).toBe(false)
		expect(m.accessibilityModeStore.persisted).toBe(false)
		expect(m.isAccessibilityEnabled()).toBe(false)
	})

	it('writes "false" rather than deleting the key', async () => {
		// An absent key means "never chose", which falls back to
		// PUBLIC_DOCUMENT_VIEW_DEFAULT. Deleting it made turning Document View
		// off last only until the next load on deployments that set the env var.
		const m = await loadModule()
		m.enableAccessibility()

		m.disableAccessibility()

		expect(localStorageStub.getItem(MODE_KEY)).toBe("false")
	})

	it("also clears the paused flag rather than leaving it stranded", async () => {
		const m = await loadModule()
		m.enableAccessibility()
		m.pause()

		m.disableAccessibility()

		expect(sessionStorageStub.getItem(PAUSED_KEY)).toBeNull()
		expect(m.isPaused()).toBe(false)
	})
})

describe("pause", () => {
	it("is session-only and keeps the stored preference intact", async () => {
		const m = await loadModule()
		m.enableAccessibility()

		m.pause()

		expect(localStorageStub.getItem(MODE_KEY)).toBe("true")
		expect(m.isAccessibilityEnabled()).toBe(true)
		expect(m.isPaused()).toBe(true)
	})
})
