/**
 * A preset's Variable layouts fieldset (W6): entries wait for the form's
 * Save, Save sends the difference as single writes, a declared preset reads
 * as words, and a dangling entry is said in words.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const { listeners, listen, emitted } = vi.hoisted(() => {
	const listeners = new Map<string, Set<(msg: any) => void>>()
	return {
		listeners,
		listen: (key: string, handler: (msg: any) => void) => {
			let set = listeners.get(key)
			if (!set) listeners.set(key, (set = new Set()))
			set.add(handler)
			return () => set!.delete(handler)
		},
		emitted: [] as Array<[string, any]>
	}
})
const socket = {
	emit: (event: string, payload: unknown) => emitted.push([event, payload]),
	on: () => {},
	off: () => {}
}
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: (key: string, handler: any) => {
		$effect(() => listen(key, handler))
	},
	requestWithInterest: (event: string, params: unknown, handler: any) => {
		emitted.push([event, params])
		return listen(event, handler)
	}
}))
// A plain <select> stands in for the combobox, which draws through a portal.
vi.mock("$lib/client/components/inputs/Select.svelte", () => ({
	default: (anchor: Comment, props: any) => {
		const el = document.createElement("select")
		el.setAttribute("aria-label", props.label)
		const opt = (label: string, value: string) => {
			const o = document.createElement("option")
			o.textContent = label
			o.value = value
			return o
		}
		el.append(opt("", ""))
		for (const o of props.options) el.append(opt(o.label, o.value))
		el.addEventListener("change", () => props.onValueChange?.(el.value, ""))
		anchor.before(el)
	}
}))

import PresetVariableLayouts from "./PresetVariableLayouts.svelte"

const VAR = "core:var/characters@1"
const VARS = [
	{
		variableId: VAR,
		label: "Characters",
		shelfLabel: "Cast",
		layoutCount: 2,
		inUse: {
			id: 1,
			name: "Prose",
			reference: "core/prose@1",
			reason: "default"
		}
	}
]
const view = (over: Record<string, unknown> = {}) => ({
	presetId: 7,
	editable: true,
	rows: [],
	dangling: [],
	candidates: [VAR],
	...over
})
const SAVED_ROW = {
	variableId: VAR,
	variableLabel: "Characters",
	reference: "core/titled-json@1",
	templateId: 5,
	layoutName: "Titled JSON",
	pubLayout: { templateId: 1, name: "Prose", chosen: false }
}

let app: Record<string, any> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	listeners.clear()
	emitted.length = 0
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}
function feed(key: string, msg: unknown) {
	for (const h of [...(listeners.get(key) ?? [])]) h(msg)
}
const button = (text: string) =>
	[...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
		b.textContent?.trim().startsWith(text)
	)

async function render(v: unknown) {
	const props = $state({ presetId: 7, dirty: false })
	app = mount(PresetVariableLayouts, { target: document.body, props })
	await settle()
	feed("pipelines:libraryVariables", { variables: VARS })
	feed("pipelines:presetVariableLayouts", v)
	await settle()
	return props
}

describe("a preset's Variable layouts fieldset", () => {
	test("Change a variable's layout offers only the variables the preset's pipelines render, and nothing before it answered", async () => {
		const optionsNow = () =>
			[...document.querySelectorAll("select option")]
				.map((o) => o.textContent)
				.filter(Boolean)
		const variables = [
			...VARS,
			{ ...VARS[0], variableId: "core:var/places@1", label: "Places" }
		]
		const open = async (answer: boolean) => {
			const props = $state({ presetId: 7, dirty: false })
			app = mount(PresetVariableLayouts, { target: document.body, props })
			await settle()
			feed("pipelines:libraryVariables", { variables })
			if (answer) feed("pipelines:presetVariableLayouts", view())
			await settle()
			button("Change a variable's layout")?.click()
			await settle()
		}
		await open(false)
		expect(optionsNow()).toEqual([])
		unmount(app!)
		app = null
		document.body.innerHTML = ""
		listeners.clear()
		await open(true)
		expect(optionsNow()).toEqual(["Characters"])
	})

	test("add: a picked layout waits for Save and is sent as one write", async () => {
		const props = await render(view())
		expect(document.body.textContent).toContain(
			"Uses the pub's layout for every variable."
		)
		button("Change a variable's layout")!.click()
		await settle()
		const select = document.querySelector<HTMLSelectElement>("select")!
		select.value = VAR
		select.dispatchEvent(new Event("change"))
		await settle()
		expect(emitted).toContainEqual([
			"pipelines:libraryVariable",
			{ variableId: VAR }
		])
		feed("pipelines:libraryVariable", {
			variable: {
				variableId: VAR,
				rows: [
					{
						id: 5,
						name: "Titled JSON",
						ownerLabel: "Serene Pub",
						reference: "core/titled-json@1",
						preview: "{}",
						previewError: null,
						inUse: false
					}
				]
			}
		})
		await settle()
		button("Titled JSON")!.click()
		await settle()
		const text = document.body.textContent ?? ""
		expect(text).toContain("Titled JSON")
		expect(text).toContain("Waiting for Save")
		expect(text).toContain("(pub's: Prose)")
		expect(props.dirty).toBe(true)
		const steps = (app as any).saveSteps()
		expect(steps).toHaveLength(1)
		expect(steps[0].label).toBe("Variable layouts: Characters")
		void steps[0].run().catch(() => {})
		expect(emitted).toContainEqual([
			"pipelines:setPresetVariableLayout",
			{ presetId: 7, variableId: VAR, reference: "core/titled-json@1" }
		])
	})

	test("remove: a saved row waits to be removed and is sent as null", async () => {
		const props = await render(view({ rows: [SAVED_ROW] }))
		expect(document.body.textContent).toContain("Titled JSON")
		button("Remove")!.click()
		await settle()
		expect(document.body.textContent).toContain(
			"Removed — waiting for Save"
		)
		expect(props.dirty).toBe(true)
		const steps = (app as any).saveSteps()
		void steps[0].run().catch(() => {})
		expect(emitted).toContainEqual([
			"pipelines:setPresetVariableLayout",
			{ presetId: 7, variableId: VAR, reference: null }
		])
		button("Put back")!.click()
		await settle()
		expect(props.dirty).toBe(false)
		expect((app as any).saveSteps()).toEqual([])
	})

	test("a preset declared in code reads as words", async () => {
		await render(view({ editable: false, rows: [SAVED_ROW] }))
		const text = document.body.textContent ?? ""
		expect(text).toContain("Characters")
		expect(text).toContain("Titled JSON")
		expect(text).toContain("(pub's: Prose)")
		expect(text).toContain("Clone it to change its variable layouts.")
		expect(button("Remove")).toBeUndefined()
		expect(button("Change a variable's layout")).toBeUndefined()
	})

	test("a dangling entry is named in a warning line", async () => {
		await render(
			view({ dangling: [{ variableId: VAR, reference: "gone/prose@1" }] })
		)
		const line = document.querySelector("[data-dangling-variable-layout]")!
		expect(line.textContent).toContain("Characters")
		expect(line.textContent).toContain("gone/prose@1")
		expect(line.textContent).toContain("The pub's layout is used.")
	})
})
