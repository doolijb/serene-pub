/**
 * The collect modal (lair pass R3, owner ruling 2026-09-28): a collecting
 * press opens it instead of reading the composer. Submit wears the action's
 * name and greys until what is required is there; Enter submits once with
 * the text, Shift+Enter does not; Cancel sends nothing; an optional box says
 * what empty does; recipients are the enabled cast, as checkboxes.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import CollectModal from "./CollectModal.svelte"
import { opensModal, type Collected, type CollectMember, type ListedCollects } from "./collects"

const NUDGE = {
	name: "Nudge",
	description: "Tell the narrator what you want next.",
	collects: { text: { need: "required", label: "Direction the party should feel" } } as ListedCollects
}
const TRAP = {
	name: "Trigger trap",
	collects: {
		text: { need: "optional", label: "What is the trap?", ifEmpty: "The room decides." }
	} as ListedCollects
}
const WHISPER = {
	name: "Whisper",
	collects: {
		recipients: { label: "Who hears it", min: 1 },
		text: { need: "required", label: "What do you whisper?" }
	} as ListedCollects
}
const CAST = [
	{ ref: "character:1", name: "Brannoc" },
	{ ref: "character:2", name: "Vell" }
]

let apps: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of apps) unmount(app)
	apps = []
	document.body.innerHTML = ""
})

async function open(
	action: typeof NUDGE | typeof TRAP | typeof WHISPER,
	sent: Collected[],
	cancelled: { n: number } = { n: 0 },
	extra: { cast?: CollectMember[]; ownVoice?: string } = {}
) {
	const host = document.createElement("div")
	document.body.append(host)
	apps.push(
		mount(CollectModal, {
			target: host,
			props: {
				open: true,
				action,
				cast: CAST,
				...extra,
				onSubmit: (c: Collected) => sent.push(c),
				onCancel: () => cancelled.n++
			}
		})
	)
	flushSync()
	await tick()
}

const button = (name: string) =>
	[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === name)
const field = () => document.querySelector<HTMLTextAreaElement>("[data-collect-text]")!
async function type(text: string) {
	field().value = text
	field().dispatchEvent(new Event("input", { bubbles: true }))
	flushSync()
	await tick()
}
function key(k: string, shiftKey = false) {
	field().dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true, cancelable: true }))
	flushSync()
}

describe("a chip press opens the modal", () => {
	test("a collecting action opens it; one collecting nothing fires straight away", () => {
		expect(opensModal({ collects: NUDGE.collects })).toBe(true)
		expect(opensModal({})).toBe(false)
	})
})

describe("CollectModal", () => {
	test("titled with the action, described, the box labelled, submit wearing the name", async () => {
		await open(NUDGE, [])
		expect(document.querySelector("[role=dialog]")).not.toBeNull()
		expect(document.body.textContent).toContain("Tell the narrator what you want next.")
		const label = document.querySelector(`label[for="${field().id}"]`)
		expect(label?.textContent?.trim()).toBe("Direction the party should feel")
		expect(button("Nudge")).toBeDefined()
	})

	test("submit greys until required text is there, and Enter submits once with it", async () => {
		const sent: Collected[] = []
		await open(NUDGE, sent)
		expect(button("Nudge")!.disabled).toBe(true)
		key("Enter")
		expect(sent).toEqual([])
		await type("Bring the ogre back.")
		expect(button("Nudge")!.disabled).toBe(false)
		key("Enter", true)
		expect(sent).toEqual([])
		key("Enter")
		expect(sent).toEqual([{ text: "Bring the ogre back.", recipients: [] }])
	})

	test("Cancel sends nothing", async () => {
		const sent: Collected[] = []
		const cancelled = { n: 0 }
		await open(NUDGE, sent, cancelled)
		await type("north")
		button("Cancel")!.click()
		flushSync()
		expect(sent).toEqual([])
		expect(cancelled.n).toBe(1)
	})

	test("an optional box says what empty does, and submits empty", async () => {
		const sent: Collected[] = []
		await open(TRAP, sent)
		expect(document.querySelector("[data-collect-if-empty]")?.textContent?.trim()).toBe(
			"Left empty: The room decides."
		)
		expect(button("Trigger trap")!.disabled).toBe(false)
		button("Trigger trap")!.click()
		flushSync()
		expect(sent).toEqual([{ text: "", recipients: [] }])
	})

	test("recipients are the cast as checkboxes, and at least one is needed", async () => {
		const sent: Collected[] = []
		await open(WHISPER, sent)
		const boxes = [...document.querySelectorAll<HTMLInputElement>("[data-collect-recipients] input")]
		expect(boxes.map((b) => b.value)).toEqual(["character:1", "character:2"])
		expect(document.querySelector("[data-collect-recipients] legend")?.textContent?.trim()).toBe(
			"Who hears it"
		)
		await type("hold the line")
		expect(button("Whisper")!.disabled).toBe(true)
		boxes[1]!.click()
		flushSync()
		await tick()
		expect(button("Whisper")!.disabled).toBe(false)
		button("Whisper")!.click()
		flushSync()
		expect(sent).toEqual([{ text: "hold the line", recipients: ["character:2"] }])
	})
})

/**
 * R10 (owner ruling 5, 2026-09-28): the modal says plainly who will and
 * won't hear a whisper — the picked delvers, the rest, and the Castellan —
 * and shows each delver's current whisper, so a replace is visible.
 */
