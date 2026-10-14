/**
 * The Loadout row (I12; DESIGN-image-generation §14 item 4) as the panel
 * draws it: the picker leads the group, its rows carry consequence words and
 * never a grade, the selected one shows its chain and a *Change…* door, the
 * *Needs / Best with* line sits under it, and the slots beneath say *Set
 * here* / *From the Extraction loadout* — with *Use loadout's* on a value
 * set here. A session's card never draws a Loadout.
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
import { _resetInterestForTests, setInterestUser } from "$lib/client/sockets/interest.svelte"
import PipelineConfigOptions from "./PipelineConfigOptions.svelte"
import { adventureView, option } from "./settingsGroups.fixture"

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

let client: ReturnType<typeof makeClientSocket>
let app: ReturnType<typeof mount> | null = null
let host: HTMLElement
const panelsCtx = { digest: {} as Record<string, unknown>, openPanel: vi.fn() }

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: true })
	host = document.createElement("div")
	document.body.append(host)
	panelsCtx.digest = {}
	panelsCtx.openPanel.mockClear()
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

const own = { key: "keeper-call", heading: "Write the record" }

/** One model call, its Loadout naming Extraction (unfilled → Reply). */
function loadoutView(sessionId?: number): Sockets.Pipelines.NamespaceDetail {
	const group: Sockets.Pipelines.SettingsGroup = {
		key: "g0",
		kind: "model-call",
		front: [
			option({
				id: "loadout",
				label: "Loadout",
				control: "loadout-ref",
				value: { id: "core:loadout/extraction@1" },
				source: "config",
				changed: true,
				overriddenHere: true,
				valueLabel: "Extraction",
				choices: [
					{ id: 1, label: "Reply", loadoutId: "core:loadout/reply@1", description: "JSON by instruction (no schema door)" },
					{
						id: 2,
						label: "Extraction",
						loadoutId: "core:loadout/extraction@1",
						description: "Unfilled — falls back to Reply · JSON by instruction (no schema door)"
					}
				],
				loadout: {
					selected: { id: 2, name: "Extraction", chain: "Extraction → Reply (unfilled fallback)" },
					needs: ["Text generation", "a structured answer"],
					bestWith: ["Extraction sampling"]
				},
				step: own
			}),
			option({
				id: "connection",
				label: "Connection",
				control: "connection-ref",
				choices: [
					{
						id: 1,
						label: "KoboldCpp",
						models: [{ id: 11, name: "Nemo 12B", model: "nemo", enabled: true, missingSince: null }]
					}
				],
				inherits: { from: "loadout", label: "From the Reply loadout (unfilled fallback) — KoboldCpp · Nemo 12B" },
				provenance: { source: "loadout", label: "From the Reply loadout (unfilled fallback)" },
				valueLabel: "KoboldCpp · Nemo 12B",
				step: own
			}),
			option({
				id: "sampling",
				label: "Sampling",
				control: "sampling-ref",
				choices: [
					{ id: 1, label: "Default" },
					{ id: 2, label: "Extraction" }
				],
				value: 1,
				source: "config",
				overriddenHere: true,
				changed: true,
				provenance: { source: "config", label: "Set here" },
				valueLabel: "Default",
				useLoadout: "Extraction",
				step: own
			})
		],
		advanced: [],
		changedInAdvanced: 0
	}
	return adventureView({
		groups: [group],
		...(sessionId != null ? { scope: { kind: "session", sessionId } } : {})
	})
}

async function open(view: Sockets.Pipelines.NamespaceDetail, props: Record<string, unknown> = {}) {
	app = mount(PipelineConfigOptions, {
		target: host,
		props: { slug: view.slug, ...props } as any,
		context: new Map<string, unknown>([
			["userCtx", { user: { id: 1, isAdmin: true } }],
			["panelsCtx", panelsCtx]
		])
	})
	await settle()
	client.dispatch("pipelines:get", { pipeline: view })
	await settle()
}

const row = (control: string) => host.querySelector<HTMLElement>(`[data-option-row="${control}"]`)

