/**
 * Edit Session › Settings and the session's genre fields, since the derived
 * settings form (PLAN-layering §5, A10; lane 7, 2026-10-21): the genre's
 * settings are drawn from `sessions:settingsForm` and each applies at once
 * through `sessions:updateSetting` — an `object` field (the Author's note)
 * by the one schema renderer, from the genre's own declaration, written
 * whole. Save never sends genre fields any more, so it can never put back a
 * value the form loaded before someone else saved (the 2026-10-03 rule,
 * now by construction).
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

async function openForm() {
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
				shape: { characters: { min: 0 }, personas: { min: 0 }, fields: FIELDS }
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

const writes = () => emitted.filter(([e]) => e === "sessions:updateSetting").map(([, p]) => p)

/** The genre group as the server derives it for the owner. */
function settingsForm(note: Record<string, unknown> = NOTE) {
	return {
		sessionId: 7,
		viewer: "owner",
		groups: [
			{
				kind: "genre",
				id: "genre",
				heading: "Notes",
				fields: [
					{
						id: JSON.stringify(["genre", "mood"]),
						address: { kind: "genre", key: "mood" },
						label: "Mood",
						control: "text",
						value: "calm",
						inherited: "",
						source: "session",
						reach: "owner",
						editable: true
					},
					{
						id: JSON.stringify(["genre", "authorsNote"]),
						address: { kind: "genre", key: "authorsNote" },
						label: "Author's note",
						control: "json",
						value: note,
						inherited: FIELDS.authorsNote.default,
						source: "session",
						reach: "owner",
						editable: true
					}
				]
			}
		]
	}
}

describe("Edit Session — genre fields apply at once (lane 7)", () => {
	test("the form asks for the session's derived settings", async () => {
		await openForm()
		expect(emitted.some(([e, p]) => e === "sessions:settingsForm" && p.sessionId === 7)).toBe(true)
	})

	test("a text field writes at once, never with Save", async () => {
		await openForm()
		deliver("sessions:settingsForm", settingsForm())
		const mood = document.querySelector<HTMLTextAreaElement>("[data-setting] textarea")!
		expect(mood.value).toBe("calm")
		type(mood, "tense")
		expect(writes().at(-1)).toEqual(
			expect.objectContaining({ sessionId: 7, address: { kind: "genre", key: "mood" }, value: "tense" })
		)
		const name = document.querySelector<HTMLInputElement>("input#sessionName")
		if (name) type(name, "The lighthouse at dusk")
		const sent = save()
		expect(sent).toBeTruthy()
		expect(sent.session.genreFields).toBeUndefined()
	})

	test("the note is drawn from the genre's declaration and written whole", async () => {
		await openForm()
		deliver("sessions:settingsForm", settingsForm())
		expect(field<HTMLTextAreaElement>("sf-authorsNote-text").value).toBe(NOTE.text)
		type(field<HTMLInputElement>("sf-authorsNote-depth"), "2")
		expect(writes().at(-1)).toEqual(
			expect.objectContaining({ address: { kind: "genre", key: "authorsNote" }, value: { ...NOTE, depth: 2 } })
		)
	})

	test("a newer note in the form the server re-sends replaces what is drawn", async () => {
		await openForm()
		deliver("sessions:settingsForm", settingsForm())
		deliver("sessions:settingsForm", settingsForm({ ...NOTE, text: "The storm has passed." }))
		expect(field<HTMLTextAreaElement>("sf-authorsNote-text").value).toBe("The storm has passed.")
	})
})
