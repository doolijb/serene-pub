/**
 * The person's own plugin settings card: a reply clears only the draft and the
 * error of the plugin it answers; a failed save keeps its typed values and its
 * error on screen; "Settings saved" is said only of what saved.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { socket, handlers, notices } = vi.hoisted(() => ({
	socket: { emit: vi.fn(), on: () => {}, off: () => {} },
	handlers: new Map<string, (msg: any) => void>(),
	notices: [] as Array<{ kind: string; title: string }>
}))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	requestWithInterest: (
		event: string,
		_p: unknown,
		handler: (msg: any) => void
	) => {
		handlers.set(event, handler)
		return () => {}
	},
	useInterest: (event: string, handler: (msg: any) => void) => {
		handlers.set(event, handler)
		return () => {}
	}
}))
vi.mock("$lib/client/utils/notify", () => ({
	notify: {
		success: (t: any) => notices.push({ kind: "success", ...t }),
		error: (t: any) => notices.push({ kind: "error", ...t })
	}
}))

import Card from "./PluginUserSettingsCard.svelte"

const plugin = (pluginId: string) => ({
	pluginId,
	name: pluginId.toUpperCase(),
	settings: {
		schema: { n: { type: "integer", label: "Count" } },
		values: {},
		own: [],
		state: { state: "ready" }
	}
})
const LIST = { plugins: [plugin("a"), plugin("b")] }

let target: HTMLElement
let app: ReturnType<typeof mount>

const field = (id: string) =>
	target.querySelector<HTMLInputElement>(`#user-plugin-setting-${id}-n`)!
async function type(id: string, value: string) {
	const input = field(id)
	input.value = value
	input.dispatchEvent(new Event("input", { bubbles: true }))
	await tick()
}
async function deliver(event: string, msg: unknown) {
	handlers.get(event)!(msg)
	flushSync()
	await tick()
}
async function open() {
	app = mount(Card, { target })
	flushSync()
	await deliver("pluginUserSettings:list", LIST)
}
async function save() {
	const button = [...target.querySelectorAll("button")].find((b) =>
		b.textContent?.includes("Save")
	)!
	button.click()
	await tick()
}

beforeEach(() => {
	notices.length = 0
	handlers.clear()
	socket.emit.mockClear()
	target = document.createElement("div")
	document.body.appendChild(target)
})
afterEach(() => {
	unmount(app)
	target.remove()
})

describe("PluginUserSettingsCard", () => {
	test("a failed save keeps its values and error while another plugin's save lands", async () => {
		await open()
		await type("a", "1")
		await type("b", "2")
		await save()
		expect(socket.emit).toHaveBeenCalledTimes(2)
		await deliver("pluginUserSettings:set:error", {
			pluginId: "b",
			error: "Refused."
		})
		await deliver("pluginUserSettings:list", LIST)
		await deliver("pluginUserSettings:set", {
			pluginId: "a",
			settings: null
		})
		expect(field("b").value).toBe("2")
		expect(target.querySelector('[role="alert"]')?.textContent).toContain(
			"Refused."
		)
		expect(field("a").value).toBe("")
		expect(notices).toEqual([])
	})

	test("a save that lands clears its draft and is said once", async () => {
		await open()
		await type("a", "1")
		await save()
		await deliver("pluginUserSettings:list", LIST)
		await deliver("pluginUserSettings:set", {
			pluginId: "a",
			settings: null
		})
		expect(field("a").value).toBe("")
		expect(notices.map((n) => n.title)).toEqual(["Settings saved"])
	})

	test("a list with nothing pending leaves typed values in place", async () => {
		await open()
		await type("a", "1")
		await deliver("pluginUserSettings:list", LIST)
		await deliver("pluginUserSettings:set", {
			pluginId: "a",
			settings: null
		})
		expect(field("a").value).toBe("1")
		expect(notices).toEqual([])
	})

	test("a generic refusal keeps the pending plugin's value and shows the error", async () => {
		await open()
		await type("a", "1")
		await save()
		await deliver("pluginUserSettings:set:error", {
			error: "An error occurred while processing your request."
		})
		expect(field("a").value).toBe("1")
		expect(target.querySelector('[role="alert"]')?.textContent).toContain(
			"An error occurred while processing your request."
		)
		expect(notices).toEqual([])
	})
})
