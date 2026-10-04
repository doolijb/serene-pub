/**
 * Admin → Connections → one connection: the Models table's levers wait for
 * the page's Save (owner ruling 2026-10-03; STYLE-GUIDE §6.11).
 *
 * Hide / Show and Use write nothing when pressed — they are pending changes,
 * named under the table and counted in the form's dirty state. Save sends
 * them one write at a time and waits for each answer: visibility first, then
 * the default that needs it. A refusal is named in the error summary, what
 * depended on it is not sent, and the page stays put with the rest pending.
 *
 * The model table is stood in for by a spy that records the props it was
 * handed, so a test presses its levers the way the real table's buttons do.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { emitted, socket, listeners, listen, tables, gone, toasts } = vi.hoisted(() => {
	const emitted: Array<[string, any]> = []
	const listeners = new Map<string, Set<(msg: any) => void>>()
	return {
		emitted,
		socket: {
			emit: (event: string, payload: unknown) => emitted.push([event, payload]),
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
		/** Every model table the page rendered, by the props it was handed. */
		tables: [] as Array<Record<string, any>>,
		gone: [] as string[],
		toasts: [] as Array<{ kind: string; title: string }>
	}
})
vi.mock("$lib/client/sockets/typedSocket", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		error: (t: any) => toasts.push({ kind: "error", ...t }),
		warning: (t: any) => toasts.push({ kind: "warning", ...t }),
		info: (t: any) => toasts.push({ kind: "info", ...t }),
		success: (t: any) => toasts.push({ kind: "success", ...t })
	}
}))
vi.mock("$lib/client/admin/adminRouter.svelte", () => ({
	adminGoto: (path: string) => {
		gone.push(path)
		return Promise.resolve()
	},
	adminPage: { params: { id: "7" } },
	adminUnsavedEdits: () => {}
}))
vi.mock("$lib/client/components/connections/ModelTable.svelte", () => ({
	default: (_anchor: unknown, props: Record<string, any>) => {
		tables.push(props)
	}
}))
vi.mock("$lib/client/components/admin/AdminPageHeader.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/menus/RowMenu.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/connections/ConnectionTypeForm.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/connections/ConnectionStopScripts.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/connections/ConnectionCapabilities.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/connections/EmbeddingSwitchDialog.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/connections/EmbeddingQueuePanel.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/connections/NerLanePanel.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/koboldcppManager/KoboldCppSettingsTab.svelte", () => ({ default: () => {} }))

import IdPage from "./IdPage.svelte"

const CHAT = "text->text"
const model = (id: number, name: string, enabled: boolean) => ({
	id,
	name,
	model: name.toLowerCase(),
	enabled,
	missingSince: null,
	satisfiableCapabilities: [CHAT]
})
const ROW = {
	id: 7,
	name: "Hosted",
	type: "openai",
	preset: null,
	baseUrl: "https://example.test/v1",
	hasCredential: true,
	modality: "text-gen",
	modelsSync: { syncedAt: null, error: null },
	models: [model(1, "Nemo", true), model(2, "Qwen", false)]
}

function hear(key: string, msg: unknown) {
	for (const handler of [...(listeners.get(key) ?? [])]) handler(msg)
	flushSync()
}
const sentOf = (event: string) => emitted.filter(([e]) => e === event)
const table = () => tables[tables.length - 1]
const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, " ") ?? ""
const saveButton = (el: HTMLElement) =>
	[...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Save")!
/** Let a chain of awaited replies move one step. */
async function settle() {
	for (let i = 0; i < 4; i++) await tick()
	flushSync()
}

let target: HTMLElement
let page: Record<string, any>

beforeEach(async () => {
	emitted.length = 0
	listeners.clear()
	tables.length = 0
	gone.length = 0
	toasts.length = 0
	// `bind:clientWidth` decides table or rows; happy-dom lays nothing out.
	vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900)
	target = document.createElement("div")
	document.body.appendChild(target)
	page = mount(IdPage, {
		target,
		context: new Map<string, unknown>([
			[
				"systemSettingsCtx",
				{
					settings: {},
					capabilityDefaults: {
						[CHAT]: { connectionId: 7, connectionModelId: 1 }
					}
				}
			],
			["koboldCppSettingsCtx", { settings: undefined }],
			["panelsCtx", { digest: {}, openPanel: () => {} }],
			["userCtx", { user: { id: 1, isAdmin: true } }]
		])
	})
	flushSync()
	hear("connections:list", { connectionsList: [ROW] })
	hear("connections:get", {
		connection: { id: 7, name: "Hosted", type: "openai", baseUrl: ROW.baseUrl, notes: "" }
	})
	await settle()
})

