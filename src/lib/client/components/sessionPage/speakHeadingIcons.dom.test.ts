/**
 * The message heading's ONE speech icon (heading audio control, 2026-10-29):
 * a line with audio shows a play / stop speaker; with none, the contributed
 * Read aloud; a live speak run reads Stop. The speak verbs sit at the ⋮
 * menu's top level and ⋮ › Speech holds the full player (owner 2026-10-29).
 * One line plays at a time; the strip's own player is hidden by the default
 * sheet and keeps playing. Core's messages widget is the BUILT module
 * mounted by the SDK's harness (needs `npm run sdk:build` to be current).
 */
import { afterEach, describe, expect, test } from "vitest"
import { readFileSync, realpathSync } from "node:fs"
import { resolve } from "node:path"
import { mountComponent, type MountedComponent } from "@serene-pub/cli/testing"
import { componentParitySections } from "@serene-pub/conformance"

const CORE_CATALOG = realpathSync(resolve(process.cwd(), "node_modules/@serene-pub/core-catalog"))
const ICONS = '[data-widget-part~="messages.message-actions"] [data-widget-part~="messages.message-icon-button"]'

const speakAction = (key: string, name: string, icon: string, description: string) => ({
	key,
	specSlug: "core:spec/speak-message",
	name,
	icon,
	description,
	slash: key,
	audience: { see: ["participant"], act: ["item"] },
	venue: "message",
	origin: "core",
	canAct: true,
	itemGated: true,
	isNew: false,
	enabled: true,
	quick: true
})
const READ = speakAction("read-aloud", "Read aloud", "volume-2", "Make this message into speech.")
const SAY = speakAction("say-it-as", "Say it as…", "drama", "Read this message aloud the way you describe.")

const views: MountedComponent[] = []
afterEach(() => {
	views.length = 0
})

async function open(o: { spoken?: Record<string, unknown>; audio?: boolean; every?: boolean; liveRunIds?: string[]; speech?: unknown; playback?: "auto" | "click" | "never" } = {}) {
	const sections = componentParitySections() as any
	const full = sections.scoped.session_full
	const messages = sections.messages.map((m: any) =>
		// `every`: both parity lines (one person, one character) carry a spoken take.
		!o.every && m.id !== 2
			? m
			: {
					...m,
					metadata: o.spoken ? { spoken: o.spoken } : {},
					parts: o.audio
						? [{ id: 90 + m.id, type: "core:audio", step: 0, ordinal: 0, revision: 0, data: { assetId: 5 } }]
						: []
				}
	)
	const requests: Array<{ kind: string; params: unknown }> = []
	const view = await mountComponent({
		root: CORE_CATALOG,
		entry: "dist/components/messages.js",
		owner: "core",
		coreConversation: true,
		timeoutMs: 60_000,
		requests: async (kind, params) => {
			requests.push({ kind, params })
			return undefined as never
		},
		context: {
			...sections,
			messages,
			actions: { message: { primary: [...sections.actions.message.primary, READ, SAY], overflow: [] } },
			scoped: {
				session_full: {
					...full,
					...(o.liveRunIds ? { liveRunIds: o.liveRunIds } : {}),
					...(o.speech ? { speech: o.speech } : {}),
					...(o.playback ? { spokenPlayback: o.playback } : {})
				}
			}
		} as never
	})
	views.push(view)
	await view.settle()
	return { view, requests }
}
const row2 = (view: MountedComponent) => view.queryAll('[data-widget-part~="messages.message"]')[1]
const icons = (view: MountedComponent) => [...row2(view).querySelectorAll<HTMLElement>(ICONS)]
const names = (view: MountedComponent) => icons(view).map((b) => b.getAttribute("aria-label"))
const SPOKEN = { spokenAs: { voice: "bruno" }, cueMap: { source: "none", spans: [] }, at: "2026-10-29T10:00:00Z" }
/** The ⋮ menu's own rows on line 2 — never one inside ⋮ › Speech. */
const menuRows = (view: MountedComponent) =>
	[...row2(view).querySelectorAll<HTMLElement>('[data-widget-part~="messages.message-options-list"] [data-widget-part~="messages.message-option"]')].filter(
		(b) => b.closest('[data-widget-part~="messages.message-speech-panel"]') === null &&
			!b.matches('[data-widget-part~="messages.message-speech-open"]')
	)
const rowNamed = (view: MountedComponent, name: string) => menuRows(view).find((b) => b.textContent?.trim() === name)

