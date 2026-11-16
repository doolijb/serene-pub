/**
 * 🚧 The member form with the book's Timeline switch off: no later-version
 * line and no dated card change; the plain Save stays. On, a railed form
 * offers Save and Save as a new version….
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

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
import { bookDataContext, staticBookData } from "../bookData.svelte"
import CastMemberForm from "./CastMemberForm.svelte"
import { toCastMember, type CastRow } from "../castPool"

const row: CastRow = {
	id: 3,
	binding: "{{char:1}}",
	characterId: null,
	character: null,
	name: "Maren",
	summary: "Keeps the inn.",
	retold: {}
} as CastRow

let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
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

async function mountForm(timelineEnabled: boolean) {
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(CastMemberForm, {
		target,
		props: {
			member: toCastMember(row),
			row,
			lorebookId: 1,
			hasUnsavedChanges: false,
			onSave: async () => true,
			...(timelineEnabled ? { onSaveNew: async () => true } : {}),
			momentLabel: "Year 3",
			laterCounts: { base: 2 },
			onDelete: () => {},
			onLinkCharacter: () => {},
			onUnlink: () => {}
		},
		context: bookDataContext(
			staticBookData(() => ({ lorebookId: 1, timelineEnabled }))
		)
	})
	await settle()
	const el = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
		'[id^="castSummary"]'
	)!
	el.value = "Runs the inn."
	el.dispatchEvent(new Event("input", { bubbles: true }))
	await settle()
}

const button = (label: RegExp) =>
	[...document.querySelectorAll("button")].find((b) =>
		label.test((b.textContent ?? "").trim())
	)

describe("the member form's save", () => {
	test("on: Save, Save as a new version… and the later-version line", async () => {
		await mountForm(true)
		expect(!!button(/^Save$/)).toBe(true)
		expect(!!button(/^Save as a new version…$/)).toBe(true)
		expect(!!document.querySelector("[data-later-versions]")).toBe(true)
	})

	test("off: the plain Save alone, and nothing about later versions", async () => {
		await mountForm(false)
		expect(!!button(/^Save as a new version/)).toBe(false)
		expect(!!document.querySelector("[data-later-versions]")).toBe(false)
		expect(!!document.querySelector("[data-later-versions-outright]")).toBe(
			false
		)
		expect(!!button(/^Save$/)).toBe(true)
		expect(!!document.querySelector("[data-cast-card-dated]")).toBe(false)
	})
})
