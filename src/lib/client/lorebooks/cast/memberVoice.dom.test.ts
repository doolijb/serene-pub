/**
 * The member page's Voice section: the card form's voice fields, reused. A
 * carded member's voice is the card's behind a *Use from card* switch; a
 * card-less member has the fields directly. Saved with the form's Save.
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

const fromCard = () =>
	target!.querySelector<HTMLInputElement>(
		`input[name="castVoice-${MEMBER_ID}-fromCard"]`
	)
const voiceFields = () => target!.querySelector("[data-voice-fields]")
const description = () =>
	target!.querySelector<HTMLTextAreaElement>(
		"[data-cast-voice] [data-voice-fields] textarea"
	)!
function flip() {
	const root = fromCard()!.closest<HTMLElement>("label, [data-scope]")!
	;(root.querySelector<HTMLElement>('[data-part="control"]') ?? root).click()
	flushSync()
}
const saveButton = () =>
	Array.from(target!.querySelectorAll("button")).find(
		(b) => (b.textContent ?? "").trim() === "Save"
	) as HTMLButtonElement | undefined
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

const carded = (own: Record<string, unknown> = {}) => {
	const row = {
		id: MEMBER_ID,
		name: "Verity",
		linked: true,
		aliases: [],
		presences: [],
		characterId: 42,
		character: { id: 42, userId: 1, name: "Verity" },
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

describe("the member's Voice section", () => {
	test("a carded member with no voice of their own: Use from card on, no fields", () => {
		const { member, row } = carded({ timbre: null })
		mountForm(member, row)
		expect(target!.querySelector("[data-cast-voice]")).not.toBeNull()
		expect(target!.textContent).toContain("Voice")
		expect(fromCard()!.checked).toBe(true)
		expect(voiceFields()).toBeNull()
	})

	test("switching it off shows the voice fields, clean until something is typed", async () => {
		const { member, row } = carded({ timbre: null })
		const saves: Array<Record<string, unknown>> = []
		mountForm(member, row, async (patch) => {
			saves.push(patch)
			return true
		})
		flip()
		await settle()
		expect(fromCard()!.checked).toBe(false)
		expect(voiceFields()).not.toBeNull()
		expect(unsaved).toBe(false)

		const field = description()
		field.value = "a low alto"
		field.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		expect(unsaved).toBe(true)
		saveButton()!.click()
		await settle()
		expect(saves).toHaveLength(1)
		expect(saves[0].timbre).toEqual({ description: "a low alto" })
	})

	test("a carded member with their own voice: switch off, the fields hold it", () => {
		const { member, row } = carded({ timbre: { description: "gravel" } })
		mountForm(member, row)
		expect(fromCard()!.checked).toBe(false)
		expect(description().value).toBe("gravel")
	})

	test("a card-less member: the fields directly, no switch, clean", () => {
		const { member, row } = cardless({ timbre: null })
		mountForm(member, row)
		expect(fromCard()).toBeNull()
		expect(voiceFields()).not.toBeNull()
		expect(unsaved).toBe(false)
	})
})
