/**
 * The cast member form in tabs, like the card editor: Profile, Voice, Notes,
 * Likeness, Speech. Each field the member has sits in the same tab as the
 * card's; saving sends what it always sent, whichever tab is on show.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		success: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warning: vi.fn()
	}
}))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import CastMemberForm from "./CastMemberForm.svelte"

const MEMBER_ID = 7
let mounted: Record<string, any> | null = null
let target: HTMLElement | null = null
/** The form's bound `hasUnsavedChanges`, as the page would read it. */
let unsaved = false

function mountForm(
	member: any,
	row: any,
	onSave: (patch: Record<string, unknown>) => Promise<boolean> = async () =>
		true
) {
	setSocket({
		connected: true,
		id: "tab-a",
		on() {},
		off() {},
		emit() {}
	} as any)
	setInterestUser({ id: 1 })
	unsaved = false
	target = document.createElement("div")
	document.body.appendChild(target)
	const props = {
		member,
		row,
		lorebookId: 5,
		get hasUnsavedChanges() {
			return unsaved
		},
		set hasUnsavedChanges(v: boolean) {
			unsaved = v
		},
		onSave,
		onDelete: () => {},
		onLinkCharacter: () => {},
		onUnlink: () => {}
	}
	mounted = mount(CastMemberForm, {
		target,
		props,
		context: new Map<string, any>([
			["panelsCtx", { digest: {}, openView: vi.fn() }],
			["userCtx", { user: { id: 1 } }]
		])
	})
	flushSync()
	return props
}

import { memberDraftOf, memberPatch, withNotesText } from "./memberDraft"

const settle = async () => {
	for (let i = 0; i < 3; i++) {
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
	}
}

afterEach(() => {
	if (mounted) unmount(mounted)
	mounted = null
	target?.remove()
	target = null
	_resetInterestForTests()
})

const CARD = {
	id: 42,
	userId: 1,
	name: "Verity",
	description: "The card's description.",
	personality: "The card's personality.",
	scenario: "The card's scenario.",
	firstMessage: "Hello.",
	mesExample: "The card's examples.",
	postHistoryInstructions: "The card's reminder.",
	creatorNotes: "The card's notes."
}
const carded = (own: Record<string, unknown> = {}) => {
	const row = {
		id: MEMBER_ID,
		name: "Verity",
		linked: true,
		aliases: [],
		presences: [],
		characterId: 42,
		character: CARD,
		...own
	}
	return { member: row, row }
}
const cardless = (own: Record<string, unknown> = {}) => {
	const row = {
		id: MEMBER_ID,
		name: "The ferryman",
		linked: false,
		aliases: [],
		presences: [],
		characterId: null,
		character: null,
		...own
	}
	return { member: row, row }
}

const text = (el: Element | null | undefined) =>
	(el?.textContent ?? "").replace(/\s+/g, " ").trim()
const strip = () =>
	Array.from(
		target!.querySelectorAll<HTMLButtonElement>(
			'[role="tablist"][aria-label="Character fields"] [role="tab"]'
		)
	)
const panel = (tab: string) =>
	target!.querySelector<HTMLElement>(`#cast-member-form-${tab}`)!
const pickTab = (label: string) => {
	strip()
		.find((t) => text(t).startsWith(label))!
		.click()
	flushSync()
}
const within = (tab: string, selector: string) =>
	panel(tab).querySelector(selector) !== null
const saveButton = () =>
	Array.from(target!.querySelectorAll("button")).find(
		(b) => text(b) === "Save"
	) as HTMLButtonElement | undefined
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
	el.value = value
	el.dispatchEvent(new Event("input", { bubbles: true }))
	flushSync()
}
const byLabel = (label: string) =>
	target!.querySelector<HTMLInputElement | HTMLTextAreaElement>(
		`[aria-label="${label}"]`
	)!
const addLanguage = () =>
	Array.from(target!.querySelectorAll("button")).find(
		(b) => text(b) === "+ Add a language"
	)!

const TABS = ["Profile", "Voice", "Notes", "Likeness", "Speech"]

describe("a carded member's tabs", () => {
	test("five tabs, no Stats, each field in its tab with its Use from card switch", () => {
		const { member, row } = carded()
		mountForm(member, row)
		expect(strip().map(text)).toEqual(TABS)
		expect(text(strip()[0])).toBe("Profile")
		expect(strip()[0].getAttribute("aria-selected")).toBe("true")

		expect(within("profile", '[data-retold-field="description"]')).toBe(
			true
		)
		for (const f of [
			"personality",
			"scenario",
			"greetings",
			"exampleDialogues"
		])
			expect(within("voice", `[data-retold-field="${f}"]`), f).toBe(true)
		expect(
			Array.from(target!.querySelectorAll("[data-retold-field]")).map(
				(e) => e.getAttribute("data-retold-field")
			)
		).toEqual([
			"description",
			"personality",
			"scenario",
			"greetings",
			"exampleDialogues"
		])

		const owned = (tab: string, attr: string, field: string) => {
			expect(within(tab, `[${attr}]`), attr).toBe(true)
			expect(
				panel(tab).querySelector(
					`[${attr}] input[name="castOwned-${field}-${MEMBER_ID}-fromCard"]`
				),
				field
			).not.toBeNull()
		}
		owned("voice", "data-cast-post-history", "postHistoryInstructions")
		owned("notes", "data-cast-creator-notes", "creatorNotes")
		owned("likeness", "data-cast-likeness", "likeness")
		expect(within("speech", "[data-cast-voice]")).toBe(true)
		expect(
			panel("speech").querySelector(
				`input[name="castVoice-${MEMBER_ID}-fromCard"]`
			)
		).not.toBeNull()
		expect(unsaved).toBe(false)
	})

	test("one panel is on show, and the tab chosen is kept", () => {
		const { member, row } = carded()
		mountForm(member, row)
		pickTab("Notes")
		for (const t of ["profile", "voice", "notes", "likeness", "speech"])
			expect(panel(t).hidden, t).toBe(t !== "notes")
	})
})

