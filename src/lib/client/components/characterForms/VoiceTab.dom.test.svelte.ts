/** The card Speech tab: shared voice fields, plus a narrator override pick with its own try-out. */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
const { emitted } = vi.hoisted(() => ({ emitted: [] as Array<[string, any]> }))
const socket = { emit: (e: string, p: any) => { emitted.push([e, p]) }, on: () => {}, off: () => {} }
vi.mock("$lib/client/sockets/loadSockets.client", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: () => () => {},
	useInterest: () => () => {},
	requestWithInterest: (_k: string, _p: unknown, h: any) => {
		h({ voices: [{ slug: "bruno", name: "Bruno", language: "en", labels: {}, loadoutName: "Main", controls: null }, { slug: "ada", name: "Ada", language: "en", labels: {} }], controls: null })
		return () => {}
	}
}))

import VoiceTab from "./VoiceTab.svelte"
import { EMPTY_TIMBRE_DRAFT } from "./voiceTab"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	emitted.length = 0
})
const settle = async () => {
	for (let i = 0; i < 3; i++) {
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
	}
}
const render = (isAdmin: boolean, castMember?: { linked: boolean }) => {
	const props = $state({
		characterName: "Ada",
		castMember,
		timbre: { ...EMPTY_TIMBRE_DRAFT, voice: "bruno", narrationVoice: "ada", description: "warm", settings: {} }
	})
	app = mount(VoiceTab, {
		target: document.body,
		props,
		context: new Map([["userCtx", { user: { isAdmin } }]])
	})
	flushSync()
	return props
}
const tryNows = () => Array.from(document.querySelectorAll("button")).filter((b) => b.textContent?.trim() === "Try") as HTMLButtonElement[]

describe("VoiceTab", () => {
	test("Voice then Narrator blocks; narrator has no prose or settings fields", () => {
		render(true)
		const voice = document.querySelector('[data-testid="timbre-voice"]')!
		const narrator = document.querySelector('[data-testid="timbre-narrator"]')!
		expect(voice).toBeTruthy()
		expect(narrator).toBeTruthy()
		expect(narrator.querySelector("textarea")).toBeNull()
		expect(narrator.querySelector('input[type="number"]')).toBeNull()
		expect(narrator.textContent).toContain("Narrator")
		expect(narrator.textContent).toMatch(/narrator uses\s+its own settings/)
	})

	test("the narrator try sends the picked voice with no description", async () => {
		render(true)
		const narrator = document.querySelector('[data-testid="timbre-narrator"]')!
		const btn = Array.from(narrator.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Try") as HTMLButtonElement
		btn.click()
		await settle()
		const p = emitted.find(([e]) => e === "voicebank:preview")![1]
		expect(p.voice).toBe("ada")
		expect(p.description).toBeUndefined()
	})

	test("members see names read-only, no loadout name, no narrator try", () => {
		render(false)
		const narrator = document.querySelector('[data-testid="timbre-narrator"]')!
		expect(narrator.textContent).toContain("Ada")
		expect(document.body.textContent).not.toContain("Main")
		expect(Array.from(narrator.querySelectorAll("button")).some((b) => b.textContent?.trim() === "Try")).toBe(false)
		expect(tryNows().length).toBeLessThanOrEqual(1)
	})

	test("the card form keeps Travels with the card", () => {
		render(false)
		expect(document.body.textContent).toContain("Travels with the card.")
		expect(document.body.textContent).toContain("Who speaks for Ada when a line is read aloud.")
	})

	test("a linked member reads as an override, with no Travels line", () => {
		render(false, { linked: true })
		const text = document.body.textContent ?? ""
		expect(text).toContain("Ada's own voice in this book, used instead of the card's.")
		expect(text).not.toContain("Who speaks for")
		expect(text).not.toContain("Travels")
	})

	test("a card-less member keeps the plain header, with no Travels line", () => {
		render(false, { linked: false })
		const text = document.body.textContent ?? ""
		expect(text).toContain("Who speaks for Ada when a line is read aloud.")
		expect(text).not.toContain("Travels")
	})

	test("typing in the shared voice fields writes the bound timbre (getter/setter binding)", () => {
		const props = render(false)
		const desc = document.querySelector("#timbre-desc") as HTMLTextAreaElement
		const lang = document.querySelector("#timbre-lang") as HTMLInputElement
		desc.value = "a dry, quick tenor"
		desc.dispatchEvent(new Event("input", { bubbles: true }))
		lang.value = "ja"
		lang.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		expect(props.timbre.description).toBe("a dry, quick tenor")
		expect(props.timbre.language).toBe("ja")
		expect(desc.value).toBe("a dry, quick tenor")
	})

	test("admins see the picked voice's loadout name as a hint", () => {
		render(true)
		expect(document.body.textContent).toContain("Main")
	})
})
