/**
 * 🚧 Edit Session › Save, with the story clock moved back: the form asks the
 * server first (`sessions:storyClock` with `moveTo`), and a notice becomes a
 * question; nothing is saved until the person confirms (2026-11-13,
 * 2026-11-14 ★12).
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

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

vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => {
	const declareInterest = (key: string, handler: (msg: any) => void) => {
		listeners.set(key, handler)
		return () => {
			if (listeners.get(key) === handler) listeners.delete(key)
		}
	}
	return {
		declareInterest,
		useInterest: (key: string, handler: (msg: any) => void) =>
			declareInterest(key, handler),
		requestWithInterest: (
			event: string,
			params: unknown,
			handler: (msg: any) => void
		) => {
			socket.emit(event, params)
			return declareInterest(event, handler)
		}
	}
})

import EditSessionForm from "./EditSessionForm.svelte"

const GENRE = "test:genre/book@1"
const NOTICE = {
	mode: "branch" as const,
	count: 2,
	latestLabel: "Year 412",
	toLabel: "Year 400",
	sentence: "This passes 2 dated writes."
}

vi.mock("$app/navigation", () => ({ goto: vi.fn() }))
import { goto } from "$app/navigation"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	emitted.length = 0
	document.body.innerHTML = ""
	vi.mocked(goto).mockClear()
})

function deliver(key: string, msg: unknown) {
	const handler = listeners.get(key)
	if (!handler)
		throw new Error(
			`nothing listens on ${key}; have: ${[...listeners.keys()].join(", ")}`
		)
	handler(msg)
	flushSync()
}

async function openForm() {
	app = mount(EditSessionForm, {
		target: document.body,
		props: { editSessionId: 7, showEditSessionForm: true },
		context: new Map<string, unknown>([
			["userCtx", { user: { id: 1, isAdmin: false } }],
			["userSettingsCtx", { settings: { showAdvancedControls: true } }]
		])
	})
	flushSync()
	deliver("sessions:genres", {
		genres: [
			{
				genreId: GENRE,
				shape: {
					characters: { min: 0 },
					personas: { min: 0 },
					lorebook: "optional",
					fields: {}
				}
			}
		]
	})
	deliver("lorebooks:list", {
		lorebookList: [{ id: 12, name: "Shared Atlas", userId: 1 }]
	})
	deliver("sessions:get#7", {
		session: {
			id: 7,
			userId: 1,
			name: "The lighthouse",
			scenario: "",
			genreId: GENRE,
			genreFields: {},
			lorebookId: 12,
			storyClockYear: 410,
			sessionCharacters: [{ character: { id: 3, name: "Wren" } }],
			sessionPersonas: [{ persona: { id: 4, name: "Me" } }],
			sessionGuests: [],
			tags: []
		}
	})
	await tick()
	flushSync()
}

const button = (label: string) =>
	[...document.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === label
	) as HTMLButtonElement | undefined
const sentOf = (event: string) => emitted.filter(([e]) => e === event)

async function moveClockTo(year: number) {
	const input = document.querySelector(
		'[data-testid="session-story-clock"] input[type="number"]'
	) as HTMLInputElement
	input.value = String(year)
	input.dispatchEvent(new Event("input", { bubbles: true }))
	flushSync()
	await tick()
}
async function save() {
	button("Save")!.click()
	flushSync()
	await tick()
}
/** The form mounts several closed confirms; this is the one asking. */
const dialog = () =>
	[...document.querySelectorAll("[data-action-confirm]")].find((d) =>
		d.textContent?.includes("Move the story back?")
	) ?? null

describe("Edit Session — Save with the story clock moved back", () => {
	test("a moved clock asks the server first and saves nothing yet", async () => {
		await openForm()
		await moveClockTo(400)
		await save()
		const asked = sentOf("sessions:storyClock")
		expect(asked).toHaveLength(1)
		expect(asked[0][1]).toMatchObject({
			sessionId: 7,
			moveTo: { year: 400 }
		})
		expect(typeof asked[0][1].request).toBe("string")
		expect(sentOf("sessions:update")).toHaveLength(0)
	})

	test("a notice shows the question; Confirm saves with confirmClockMoveBack and a branch is opened", async () => {
		await openForm()
		await moveClockTo(400)
		await save()
		const request = sentOf("sessions:storyClock")[0][1].request
		deliver("sessions:storyClock", {
			sessionId: 7,
			request,
			clockMoveBack: NOTICE
		})
		await tick()
		flushSync()
		expect(dialog()?.textContent).toContain(NOTICE.sentence)
		expect(sentOf("sessions:update")).toHaveLength(0)
		button("Branch and move back")!.click()
		flushSync()
		const sent = sentOf("sessions:update")
		expect(sent).toHaveLength(1)
		expect(sent[0][1].confirmClockMoveBack).toBe(true)
		expect(sent[0][1].session.storyClockYear).toBe(400)
		deliver("sessions:update", { session: { name: "x" }, branchedTo: 31 })
		expect(goto).toHaveBeenCalledWith(expect.stringContaining("31"))
	})

	test("Cancel sends nothing and the form stays open", async () => {
		await openForm()
		await moveClockTo(400)
		await save()
		deliver("sessions:storyClock", {
			sessionId: 7,
			request: sentOf("sessions:storyClock")[0][1].request,
			clockMoveBack: NOTICE
		})
		await tick()
		flushSync()
		const cancel = [...dialog()!.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === "Cancel"
		)!
		cancel.click()
		flushSync()
		await tick()
		expect(sentOf("sessions:update")).toHaveLength(0)
		expect(dialog()?.getAttribute("data-state") ?? "closed").toBe("closed")
		expect(button("Save")).toBeDefined()
	})

	test("a null notice saves as ever, without the flag; another request's reply is ignored", async () => {
		await openForm()
		await moveClockTo(400)
		await save()
		const request = sentOf("sessions:storyClock")[0][1].request
		deliver("sessions:storyClock", {
			sessionId: 7,
			request: "someone-else",
			clockMoveBack: null
		})
		expect(sentOf("sessions:update")).toHaveLength(0)
		deliver("sessions:storyClock", {
			sessionId: 7,
			request,
			clockMoveBack: null
		})
		const sent = sentOf("sessions:update")
		expect(sent).toHaveLength(1)
		expect("confirmClockMoveBack" in sent[0][1]).toBe(false)
	})

	test("an unmoved clock saves directly, with no pre-check", async () => {
		await openForm()
		await save()
		expect(sentOf("sessions:storyClock")).toHaveLength(0)
		expect(sentOf("sessions:update")).toHaveLength(1)
	})
})
