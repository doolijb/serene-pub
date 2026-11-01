/**
 * audio.cpp's Models tab: grouping, the recommended row first with its reason,
 * guessed rows offer Confirm family (never Enable), Get emits downloadPackage,
 * a progress push shows bytes on the row.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
const emitted: Array<[string, any]> = []
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({
		emit: (event: string, payload: unknown) =>
			emitted.push([event, payload])
	})
}))
const handlers = new Map<string, (p: any) => void>()
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	useInterest: (event: string, handler: (p: any) => void) => {
		handlers.set(event, handler)
	},
	onConnect: () => () => {}
}))

const opened: any[] = []
const digest: Record<string, any> = {}
const panelsCtx = { digest, openPanel: (o: any) => opened.push(o) }

import AudioCppModelsTab from "./AudioCppModelsTab.svelte"

const base = {
	files: [],
	tags: [],
	confidence: "listed",
	state: "available",
	recommended: false
}
const PACKAGES = [
	{ ...base, id: "qwen3_tts_1_7b_customvoice_q8_0", name: "Qwen3-TTS 1.7B", task: "tts", family: "qwen3_tts", variant: "customvoice", sizeBytes: 2_800_000_000, recommendedVram: 6, state: "downloaded" },
	{ ...base, id: "kokoro_82m_q8_0", name: "Kokoro 82M", task: "tts", family: "kokoro_tts", recommendedVram: 0, recommended: true, reason: "Runs well on CPU", precision: "q8_0", state: "downloaded" },
	{ ...base, id: "kokoro_82m_bf16", name: "Kokoro 82M bf16", task: "tts", family: "kokoro_tts", precision: "bf16" },
	{ ...base, id: "kcpp_tts_1", name: "KoboldCPP voice", task: "tts", family: "kokoro_tts", runtime: "koboldcpp", state: "downloaded" },
	{ ...base, id: "parakeet_tdt_0_6b_v3_q8_0", name: "Parakeet TDT 0.6B", task: "asr", family: "parakeet_tdt", recommended: true, state: "enabled" },
	{ ...base, id: "guess1", name: "Mystery Voice", task: "tts", family: "qwen3_tts", confidence: "guessed", state: "downloaded", localDir: "/m/mystery" },
	{ ...base, id: "unk1", name: "Odd Thing", task: "tts", family: "", state: "downloaded", localDir: "/m/odd" }
]

let app: any
let target: HTMLElement
beforeEach(() => {
	emitted.length = 0
	opened.length = 0
	delete digest.modelsFinder
	handlers.clear()
	target = document.createElement("div")
	document.body.appendChild(target)
	app = mount(AudioCppModelsTab, {
		target,
		props: { connectionId: 7 },
		context: new Map([["panelsCtx", panelsCtx]])
	})
	flushSync()
	handlers.get("audiocpp:listPackages")!({ packages: PACKAGES })
	flushSync()
})
afterEach(() => {
	unmount(app)
	target.remove()
})

const text = () => target.textContent ?? ""
const buttons = (scope: Element) =>
	Array.from(scope.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim())
const rowEl = (id: string) => target.querySelector(`[data-package="${id}"]`)!

describe("AudioCppModelsTab", () => {
	test("asks for the list on mount", () => {
		expect(emitted.some(([e]) => e === "audiocpp:listPackages")).toBe(true)
	})

	test("Speech before Transcription, families as subheadings", () => {
		const heads = Array.from(target.querySelectorAll("h3")).map((h) => h.textContent?.trim())
		expect(heads).toEqual(["Speech", "Transcription"])
		const subs = Array.from(target.querySelectorAll("h4")).map((h) => h.textContent?.trim())
		expect(subs).toEqual(["Kokoro", "Qwen3-TTS", "Unknown family", "Parakeet-TDT"])
	})

	test("the recommended row carries its reason and CPU-fine", () => {
		const k = rowEl("kokoro_82m_q8_0")
		expect((k.textContent ?? "").includes("Runs well on CPU")).toBe(true)
		expect((k.textContent ?? "").includes("CPU-fine")).toBe(true)
		expect((k.textContent ?? "").includes("Q8_0")).toBe(true)
		expect((rowEl("qwen3_tts_1_7b_customvoice_q8_0").textContent ?? "").includes("Wants 6 GB VRAM")).toBe(true)
	})

	test("a guessed row offers Confirm family and no Enable", () => {
		const b = buttons(rowEl("guess1"))
		expect(b).toContain("Confirm family")
		expect(b.includes("Enable")).toBe(false)
		expect(buttons(rowEl("qwen3_tts_1_7b_customvoice_q8_0"))).toContain("Enable")
		expect(buttons(rowEl("parakeet_tdt_0_6b_v3_q8_0"))).toContain("Disable")
	})

	test("an unknown-family row cannot be enabled; it offers Confirm family and says why", () => {
		const el = rowEl("unk1")
		expect(buttons(el).includes("Enable")).toBe(false)
		expect(buttons(el)).toContain("Confirm family")
		expect((el.textContent ?? "").includes("before it can be enabled")).toBe(true)
	})

	test("catalogue-only and KoboldCPP-runtime rows are not listed", () => {
		expect(target.querySelector('[data-package="kokoro_82m_bf16"]') === null).toBe(true)
		expect(target.querySelector('[data-package="kcpp_tts_1"]') === null).toBe(true)
	})

	test("no Get button anywhere; Get more… opens the finder on this connection", () => {
		expect(buttons(target).includes("Get")).toBe(false)
		const door = target.querySelector("[data-get-more]") as HTMLButtonElement
		door.click()
		expect(digest.modelsFinder).toEqual({ connectionId: 7, capability: "text->audio" })
		expect(opened[0].key).toBe("models")
	})

	test("a progress push shows bytes on the row", () => {
		handlers.get("audiocpp:packageDownloadProgress")!({
			downloads: {
				kokoro_82m_q8_0: { packageId: "kokoro_82m_q8_0", name: "Kokoro", status: "downloading", downloaded: 120_000_000, total: 1_200_000_000, isDone: false, filesDone: 0, filesTotal: 1 }
			}
		})
		flushSync()
		const t = rowEl("kokoro_82m_q8_0").textContent ?? ""
		expect(t.includes("Arriving")).toBe(true)
		expect(t.includes("120 MB of 1.2 GB")).toBe(true)
		expect(buttons(rowEl("kokoro_82m_q8_0"))).toContain("Cancel")
	})
})
