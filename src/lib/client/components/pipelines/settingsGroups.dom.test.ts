/**
 * The settings panel draws the server's groups (owner rulings 2026-09-30): one
 * tonal block per model call, then *Whole pipeline*; a header switch named by
 * the block; Prompt, Model and Sampling on the front with a provenance line;
 * everything else in one Advanced fold of step fieldsets. No counters, no
 * pooled drawer, no "N more settings".
 *
 * Inside a session: a card titled by the pipeline, front rows only, the model
 * read-only for an administrator and absent for anyone else (the server sends
 * a role only the rows it edits); a pipeline with nothing a session draws
 * draws no card at all.
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
import {
	adventureSessionView,
	adventureView,
	creationSessionView,
	emptySessionView,
	nonAdminSessionView
} from "./settingsGroups.fixture"
import { sessionScopeFor } from "./settingsGroups"

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

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: true })
	host = document.createElement("div")
	document.body.append(host)
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

async function open(props: Record<string, unknown>, view: Sockets.Pipelines.NamespaceDetail, isAdmin = true) {
	app = mount(PipelineConfigOptions, {
		target: host,
		props: { slug: view.slug, ...props } as any,
		context: new Map([["userCtx", { user: { id: 1, isAdmin } }]])
	})
	await settle()
	client.dispatch("pipelines:get", { pipeline: view })
	await settle()
}

const blocks = () => [...host.querySelectorAll<HTMLElement>("[data-settings-group]")]
const headingOf = (b: HTMLElement) => b.querySelector("[data-group-heading]")?.textContent?.trim() ?? null
const labelsIn = (el: HTMLElement) =>
	[...el.querySelectorAll<HTMLElement>("[data-row-label]")].map((l) => l.textContent!.trim())

describe("a pipeline's settings, by group", () => {
	test("draws one block per model call, then the whole pipeline — with no counters", async () => {
		await open({}, adventureView())
		expect(blocks().map(headingOf)).toEqual([
			"Planner",
			"Narrator",
			"Voices",
			"State keeper",
			"Whole pipeline"
		])
		const text = host.textContent ?? ""
		expect(text).not.toMatch(/step \d+ of \d+/i)
		expect(text).not.toMatch(/\d+ more settings?/i)
		expect(text).not.toMatch(/Also configured here/)
		expect(text).not.toMatch(/per-step tuning/)
		for (const h of blocks().map(headingOf)) expect(h).not.toMatch(/\d/)
	})

	test("fronts Prompt, Model and Sampling, and never a second Model control", async () => {
		await open({}, adventureView())
		const [planner] = blocks()
		const front = planner!.querySelector<HTMLElement>("[data-group-front]")!
		expect(labelsIn(front)).toEqual(["Prompt", "Model", "Sampling"])
		expect(host.textContent).not.toMatch(/\bPrompts\b/)
		// One Model control: the grouped pair picker.
		expect(front.querySelectorAll('input[role="combobox"]')).toHaveLength(3)
	})

	test("the Model's first choice is the server's inherits line, and choosing it resets", async () => {
		await open({}, adventureView())
		const [planner] = blocks()
		const model = planner!.querySelector<HTMLInputElement>('[data-option-row="connection-ref"] input[role="combobox"]')!
		expect(model.value).toBe("Pub default — KoboldCpp · Nemo 12B")

		// One list: the connections are its groups, their models its rows.
		planner!
			.querySelector<HTMLButtonElement>('[data-option-row="connection-ref"] button[aria-label="Show Model options"]')!
			.click()
		await settle()
		const rows = [
			...document.querySelectorAll<HTMLElement>('[role="listbox"][data-state="open"] [role="option"]')
		]
		expect(rows.map((r) => r.textContent!.replace(/\s+/g, " ").trim())).toEqual([
			"Pub default — KoboldCpp · Nemo 12B",
			"Nemo 12B",
			"Qwen 7B",
			// A connection that cannot do this call is listed, with why.
			"Claude Can't do text output."
		])
		// Picking a model writes the pair in one go.
		rows[2]!.click()
		await settle()
		expect(client.emits.find((e) => e.event === "pipelines:setOption")?.payload.value).toEqual({
			ref: 1,
			modelId: 12
		})
	})

	test("says where each model and sampling value came from, with Reset where it was set here", async () => {
		await open({}, adventureView())
		const [planner, narrator] = blocks()
		const sampling = planner!.querySelector<HTMLElement>('[data-option-row="sampling-ref"]')!
		const line = sampling.querySelector<HTMLElement>("[data-provenance]")!
		expect(line.textContent).toContain("Set in this configuration")
		expect(line.querySelector("[data-changed-dot]")).not.toBeNull()
		const reset = [...line.querySelectorAll("button")].find((b) => /Reset/.test(b.textContent ?? ""))!
		reset.click()
		await settle()
		expect(client.emits.some((e) => e.event === "pipelines:clearOption")).toBe(true)
		const other = narrator!.querySelector<HTMLElement>('[data-option-row="sampling-ref"] [data-provenance]')!
		expect(other.textContent).toContain("Pub default")
		expect([...other.querySelectorAll("button")].some((b) => /Reset/.test(b.textContent ?? ""))).toBe(false)
	})

	test("puts the model call's switch in the block header, named by the block, reading On", async () => {
		await open({}, adventureView())
		const [planner, narrator] = blocks()
		const sw = planner!.querySelector<HTMLInputElement>('header input[role="switch"]')!
		expect(sw.getAttribute("aria-label")).toBe("Planner")
		expect(sw.checked).toBe(true)
		expect(planner!.querySelector("header")!.textContent).toContain("On")
		expect(narrator!.querySelector('header input[role="switch"]')).toBeNull()
		expect(planner!.querySelector("[data-group-purpose]")!.textContent).toContain("Decides what happens next")
	})

	test("folds everything else into one Advanced per block, a fieldset per step", async () => {
		await open({}, adventureView())
		const [planner, , , , whole] = blocks()
		const folds = planner!.querySelectorAll("details")
		expect(folds).toHaveLength(1)
		expect(folds[0]!.querySelector("summary")!.textContent!.replace(/\s+/g, " ").trim()).toBe(
			"Advanced · 3 settings · 1 changed"
		)
		expect([...folds[0]!.querySelectorAll("fieldset > legend")].map((l) => l.textContent!.trim())).toEqual([
			"Plan the turn",
			"Build context"
		])
		expect(whole!.querySelector("summary")!.textContent!.replace(/\s+/g, " ").trim()).toBe(
			"Advanced · 1 setting"
		)
		expect(labelsIn(whole!.querySelector("[data-group-front]")!)).toEqual(["World lore"])
	})
})

describe("inside a session's settings", () => {
	test("is a card titled by the pipeline, with front rows only and the model read-only", async () => {
		await open({ sessionId: 9, mode: "session", title: "Adventure turn" }, adventureSessionView(9))
		const card = host.querySelector<HTMLElement>("[data-pipeline-card]")!
		expect(card.querySelector("[data-card-title]")!.textContent!.trim()).toBe("Adventure turn")
		expect(host.querySelectorAll("details")).toHaveLength(0)
		// Whole pipeline has nothing a session draws.
		expect(blocks().map(headingOf)).toEqual(["Planner", "Narrator", "Voices", "State keeper"])
		const model = blocks()[0]!.querySelector<HTMLElement>('[data-option-row="connection-ref"]')!
		expect(model.querySelector('input[role="combobox"]')).toBeNull()
		expect(model.textContent).toContain("KoboldCpp · Nemo 12B")
		expect(model.textContent).toContain("From the “Adventure” configuration")
		expect(model.textContent).toContain("Change in Pipelines")
		expect(host.textContent).toContain("More settings in Pipelines")
	})

	test("shows a non-admin a prompt-bearing card: their prompts, no model, no admin links", async () => {
		setInterestUser({ id: 1, isAdmin: false })
		await open({ sessionId: 9, mode: "session", title: "Adventure turn" }, nonAdminSessionView(9), false)
		const card = host.querySelector<HTMLElement>("[data-pipeline-card]")!
		expect(card).toBeTruthy()
		expect(card.querySelector("[data-card-title]")!.textContent!.trim()).toBe("Adventure turn")
		expect(card.querySelectorAll('[data-option-row="prompts-ref"]')).toHaveLength(4)
		expect(card.querySelector('[data-option-row="connection-ref"]')).toBeNull()
		expect(labelsIn(card)).not.toContain("Model")
		expect(host.textContent).not.toContain("Change in Pipelines")
		expect(host.textContent).not.toContain("More settings in Pipelines")
		expect(host.textContent).not.toContain("Set by an administrator")
	})

	test("draws no card for a pipeline with nothing a session sets", async () => {
		await open({ sessionId: 9, mode: "session", title: "Answer" }, emptySessionView(9))
		expect(host.querySelector("[data-pipeline-card]")).toBeNull()
		expect(host.textContent?.trim()).toBe("")
	})

	test("takes no view of another scope for the same pipeline", async () => {
		await open({ sessionId: 9, mode: "session", title: "Adventure turn" }, adventureSessionView(9))
		client.dispatch("pipelines:get", { pipeline: adventureView({ groups: [] }) })
		await settle()
		expect(blocks()).toHaveLength(4)
	})
})

describe("a session's creation pipeline (owner ruling 2026-09-30)", () => {
	const NOTE = "This session has been created; these settings only applied while creating it."

	test("once created, its card starts collapsed, every row read-only, with one note saying why", async () => {
		await open(
			{ sessionId: 9, mode: "session", title: "Create adventure" },
			creationSessionView(9, NOTE)
		)
		const card = host.querySelector<HTMLElement>("[data-pipeline-card]")!
		expect(card.tagName).toBe("DETAILS")
		expect((card as HTMLDetailsElement).open).toBe(false)
		expect(card.querySelector("[data-card-title]")!.textContent!.trim()).toBe("Create adventure")

		;(card as HTMLDetailsElement).open = true
		await settle()
		const notes = [...card.querySelectorAll("[data-scope-note]")]
		expect(notes.map((n) => n.textContent!.trim())).toEqual([NOTE])
		// No control to change anything: names, never inputs.
		expect(card.querySelectorAll('input[role="combobox"], textarea, select')).toHaveLength(0)
		expect(card.querySelectorAll('[data-option-row]').length).toBeGreaterThan(0)
		// The note says why; no row sends anyone elsewhere to change it.
		expect(card.textContent).not.toContain("Set by an administrator")
		expect(card.textContent).not.toContain("Change in Pipelines")
	})

	test("while creating, it is an ordinary card: open and editable, with no note", async () => {
		await open(
			{ sessionId: 9, mode: "session", title: "Create adventure" },
			creationSessionView(9)
		)
		const card = host.querySelector<HTMLElement>("[data-pipeline-card]")!
		expect(card.tagName).toBe("SECTION")
		expect(card.querySelector("[data-scope-note]")).toBeNull()
		expect(card.querySelectorAll('input[role="combobox"]').length).toBeGreaterThan(0)
	})

	test("in the sidebar, the scope note says why the session's values are read-only", async () => {
		await open({ sessionId: 9 }, creationSessionView(9, NOTE))
		expect(host.querySelector("[data-scope-note]")!.textContent!.trim()).toBe(NOTE)
		expect(host.querySelectorAll('input[role="combobox"]')).toHaveLength(0)
	})
})

describe("the sidebar's scope inside a session (owner Q7)", () => {
	test("writes at session scope only for a pipeline the session runs", () => {
		const runs = new Set(["core:spec/adventure-respond"])
		expect(sessionScopeFor("core:spec/adventure-respond", 9, runs)).toBe(9)
		expect(sessionScopeFor("core:spec/summarize", 9, runs)).toBeUndefined()
		expect(sessionScopeFor("core:spec/adventure-respond", undefined, runs)).toBeUndefined()
	})

	test("says a pipeline the session does not run is the configuration's", async () => {
		await open({ sessionDoesNotRun: true }, adventureView())
		expect(host.textContent).toContain("This session does not run this pipeline")
		expect(host.textContent).toContain("everyone using the “Adventure” configuration")
	})

	test("says so read-only for someone who is not an administrator", async () => {
		setInterestUser({ id: 1, isAdmin: false })
		await open({ sessionDoesNotRun: true }, adventureView(), false)
		expect(host.textContent).toContain("This session does not run this pipeline")
		expect(host.textContent).toContain("Only an administrator can change it")
	})
})
