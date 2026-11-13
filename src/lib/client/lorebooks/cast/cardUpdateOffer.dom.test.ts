/**
 * The Update offer (B1): shown by the caller only when a member is behind its
 * card; a press asks the server, waits, and says a refusal inline — never by
 * toast.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
const toaster = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	warning: vi.fn()
}))
vi.mock("$lib/client/utils/toaster", () => ({ toaster }))

const handlers = new Map<string, (data: any) => void>()
vi.mock("$lib/client/sockets/interest.svelte", async (orig) => ({
	...(await orig<object>()),
	declareInterest: (key: string, handler: (data: any) => void) => {
		handlers.set(key, handler)
		return () => handlers.delete(key)
	}
}))

import { setSocket } from "$lib/client/sockets/socketInstance"
import { interestKey } from "$lib/shared/sockets/interest"
import CardUpdateOffer from "./CardUpdateOffer.svelte"

let app: ReturnType<typeof mount> | null = null
let emits: { event: string; payload: any }[]

beforeEach(() => {
	emits = []
	handlers.clear()
	toaster.success.mockClear()
	toaster.error.mockClear()
	setSocket({
		connected: true,
		id: "t",
		on() {},
		off() {},
		emit(event: string, payload: any) {
			emits.push({ event, payload })
		}
	} as never)
})

afterEach(() => {
	if (app) unmount(app)
	app = null
	setSocket(null)
	document.body.innerHTML = ""
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

async function mountOffer() {
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(CardUpdateOffer, {
		target,
		props: {
			castId: 10,
			lorebookId: 5,
			memberName: "Bianca",
			cardVersion: { id: 1, number: 1, label: "1.0" },
			cardCurrentVersion: { id: 2, number: 2, label: "1.1" }
		}
	})
	await settle()
}

const text = (el: Element | null) =>
	(el?.textContent ?? "").replace(/\s+/g, " ").trim()
const button = () => document.querySelector<HTMLButtonElement>("button")!
const REPLY = interestKey("lorebooks:updateMemberToCardVersion", 5)

describe("CardUpdateOffer", () => {
	test("says where the member and the card are, and offers a tonal button", async () => {
		await mountOffer()
		expect(text(document.querySelector("p"))).toBe(
			"On card v1.0; the card is on v1.1."
		)
		expect(text(button())).toBe("Update Bianca to card v1.1")
		expect(button().className).toContain("preset-tonal")
		expect(button().className).not.toContain("preset-filled")
	})

	test("a press sends the event with the castId and waits", async () => {
		await mountOffer()
		button().click()
		await settle()
		expect(emits).toEqual([
			{
				event: "lorebooks:updateMemberToCardVersion",
				payload: { castId: 10 }
			}
		])
		expect(button().disabled).toBe(true)
		button().click()
		await settle()
		expect(emits).toHaveLength(1)
	})

	test("a reply for another member does not settle it; ours re-enables, silently", async () => {
		await mountOffer()
		button().click()
		await settle()
		handlers.get(REPLY)!({ lorebookId: 5, castId: 99 })
		await settle()
		expect(button().disabled).toBe(true)
		handlers.get(REPLY)!({ lorebookId: 5, castId: 10, moved: 2 })
		await settle()
		expect(button().disabled).toBe(false)
		expect(document.querySelector("[data-card-update-problem]")).toBeNull()
		expect(toaster.success).not.toHaveBeenCalled()
		expect(toaster.error).not.toHaveBeenCalled()
	})

	test("a refusal is said inline under the button, with no toast, and the button works again", async () => {
		await mountOffer()
		button().click()
		await settle()
		handlers.get("lorebooks:updateMemberToCardVersion:error")!({
			error: "Only the book's owner can do that."
		})
		await settle()
		expect(text(document.querySelector("[data-card-update-problem]"))).toBe(
			"Only the book's owner can do that."
		)
		expect(button().disabled).toBe(false)
		expect(toaster.error).not.toHaveBeenCalled()
		expect(toaster.warning).not.toHaveBeenCalled()
		// A new press clears the old sentence.
		button().click()
		await settle()
		expect(document.querySelector("[data-card-update-problem]")).toBeNull()
	})
})
