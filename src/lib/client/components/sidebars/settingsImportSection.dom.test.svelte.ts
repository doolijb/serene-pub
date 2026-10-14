/**
 * Owner note 23 (2026-10-02): the SillyTavern import moved from its own
 * `/import` page into Settings as the **Import** section, opened by the same
 * buttons through `digest.settingsSection`. An admin gets the row and the
 * digest lands on it (and is consumed); anyone else gets neither.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
vi.mock("$lib/shared/constants/version", () => ({
	appVersion: "0.0.0-test",
	appVersionDisplay: "0.0.0"
}))

const { rendered, stub } = vi.hoisted(() => {
	const rendered: string[] = []
	return {
		rendered,
		stub: (name: string) => ({
			default: () => {
				rendered.push(name)
			}
		})
	}
})
vi.mock("../settingsTabs/UserSettingsTab.svelte", () => stub("user"))
vi.mock("../settingsTabs/DataSettingsTab.svelte", () => stub("data"))
vi.mock("../media/MediaManagerTab.svelte", () => stub("media"))
vi.mock("../CustomThemeManager.svelte", () => stub("themes"))
vi.mock("../settingsTabs/ImportSettingsTab.svelte", () => stub("import"))

import SettingsSidebar from "./SettingsSidebar.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	rendered.length = 0
	document.body.innerHTML = ""
})

function mountAs(isAdmin: boolean) {
	const panelsCtx = $state({ digest: {} as PanelsCtx["digest"] })
	app = mount(SettingsSidebar, {
		target: document.body,
		props: {},
		context: new Map<string, unknown>([
			["panelsCtx", panelsCtx],
			["userCtx", { user: { id: 1, isAdmin } }],
			["systemSettingsCtx", { settings: { isAndroidWrapper: false } }]
		])
	})
	flushSync()
	return panelsCtx
}

// The sections are a section list (a nav of buttons), not a tablist, since
// the 2026-10-09 nav normalisation (ruling Q1).
const importTab = () =>
	[
		...document.querySelectorAll(
			'nav[aria-label="Settings sections"] button'
		)
	].find((t) => t.textContent?.trim() === "Import")

describe("Settings › Import", () => {
	test("an admin has the row, and the digest opens it", async () => {
		const panelsCtx = mountAs(true)
		expect(importTab()).toBeTruthy()
		// Unmeasured (jsdom) is compact, and a fresh open at compact is the
		// section list, so no section has mounted yet.
		expect(rendered).toEqual([])

		panelsCtx.digest.settingsSection = "import"
		flushSync()
		await tick()

		expect(rendered).toContain("import")
		expect(panelsCtx.digest.settingsSection).toBeUndefined()
	})

	test("anyone else has no row, and the digest is spent on nothing", async () => {
		const panelsCtx = mountAs(false)
		expect(importTab()).toBeFalsy()

		panelsCtx.digest.settingsSection = "import"
		flushSync()
		await tick()

		expect(rendered).not.toContain("import")
		expect(panelsCtx.digest.settingsSection).toBeUndefined()
	})

	test("Import stays mounted when back returns to the list", async () => {
		// A scan in flight answers on Import's interest, so leaving the
		// section — here, compact's back to the list — must not unmount it.
		const panelsCtx = mountAs(true)
		panelsCtx.digest.settingsSection = "import"
		flushSync()
		await tick()
		expect(
			document.querySelector("[data-panel-title]")?.textContent?.trim()
		).toBe("Import")
		// Shown: its host has moved out of the hidden parking box.
		const parking = document.querySelector("div[hidden]")
		expect(parking?.children).toHaveLength(0)

		const back = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Settings"]'
		)
		expect(back).toBeTruthy()
		back!.click()
		flushSync()
		await tick()
		expect(document.querySelector("[data-panel-title]")).toBeNull()
		expect(parking?.children).toHaveLength(1)
		;(importTab() as HTMLButtonElement).click()
		flushSync()
		await tick()
		expect(
			document.querySelector("[data-panel-title]")?.textContent?.trim()
		).toBe("Import")
		expect(rendered.filter((r) => r === "import")).toHaveLength(1)
	})
})
