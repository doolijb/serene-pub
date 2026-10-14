/**
 * ⏳ The session page's scene-image pins: the portrait pinned on each side
 * of the stage, from before W6 (2026-10-11). Nothing pins any more — the
 * composer's Pinned images pane is gone, and a Scene Portraits instance
 * keeps its own **chosen images** — so this only SEEDS and CLEARS: it loads
 * a session's old pins from this browser (`sceneImages:<sessionId>`), and,
 * once the session's layout and cast have landed, gives them to each placed
 * Scene Portraits instance that drew them (`scenePinsSeed.ts`), through the
 * one settings writer the settings sheet uses (`patchWidgetSettings`), and
 * then clears them, which takes the key out of this browser.
 *
 * Until then the pins still ride `characters.v1` (`sceneImages`, ⏳) and a
 * `clear-scene-image` (⏳) still clears one, persisted here and mirrored
 * into the `sceneImages` store, so page and widget read one answer (R77,
 * F10). REMOVE in 0.7.0 with the key.
 *
 * Construct it during component init: its effects belong to the component.
 */
import { tick } from "svelte"
import type { Writable } from "svelte/store"
import { widgetOfInstance, type SessionCharactersV1 } from "@serene-pub/sdk"
import { sceneImages as sharedSceneImages } from "$lib/client/stores/sceneImages"
import {
	patchWidgetSettings,
	widgetSettingDecl,
	widgetSettingValues
} from "$lib/client/stores/widgetSettings.svelte"
import type { SceneImagePins } from "./requests/clearSceneImage"
import {
	seedFromPins,
	seedPatch,
	takesPins,
	type PinGalleryFile
} from "./scenePinsSeed"

export type ScenePinsValue = { left: string | null; right: string | null }

/** Where one session's pins are kept in this browser. */
export const scenePinsStorageKey = (sessionId: number) =>
	`sceneImages:${sessionId}`

/** What the one-time seed reads off the page (W6). */
export interface ScenePinsSeedDeps {
	/**
	 * The page's surface manager: which widget instances the session's
	 * layout places, once it has been seeded for THIS session — never
	 * another's, whose instances it still holds until the next one lands.
	 */
	surfaces: {
		readonly seedCount: number
		readonly sessionId: number | null
		readonly instances: readonly { id: string; active: boolean }[]
	}
	/** The cast the page projects (`characters.v1`). */
	characters(): SessionCharactersV1 | undefined
	/** One member's gallery (`characters:listGallery`). */
	readGallery(characterId: number): Promise<readonly PinGalleryFile[]>
}

export class ScenePins implements SceneImagePins {
	left = $state<string | null>(null)
	right = $state<string | null>(null)
	#loaded = $state(false)
	/** A seed on its way: not state, nothing draws it. */
	#seeding = false

	constructor(
		sessionId: () => number | null | undefined,
		store: Writable<ScenePinsValue> = sharedSceneImages,
		seed?: ScenePinsSeedDeps
	) {
		// Load: each session opens with its own pins, or none.
		$effect(() => {
			const id = sessionId()
			this.#loaded = false
			this.left = null
			this.right = null
			if (id) {
				try {
					const saved = localStorage.getItem(scenePinsStorageKey(id))
					if (saved) {
						const { left, right } = JSON.parse(saved)
						this.left = left ?? null
						this.right = right ?? null
					}
				} catch {}
			}
			this.#loaded = true
		})
		// Persist every change after the load; an empty stage keeps nothing.
		$effect(() => {
			if (!this.#loaded) return
			const id = sessionId()
			if (!id) return
			const left = this.left
			const right = this.right
			try {
				if (left || right)
					localStorage.setItem(
						scenePinsStorageKey(id),
						JSON.stringify({ left, right })
					)
				else localStorage.removeItem(scenePinsStorageKey(id))
			} catch {}
		})
		// Mirror into the store the layout draws from.
		$effect(() => {
			store.set({ left: this.left, right: this.right })
		})
		// ⏳ Seed, then clear (W6): once, when there is something to give and
		// somewhere to give it.
		if (seed)
			$effect(() => {
				if (!this.#loaded || (!this.left && !this.right)) return
				const id = sessionId()
				const s = seed.surfaces
				if (!id || s.seedCount === 0 || s.sessionId !== id) return
				const cast = seed.characters()
				if (!cast) return
				const targets = s.instances
					.filter(
						(p) =>
							p.active &&
							widgetOfInstance(p.id) === "scene-portraits" &&
							!!widgetSettingDecl(p.id) &&
							takesPins(widgetSettingValues(p.id))
					)
					.map((p) => p.id)
				if (!targets.length || this.#seeding) return
				this.#seeding = true
				void this.#seed(
					id,
					sessionId,
					{ left: this.left, right: this.right },
					cast,
					seed,
					targets
				)
			})
	}

	async #seed(
		id: number,
		sessionId: () => number | null | undefined,
		pins: ScenePinsValue,
		cast: SessionCharactersV1,
		seed: ScenePinsSeedDeps,
		targets: string[]
	): Promise<void> {
		try {
			const result = await seedFromPins(
				pins,
				cast.members,
				(characterId) => seed.readGallery(characterId)
			)
			// Moved on to another session, or a gallery did not answer: keep
			// the pins for the next open.
			if (sessionId() !== id || result.failed) return
			if (result.chosenImages.length)
				for (const instance of targets) {
					const stored = widgetSettingValues(instance)
					if (!takesPins(stored)) continue
					patchWidgetSettings(instance, seedPatch(stored, result))
					// Each write starts from the values as last held: let this
					// one land before the next is built on it.
					await tick()
				}
			if (sessionId() !== id) return
			// Given, or picturing nobody here: either way, done with.
			this.left = null
			this.right = null
		} finally {
			this.#seeding = false
		}
	}

	/** ⏳ Take down one side's portrait (`clear-scene-image`). An empty side is already clear. */
	clear(side: "left" | "right") {
		if (side === "left") this.left = null
		else this.right = null
	}
}
