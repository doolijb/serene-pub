/**
 * The user picker dialog is named by its visible title.
 */
import { afterEach, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$lib/client/sockets/interest.svelte", () => ({
	requestWithInterest: () => () => {}
}))

import UserSelectModal from "./UserSelectModal.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

test("the dialog is labelled by its title", async () => {
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(UserSelectModal, {
		target: host,
		context: new Map([["userCtx", { user: { id: 1 } }]]),
		props: {
			open: true,
			onclose: () => {},
			onSelect: () => {},
			title: "Add guests to session"
		}
	})
	flushSync()
	await tick()
	const dialog = document.querySelector("[role=dialog]")
	const id = dialog?.getAttribute("aria-labelledby")
	expect(id).toBeTruthy()
	expect(document.getElementById(id!)?.textContent?.trim()).toBe(
		"Add guests to session"
	)
})