describe("the speech icon in the message heading", () => {
	test("with no audio the heading draws Read aloud (first) and Edit; Say it as… is not an icon", async () => {
		const { view } = await open()
		expect(names(view)).toEqual(["Read aloud", "Edit"])
		expect(icons(view)[0].querySelector("sp-icon")?.getAttribute("name")).toBe("volume-2")
	})

	test("a line with audio shows ONE speaker that plays, then stops; its name flips and it is not pressed", async () => {
		const { view } = await open({ spoken: SPOKEN, audio: true })
		expect(names(view)).toEqual(["Play the spoken line", "Edit"])
		const icon = () => icons(view)[0]
		expect(icon().getAttribute("data-state")).toBe("ready")
		expect(icon().hasAttribute("aria-pressed")).toBe(false)
		icon().click()
		await view.settle()
		expect(icon().getAttribute("data-state")).toBe("playing")
		expect(icon().getAttribute("aria-label")).toBe("Stop")
		icon().click()
		await view.settle()
		expect(icon().getAttribute("data-state")).toBe("ready")
	})

	test("while the line's speak run is live the speaker reads Stop and stops that run", async () => {
		const pending = { runId: "run-9", at: "2026-10-29T10:00:00Z" }
		const { view, requests } = await open({ spoken: { ...SPOKEN, pending }, liveRunIds: ["run-9"] })
		expect(names(view)).toEqual(["Stop speaking this line", "Edit"])
		const stop = icons(view)[0]
		expect(stop.getAttribute("data-state")).toBe("speaking")
		expect(stop.querySelector("sp-icon")?.getAttribute("name")).toBe("volume-2")
		expect(row2(view).querySelector('[data-widget-part~="messages.message-actions"]')?.hasAttribute("data-speaking")).toBe(true)
		stop.click()
		await view.settle()
		expect(JSON.stringify([...view.invoked, ...requests])).toContain("run-9")
	})

	test("a pub that cannot speak greys Read aloud, the reason in the tooltip, and a press does nothing", async () => {
		const reason = "no voice is set up on this pub yet"
		const { view, requests } = await open({ speech: { canSpeak: false, reason } })
		const read = icons(view).find((b) => b.getAttribute("aria-label") === "Read aloud")!
		expect(read.getAttribute("aria-disabled")).toBe("true")
		expect(read.getAttribute("title")).toBe(`Read aloud — ${reason}`)
		const before = view.invoked.length + requests.length
		read.click()
		await view.settle()
		expect(view.invoked.length + requests.length).toBe(before)
	})

	test("Read aloud Off does not grey it (on-demand still works)", async () => {
		const { view } = await open({ speech: { canSpeak: true } })
		const read = icons(view).find((b) => b.getAttribute("aria-label") === "Read aloud")!
		expect(read.hasAttribute("aria-disabled")).toBe(false)
	})

	test("No player: no speech icon, no ⋮ › Speech, and both the heading and the ⋮ menu read Say it again", async () => {
		const { view } = await open({ spoken: SPOKEN, audio: true, playback: "never" })
		expect(row2(view).querySelectorAll('[data-widget-part~="messages.message-speech"]').length).toBe(0)
		expect(names(view)[0]).toBe("Say it again")
		expect(row2(view).querySelectorAll('[data-widget-part~="messages.message-speech-player"]').length).toBe(0)
		expect(row2(view).querySelectorAll('[data-widget-part~="messages.message-speech-open"]').length).toBe(0)
		const rows = menuRows(view).map((b) => b.textContent?.trim())
		expect(rows.includes("Say it again")).toBe(true)
		expect(rows.includes("Read aloud")).toBe(false)
	})

	test("one line plays at a time: playing line B stops line A (its strip player is replaced)", async () => {
		const { view } = await open({ spoken: SPOKEN, audio: true, every: true })
		const strips = () => view.queryAll('[data-widget-part~="messages.spoken-audio"]')
		const speakers = () => view.queryAll('[data-widget-part~="messages.message-speech"]') as HTMLElement[]
		expect(speakers().length >= 2).toBe(true)
		const a0 = strips()[0]
		speakers()[0].click()
		await view.settle()
		expect(strips()[0].hasAttribute("playing")).toBe(true)
		speakers()[1].click()
		await view.settle()
		expect(strips()[0].hasAttribute("playing")).toBe(false)
		expect(strips()[1].hasAttribute("playing")).toBe(true)
		expect(strips()[0] === a0).toBe(false)
	})
})