describe("CollectModal · who will and won't hear it (R10)", () => {
	const PARTY: CollectMember[] = [
		{ ref: "character:1", name: "Brannoc", holds: "the east door is a lie" },
		{ ref: "character:2", name: "Vell" },
		{ ref: "character:3", name: "Isolde" }
	]
	const reach = () => document.querySelector("[data-collect-reach]")!
	const strong = () => [...reach().querySelectorAll("strong")].map((s) => s.textContent)
	const box = (i: number) =>
		[...document.querySelectorAll<HTMLInputElement>("[data-collect-recipients] input")][i]!
	async function pick(i: number) {
		box(i).click()
		flushSync()
		await tick()
	}

	test("the sentence names who will hear it, who will not, and the Castellan — live as boxes change", async () => {
		await open(WHISPER, [], { n: 0 }, { cast: PARTY, ownVoice: "Castellan" })
		expect(reach().getAttribute("aria-live")).toBe("polite")
		expect(reach().textContent).toBe("Pick who hears it. Nobody else will, not even the Castellan.")

		await pick(0)
		await pick(1)
		expect(reach().textContent).toBe(
			"Brannoc and Vell will hear this. Isolde will not, and nor will the Castellan."
		)
		expect(strong()).toEqual(["Brannoc", "Vell", "Isolde"])

		await pick(2)
		expect(reach().textContent).toBe("Brannoc, Vell and Isolde will hear this. The Castellan will not.")

		await pick(0)
		await pick(2)
		expect(reach().textContent).toBe(
			"Vell will hear this. Brannoc and Isolde will not, and nor will the Castellan."
		)
	})

	test("each delver's current whisper is shown, and says it is replaced once picked", async () => {
		await open(WHISPER, [], { n: 0 }, { cast: PARTY, ownVoice: "Castellan" })
		const held = () => document.querySelector('[data-collect-holds="character:1"]')?.textContent?.trim()
		expect(held()).toBe("Now: “the east door is a lie”")
		expect(document.querySelector('[data-collect-holds="character:2"]')).toBeNull()
		await pick(0)
		expect(held()).toBe("Replaces: “the east door is a lie”")
	})

	test("without an own voice, the sentence names the cast alone", async () => {
		await open(WHISPER, [], { n: 0 }, { cast: PARTY })
		await pick(1)
		expect(reach().textContent).toBe("Vell will hear this. Brannoc and Isolde will not.")
	})
})
