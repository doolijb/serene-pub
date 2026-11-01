/** The Read aloud card: the segmented control, its one consequence line, the envoy list. */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { listeners, listen } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	return {
		listeners,
		listen: (key: string, handler: (msg: any) => void) => {
			listeners.set(key, handler)
			return () => listeners.delete(key)
		}
	}
})
vi.mock("$lib/client/sockets/loadSockets.client", () => ({ useTypedSocket: () => ({ emit() {}, on() {}, off() {} }) }))
vi.mock("$lib/client/sockets/typedSocket", () => ({ useTypedSocket: () => ({ emit() {}, on() {}, off() {} }) }))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen,
	requestWithInterest: (k: string, _p: unknown, h: any) => listen(k, h)
}))

import SpeechSettingsBlock from "./SpeechSettingsBlock.svelte"
import { SPEECH_FIELD_KEYS } from "$lib/shared/sessions/speechSettings"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	listeners.clear()
})

const field = (key: string, value: unknown, extra: Record<string, unknown> = {}) =>
	({ id: `genre:${key}`, address: { kind: "genre", key }, label: key, control: "text", value, editable: true, ...extra }) as any
const readAloud = (value: string, editable = true) => field(SPEECH_FIELD_KEYS.readAloud, value, { label: "Read replies aloud", editable })

const render = (props: Record<string, unknown>) => {
	app = mount(SpeechSettingsBlock, {
		target: document.body,
		props: { fields: {}, busy: () => false, refusal: () => null, onwrite: () => {}, ...props }
	})
	flushSync()
}
const modes = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="read-aloud-modes"] button'))

