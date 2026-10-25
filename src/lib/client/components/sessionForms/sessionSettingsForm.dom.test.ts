/**
 * 🚧 The session's derived settings form (PLAN-layering §5, A10, R1, R36,
 * R37; lane 7): drawn from `sessions:settingsForm` as the server derived it
 * for the asker — the genre's settings, one card per registered pipeline,
 * then Routines — each control applying at once through
 * `sessions:updateSetting`. An owner picks a routine's mode; an
 * administrator also changes when it runs; a locked value is read-only with
 * the layer's reason.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))

import { setSocket } from "$lib/client/sockets/socketInstance"
import { _resetInterestForTests, setInterestUser } from "$lib/client/sockets/interest.svelte"
import SessionSettingsForm from "./SessionSettingsForm.svelte"
import { routineStatusLine, sourceWords, valueText } from "./sessionSettingsForm"

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

const SWEEP = "every-n-turns→story-sweep"
const RECKON = "after-each-round→story-reckoning"

const modeField = (key: string, mode: string, source = "preset") => ({
	id: JSON.stringify(["routine", key, "mode"]),
	address: { kind: "routine", registrationKey: key, field: "mode" },
	label: "Mode",
	control: "enum",
	members: [
		{ key: "off", label: "Off" },
		{ key: "review", label: "Review" },
		{ key: "full", label: "Full" }
	],
	value: mode,
	inherited: "full",
	source,
	reach: "owner",
	editable: true
})

function formFor(viewer: "owner" | "admin") {
	const genre = {
		kind: "genre",
		id: "genre",
		heading: "Story",
		fields: [
			{
				id: JSON.stringify(["genre", "autoAdvance"]),
				address: { kind: "genre", key: "autoAdvance" },
				label: "Auto-advance",
				control: "enum",
				members: [
					{ key: "off", label: "Off" },
					{ key: "round", label: "Round" }
				],
				value: "round",
				inherited: "round",
				source: "genre",
				reach: "owner",
				editable: true
			},
			...(viewer === "admin"
				? [
						{
							id: JSON.stringify(["genre", "rigour"]),
							address: { kind: "genre", key: "rigour" },
							label: "How strict",
							control: "enum",
							members: [{ key: "scripts", label: "Rules" }],
							value: "scripts",
							inherited: "scripts",
							source: "preset",
							lockedAt: "preset",
							reach: "owner",
							editable: false,
							readOnlyReason: "Set by the session's preset."
						}
					]
				: [])
		]
	}
	const reply = {
		kind: "registration",
		id: "core:spec/story-respond",
		heading: "Reply",
		pipeline: "core:spec/story-respond",
		registrationKeys: ["message-respond→story-respond"],
		fields: [
			{
				id: JSON.stringify(["pipeline", "message-respond→story-respond", "spritePick", "params", "enabled"]),
				address: {
					kind: "pipeline",
					registrationKey: "message-respond→story-respond",
					nodeKey: "spritePick",
					slot: "params",
					path: "enabled"
				},
				label: "Choose sprites",
				control: "boolean",
				value: false,
				inherited: true,
				source: "session",
				reach: "owner",
				editable: true
			}
		]
	}
	const adminCadence = {
		id: JSON.stringify(["routine", SWEEP, "cadence.n"]),
		address: { kind: "routine", registrationKey: SWEEP, field: "cadence.n" },
		label: "Every how many turns",
		control: "integer",
		min: 1,
		value: 5,
		inherited: 5,
		source: "genre",
		reach: "admin",
		editable: true
	}
	const stacking = {
		id: JSON.stringify(["routine", SWEEP, "allowStacking"]),
		address: { kind: "routine", registrationKey: SWEEP, field: "allowStacking" },
		label: "Allow stacking",
		control: "boolean",
		value: false,
		inherited: false,
		source: "declaration",
		reach: "admin",
		editable: true
	}
	const routines = {
		kind: "routines",
		id: "routines",
		heading: "Routines",
		fields: [],
		routines: [
			{
				registrationKey: RECKON,
				pipeline: "core:spec/story-reckoning",
				label: "Note what changed",
				cadence: { id: "core:cadence/after-each-round@1", name: "After each round", options: {} },
				mode: "full",
				fields: [modeField(RECKON, "full")]
			},
			{
				registrationKey: SWEEP,
				pipeline: "core:spec/story-sweep",
				label: "Look back over the story",
				purpose: "Summaries, lore and the cast, in one call.",
				cadence: { id: "core:cadence/every-n-turns@1", name: "Every few turns", options: { n: 5 } },
				mode: "off",
				fields: [modeField(SWEEP, "off"), ...(viewer === "admin" ? [adminCadence, stacking] : [])]
			}
		]
	}
	return { sessionId: 7, viewer, groups: [genre, reply, routines] }
}

let client: ReturnType<typeof makeClientSocket>
let app: ReturnType<typeof mount> | null = null
let target: HTMLElement

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
	target = document.createElement("div")
	document.body.append(target)
})

afterEach(() => {
	if (app) unmount(app)
	app = null
	_resetInterestForTests()
	setSocket(null)
	document.body.innerHTML = ""
})

function show(viewer: "owner" | "admin", routines: any[] = []) {
	app = mount(SessionSettingsForm, { target, props: { sessionId: 7, cardClass: "card" } })
	flushSync()
	client.dispatch("sessions:settingsForm", formFor(viewer))
	client.dispatch("sessions:routines", { sessionId: 7, routines })
	flushSync()
}

const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? ""
const writes = () => client.emits.filter((e) => e.event === "sessions:updateSetting").map((e) => e.payload)
const routineRow = (key: string) => target.querySelector<HTMLElement>(`[data-routine="${key}"]`)
const modeButton = (key: string, mode: string) =>
	routineRow(key)?.querySelector<HTMLButtonElement>(`[role="radio"][data-mode="${mode}"]`) ?? null

describe("the session's derived settings form", () => {
	test("asks for the form and the routines once mounted", () => {
		show("owner")
		const asked = client.emits.map((e) => e.event)
		expect(asked).toContain("sessions:settingsForm")
		expect(asked).toContain("sessions:routines")
	})

	test("the genre's settings, then a card per pipeline, then Routines", () => {
		show("owner")
		const headings = [...target.querySelectorAll("section h3")].map((h) => h.textContent?.trim())
		expect(headings).toEqual(["Story settings", "Reply", "Routines"])
	})

	test("an owner picks a routine's mode, and reads when it runs in words", () => {
		show("owner")
		expect(routineRow(SWEEP)?.dataset.mode).toBe("off")
		expect(text()).toContain("When it runs: Every 5 turns")
		expect(text()).toContain("When it runs: After each round")
		expect(text()).toContain("Summaries, lore and the cast, in one call.")
		expect(modeButton(SWEEP, "off")?.getAttribute("aria-checked")).toBe("true")
		modeButton(SWEEP, "review")!.click()
		flushSync()
		expect(writes()).toEqual([
			expect.objectContaining({
				sessionId: 7,
				address: { kind: "routine", registrationKey: SWEEP, field: "mode" },
				value: "review"
			})
		])
	})

	test("an owner is never shown when-it-runs settings, a locked value, or the word cadence", () => {
		show("owner")
		expect(text()).not.toContain("Allow stacking")
		expect(text()).not.toContain("Every how many turns")
		expect(text()).not.toContain("How strict")
		expect(text().toLowerCase()).not.toContain("cadence")
		expect(target.querySelector('[data-testid="session-settings-form"]')?.getAttribute("data-viewer")).toBe("owner")
	})

	test("an administrator also changes when it runs; a locked value reads with its reason", () => {
		show("admin")
		expect(text()).toContain("Allow stacking")
		expect(text()).toContain("Every how many turns")
		expect(text()).toContain("How strict")
		expect(text()).toContain("Set by the session's preset.")
		const n = routineRow(SWEEP)!.querySelector<HTMLInputElement>('input[type="number"]')!
		n.value = "10"
		n.dispatchEvent(new Event("change", { bubbles: true }))
		flushSync()
		expect(writes().at(-1)).toEqual(
			expect.objectContaining({ address: { kind: "routine", registrationKey: SWEEP, field: "cadence.n" }, value: 10 })
		)
	})

	test("a paused routine says why; the session's own value resets", async () => {
		show("owner", [
			{
				registrationKey: SWEEP,
				pipeline: "core:spec/story-sweep",
				name: "Look back over the story",
				cadence: { id: "core:cadence/every-n-turns@1", name: "Every few turns", options: { n: 5 } },
				mode: "off",
				allowStacking: false,
				waiting: 0,
				running: false,
				paused: "Paused: no one has played for 3 days",
				runNow: false
			}
		])
		expect(routineRow(SWEEP)?.textContent).toContain("Paused: no one has played for 3 days")
		const sprites = target.querySelector<HTMLInputElement>('input[role="switch"]')!
		expect(sprites.checked).toBe(false)
		expect(text()).toContain("Set for this session. Reset to On.")
		const reset = [...target.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Reset")!
		reset.click()
		flushSync()
		expect(writes().at(-1)).toEqual(expect.objectContaining({ value: null }))
	})

	test("a refusal is said under its field", async () => {
		show("owner")
		modeButton(RECKON, "off")!.click()
		flushSync()
		const [asked] = writes()
		client.dispatch("sessions:updateSetting", { ...asked, error: "Mode is one of Off, Review, Full. Nothing was saved." })
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
		expect(routineRow(RECKON)?.querySelector('[role="alert"]')?.textContent).toContain("Nothing was saved.")
	})

	test("a guest's answer has no groups and draws nothing", () => {
		app = mount(SessionSettingsForm, { target, props: { sessionId: 7 } })
		flushSync()
		client.dispatch("sessions:settingsForm", { sessionId: 7, groups: [], error: "Only the session's owner sees its settings." })
		flushSync()
		expect(text()).toBe("")
	})
})

describe("the form's words", () => {
	test("values, sources and routine status lines", () => {
		expect(valueText({ control: "boolean" }, true)).toBe("On")
		expect(valueText({ control: "list", members: [{ key: "web", label: "Search the web" }] }, ["web"])).toBe(
			"Search the web"
		)
		expect(sourceWords("preset")).toBe("From the preset")
		expect(sourceWords("genre")).toBe("From the genre's defaults")
		expect(routineStatusLine({ waiting: 1, running: false } as never)).toBe("Waiting to run")
		expect(routineStatusLine({ waiting: 0, running: false, needs: "Needs a story clock" } as never)).toBe(
			"Needs a story clock"
		)
	})
})
