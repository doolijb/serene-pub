/**
 * A carded member's name, nickname and face on the member page (playtest
 * §0-D): editable behind a Use from card switch, shown in this book
 * only. A member with no card keeps the single Name input.
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

function mountForm(member: any, row: any, extra: Record<string, unknown> = {}) {
	const userId = 1
	setSocket({
		connected: true,
		id: "tab-a",
		on() {},
		off() {},
		emit() {}
	} as any)
	setInterestUser({ id: userId })
	target = document.createElement("div")
	document.body.appendChild(target)
	mounted = mount(CastMemberForm, {
		target,
		props: {
			member,
			row,
			lorebookId: 5,
			hasUnsavedChanges: false,
			onSave: async () => true,
			...extra,
			onDelete: () => {},
			onLinkCharacter: () => {},
			onUnlink: () => {}
		},
		context: new Map<string, any>([
			["panelsCtx", { digest: {}, openView: vi.fn() }],
			["userCtx", { user: { id: 1 } }]
		])
	})
	flushSync()
}

function type(id: string, value: string) {
	const el = target!.querySelector<HTMLInputElement>(`#${id}`)!
	el.value = value
	el.dispatchEvent(new Event("input", { bubbles: true }))
	flushSync()
}

function input(base: string) {
	return target!.querySelector<HTMLInputElement>(`#${base}-${MEMBER_ID}`)!
}

function switchInput(base: string) {
	return target!.querySelector<HTMLInputElement>(
		`input[name="${base}-${MEMBER_ID}-fromCard"]`
	)!
}

function switchOn(base: string) {
	return switchInput(base).checked
}

/** Toggle a Use from card switch by clicking its control. */
function flip(base: string) {
	const root = switchInput(base).closest<HTMLElement>("label, [data-scope]")!
	;(root.querySelector<HTMLElement>('[data-part="control"]') ?? root).click()
	flushSync()
}

function buttonNamed(label: string): HTMLButtonElement | null {
	const all = Array.from(target!.querySelectorAll("button"))
	return all.find((b) => (b.textContent ?? "").trim() === label) ?? null
}

afterEach(() => {
	if (mounted) unmount(mounted)
	mounted = null
	target?.remove()
	target = null
	_resetInterestForTests()
})

const linked = (own: Record<string, unknown> = {}) => {
	const character = { id: 42, userId: 1, name: "Verity", nickname: "Vee" }
	const row = {
		id: MEMBER_ID,
		name: "Verity",
		linked: true,
		aliases: [],
		presences: [],
		characterId: 42,
		character,
		...own
	}
	return { member: row, row }
}

