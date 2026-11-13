/**
 * 🚧 sense-b2: the "This session only" card follows `mayApply` (never `isOwner`), lists what was
 * applied with Take back, and says when the lorebook applies by itself.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { listeners, socket, panels } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	const panels = {
		digest: {} as any,
		openPanel: vi.fn()
	}
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

const ITEM = {
	entryId: 3,
	typeId: "character",
	title: "Old Marl",
	sourceMessageId: null
}
const BATCH = (over: Record<string, unknown> = {}) => ({
	batch: "b1",
	at: new Date().toISOString(),
	by: null,
	automatic: "scene-close",
	sceneId: 4,
	count: 2,
	items: [
		{ kind: "entry", entryId: 3, title: "Old Marl" },
		{
			kind: "entry-change",
			entryId: 5,
			title: "The Keep",
			changes: [
				{
					field: "summary",
					label: "Summary",
					before: "ruin",
					after: "held"
				}
			]
		}
	],
	...over
})

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	socket.emit.mockClear()
	panels.openPanel.mockClear()
	panels.digest = {}
	document.body.innerHTML = ""
})

async function mountPanel(opts: {
	isOwner: boolean
	items?: unknown[]
	batches?: unknown[]
	mayApply: boolean
	appliesItself?: boolean
}) {
	app = mount(SessionViewPanel, {
		target: document.body,
		context: new Map([["panelsCtx", panels]]),
		props: {
			sessionId: 12,
			onOpen: () => {},
			onEdit: () => {},
			canEdit: true,
			isOwner: opts.isOwner
		}
	})
	flushSync()
	await tick()
	listeners.get("sessions:get#12")?.({
		session: {
			id: 12,
			name: "The lighthouse",
			lorebookId: 5,
			sessionCharacters: [{ character: { id: 1, name: "Wren" } }],
			sessionPersonas: [],
			tags: []
		}
	})
	push("sessions:overlayItems", {
		sessionId: 12,
		items: opts.items ?? [ITEM],
		mayApply: opts.mayApply,
		appliesItself: !!opts.appliesItself
	})
	push("sessions:appliedBatches", {
		sessionId: 12,
		batches: opts.batches ?? [],
		mayApply: opts.mayApply
	})
	await tick()
}
async function push(key: string, msg: unknown) {
	listeners.get(key)?.(msg)
	flushSync()
	await tick()
}
const buttons = () => [
	...document.querySelectorAll<HTMLButtonElement>("button")
]
const byText = (t: string) => buttons().find((b) => b.textContent?.trim() === t)

describe("Apply follows mayApply", () => {
	test("shows with mayApply even when the reader does not own the session", async () => {
		await mountPanel({ isOwner: false, mayApply: true })
		expect(byText("Apply to the lorebook")).toBeTruthy()
	})
	test("hidden without mayApply even for the session's owner", async () => {
		await mountPanel({ isOwner: true, mayApply: false })
		expect(document.body.textContent).toContain("Old Marl")
		expect(byText("Apply to the lorebook")).toBeFalsy()
	})
})

describe("What was applied", () => {
	test("a row says count, cause and when; the toggle shows its items", async () => {
		await mountPanel({
			isOwner: false,
			mayApply: false,
			items: [],
			batches: [BATCH()]
		})
		const text = document.body.textContent ?? ""
		expect(text).toContain("Applied to the lorebook")
		expect(text).toContain("2 changes · as a scene closed · just now")
		expect(document.body.textContent).not.toContain("new entry")
		const toggle = document.querySelector<HTMLButtonElement>(
			"button[aria-expanded]"
		)!
		expect(toggle.getAttribute("aria-expanded")).toBe("false")
		toggle.click()
		flushSync()
		await tick()
		const after = document.body.textContent ?? ""
		expect(after).toContain("Old Marl · new entry")
		expect(after).toContain("Summary: ruin → held")
	})
	test("a press names who", async () => {
		await mountPanel({
			isOwner: false,
			mayApply: false,
			items: [],
			batches: [
				BATCH({
					by: { userId: 1, name: "Ada" },
					automatic: null,
					count: 1
				})
			]
		})
		expect(document.body.textContent).toContain(
			"1 change · by Ada · just now"
		)
	})
	test("Take back emits and is absent without mayApply", async () => {
		await mountPanel({
			isOwner: false,
			mayApply: false,
			items: [],
			batches: [BATCH()]
		})
		expect(byText("Take back")).toBeFalsy()
		unmount(app!)
		app = null
		listeners.clear()
		document.body.innerHTML = ""
		await mountPanel({
			isOwner: false,
			mayApply: true,
			items: [],
			batches: [BATCH()]
		})
		const btn = byText("Take back")!
		expect(btn.getAttribute("aria-label")).toBe("Take back these 2 changes")
		btn.click()
		flushSync()
		expect(socket.emit).toHaveBeenCalledWith("sessions:takeBackApply", {
			sessionId: 12,
			batch: "b1"
		})
		expect(byText("Take back")!.disabled).toBe(true)
	})
	test("a refusal is said under its row", async () => {
		await mountPanel({
			isOwner: false,
			mayApply: true,
			items: [],
			batches: [BATCH()]
		})
		byText("Take back")!.click()
		await push("sessions:takeBackApply", {
			sessionId: 12,
			batch: "b1",
			refused: "An entry was edited since."
		})
		expect(document.body.textContent).toContain(
			"An entry was edited since."
		)
		expect(byText("Take back")!.disabled).toBe(false)
	})
})

describe("Applies by itself", () => {
	const SENTENCE =
		"The lorebook takes this session's changes by itself as each scene closes."
	test("the sentence needs appliesItself; its link also needs mayApply", async () => {
		await mountPanel({
			isOwner: true,
			mayApply: false,
			appliesItself: false
		})
		expect(document.body.textContent).not.toContain(SENTENCE)
		unmount(app!)
		app = null
		listeners.clear()
		document.body.innerHTML = ""
		await mountPanel({
			isOwner: false,
			mayApply: false,
			appliesItself: true
		})
		expect(document.body.textContent).toContain(SENTENCE)
		expect(byText("Writes from sessions to this book")).toBeFalsy()
		unmount(app!)
		app = null
		listeners.clear()
		document.body.innerHTML = ""
		await mountPanel({
			isOwner: false,
			mayApply: true,
			appliesItself: true
		})
		const link = byText("Writes from sessions to this book")!
		link.click()
		expect(panels.digest.lore).toEqual({
			lorebookId: 5,
			scope: "all",
			settings: true
		})
		expect(panels.openPanel).toHaveBeenCalledWith({
			key: "lorebooks",
			toggle: false
		})
	})
})

describe("Another session's payload", () => {
	test("is ignored", async () => {
		await mountPanel({
			isOwner: false,
			mayApply: true,
			items: [],
			batches: []
		})
		await push("sessions:overlayItems", {
			sessionId: 99,
			items: [ITEM],
			mayApply: true
		})
		await push("sessions:appliedBatches", {
			sessionId: 99,
			batches: [BATCH()],
			mayApply: true
		})
		expect(document.body.textContent).not.toContain("Old Marl")
		expect(document.body.textContent).not.toContain(
			"Applied to the lorebook"
		)
	})
})
