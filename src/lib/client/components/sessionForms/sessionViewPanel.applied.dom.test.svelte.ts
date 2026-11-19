/**
 * 🚧 sense-b2: the "This session only" card is the session's owner's (never a guest's); Apply and
 * Take back need `mayApply` too (the owner may write the lorebook). Where they may not, the card
 * says so and offers Merge. It lists what was applied, and says when the lorebook applies by itself.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import { FOLD_CONFIRM, FOLD_LABEL } from "$lib/shared/lorebooks/sessionNotes"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { listeners, notesHandlers, socket, panels } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	const notesHandlers: Array<(msg: any) => void> = []
	const panels = {
		digest: {} as any,
		openPanel: vi.fn()
	}
	return {
		listeners,
		notesHandlers,
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
	requestWithInterest: (
		_event: string,
		_params: unknown,
		handler: (msg: any) => void
	) => {
		notesHandlers.push(handler)
		return () => {}
	}
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
	notesHandlers.length = 0
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
	/** Answer `appliedBatches` only; the test sends `overlayItems` itself. */
	batchesOnly?: boolean
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
	if (!opts.batchesOnly)
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

describe("Apply needs the session's owner and mayApply", () => {
	test("hidden for a reader who is not the session's owner, whatever mayApply says", async () => {
		await mountPanel({ isOwner: false, mayApply: true })
		expect(
			document.querySelector('section[aria-label="This session only"]')
		).toBeNull()
		expect(byText("Apply to the lorebook")).toBeFalsy()
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
			isOwner: true,
			mayApply: false,
			items: [],
			batches: [BATCH()]
		})
		const text = document.body.textContent ?? ""
		expect(text).toContain("Applied to the lorebook")
		expect(text).toContain("2 changes · as a scene closed · just now")
		expect(document.body.textContent).not.toContain("new entry")
		const toggle = document.querySelector<HTMLButtonElement>(
			'section[aria-label="This session only"] button[aria-expanded]'
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
			isOwner: true,
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
			isOwner: true,
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
			isOwner: true,
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
		"The lorebook takes what waits here by itself as each scene closes."
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
			isOwner: true,
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
			isOwner: true,
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
			isOwner: true,
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

describe("Where the session's owner may not write the lorebook", () => {
	const BOOK = "Brackenvale"
	const nameBook = async () => {
		for (const handler of notesHandlers)
			handler({
				books: [{ sessionId: 12, attached: { id: 5, name: BOOK } }]
			})
		flushSync()
		await tick()
	}
	const openMenu = async () => {
		document
			.querySelector<HTMLButtonElement>(
				"button[aria-label='Session options']"
			)!
			.click()
		await tick()
		flushSync()
		return [
			...document.querySelectorAll<HTMLElement>("[role=menuitem]")
		].map((el) => el.textContent?.trim())
	}

	test("owned: Apply controls and Share to the book are offered, nothing closed", async () => {
		await mountPanel({
			isOwner: true,
			mayApply: true,
			items: [ITEM, { ...ITEM, entryId: 4, title: "Tamsin" }]
		})
		await nameBook()
		expect(byText("Apply to the lorebook")).toBeTruthy()
		expect(
			buttons().some((b) => b.textContent?.trim().startsWith("Apply all"))
		).toBe(true)
		expect(document.querySelector("[data-apply-closed]")).toBeNull()
		expect(await openMenu()).toContain(`Share to ${BOOK}`)
	})

	test("not writable: the card says so and offers Merge; no Apply, Take back or Share", async () => {
		await mountPanel({
			isOwner: true,
			mayApply: false,
			items: [ITEM, { ...ITEM, entryId: 4, title: "Tamsin" }],
			batches: [BATCH()]
		})
		await nameBook()
		const closed = document.querySelector("[data-apply-closed]")!
		expect(closed.textContent).toContain(
			`${BOOK} isn't yours to change, so what waits here stays in this session.`
		)
		expect(byText("Apply to the lorebook")).toBeFalsy()
		expect(
			buttons().some((b) => b.textContent?.trim().startsWith("Apply all"))
		).toBe(false)
		expect(byText("Take back")).toBeFalsy()
		const labels = await openMenu()
		expect(labels).not.toContain(`Share to ${BOOK}`)
		expect(labels).toContain(FOLD_LABEL(BOOK))
		// close the menu so the card link is reachable
		document.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
		)
		await new Promise((r) => setTimeout(r, 50))
		const link = [...closed.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === FOLD_LABEL(BOOK)
		)!
		link.click()
		await new Promise((r) => setTimeout(r, 50))
		flushSync()
		await tick()
		const dialog = document.querySelector("[data-action-confirm]")!
		expect(dialog.textContent).toContain(FOLD_CONFIRM(BOOK))
		const confirm = [...dialog.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === FOLD_LABEL(BOOK)
		)!
		confirm.click()
		expect(socket.emit).toHaveBeenCalledWith("sessions:foldInParent", {
			sessionId: 12
		})
		expect(socket.emit).not.toHaveBeenCalledWith(
			"sessions:applyOverlay",
			expect.anything()
		)
	})
})

describe("the closed sentence waits for the server's answer", () => {
	const closed = () => document.querySelector("[data-apply-closed]")
	const itemsAnswer = (mayApply: boolean) =>
		push("sessions:overlayItems", {
			sessionId: 12,
			items: [ITEM],
			mayApply,
			appliesItself: false
		})

	test("an owner who may write never sees it, whichever answer comes first", async () => {
		await mountPanel({
			isOwner: true,
			mayApply: true,
			batches: [BATCH()],
			batchesOnly: true
		})
		expect(closed()).toBeNull()
		await itemsAnswer(true)
		expect(closed()).toBeNull()
	})

	test("an owner who may not write sees it once the items answer arrives", async () => {
		await mountPanel({
			isOwner: true,
			mayApply: false,
			batches: [BATCH()],
			batchesOnly: true
		})
		expect(closed()).toBeNull()
		await itemsAnswer(false)
		expect(closed()).not.toBeNull()
	})
})
