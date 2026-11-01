/** Loadouts → Voices: grouped by loadout, ordering by name, chips, Try inline. */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { listeners, emitted, listen, socket } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	const emitted: Array<[string, any]> = []
	return {
		listeners,
		emitted,
		listen: (key: string, handler: (msg: any) => void) => {
			listeners.set(key, handler)
			return () => listeners.delete(key)
		},
		socket: { emit: (e: string, p: any) => { emitted.push([e, p]) }, on: () => {}, off: () => {} }
	}
})
vi.mock("$lib/client/sockets/loadSockets.client", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/typedSocket", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen,
	requestWithInterest: (k: string, _p: unknown, h: any) => listen(k, h)
}))
vi.mock("$lib/client/contexts/connections.svelte", () => ({
	useConnections: () => ({ listed: [], requestList() {} })
}))

import VoicebankPanel from "./VoicebankPanel.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	listeners.clear()
	emitted.length = 0
})

const voice = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
	id, slug: name.toLowerCase(), name, description: null, owner: "pub", seedKey: null, loadoutId: 1, loadoutName: "Narration", connectionModelId: 1,
	voiceId: `v${id}`, language: null, settings: {}, labels: {}, enabled: true, unusableReason: null, createdAt: "", updatedAt: "", ...extra
})
const loadouts = [
	{ id: 1, name: "Narration", connectionId: 5, connectionModelId: 1, connectionName: "KoboldCPP", modelName: "Kokoro", filled: true, isDefault: true }
]
const render = (voices: any[]) => {
	app = mount(VoicebankPanel, { target: document.body, props: {} })
	flushSync()
	listeners.get("voicebank:list")!({ voices, pairModelId: 1, loadouts })
	flushSync()
}
const rows = () => Array.from(document.querySelectorAll<HTMLElement>("li[data-voice]"))

