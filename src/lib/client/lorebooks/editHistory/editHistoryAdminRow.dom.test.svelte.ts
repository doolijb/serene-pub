/** 🚧 Admin › Data: the Edit history row and its confirmed Clear. */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
const { socket, replies, emits } = vi.hoisted(() => ({
	socket: { emit: () => {}, on: () => {}, off: () => {} },
	replies: {} as Record<string, () => Promise<unknown>>,
	emits: [] as { event: string; params: unknown }[]
}))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/utils/awaitReply", () => ({
	awaitReply: (o: { event: string; params: unknown }) => {
		emits.push({ event: o.event, params: o.params })
		return (replies[o.event] ?? (() => Promise.reject(new Error("no"))))()
	}
}))

import EditHistoryAdminRow from "./EditHistoryAdminRow.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	emits.length = 0
	for (const k of Object.keys(replies)) delete replies[k]
})

const tick = async () => {
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}
async function render() {
	app = mount(EditHistoryAdminRow, { target: document.body })
	flushSync()
	await tick()
}
const clearButton = () =>
	[...document.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === "Clear"
	) as HTMLButtonElement
const confirmButton = () =>
	[...document.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === "Clear edit history"
	) as HTMLButtonElement

describe("Admin › Data edit history row", () => {
	test("shows count and size; Clear asks naming the count; confirming clears", async () => {
		let n = 40
		replies["admin:redlineSummary"] = () =>
			Promise.resolve({ count: n, bytes: 2048 })
		replies["admin:clearRedlines"] = () => {
			n = 0
			return Promise.resolve({ cleared: 40 })
		}
		await render()
		expect(document.body.textContent).toContain(
			"Edit history · 40 edits · 2 KB"
		)
		clearButton().click()
		await tick()
		expect(document.body.textContent).toContain("Removes 40 edits")
		confirmButton().click()
		await tick()
		expect(emits.some((e) => e.event === "admin:clearRedlines")).toBe(true)
		expect(clearButton().disabled).toBe(true)
	})

	test("Clear is disabled at 0", async () => {
		replies["admin:redlineSummary"] = () =>
			Promise.resolve({ count: 0, bytes: 0 })
		await render()
		expect(clearButton().disabled).toBe(true)
	})
})
