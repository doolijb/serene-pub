/**
 * The two connections Serene Pub makes itself (Local embeddings, Local named
 * entities) in Admin → Connections: they have a fixed name and no Delete, one
 * by one or in a bulk delete, on every device (also where the ONNX runtime
 * can't load: the row stays, reading Unavailable).
 *
 * Nothing here hands a DOM node to an assertion: a failing assert would
 * format the node, and a happy-dom node formats to gigabytes.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { emitted, socket, listeners, listen, menus } = vi.hoisted(() => {
	const emitted: Array<[string, any]> = []
	const listeners = new Map<string, Set<(msg: any) => void>>()
	return {
		emitted,
		socket: {
			emit: (event: string, payload: unknown) =>
				emitted.push([event, payload]),
			on: () => {},
			off: () => {}
		},
		listeners,
		listen: (key: string, handler: (msg: any) => void) => {
			let set = listeners.get(key)
			if (!set) listeners.set(key, (set = new Set()))
			set.add(handler)
			return () => set!.delete(handler)
		},
		/** Every bulk-actions menu the changelist rendered, by its props. */
		menus: [] as Array<Record<string, any>>
	}
})
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		error: () => {},
		warning: () => {},
		info: () => {},
		success: () => {}
	}
}))
vi.mock("$lib/client/admin/adminRouter.svelte", () => ({
	adminGoto: () => Promise.resolve(),
	adminRouter: { setQuery: () => {} },
	adminPage: { params: { id: "7" }, url: { search: "" } },
	adminUnsavedEdits: () => {}
}))
vi.mock("$lib/client/components/connections/ModelTable.svelte", () => ({
	default: () => {}
}))
vi.mock("$lib/client/components/admin/AdminPageHeader.svelte", () => ({
	default: () => {}
}))
vi.mock("$lib/client/components/menus/RowMenu.svelte", () => ({
	default: (_anchor: unknown, props: Record<string, any>) => {
		menus.push(props)
	}
}))
vi.mock("$lib/client/components/connections/ConnectionTypeForm.svelte", () => ({
	default: () => {}
}))
vi.mock(
	"$lib/client/components/connections/ConnectionStopScripts.svelte",
	() => ({ default: () => {} })
)
vi.mock(
	"$lib/client/components/connections/ConnectionCapabilities.svelte",
	() => ({ default: () => {} })
)
vi.mock(
	"$lib/client/components/connections/EmbeddingSwitchDialog.svelte",
	() => ({ default: () => {} })
)
vi.mock(
	"$lib/client/components/connections/EmbeddingQueuePanel.svelte",
	() => ({ default: () => {} })
)
vi.mock("$lib/client/components/connections/NerLanePanel.svelte", () => ({
	default: () => {}
}))
vi.mock(
	"$lib/client/components/koboldcppManager/KoboldCppSettingsTab.svelte",
	() => ({ default: () => {} })
)

import IdPage from "./IdPage.svelte"
import Page from "./Page.svelte"

const REASON = "the Android app can't run the ONNX runtime"
const AVAILABLE = { available: true, reason: null }
const UNAVAILABLE = { available: false, reason: REASON }

const row = (id: number, name: string, type: string) => ({
	id,
	name,
	type,
	preset: null,
	baseUrl: type === "local-onnx" ? null : "https://example.test/v1",
	hasCredential: true,
	modality: type === "local-onnx" ? "embeddings" : "text-gen",
	modelsSync: { syncedAt: null, error: null },
	models: []
})
const ONNX = row(7, "Local embeddings", "local-onnx")
const HOSTED = row(7, "Hosted", "openai")

function hear(key: string, msg: unknown) {
	for (const handler of [...(listeners.get(key) ?? [])]) handler(msg)
	flushSync()
}
const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, " ") ?? ""
const buttonNamed = (el: HTMLElement, name: string) =>
	[...el.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === name
	)
async function settle() {
	for (let i = 0; i < 4; i++) await tick()
	flushSync()
}
const context = (localOnnxAvailability: unknown) =>
	new Map<string, unknown>([
		[
			"systemSettingsCtx",
			{ settings: { localOnnxAvailability }, capabilityDefaults: {} }
		],
		["koboldCppSettingsCtx", { settings: undefined }],
		["panelsCtx", { digest: {}, openPanel: () => {} }],
		["userCtx", { user: { id: 1, isAdmin: true } }]
	])

let target: HTMLElement
let page: Record<string, any> | null = null

