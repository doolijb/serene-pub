/**
 * Edit Session › Settings and the session's genre fields (owner ruling
 * 2026-10-03): Save sends only the genre fields the person changed in the
 * form — dirty meaning different from the value loaded (STYLE-GUIDE §6.14),
 * field by field, an `object` field whole — and a newer save pushed while
 * the form is open (`sessions:genreFieldsChanged`, the Author's note widget's)
 * refreshes a field nobody touched here and leaves an edited one alone.
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

const unsaved = () => document.body.textContent?.includes("Unsaved changes") ?? false

describe("Edit Session — genre fields go only as the person changed them (2026-10-03)", () => {
	test("an opened form is clean, and saving another change sends no genre fields", async () => {
		await openForm()
		expect(field<HTMLTextAreaElement>("sf-authorsNote-text").value).toBe(NOTE.text)
		expect(unsaved()).toBe(false)

		const name = document.querySelector<HTMLInputElement>("input#name, input[name='name']")
		if (name) type(name, "The lighthouse at dusk")
		const sent = save()
		expect(sent).toBeTruthy()
		expect(sent.session.genreFields).toBeUndefined()
	})

	test("changing one field sends that field alone — not the untouched note", async () => {
		await openForm()
		type(field<HTMLInputElement>("sf-mood"), "tense")
		expect(unsaved()).toBe(true)
		expect(save().session.genreFields).toEqual({ mood: "tense" })
	})

	test("changing one member of the note sends the note whole", async () => {
		await openForm()
		type(field<HTMLInputElement>("sf-authorsNote-depth"), "2")
		expect(save().session.genreFields).toEqual({ authorsNote: { ...NOTE, depth: 2 } })
	})

	test("changing a field and changing it back is clean", async () => {
		await openForm()
		const mood = field<HTMLInputElement>("sf-mood")
		type(mood, "tense")
		expect(unsaved()).toBe(true)
		type(mood, "calm")
		expect(unsaved()).toBe(false)
	})

	test("a newer note saved by the widget refreshes the untouched note and stays clean", async () => {
		await openForm()
		const newer = { ...NOTE, text: "The storm has passed." }
		deliver("sessions:genreFieldsChanged", {
			sessionId: 7,
			genreFields: { mood: "calm", authorsNote: newer }
		})
		await tick()
		expect(field<HTMLTextAreaElement>("sf-authorsNote-text").value).toBe(newer.text)
		expect(unsaved()).toBe(false)

		type(field<HTMLInputElement>("sf-mood"), "tense")
		expect(save().session.genreFields).toEqual({ mood: "tense" })
	})

	test("a push for another session is not this form's", async () => {
		await openForm()
		deliver("sessions:genreFieldsChanged", {
			sessionId: 8,
			genreFields: { authorsNote: { ...NOTE, text: "Elsewhere" } }
		})
		expect(field<HTMLTextAreaElement>("sf-authorsNote-text").value).toBe(NOTE.text)
	})

	test("an edited note keeps the person's edit when a newer one is pushed", async () => {
		await openForm()
		type(field<HTMLTextAreaElement>("sf-authorsNote-text"), "Mine")
		deliver("sessions:genreFieldsChanged", {
			sessionId: 7,
			genreFields: { mood: "calm", authorsNote: { ...NOTE, text: "Theirs" } }
		})
		await tick()
		expect(field<HTMLTextAreaElement>("sf-authorsNote-text").value).toBe("Mine")
		expect(unsaved()).toBe(true)
		expect(save().session.genreFields).toEqual({ authorsNote: { ...NOTE, text: "Mine" } })
	})
})
