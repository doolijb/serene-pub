/**
 * The envelope's `viewer` section carries the person's advanced controls
 * switch, live (2026-11-10): off while settings haven't arrived, and it
 * follows a change to the settings with no new push.
 */
import { describe, expect, test, vi } from "vitest"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

import { createEnvelopeSections } from "./envelopeSections.svelte"

type Settings = { showAdvancedControls?: boolean } | null

function viewerFor(ctx: { settings: Settings }) {
	const sections = createEnvelopeSections({
		data: { isGuest: false },
		userCtx: { user: { id: 7, isAdmin: false } },
		userSettingsCtx: ctx
	} as never)
	return sections.viewer
}

describe("envelope viewer.advancedControls", () => {
	test("is false with no settings yet, and with the switch off", () => {
		expect(viewerFor({ settings: null }).current.advancedControls).toBe(false)
		expect(viewerFor({ settings: { showAdvancedControls: false } }).current.advancedControls).toBe(
			false
		)
	})

	test("is true with the switch on, and follows a change to the settings", () => {
		const ctx = $state<{ settings: Settings }>({ settings: { showAdvancedControls: true } })
		const viewer = viewerFor(ctx)
		expect(viewer.current.advancedControls).toBe(true)
		ctx.settings = { showAdvancedControls: false }
		expect(viewer.current.advancedControls).toBe(false)
		ctx.settings = { showAdvancedControls: true }
		expect(viewer.current.advancedControls).toBe(true)
	})
})
