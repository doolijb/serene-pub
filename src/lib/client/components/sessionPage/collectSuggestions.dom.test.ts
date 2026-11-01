/**
 * The collect modal's declared mood picker (speech polish): an action's
 * `collects.text.suggestions` drawn as chips (a common row, then More), the
 * `preview` line, and `remember: 'session'` — for ANY action that declares
 * them (nothing here knows Say it as…).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import CollectModal from "./CollectModal.svelte"
import { previewLine, readRemembered, writeRemembered, type Collected, type ListedCollects } from "./collects"

const SAY = {
	name: "Say it as…",
	collects: {
		text: {
			need: "required",
			label: "How should it sound?",
			suggestions: [
				{ value: "joy", label: "Joy", icon: "smile", common: true },
				{ value: "anger", label: "Anger", icon: "flame", common: true },
				{ value: "pride", label: "Pride", icon: "award" }
			],
			remember: "session",
			preview: "“{subject}” — said with {value}"
		}
	} as ListedCollects
}
const KEY = "sp:collect:7:core:spec/speak-message#say-it-as"

let apps: ReturnType<typeof mount>[] = []
// An in-memory store: the jsdom storage here is not a complete Storage.
let store: Record<string, string> = {}
const memory = {
	getItem: (k: string) => (k in store ? store[k] : null),
	setItem: (k: string, v: string) => void (store[k] = String(v))
}
beforeEach(() => {
	store = {}
	vi.stubGlobal("localStorage", memory)
})
afterEach(() => {
	vi.unstubAllGlobals()
	for (const a of apps) unmount(a)
	apps = []
	document.body.innerHTML = ""
})

async function open(sent: Collected[], extra: { subject?: string; rememberKey?: string } = {}) {
	const host = document.createElement("div")
	document.body.append(host)
	apps.push(
		mount(CollectModal, {
			target: host,
			props: { open: true, action: SAY, onSubmit: (c: Collected) => sent.push(c), onCancel: () => {}, ...extra }
		})
	)
	flushSync()
	await tick()
}
const chip = (v: string) => document.querySelector<HTMLButtonElement>(`[data-collect-suggestion="${v}"]`)
const field = () => document.querySelector<HTMLTextAreaElement>("[data-collect-text]")!
const flush = async () => {
	flushSync()
	await tick()
}

describe("declared suggestions", () => {
	test("the common row shows first; More reveals the rest and says it is expanded", async () => {
		await open([])
		expect(chip("joy")).not.toBeNull()
		expect(chip("pride")).toBeNull()
		const more = document.querySelector<HTMLButtonElement>("[data-collect-more]")!
		expect(more.getAttribute("aria-expanded")).toBe("false")
		more.click()
		await flush()
		expect(chip("pride")).not.toBeNull()
		expect(more.getAttribute("aria-expanded")).toBe("true")
	})

	test("a chip fills the box, reads pressed, and a typed answer clears it", async () => {
		const sent: Collected[] = []
		await open(sent)
		chip("anger")!.click()
		await flush()
		expect(field().value).toBe("anger")
		expect(chip("anger")!.getAttribute("aria-pressed")).toBe("true")
		expect(chip("joy")!.getAttribute("aria-pressed")).toBe("false")
		field().value = "with a sigh"
		field().dispatchEvent(new Event("input", { bubbles: true }))
		await flush()
		expect(chip("anger")!.getAttribute("aria-pressed")).toBe("false")
		;(document.querySelector("[data-collect-submit]") as HTMLButtonElement).click()
		expect(sent).toEqual([{ text: "with a sigh", recipients: [] }])
	})

	test("the preview shows the line's first words and the value, only once there is a value", async () => {
		await open([], { subject: "The storm breaks over the hill…" })
		expect(document.querySelector("[data-collect-preview]")).toBeNull()
		chip("joy")!.click()
		await flush()
		expect(document.querySelector("[data-collect-preview]")?.textContent?.trim()).toBe(
			"“The storm breaks over the hill…” — said with joy"
		)
	})
})

describe("remember: 'session'", () => {
	test("submitting keeps the answer under the key; the next open starts from it", async () => {
		const sent: Collected[] = []
		await open(sent, { rememberKey: KEY })
		chip("pride")?.click()
		field().value = "pride"
		field().dispatchEvent(new Event("input", { bubbles: true }))
		await flush()
		;(document.querySelector("[data-collect-submit]") as HTMLButtonElement).click()
		expect(store[KEY]).toBe("pride")
		for (const a of apps) unmount(a)
		apps = []
		document.body.innerHTML = ""
		await open([], { rememberKey: KEY })
		expect(field().value).toBe("pride")
		expect(chip("joy")!.getAttribute("aria-pressed")).toBe("false")
	})

	test("blocked storage reads as nothing remembered and never throws", () => {
		vi.stubGlobal("localStorage", {
			getItem: () => {
				throw new Error("blocked")
			},
			setItem: () => {
				throw new Error("blocked")
			}
		})
		expect(readRemembered(KEY)).toBe("")
		expect(() => writeRemembered(KEY, "joy")).not.toThrow()
	})

	test("the subject is cleaned: emphasis marks gone, the excerpt's own quotes trimmed, the cut kept", () => {
		expect(
			previewLine(
				"“{subject}” — said with {value}",
				"“Well met, traveller,” she said. *She sets down a mug and sm…",
				"anger"
			)
		).toBe("“Well met, traveller,” she said. She sets down a mug and sm…” — said with anger")
	})

	test("previewLine draws nothing half-filled", () => {
		expect(previewLine("{subject} {value}", "", "joy")).toBe("")
		expect(previewLine("{subject} {value}", "Hi", " ")).toBe("")
		expect(previewLine(undefined, "Hi", "joy")).toBe("")
	})
})
