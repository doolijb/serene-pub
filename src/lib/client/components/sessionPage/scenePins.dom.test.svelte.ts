/**
 * The page's scene-image pins (R77, F10): a `clear-scene-image` clears the
 * page's own pin, so the cleared side leaves this browser's saved pins, the
 * layout's store and the pins every reader shares at once, and nothing puts
 * it back. The native widget cleared only the store.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync } from "svelte"
import { get, writable } from "svelte/store"
import { ScenePins, scenePinsStorageKey, type ScenePinsValue } from "./scenePins.svelte"
import { answerClearSceneImage } from "./requests/clearSceneImage"

let cleanup: (() => void) | null = null

function open(sessionId: () => number | null) {
	const store = writable<ScenePinsValue>({ left: null, right: null })
	let pins!: ScenePins
	cleanup = $effect.root(() => {
		pins = new ScenePins(sessionId, store)
	})
	flushSync()
	return { pins, store }
}

/** This browser's storage, as a plain table (Node's own global is unusable here). */
function memoryStorage(): Storage {
	const rows = new Map<string, string>()
	return {
		get length() {
			return rows.size
		},
		clear: () => rows.clear(),
		getItem: (k) => rows.get(k) ?? null,
		key: (i) => [...rows.keys()][i] ?? null,
		removeItem: (k) => void rows.delete(k),
		setItem: (k, v) => void rows.set(k, String(v))
	}
}

beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()))
afterEach(() => {
	cleanup?.()
	cleanup = null
	vi.unstubAllGlobals()
})

describe("the page's scene-image pins", () => {
	test("a session opens with the pins this browser saved for it, mirrored into the store", () => {
		localStorage.setItem(scenePinsStorageKey(4), JSON.stringify({ left: "/a.png", right: "/b.png" }))
		const { pins, store } = open(() => 4)
		expect([pins.left, pins.right]).toEqual(["/a.png", "/b.png"])
		expect(get(store)).toEqual({ left: "/a.png", right: "/b.png" })
	})

	test("clear-scene-image clears the page's pin: saved pins, the store and the pins agree, and it stays cleared", () => {
		localStorage.setItem(scenePinsStorageKey(4), JSON.stringify({ left: "/a.png", right: "/b.png" }))
		const { pins, store } = open(() => 4)

		answerClearSceneImage({ side: "left" }, pins)
		flushSync()

		expect(pins.left).toBeNull()
		expect(get(store)).toEqual({ left: null, right: "/b.png" })
		expect(JSON.parse(localStorage.getItem(scenePinsStorageKey(4))!)).toEqual({
			left: null,
			right: "/b.png"
		})

		// The next change anywhere does not bring the cleared side back.
		pins.right = "/c.png"
		flushSync()
		expect(get(store)).toEqual({ left: null, right: "/c.png" })

		answerClearSceneImage({ side: "right" }, pins)
		flushSync()
		expect(get(store)).toEqual({ left: null, right: null })
		expect(localStorage.getItem(scenePinsStorageKey(4))).toBeNull()
	})

	test("another session opens with its own pins, not the last one's", () => {
		localStorage.setItem(scenePinsStorageKey(4), JSON.stringify({ left: "/a.png", right: null }))
		let id = $state<number | null>(4)
		const { pins, store } = open(() => id)
		expect(pins.left).toBe("/a.png")

		id = 5
		flushSync()
		expect([pins.left, pins.right]).toEqual([null, null])
		expect(get(store)).toEqual({ left: null, right: null })
		expect(localStorage.getItem(scenePinsStorageKey(4))).not.toBeNull()
	})
})