describe("the Loadout row", () => {
	test("leads the group, labelled Loadout, showing the selected loadout and its chain", async () => {
		await open(loadoutView())
		const front = host.querySelector<HTMLElement>("[data-group-front]")!
		const first = front.querySelector<HTMLElement>("[data-option-row]")!
		expect(first.dataset.optionRow).toBe("loadout-ref")
		expect(first.querySelector("[data-row-label]")?.textContent?.trim()).toBe("Loadout")
		expect(first.querySelector<HTMLInputElement>('input[role="combobox"]')!.value).toBe("Extraction")
		expect(first.querySelector("[data-loadout-chain]")?.textContent).toContain(
			"Extraction → Reply (unfilled fallback)"
		)
	})

	test("lists None first, then each loadout with its consequence words — never a grade", async () => {
		await open(loadoutView())
		row("loadout-ref")!
			.querySelector<HTMLButtonElement>('button[aria-label="Show Loadout options"]')!
			.click()
		await settle()
		const rows = [
			...document.querySelectorAll<HTMLElement>('[role="listbox"][data-state="open"] [role="option"]')
		].map((r) => r.textContent!.replace(/\s+/g, " ").trim())
		expect(rows[0]).toBe("None (the default loadout)")
		expect(rows[2]).toContain("Unfilled — falls back to Reply")
		expect(rows.join(" ")).not.toMatch(/\b(fits|partly|won't)\b/i)
	})

	test("picking a loadout stores its id; None stores nothing", async () => {
		await open(loadoutView())
		row("loadout-ref")!
			.querySelector<HTMLButtonElement>('button[aria-label="Show Loadout options"]')!
			.click()
		await settle()
		const options = [
			...document.querySelectorAll<HTMLElement>('[role="listbox"][data-state="open"] [role="option"]')
		]
		options[1]!.click()
		await settle()
		expect(client.emits.find((e) => e.event === "pipelines:setOption")?.payload).toMatchObject({
			optionId: "loadout",
			value: { id: "core:loadout/reply@1" }
		})
	})

	test("draws Needs and Best with under the picker", async () => {
		await open(loadoutView())
		const line = row("loadout-ref")!.querySelector<HTMLElement>("[data-loadout-needs]")!
		expect(line.textContent!.replace(/\s+/g, " ")).toContain("Needs Text generation · a structured answer")
		expect(line.textContent!.replace(/\s+/g, " ")).toContain("Best with Extraction sampling")
	})

	test("Change… opens the loadout's sheet in the Loadouts view", async () => {
		await open(loadoutView())
		const change = [...row("loadout-ref")!.querySelectorAll("button")].find((b) =>
			/Change…/.test(b.textContent ?? "")
		)!
		change.click()
		expect(panelsCtx.digest.loadoutId).toBe(2)
		expect(panelsCtx.openPanel).toHaveBeenCalledWith({ key: "loadouts", toggle: false })
	})
})

describe("the slots beneath it", () => {
	test("say where their value came from: the loadout, or set here", async () => {
		await open(loadoutView())
		expect(row("connection-ref")!.querySelector("[data-provenance]")?.textContent).toContain(
			"From the Reply loadout (unfilled fallback)"
		)
		expect(row("sampling-ref")!.querySelector("[data-provenance]")?.textContent).toContain("Set here")
	})

	test("a value set here offers Use loadout's, which clears it", async () => {
		await open(loadoutView())
		const line = row("sampling-ref")!.querySelector<HTMLElement>("[data-provenance]")!
		const use = line.querySelector<HTMLButtonElement>("[data-use-loadout]")!
		expect(use.textContent).toContain("Use loadout's")
		expect([...line.querySelectorAll("button")].some((b) => /Reset/.test(b.textContent ?? ""))).toBe(false)
		use.click()
		await settle()
		expect(client.emits.find((e) => e.event === "pipelines:clearOption")?.payload).toMatchObject({
			optionId: "sampling"
		})
		// The connection follows the loadout already: nothing to clear.
		expect(row("connection-ref")!.querySelector("[data-use-loadout]")).toBeNull()
	})
})

describe("a session", () => {
	test("never draws a Loadout row, even if one were sent", async () => {
		await open(loadoutView(7), { sessionId: 7, mode: "session", title: "Reply" })
		expect(row("loadout-ref")).toBeNull()
	})
})
