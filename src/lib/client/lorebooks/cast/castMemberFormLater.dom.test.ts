/**
 * The member form's footer on later cast versions (★CV-13) and its one
 * Greetings row.
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
	summary: "Keeps the inn.",
	retold: {}
}

let app: ReturnType<typeof mount> | null = null
let sent: { patch: Record<string, unknown>; options: unknown; kind: string }[]

beforeEach(() => {
	sent = []
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

async function mountForm(
	r: CastRow = row,
	extra: Record<string, unknown> = {}
) {
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(CastMemberForm, {
		target,
		props: {
			member: toCastMember(r),
			row: r,
			lorebookId: 1,
			hasUnsavedChanges: false,
			onSave: async (
				patch: Record<string, unknown>,
				_p: unknown,
				options: unknown
			) => {
				sent.push({ patch, options, kind: "base" })
				return true
			},
			onDelete: () => {},
			onLinkCharacter: () => {},
			onUnlink: () => {},
			...extra
		}
	})
	await settle()
}

const button = (label: RegExp) =>
	[...document.querySelectorAll("button")].find((b) =>
		label.test((b.textContent ?? "").trim())
	) as HTMLButtonElement | undefined

async function typeSummary(value: string) {
	const el = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
		'[id^="castSummary"]'
	)!
	el.value = value
	el.dispatchEvent(new Event("input", { bubbles: true }))
	await settle()
}

describe("Change later versions too", () => {
	test("hidden while the form is clean, even with later versions", async () => {
		await mountForm(row, { laterCounts: { base: 2, amend: 0 } })
		expect(document.querySelector("[data-later-versions]")).toBeNull()
	})

	test("dirty with later versions: the line and a pressed-state toggle; Save sends the flag, then it resets", async () => {
		await mountForm(row, { laterCounts: { base: 2, amend: 0 } })
		await typeSummary("Runs the inn.")
		const box = document.querySelector("[data-later-versions]")!
		expect(box.textContent).toContain(
			"2 later versions keep their own words."
		)
		const toggle = button(/^Change later versions too$/)!
		expect(toggle.getAttribute("aria-pressed")).toBe("false")
		toggle.click()
		await settle()
		expect(toggle.getAttribute("aria-pressed")).toBe("true")
		expect(toggle.className).toContain("preset-pressed")
		button(/^Save$/)!.click()
		await settle()
		expect(sent[0].options).toEqual({ changeLaterVersions: true })
		// Reset after the save.
		await typeSummary("Runs the inn well.")
		expect(
			button(/^Change later versions too$/)!.getAttribute("aria-pressed")
		).toBe("false")
		button(/^Save$/)!.click()
		await settle()
		expect(sent[1].options).toEqual({ changeLaterVersions: false })
	})

	test("one later version is said in the singular", async () => {
		await mountForm(row, { laterCounts: { base: 1, amend: 0 } })
		await typeSummary("Runs the inn.")
		expect(
			document.querySelector("[data-later-versions]")!.textContent
		).toContain("1 later version keeps its own words.")
	})

	test("no later versions: nothing to offer", async () => {
		await mountForm(row, { laterCounts: { base: 0, amend: 0 } })
		await typeSummary("Runs the inn.")
		expect(document.querySelector("[data-later-versions]")).toBeNull()
	})

	test("reading a moment: the line counts Save as of, and the amend carries the flag", async () => {
		const amended: unknown[] = []
		await mountForm(row, {
			laterCounts: { base: 5, amend: 1 },
			momentLabel: "Year 3",
			onAmend: async (_p: unknown, _q: unknown, options: unknown) => {
				amended.push(options)
				return true
			}
		})
		await typeSummary("Runs the inn.")
		expect(
			document.querySelector("[data-later-versions]")!.textContent
		).toContain("1 later version keeps its own words.")
		button(/^Change later versions too$/)!.click()
		await settle()
		button(/^Save as of Year 3$/)!.click()
		await settle()
		expect(amended).toEqual([{ changeLaterVersions: true }])
	})
})

describe("the Greetings row", () => {
	const retoldRow = (extra: Partial<CastRow> = {}): CastRow => ({
		...row,
		firstMessage: "Mine.",
		alternateGreetings: ["Second.", ""],
		retold: { firstMessage: true, alternateGreetings: true },
		...extra
	})
	const field = () =>
		document.querySelector<HTMLElement>('[data-retold-field="greetings"]')!

	test("one row replaces First message and Alternate greetings", async () => {
		await mountForm()
		const names = [...document.querySelectorAll("[data-retold-field]")].map(
			(e) => e.getAttribute("data-retold-field")
		)
		expect(names).toEqual([
			"description",
			"personality",
			"scenario",
			"greetings",
			"exampleDialogues"
		])
		const text = field().textContent ?? ""
		expect(text).toContain("Greetings")
		expect(text).toContain("Rooms are two silver.")
		expect(text).toContain("Back again?")
	})

	test("the toggle sets BOTH flags; an untouched toggle round trip stays clean", async () => {
		await mountForm()
		const control = field().querySelector<HTMLElement>(
			'[data-part="control"], input[type="checkbox"]'
		)!
		control.click()
		await settle()
		button(/^Save$/)!.click()
		await settle()
		expect(sent[0].patch).toMatchObject({
			firstMessage: "Rooms are two silver.",
			alternateGreetings: ["Back again?"],
			retold: { firstMessage: true, alternateGreetings: true }
		})
	})

	test("a retold list keeps every greeting as typed, empty ones too, and Add a greeting adds one", async () => {
		await mountForm(retoldRow())
		expect(field().querySelectorAll("textarea")).toHaveLength(3)
		button(/^Add a greeting$/)!.click()
		await settle()
		expect(field().querySelectorAll("textarea")).toHaveLength(4)
		button(/^Save$/)!.click()
		await settle()
		expect(sent[0].patch.firstMessage).toBe("Mine.")
		expect(sent[0].patch.alternateGreetings).toEqual(["Second.", "", ""])
	})

	test("a half-retold member shows the row as retold", async () => {
		await mountForm(retoldRow({ retold: { alternateGreetings: true } }))
		expect(field().querySelectorAll("textarea").length).toBeGreaterThan(0)
		expect(field().textContent).toContain("Take from card")
		expect(
			field().querySelector<HTMLInputElement>('input[type="checkbox"]')!
				.checked
		).toBe(false)
	})

	test("removing the first greeting promotes the next to the opener", async () => {
		await mountForm(retoldRow())
		field()
			.querySelector<HTMLButtonElement>(
				'button[aria-label="Remove greeting 1"]'
			)!
			.click()
		await settle()
		button(/^Save$/)!.click()
		await settle()
		expect(sent[0].patch.firstMessage).toBe("Second.")
		expect(sent[0].patch.alternateGreetings).toEqual([""])
	})

	test("marking a greeting Group sessions only sends groupOnlyGreetings on Save, the rest staying in the list", async () => {
		await mountForm(retoldRow({ alternateGreetings: ["Second."] }))
		const marks =
			field().querySelectorAll<HTMLInputElement>("input.checkbox")
		expect(marks).toHaveLength(2)
		expect(field().textContent).toContain("Group sessions only")
		marks[1].click()
		await settle()
		// The marked one stays in the list, ticked.
		const after =
			field().querySelectorAll<HTMLInputElement>("input.checkbox")
		expect(after).toHaveLength(2)
		expect(after[1].checked).toBe(true)
		expect(after[0].checked).toBe(false)
		expect(field().querySelectorAll("textarea")[1].value).toBe("Second.")
		button(/^Save$/)!.click()
		await settle()
		expect(sent[0].patch.groupOnlyGreetings).toEqual(["Second."])
		expect(sent[0].patch.firstMessage).toBe("Mine.")
		expect(sent[0].patch.alternateGreetings).toEqual([])
	})

	test("marked greetings load ticked, after the unmarked ones; an untouched form is clean", async () => {
		await mountForm(
			retoldRow({
				alternateGreetings: [],
				groupOnlyGreetings: ["Together."]
			}),
			{ laterCounts: { base: 1, amend: 0 } }
		)
		const boxes =
			field().querySelectorAll<HTMLInputElement>("input.checkbox")
		expect([...boxes].map((b) => b.checked)).toEqual([false, true])
		const areas = field().querySelectorAll("textarea")
		expect(areas[1].value).toBe("Together.")
		// Clean: nothing unsaved, so no later-versions line.
		expect(document.querySelector("[data-later-versions]")).toBeNull()
	})
})
