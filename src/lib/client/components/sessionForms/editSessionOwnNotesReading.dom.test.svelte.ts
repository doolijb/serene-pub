/**
 * Edit Session › Line and Story clock for a session on its own notes
 * (★bk-fold-1, 2026-11-08): shown once the own book has lines (a guest
 * reads it read-only, 2026-11-09); the attached case is unchanged.
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
	if (!handler)
		throw new Error(
			`nothing listens on ${key}; have: ${[...listeners.keys()].join(", ")}`
		)
	handler(msg)
	flushSync()
}

const OWN = 90
const LINES = {
	lorebookId: OWN,
	lines: [
		{
			id: null,
			name: "Main",
			forkedFromBranchId: null,
			forkYear: null,
			forkMonth: null,
			forkDay: null
		},
		{
			id: 5,
			name: "Storm",
			forkedFromBranchId: null,
			forkYear: null,
			forkMonth: null,
			forkDay: null
		}
	]
}

async function openForm(opts: {
	lorebookId: number | null
	userId?: number
	ownBookId?: number | null
}) {
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
			userId: opts.userId ?? 1,
			name: "The lighthouse",
			scenario: "",
			genreId: GENRE,
			genreFields: {},
			lorebookId: opts.lorebookId,
			ownBookId: opts.lorebookId == null ? (opts.ownBookId ?? OWN) : null,
			sessionCharacters: [{ character: { id: 3, name: "Wren" } }],
			sessionPersonas: [{ persona: { id: 4, name: "Me" } }],
			sessionGuests: [],
			tags: []
		}
	})
	await tick()
	flushSync()
}

const linesKey = (id: number) =>
	[...listeners.keys()].find(
		(k) => k.includes("lorebooks:lines") && k.includes(String(id))
	)

/** Answer the lines the way the socket does: to whoever listens on the book now. */
async function answerLines(id: number, lines = LINES.lines) {
	const key = linesKey(id)
	if (!key) return
	deliver(key, { lorebookId: id, lines })
	await tick()
	flushSync()
	// The reading mounts its own reader on the same key: answer it too.
	const again = linesKey(id)
	if (again) deliver(again, { lorebookId: id, lines })
	await tick()
	flushSync()
}

const reading = () =>
	document.querySelector('[data-testid="session-lorebook-reading"]')
const hasLineAndClock = () => {
	const t = reading()?.textContent ?? ""
	return t.includes("Line") && t.includes("Story clock")
}

describe("Edit Session — Line and Story clock on a session's own notes", () => {
	test("own notes with a line show the reading, and Save sends the picked line", async () => {
		await openForm({ lorebookId: null })
		expect(
			emitted.some(
				([e, d]) => e === "lorebooks:lines" && d.lorebookId === OWN
			)
		).toBe(true)
		await answerLines(OWN)
		expect(reading()).not.toBeNull()
		expect(hasLineAndClock()).toBe(true)
		const input = reading()!.querySelector(
			"input[role='combobox']"
		) as HTMLInputElement
		input.focus()
		input.click()
		flushSync()
		await tick()
		const option = [...document.querySelectorAll("[role='option']")].find(
			(o) => o.textContent?.includes("Storm")
		) as HTMLElement
		expect(option).toBeTruthy()
		option.click()
		flushSync()
		await tick()
		;(
			[...document.querySelectorAll("button")].find(
				(b) => b.textContent?.trim() === "Save"
			) as HTMLButtonElement
		).click()
		flushSync()
		const sent = emitted
			.filter(([e]) => e === "sessions:update")
			.at(-1)?.[1]
		expect(sent.session.lorebookBranchId).toBe(5)
	})

	test("own notes with no lines show no reading", async () => {
		await openForm({ lorebookId: null })
		await answerLines(OWN, [LINES.lines[0]])
		expect(reading()).toBeNull()
	})

	test("a guest reads the lines too (read-only; see editSessionGuestOwnNotesReading)", async () => {
		await openForm({ lorebookId: null, userId: 2 })
		expect(linesKey(OWN)).toBeDefined()
		await answerLines(OWN)
		expect(reading()).not.toBeNull()
	})

	test("an attached session shows its reading as before", async () => {
		await openForm({ lorebookId: 12 })
		expect(reading()).not.toBeNull()
		expect(
			emitted.some(
				([e, d]) => e === "lorebooks:lines" && d.lorebookId === OWN
			)
		).toBe(false)
	})
})
