/**
 * The seat member's read-only sheet: the shown name, the face, each part the
 * member tells in its own words under the retold rows' labels; a refusal said
 * in one muted line, never a toast.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { listeners, listen, emitted, toasts } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	const emitted: Array<[string, any]> = []
	const toasts: string[] = []
	return {
		listeners,
		emitted,
		toasts,
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
	toaster: {
		error: (m: string) => toasts.push(m),
		info: (m: string) => toasts.push(m),
		success: (m: string) => toasts.push(m),
		warning: (m: string) => toasts.push(m)
	}
}))

const panelsCtx = { digest: {} as Record<string, unknown>, openPanel: vi.fn() }

import SeatMemberSheet from "./SeatMemberSheet.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	listeners.clear()
	emitted.length = 0
	toasts.length = 0
	panelsCtx.digest = {}
	panelsCtx.openPanel.mockClear()
})
const settle = async () => {
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

function open(onClose = () => {}) {
	app = mount(SeatMemberSheet, {
		target: document.body,
		props: { sessionId: 3, ref: "character:7", onClose },
		context: new Map<string, unknown>([["panelsCtx", panelsCtx]])
	})
	flushSync()
}

describe("SeatMemberSheet", () => {
	test("asks the server for the seat, then draws name, face and own words", async () => {
		open()
		expect(emitted).toEqual([
			["lorebooks:memberOfSeat", { sessionId: 3, ref: "character:7" }]
		])
		listeners.get("lorebooks:memberOfSeat")!({
			sessionId: 3,
			ref: "character:7",
			member: {
				castMemberId: 5,
				lorebookId: 2,
				opensInBook: false,
				sheet: {
					name: "Marenne",
					nickname: "Mari",
					shownName: "Mari",
					faceMediaId: 41,
					ownWords: [
						{ field: "description", texts: ["In her own words."] },
						{
							field: "alternateGreetings",
							texts: ["Well met.", "Hello again."]
						}
					]
				}
			}
		})
		await settle()
		const root = document.querySelector("[data-seat-member-sheet]")!
		expect(root.querySelector("h3")!.textContent).toBe("Mari")
		expect(root.querySelector("img")).not.toBeNull()
		const description = root.querySelector(
			'[data-seat-member-words="description"]'
		)!
		expect(description.querySelector("h4")!.textContent!.trim()).toBe(
			"Description"
		)
		expect(description.textContent).toContain("In her own words.")
		const greetings = root.querySelector(
			'[data-seat-member-words="alternateGreetings"]'
		)!
		expect(greetings.querySelector("h4")!.textContent!.trim()).toBe(
			"Alternate greetings"
		)
		expect(greetings.querySelectorAll("p")).toHaveLength(2)
		expect(root.querySelector("button")).not.toBeNull()
	})

	test("Close hands back to the caller", async () => {
		const onClose = vi.fn()
		open(onClose)
		;(
			document.querySelector(
				'button[aria-label="Close"]'
			) as HTMLButtonElement
		).click()
		expect(onClose).toHaveBeenCalledOnce()
	})

	test("a refusal is one muted line in the sheet, never a toast", async () => {
		open()
		listeners.get("lorebooks:memberOfSeat:error")!({
			error: "Access denied. Session not found or no permission to access."
		})
		await settle()
		const line = document.querySelector("[data-seat-member-problem]")!
		expect(line.textContent!.trim()).toBe(
			"Access denied. Session not found or no permission to access."
		)
		expect(line.className).toContain("text-surface-600-400")
		expect(toasts).toEqual([])
	})

	test("nobody seated there any more is said in one line", async () => {
		open()
		listeners.get("lorebooks:memberOfSeat")!({
			sessionId: 3,
			ref: "character:7",
			member: null
		})
		await settle()
		expect(document.body.textContent).toContain(
			"Nobody holds this seat now."
		)
	})

	const sheetReply = (castMemberId = 5) => ({
		sessionId: 3,
		ref: "character:7",
		member: {
			castMemberId,
			lorebookId: 2,
			opensInBook: false,
			sheet: {
				name: "Marenne",
				nickname: null,
				shownName: "Marenne",
				faceMediaId: null,
				ownWords: []
			}
		}
	})
	const copyButton = () =>
		document.querySelector<HTMLButtonElement>("[data-seat-member-copy]")

	test("Copy to my characters shows once the sheet arrives, asks with the member's id, and opens the copy", async () => {
		open()
		await settle()
		expect(copyButton()).toBeNull()
		listeners.get("lorebooks:memberOfSeat")!(sheetReply(5))
		await settle()
		expect(copyButton()!.textContent!.trim()).toBe("Copy to my characters")
		copyButton()!.click()
		flushSync()
		expect(emitted).toContainEqual([
			"characters:duplicate",
			{ castMemberId: 5 }
		])
		expect(copyButton()!.disabled).toBe(true)
		listeners.get("characters:duplicate")!({ character: { id: 88 } })
		await settle()
		expect(panelsCtx.digest.characterId).toBe(88)
		expect(panelsCtx.openPanel).toHaveBeenCalledWith({
			key: "characters",
			toggle: false
		})
		expect(toasts).toEqual([])
	})

	test("a refusal re-arms the button and opens nothing", async () => {
		open()
		listeners.get("lorebooks:memberOfSeat")!(sheetReply())
		await settle()
		copyButton()!.click()
		flushSync()
		listeners.get("characters:duplicate:error")!({
			error: "Cast member not found.",
			castMemberId: 5
		})
		await settle()
		expect(copyButton()!.disabled).toBe(false)
		expect(panelsCtx.openPanel).not.toHaveBeenCalled()
	})

	test("not shown on nobody or on a problem", async () => {
		open()
		listeners.get("lorebooks:memberOfSeat")!({
			sessionId: 3,
			ref: "character:7",
			member: null
		})
		await settle()
		expect(copyButton()).toBeNull()
		unmount(app!)
		app = null
		document.body.innerHTML = ""
		open()
		listeners.get("lorebooks:memberOfSeat:error")!({ error: "No." })
		await settle()
		expect(copyButton()).toBeNull()
	})
})