afterEach(() => {
	unmount(page)
	target.remove()
	vi.restoreAllMocks()
})

describe("the model levers wait for Save", () => {
	test("pressing Show and Use writes nothing and is named as waiting", async () => {
		expect(table()).toBeTruthy()
		table().onToggleEnabled(2, true)
		flushSync()
		table().onUse(2)
		flushSync()

		expect(sentOf("connections:updateModel")).toHaveLength(0)
		expect(sentOf("connections:setDefault")).toHaveLength(0)
		expect(text(target)).toContain("Waiting for Save:")
		expect(text(target)).toContain("Show Qwen")
		expect(text(target)).toContain("Use Qwen for chat")
		expect(text(target)).toContain("Unsaved changes")
		// The table draws the draft: Qwen shown, and the chat mark moved to it.
		const drawn = table()
		expect(drawn.models.find((m: any) => m.id === 2).enabled).toBe(true)
		expect(drawn.defaultsByModel).toEqual({ 2: ["Chat"] })
	})

	test("Save sends visibility, waits for it, then the default, then leaves", async () => {
		table().onToggleEnabled(2, true)
		flushSync()
		table().onUse(2)
		flushSync()

		saveButton(target).click()
		await settle()
		expect(sentOf("connections:updateModel")).toEqual([
			["connections:updateModel", { id: 7, modelId: 2, model: { enabled: true } }]
		])
		// The default waits for the visibility write's answer.
		expect(sentOf("connections:setDefault")).toHaveLength(0)

		hear("connections:updateModel", { connectionId: 7, models: [] })
		await settle()
		expect(sentOf("connections:setDefault")).toEqual([
			["connections:setDefault", { capability: CHAT, id: 7, modelId: 2 }]
		])
		expect(gone).toEqual([])

		hear("connections:setDefault", { ok: true, capability: CHAT, id: 7, modelId: 2 })
		await settle()
		expect(gone).toEqual(["/admin/connections"])
		expect(toasts.at(-1)).toMatchObject({ kind: "success", title: "Saved Hosted" })
	})

	test("a refusal is named, what needed it is not sent, and the page stays", async () => {
		table().onToggleEnabled(2, true)
		flushSync()
		table().onUse(2)
		flushSync()

		saveButton(target).click()
		await settle()
		hear("connections:updateModel:error", { error: "The host is read-only." })
		await settle()

		expect(sentOf("connections:setDefault")).toHaveLength(0)
		expect(gone).toEqual([])
		expect(text(target)).toContain("Show Qwen: The host is read-only.")
		expect(text(target)).toContain("Not sent, because a change it needs was refused")
		// Both levers are still pending, so Save can be pressed again.
		expect(text(target)).toContain("Waiting for Save:")
		expect(toasts.at(-1)?.kind).toBe("warning")
	})

	test("an × puts a lever back; pressing it back also clears it", async () => {
		table().onToggleEnabled(1, false)
		flushSync()
		expect(text(target)).toContain("Hide Nemo")
		const undo = target.querySelector<HTMLButtonElement>('[aria-label="Undo: Hide Nemo"]')!
		undo.click()
		flushSync()
		expect(text(target)).not.toContain("Waiting for Save:")

		table().onToggleEnabled(1, false)
		flushSync()
		table().onToggleEnabled(1, true)
		flushSync()
		expect(text(target)).not.toContain("Waiting for Save:")
		expect(text(target)).not.toContain("Unsaved changes")
	})

	test("Refresh still acts at once", async () => {
		// The page's own stale-only sync on open, answered.
		hear("connections:syncModels", { results: [] })
		const refresh = [...target.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("Refresh")
		)!
		emitted.length = 0
		refresh.click()
		expect(sentOf("connections:syncModels")).toEqual([
			["connections:syncModels", { id: 7, force: true }]
		])
	})
})
