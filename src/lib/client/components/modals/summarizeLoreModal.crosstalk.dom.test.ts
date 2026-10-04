/**
 * B8 (lorebooks consolidation plan, 2026-09-29): the Summarize modal is
 * mounted on EVERY session page, and the answers it listens for are pushed
 * to every tab of the user (`emitToUser`). A handler that does not ask
 * whether an answer is its own acts on another tab's.
 *
 * `sessions:setLorebook` was the worst of them: an attach in tab B toasted
 * "Lorebook attached" in tab A and called A's `onLorebookSet`, which wrote
 * B's book onto A's session. The answer names its session, so the modal
 * asks. `lorebooks:create:error` is the same class: another tab's (or the
 * sidebar's) failed create toasted here too, though this modal asked for
 * nothing.
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

/** Tab A's session page, as far as its always-mounted Summarize modal goes. */
function openTabA(onLorebookSet: (id: number) => void) {
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(SummarizeLoreModal, {
		target,
		props: {
			open: false,
			onOpenChange: () => {},
			sessionId: TAB_A_SESSION,
			lorebookId: null,
			selectedMessageIds: [],
			onSaved: () => {},
			onLorebookSet
		}
	})
	flushSync()
}

describe("SummarizeLoreModal hears only its own session's answers", () => {
	test("tab B's lorebook attach is ignored by tab A — no toast, no onLorebookSet", () => {
		const onLorebookSet = vi.fn()
		openTabA(onLorebookSet)

		client.dispatch("sessions:setLorebook", {
			session: { id: TAB_B_SESSION, lorebookId: 9 }
		})
		flushSync()

		expect(onLorebookSet).not.toHaveBeenCalled()
		expect(toaster.success).not.toHaveBeenCalled()
	})

	test("its own session's attach still lands, once", () => {
		const onLorebookSet = vi.fn()
		openTabA(onLorebookSet)

		client.dispatch("sessions:setLorebook", {
			session: { id: TAB_A_SESSION, lorebookId: 5 }
		})
		flushSync()

		expect(onLorebookSet).toHaveBeenCalledTimes(1)
		expect(onLorebookSet).toHaveBeenCalledWith(5)
		expect(toaster.success).toHaveBeenCalledTimes(1)
	})

	test("a lorebook create this modal never asked for fails silently here", () => {
		openTabA(() => {})

		client.dispatch("lorebooks:create:error", { error: "Name taken" })
		flushSync()

		expect(toaster.error).not.toHaveBeenCalled()
	})
})

/**
 * A create this modal asked for is told apart by the `requestId` it sent,
 * which the server echoes on the broadcast and on the refusal. Claiming by
 * "a create is pending" or by the name raced: another surface's refusal
 * landing while this modal's create was in flight was reported here AND
 * consumed the claim, so the modal's own book then arrived and was never
 * attached; and another create with the same name was attached in its place.
 */
describe("SummarizeLoreModal claims only its own lorebook create", () => {
	/** Tab A's modal, open on a session with no book, after asking to create `name`. */
	function askToCreate(name: string): string {
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
				onSaved: () => {},
				onLorebookSet: () => {}
			}
		})
		flushSync()
		const newButton = [...document.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("New")
		)!
		newButton.click()
		flushSync()
		const input = document.querySelector<HTMLInputElement>(
			'input[aria-label="New lorebook name"]'
		)!
		input.value = name
		input.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
		flushSync()
		const create = client.emits.find((e) => e.event === "lorebooks:create")
		expect(create?.payload.name).toBe(name)
		expect(typeof create?.payload.requestId).toBe("string")
		return create!.payload.requestId
	}
	const attaches = () =>
		client.emits.filter((e) => e.event === "sessions:setLorebook")

	test("another surface's refusal neither toasts here nor loses this modal's create", () => {
		const requestId = askToCreate("Atlas")

		client.dispatch("lorebooks:create:error", { error: "Name taken" })
		client.dispatch("lorebooks:create:error", {
			requestId: "someone-else",
			error: "Name taken"
		})
		flushSync()
		expect(toaster.error).not.toHaveBeenCalled()

		client.dispatch("lorebooks:create", {
			lorebook: { id: 7, name: "Atlas" },
			requestId
		})
		flushSync()
		expect(attaches()).toEqual([
			{
				event: "sessions:setLorebook",
				payload: { sessionId: TAB_A_SESSION, lorebookId: 7 }
			}
		])
	})

	test("its own refusal toasts once", () => {
		const requestId = askToCreate("Atlas")

		client.dispatch("lorebooks:create:error", { requestId, error: "Name taken" })
		client.dispatch("lorebooks:create:error", { requestId, error: "Name taken" })
		flushSync()
		expect(toaster.error).toHaveBeenCalledTimes(1)
	})

	test("another create of the same name is not attached; its own is", () => {
		const requestId = askToCreate("Atlas")

		client.dispatch("lorebooks:create", {
			lorebook: { id: 6, name: "Atlas" },
			requestId: "sidebar"
		})
		client.dispatch("lorebooks:create", { lorebook: { id: 5, name: "Atlas" } })
		flushSync()
		expect(attaches()).toEqual([])

		client.dispatch("lorebooks:create", {
			lorebook: { id: 7, name: "Atlas" },
			requestId
		})
		flushSync()
		expect(attaches().map((e) => e.payload.lorebookId)).toEqual([7])
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
				onSaved: () => {},
				onLorebookSet: () => {}
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
