/**
 * B8 (lorebooks consolidation plan, 2026-09-29): the Summarize modal is
 * mounted on EVERY session page, and the answers it listens for are pushed
 * to every tab of the user (`emitToUser`). A handler that does not ask
 * whether an answer is its own acts on another tab's.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))
const toaster = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	warning: vi.fn()
}))
vi.mock("$lib/client/utils/toaster", () => ({ toaster }))

import { setSocket } from "$lib/client/sockets/socketInstance"
import { _resetInterestForTests, setInterestUser } from "$lib/client/sockets/interest.svelte"
import SummarizeLoreModal from "./SummarizeLoreModal.svelte"

type Listener = (payload: any) => void
/** One browser tab's socket: what the registry listens on and the modal emits on. */
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
		/** The server pushing an event to every tab of the user — this one included. */
		dispatch(event: string, payload: any) {
			for (const fn of [...(listeners.get(event) ?? [])]) fn(payload)
		}
	}
}

const TAB_A_SESSION = 41
const TAB_B_SESSION = 42

let client: ReturnType<typeof makeClientSocket>
let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
	toaster.success.mockClear()
	toaster.error.mockClear()
})

afterEach(() => {
	if (app) unmount(app)
	app = null
	_resetInterestForTests()
	setSocket(null)
	document.body.innerHTML = ""
})

describe("SummarizeLoreModal does not offer to read a book in", () => {
	test("a session with no book id yet shows no attach controls and sends no lorebook write", () => {
		const target = document.createElement("div")
		document.body.append(target)
		app = mount(SummarizeLoreModal, {
			target,
			props: {
				open: true,
				onOpenChange: () => {},
				sessionId: TAB_A_SESSION,
				lorebookId: null,
				selectedMessageIds: [],
				onSaved: () => {}
			}
		})
		flushSync()
		const text = document.body.textContent ?? ""
		expect(text.includes("Read into this session")).toBe(false)
		expect(text.includes("Saving to")).toBe(false)
		expect(document.querySelector('input[aria-label="New lorebook name"]')).toBeNull()
		client.dispatch("lorebooks:create:error", { error: "Name taken" })
		flushSync()
		expect(toaster.error).not.toHaveBeenCalled()
		expect(
			client.emits.some(
				(e) => e.event === "sessions:setLorebook" || e.event === "lorebooks:create"
			)
		).toBe(false)
	})
})

/**
 * Phase D wire hygiene: `sessions:summarize:progress`/`:complete` carry the
 * run's `sessionId` and are scoped on it. Before, two tabs on two sessions
 * each running a summary cross-fed — the first `:complete` to land filled
 * BOTH modals' review.
 */
describe("SummarizeLoreModal hears only its own session's summarize run", () => {
	async function generateInTabA() {
		const target = document.createElement("div")
		document.body.append(target)
		app = mount(SummarizeLoreModal, {
			target,
			props: {
				open: true,
				onOpenChange: () => {},
				sessionId: TAB_A_SESSION,
				lorebookId: 5,
				selectedMessageIds: [1, 2],
				onSaved: () => {}
			}
		})
		flushSync()
		const generate = [...document.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("Generate summary")
		) as HTMLButtonElement
		expect(generate).toBeDefined()
		generate.click()
		flushSync()
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
		expect(client.emits.some((e) => e.event === "sessions:summarize")).toBe(
			true
		)
	}
	const reviewName = () =>
		document.querySelector<HTMLInputElement>("#review-name")
	const result = (sessionId: number) => ({
		sessionId,
		content: `Summary of ${sessionId}`,
		name: `Lore ${sessionId}`,
		raw: `Summary of ${sessionId}`,
		lorebookId: 5,
		batchCount: 1
	})

	test("the modal declares its run's frames at its own session's scope", async () => {
		await generateInTabA()
		const declared = client.emits
			.filter((e) => e.event === "interest:sync")
			.flatMap((e) => JSON.stringify(e.payload))
			.join(" ")
		expect(declared).toContain(`sessions:summarize:complete#${TAB_A_SESSION}`)
		expect(declared).toContain(`sessions:summarize:progress#${TAB_A_SESSION}`)
	})

	test("another session's result never fills this review; its own does", async () => {
		await generateInTabA()

		client.dispatch("sessions:summarize:complete", result(TAB_B_SESSION))
		flushSync()
		expect(reviewName()).toBeNull()

		client.dispatch("sessions:summarize:complete", result(TAB_A_SESSION))
		flushSync()
		expect(reviewName()?.value).toBe(`Lore ${TAB_A_SESSION}`)
	})
})
