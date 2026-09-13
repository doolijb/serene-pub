import { describe, expect, test } from "vitest"
import { avatarFrameCommit } from "./avatarFrameCommit"

const FRAME = { x: 10, y: 0, w: 300, h: 300 }

describe("what a saved form does with the crop it was given", () => {
	test("a chosen file whose crop was saved uploads, then frames what came back", () => {
		expect(avatarFrameCommit({ frame: FRAME }, 12)).toEqual({
			mediaId: 12,
			frame: FRAME
		})
	})

	test("a cancelled editor uploads and frames nothing", () => {
		expect(avatarFrameCommit(null, 12)).toBeNull()
	})

	test("a reset crop clears the stored frame rather than writing the default down", () => {
		expect(avatarFrameCommit({ frame: null }, 12)).toEqual({
			mediaId: 12,
			frame: null
		})
	})

	test("no avatar came back, so there is nothing to frame", () => {
		expect(avatarFrameCommit({ frame: FRAME }, null)).toBeNull()
		expect(avatarFrameCommit({ frame: FRAME }, undefined)).toBeNull()
	})
})