beforeEach(() => {
	emitted.length = 0
	listeners.clear()
	menus.length = 0
	vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900)
	target = document.createElement("div")
	document.body.appendChild(target)
})
afterEach(() => {
	if (page) unmount(page)
	page = null
	target.remove()
	vi.restoreAllMocks()
})

describe("one connection's change form", () => {
	async function open(r: ReturnType<typeof row>, availability: unknown) {
		page = mount(IdPage, { target, context: context(availability) })
		flushSync()
		hear("connections:list", { connectionsList: [r] })
		hear("connections:get", {
			connection: {
				id: 7,
				name: r.name,
				type: r.type,
				baseUrl: r.baseUrl ?? "",
				notes: ""
			}
		})
		await settle()
	}
	const nameInput = () => target.querySelector("input#connection-admin-name")

	test("one that comes with the app: no Delete, the name read-only", async () => {
		await open(ONNX, AVAILABLE)
		expect(!!buttonNamed(target, "Delete")).toBe(false)
		expect(nameInput() === null).toBe(true)
		expect(text(target)).toContain("Local embeddings")
	})

	test("the same row where the runtime can't load: still no Delete, the name read-only", async () => {
		await open(ONNX, UNAVAILABLE)
		expect(!!buttonNamed(target, "Delete")).toBe(false)
		expect(nameInput() === null).toBe(true)
		expect(text(target)).toContain("Local embeddings")
	})

	test("an ordinary connection: Delete, and the name is an input", async () => {
		await open(HOSTED, AVAILABLE)
		expect(!!buttonNamed(target, "Delete")).toBe(true)
		expect(nameInput() === null).toBe(false)
	})
})

describe("the changelist's bulk delete", () => {
	const A = row(1, "Hosted A", "openai")
	const B = row(2, "Hosted B", "openai")
	const E = row(3, "Local embeddings", "local-onnx")

	async function openList(
		rows: ReturnType<typeof row>[],
		availability: unknown = AVAILABLE
	) {
		page = mount(Page, { target, context: context(availability) })
		flushSync()
		hear("connections:list", { connectionsList: rows })
		await settle()
	}
	const pick = (name: string) => {
		const box = target.querySelector<HTMLInputElement>(
			`input[aria-label="Select ${name}"]`
		)!
		box.click()
		flushSync()
	}
	/** The latest bulk menu's Delete item, as the menu would call it. */
	const runDelete = () => {
		const menu = menus[menus.length - 1]
		menu.items
			.find((i: any) => i.label === "Delete selected connections…")
			.onSelect()
		flushSync()
	}
	const sentIds = () =>
		emitted.filter(([e]) => e === "connections:delete").map(([, p]) => p.id)

	test("the app-made row is named as kept and only the others go", async () => {
		await openList([A, B, E])
		for (const r of [A, B, E]) pick(r.name)
		runDelete()
		const t = text(target)
		expect(t).toContain("Local embeddings comes with Serene Pub and stays.")
		const listed = [
			...target.querySelectorAll(
				'ul[aria-label="What will be deleted"] > li'
			)
		].map((li) => li.textContent?.trim())
		expect(listed).toEqual(["Hosted A", "Hosted B"])
		const confirm = buttonNamed(target, "Delete 2 connections")!
		confirm.click()
		flushSync()
		expect(sentIds().sort()).toEqual([1, 2])
	})

	test("where the runtime can't load: the app-made row is still kept", async () => {
		await openList([A, B, E], UNAVAILABLE)
		for (const r of [A, B, E]) pick(r.name)
		runDelete()
		expect(text(target)).toContain(
			"Local embeddings comes with Serene Pub and stays."
		)
		buttonNamed(target, "Delete 2 connections")!.click()
		flushSync()
		expect(sentIds().sort()).toEqual([1, 2])
	})

	test("only the app-made row selected: nothing to confirm, only Back", async () => {
		await openList([A, B, E])
		pick("Local embeddings")
		runDelete()
		const t = text(target)
		expect(t).toContain("Local embeddings comes with Serene Pub")
		expect(t).toContain(
			"To free space, use Delete from disk on one of its models instead."
		)
		expect(!!buttonNamed(target, "Back")).toBe(true)
		expect(
			!![...target.querySelectorAll("button")].find((b) =>
				b.className.includes("preset-filled-error")
			)
		).toBe(false)
		expect(sentIds()).toEqual([])
	})
})
