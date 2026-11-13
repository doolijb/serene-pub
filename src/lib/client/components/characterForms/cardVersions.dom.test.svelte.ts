import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { listeners, listen, emitted, asked } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	const emitted: Array<[string, any]> = []
	const asked: string[] = []
	return {
		listeners,
		emitted,
		asked,
		listen: (key: string, handler: (msg: any) => void) => {
			listeners.set(key, handler)
			return () => {
				if (listeners.get(key) === handler) listeners.delete(key)
			}
		}
	}
})
const socket = {
	emit: (e: string, p: any) => {
		emitted.push([e, p])
	},
	on: () => {},
	off: () => {}
}
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/typedSocket", async (importOriginal) => ({
	...(await importOriginal<object>()),
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen,
	requestWithInterest: (k: string, _p: unknown, h: any) => {
		asked.push(k)
		return listen(k, h)
	}
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error() {}, info() {}, success() {}, warning() {} }
}))

import CharacterForm from "./CharacterForm.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	listeners.clear()
	emitted.length = 0
	asked.length = 0
})
const settle = async () => {
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

const versions = [
	{ id: 10, number: 1, label: "1.0" },
	{ id: 11, number: 2, label: "1.1" }
]
const row = {
	id: 7,
	name: "Bianca",
	nickname: null,
	description: "A harbour pilot.",
	personality: "",
	scenario: "",
	firstMessage: "Ahoy.",
	alternateGreetings: ["Hello there."],
	groupOnlyGreetings: ["Hello, all."],
	exampleDialogues: [],
	creatorNotes: "Hello",
	creatorNotesMultilingual: { en: "Hello", fr: "Bonjour" },
	characterVersion: "1.1",
	tags: [],
	extensions: {}
}
const getReply = (extra: object = {}) => ({
	character: row,
	cardVersionId: 11,
	currentCardVersionId: 11,
	cardVersions: versions,
	...extra
})

async function render(
	opts: {
		advanced?: boolean
		shell?: Array<[string, unknown]>
		closeForm?: () => void
	} = {}
) {
	app = mount(CharacterForm, {
		target: document.body,
		props: {
			characterId: 7,
			isSafeToClose: false,
			closeForm: opts.closeForm ?? (() => {})
		},
		context: new Map<string, unknown>([
			[
				"userSettingsCtx",
				{ settings: { showAdvancedControls: !!opts.advanced } }
			],
			["systemSettingsCtx", { settings: {} }],
			["userCtx", { user: { id: 1, isAdmin: false } }],
			...(opts.shell ?? [])
		])
	})
	flushSync()
	listeners.get("characters:get#7")!(getReply())
	await settle()
}
const picker = () =>
	document.querySelector<HTMLSelectElement>(
		'select[aria-label="Card version"]'
	)
const lastUpdate = () =>
	emitted.filter(([e]) => e === "characters:update").at(-1)?.[1]
const button = (text: string) =>
	[...document.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === text
	) as HTMLButtonElement | undefined
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
	el.value = value
	el.dispatchEvent(new Event("input", { bubbles: true }))
	flushSync()
}

