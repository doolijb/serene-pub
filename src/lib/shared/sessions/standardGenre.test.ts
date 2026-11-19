import { describe, expect, it } from "vitest"
import { STANDARD_GENRE_ID } from "./standardGenre"

describe("STANDARD_GENRE_ID", () => {
	it("is the Story genre", () => {
		expect(STANDARD_GENRE_ID).toBe("core:genre/story")
	})
})