describe("CastMemberForm name, nickname and face", () => {
	test("a linked member: Name / Nickname switches on, inputs disabled showing the card's values, a Face row, the purpose line", () => {
		const { member, row } = linked()
		mountForm(member, row)
		const name = input("castOwnName")
		const nick = input("castOwnNickname")
		expect(switchOn("castOwnName")).toBe(true)
		expect(switchOn("castOwnNickname")).toBe(true)
		expect(name.disabled).toBe(true)
		expect(nick.disabled).toBe(true)
		expect(name.value).toBe("Verity")
		expect(nick.value).toBe("Vee")
		expect(target!.querySelector("[data-cast-change-face]")).not.toBeNull()
		const text = target!.textContent ?? ""
		expect(text).toContain("Use from card")
		expect(text).toContain(
			"Shown in this book only; the card keeps its own."
		)
		expect(text).not.toContain("from the character card")
		expect(buttonNamed("Edit card")).toBeNull()
		expect(buttonNamed("Open card")).toBeNull()
		expect(target!.querySelector(`#castName-${MEMBER_ID}`)).toBeNull()
	})

	test("an own name typed leaves the Nickname showing the card's nickname", () => {
		const { member, row } = linked()
		mountForm(member, row)
		flip("castOwnName")
		type(`castOwnName-${MEMBER_ID}`, "Veritas")
		expect(input("castOwnNickname").value).toBe("Vee")
		expect(input("castOwnNickname").disabled).toBe(true)
	})

	test("switching Name off keeps the card's value to edit; Save hands ownName, nickname stays null", async () => {
		const { member, row } = linked()
		const onSave = vi.fn(async () => true)
		mountForm(member, row, { onSave })
		flip("castOwnName")
		expect(input("castOwnName").disabled).toBe(false)
		expect(input("castOwnName").value).toBe("Verity")
		type(`castOwnName-${MEMBER_ID}`, "  Veritas ")
		buttonNamed("Save")!.click()
		await Promise.resolve()
		expect(onSave).toHaveBeenCalledTimes(1)
		expect((onSave.mock.calls[0] as any)[0].ownName).toBe("Veritas")
		expect((onSave.mock.calls[0] as any)[0].ownNickname).toBeNull()
	})

	test("switching an own name back on saves null", async () => {
		const { member, row } = linked({ ownName: "Veritas" })
		const onSave = vi.fn(async () => true)
		mountForm(member, row, { onSave })
		expect(switchOn("castOwnName")).toBe(false)
		expect(input("castOwnName").value).toBe("Veritas")
		flip("castOwnName")
		expect(switchOn("castOwnName")).toBe(true)
		buttonNamed("Save")!.click()
		await Promise.resolve()
		expect((onSave.mock.calls[0] as any)[0].ownName).toBeNull()
	})

	test("Nickname switched off and cleared saves an empty nickname", async () => {
		const { member, row } = linked()
		const onSave = vi.fn(async () => true)
		mountForm(member, row, { onSave })
		flip("castOwnNickname")
		expect(input("castOwnNickname").value).toBe("Vee")
		type(`castOwnNickname-${MEMBER_ID}`, "")
		buttonNamed("Save")!.click()
		await Promise.resolve()
		expect((onSave.mock.calls[0] as any)[0].ownNickname).toBe("")
		expect((onSave.mock.calls[0] as any)[0].ownName).toBeNull()
	})

	test("a stored empty nickname draws the switch off and the input empty", () => {
		const { member, row } = linked({ ownNickname: "" })
		mountForm(member, row)
		expect(switchOn("castOwnNickname")).toBe(false)
		expect(input("castOwnNickname").disabled).toBe(false)
		expect(input("castOwnNickname").value).toBe("")
	})

	test("Name off and blank disables Save", () => {
		const { member, row } = linked()
		mountForm(member, row)
		flip("castOwnName")
		expect(buttonNamed("Save")!.disabled).toBe(false)
		type(`castOwnName-${MEMBER_ID}`, "  ")
		expect(buttonNamed("Save")!.disabled).toBe(true)
		flip("castOwnName")
		expect(buttonNamed("Save")!.disabled).toBe(false)
	})

	test("reading a moment: a dirty own name disables the dated save", () => {
		const { member, row } = linked()
		mountForm(member, row, {
			onAmend: async () => true,
			momentLabel: "Year 3"
		})
		const dated = () => buttonNamed("Save as of Year 3")!
		expect(dated().disabled).toBe(false)
		flip("castOwnName")
		type(`castOwnName-${MEMBER_ID}`, "Veritas")
		expect(dated().disabled).toBe(true)
		expect(dated().title).toBe(
			"A name in this book is not dated: Save keeps it for every moment"
		)
	})

	test("no card: the Name input stays, no own-name trio", () => {
		const row = {
			id: MEMBER_ID,
			name: "Oren",
			linked: false,
			aliases: [],
			presences: [],
			characterId: null,
			character: null
		}
		mountForm(row, row)
		expect(target!.querySelector(`#castName-${MEMBER_ID}`)).not.toBeNull()
		expect(target!.querySelector(`#castOwnName-${MEMBER_ID}`)).toBeNull()
		expect(target!.querySelector("[data-cast-change-face]")).toBeNull()
	})
})
