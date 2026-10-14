/**
 * ⏳ W6 (2026-10-11): the composer's **Pinned images** pane is retired — a
 * Scene Portraits instance chooses its own images. The page registers no
 * `scene-images` host view, the composer's More menu offers no tab for it,
 * and its component is gone. (The host view NAME stays in the SDK's
 * `HOST_VIEW_NAMES` until 0.7.0 and draws nothing.)
 */
import { describe, expect, test } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { HOST_VIEW_NAMES } from "@serene-pub/sdk"

const here = (file: string) => resolve(__dirname, file)

describe("the Pinned images pane is gone (W6)", () => {
	test("no host view draws it and no More-menu tab offers it", () => {
		const views = readFileSync(here("SessionHostViews.svelte"), "utf8")
		expect(views).not.toMatch(/"scene-images":/)
		expect(views).not.toMatch(/SessionSceneImagesTab/)
		const projections = readFileSync(
			here("sessionPageProjections.ts"),
			"utf8"
		)
		expect(projections).not.toMatch(/view:\s*"scene-images"/)
		expect(projections).not.toMatch(/title:\s*"Pinned images"/)
		expect(existsSync(here("SessionSceneImagesTab.svelte"))).toBe(false)
	})

	test("⏳ the SDK still knows the name, so a stored placement draws nothing rather than failing", () => {
		expect(HOST_VIEW_NAMES).toContain("scene-images")
	})
})
