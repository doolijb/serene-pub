/** The loadout sheet's Voices card (text->audio only): lines, picker, writes, refusals, the door. */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
const emitted: Array<[string, any]> = []
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({
		emit: (event: string, payload: unknown) => emitted.push([event, payload]),
		on: () => {},
		off: () => {}
	})
}))
const listeners = new Map<string, Array<(msg: any) => void>>()
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (msg: any) => void) => {
		listeners.set(key, [...(listeners.get(key) ?? []), handler])
		return () => {}
	},
	useInterest: (key: string, handler: (msg: any) => void) => {
		listeners.set(key, [...(listeners.get(key) ?? []), handler])
	}
}))

import LoadoutSheet from "./LoadoutSheet.svelte"
import { summary } from "./loadoutFixtures"

const answer = (key: string, msg: any) => listeners.get(key)?.forEach((h) => h(msg))
const settle = async () => {
	for (let i = 0; i < 4; i++) {
		await tick()
		await new Promise((r) => setTimeout(r, 0))
	}
	flushSync()
}
const list = () =>
	({
		loadouts: [],
		transforms: [
			{ id: "text->text", label: "Chat", output: "text", defaultLoadoutId: 1 },
			{ id: "text->audio", label: "Narration", output: "audio", defaultLoadoutId: 2 }
		],
		canReply: false,
		samplingOptions: {}
	}) as unknown as Sockets.Loadouts.List.Response
const entry = (id: number, name: string, loadoutId: number | null, enabled = true) => ({
	id, name, slug: name.toLowerCase(), loadoutId, enabled
})
const mounted: ReturnType<typeof mount>[] = []
function open(over: Record<string, unknown>, extra: Record<string, unknown> = {}) {
	const app = mount(LoadoutSheet, {
		target: document.body,
		props: {
			loadout: summary({ id: 2, name: "Narration", transform: "text->audio", ...over } as any),
			list: list(),
			connections: [],
			onClose: () => {},
			...extra
		}
	})
	mounted.push(app)
	flushSync()
}
const ENTRIES = [entry(11, "Bruno", 2), entry(12, "Mira", 2), entry(13, "Ghost", 2, false), entry(21, "Other", 3)]

beforeEach(() => {
	emitted.length = 0
	listeners.clear()
})
afterEach(() => {
	for (const app of mounted.splice(0)) unmount(app)
	document.body.innerHTML = ""
})
const card = () => document.querySelector("[data-voice-card]")
const optionsOf = (input: HTMLInputElement) => {
	const id = input.getAttribute("aria-controls")
	const list = id ? document.getElementById(id) : null
	return list ? [...list.querySelectorAll<HTMLElement>('[role="option"]')] : []
}
const pick = async (line: "voice" | "others", label: string) => {
	const input = document.querySelector<HTMLInputElement>(`[data-voice-line="${line}"] input`)!
	input.focus()
	input.click()
	await settle()
	const opt = [...optionsOf(input)].find((o) =>
		(o.textContent ?? "").includes(label)
	)!
	opt.click()
	await settle()
}

describe("the Voices card", () => {
	test("appears only for a text->audio loadout", async () => {
		open({ transform: "text->text" })
		await settle()
		expect(card()).toBeNull()
		expect(emitted.some(([e]) => e === "voicebank:list")).toBe(false)
	})
	test("lists only this loadout's entries, off ones disabled, and no none option on Voice", async () => {
		open({ defaultVoiceId: 11 })
		await settle()
		expect(emitted.some(([e]) => e === "voicebank:list")).toBe(true)
		answer("voicebank:list", { voices: ENTRIES })
		await settle()
		const input = document.querySelector<HTMLInputElement>('[data-voice-line="voice"] input')!
		input.focus()
		input.click()
		await settle()
		const opts = optionsOf(input).map((o) => o.textContent?.trim() ?? "")
		expect(opts.some((t) => t.includes("Bruno"))).toBe(true)
		expect(opts.some((t) => t.includes("Mira"))).toBe(true)
		expect(opts.some((t) => t.includes("Ghost (off)"))).toBe(true)
		expect(opts.some((t) => t.includes("Other"))).toBe(false)
		expect(opts.some((t) => /none|auto/i.test(t))).toBe(false)
	})
	test("picking sends the right loadouts:update params", async () => {
		open({ defaultVoiceId: 11 })
		answer("voicebank:list", { voices: ENTRIES })
		await settle()
		await pick("voice", "Mira")
		expect(emitted.at(-1)).toEqual(["loadouts:update", { id: 2, defaultVoiceId: 12 }])
		answer("loadouts:update", { loadout: { id: 2 } })
		await settle()
		await pick("others", "Bruno")
		expect(emitted.at(-1)).toEqual(["loadouts:update", { id: 2, otherSpeakersVoiceId: 11 }])
	})
	test("Other speakers can go back to Auto (null)", async () => {
		open({ defaultVoiceId: 11, otherSpeakersVoiceId: 12 })
		answer("voicebank:list", { voices: ENTRIES })
		await settle()
		await pick("others", "Auto")
		expect(emitted.at(-1)).toEqual(["loadouts:update", { id: 2, otherSpeakersVoiceId: null }])
	})
	test("a refusal is said inline beside the line that asked", async () => {
		open({ defaultVoiceId: 11 })
		answer("voicebank:list", { voices: ENTRIES })
		await settle()
		await pick("voice", "Mira")
		answer("loadouts:update:error", { error: "That voice is not on this loadout." })
		await settle()
		const alert = document.querySelector('[data-voice-line="voice"] [role="alert"]')
		expect(alert?.textContent).toContain("not on this loadout")
		expect(document.querySelector('[data-voice-line="others"] [role="alert"]')).toBeNull()
	})
	test("no entries: the sentence and a door that names this loadout", async () => {
		const onAddVoice = vi.fn()
		open({}, { onAddVoice })
		answer("voicebank:list", { voices: [entry(21, "Other", 3)] })
		await settle()
		expect(card()?.textContent).toContain("No voices on this loadout yet.")
		expect(document.querySelector('[data-voice-line="others"]')).toBeNull()
		const door = [...card()!.querySelectorAll("button")].find((b) => /Add a voice/.test(b.textContent ?? ""))!
		door.click()
		expect(onAddVoice).toHaveBeenCalledWith(2)
	})
})