describe("the card version picker", () => {
	test("lists the versions, the current one marked, shown one selected", async () => {
		await render()
		const select = picker()!
		expect([...select.options].map((o) => o.textContent?.trim())).toEqual([
			"v1.0",
			"v1.1 · current"
		])
		expect(select.value).toBe("11")
		expect(document.querySelector("[data-card-version-note]")).toBeNull()
	})

	test("absent for a card with one version", async () => {
		await render()
		listeners.get("characters:get#7") // consumed already
		unmount(app!)
		document.body.innerHTML = ""
		app = mount(CharacterForm, {
			target: document.body,
			props: {
				characterId: 7,
				isSafeToClose: false,
				closeForm: () => {}
			},
			context: new Map<string, unknown>([
				["userSettingsCtx", { settings: {} }],
				["systemSettingsCtx", { settings: {} }],
				["userCtx", { user: { id: 1, isAdmin: false } }]
			])
		})
		flushSync()
		listeners.get("characters:get#7")!(
			getReply({ cardVersions: [versions[1]] })
		)
		await settle()
		expect(picker()).toBeNull()
	})

	test("picking another version re-asks with its id and loads it clean", async () => {
		await render()
		const select = picker()!
		select.value = "10"
		select.dispatchEvent(new Event("change", { bubbles: true }))
		await settle()
		expect(emitted.at(-1)).toEqual([
			"characters:get",
			{ id: 7, cardVersionId: 10 }
		])
		listeners.get("characters:get#7")!(
			getReply({
				cardVersionId: 10,
				character: {
					...row,
					name: "Bianca (old)",
					characterVersion: "1.0"
				}
			})
		)
		await settle()
		expect(picker()!.value).toBe("10")
		expect(
			document
				.querySelector("[data-card-version-note]")
				?.textContent?.trim()
		).toBe("Saving changes v1.0 in place; v1.1 is the current version.")
		expect(
			document.querySelector<HTMLInputElement>("#charName")?.value
		).toBe("Bianca (old)")
		expect(document.body.textContent).not.toContain("Unsaved changes")
	})

	test("unsaved changes ask first and do not re-send", async () => {
		await render()
		type(document.querySelector<HTMLInputElement>("#charName")!, "Changed")
		await settle()
		const before = emitted.length
		const select = picker()!
		select.value = "10"
		select.dispatchEvent(new Event("change", { bubbles: true }))
		await settle()
		expect(emitted.length).toBe(before)
		expect(select.value).toBe("11")
		expect(document.body.textContent).toContain("Discard unsaved changes?")
	})

	test("a save writes the shown version", async () => {
		await render()
		type(document.querySelector<HTMLInputElement>("#charName")!, "Changed")
		await settle()
		button("Save")!.click()
		await settle()
		expect(lastUpdate().cardVersionId).toBe(11)
		expect(lastUpdate().saveAsNewVersion).toBeUndefined()
	})
})