describe("Read aloud segmented control", () => {
	test("three modes in order, the current one pressed, one live consequence line", () => {
		render({ fields: { readAloud: readAloud("make") } })
		expect(modes().map((b) => b.textContent?.trim())).toEqual(["Off", "Make audio", "Make and play"])
		expect(modes().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"])
		const line = document.querySelector('[data-testid="read-aloud-line"]')!
		expect(line.getAttribute("aria-live")).toBe("polite")
		expect(line.textContent).toBe("Each reply gets audio you can play.")
	})
	test("pressing another mode writes it; pressing the current one writes nothing", () => {
		const onwrite = vi.fn()
		const f = readAloud("off")
		render({ fields: { readAloud: f }, onwrite })
		modes()[0].click()
		expect(onwrite).not.toHaveBeenCalled()
		modes()[2].click()
		expect(onwrite).toHaveBeenCalledWith(f, "play")
	})
	test("a read-only card shows the value and no buttons", () => {
		render({ fields: { readAloud: readAloud("play", false) } })
		expect(modes()).toHaveLength(0)
		expect(document.body.textContent).toContain("Make and play")
	})
	test("a refusal is said inline", () => {
		const f = readAloud("off")
		render({ fields: { readAloud: f }, refusal: (x: any) => (x === f ? "Nope." : null) })
		expect(document.querySelector('[role="alert"]')?.textContent).toBe("Nope.")
	})
})

/** The closed select's shown text: its input's value, once the combobox has settled. */
const shown = async (scope: string) => {
	await new Promise((r) => setTimeout(r, 30))
	flushSync()
	return (document.querySelector(scope + " input[role='combobox']") as HTMLInputElement | null)?.value ?? ""
}

describe("Narrator line", () => {
	const narrator = (value: string | null, editable = true) =>
		field(SPEECH_FIELD_KEYS.narratorVoice, value, { label: "Narrator voice", editable })
	test("admin blank: Narration's voice with the voice name", async () => {
		render({ fields: { narratorVoice: narrator(null) }, narratorLine: { voiceName: "Bruno", loadoutName: "Narration" }, isAdmin: true })
		expect(await shown('[data-setting="genre:' + SPEECH_FIELD_KEYS.narratorVoice + '"]')).toBe("Narration's voice (Bruno)")
		expect(document.querySelector('[data-testid="narrator-override"]')).toBeNull()
	})
	test("member blank: Pub narrator, no loadout word", async () => {
		render({ fields: { narratorVoice: narrator(null) }, narratorLine: { voiceName: "Bruno" } })
		const t = await shown('[data-setting="genre:' + SPEECH_FIELD_KEYS.narratorVoice + '"]')
		expect(t).toBe("Pub narrator (Bruno)")
		expect(document.body.textContent).not.toMatch(/loadout/i)
	})
	test("member read-only still reads Pub narrator", () => {
		render({ fields: { narratorVoice: narrator(null, false) }, narratorLine: { voiceName: "Bruno" } })
		expect(document.body.textContent).toContain("Pub narrator (Bruno)")
	})
	test("overridden: marked as an override", () => {
		render({ fields: { narratorVoice: narrator("mira") }, narratorLine: { voiceName: "Bruno" }, isAdmin: true })
		expect(document.querySelector('[data-testid="narrator-override"]')?.textContent).toContain("override")
	})
	test("no voice exists: said plainly", () => {
		render({ fields: { narratorVoice: narrator(null) }, narratorLine: { voiceName: null }, isAdmin: true })
		expect(document.body.textContent).toContain("No narrator voice yet")
	})
})

describe("Envoy voices", () => {
	const envoy = (fallback: any) => ({
		slug: "mascot",
		name: "Mascot",
		voice: field("speechEnvoyVoice:mascot", null, { label: "Voice" }),
		narrationVoice: field("speechEnvoyNarrationVoice:mascot", null, { label: "Narration voice" }),
		fallback
	})
	const labelFor = (fallback: any, isAdmin = true) => {
		render({ fields: { readAloud: readAloud("off") }, envoys: [envoy(fallback)], isAdmin })
		return shown('[data-envoy="mascot"] [data-setting="genre:speechEnvoyVoice:mascot"]')
	}
	const helpFor = () => document.querySelector('[data-envoy="mascot"] [data-setting="genre:speechEnvoyVoice:mascot"]')?.textContent ?? ""
	test("each fallback is said on the blank row", async () => {
		expect(await labelFor({ kind: "other-speakers", voiceName: "Mira" })).toBe("Other speakers: Mira")
		expect(helpFor()).toContain("Narration's pinned voice for everyone without their own.")
	})
	test("auto avoids the narrator", async () => {
		expect(await labelFor({ kind: "auto", voiceName: "Mira", reason: "avoids-narrator" })).toBe("Auto: Mira")
		expect(helpFor()).toContain("Avoids the narrator.")
	})
	test("auto shared", async () => {
		expect(await labelFor({ kind: "auto", voiceName: "Mira", reason: "shared" })).toBe("Auto: Mira")
		expect(helpFor()).toContain("Shared with another speaker — Narration has no unused voice.")
	})
	test("narrator fallback: admin gets the tip, member does not", async () => {
		expect(await labelFor({ kind: "narrator", voiceName: "Bruno" })).toBe("Auto: same as the narrator")
		expect(helpFor()).toContain("Add a second voice to Narration to give them their own.")
		if (app) unmount(app)
		app = null
		document.body.innerHTML = ""
		expect(await labelFor({ kind: "narrator", voiceName: "Bruno" }, false)).toBe("Auto: same as the narrator")
		expect(helpFor()).not.toContain("Narration")
	})
	test("a row shows the name; Details folds the narration pick, with no description fields", () => {
		render({ fields: { readAloud: readAloud("off") }, envoys: [envoy({ kind: "auto", voiceName: "Mira" })] })
		expect(document.querySelector('[data-envoy="mascot"]')?.textContent).toContain("Mascot")
		const toggle = document.querySelector<HTMLButtonElement>('button[aria-label="Details for Mascot"]')!
		expect(toggle.getAttribute("aria-expanded")).toBe("false")
		toggle.click()
		flushSync()
		expect(toggle.getAttribute("aria-expanded")).toBe("true")
		expect(document.getElementById(toggle.getAttribute("aria-controls")!)).not.toBeNull()
		expect(document.querySelector("textarea")).toBeNull()
		expect(document.querySelector('[data-setting="genre:speechEnvoyNarrationVoice:mascot"]')).not.toBeNull()
	})
	test("picking a voice is the one-click override and emits the write", async () => {
		const onwrite = vi.fn()
		const e = envoy({ kind: "auto", voiceName: "Mira" })
		render({ fields: { readAloud: readAloud("off") }, envoys: [e], onwrite })
		listeners.get("voicebank:pickable")?.({ voices: [{ key: "bruno", slug: "bruno", name: "Bruno", enabled: true }] })
		flushSync()
		document.querySelector<HTMLButtonElement>('[data-envoy="mascot"] button[data-part="trigger"]')!.click()
		await new Promise((r) => setTimeout(r, 50))
		flushSync()
		const item = Array.from(document.querySelectorAll<HTMLElement>('[data-part="item"]')).find((i) => i.textContent?.includes("Bruno"))
		expect(item).toBeTruthy()
		item!.click()
		await new Promise((r) => setTimeout(r, 30))
		expect(onwrite).toHaveBeenCalledWith(e.voice, "bruno")
	})
})
