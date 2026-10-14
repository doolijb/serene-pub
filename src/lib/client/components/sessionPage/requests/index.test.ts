/**
 * The request table (C1): the page answers every kind the SDK names and no
 * other — the type law, held at runtime too — and an answer reads the page
 * when a request arrives, never when the answerer was built.
 */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_KINDS } from "@serene-pub/sdk"
import {
	setWidgetSettingDecls,
	setWidgetSettingsWriter,
	setWidgetSettingValues,
	widgetSettingValues
} from "$lib/client/stores/widgetSettings.svelte"
import {
	buildWidgetRequestAnswerer,
	WIDGET_REQUEST_ANSWERS,
	type WidgetRequestDeps
} from "./index"

const core = { widgetId: "core:messages", owner: "core" }

describe("WIDGET_REQUEST_ANSWERS", () => {
	test("holds exactly the SDK's request kinds", () => {
		expect(Object.keys(WIDGET_REQUEST_ANSWERS).sort()).toEqual(
			[...WIDGET_REQUEST_KINDS].sort()
		)
	})
})

describe("buildWidgetRequestAnswerer", () => {
	test("a kind the table does not hold is refused, never answered", async () => {
		const answer = buildWidgetRequestAnswerer({} as WidgetRequestDeps)
		await expect(
			answer("toString" as never, {} as never, core)
		).rejects.toThrow("'toString' is not something this page answers")
	})

	test("reads the page when asked; a kind that opens something resolves with nothing", async () => {
		let sessionId: number | null = null
		const drafts: string[] = []
		const answer = buildWidgetRequestAnswerer({
			sessionId: () => sessionId,
			setDraft: (content: string) => drafts.push(content),
			readAuthorsNote: async (ask: { sessionId: number }) => ({
				note: { askedFor: ask.sessionId }
			})
		} as unknown as WidgetRequestDeps)

		await expect(answer("authors-note", {}, core)).rejects.toThrow(
			"no session"
		)
		sessionId = 7
		await expect(answer("authors-note", {}, core)).resolves.toEqual({
			askedFor: 7
		})
		await expect(
			answer("draft", { content: "hi" }, core)
		).resolves.toBeUndefined()
		expect(drafts).toEqual(["hi"])
	})

	test("session-places (W4) reads the page's session through its places read", async () => {
		const asked: unknown[] = []
		const answer = buildWidgetRequestAnswerer({
			sessionId: () => 7,
			readSessionPlaces: async (ask: { sessionId: number }) => {
				asked.push(ask)
				return { sessionId: ask.sessionId, places: { lorebookId: 4, asOf: null, places: [], ways: [] } }
			}
		} as unknown as WidgetRequestDeps)
		await expect(answer("session-places", {}, core)).resolves.toEqual({
			lorebookId: 4,
			asOf: null,
			places: [],
			ways: []
		})
		expect(asked).toEqual([{ sessionId: 7 }])
	})

	test("character-images (W6) reads a member's gallery through the page's gallery read, read when asked", async () => {
		let members: { characterId: number }[] = []
		const asked: number[] = []
		const answer = buildWidgetRequestAnswerer({
			characters: () => ({ members, sceneImages: { left: null, right: null } }),
			readCharacterGallery: async (id: number) => {
				asked.push(id)
				return [{ uuid: "u-1", url: "/media/u-1?r=1", kind: "image" }]
			}
		} as unknown as WidgetRequestDeps)
		await expect(answer("character-images", { characterId: 3 }, core)).rejects.toThrow("not in this session")
		members = [{ characterId: 3 }]
		await expect(answer("character-images", { characterId: 3 }, core)).resolves.toEqual({
			images: [{ ref: "u-1", src: "/media/u-1?r=1" }]
		})
		expect(asked).toEqual([3])
	})

	test("stat-trail (F2) reads the page's session through its trail read", async () => {
		const asked: unknown[] = []
		const changes = [{ messageId: 5, at: 1, from: 20, to: 14, by: "model" }]
		const answer = buildWidgetRequestAnswerer({
			sessionId: () => 7,
			readStatTrail: async (ask: unknown) => {
				asked.push(ask)
				return { sessionId: 7, trail: { changes } }
			}
		} as unknown as WidgetRequestDeps)
		await expect(
			answer("stat-trail", { owner: { kind: "session_cast", id: 3 }, slotId: "hp", limit: 5 }, core)
		).resolves.toEqual({ changes })
		expect(asked).toEqual([{ sessionId: 7, owner: { kind: "session_cast", id: 3 }, slotId: "hp", limit: 5 }])
	})

	test("set-chosen-image (F2) writes the ASKING instance's own settings through the settings store", async () => {
		const written: Record<string, Record<string, unknown>>[] = []
		const field = { type: "string[]", label: "Chosen images", default: [] }
		setWidgetSettingDecls({
			"scene-portraits#2": { id: "scene-portraits#2", title: "Portraits", settings: { chosenImages: field } as never },
			stats: { id: "stats", title: "Stats", settings: {} }
		})
		setWidgetSettingValues({ "scene-portraits#2": { chosenImages: ["character:4=u-9"] } })
		setWidgetSettingsWriter((next) => {
			written.push(next)
			setWidgetSettingValues(next)
		})
		try {
			const answer = buildWidgetRequestAnswerer({
				characters: () => ({
					members: [{ ref: "character:3", characterId: 3 }],
					sceneImages: { left: null, right: null }
				})
			} as unknown as WidgetRequestDeps)
			const portraits = { widgetId: "scene-portraits#2", owner: "core" }
			await expect(
				answer("set-chosen-image", { characterRef: "character:3", mediaRef: "u-2" }, portraits)
			).resolves.toBeUndefined()
			expect(widgetSettingValues("scene-portraits#2")).toEqual({
				chosenImages: ["character:4=u-9", "character:3=u-2"]
			})
			// Another instance's settings are never the target.
			await expect(
				answer("set-chosen-image", { characterRef: "character:3", mediaRef: "u-2" }, { widgetId: "stats", owner: "core" })
			).rejects.toThrow("keeps no chosen images")
			expect(written).toHaveLength(1)
		} finally {
			setWidgetSettingsWriter(null)
			setWidgetSettingDecls({})
			setWidgetSettingValues({})
		}
	})
})