describe("Save as new version", () => {
	test("the dialog is prefilled from the highest version and sends the shown one", async () => {
		await render()
		// Show the older version, so the shown one differs from the highest.
		const select = picker()!
		select.value = "10"
		select.dispatchEvent(new Event("change", { bubbles: true }))
		await settle()
		listeners.get("characters:get#7")!(getReply({ cardVersionId: 10 }))
		await settle()
		button("Save as new version")!.click()
		await settle()
		const label =
			document.querySelector<HTMLInputElement>("#newVersionLabel")!
		expect(label.value).toBe("1.2")
		type(label, "  2.0 ")
		document
			.querySelector<HTMLButtonElement>("[data-new-version-confirm]")!
			.click()
		await settle()
		expect(lastUpdate().cardVersionId).toBe(10)
		expect(lastUpdate().saveAsNewVersion).toEqual({ label: "2.0" })
	})

	test("an empty label is sent as null", async () => {
		await render()
		button("Save as new version")!.click()
		await settle()
		type(document.querySelector<HTMLInputElement>("#newVersionLabel")!, "")
		document
			.querySelector<HTMLButtonElement>("[data-new-version-confirm]")!
			.click()
		await settle()
		expect(lastUpdate().saveAsNewVersion).toEqual({ label: null })
	})

	test("staying members keep the form open on the new version, each a link", async () => {
		const closeForm = vi.fn()
		const digest: Record<string, unknown> = {}
		const openPanel = vi.fn()
		await render({
			closeForm,
			shell: [["panelsCtx", { digest, openPanel }]]
		})
		button("Save as new version")!.click()
		await settle()
		document
			.querySelector<HTMLButtonElement>("[data-new-version-confirm]")!
			.click()
		await settle()
		const newVersions = [...versions, { id: 12, number: 3, label: "1.2" }]
		listeners.get("characters:update")!({
			character: row,
			cardVersionId: 12,
			currentCardVersionId: 12,
			cardVersions: newVersions,
			staying: [
				{
					castMemberId: 1,
					lorebookId: 4,
					name: "Bianca",
					cardVersionId: 11,
					label: "1.1"
				},
				{
					castMemberId: 2,
					lorebookId: 5,
					name: "Theo",
					cardVersionId: 11,
					label: "1.1"
				}
			]
		})
		await settle()
		expect(closeForm).not.toHaveBeenCalled()
		expect(emitted.at(-1)).toEqual([
			"characters:get",
			{ id: 7, cardVersionId: 12 }
		])
		const line = document.querySelector("[data-staying-line]")!
		expect(line.textContent?.replace(/\s+/g, " ").trim()).toBe(
			"2 cast members stay on v1.1: Bianca, Theo."
		)
		;[...line.querySelectorAll("button")][1].click()
		expect(digest.lore).toEqual({ lorebookId: 5, scope: "cast", castId: 2 })
		expect(openPanel).toHaveBeenCalledWith({
			key: "lorebooks",
			toggle: false
		})
	})

	test("no staying members: the form closes as before", async () => {
		const closeForm = vi.fn()
		await render({ closeForm })
		button("Save as new version")!.click()
		await settle()
		document
			.querySelector<HTMLButtonElement>("[data-new-version-confirm]")!
			.click()
		await settle()
		listeners.get("characters:update")!({
			character: row,
			cardVersionId: 12,
			currentCardVersionId: 12,
			cardVersions: versions
		})
		await settle()
		expect(closeForm).toHaveBeenCalled()
	})

	test("a save from another tab does not keep the form open", async () => {
		const closeForm = vi.fn()
		await render({ closeForm })
		listeners.get("characters:update")!({
			character: row,
			cardVersionId: 12,
			currentCardVersionId: 12,
			cardVersions: versions,
			staying: [
				{
					castMemberId: 1,
					lorebookId: 4,
					name: "Bianca",
					cardVersionId: 11,
					label: "1.1"
				}
			]
		})
		await settle()
		expect(document.querySelector("[data-staying-line]")).toBeNull()
	})

	const behindReply = {
		characterId: 7,
		lorebooks: [],
		members: [
			{
				lorebookId: 4,
				lorebookName: "Porto Alto",
				castId: 1,
				retold: [],
				followsCard: [],
				memberName: "Bianca",
				cardVersion: { id: 11, number: 2, label: "1.1" },
				cardCurrentVersion: { id: 12, number: 3, label: "1.2" },
				behindCard: true
			}
		]
	}
	const bindingAsks = () =>
		asked.filter((k) => k === "lorebooks:bindingsForCharacter").length

	test("after the save the cast line asks again and shows the update offer", async () => {
		await render()
		listeners.get("lorebooks:bindingsForCharacter")!({
			characterId: 7,
			lorebooks: [],
			members: []
		})
		await settle()
		const before = bindingAsks()
		button("Save as new version")!.click()
		await settle()
		document
			.querySelector<HTMLButtonElement>("[data-new-version-confirm]")!
			.click()
		await settle()
		listeners.get("characters:update")!({
			character: row,
			cardVersionId: 12,
			currentCardVersionId: 12,
			cardVersions: [...versions, { id: 12, number: 3, label: "1.2" }],
			staying: [
				{
					castMemberId: 1,
					lorebookId: 4,
					name: "Bianca",
					cardVersionId: 11,
					label: "1.1"
				}
			]
		})
		await settle()
		expect(bindingAsks()).toBe(before + 1)
		listeners.get("lorebooks:bindingsForCharacter")!(behindReply)
		await settle()
		expect(document.body.textContent).toContain(
			"Update Bianca to card v1.2"
		)
	})

	test("a save from another tab does not ask again", async () => {
		await render()
		const before = bindingAsks()
		listeners.get("characters:update")!({
			character: row,
			cardVersionId: 12,
			currentCardVersionId: 12,
			cardVersions: versions
		})
		await settle()
		expect(bindingAsks()).toBe(before)
	})
})

