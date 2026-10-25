/**
 * `AvatarPicker` — the one control that chooses an identity picture (a
 * character's avatar, an account's, a lorebook's cover image). The tile is
 * the upload control; a picked file is held and previewed and opens the crop
 * editor; with `onCommit` (a card with no save of its own) the editor's
 * Cancel means "not this one".
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const { emitted, socket } = vi.hoisted(() => {
	const emitted: Array<[string, any]> = []
	return {
		emitted,
		socket: {
			emit: (event: string, data: any) => {
				emitted.push([event, data])
			}
		}
	}
})

vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { success: () => {}, error: () => {}, info: () => {} }
}))

import AvatarPicker from "./AvatarPicker.svelte"

let app: Record<string, any> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	emitted.length = 0
	document.body.innerHTML = ""
})

const tile = () => document.querySelector("[data-avatar-picker] > button")
const buttonNamed = (text: string) =>
	[...document.querySelectorAll("button")].find(
		(b) => (b.textContent ?? "").trim() === text
	)

async function pickFile(name = "cover.png") {
	const input = document.querySelector(
		'input[type="file"]'
	) as HTMLInputElement
	const file = new File([new Uint8Array([137, 80, 78, 71])], name, {
		type: "image/png"
	})
	Object.defineProperty(input, "files", { value: [file], configurable: true })
	input.dispatchEvent(new Event("change", { bubbles: true }))
	// FileReader answers on a later task.
	await new Promise((r) => setTimeout(r, 20))
	flushSync()
	await tick()
	return file
}

describe("AvatarPicker", () => {
	test("the tile shows the stored picture and says what it chooses", () => {
		const props = $state({
			src: "/media/abc?r=1",
			noun: "cover",
			shape: "square" as const
		})
		app = mount(AvatarPicker, { target: document.body, props })
		flushSync()
		expect(tile()?.getAttribute("aria-label")).toBe(
			"Choose a cover image, or drop one here"
		)
		expect(
			document
				.querySelector("[data-avatar-picker]")
				?.getAttribute("data-avatar-picker")
		).toBe("square")
		expect(
			document
				.querySelector("[data-avatar-picker] img")
				?.getAttribute("src")
		).toBe("/media/abc?r=1")
	})

	test("an account's picker is round and names an avatar", () => {
		const props = $state({ shape: "round" as const })
		app = mount(AvatarPicker, { target: document.body, props })
		flushSync()
		expect(tile()?.getAttribute("aria-label")).toBe(
			"Choose an avatar image, or drop one here"
		)
		expect(tile()?.className.includes("rounded-full")).toBe(true)
	})

	test("a picked file is held and previewed, and opens the crop editor first", async () => {
		const props = $state<{
			file?: File
			preview: string
			subject: string
		}>({ file: undefined, preview: "", subject: "Atlas's cover" })
		app = mount(AvatarPicker, { target: document.body, props })
		flushSync()
		const file = await pickFile()
		expect(props.file === file).toBe(true)
		expect(props.preview.startsWith("data:")).toBe(true)
		expect(
			(document.body.textContent ?? "").includes("Crop Atlas's cover")
		).toBe(true)
		// Nothing is sent before the parent saves.
		expect(emitted).toEqual([])
	})

	test("with onCommit, the crop editor's Cancel drops the pick and sends nothing", async () => {
		const onCommit = vi.fn()
		const props = $state<{
			file?: File
			preview: string
			onCommit: typeof onCommit
		}>({
			file: undefined,
			preview: "",
			onCommit
		})
		app = mount(AvatarPicker, { target: document.body, props })
		flushSync()
		await pickFile()
		expect(props.file !== undefined).toBe(true)
		const cancel = buttonNamed("Cancel")
		expect(cancel !== undefined).toBe(true)
		cancel!.click()
		flushSync()
		await tick()
		expect(props.file === undefined).toBe(true)
		expect(props.preview).toBe("")
		expect(onCommit).not.toHaveBeenCalled()
	})

	test("a save that answers with no crop held sends no crop", () => {
		const props = $state({})
		app = mount(AvatarPicker, { target: document.body, props })
		flushSync()
		app.commitPendingFrame(42)
		expect(emitted).toEqual([])
	})
})
