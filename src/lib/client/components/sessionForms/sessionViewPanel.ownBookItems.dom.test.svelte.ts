/**
 * 🚧 The "This session only" card lists links and held paragraphs beside entries and held changes,
 * and each Apply names its own list.
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

const LINK = {
	kind: "link",
	linkId: 21,
	entryId: 3,
	typeId: "character",
	title: "Wren knows Old Marl",
	sourceMessageId: null
}
const PARAGRAPH = {
	kind: "entry-change",
	notesEntryId: 44,
	entryId: 5,
	typeId: "place",
	title: "The Keep",
	sourceMessageId: null,
	changes: [
		{ field: "summary", label: "Summary", before: "ruin", after: "held" }
	],
	conflict: null
}
const CHANGE = { ...PARAGRAPH, notesEntryId: undefined, amendmentId: 8 }

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	socket.emit.mockClear()
	panels.digest = {}
	document.body.innerHTML = ""
})

async function mountPanel(opts: {
	items?: unknown[]
	batches?: unknown[]
	mayApply: boolean
}) {
	app = mount(SessionViewPanel, {
		target: document.body,
		context: new Map([["panelsCtx", panels]]),
		props: {
			sessionId: 12,
			onOpen: () => {},
			onEdit: () => {},
			canEdit: true,
			isOwner: true
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
	listeners.get("sessions:overlayItems")?.({
		sessionId: 12,
		items: opts.items ?? [],
		mayApply: opts.mayApply,
		appliesItself: false
	})
	listeners.get("sessions:appliedBatches")?.({
		sessionId: 12,
		batches: opts.batches ?? [],
		mayApply: opts.mayApply
	})
	flushSync()
	await tick()
}
const buttons = () => [
	...document.querySelectorAll<HTMLButtonElement>("button")
]
const apply = () =>
	buttons().filter((b) => b.textContent?.trim() === "Apply to the lorebook")

describe("link and paragraph items", () => {
	test("a link shows its title and Apply sends linkIds", async () => {
		await mountPanel({ items: [LINK], mayApply: true })
		expect(document.body.textContent).toContain("Wren knows Old Marl")
		apply()[0]!.click()
		expect(socket.emit).toHaveBeenCalledWith("sessions:applyOverlay", {
			sessionId: 12,
			linkIds: [21]
		})
	})
	test("a paragraph shows its change and Apply sends its notes day", async () => {
		await mountPanel({ items: [PARAGRAPH], mayApply: true })
		expect(document.body.textContent).toContain("The Keep")
		expect(document.body.textContent).toContain("Summary: ruin → held")
		apply()[0]!.click()
		expect(socket.emit).toHaveBeenCalledWith("sessions:applyOverlay", {
			sessionId: 12,
			entryIds: [44]
		})
	})
	test("a held change still sends amendmentIds", async () => {
		await mountPanel({ items: [CHANGE], mayApply: true })
		apply()[0]!.click()
		expect(socket.emit).toHaveBeenCalledWith("sessions:applyOverlay", {
			sessionId: 12,
			amendmentIds: [8]
		})
	})
	test("a non-owner sees no Apply button", async () => {
		await mountPanel({ items: [LINK, PARAGRAPH], mayApply: false })
		expect(document.body.textContent).toContain("Wren knows Old Marl")
		expect(apply()).toHaveLength(0)
	})
	test("the applied list reads title · link", async () => {
		await mountPanel({
			mayApply: false,
			batches: [
				{
					batch: "b1",
					at: new Date().toISOString(),
					by: null,
					automatic: "scene-close",
					sceneId: 4,
					count: 1,
					items: [
						{
							kind: "link",
							linkId: 21,
							entryId: 3,
							title: "Wren knows Old Marl"
						}
					]
				}
			]
		})
		buttons()
			.find((b) => b.textContent?.includes("1 change"))!
			.click()
		flushSync()
		await tick()
		expect(document.body.textContent).toContain(
			"Wren knows Old Marl · link"
		)
	})
})
