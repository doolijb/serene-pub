/**
 * The page's scene-image pins (R77, F10): a `clear-scene-image` clears the
 * page's own pin, so the cleared side leaves this browser's saved pins, the
 * layout's store and the pins every reader shares at once, and nothing puts
 * it back. The native widget cleared only the store.
 *
 * ⏳ W6: the pins are seeded, once, into each placed Scene Portraits
 * instance that drew them — as its chosen images, on a stage of the pinned
 * members — then cleared, which takes the key out of this browser. An
 * instance that never drew pins (Adventure's, `source: 'scene'`) is left
 * alone, and so are the pins.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync } from "svelte"
import { get, writable } from "svelte/store"
import { ScenePins, scenePinsStorageKey, type ScenePinsSeedDeps, type ScenePinsValue } from "./scenePins.svelte"
import { answerClearSceneImage } from "./requests/clearSceneImage"
import {
	setWidgetSettingDecls,
	setWidgetSettingValues,
	setWidgetSettingsWriter
} from "$lib/client/stores/widgetSettings.svelte"
import { CORE_WIDGETS } from "$lib/shared/widgets/types"
import type { SessionCharacterV1 } from "@serene-pub/sdk"

let cleanup: (() => void) | null = null

function open(sessionId: () => number | null, seed?: ScenePinsSeedDeps) {
	const store = writable<ScenePinsValue>({ left: null, right: null })
	let pins!: ScenePins
	cleanup = $effect.root(() => {
		pins = new ScenePins(sessionId, store, seed)
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

describe("⏳ W6: the pins are given to the Scene Portraits that drew them, then cleared", () => {
	const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`
	const member = (characterId: number, name: string, face: string | null): SessionCharacterV1 => ({
		ref: `character:${characterId}`,
		characterId,
		isPersona: false,
		mine: false,
		name,
		face,
		sprite: null,
		spriteSets: [],
		spriteSet: null,
		canChangeSpriteSet: false
	})
	const cast = { members: [member(3, "Ada", `/media/${U(1)}?r=1`), member(4, "Bo", null)], sceneImages: { left: null, right: null } }
	const portraits = CORE_WIDGETS.find((w) => w.id === "scene-portraits")!
	let written: Record<string, Record<string, unknown>>[] = []

	function seedDeps(over: Partial<ScenePinsSeedDeps> = {}): ScenePinsSeedDeps {
		return {
			surfaces: { seedCount: 1, sessionId: 4, instances: [{ id: "scene-portraits", active: true }] },
			characters: () => cast,
			// Bo's gallery holds the right pin; Ada's avatar is the left one.
			readGallery: async (id) => (id === 4 ? [{ id: 70, uuid: U(2) }] : [{ id: 60, uuid: U(1) }]),
			...over
		}
	}

	beforeEach(() => {
		written = []
		setWidgetSettingDecls({
			"scene-portraits": { id: "scene-portraits", title: portraits.title, settings: portraits.settings }
		})
		setWidgetSettingsWriter((next) => {
			written.push(next)
			setWidgetSettingValues(next)
		})
	})
	afterEach(() => {
		setWidgetSettingsWriter(null)
		setWidgetSettingValues({})
		setWidgetSettingDecls({})
	})

	test("an instance that stored nothing (0.6's default was pinned): a stage of the pinned members' chosen images; the key goes", async () => {
		setWidgetSettingValues({ "scene-portraits": { bars: true } })
		localStorage.setItem(
			scenePinsStorageKey(4),
			JSON.stringify({ left: `/media/${U(1)}?v=thumb&r=1`, right: `/media/${U(2)}?r=3` })
		)
		const { pins, store } = open(() => 4, seedDeps())
		await vi.waitFor(() => expect(localStorage.getItem(scenePinsStorageKey(4))).toBeNull())
		expect(written).toEqual([
			{
				"scene-portraits": {
					bars: true,
					who: "pick",
					pickMembers: ["Ada", "Bo"],
					face: "chosen",
					chosenImages: [`character:3=${U(1)}`, `character:4=${U(2)}`],
					arrangement: "stage"
				}
			}
		])
		expect([pins.left, pins.right]).toEqual([null, null])
		expect(get(store)).toEqual({ left: null, right: null })
	})

	test("a row the boot reconcile moved (who: pick, face: chosen, nothing chosen) takes the images and the names", async () => {
		setWidgetSettingValues({ "scene-portraits": { who: "pick", face: "chosen", arrangement: "stage" } })
		localStorage.setItem(scenePinsStorageKey(4), JSON.stringify({ left: null, right: `/media/${U(2)}?r=3` }))
		open(() => 4, seedDeps())
		await vi.waitFor(() => expect(written).toHaveLength(1))
		expect(written[0]!["scene-portraits"]).toEqual({
			who: "pick",
			pickMembers: ["Bo"],
			face: "chosen",
			chosenImages: [`character:4=${U(2)}`],
			arrangement: "stage"
		})
	})

	test("Adventure's instance (source: scene) never drew a pin: nothing is written, and the pins stay", async () => {
		setWidgetSettingValues({ "scene-portraits": { source: "scene", bars: true } })
		localStorage.setItem(scenePinsStorageKey(4), JSON.stringify({ left: `/media/${U(1)}?r=1`, right: null }))
		const { pins } = open(() => 4, seedDeps())
		await Promise.resolve()
		flushSync()
		expect(written).toEqual([])
		expect(pins.left).toBe(`/media/${U(1)}?r=1`)
		expect(localStorage.getItem(scenePinsStorageKey(4))).not.toBeNull()
	})

	test("nothing before the layout has landed for THIS session; a gallery that fails keeps the pins for next time", async () => {
		setWidgetSettingValues({})
		localStorage.setItem(scenePinsStorageKey(4), JSON.stringify({ left: `/media/${U(2)}?r=1`, right: null }))
		const reads: number[] = []
		const { pins } = open(
			() => 4,
			seedDeps({
				// Still the last session's surfaces.
				surfaces: { seedCount: 3, sessionId: 9, instances: [{ id: "scene-portraits", active: true }] },
				readGallery: async (id) => {
					reads.push(id)
					throw new Error("Failed to list gallery.")
				}
			})
		)
		await Promise.resolve()
		flushSync()
		expect(reads).toEqual([])
		cleanup?.()
		const again = open(() => 4, seedDeps({ readGallery: async () => { throw new Error("Failed to list gallery.") } }))
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
		expect(written).toEqual([])
		expect(again.pins.left).toBe(`/media/${U(2)}?r=1`)
		expect(pins.left).toBe(`/media/${U(2)}?r=1`)
	})
})
