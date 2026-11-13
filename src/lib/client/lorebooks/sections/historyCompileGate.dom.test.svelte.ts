/**
 * 🚧 Compile for an entry whose day has scenes not yet compiled (playtest 2,
 * S3). The row menu and the entry's scene list enable Compile when the row
 * carries `unfiledSceneCount`, not only when scenes are already filed.
 *
 * ⚠ No DOM node is ever handed to `expect`.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

const { pool } = vi.hoisted(() => ({
	pool: {
		filed: [] as any[],
		opened: [] as any[]
	}
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({ emit: () => {} })
}))
vi.mock("./poolContext", () => ({
	getLorePoolCtx: () => ({
		scenesOf: () => pool.filed,
		compileActivityOf: () => undefined,
		openCompile: (e: any) => void pool.opened.push(e),
		openProcess: () => {},
		onNavigateToGraph: undefined
	})
}))

import HistoryRowMenu from "./HistoryRowMenu.svelte"
import HistorySceneList from "./HistorySceneList.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	pool.filed = []
	pool.opened = []
})
function show(component: any, props: Record<string, unknown>) {
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(component, { target: host, props })
	flushSync()
}
const norm = (s: string | null | undefined) =>
	(s ?? "").replace(/\s+/g, " ").trim()
const button = () =>
	document.querySelector("button") as HTMLButtonElement | null
const scene = {
	id: 1,
	name: "A",
	summary: "s",
	selectedMessageIds: [],
	graphed: false
}

describe("the row menu's Compile", () => {
	test("no filed scenes and none waiting: disabled, says to capture first", () => {
		show(HistoryRowMenu, { source: { id: 5 }, close: () => {} })
		expect(button()!.disabled).toBe(true)
		expect(button()!.title).toBe("Capture scenes first")
	})
	test("scenes waiting for the day: enabled, opens the compile", () => {
		const source = { id: 5, unfiledSceneCount: 2 }
		show(HistoryRowMenu, { source, close: () => {} })
		expect(button()!.disabled).toBe(false)
		expect(button()!.title).toBe("")
		button()!.click()
		expect(pool.opened).toEqual([source])
	})
	test("filed scenes: as before", () => {
		pool.filed = [scene]
		show(HistoryRowMenu, { source: { id: 5 }, close: () => {} })
		expect(button()!.disabled).toBe(false)
		expect(norm(button()!.textContent)).toBe("Compile to Entry")
	})
})

describe("the entry's scene list", () => {
	test("nothing filed, nothing waiting: today's sentence, no button", () => {
		show(HistorySceneList, { entry: { id: 5 } })
		expect(norm(document.querySelector("p")!.textContent)).toBe(
			"No scenes captured for this entry yet. Capture scenes from the session page."
		)
		expect(button()).toBe(null)
	})
	test("two waiting: the sentence counts them and Compile opens the entry", () => {
		const entry = { id: 5, unfiledSceneCount: 2 }
		show(HistorySceneList, { entry })
		expect(norm(document.querySelector("p")!.textContent)).toBe(
			"2 scenes not yet compiled for this day."
		)
		expect(norm(button()!.textContent)).toBe("Compile to Entry")
		button()!.click()
		expect(pool.opened).toEqual([entry])
	})
	test("one waiting reads singular", () => {
		show(HistorySceneList, { entry: { id: 5, unfiledSceneCount: 1 } })
		expect(norm(document.querySelector("p")!.textContent)).toBe(
			"1 scene not yet compiled for this day."
		)
	})
	test("filed scenes: listed, one Compile button", () => {
		pool.filed = [scene]
		show(HistorySceneList, { entry: { id: 5 } })
		expect(document.querySelector("[data-scene-id='1']") !== null).toBe(
			true
		)
		expect(
			document.querySelectorAll("button.preset-filled-primary-500").length
		).toBe(1)
	})
})
