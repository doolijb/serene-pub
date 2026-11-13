/**
 * The W4 row under a step's context template (variable layouts, 2026-11-10):
 * no per-step layout picker any more, one line pointing at the pub's layouts,
 * and the leftover picks with their two ways out. Admin-only.
 *
 * No context-template option carries a `contextTemplate` row, so no
 * CodeMirror editor mounts.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
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

function templateView(): Sockets.Pipelines.NamespaceDetail {
	const group: Sockets.Pipelines.SettingsGroup = {
		key: "g0",
		kind: "model-call",
		front: [
			option({
				id: "ctx",
				label: "Context template",
				control: "context-template-ref",
				choices: [],
				step: { key: "694ff0a079d37191", heading: "Respond" }
			}),
			// A stray one from an old server: no branch draws it any more (the generic
			// select would, if it came with choices).
			option({
				id: "stray",
				label: "Layout",
				control: "variable-template-ref" as never,

				step: { key: "694ff0a079d37191", heading: "Respond" }
			})
		],
		advanced: [],
		changedInAdvanced: 0
	}
	return adventureView({ groups: [group] })
}

async function open(isAdmin = true) {
	setInterestUser({ id: 1, isAdmin })
	const view = templateView()
	app = mount(PipelineConfigOptions, {
		target: host,
		props: { slug: view.slug } as any,
		context: new Map<string, unknown>([
			["userCtx", { user: { id: 1, isAdmin } }],
			["panelsCtx", panelsCtx]
		])
	})
	await settle()
	client.dispatch("pipelines:get", { pipeline: view })
	await settle()
	return view
}

const text = () => host.textContent!.replace(/\s+/g, " ")
const buttons = (label: string) =>
	[...host.querySelectorAll<HTMLButtonElement>("button")].filter(
		(b) => b.textContent!.trim() === label
	)
const emitted = (event: string) => client.emits.filter((e) => e.event === event)

const pick = (over: Record<string, unknown> = {}) => ({
	stepKey: "694ff0a079d37191",
	slot: "variables",
	key: "characters",
	variableId: "core:var/characters@1",
	variableLabel: "Characters",
	templateId: 5,
	layoutName: "JSON",
	scope: { kind: "instance" },
	...over
})
const step = (over: Record<string, unknown> = {}) => ({
	stepKey: "694ff0a079d37191",
	slot: "variables",
	contextTemplate: { id: 9, name: "Story string" },
	canMoveIntoTemplate: true,
	picks: [pick()],
	...over
})
const answer = (view: Sockets.Pipelines.NamespaceDetail, steps: unknown[]) =>
	client.dispatch("pipelines:leftoverPicks", { slug: view.slug, steps })

describe("leftover lines name their step and level", () => {
	test("a line from another step names that step", async () => {
		const view = await open()
		answer(view, [
			step({
				stepKey: "aaaa111122223333",
				stepHeading: "Build the prompt"
			})
		])
		await settle()
		expect(text()).toContain(
			"Characters uses JSON (set on Build the prompt before layouts moved)."
		)
		expect(text()).not.toContain("JSON here")
	})

	test("one variable at two levels names both; one level names none", async () => {
		const view = await open()
		answer(view, [
			step({
				picks: [
					pick({ scope: { kind: "genre", genreId: "g" } }),
					pick({
						layoutName: "Prose",
						scope: { kind: "preset", presetId: 3 },
						presetName: "Quick start"
					}),
					pick({
						key: "places",
						variableId: "core:var/places@1",
						variableLabel: "Places",
						layoutName: "List",
						scope: { kind: "instance" }
					})
				]
			})
		])
		await settle()
		expect(text()).toContain(
			"Characters uses the genre's JSON here (set before layouts moved)."
		)
		expect(text()).toContain(
			"Characters uses the Quick start preset's Prose here (set before layouts moved)."
		)
		expect(text()).toContain(
			"Places uses List here (set before layouts moved)."
		)
	})
})

describe("the layout row", () => {
	test("no per-step layout picker; an admin sees the shared-layouts line and the Change layouts link", async () => {
		const view = await open()
		expect(text()).not.toContain("Duplicate this layout")
		expect(
			host.querySelector(
				'[data-option-row="variable-template-ref"] input[role="combobox"]'
			)
		).toBeNull()
		expect(text()).toContain(
			"Each variable is written out by its variable layout, shared by every pipeline."
		)
		const link = [...host.querySelectorAll("a")].find(
			(a) => a.textContent!.trim() === "Change layouts"
		)!
		expect(link.getAttribute("href")).toBe(
			`/admin/variable-layouts?step=${encodeURIComponent(`${view.slug}:694ff0a079d37191`)}`
		)
	})

	test("asks for the leftover picks on mount", async () => {
		const view = await open()
		expect(emitted("pipelines:leftoverPicks")[0]?.payload).toMatchObject({
			slug: view.slug
		})
	})

	test("a pick reads in words; Remove this pick clears it, Move into the template moves", async () => {
		const view = await open()
		answer(view, [step()])
		await settle()
		expect(text()).toContain(
			"Characters uses JSON here (set before layouts moved)."
		)
		expect(buttons("Use the pub's")).toHaveLength(0)
		buttons("Remove this pick")[0]!.click()
		expect(
			emitted("pipelines:clearLeftoverPick")[0]?.payload
		).toMatchObject({
			slug: view.slug,
			scope: { kind: "instance" },
			stepKey: "694ff0a079d37191",
			slot: "variables",
			key: "characters"
		})
		expect(
			emitted("pipelines:clearLeftoverPick")[0]?.payload
		).not.toHaveProperty("nodeKey")
		client.dispatch("pipelines:clearLeftoverPick", {
			slug: view.slug,
			steps: [step()]
		})
		await settle()
		buttons("Move into the template")[0]!.click()
		expect(
			emitted("pipelines:moveLeftoversIntoTemplate")[0]?.payload
		).toMatchObject({
			slug: view.slug,
			stepKey: "694ff0a079d37191",
			slot: "variables"
		})
		expect(
			emitted("pipelines:moveLeftoversIntoTemplate")[0]?.payload
		).not.toHaveProperty("nodeKey")
	})

	test("a step that cannot move into its template offers no Move button", async () => {
		const view = await open()
		answer(view, [step({ canMoveIntoTemplate: false })])
		await settle()
		expect(buttons("Move into the template")).toHaveLength(0)
	})

	test("a no-reference refusal shows its words and an Owner slug field; sending again carries ownerSlug", async () => {
		const view = await open()
		answer(view, [step()])
		await settle()
		buttons("Move into the template")[0]!.click()
		await settle()
		const words =
			"‘JSON’ has no reference yet, and a template names a layout by its reference. Say whose name to file it under (your owner name, for example 'acme') and it will be given one."
		// Another view's refusal (another session) is not ours.
		client.dispatch("pipelines:moveLeftoversIntoTemplate:error", {
			slug: view.slug,
			sessionId: 99,
			code: "needs-owner-slug",
			error: words
		})
		await settle()
		expect(text()).not.toContain("has no reference yet")
		client.dispatch("pipelines:moveLeftoversIntoTemplate:error", {
			slug: view.slug,
			code: "needs-owner-slug",
			error: words
		})
		await settle()
		expect(text()).toContain("has no reference yet")
		const input = host.querySelector<HTMLInputElement>(
			'input[placeholder="acme"]'
		)!
		expect(input).not.toBeNull()
		expect(input.closest("label")?.textContent).toContain("Owner slug")
		const again = () => {
			const b = buttons("Move into the template")
			b[b.length - 1]!.click()
		}
		const type = async (v: string) => {
			input.value = v
			input.dispatchEvent(new Event("input", { bubbles: true }))
			await settle()
		}
		// Nothing typed or pressed: no problem shown yet.
		expect(host.querySelector("[id^=owner-slug-problem]")).toBeNull()
		await type("core")
		expect(text()).toContain("core is Serene Pub's own")
		expect(input.getAttribute("aria-describedby")).toBe(
			host.querySelector("[id^=owner-slug-problem]")!.id
		)
		again()
		await type("Bad Slug")
		again()
		expect(text()).toContain("lowercase letters and digits")
		expect(emitted("pipelines:moveLeftoversIntoTemplate")).toHaveLength(1)
		await type("myname")
		again()
		const moves = emitted("pipelines:moveLeftoversIntoTemplate")
		expect(moves).toHaveLength(2)
		expect(moves[1]!.payload.ownerSlug).toBe("myname")
		expect(toaster.error).not.toHaveBeenCalled()
	})

	test("an answer echoing another session, slug or preset is ignored; a refusal without the code does not ask for an owner", async () => {
		const view = await open()
		client.dispatch("pipelines:leftoverPicks", {
			slug: view.slug,
			sessionId: 7,
			steps: [step()]
		})
		client.dispatch("pipelines:leftoverPicks", {
			slug: "other",
			steps: [step()]
		})
		client.dispatch("pipelines:leftoverPicks", {
			slug: view.slug,
			presetId: 3,
			steps: [step()]
		})
		await settle()
		expect(buttons("Remove this pick")).toHaveLength(0)
		answer(view, [step()])
		await settle()
		buttons("Move into the template")[0]!.click()
		await settle()
		client.dispatch("pipelines:moveLeftoversIntoTemplate:error", {
			slug: view.slug,
			error: "That could not be moved."
		})
		await settle()
		expect(text()).toContain("That could not be moved.")
		expect(host.querySelector('input[placeholder="acme"]')).toBeNull()
	})

	test("a move that kept entries shows each why, and re-reads the view", async () => {
		const view = await open()
		answer(view, [step()])
		await settle()
		buttons("Move into the template")[0]!.click()
		await settle()
		const before = emitted("pipelines:get").length
		client.dispatch("pipelines:moveLeftoversIntoTemplate", {
			slug: view.slug,
			steps: [step({ picks: [pick({ key: "history" })] })],
			moved: [],
			kept: [
				{
					key: "history",
					why: "history is read inside a loop, so its pick stayed."
				}
			]
		})
		await settle()
		expect(text()).toContain(
			"history is read inside a loop, so its pick stayed."
		)
		expect(emitted("pipelines:get").length).toBe(before + 1)
	})

	test("Move waits for the template's unsaved changes, and sends nothing", async () => {
		const view = await open()
		answer(view, [step()])
		await settle()
		// templateDirty needs a draft on a template row, which this view does not carry:
		// the guard is the component's, so drive it directly.
		const { default: Row } = await import("./StepVariableLayouts.svelte")
		const target = document.createElement("div")
		document.body.append(target)
		const onmove = vi.fn()
		const row = mount(Row, {
			target,
			props: {
				href: "/x",
				steps: [step()] as never,
				stateOf: () => ({ needsOwner: false, kept: [], busy: false }),
				onclear: vi.fn(),
				onmove,
				templateUnsaved: true
			}
		})
		await settle()
		;[...target.querySelectorAll("button")]
			.find((b) => b.textContent!.trim() === "Move into the template")!
			.click()
		await settle()
		expect(onmove).not.toHaveBeenCalled()
		expect(
			target.querySelector('[role="alert"]')?.textContent?.trim()
		).toBe("Save or cancel your changes to the template first.")
		unmount(row)
	})

	test("a builder step's pick, with no template option of its own, shows under the only template option", async () => {
		const view = await open()
		answer(view, [
			step({
				stepKey: "b3c1e5d27a90f4ee",
				picks: [
					pick({
						stepKey: "b3c1e5d27a90f4ee",
						variableLabel: "Lore",
						layoutName: "Prose"
					})
				]
			})
		])
		await settle()
		expect(text()).toContain(
			"Lore uses Prose here (set before layouts moved)."
		)
	})
})

describe("a member", () => {
	test("sees none of it, and nothing is requested", async () => {
		await open(false)
		expect(text()).not.toContain("Change layouts")
		expect(text()).not.toContain("shared by every pipeline")
		expect(emitted("pipelines:leftoverPicks")).toHaveLength(0)
		expect(emitted("pipelines:templateVariableLayouts")).toHaveLength(0)
	})
})
