// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import TasksField from "./TasksField.svelte"
import type { TaskDecl, TaskSettingsV1 } from "@serene-pub/sdk"

const decls: TaskDecl[] = [
	{ key: "lore-retrieval", label: "Lore", group: "reply", kind: "prose", default: "full", reviewable: false },
	{ key: "attributes", label: "Attributes", group: "reckoning", kind: "both", default: "full" },
	{ key: "summary", label: "Summary", group: "sweep", kind: "prose", default: "full" },
	{ key: "side-cast", label: "Side cast", group: "voices", kind: "prose", default: "off", reviewable: false }
]

describe("TasksField", () => {
	it("draws every trigger group with its tasks, and writes a mode change as TaskSettingsV1", () => {
		const target = document.createElement("div")
		document.body.appendChild(target)
		let written: TaskSettingsV1 | null = null
		const app = mount(TasksField, { target, props: { decls, value: undefined, onchange: (v: TaskSettingsV1) => (written = v) } })
		flushSync()
		expect(target.querySelector('[data-testid="task-group-reply"]') === null).toBe(false)
		expect(target.querySelector('[data-testid="task-group-reckoning"]') === null).toBe(false)
		expect(target.querySelector('[data-testid="task-group-sweep"]') === null).toBe(false)
		expect(target.querySelector('[data-testid="task-group-voices"]') === null).toBe(false)
		expect(target.querySelector('[data-testid="task-row-summary"]') === null).toBe(false)
		expect(target.querySelector('[data-testid="task-bucket-5"]') === null).toBe(false)
		// Wait-for-round is on by default for the after-turn group.
		const wait = target.querySelector('[data-testid="task-group-reckoning"] input[type="checkbox"]') as HTMLInputElement
		expect(wait.checked).toBe(true)
		wait.checked = false
		wait.dispatchEvent(new Event("change", { bubbles: true }))
		flushSync()
		expect(written).toEqual({ v: 1, groups: { reckoning: { waitForRound: false } }, tasks: {} })
		unmount(app)
		target.remove()
	})

	it("a detached task sits in its own bucket; dropping it on the shared bucket puts it back", () => {
		const target = document.createElement("div")
		document.body.appendChild(target)
		let written: TaskSettingsV1 | null = null
		const value: TaskSettingsV1 = { v: 1, tasks: { attributes: { mode: "full", every: 3 } } }
		const app = mount(TasksField, { target, props: { decls, value, onchange: (v: TaskSettingsV1) => (written = v) } })
		flushSync()
		expect(target.querySelector('[data-testid="task-bucket-3"] [data-testid="task-row-attributes"]') === null).toBe(false)
		// Only a pressed handle arms the row (the app's row-drag rule).
		const handle = target.querySelector('[data-testid="task-handle-attributes"]') as HTMLElement
		handle.dispatchEvent(new Event("pointerdown", { bubbles: true }))
		flushSync()
		const row = target.querySelector('[data-testid="task-row-attributes"]') as HTMLElement
		expect(row.getAttribute("draggable")).toBe("true")
		row.dispatchEvent(new Event("dragstart", { bubbles: true }))
		const home = target.querySelector('[data-testid="task-group-reckoning"]') as HTMLElement
		home.dispatchEvent(new Event("drop", { bubbles: true }))
		flushSync()
		expect((written as TaskSettingsV1 | null)?.tasks?.attributes).toEqual({ mode: "full" })
		unmount(app)
		target.remove()
	})

	it("an unarmed row never drags, and the buckets sit right after After each turn", () => {
		const target = document.createElement("div")
		document.body.appendChild(target)
		const app = mount(TasksField, { target, props: { decls, value: undefined, onchange: () => {} } })
		flushSync()
		const row = target.querySelector('[data-testid="task-row-attributes"]') as HTMLElement
		expect(row.getAttribute("draggable")).toBe("false")
		const sweepSection = target.querySelector('[data-testid="task-group-sweep"]') as HTMLElement
		const reckoning = target.querySelector('[data-testid="task-group-reckoning"]') as HTMLElement
		expect(reckoning.nextElementSibling === sweepSection).toBe(true)
		unmount(app)
		target.remove()
	})
})