describe("a card-less member's tabs", () => {
	test("the same five tabs; the five own fields are plain", () => {
		const { member, row } = cardless()
		mountForm(member, row)
		expect(strip().map(text)).toEqual(TABS)
		expect(within("voice", "[data-cast-post-history] textarea")).toBe(true)
		expect(within("notes", "[data-cast-creator-notes] textarea")).toBe(true)
		expect(within("likeness", "[data-cast-likeness]")).toBe(true)
		expect(target!.querySelector('input[name$="-fromCard"]')).toBeNull()
		expect(target!.querySelector("[data-retold-field]")).toBeNull()
		expect(target!.querySelector("[data-cast-retold]")).toBeNull()
	})
})

describe("a language named twice in the member's own creator notes", () => {
	test("Save sends nothing, the Notes tab says so; fixing it saves", async () => {
		const { member, row } = cardless({
			creatorNotes: { text: "Hello", variants: { en: "Hi" } }
		})
		const saves: Array<Record<string, unknown>> = []
		mountForm(member, row, async (patch) => {
			saves.push(patch)
			return true
		})
		type(byLabel("Language of these notes") as HTMLInputElement, "EN")
		saveButton()!.click()
		await settle()
		expect(saves).toHaveLength(0)
		expect(text(strip()[2])).toContain("(has an error)")
		expect(text(panel("notes"))).toContain('Language "en" is named twice.')
		// No tab is switched for it.
		expect(panel("profile").hidden).toBe(false)

		type(byLabel("Language 1") as HTMLInputElement, "fr")
		expect(text(strip()[2])).not.toContain("(has an error)")
		saveButton()!.click()
		await settle()
		expect(saves).toHaveLength(1)
		expect(saves[0].creatorNotes).toEqual({
			text: "Hello",
			lang: "en",
			variants: { fr: "Hi" }
		})
	})
})

describe("what Save sends", () => {
	const own = {
		postHistoryInstructions: "Own reminder.",
		creatorNotes: {
			text: "Hello",
			lang: "en",
			variants: { fr: "Bonjour" }
		}
	}

	test("a text-only creator-notes edit: lang and variants kept as they came", async () => {
		const { member, row } = cardless(own)
		const saves: Array<Record<string, unknown>> = []
		mountForm(member, row, async (patch) => {
			saves.push(patch)
			return true
		})
		pickTab("Voice")
		pickTab("Notes")
		type(
			target!.querySelector<HTMLTextAreaElement>(
				`#castOwned-creatorNotes-${MEMBER_ID}`
			)!,
			"Hi there"
		)
		expect(unsaved).toBe(true)
		saveButton()!.click()
		await settle()
		const expected = memberPatch(
			withNotesText(memberDraftOf(row as any), "Hi there"),
			false
		)
		expect(saves).toHaveLength(1)
		expect(saves[0]).toEqual(expected)
		expect(saves[0].creatorNotes).toEqual({
			text: "Hi there",
			lang: "en",
			variants: { fr: "Bonjour" }
		})
	})

	test("a language edit sends text, lang and the lower-cased variants; an empty added row is not a change", async () => {
		const { member, row } = cardless(own)
		const saves: Array<Record<string, unknown>> = []
		mountForm(member, row, async (patch) => {
			saves.push(patch)
			return true
		})
		addLanguage().click()
		flushSync()
		expect(unsaved).toBe(false)
		type(byLabel("Language 1") as HTMLInputElement, " DE ")
		expect(unsaved).toBe(true)
		saveButton()!.click()
		await settle()
		expect(saves).toHaveLength(1)
		expect(saves[0].creatorNotes).toEqual({
			text: "Hello",
			lang: "en",
			variants: { de: "Bonjour" }
		})
	})

	test("a post-history edit sends what memberPatch sends, whichever tab was visited", async () => {
		const { member, row } = cardless(own)
		const saves: Array<Record<string, unknown>> = []
		mountForm(member, row, async (patch) => {
			saves.push(patch)
			return true
		})
		for (const t of ["Notes", "Likeness", "Speech", "Voice", "Profile"])
			pickTab(t)
		expect(unsaved).toBe(false)
		pickTab("Voice")
		type(
			target!.querySelector<HTMLTextAreaElement>(
				`#castOwned-postHistoryInstructions-${MEMBER_ID}`
			)!,
			"Keep it short."
		)
		pickTab("Profile")
		saveButton()!.click()
		await settle()
		const expected = memberPatch(
			{
				...memberDraftOf(row as any),
				postHistoryInstructions: "Keep it short."
			},
			false
		)
		expect(saves).toHaveLength(1)
		expect(saves[0]).toEqual(expected)
		expect(saves[0].postHistoryInstructions).toBe("Keep it short.")
	})
})
