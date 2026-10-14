/**
 * `character-images` (W6): the page pages a session member's gallery for
 * core's Scene Portraits through `characters:listGallery` — images only,
 * each by its file's uuid — and refuses a character the session does not
 * hold or a cursor it never gave out.
 */
import { describe, expect, it, vi } from "vitest"
import type { SessionCharactersV1 } from "@serene-pub/sdk"
import { answerCharacterImages, CHARACTER_IMAGES_PAGE } from "./characterImages"

const cast: SessionCharactersV1 = {
	members: [
		{
			ref: "character:3",
			characterId: 3,
			isPersona: false,
			mine: false,
			name: "Ada",
			face: null,
			sprite: null,
			spriteSets: [],
			spriteSet: null,
			canChangeSpriteSet: false,
			benched: true
		}
	],
	sceneImages: { left: null, right: null }
}

const file = (n: number, kind = "image") => ({
	uuid: `u-${n}`,
	url: `/media/u-${n}?r=1`,
	kind
})

describe("answerCharacterImages", () => {
	it("a member's images, each by uuid and display url — a benched member too; a video left out", async () => {
		const read = vi.fn(async () => [file(1), file(2, "video"), file(3)])
		await expect(
			answerCharacterImages(
				{ characterId: 3 },
				{ characters: () => cast, readCharacterGallery: read }
			)
		).resolves.toEqual({
			images: [
				{ ref: "u-1", src: "/media/u-1?r=1" },
				{ ref: "u-3", src: "/media/u-3?r=1" }
			]
		})
		expect(read).toHaveBeenCalledWith(3)
	})

	it("pages the gallery: the next cursor until the last page, which has none", async () => {
		const all = Array.from({ length: CHARACTER_IMAGES_PAGE + 2 }, (_, i) =>
			file(i)
		)
		const deps = {
			characters: () => cast,
			readCharacterGallery: async () => all
		}
		const first = await answerCharacterImages({ characterId: 3 }, deps)
		expect(first.images).toHaveLength(CHARACTER_IMAGES_PAGE)
		expect(first.nextCursor).toBe(String(CHARACTER_IMAGES_PAGE))
		const last = await answerCharacterImages(
			{ characterId: 3, cursor: first.nextCursor },
			deps
		)
		expect(last.images.map((i) => i.ref)).toEqual([
			`u-${CHARACTER_IMAGES_PAGE}`,
			`u-${CHARACTER_IMAGES_PAGE + 1}`
		])
		expect(last.nextCursor).toBeUndefined()
	})

	it("refuses a character not in the session, an id that is not one, a cursor it never gave, and before the cast arrives", async () => {
		const read = vi.fn(async () => [file(1)])
		const deps = { characters: () => cast, readCharacterGallery: read }
		await expect(
			answerCharacterImages({ characterId: 4 }, deps)
		).rejects.toThrow("not in this session")
		await expect(
			answerCharacterImages({ characterId: "3" as never }, deps)
		).rejects.toThrow("by its id")
		await expect(
			answerCharacterImages({ characterId: 3, cursor: "-1" }, deps)
		).rejects.toThrow("cursor")
		await expect(
			answerCharacterImages(
				{ characterId: 3 },
				{ characters: () => undefined, readCharacterGallery: read }
			)
		).rejects.toThrow("has not arrived")
		expect(read).not.toHaveBeenCalled()
	})

	it("the server's refusal is the asking widget's", async () => {
		await expect(
			answerCharacterImages(
				{ characterId: 3 },
				{
					characters: () => cast,
					readCharacterGallery: async () => {
						throw new Error("Failed to list gallery.")
					}
				}
			)
		).rejects.toThrow("Failed to list gallery.")
	})
})
