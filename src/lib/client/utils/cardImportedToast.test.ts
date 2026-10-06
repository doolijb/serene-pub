import { describe, expect, test } from "vitest"
import { cardImportedToast } from "./cardImportedToast"

describe("cardImportedToast", () => {
	const character = { name: "Aria", nickname: null }

	test("a created card is a success", () => {
		expect(cardImportedToast({ status: "created", character })).toEqual({
			kind: "success",
			title: "Character imported",
			description: "Character Aria imported successfully."
		})
	})

	test("warnings are a warning that still says it imported", () => {
		const t = cardImportedToast({
			status: "created",
			character,
			warnings: ["The avatar was too large."]
		})
		expect(t?.kind).toBe("warning")
		expect(t?.description).toBe(
			"Aria was imported. The avatar was too large."
		)
	})

	test("an unchanged card is a success naming the existing character", () => {
		expect(
			cardImportedToast({ status: "unchanged", character })?.title
		).toBe("Character already imported")
	})

	test("a conflict has no toast — the conflict dialog answers it", () => {
		expect(
			cardImportedToast({ status: "conflict", character: null })
		).toBeNull()
	})

	test("the nickname wins over the name", () => {
		expect(
			cardImportedToast({ character: { name: "Aria", nickname: "Ari" } })
				?.description
		).toBe("Character Ari imported successfully.")
	})
})
