/**
 * The member form's retold rows (PLAN-cast-retold-fields): one
 * row per card field with a Use from card switch, the card's
 * text shown dimmed while it reads through, switching on copying the card's
 * text into an empty field, and the change saving through the same draft.
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
import { setRetold, takeFromCard } from "./retoldRows"

const card = {
	id: 9,
	name: "Maren",
	isPersona: false,
	avatarMediaId: 7,
	description: "The card's innkeeper.",
	personality: "Dry.",
	scenario: "",
	firstMessage: "Rooms are two silver.",
	alternateGreetings: ["Back again?"],
	exampleDialogues: ["{{char}}: Hm."]
}
const row: CastRow = {
	id: 3,
	binding: "{{char:1}}",
	characterId: 9,
	character: card,
	description: "Kept from before.",
	retold: {}
}

let app: ReturnType<typeof mount> | null = null
let saved: Record<string, unknown>[] = []

beforeEach(() => {
	saved = []
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

async function mountForm(r: CastRow = row) {
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(CastMemberForm, {
		target,
		props: {
			member: toCastMember(r),
			row: r,
			lorebookId: 1,
			hasUnsavedChanges: false,
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

const field = (name: string) =>
	document.querySelector<HTMLElement>(`[data-retold-field="${name}"]`)!
const editor = (name: string) =>
	field(name).querySelector<HTMLTextAreaElement>("textarea")!

const toggle = (name: string) =>
	field(name).querySelector<HTMLElement>(
		'[data-part="control"], input[type="checkbox"]'
	)!
const checkbox = (name: string) =>
	field(name).querySelector<HTMLInputElement>('input[type="checkbox"]')!
const takeButton = (name: string) =>
	[...field(name).querySelectorAll("button")].find((b) =>
		/Take from card/.test(b.textContent ?? "")
	)
const save = () =>
	[...document.querySelectorAll("button")]
		.find((b) => /^\s*Save\s*$/.test(b.textContent ?? ""))!
		.click()
/** The draft the form starts from, the way the form builds it. */
const startDraft = (r: CastRow = row) => memberDraftOf(r as never)
const FIELDS = [
	"description",
	"personality",
	"scenario",
	"greetings",
	"exampleDialogues"
]

describe("From the card", () => {
	test("one row per card field, the card's text dimmed and read-only while Use from card is on", async () => {
		await mountForm()
		expect(
			[...document.querySelectorAll("[data-retold-field]")].map((e) =>
				e.getAttribute("data-retold-field")
			)
		).toEqual(FIELDS)
		expect(editor("description").disabled).toBe(true)
		expect(editor("description").value).toBe("The card's innkeeper.")
		expect(field("description").textContent).toMatch(/Use from card/)
		// The member's own text is kept, and the row says so.
		expect(field("description").textContent).toMatch(
			/is kept, set aside\. Switch off\s+Use from card to read it again/
		)
		expect(editor("exampleDialogues").value).toBe("<START>\n{{char}}: Hm.")
	})

	test("every row shows Use from card, checked while it follows the card; no Retold here / From the card labels", async () => {
		await mountForm()
		for (const f of FIELDS) {
			expect(field(f).textContent).toMatch(/Use from card/)
			expect(field(f).textContent).not.toMatch(/Retold here/)
			expect(field(f).textContent).not.toMatch(/From the card/)
			expect(checkbox(f).checked).toBe(true)
			expect(takeButton(f)).toBeUndefined()
		}
		toggle("personality").click()
		await settle()
		expect(checkbox("personality").checked).toBe(false)
		expect(field("personality").textContent).not.toMatch(/Retold here/)
	})

	test("Take from card shows only while Use from card is off, disabled when the card has none", async () => {
		await mountForm()
		expect(takeButton("description")).toBeUndefined()
		toggle("description").click()
		await settle()
		expect(takeButton("description")).toBeDefined()
		expect(takeButton("description")!.disabled).toBe(false)
		// The card has no scenario.
		toggle("scenario").click()
		await settle()
		expect(takeButton("scenario")).toBeDefined()
		expect(takeButton("scenario")!.disabled).toBe(true)
	})

	test("switching Use from card off keeps the member's own text, and Save writes it with the flag", async () => {
		await mountForm()
		toggle("description").click()
		await settle()
		expect(editor("description").disabled).toBe(false)
		expect(editor("description").value).toBe("Kept from before.")
		save()
		await settle()
		expect(saved[0]).toMatchObject({
			description: "Kept from before.",
			retold: { description: true }
		})
		expect(saved[0]).toEqual(
			memberPatch(
				setRetold(startDraft(), "description", true, card as never),
				true
			)
		)
	})

	test("switching Use from card off on an empty field copies the card's text first", async () => {
		await mountForm()
		toggle("personality").click()
		await settle()
		expect(editor("personality").value).toBe("Dry.")
		save()
		await settle()
		expect(saved[0]).toEqual(
			memberPatch(
				setRetold(startDraft(), "personality", true, card as never),
				true
			)
		)
	})

	test("off then on again keeps the text, set aside; the payload is what the draft helpers give", async () => {
		await mountForm()
		toggle("description").click()
		await settle()
		toggle("description").click()
		await settle()
		expect(checkbox("description").checked).toBe(true)
		expect(editor("description").disabled).toBe(true)
		save()
		await settle()
		const d = startDraft()
		const off = setRetold(d, "description", true, card as never, d)
		const on = setRetold(off, "description", false, card as never, d)
		expect(saved[0]).toEqual(memberPatch(on, true))
	})

	test("Take from card copies the card's current text; the payload matches", async () => {
		await mountForm()
		toggle("description").click()
		await settle()
		takeButton("description")!.click()
		await settle()
		expect(editor("description").value).toBe("The card's innkeeper.")
		save()
		await settle()
		const d = startDraft()
		expect(saved[0]).toEqual(
			memberPatch(
				takeFromCard(
					setRetold(d, "description", true, card as never, d),
					"description",
					card as never
				),
				true
			)
		)
	})

	test("a card-less member has no retold rows", async () => {
		await mountForm({
			id: 4,
			name: "Oren",
			characterId: null,
			character: null
		})
		expect(document.querySelector("[data-cast-retold]")).toBeNull()
		expect(document.querySelector("[data-cast-change-face]")).toBeNull()
	})
})
