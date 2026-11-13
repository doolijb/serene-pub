/**
 * 🚧 A summary the scene summaries routine saved says so on the scene's page:
 * one muted line, only for a `done` summary whose origin is `routine`.
 *
 * ⚠ No DOM node is ever handed to `expect`.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({ emit: () => {} })
}))
vi.mock("./poolContext", () => ({
	getLorePoolCtx: () => ({
		openProcess: () => {},
		onNavigateToGraph: undefined
	})
}))
// The form is not what is under test: a component that renders nothing.
vi.mock("./SceneForm.svelte", () => ({ default: () => {} }))

import SceneEditor from "./SceneEditor.svelte"

const LINE =
	"Summarized by itself. You can edit it, or turn this off under Routines."

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})
function show(source: Record<string, unknown>) {
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(SceneEditor, {
		target: host,
		// Only what the line under test reads; the form itself is stubbed.
		props: { draft: {}, source, bindings: [] } as any
	})
	flushSync()
}
const lines = () =>
	[...document.querySelectorAll("p")].map((p) =>
		(p.textContent ?? "").replace(/\s+/g, " ").trim()
	)

describe("a routine-saved summary on the scene's page", () => {
	test("done and saved by the routine: the line, muted", () => {
		show({
			id: 1,
			summary: "s",
			summaryStatus: "done",
			summaryOrigin: "routine"
		})
		expect(lines()).toContain(LINE)
		expect(document.querySelector("p")!.className).toContain(
			"text-surface-600-400"
		)
	})
	test("a person's save, a waiting review and a scene with no summary: no line", () => {
		show({
			id: 1,
			summary: "s",
			summaryStatus: "done",
			summaryOrigin: "person"
		})
		expect(lines()).not.toContain(LINE)
		unmount(app!)
		document.body.innerHTML = ""
		show({
			id: 1,
			summary: "s",
			summaryStatus: "done",
			summaryOrigin: null
		})
		expect(lines()).not.toContain(LINE)
		unmount(app!)
		document.body.innerHTML = ""
		show({
			id: 1,
			summary: "",
			summaryStatus: "review",
			summaryOrigin: "routine"
		})
		expect(lines()).not.toContain(LINE)
	})
})
