/** The voice try-out control: request, clip, in-place refusal, who sees what. */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { listeners, listen, emitted, toasts } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	const emitted: Array<[string, any]> = []
	const toasts: string[] = []
	return {
		listeners,
		emitted,
		toasts,
		listen: (key: string, handler: (msg: any) => void) => {
			listeners.set(key, handler)
			return () => {
				if (listeners.get(key) === handler) listeners.delete(key)
			}
		}
	}
})
const socket = { emit: (e: string, p: any) => { emitted.push([e, p]) }, on: () => {}, off: () => {} }
vi.mock("$lib/client/sockets/loadSockets.client", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen,
	requestWithInterest: (k: string, _p: unknown, h: any) => listen(k, h)
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		error: (t: any) => toasts.push(String(t?.title ?? t)),
		info() {},
		success() {},
		warning() {}
	}
}))

import VoiceTryout from "./VoiceTryout.svelte"
import { VOICE_TRYOUT_SAMPLE_LINE } from "$lib/shared/speech/voiceTryout"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	listeners.clear()
	emitted.length = 0
	toasts.length = 0
})
;(URL as any).createObjectURL = () => "blob:clip"
;(URL as any).revokeObjectURL = () => {}
;(HTMLMediaElement.prototype as any).play = () => Promise.resolve()

const settle = async () => {
	for (let i = 0; i < 3; i++) {
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
	}
}
const render = (props: Record<string, unknown> = {}) => {
	app = mount(VoiceTryout, {
		target: document.body,
		props: {
			request: () => ({ voiceId: "af_heart", settings: { speed: 1.2, seed: 99 } }),
			mayPickVoice: true,
			designsVoice: false,
			...props
		}
	})
	flushSync()
}
const btn = (label: string) =>
	Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith(label)) as HTMLButtonElement | undefined
const sent = () => emitted.filter(([e]) => e === "voicebank:preview").map(([, p]) => p)

describe("VoiceTryout", () => {
	test("the line is prefilled with the sample", () => {
		render()
		expect((document.querySelector('input[maxlength="300"]') as HTMLInputElement).value).toBe(VOICE_TRYOUT_SAMPLE_LINE)
	})

	test("Try sends the request with the bound seed and a request id; the reply shows the clip", async () => {
		render({ seed: 5 })
		btn("Try")!.click()
		await settle()
		const p = sent()[0]
		expect(p.voiceId).toBe("af_heart")
		expect(p.settings).toEqual({ speed: 1.2, seed: 5 })
		expect(typeof p.requestId).toBe("string")
		expect(btn("Trying")?.disabled).toBe(true)
		listeners.get("voicebank:preview")!({ requestId: "other", mime: "audio/wav", bytes: "AQID", spokenAs: null, applied: [], ignored: [], notes: [] })
		await settle()
		expect(document.querySelector("audio") === null).toBe(true)
		listeners.get("voicebank:preview")!({ requestId: p.requestId, mime: "audio/wav", bytes: "AQID", spokenAs: { voice: "af", model: "kokoro" }, seed: 5, applied: [], ignored: [], notes: ["inflection not sent: x"] })
		await settle()
		expect(document.querySelector("audio") === null).toBe(false)
		expect(document.querySelector('[data-testid="speech-clip"]') === null).toBe(false)
		const text = document.body.textContent ?? ""
		expect(text.includes("Spoken as af · kokoro · seed 5")).toBe(true)
		expect(text.includes("inflection not sent: x")).toBe(true)
	})

	test("a refusal is said inline as an alert, with no toast", async () => {
		render()
		btn("Try")!.click()
		await settle()
		const id = sent()[0].requestId
		listeners.get("voicebank:preview:error")!({ error: "Nobody is speaking yet.", requestId: id })
		await settle()
		expect(document.querySelector('[role="alert"]')?.textContent?.includes("Nobody is speaking yet.")).toBe(true)
		expect(toasts.length).toBe(0)
	})

	test("members get Try but no Seed or Re-roll", () => {
		render({ mayPickVoice: false })
		expect(btn("Try") === undefined).toBe(false)
		expect(btn("Re-roll") === undefined).toBe(true)
		expect(document.querySelector('input[type="number"]') === null).toBe(true)
		expect(document.querySelector('[data-testid="voice-tryout-seed"]') === null).toBe(true)
	})

	test("the seed shows as a person chip and Copy confirms inline, no toast", async () => {
		const written: string[] = []
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText: async (t: string) => void written.push(t) },
			configurable: true
		})
		render({ seed: 355260212 })
		expect(document.querySelector('[data-testid="voice-tryout-seed"]')!.textContent!.trim()).toBe("person #355260212")
		btn("Copy")!.click()
		await settle()
		expect(written).toEqual(["355260212"])
		expect(document.body.textContent).toContain("Copied")
		expect(toasts.length).toBe(0)
	})

	test("Re-roll spins the dice once and the spin clears on animationend", async () => {
		render({ seed: 1 })
		btn("Re-roll")!.click()
		await new Promise((r) => requestAnimationFrame(() => r(null)))
		flushSync()
		const svg = btn("Re-roll")!.querySelector("svg")!
		expect(svg.classList.contains("tryout-spin")).toBe(true)
		svg.dispatchEvent(new Event("animationend"))
		flushSync()
		expect(btn("Re-roll")!.querySelector("svg")!.classList.contains("tryout-spin")).toBe(false)
	})

	test("Mood chips are toggles; the pressed one is sent", async () => {
		render({ takesDirection: true, seed: 2 })
		const chips = Array.from(document.querySelectorAll("button[aria-pressed]")) as HTMLButtonElement[]
		expect(chips[0].textContent!.trim()).toBe("None")
		expect(chips[0].getAttribute("aria-pressed")).toBe("true")
		chips[1].click()
		flushSync()
		expect(chips[1].getAttribute("aria-pressed")).toBe("true")
		expect(chips[1].className).toContain("preset-pressed")
		btn("Try")!.click()
		await settle()
		expect(sent()[0].inflection).toBe(chips[1].textContent!.trim())
	})

	test("the title is retargetable", () => {
		render({ title: "Try the narration voice" })
		expect(document.querySelector("h3")!.textContent).toBe("Try the narration voice")
	})

	test("Re-roll changes the seed and tries at once", async () => {
		render({ seed: 1 })
		btn("Re-roll")!.click()
		await settle()
		expect(sent().length).toBe(1)
		expect(sent()[0].settings.seed).not.toBe(1)
		expect(Number.isInteger(sent()[0].settings.seed)).toBe(true)
	})

	test("Mood shows only when direction is taken and the voice is not designed", () => {
		render({ takesDirection: true, designsVoice: true })
		expect(document.body.textContent?.includes("Mood")).toBe(false)
		unmount(app!)
		document.body.innerHTML = ""
		render({ takesDirection: true, designsVoice: false })
		expect(document.body.textContent?.includes("Mood")).toBe(true)
	})

	test("blocked disables Try and says why", () => {
		render({ blocked: "Pick a voice first." })
		expect(btn("Try")!.disabled).toBe(true)
		// A reason, not a failure: a quiet hint, never an alert.
		expect(document.querySelector('[data-testid="voice-tryout-blocked"]')?.textContent?.includes("Pick a voice first.")).toBe(true)
		expect(document.querySelector('[role="alert"]') === null).toBe(true)
	})
})
