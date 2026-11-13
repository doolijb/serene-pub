/**
 * A card-less cast member's own words: Description on Profile; Personality,
 * Scenario, Greetings and Example dialogues on Voice. Plain fields, no card
 * to read, no switch.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import CastMemberForm from "./CastMemberForm.svelte"
import { toCastMember, type CastRow } from "../castPool"
import { memberDraftOf, memberPatch } from "./memberDraft"

const cardless: CastRow = {
	id: 4,
	name: "Oren",
	binding: "{{char:1}}",
	characterId: null,
	character: null
}
const cardLostRow: CastRow = {
	...cardless,
	description: "An innkeeper.",
	personality: "Dry.",
	scenario: "A wet night.",
	firstMessage: "Rooms are two silver.",
	alternateGreetings: ["Back again?"],
	groupOnlyGreetings: ["Evening, all."],
	exampleDialogues: "<START>\n{{char}}: Hm."
} as CastRow

const KEYS = [
	"description",
	"personality",
	"scenario",
	"firstMessage",
	"alternateGreetings",
	"groupOnlyGreetings",
	"exampleDialogues"
]

let app: ReturnType<typeof mount> | null = null
let saved: Record<string, unknown>[] = []
let unsaved = false

beforeEach(() => {
	saved = []
	unsaved = false
	setSocket({
		connected: true,
		id: "t",
		on() {},
		off() {},
		emit() {}
	} as never)
	setInterestUser({ id: 1, isAdmin: false })
})

afterEach(() => {
	if (app) unmount(app)
	app = null
	_resetInterestForTests()
	setSocket(null)
	document.body.innerHTML = ""
})

async function settle() {
	flushSync()
	await tick()
	flushSync()
}

async function mountForm(r: CastRow = cardless) {
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(CastMemberForm, {
		target,
		props: {
			member: toCastMember(r),
			row: r,
			lorebookId: 1,
			get hasUnsavedChanges() {
				return unsaved
			},
			set hasUnsavedChanges(v: boolean) {
				unsaved = v
			},
			onSave: async (patch: Record<string, unknown>) => {
				saved.push(patch)
				return true
			},
			onDelete: () => {},
			onLinkCharacter: () => {},
			onUnlink: () => {}
		}
	})
	await settle()
}

const own = (name: string) =>
	document.querySelector<HTMLElement>(`[data-own-field="${name}"]`)!
const area = (name: string) => own(name).querySelector("textarea")!
const panel = (name: string) =>
	document.getElementById(`cast-member-form-${name}`)!
const saveBtn = () =>
	[...document.querySelectorAll("button")].find((b) =>
		/^\s*Save\s*$/.test(b.textContent ?? "")
	)!

function type(el: HTMLTextAreaElement, value: string) {
	el.value = value
	el.dispatchEvent(new Event("input", { bubbles: true }))
	flushSync()
}

describe("a card-less member's own words", () => {
	test("Description on Profile; the rest on Voice; all plain", async () => {
		await mountForm()
		expect(panel("profile").contains(own("description"))).toBe(true)
		for (const f of [
			"personality",
			"scenario",
			"greetings",
			"exampleDialogues"
		])
			expect(panel("voice").contains(own(f))).toBe(true)
		for (const f of [
			"description",
			"personality",
			"scenario",
			"exampleDialogues"
		]) {
			expect(area(f).disabled).toBe(false)
			expect(own(f).querySelector('input[type="checkbox"]')).toBeNull()
		}
		expect(area("exampleDialogues").className).toMatch(/font-mono/)
		expect(
			[...own("greetings").querySelectorAll("button")].some((b) =>
				/Add a greeting/.test(b.textContent ?? "")
			)
		).toBe(true)
		expect(own("greetings").querySelector("label")!.textContent).toMatch(
			/Greetings/
		)
		expect(document.querySelector("[data-cast-retold]")).toBeNull()
		expect(document.querySelector("[data-retold-field]")).toBeNull()
		expect(document.body.textContent).not.toMatch(/Take from card/)
		for (const h of ["Voice", "Greetings", "Examples", "Instructions"])
			expect(
				[...panel("voice").querySelectorAll("h5")].map(
					(e) => e.textContent
				)
			).toContain(h)
	})

	test("typing in each field then Save sends memberPatch of the edited draft", async () => {
		await mountForm()
		type(area("description"), "A tall innkeeper.")
		type(area("personality"), "Dry.")
		type(area("scenario"), "")
		type(area("exampleDialogues"), "{{char}}: Hm.")
		const list = own("greetings")
		const add = () =>
			[...list.querySelectorAll("button")]
				.find((b) => /Add a greeting/.test(b.textContent ?? ""))!
				.click()
		add()
		await settle()
		type(list.querySelectorAll("textarea")[0], "Welcome.")
		add()
		await settle()
		type(list.querySelectorAll("textarea")[1], "Evening, all.")
		list.querySelectorAll<HTMLInputElement>(
			'input[type="checkbox"]'
		)[1].click()
		await settle()
		saveBtn().click()
		await settle()
		const d = memberDraftOf(cardless as never)
		const patch = saved[0]
		expect(patch.description).toBe("A tall innkeeper.")
		expect(patch.personality).toBe("Dry.")
		expect(patch.scenario).toBeNull()
		expect(patch.firstMessage).toBe("Welcome.")
		expect(patch.alternateGreetings).toEqual([])
		expect(patch.groupOnlyGreetings).toEqual(["Evening, all."])
		expect(String(patch.exampleDialogues)).toMatch(/Hm\./)
		for (const k of KEYS) expect(patch).toHaveProperty(k)
		// The same keys a card-less patch sends: no `retold`, no `faceMediaId`.
		expect(Object.keys(patch).sort()).toEqual(
			Object.keys(memberPatch(d, false)).sort()
		)
	})

	test("a member made card-less by a card delete shows the words; untouched Save is not dirty", async () => {
		await mountForm(cardLostRow)
		expect(area("description").value).toBe("An innkeeper.")
		expect(area("personality").value).toBe("Dry.")
		expect(area("scenario").value).toBe("A wet night.")
		expect(area("exampleDialogues").value).toMatch(/Hm\./)
		const boxes = [...own("greetings").querySelectorAll("textarea")].map(
			(t) => t.value
		)
		expect(boxes).toEqual(
			expect.arrayContaining(["Rooms are two silver.", "Back again?"])
		)
		expect(unsaved).toBe(false)
		type(area("description"), "An innkeeper, older.")
		expect(unsaved).toBe(true)
		type(area("description"), "An innkeeper.")
		expect(unsaved).toBe(false)
	})

	test("a form closed while dirty leaves no unsaved changes behind (lead, 2026-11-10)", async () => {
		await mountForm(cardLostRow)
		expect(unsaved).toBe(false)
		type(area("description"), "Edited before closing.")
		await settle()
		expect(unsaved).toBe(true)
		unmount(app!)
		app = null
		expect(unsaved).toBe(false)
	})

	test("the Group sessions only label has a touch-size hit area", async () => {
		await mountForm(cardLostRow)
		const labels = [...own("greetings").querySelectorAll("label")].filter(
			(l) => /Group sessions only/.test(l.textContent ?? "")
		)
		expect(labels.length).toBeGreaterThan(0)
		for (const l of labels)
			expect(l.className).toMatch(/pointer-coarse:min-h-11/)
	})
})

describe("the Speech tab", () => {
	// The tab's own `<p>` heading is gone. (The shared VoiceTab draws its own
	// `<h3>Voice</h3>` for an own voice; it is not this form's.)
	const headings = () =>
		[...panel("speech").querySelectorAll("*")].filter(
			(e) =>
				e.children.length === 0 &&
				e.tagName !== "H3" &&
				e.textContent?.trim() === "Voice" &&
				!e.closest(".sr-only") &&
				!e.classList.contains("sr-only")
		)

	test("card-less: no Voice heading", async () => {
		await mountForm()
		expect(headings()).toHaveLength(0)
	})

	test("carded: no Voice heading beside the switch's hidden label", async () => {
		await mountForm({
			id: 3,
			binding: "{{char:1}}",
			characterId: 9,
			character: { id: 9, name: "Maren", isPersona: false } as never
		} as CastRow)
		expect(headings()).toHaveLength(0)
		expect(
			panel("speech").querySelector("[data-cast-voice] .sr-only")
		).not.toBeNull()
	})
})