describe("the speak verbs at the top of the ⋮ menu (owner 2026-10-29)", () => {
	test("no audio: Read aloud and Say it as… are the menu's own rows, and there is no ⋮ › Speech", async () => {
		const { view } = await open()
		const rows = menuRows(view).map((b) => b.textContent?.trim())
		expect(rows.includes("Read aloud")).toBe(true)
		expect(rows.includes("Say it as…")).toBe(true)
		expect(row2(view).querySelectorAll('[data-widget-part~="messages.message-speech-open"]').length).toBe(0)
	})

	test("with audio: Say it again and Say it as… at the top; ⋮ › Speech holds the player alone", async () => {
		const { view, requests } = await open({ spoken: SPOKEN, audio: true })
		const rows = menuRows(view).map((b) => b.textContent?.trim())
		expect(rows.includes("Say it again")).toBe(true)
		expect(rows.includes("Say it as…")).toBe(true)
		expect(rows.includes("Read aloud")).toBe(false)
		expect(rowNamed(view, "Say it again")!.querySelector("sp-icon")?.getAttribute("name")).toBe("rotate-ccw")
		const panel = row2(view).querySelector('[data-widget-part~="messages.message-speech-panel"]')
		expect(panel === null).toBe(false)
		expect(panel!.querySelectorAll('[data-widget-part~="messages.message-speech-player"]').length).toBe(1)
		expect(panel!.querySelectorAll('[data-widget-part~="messages.message-option"]').length).toBe(0)
		const before = view.invoked.length + requests.length
		await view.click(rowNamed(view, "Say it again")!)
		await view.settle()
		expect(view.invoked.length + requests.length > before).toBe(true)
		expect(JSON.stringify([...view.invoked, ...requests])).toContain("read-aloud")
	})

	test("while the line is spoken the menu's own Stop row stops that run", async () => {
		const pending = { runId: "run-9", at: "2026-10-29T10:00:00Z" }
		const { view, requests } = await open({ spoken: { ...SPOKEN, pending }, liveRunIds: ["run-9"] })
		const stop = rowNamed(view, "Stop speaking this line")
		expect(stop === undefined).toBe(false)
		expect(stop!.getAttribute("data-verb")).toBe("stop")
		await view.click(stop!)
		await view.settle()
		expect(JSON.stringify([...view.invoked, ...requests])).toContain("run-9")
	})
})

describe("the strip's player is hidden by the default sheet and keeps playing", () => {
	/**
	 * The default sheet's `display:none` rule for the strip (widgets.css) —
	 * its selector list. happy-dom computes every `<audio>` as display:none
	 * whatever the sheet says, so the proof is that the rule's selectors hit
	 * the real element (and miss the voice chip); corePresets.test.ts proves
	 * the rule is display:none outside any @container or @media.
	 */
	const hideSelectors = () => {
		const css = readFileSync("src/lib/client/styles/widgets.css", "utf8")
		const at = css.indexOf("*/", css.indexOf("The strip is quiet by default")) + 2
		const open = css.indexOf("{", at)
		expect(/^\s*display:\s*none;\s*$/.test(css.slice(open + 1, css.indexOf("}", open)))).toBe(true)
		return css.slice(at, open).trim()
	}

	test("the <audio> stays in the line under the hide rule, and the heading still plays and stops it", async () => {
		const hide = hideSelectors()
		const { view } = await open({ spoken: SPOKEN, audio: true })
		const audio = () => row2(view).querySelector<HTMLAudioElement>('audio[data-widget-part~="messages.spoken-audio"]')
		expect(audio() === null).toBe(false)
		expect(audio()!.isConnected).toBe(true)
		expect(audio()!.matches(hide)).toBe(true)
		const voice = row2(view).querySelector<HTMLElement>('[data-widget-part~="messages.spoken-voice"]')!
		expect(voice.matches(hide)).toBe(false)
		const speaker = () => icons(view)[0]
		speaker().click()
		await view.settle()
		expect(audio() === null).toBe(false)
		expect(audio()!.matches(hide)).toBe(true)
		expect(audio()!.hasAttribute("playing")).toBe(true)
		expect(speaker().getAttribute("data-state")).toBe("playing")
		speaker().click()
		await view.settle()
		expect(audio()!.hasAttribute("playing")).toBe(false)
		expect(speaker().getAttribute("data-state")).toBe("ready")
	})
})
