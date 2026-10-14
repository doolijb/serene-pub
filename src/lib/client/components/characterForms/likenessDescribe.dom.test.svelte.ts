/**
 * 🚧 The Likeness tab's **Describe from image** (DESIGN-image-generation §5;
 * D1): the button appears only when the server says a model that reads
 * pictures is set up (the probe's `available`), never greyed out otherwise;
 * a press sends the form's picture and fills the Likeness prompt field with
 * the answer, without saving.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))

const { listeners, emitted, socket } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	const emitted: Array<[string, any]> = []
	return {
		listeners,
		emitted,
		socket: {
			emit: (event: string, data: any) => {
				emitted.push([event, data])
			},
			on: () => {},
			off: () => {}
		}
	}
})

vi.mock("$lib/client/sockets/typedSocket", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (msg: any) => void) => {
		listeners.set(key, handler)
		return () => {
			if (listeners.get(key) === handler) listeners.delete(key)
		}
	}
}))

import LikenessTab from "./LikenessTab.svelte"
import { interestKey } from "$lib/shared/sockets/interest"

const CHARACTER = 7
const KEY = interestKey("characters:describeLikeness", CHARACTER)

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	emitted.length = 0
	document.body.innerHTML = ""
})

function deliver(key: string, msg: unknown) {
	const handler = listeners.get(key)
	if (!handler) throw new Error(`nothing listens on ${key}`)
	handler(msg)
	flushSync()
}

const describeButton = () =>
	[...document.querySelectorAll("button")].find((b) =>
		/Describe from image/.test(b.textContent ?? "")
	)

async function open() {
	const props = $state({
		characterId: CHARACTER,
		active: true,
		avatarUrl: "/avatar.png",
		likeness: { prompt: "", negative: "" } as {
			imageMediaId?: number
			prompt: string
			negative: string
		}
	})
	app = mount(LikenessTab, { target: document.body, props })
	await tick()
	flushSync()
	return props
}

describe("Describe from image", () => {
	test("asks whether it can run, and stays hidden when no model reads pictures", async () => {
		await open()
		expect(emitted).toContainEqual([
			"characters:describeLikeness",
			{ characterId: CHARACTER, probe: true }
		])
		deliver(KEY, { characterId: CHARACTER, available: false })
		expect(describeButton()).toBeUndefined()
	})

	test("appears with the pair, and a press fills the Likeness prompt field", async () => {
		const props = await open()
		expect(describeButton()).toBeUndefined()
		deliver(KEY, { characterId: CHARACTER, available: true })
		const button = describeButton()
		expect(button).toBeDefined()

		button!.click()
		flushSync()
		// The form's picture: the avatar, as nothing else is picked.
		expect(emitted.at(-1)).toEqual([
			"characters:describeLikeness",
			{ characterId: CHARACTER, imageMediaId: null }
		])
		expect(describeButton()).toBeUndefined() // reads "Describing…" meanwhile

		deliver(KEY, {
			characterId: CHARACTER,
			available: true,
			prompt: "adult woman, red braid, freckles"
		})
		expect(props.likeness.prompt).toBe("adult woman, red braid, freckles")
		const input = document.getElementById("charLikenessPrompt") as HTMLInputElement
		expect(input.value).toBe("adult woman, red braid, freckles")
	})

	test("an answer to a press made elsewhere does not fill this form", async () => {
		const props = await open()
		deliver(KEY, { characterId: CHARACTER, available: true, prompt: "someone else's" })
		expect(props.likeness.prompt).toBe("")
	})
})
