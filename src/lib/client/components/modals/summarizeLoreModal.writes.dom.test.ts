/**
 * What the Summarize modal writes, and what it offers (plan A12 review).
 *
 * - Character lore's cast member is added by the SAVE itself: the modal sends
 *   the character with `entries:create` and never adds the member first, so
 *   a refused or unanswered save leaves the book's cast as it was.
 * - The history entries a scene can be filed under stop at the session's
 *   story time, and a session with no clock of its own stands at its line's
 *   stored clock: an entry dated past it is neither offered first nor
 *   preselected.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))
const toaster = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	warning: vi.fn()
}))
vi.mock("$lib/client/utils/toaster", () => ({ toaster }))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import SummarizeLoreModal from "./SummarizeLoreModal.svelte"

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

const SESSION = 41
const BOOK = 5

let client: ReturnType<typeof makeClientSocket>
let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
})

afterEach(() => {
	if (app) unmount(app)
	app = null
	_resetInterestForTests()
	setSocket(null)
	document.body.innerHTML = ""
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

function open(props: Record<string, unknown>) {
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(SummarizeLoreModal, {
		target,
		props: {
			open: true,
			onOpenChange: () => {},
			sessionId: SESSION,
			lorebookId: BOOK,
			selectedMessageIds: [1, 2],
			onSaved: () => {},
			onLorebookSet: () => {},
			...props
		} as any
	})
}

const text = () => document.body.textContent?.replace(/\s+/g, " ") ?? ""

describe("SummarizeLoreModal — character lore binds in the save", () => {
	test("Save sends the character with the entry and adds no cast member first", async () => {
		open({
			resumeActivity: {
				activityId: "act-1",
				userId: 1,
				sessionId: SESSION,
				loreType: "character",
				lorebookId: BOOK,
				topic: "Wren",
				status: "review",
				pendingResult: {
					name: "Wren's oath",
					content: "Wren swore never to cross the river.",
					raw: "",
					lorebookBindingCharacterId: 77
				},
				startedAt: "2026-09-30T00:00:00.000Z"
			}
		})
		await settle()

		const save = [...document.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("Save to Lorebook")
		) as HTMLButtonElement
		expect(save).toBeDefined()
		save.click()
		await settle()

		const events = client.emits.map((e) => e.event)
		expect(events).not.toContain("lorebooks:createBinding")
		const create = client.emits.find((e) => e.event === "entries:create")
		expect(create?.payload).toMatchObject({
			sessionId: SESSION,
			lorebookBindingCharacterId: 77
		})
		expect(create?.payload.entry.lorebookBindingId ?? null).toBeNull()
	})
})

describe("SummarizeLoreModal — the history a scene is filed under", () => {
	test("a session following its line's stored clock is not offered history past it", async () => {
		open({ initialLoreType: "scene", branchId: null, storyClock: null })
		await settle()

		client.dispatch("entries:list", {
			lorebookId: BOOK,
			typeId: HISTORY_TYPE_ID,
			entryList: [
				{ id: 1, lorebookId: BOOK, typeId: HISTORY_TYPE_ID, year: 1, content: "Early days." },
				{ id: 2, lorebookId: BOOK, typeId: HISTORY_TYPE_ID, year: 5, content: "Late days." }
			]
		})
		client.dispatch("lorebooks:storyTime", {
			lorebookId: BOOK,
			calendar: null,
			clocks: { main: { year: 3 }, branches: [] },
			presents: { main: { year: 3 }, branches: [] }
		})
		await settle()

		expect(text()).not.toContain("Late days.")
		expect(text()).toContain("Early days.")
	})
})