describe("greetings", () => {
	test("one list: opener, alternates, group-only marked; saved back as the columns", async () => {
		await render({ advanced: true })
		const areas = [
			...document.querySelectorAll<HTMLTextAreaElement>(
				'textarea[aria-label^="Greeting "]'
			)
		]
		expect(areas.map((a) => a.value)).toEqual([
			"Ahoy.",
			"Hello there.",
			"Hello, all."
		])
		const marks = [
			...document.querySelectorAll<HTMLInputElement>(
				'input[type="checkbox"]'
			)
		].filter((c) =>
			c.closest("label")?.textContent?.includes("Group sessions only")
		)
		expect(marks.map((m) => m.checked)).toEqual([false, false, true])
		button("Add a greeting")!.click()
		await settle()
		expect(
			document.querySelectorAll('textarea[aria-label^="Greeting "]')
		).toHaveLength(4)
		document
			.querySelector<HTMLButtonElement>(
				'button[aria-label="Remove greeting 4"]'
			)!
			.click()
		await settle()
		expect(document.body.textContent).not.toContain("Unsaved changes")
		// toggling the mark and back is clean
		marks[0].click()
		await settle()
		expect(document.body.textContent).toContain("Unsaved changes")
		;[
			...document.querySelectorAll<HTMLInputElement>(
				'input[type="checkbox"]'
			)
		]
			.filter((c) =>
				c.closest("label")?.textContent?.includes("Group sessions only")
			)[0]
			.click()
		await settle()
		expect(document.body.textContent).not.toContain("Unsaved changes")
		type(
			document.querySelector<HTMLTextAreaElement>(
				'textarea[aria-label="Greeting 1"]'
			)!,
			"Ahoy!"
		)
		await settle()
		button("Save")!.click()
		await settle()
		expect(lastUpdate().character).toMatchObject({
			firstMessage: "Ahoy!",
			alternateGreetings: ["Hello there."],
			groupOnlyGreetings: ["Hello, all."]
		})
	})

	test("the simplified form shows only the first greeting", async () => {
		await render()
		expect(
			document.querySelectorAll('textarea[aria-label^="Greeting "]')
		).toHaveLength(0)
		expect(
			document.querySelector<HTMLTextAreaElement>("#charFirstMessage")
				?.value
		).toBe("Ahoy.")
		expect(button("Add a greeting")).toBeUndefined()
	})
})

describe("creator notes by language", () => {
	test("loads the main language and the other languages, saves them back", async () => {
		await render({ advanced: true })
		expect(
			document.querySelector<HTMLInputElement>(
				'input[aria-label="Language of these notes"]'
			)?.value
		).toBe("en")
		expect(
			document.querySelector<HTMLInputElement>(
				'input[aria-label="Language 1"]'
			)?.value
		).toBe("fr")
		type(
			document.querySelector<HTMLTextAreaElement>("#charCreatorNotes")!,
			"Hi"
		)
		await settle()
		button("Save")!.click()
		await settle()
		expect(lastUpdate().character).toMatchObject({
			creatorNotes: "Hi",
			creatorNotesMultilingual: { en: "Hi", fr: "Bonjour" }
		})
	})

	test("a duplicate language is an error on the field and blocks the save", async () => {
		await render({ advanced: true })
		const before = emitted.length
		type(
			document.querySelector<HTMLInputElement>(
				'input[aria-label="Language 1"]'
			)!,
			"EN"
		)
		await settle()
		button("Save")!.click()
		await settle()
		expect(emitted.length).toBe(before)
		expect(document.body.textContent).toContain(
			'Language "en" is named twice.'
		)
	})
})
