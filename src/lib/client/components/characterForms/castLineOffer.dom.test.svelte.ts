/** The cast line's offer: **Update ‹name› to card v1.1** under the line, only for a member behind its card. */
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

import CastLine from "./CastLine.svelte"
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
}

const v1 = { id: 1, number: 1, label: null }
const v11 = { id: 2, number: 2, label: "1.1" }
const member = (behind: boolean): CastBannerMember => ({
	lorebookId: 1,
	lorebookName: "Porto Alto",
	castId: 10,
	retold: [],
	followsCard: [],
	memberName: "Bianca",
	cardVersion: behind ? v1 : v11,
	cardCurrentVersion: v11,
	behindCard: behind
})

const render = (members: CastBannerMember[], onChanged?: () => void) => {
	app = mount(CastLine, {
		target: document.body,
		props: { members, onChanged }
	})
	flushSync()
}
const button = () =>
	[...document.querySelectorAll("button")].find((b) =>
		b.textContent?.includes("Update Bianca")
	)

describe("CastLine offer", () => {
	test("a member behind its card is offered the update, under the line", () => {
		render([member(true)])
		expect(button()?.textContent?.trim()).toBe("Update Bianca to card v1.1")
		const line = document.querySelector("[data-cast-line]")!
		expect(line.contains(button()!)).toBe(false)
	})

	test("a member on the current version has no offer", () => {
		render([member(false)])
		expect(document.querySelector("[data-card-update-offer]")).toBeNull()
		expect(document.querySelector("[data-cast-line]")).not.toBeNull()
	})

	test("a reply fires onChanged so the parent asks again", async () => {
		const onChanged = vi.fn()
		render([member(true)], onChanged)
		button()!.click()
		await settle()
		expect(emitted).toEqual([
			["lorebooks:updateMemberToCardVersion", { castId: 10 }]
		])
		listeners.get("lorebooks:updateMemberToCardVersion#1")!({
			lorebookId: 1,
			castId: 10,
			moved: 1,
			cardVersion: v11,
			lorebookBinding: {}
		})
		await settle()
		expect(onChanged).toHaveBeenCalledTimes(1)
	})
})