describe("Voices panel", () => {
	test("rows are ordered by name", () => {
		render([voice(1, "Zed"), voice(2, "amy"), voice(3, "Bo")])
		expect(rows().map((r) => r.dataset.voice)).toEqual(["amy", "bo", "zed"])
	})
	test("no star or narration toggles; the row says nothing of a pub default", () => {
		render([voice(1, "Amy"), voice(2, "Bo")])
		expect(document.querySelector('button[aria-label*="default voice"]')).toBeNull()
		expect(document.querySelector('button[aria-label*="for narration"]')).toBeNull()
		expect(document.body.textContent).not.toMatch(/Narration voice|pub's default/)
	})
	test("rows group by loadout; the header shows Voice and Other speakers (Auto when unpinned)", () => {
		const two = [
			{ ...loadouts[0], defaultVoiceId: 2, otherSpeakersVoiceId: null },
			{ id: 2, name: "Sung", connectionId: 5, connectionModelId: 2, connectionName: "KoboldCPP", modelName: "X", filled: true, isDefault: false, defaultVoiceId: null, otherSpeakersVoiceId: null }
		]
		app = mount(VoicebankPanel, { target: document.body, props: {} })
		flushSync()
		listeners.get("voicebank:list")!({
			voices: [voice(1, "Amy"), voice(2, "Bo"), voice(3, "Cy", { loadoutId: 2, loadoutName: "Sung" }), voice(4, "Dee", { loadoutId: null, loadoutName: null })],
			pairModelId: 1,
			loadouts: two
		})
		flushSync()
		const groups = Array.from(document.querySelectorAll<HTMLElement>("[data-voice-group]"))
		expect(groups.map((g) => g.dataset.voiceGroup)).toEqual(["1", "2", "none"])
		const lines = groups[0].querySelector('[data-testid="group-lines"]')!.textContent!
		expect(lines).toContain("Voice: Bo")
		expect(lines).toContain("Other speakers: Auto")
		expect(groups[1].textContent).toContain("Voice: none yet")
		expect(groups[0].querySelector('[data-voice="bo"] [data-testid="voice-is-voice"]')).not.toBeNull()
		expect(groups[0].querySelector('[data-voice="amy"] [data-testid="voice-is-voice"]')).toBeNull()
	})
	test("a pinned Other speakers voice shows its name, and the header door opens that loadout", () => {
		const onOpenLoadout = vi.fn()
		app = mount(VoicebankPanel, { target: document.body, props: { onOpenLoadout } })
		flushSync()
		listeners.get("voicebank:list")!({
			voices: [voice(1, "Amy"), voice(2, "Bo")],
			pairModelId: 1,
			loadouts: [{ ...loadouts[0], defaultVoiceId: 1, otherSpeakersVoiceId: 2 }]
		})
		flushSync()
		expect(document.querySelector('[data-testid="group-lines"]')!.textContent).toContain("Other speakers: Bo")
		document.querySelector<HTMLButtonElement>('button[aria-label="Open the Narration loadout"]')!.click()
		expect(onOpenLoadout).toHaveBeenCalledWith(1)
	})
	test("seed and speed show as chips only when set", () => {
		render([voice(1, "Amy", { settings: { seed: 355260212, speed: 1.2 } }), voice(2, "Bo")])
		const [amy, bo] = rows()
		expect(amy.textContent).toContain("seed 355260212")
		expect(amy.textContent).toContain("speed 1.2")
		expect(bo.textContent).not.toContain("seed")
	})
	test("Try opens the try-out under that row, one at a time", () => {
		render([voice(1, "Amy"), voice(2, "Bo")])
		const tryBtn = (n: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="Try ${n}"]`)!
		tryBtn("Amy").click()
		flushSync()
		expect(tryBtn("Amy").getAttribute("aria-expanded")).toBe("true")
		expect(rows()[0].querySelector("#vb-try-1")).not.toBeNull()
		tryBtn("Bo").click()
		flushSync()
		expect(document.querySelector("#vb-try-1")).toBeNull()
		expect(document.querySelector("#vb-try-2")).not.toBeNull()
	})
	test("a re-rolled seed on a row's Try can be kept, and saves the entry's settings with it", () => {
		render([voice(1, "Amy", { settings: { seed: 5, speed: 1.2 } })])
		document.querySelector<HTMLButtonElement>('button[aria-label="Try Amy"]')!.click()
		flushSync()
		expect(document.querySelector("[data-keep-seed]")).toBeNull()
		const reroll = Array.from(document.querySelectorAll<HTMLButtonElement>("#vb-try-1 button")).find((b) =>
			/re-roll/i.test(`${b.textContent} ${b.getAttribute("aria-label") ?? ""}`)
		)!
		reroll.click()
		flushSync()
		const keep = document.querySelector<HTMLButtonElement>("[data-keep-seed]")!
		expect(keep.textContent).toContain("Keep this seed")
		keep.click()
		const [ev, payload] = emitted.at(-1)!
		expect(ev).toBe("voicebank:update")
		expect(payload.id).toBe(1)
		expect(payload.voice.settings.speed).toBe(1.2)
		expect(payload.voice.settings.seed).not.toBe(5)
	})
	test("each row names its loadout; an unassigned row says so and why it is skipped", () => {
		render([
			voice(1, "Amy"),
			voice(2, "Bo", { loadoutId: null, loadoutName: null, connectionModelId: null, unusableReason: "This voice has no loadout; pick one in Loadouts → Voices." })
		])
		const [amy, bo] = rows()
		expect(amy.querySelector('[data-testid="voice-loadout"]')!.textContent).toContain("Narration")
		expect(bo.querySelector('[data-testid="voice-loadout"]')!.textContent).toContain("No loadout")
		expect(bo.textContent).toContain("has no loadout")
	})
	test("with no filled text→audio loadout the panel says so and New voice is off", () => {
		app = mount(VoicebankPanel, { target: document.body, props: { onOpenNarration: () => {} } })
		flushSync()
		listeners.get("voicebank:list")!({ voices: [], pairModelId: null, loadouts: [{ ...loadouts[0], filled: false, connectionModelId: null }] })
		flushSync()
		expect(document.body.textContent).toContain("No text→audio loadout has a model yet")
		expect(Array.from(document.querySelectorAll("button")).find((b) => /New voice/.test(b.textContent ?? ""))!.disabled).toBe(true)
	})
	test("opening a row's Try asks for that loadout's connection models", () => {
		render([voice(1, "Amy")])
		document.querySelector<HTMLButtonElement>('button[aria-label="Try Amy"]')!.click()
		flushSync()
		expect(emitted.some(([e, p]) => e === "connections:models" && p.id === 5)).toBe(true)
	})
	test("New voice opens the form on the default loadout, with the shared fields, and asks for that model's facts", () => {
		render([])
		Array.from(document.querySelectorAll("button")).find((b) => /New voice/.test(b.textContent ?? ""))!.click()
		flushSync()
		expect(document.querySelector("#vb-name")).not.toBeNull()
		expect(document.querySelector("#vb-desc")).not.toBeNull()
		expect(document.querySelector("[data-voice-fields]")).not.toBeNull()
		expect(emitted.some(([e, p]) => e === "connections:models" && p.id === 5)).toBe(true)
	})
})
