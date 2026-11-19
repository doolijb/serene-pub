/**
 * 🚧 A held change to a locked entry says so in the review, and still offers Apply.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { listeners, socket, panels } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	const panels = { digest: {} as any, openPanel: vi.fn() }
	return {
		listeners,
		panels,
		socket: { emit: vi.fn(), on: () => {}, off: () => {} }
	}
})

vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (msg: any) => void) => {
		listeners.set(key, handler)
		return () => listeners.delete(key)
	},
	requestWithInterest: () => () => {}
}))
import SessionViewPanel from "./SessionViewPanel.svelte"

const CHANGE = {
	kind: "entry-change",
	amendmentId: 8,
	entryId: 5,
	typeId: "place",
	title: "The Keep",
	sourceMessageId: null,
	changes: [{ field: "summary", label: "Summary", before: "ruin", after: "held" }],
	conflict: null
}

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	socket.emit.mockClear()
	panels.digest = {}
	document.body.innerHTML = ""
})

async function mountPanel(items: unknown[]) {
	app = mount(SessionViewPanel, {
		target: document.body,
		context: new Map([["panelsCtx", panels]]),
		props: { sessionId: 12, onOpen: () => {}, onEdit: () => {}, canEdit: true, isOwner: true }
	})
	flushSync()
	await tick()
	listeners.get("sessions:get#12")?.({
		session: {
			id: 12,
			name: "The lighthouse",
			lorebookId: 5,
			sessionCharacters: [],
			sessionPersonas: [],
			tags: []
		}
	})
	listeners.get("sessions:overlayItems")?.({ sessionId: 12, items, mayApply: true, appliesItself: false })
	listeners.get("sessions:appliedBatches")?.({ sessionId: 12, batches: [], mayApply: true })
	flushSync()
	await tick()
}
const text = () => document.body.textContent?.replace(/\s+/g, " ") ?? ""
const apply = () =>
	[...document.querySelectorAll<HTMLButtonElement>("button")].filter(
		(b) => b.textContent?.trim() === "Apply to the lorebook"
	)

describe("a locked entry in the review", () => {
	test("says its change waits, and Apply stays offered", async () => {
		await mountPanel([{ ...CHANGE, entryLocked: true }])
		expect(text()).toContain(
			"The Keep is locked, so this change waits here until you Apply or Take back."
		)
		expect(apply()).toHaveLength(1)
	})
	test("an unlocked entry's change carries no such line", async () => {
		await mountPanel([CHANGE])
		expect(text()).not.toContain("is locked")
	})
})
