/**
 * The member form's **From the card** block (PLAN-cast-retold-fields): one
 * row per card field with a Retold here / From the card switch, the card's
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

describe("From the card", () => {
	test("one row per card field, the card's text dimmed and read-only while off", async () => {
		await mountForm()
		expect(
			[...document.querySelectorAll("[data-retold-field]")].map((e) =>
				e.getAttribute("data-retold-field")
			)
		).toEqual([
			"description",
			"personality",
			"scenario",
			"firstMessage",
			"alternateGreetings",
			"exampleDialogues"
		])
		expect(editor("description").disabled).toBe(true)
		expect(editor("description").value).toBe("The card's innkeeper.")
		expect(field("description").textContent).toMatch(/From the card/)
		// The member's own text is kept, and the row says so.
		expect(field("description").textContent).toMatch(/is kept, hidden/)
		expect(editor("exampleDialogues").value).toBe("<START>\n{{char}}: Hm.")
	})

	test("switching on keeps the member's own text, and Save writes it with the flag", async () => {
		await mountForm()
		field("description")
			.querySelector<HTMLElement>('[data-part="control"], input[type="checkbox"]')!
			.click()
		await settle()
		expect(editor("description").disabled).toBe(false)
		expect(editor("description").value).toBe("Kept from before.")
		expect(field("description").textContent).toMatch(/Retold here/)
		;[...document.querySelectorAll("button")]
			.find((b) => /^\s*Save\s*$/.test(b.textContent ?? ""))!
			.click()
		await settle()
		expect(saved[0]).toMatchObject({
			description: "Kept from before.",
			retold: { description: true }
		})
	})

	test("switching on an empty field copies the card's text first", async () => {
		await mountForm()
		field("personality")
			.querySelector<HTMLElement>('[data-part="control"], input[type="checkbox"]')!
			.click()
		await settle()
		expect(editor("personality").value).toBe("Dry.")
	})

	test("a background member has no From the card block", async () => {
		await mountForm({ id: 4, name: "Oren", characterId: null, character: null })
		expect(document.querySelector("[data-cast-retold]")).toBeNull()
		expect(document.querySelector("[data-cast-change-face]")).toBeNull()
	})
})
