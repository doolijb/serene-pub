/**
 * The profile's cast line: the real `CharacterViewPanel` asks
 * `lorebooks:bindingsForCharacter` and shows the cast line under the hero
 * only when this card is a cast member somewhere.
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

import CharacterViewPanel from "./CharacterViewPanel.svelte"
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
	isOwner: true,
	sharedWith: [],
	extensions: {}
}

const member = (
	lorebookId: number,
	lorebookName: string
): CastBannerMember => ({
	lorebookId,
	lorebookName,
	castId: lorebookId * 10,
	retold: [],
	followsCard: [],
	memberName: "Bianca"
})

async function render(members: CastBannerMember[]) {
	app = mount(CharacterViewPanel, {
		target: document.body,
		props: { characterId: 7, onEdit: () => {}, onSession: () => {} },
		context: new Map<string, unknown>([
			["systemSettingsCtx", { settings: {} }]
		])
	})
	flushSync()
	listeners.get("characters:get#7")!({ character: characterRow })
	await settle()
	listeners.get("lorebooks:bindingsForCharacter")!({
		characterId: 7,
		members
	})
	await settle()
	return document.querySelector("[data-cast-line]")
}

describe("the profile's cast line in CharacterViewPanel", () => {
	test("a card with one cast member says so and names the book", async () => {
		const line = await render([member(1, "Porto Alto")])
		expect(line?.textContent).toContain("In 1 lorebook:")
		expect(line?.textContent).toContain("Porto Alto")
	})

	test("a card in none of your lorebooks has no cast line", async () => {
		const line = await render([])
		expect(document.body.textContent).toContain("Bianca")
		expect(line).toBeNull()
	})
})
