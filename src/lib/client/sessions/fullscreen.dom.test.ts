/**
 * Full screen (SHAPES L1): a per-viewer, per-session stored choice. Each test
 * uses ids of its own because the state is module-level.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("$app/environment", () => ({ browser: true, dev: true, building: false }))

import {
	FULLSCREEN_NOTICE,
	FULLSCREEN_NOTICE_TOUCH,
	FULLSCREEN_PREF_KEY,
	useSessionFullscreen
} from "./fullscreen.svelte"

function memoryStorage() {
	const m = new Map<string, string>()
	return {
		getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
		setItem: (k: string, v: string) => void m.set(k, String(v)),
		removeItem: (k: string) => void m.delete(k),
		clear: () => m.clear(),
		key: (i: number) => [...m.keys()][i] ?? null,
		get length() {
			return m.size
		}
	}
}

beforeEach(() => {
	vi.stubGlobal("localStorage", memoryStorage())
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe("useSessionFullscreen", () => {
	test("enter, exit and toggle write on/off under the session's key", () => {
		const fs = useSessionFullscreen(101)
		expect(fs.on).toBe(false)
		fs.enter()
		expect(fs.on).toBe(true)
		expect(localStorage.getItem(FULLSCREEN_PREF_KEY(101))).toBe("on")
		fs.exit()
		expect(fs.on).toBe(false)
		expect(localStorage.getItem(FULLSCREEN_PREF_KEY(101))).toBe("off")
		fs.toggle()
		expect(fs.on).toBe(true)
		expect(localStorage.getItem(FULLSCREEN_PREF_KEY(101))).toBe("on")
		fs.toggle()
		expect(localStorage.getItem(FULLSCREEN_PREF_KEY(101))).toBe("off")
	})

	test("two sessions are independent", () => {
		useSessionFullscreen(102).enter()
		expect(useSessionFullscreen(102).on).toBe(true)
		expect(useSessionFullscreen(103).on).toBe(false)
		expect(localStorage.getItem(FULLSCREEN_PREF_KEY(103))).toBeNull()
	})

	test("a stored off reads back as off; a stored on as on", () => {
		localStorage.setItem(FULLSCREEN_PREF_KEY(104), "off")
		localStorage.setItem(FULLSCREEN_PREF_KEY(105), "on")
		expect(useSessionFullscreen(104).on).toBe(false)
		expect(useSessionFullscreen(105).on).toBe(true)
	})

	test("propose() enters with the notice only when nothing is stored", () => {
		vi.stubGlobal("matchMedia", () => ({ matches: true }))
		const fs = useSessionFullscreen(106)
		expect(fs.propose()).toBe(true)
		expect(fs.on).toBe(true)
		expect(fs.notice).toBe(FULLSCREEN_NOTICE)
		fs.clearNotice()
		expect(fs.notice).toBeNull()

		vi.stubGlobal("matchMedia", () => ({ matches: false }))
		const touch = useSessionFullscreen(109)
		expect(touch.propose()).toBe(true)
		expect(touch.notice).toBe(FULLSCREEN_NOTICE_TOUCH)

		localStorage.setItem(FULLSCREEN_PREF_KEY(107), "off")
		const other = useSessionFullscreen(107)
		expect(other.propose()).toBe(false)
		expect(other.on).toBe(false)
		expect(other.notice).toBeNull()
	})

	test("a throwing localStorage neither throws nor blocks on/off in memory", () => {
		vi.stubGlobal("localStorage", {
			getItem: () => {
				throw new Error("blocked")
			},
			setItem: () => {
				throw new Error("blocked")
			}
		})
		const fs = useSessionFullscreen(108)
		expect(() => fs.enter()).not.toThrow()
		expect(fs.on).toBe(true)
		expect(() => fs.exit()).not.toThrow()
		expect(fs.on).toBe(false)
	})
})
