/**
 * Start a session › How it starts: the four creation modes, a genre's
 * proposal preselecting (never locking), and branch / next chapter asking
 * which session they follow.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const { listeners, requests, socket } = vi.hoisted(() => {
	const listeners = new Map<string, Array<(msg: any) => void>>()
	/** Every request the form sent, in order. */
	const requests: Array<{ key: string; params: any }> = []
	return {
		listeners,
		requests,
		socket: { emit: () => {}, on: () => {}, off: () => {} }
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
		listeners.set(key, [...(listeners.get(key) ?? []), handler])
		return () =>
			listeners.set(
				key,
				(listeners.get(key) ?? []).filter((h) => h !== handler)
			)
	}
	return {
		declareInterest,
		useInterest: declareInterest,
		requestWithInterest: (
			key: string,
			params: unknown,
			handler: (msg: any) => void
		) => {
			requests.push({ key, params })
			return declareInterest(key, handler)
		}
	}
})
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		success: () => {},
		error: () => {},
		info: () => {},
		warning: () => {}
	}
}))

import StartSessionForm from "./StartSessionForm.svelte"

const GENRE = "test:genre/troupe@1"
const OTHER = "test:genre/other@1"

const CHARACTERS = [
	{ id: 1, name: "Jasmine" },
	{ id: 2, name: "Bram" },
	{ id: 3, name: "Corin" },
	{ id: 4, name: "Dell" },
	{ id: 5, name: "You", isPersona: true, isDefaultPersona: true },
	{ id: 6, name: "Wren", isPersona: true }
]

let app: ReturnType<typeof mount> | null = null
let host: HTMLElement
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	requests.length = 0
	document.body.innerHTML = ""
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

function feed(key: string, msg: unknown) {
	for (const h of listeners.get(key) ?? []) h(msg)
}


const SHAPE = {
	characters: { min: 0, max: 3 },
	personas: { min: 0, max: 1 },
	lorebook: "optional"
}

const SESSIONS = [
	{ id: 11, name: "Old Harbour", genreId: GENRE, isOwner: true, lorebookId: 4, messageCount: 12, updatedAt: "2026-10-01T10:00:00Z" },
	{ id: 12, name: "No Book", genreId: GENRE, isOwner: true, lorebookId: null, messageCount: 3, updatedAt: "2026-10-02T10:00:00Z" }
]

async function render(opts: { propose?: string; twoGenres?: boolean } = {}) {
	host = document.createElement("div")
	document.body.append(host)
	app = mount(StartSessionForm, {
		target: host,
		props: { onCreated: () => {}, onCancel: () => {}, sessions: SESSIONS as any }
	})
	await settle()
	const troupe = {
		genreId: GENRE,
		name: "Troupe",
		description: "",
		shape: { ...SHAPE, ...(opts.propose ? { creationMode: { propose: opts.propose } } : {}) }
	}
	const other = { genreId: OTHER, name: "Other", description: "", shape: SHAPE }
	feed("sessions:genres", { genres: opts.twoGenres ? [troupe, other] : [troupe] })
	feed("sessionPresets:list", {
		presets: [
			{ id: 1, genreId: GENRE, name: "Plain", enabled: true, isDefault: true },
			{ id: 2, genreId: OTHER, name: "Plain", enabled: true, isDefault: true }
		]
	})
	feed("characters:list", { characterList: CHARACTERS })
	feed("lorebooks:list", { lorebookList: [] })
	await settle()
}

const mode = (m: string) => host.querySelector<HTMLButtonElement>(`[data-creation-mode="${m}"]`)!
const heading = (text: string) =>
	[...host.querySelectorAll("h3")].find((h) => h.textContent?.trim() === text) ?? null
const startButton = () =>
	[...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Start")!
const created = (): any[] =>
	requests.filter((r) => r.key === "sessions:create").map((r) => r.params.session ?? r.params)
const createdParams = (): any[] =>
	requests.filter((r) => r.key === "sessions:create").map((r) => r.params)

describe("Start a session › How it starts", () => {
	test("offers the four modes with their lines", async () => {
		await render()
		expect(heading("How it starts")).not.toBeNull()
		expect([...host.querySelectorAll("[data-creation-mode]")].map((b) => b.getAttribute("data-creation-mode"))).toEqual([
			"new",
			"new-world",
			"branch",
			"next-chapter"
		])
		expect(mode("new").getAttribute("aria-checked")).toBe("true")
		expect(host.textContent).toContain("Picks up another session's history in a new session.")
	})

	test("a genre's proposal preselects Next chapter, marked Suggested", async () => {
		await render({ propose: "next-chapter" })
		expect(mode("next-chapter").getAttribute("aria-checked")).toBe("true")
		expect(mode("next-chapter").textContent).toContain("Suggested")
		expect(mode("new").textContent).not.toContain("Suggested")
	})

	test("picking New session sticks after a genre change", async () => {
		await render({ propose: "next-chapter", twoGenres: true })
		const pickGenre = async (id: string) => {
			host.querySelector<HTMLButtonElement>(`[data-genre-card="${id}"] button[role="radio"]`)!.click()
			await settle()
		}
		await pickGenre(GENRE)
		expect(mode("next-chapter").getAttribute("aria-checked")).toBe("true")
		mode("new").click()
		await settle()
		await pickGenre(OTHER)
		await pickGenre(GENRE)
		expect(mode("new").getAttribute("aria-checked")).toBe("true")
	})

	test("branch hides the Cast and says what is missing until a session is picked", async () => {
		await render()
		expect(host.querySelector('[aria-labelledby="start-cast-heading"]')).not.toBeNull()
		mode("branch").click()
		await settle()
		expect(host.querySelector('[aria-labelledby="start-cast-heading"]')).toBeNull()
		expect(startButton().disabled).toBe(true)
		expect(host.querySelector("#start-session-reason")?.textContent?.trim()).toBe("Choose the session to branch.")
		const row = [...host.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find((b) =>
			b.textContent?.includes("Old Harbour")
		)!
		row.click()
		await settle()
		expect(startButton().disabled).toBe(false)
	})

	test("the emitted sessions:create carries mode and from", async () => {
		await render()
		mode("next-chapter").click()
		await settle()
		// A session with no lorebook is offered to follow too (ruled 2026-10-30: the next
		// chapter follows the session's own notes, shared as the book — `followableSessions`).
		expect(host.textContent).toContain("No Book")
		const row = [...host.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find((b) =>
			b.textContent?.includes("Old Harbour")
		)!
		row.click()
		await settle()
		expect(host.textContent).toContain("It continues on Old Harbour's lorebook.")
		startButton().click()
		flushSync()
		expect(createdParams()[0]).toMatchObject({ mode: "next-chapter", from: 11 })
	})
})
