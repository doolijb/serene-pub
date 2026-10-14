/**
 * The lore-writes-off notice is a way to the setting, not only a sentence
 * (less-confusing G6): its button opens Settings at User, then lets the host
 * step aside. Drawn with no shell around it, it says the whole sentence.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import {
	LORE_WRITES_OFF_NOTICE,
	LORE_WRITES_OFF_NOTICE_ACTION,
	LORE_WRITES_OFF_NOTICE_LEAD
} from "$lib/shared/lorebooks/loreWriteMode"
import LoreWritesOffNotice from "./LoreWritesOffNotice.svelte"

let app: Record<string, any> | null = null

afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

function host() {
	const el = document.createElement("div")
	document.body.append(el)
	return el
}

async function settle() {
	flushSync()
	await tick()
	flushSync()
}

describe("LoreWritesOffNotice", () => {
	test("its button opens Settings at User, then the host's step-aside", async () => {
		const calls: string[] = []
		const panelsCtx = {
			digest: {} as Record<string, unknown>,
			openView: vi.fn((key: string, opts?: { toggle?: boolean }) => {
				calls.push(`open:${key}:${opts?.toggle}`)
			})
		}
		const onOpenSettings = vi.fn(() => calls.push("host"))
		app = mount(LoreWritesOffNotice, {
			target: host(),
			props: { onOpenSettings },
			context: new Map<string, unknown>([["panelsCtx", panelsCtx]])
		})
		await settle()
		expect(document.body.textContent).toContain(LORE_WRITES_OFF_NOTICE_LEAD)
		const button = document.querySelector<HTMLButtonElement>(
			"[data-lore-writes-off-open-settings]"
		)!
		expect(button.textContent?.trim()).toBe(LORE_WRITES_OFF_NOTICE_ACTION)
		button.click()
		await settle()
		expect(panelsCtx.digest.settingsSection).toBe("user")
		expect(calls).toEqual(["open:settings:false", "host"])
	})

	test("with no shell around it, it names the setting in words", async () => {
		app = mount(LoreWritesOffNotice, { target: host(), props: {} })
		await settle()
		expect(document.body.textContent).toContain(LORE_WRITES_OFF_NOTICE)
		expect(
			document.querySelector("[data-lore-writes-off-open-settings]")
		).toBeNull()
	})
})
