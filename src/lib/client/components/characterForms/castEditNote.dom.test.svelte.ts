/**
 * The editor's sentence under the cast line: in edit mode the real
 * `CharacterForm` asks `lorebooks:bindingsForCharacter` and names which cast
 * members editing the card changes, and in which books.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { listeners, listen, emitted } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	const emitted: Array<[string, any]> = []
	return {
		listeners,
		emitted,
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
	requestWithInterest: (k: string, _p: unknown, h: any) => listen(k, h)
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error() {}, info() {}, success() {}, warning() {} }
}))

import CharacterForm from "./CharacterForm.svelte"
import type { CastBannerMember } from "./castBannerWords"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	listeners.clear()
	emitted.length = 0
})
const settle = async () => {
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

const FIELDS: CastBannerMember["followsCard"] = [
	"description",
	"personality",
	"scenario",
	"firstMessage",
	"alternateGreetings",
	"exampleDialogues",
	"face",
	"postHistoryInstructions",
	"creatorNotes",
	"likeness"
]
const member = (
	lorebookId: number,
	lorebookName: string,
	followsCard: CastBannerMember["followsCard"]
): CastBannerMember => ({
	lorebookId,
	lorebookName,
	castId: lorebookId * 10,
	retold: FIELDS.filter((f) => !followsCard.includes(f)),
	followsCard,
	memberName: "Bianca"
})

const characterRow = {
	id: 7,
	name: "Bianca",
	nickname: null,
	description: "A harbour pilot.",
	personality: "",
	scenario: "",
	firstMessage: "",
	alternateGreetings: [],
	exampleDialogues: [],
	tags: [],
	extensions: {}
}

async function render(
	members: CastBannerMember[],
	shell: Array<[string, unknown]> = [],
	getExtra: object = {}
) {
	app = mount(CharacterForm, {
		target: document.body,
		props: { characterId: 7, isSafeToClose: false, closeForm: () => {} },
		context: new Map<string, unknown>([
			["userSettingsCtx", { settings: {} }],
			["systemSettingsCtx", { settings: {} }],
			["userCtx", { user: { id: 1, isAdmin: false } }],
			...shell
		])
	})
	flushSync()
	listeners.get("characters:get#7")!({ character: characterRow, ...getExtra })
	await settle()
	listeners.get("lorebooks:bindingsForCharacter")!({
		characterId: 7,
		members
	})
	await settle()
	return document.querySelector("[data-cast-edit-note]")
}

describe("the editor's sentence in CharacterForm", () => {
	test("a card in one book names the member and the book", async () => {
		const note = await render([
			member(1, "Porto Alto", ["description", "face"])
		])
		expect(note?.textContent).toContain(
			"Editing this changes Bianca in Porto Alto"
		)
		expect(note?.textContent).toContain("their personality")
	})

	test("a card in two books names both", async () => {
		const note = await render([
			member(1, "Porto Alto", FIELDS),
			member(2, "The Shared House", FIELDS)
		])
		expect(note?.textContent?.trim()).toBe(
			"Editing this changes Bianca in Porto Alto and The Shared House."
		)
	})

	test("a member that retells every field makes no sentence", async () => {
		const note = await render([member(1, "Porto Alto", [])])
		expect(note).toBeNull()
	})

	test("outside the shell the book names are plain text", async () => {
		const note = await render([member(1, "Porto Alto", FIELDS)])
		expect(note?.querySelector("button")).toBeNull()
	})

	test("with the shell a book name is a link that opens that member", async () => {
		const digest: Record<string, unknown> = {}
		const openPanel = vi.fn()
		const note = await render(
			[member(1, "Porto Alto", FIELDS), member(2, "Lisbon", FIELDS)],
			[["panelsCtx", { digest, openPanel }]]
		)
		const buttons = [...note!.querySelectorAll("button")]
		expect(buttons.map((b) => b.textContent)).toEqual([
			"Porto Alto",
			"Lisbon"
		])
		expect(buttons[0].classList.contains("text-primary-ink")).toBe(true)
		expect(buttons[0].getAttribute("aria-label")).toBe(
			"Open this card's cast member in Porto Alto"
		)
		expect(note?.textContent?.trim()).toBe(
			"Editing this changes Bianca in Porto Alto and Lisbon."
		)
		buttons[1].click()
		expect(digest.lore).toEqual({
			lorebookId: 2,
			scope: "cast",
			castId: 20
		})
		expect(openPanel).toHaveBeenCalledWith({
			key: "lorebooks",
			toggle: false
		})
	})
})

describe("the editor's sentence for the version being edited", () => {
	const v1 = { id: 10, number: 1, label: "1.0" }
	const v2 = { id: 11, number: 2, label: "1.1" }
	const editing = {
		cardVersions: [v1, v2],
		cardVersionId: 11,
		currentCardVersionId: 11
	}
	const on = (
		m: CastBannerMember,
		name: string,
		cardVersion: CastBannerMember["cardVersion"]
	): CastBannerMember => ({ ...m, memberName: name, cardVersion })

	test("names only the member on the edited version; the line names both books", async () => {
		const note = await render(
			[
				on(member(1, "Porto Alto", FIELDS), "Ines", v1),
				on(member(2, "Lisbon", FIELDS), "Bianca", v2)
			],
			[],
			editing
		)
		expect(note?.textContent?.trim()).toBe(
			"Editing this changes Bianca in Lisbon."
		)
		const line = document.querySelector("[data-cast-line]")
		expect(line?.textContent).toContain("Porto Alto")
		expect(line?.textContent).toContain("Lisbon")
	})

	test("only a member on another version: no sentence, the line stays", async () => {
		const note = await render(
			[on(member(1, "Porto Alto", FIELDS), "Ines", v1)],
			[],
			editing
		)
		expect(note).toBeNull()
		expect(document.querySelector("[data-cast-line]")).not.toBeNull()
	})
})
