/**
 * 🚧 The dated entry's Recompile for a day with scenes not yet compiled
 * (playtest 2, S3).
 *
 * ⚠ No DOM node is ever handed to `expect`.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$lib/client/components/lorebookForms/LoreContentField.svelte", () => ({
	default: () => {}
}))

import DatedEntryPanel from "./DatedEntryPanel.svelte"

let app: ReturnType<typeof mount> | null = null
let recompiled = 0
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	recompiled = 0
})
function show(source: Record<string, any>, scenes: any[]) {
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(DatedEntryPanel, {
		target: host,
		props: {
			source,
			isNew: false,
			draft: { content: "" },
			bindings: [],
			siblings: [],
			scenes,
			present: [],
			castName: (id: number) => `#${id}`,
			title: "Day",
			readIn: null,
			dirty: false,
			canSave: false,
			onSave: () => {},
			onClose: () => {},
			onRecompile: () => void recompiled++,
			onOpenScene: () => {}
		}
	})
	flushSync()
}
const norm = (s: string | null | undefined) =>
	(s ?? "").replace(/\s+/g, " ").trim()
const recompile = () =>
	[...document.querySelectorAll("button")].find(
		(b) => norm(b.textContent) === "Recompile"
	) as HTMLButtonElement
const italic = () =>
	norm(
		[...document.querySelectorAll("p.italic")]
			.map((p) => p.textContent)
			.find((t) => /compiled/.test(t ?? ""))
	)

describe("the dated entry's Recompile", () => {
	test("nothing filed, nothing waiting: disabled with today's words", () => {
		show({ id: 5 }, [])
		expect(recompile().disabled).toBe(true)
		expect(recompile().title).toBe("Capture a scene from a session first")
		expect(italic()).toBe(
			"Nothing was compiled into this entry. Capture a scene from a session and it lists here."
		)
	})
	test("two waiting: enabled, says so, and asks the lens to compile", () => {
		show({ id: 5, unfiledSceneCount: 2 }, [])
		expect(recompile().disabled).toBe(false)
		expect(recompile().title).toBe(
			"Compile this day's scenes into this entry"
		)
		expect(italic()).toBe("2 scenes not yet compiled for this day.")
		recompile().click()
		expect(recompiled).toBe(1)
	})
	test("one waiting reads singular", () => {
		show({ id: 5, unfiledSceneCount: 1 }, [])
		expect(italic()).toBe("1 scene not yet compiled for this day.")
	})
	test("filed scenes: as before", () => {
		show({ id: 5, unfiledSceneCount: 3 }, [{ id: 1, name: "A" }])
		expect(recompile().disabled).toBe(false)
		expect(recompile().title).toBe(
			"Compile these scenes into this entry again"
		)
		expect(
			norm(document.body.textContent).includes("not yet compiled")
		).toBe(false)
	})
})
