/**
 * The member page's post-history instructions, creator notes and likeness: a
 * carded member reads the card's behind a *Use from card* switch (the card's
 * text dimmed); a card-less member has the fields directly. Saved with the
 * form's Save, as retold fields.
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

const fromCard = (field: string) =>
	target!.querySelector<HTMLInputElement>(
		`input[name="castOwned-${field}-${MEMBER_ID}-fromCard"]`
	)
const area = (field: string) =>
	target!.querySelector<HTMLTextAreaElement>(
		`#castOwned-${field}-${MEMBER_ID}`
	)!
function flip(field: string) {
	const root = fromCard(field)!.closest<HTMLElement>("label, [data-scope]")!
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
		character: {
			id: 42,
			userId: 1,
			name: "Verity",
			postHistoryInstructions: "The card's reminder.",
			creatorNotes: "The card's notes."
		},
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

describe("post-history instructions, creator notes and likeness", () => {
	test("a carded member: three switches on, the card's text dimmed", () => {
		const { member, row } = carded()
		mountForm(member, row)
		for (const f of ["postHistoryInstructions", "creatorNotes", "likeness"])
			expect(fromCard(f)!.checked).toBe(true)
		const phi = area("postHistoryInstructions")
		expect(phi.disabled).toBe(true)
		expect(phi.value).toBe("The card's reminder.")
		expect(area("creatorNotes").value).toBe("The card's notes.")
		expect(
			target!.querySelector("[data-cast-likeness]")!.textContent
		).toContain("Uses the card's likeness.")
		expect(unsaved).toBe(false)
	})

	test("switching post-history off: an editable box; Save sends the flag and the text", async () => {
		const { member, row } = carded()
		const saves: Array<Record<string, unknown>> = []
		mountForm(member, row, async (patch) => {
			saves.push(patch)
			return true
		})
		flip("postHistoryInstructions")
		await settle()
		const phi = area("postHistoryInstructions")
		expect(phi.disabled).toBe(false)
		// Starts from the card's current text.
		expect(phi.value).toBe("The card's reminder.")
		phi.value = "Keep it short."
		phi.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		expect(unsaved).toBe(true)
		saveButton()!.click()
		await settle()
		expect(saves).toHaveLength(1)
		expect(saves[0].postHistoryInstructions).toBe("Keep it short.")
		expect(saves[0].retold).toEqual({ postHistoryInstructions: true })
	})

	test("an untouched off-and-on leaves the form clean", async () => {
		const { member, row } = carded()
		mountForm(member, row)
		flip("creatorNotes")
		await settle()
		flip("creatorNotes")
		await settle()
		expect(fromCard("creatorNotes")!.checked).toBe(true)
		expect(unsaved).toBe(false)
	})

	test("a card-less member: the three fields directly, no switch", () => {
		const { member, row } = cardless({
			postHistoryInstructions: "Own reminder."
		})
		mountForm(member, row)
		for (const f of ["postHistoryInstructions", "creatorNotes", "likeness"])
			expect(fromCard(f)).toBeNull()
		expect(area("postHistoryInstructions").disabled).toBe(false)
		expect(area("postHistoryInstructions").value).toBe("Own reminder.")
		expect(area("creatorNotes").disabled).toBe(false)
		expect(
			target!.querySelector("[data-cast-likeness] input")
		).not.toBeNull()
		expect(target!.textContent).not.toContain("card's reminder")
		expect(unsaved).toBe(false)
	})
})
