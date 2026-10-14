/**
 * Admin → Defaults says "Off" for a job nobody has asked for, and "Needed"
 * only for one this pub needs (plan less-confusing C2, owner ruling
 * 2026-10-11): image generation is demanded by a catalog node on every pub,
 * and a red word for it on a text-only pub was a complaint nobody could act
 * on. The rows speak plain words; the transform id waits behind the "?".
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { socket, listeners, listen } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	return {
		socket: { emit: () => {}, on: () => {}, off: () => {} },
		listeners,
		listen: (key: string, handler: (msg: any) => void) => {
			listeners.set(key, handler)
			return () => {
				if (listeners.get(key) === handler) listeners.delete(key)
			}
		}
	}
})
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen,
	getAdminInterestContext: () => ({
		useInterest: listen,
		requestWithInterest: (key: string, _params: unknown, handler: any) => {
			listen(key, handler)
			return () => {}
		}
	})
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error: () => {}, info: () => {}, success: () => {} }
}))
vi.mock("$lib/client/components/inputs/Select.svelte", () => ({
	default: () => {}
}))
vi.mock("$lib/client/components/admin/AdminPageHeader.svelte", () => ({
	default: () => {}
}))

import Page from "./Page.svelte"

const IMAGE = "text->image"
const site = { definitionId: "core:oracle/generate-image", version: 1, slot: "connection" }
const LIST = (needed: Record<string, string>) => ({
	combos: [
		{ id: IMAGE, demanded: true, servable: true, requiredBy: [site], optionalFor: [] }
	],
	defaults: {},
	connectionOptions: {
		[IMAGE]: [{ id: 1, name: "Draws", type: "a1111", eligible: true, models: [] }]
	},
	samplingOptions: {},
	refused: {},
	needed,
	usedBy: {
		[IMAGE]: { steps: 1, pipelines: ["Generate an image"], actions: ["Image"] }
	}
})

let app: ReturnType<typeof mount> | null = null
let panels: { digest: Record<string, unknown>; openPanel: (o: any) => void; opened: string[] }
function open(needed: Record<string, string>) {
	panels = {
		digest: {},
		opened: [],
		openPanel: (o: any) => panels.opened.push(o.key)
	}
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(Page, {
		target: host,
		context: new Map<string, unknown>([
			["userCtx", { user: { id: 1, isAdmin: true } }],
			["systemSettingsCtx", { settings: {}, capabilityDefaults: {} }],
			["panelsCtx", panels]
		])
	})
	flushSync()
	listeners.get("connectionDefaults:list")!(LIST(needed))
	flushSync()
}
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	document.body.innerHTML = ""
})
const row = () =>
	document.querySelector(`[data-field="default:${IMAGE}"]`)?.textContent?.replace(/\s+/g, " ") ?? ""

function loadout(over: Record<string, unknown> & { id: number; name: string }) {
	return {
		loadoutId: `pub:loadout/${over.id}`,
		slug: String(over.id),
		description: null,
		owner: "pub",
		transform: IMAGE,
		connectionId: null,
		connectionModelId: null,
		connectionName: null,
		modelName: null,
		connectionType: null,
		samplingConfigId: null,
		samplingName: null,
		workflowId: null,
		tier: null,
		defaultFor: null,
		mergedInto: null,
		mergedIntoName: null,
		filled: false,
		fallbackName: "Images",
		consequence: null,
		usedBy: { steps: 0, pipelines: [] },
		grades: {},
		...over
	}
}
const LOADOUTS = {
	loadouts: [
		loadout({ id: 7, name: "Sprites" }),
		loadout({ id: 3, name: "Images", defaultFor: IMAGE, fallbackName: null }),
		loadout({
			id: 9,
			name: "Portraits",
			filled: true,
			connectionId: 1,
			connectionModelId: 2,
			connectionName: "Draws",
			modelName: "sdxl"
		})
	],
	transforms: [{ id: IMAGE, label: "Images", output: "image", defaultLoadoutId: 3 }],
	canReply: false,
	samplingOptions: {}
}
const loadoutRow = (id: number) =>
	document.querySelector(`[data-field="loadout:${id}"]`)?.textContent?.replace(/\s+/g, " ") ?? ""

describe("Admin → Defaults: loadouts as rows", () => {
	test("a job's other loadouts sit beneath its default, by name, with their state words", () => {
		open({})
		listeners.get("loadouts:list")!(LOADOUTS)
		flushSync()
		const fields = [...document.querySelectorAll("[data-field]")].map((el) =>
			el.getAttribute("data-field")
		)
		// The default is the job's own row; no second row for it.
		expect(fields).toEqual([`default:${IMAGE}`, "loadout:9", "loadout:7"])
		expect(loadoutRow(7)).toContain("Unfilled → falls back to Images")
		expect(loadoutRow(9)).toContain("Set")
		expect(loadoutRow(9)).toContain("sdxl · Draws")
		// The default row keeps its job status words.
		expect(row()).toContain("Off")
	})

	test("Open in Loadouts opens the Loadouts view on that loadout", () => {
		open({})
		listeners.get("loadouts:list")!(LOADOUTS)
		flushSync()
		;(document.querySelector('[aria-label="Open in Loadouts: Sprites"]') as HTMLButtonElement).click()
		expect(panels.opened).toEqual(["loadouts"])
		expect(panels.digest.loadoutId).toBe(7)
		;(document.querySelector('[data-field="default:text->image"] button[aria-label^="Open in Loadouts"]') as HTMLButtonElement).click()
		expect(panels.digest.loadoutId).toBe(3)
	})
})

describe("Admin → Defaults: Off and Needed", () => {
	test("a demanded job nothing has asked for reads Off, says what uses it, and hides its transform id", () => {
		open({})
		expect(row()).toContain("Off")
		expect(row()).not.toContain("Needed")
		expect(row()).toContain("Used by the Image action; set a connection to turn it on.")
		expect(row()).not.toContain(IMAGE)
		const dot = document.querySelector(`[data-field="default:${IMAGE}"] .bg-surface-500`)
		expect(dot).not.toBeNull()
	})

	test("a job a run failed without reads Needed, in gold (needs you, not broken), and says why", () => {
		open({ [IMAGE]: "failedRun" })
		expect(row()).toContain("Needed")
		expect(row()).toContain("A run needed this in the last 7 days and failed.")
		expect(row()).not.toContain("set a connection to turn it on")
		const dot = document.querySelector(`[data-field="default:${IMAGE}"] .bg-primary-500`)
		expect(dot).not.toBeNull()
	})
})
