/**
 * The narrator's cadence in the turn picker: the session's own **Narrator's
 * turn** setting, drawn from the server's settings form under the
 * narrator's row and written through `sessions:updateSetting`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import TurnPicker from "./TurnPicker.svelte"

type Listener = (payload: any) => void
function makeClientSocket() {
	const listeners = new Map<string, Listener[]>()
	return {
		connected: true,
		id: "tab-a",
		emits: [] as Array<{ event: string; payload: any }>,
		on(event: string, fn: Listener) {
			listeners.set(event, [...(listeners.get(event) ?? []), fn])
		},
		off(event: string, fn: Listener) {
			const arr = listeners.get(event) ?? []
			const at = arr.indexOf(fn)
			if (at !== -1) arr.splice(at, 1)
		},
		emit(event: string, payload: any) {
			this.emits.push({ event, payload })
		},
		dispatch(event: string, payload: any) {
			for (const fn of [...(listeners.get(event) ?? [])]) fn(payload)
		}
	}
}

const ADDRESS = { kind: "genre", key: "narratorInterjections" }
const cadenceField = (value: unknown) => ({
	id: JSON.stringify(["genre", "narratorInterjections"]),
	address: ADDRESS,
	label: "Narrator's turn",
	description:
		"How often the narrator takes a turn of its own, after everyone else's. Each is another model call.",
	control: "enum",
	members: [
		{ key: "off", label: "Off" },
		{ key: "every-round", label: "Every round" },
		{ key: "every-2nd-round", label: "Every 2nd round" },
		{ key: "every-3rd-round", label: "Every 3rd round" }
	],
	value,
	inherited: "off",
	source: "session",
	reach: "owner",
	editable: true
})
const ownerForm = (value: unknown) => ({
	sessionId: 7,
	viewer: "owner",
	groups: [
		{
			kind: "genre",
			id: "genre",
			heading: "Story",
			fields: [cadenceField(value)]
		}
	]
})

let client: ReturnType<typeof makeClientSocket>
let app: ReturnType<typeof mount> | null = null
let target: HTMLElement
let picked: Array<{ ref: string | null }>

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
	target = document.createElement("div")
	document.body.append(target)
	picked = []
})

afterEach(() => {
	if (app) unmount(app)
	app = null
	_resetInterestForTests()
	setSocket(null)
	document.body.innerHTML = ""
})

const settle = async () => {
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

function show(offerNarrator = true) {
	app = mount(TurnPicker, {
		target,
		props: {
			open: true,
			candidates: [{ ref: "c:3", kind: "character", name: "Wren" }],
			offerNarrator,
			ownVoiceName: "The narrator",
			onPick: (entry: { ref: string | null }) => picked.push(entry),
			onClose: () => {}
		},
		context: new Map([
			["openSessionCtx", { sessionId: 7, sessionName: "Tale" }]
		])
	})
	flushSync()
}

const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? ""
const asks = () =>
	client.emits.filter((e) => e.event === "sessions:settingsForm")
const writes = () =>
	client.emits
		.filter((e) => e.event === "sessions:updateSetting")
		.map((e) => e.payload)
const comboInput = () =>
	target.querySelector<HTMLInputElement>('input[role="combobox"]')

describe("the narrator's cadence in the turn picker", () => {
	test("an owner's field reads as the server sends it (a stored true arrives as every-round)", async () => {
		show()
		client.dispatch("sessions:settingsForm", ownerForm("every-round"))
		await settle()
		expect(asks().map((e) => e.payload)).toEqual([{ sessionId: 7 }])
		expect(text()).toContain("Narrator's turn")
		expect(comboInput()?.value).toBe("Every round")
	})

	test("choosing Every 2nd round writes the setting", async () => {
		show()
		client.dispatch("sessions:settingsForm", ownerForm("off"))
		await settle()
		target
			.querySelector<HTMLButtonElement>(
				`button[aria-label="Show Narrator's turn options"]`
			)!
			.click()
		await settle()
		const row = [
			...document.querySelectorAll<HTMLElement>('[role="option"]')
		].find((r) => r.textContent?.trim() === "Every 2nd round")!
		row.click()
		await settle()
		expect(writes()).toEqual([
			expect.objectContaining({
				sessionId: 7,
				address: ADDRESS,
				value: "every-2nd-round"
			})
		])
	})

	test("a refusal is said under the control", async () => {
		show()
		client.dispatch("sessions:settingsForm", ownerForm("off"))
		await settle()
		target
			.querySelector<HTMLButtonElement>(
				`button[aria-label="Show Narrator's turn options"]`
			)!
			.click()
		await settle()
		;[...document.querySelectorAll<HTMLElement>('[role="option"]')]
			.find((r) => r.textContent?.trim() === "Every round")!
			.click()
		await settle()
		const [asked] = writes()
		client.dispatch("sessions:updateSetting", {
			...asked,
			error: "Locked by the preset. Nothing was saved."
		})
		await settle()
		expect(target.querySelector('[role="alert"]')?.textContent).toContain(
			"Nothing was saved."
		)
	})

	test("a guest's form draws no control, and the narrator row still picks", async () => {
		show()
		client.dispatch("sessions:settingsForm", {
			sessionId: 7,
			groups: [],
			error: "Only the session's owner sees its settings."
		})
		await settle()
		expect(comboInput()).toBeNull()
		expect(text()).not.toContain("Narrator's turn")
		const narrator = [...target.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("The narrator")
		)!
		narrator.click()
		expect(picked).toEqual([{ ref: null }])
	})

	test("without a narrator row no form is asked for", async () => {
		show(false)
		await settle()
		expect(asks()).toEqual([])
	})
})
