/**
 * 🚧 Edit Session › How strict and the rules (PLAN-rulesets §21; R32;
 * lane 7, 2026-10-21): both are the genre's settings in the derived form
 * now. The ruleset — fixed at start — reads as its name from the genre's
 * rules offer, read-only, with why; How strict applies at once through
 * `sessions:updateSetting`, never with Save.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))

const { listeners, emitted, socket } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	const emitted: Array<[string, any]> = []
	return {
		listeners,
		emitted,
		socket: {
			emit: (event: string, data: any) => {
				emitted.push([event, data])
			},
			on: () => {},
			off: () => {}
		}
	}
})

vi.mock("$lib/client/sockets/loadSockets.client", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/typedSocket", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/interest.svelte", () => {
	const declareInterest = (key: string, handler: (msg: any) => void) => {
		listeners.set(key, handler)
		return () => {
			if (listeners.get(key) === handler) listeners.delete(key)
		}
	}
	return {
		declareInterest,
		useInterest: (key: string, handler: (msg: any) => void) => declareInterest(key, handler),
		requestWithInterest: (event: string, params: unknown, handler: (msg: any) => void) => {
			socket.emit(event, params)
			return declareInterest(event, handler)
		}
	}
})

import EditSessionForm from "./EditSessionForm.svelte"

const GENRE = "test:genre/notes@1"
const NOTE = { text: "It is raining.", depth: 4, interval: 1, role: "system" }
const OFFER = {
	choices: [{ id: "core:ruleset/freeform@1", name: "Freeform" }],
	strict: false,
	defaultId: "core:ruleset/freeform@1",
	rigour: { options: ["prose", "mechanics", "scripts"], default: "mechanics" }
}
const FIELDS = {
	mood: { type: "text", label: { en: "Mood" }, default: "" },
	authorsNote: {
		type: "object",
		label: { en: "Author's note" },
		fields: {
			text: { type: "text", label: { en: "Note" }, default: "" },
			depth: { type: "integer", label: { en: "Messages from the end" }, default: 4 },
			interval: { type: "integer", label: { en: "Every how many replies" }, default: 1 },
			role: {
				type: "enum",
				label: { en: "Sent as" },
				of: ["system", "user", "assistant"],
				default: "system",
				group: "Advanced"
			}
		},
		default: { text: "", depth: 4, interval: 1, role: "system" }
	}
}

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	emitted.length = 0
	document.body.innerHTML = ""
})

function deliver(key: string, msg: unknown) {
	const handler = listeners.get(key)
	if (!handler) throw new Error(`nothing listens on ${key}; have: ${[...listeners.keys()].join(", ")}`)
	handler(msg)
	flushSync()
}

async function openForm(offer: unknown = OFFER) {
	app = mount(EditSessionForm, {
		target: document.body,
		props: { editSessionId: 7, showEditSessionForm: true },
		context: new Map([["userCtx", { user: { id: 1, isAdmin: false } }]])
	})
	flushSync()
	deliver("sessions:genres", {
		genres: [
			{
				genreId: GENRE,
				shape: { characters: { min: 0 }, personas: { min: 0 }, fields: FIELDS },
				...(offer ? { rules: offer } : {})
			}
		]
	})
	deliver("sessions:get#7", {
		session: {
			id: 7,
			userId: 1,
			name: "The lighthouse",
			scenario: "",
			genreId: GENRE,
			genreFields: { mood: "calm", authorsNote: { ...NOTE } },
			rigour: "mechanics",
			sessionCharacters: [{ character: { id: 3, name: "Wren" } }],
			sessionPersonas: [{ persona: { id: 4, name: "Me" } }],
			sessionGuests: [],
			tags: []
		}
	})
	await tick()
	flushSync()
}

const field = <T extends HTMLElement>(id: string) => {
	const el = document.getElementById(id) as T | null
	if (!el) throw new Error(`no #${id}`)
	return el
}

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
	el.value = value
	el.dispatchEvent(new Event("input", { bubbles: true }))
	el.dispatchEvent(new Event("change", { bubbles: true }))
	flushSync()
}

function save() {
	const button = [...document.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === "Save"
	) as HTMLButtonElement
	button.click()
	flushSync()
	return emitted.filter(([e]) => e === "sessions:update").at(-1)?.[1]
}

const unsaved = () => document.body.textContent?.includes("Unsaved changes") ?? false

const RULES_FORM = {
	sessionId: 7,
	viewer: "owner",
	groups: [
		{
			kind: "genre",
			id: "genre",
			heading: "Notes",
			fields: [
				{
					id: JSON.stringify(["genre", "ruleset"]),
					address: { kind: "genre", key: "ruleset" },
					label: "Rules",
					control: "string",
					value: "core:ruleset/freeform@1",
					inherited: "core:ruleset/freeform@1",
					source: "session",
					reach: "owner",
					fixed: true,
					editable: false,
					readOnlyReason: "Chosen when the session started; the rules a session plays do not change."
				},
				{
					id: JSON.stringify(["genre", "rigour"]),
					address: { kind: "genre", key: "rigour" },
					label: "How strict",
					control: "enum",
					members: [
						{ key: "prose", label: "Words only" },
						{ key: "mechanics", label: "Rules" },
						{ key: "scripts", label: "The rules decide" }
					],
					value: "mechanics",
					inherited: "mechanics",
					source: "session",
					reach: "owner",
					editable: true
				}
			]
		}
	]
}

describe("Edit Session — How strict and the rules", () => {
	test("the rules read as their name, read-only, with why", async () => {
		await openForm()
		deliver("sessions:settingsForm", RULES_FORM)
		const rules = document.querySelector<HTMLElement>(`[data-setting='${JSON.stringify(["genre", "ruleset"])}']`)!
		expect(rules.textContent).toContain("Freeform")
		expect(rules.textContent).toContain("Chosen when the session started")
		expect(rules.querySelector("input, select, textarea") === null).toBe(true)
	})

	test("How strict is never sent with Save", async () => {
		await openForm()
		deliver("sessions:settingsForm", RULES_FORM)
		const name = document.querySelector<HTMLInputElement>("input#sessionName")
		if (name) type(name, "The lighthouse at dusk")
		expect(save()?.session.rigour).toBeUndefined()
		expect(document.getElementById("session-how-strict") === null).toBe(true)
	})

	test("a guest is asked no settings", async () => {
		app = mount(EditSessionForm, {
			target: document.body,
			props: { editSessionId: 7, showEditSessionForm: true },
			context: new Map([["userCtx", { user: { id: 2, isAdmin: false } }]])
		})
		flushSync()
		deliver("sessions:genres", { genres: [{ genreId: GENRE, shape: { fields: FIELDS }, rules: OFFER }] })
		deliver("sessions:get#7", {
			session: {
				id: 7,
				userId: 1,
				name: "The lighthouse",
				scenario: "",
				genreId: GENRE,
				genreFields: {},
				sessionCharacters: [],
				sessionPersonas: [],
				sessionGuests: [{ userId: 2 }],
				tags: []
			}
		})
		await tick()
		flushSync()
		expect(emitted.some(([e]) => e === "sessions:settingsForm")).toBe(false)
	})
})
