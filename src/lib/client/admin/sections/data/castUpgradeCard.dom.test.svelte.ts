/** The Data card **Since the upgrade**: rows, the follow button, inline refusals, absent when empty; and the Overview's line. */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { listeners, listen, emitted, toast } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	const emitted: Array<[string, any]> = []
	const toast = {
		error: vi.fn(),
		info: vi.fn(),
		success: vi.fn(),
		warning: vi.fn()
	}
	return {
		listeners,
		emitted,
		toast,
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
vi.mock("$lib/client/utils/toaster", () => ({ toaster: toast }))

import CastUpgradeCard from "./CastUpgradeCard.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	listeners.clear()
	emitted.length = 0
	vi.clearAllMocks()
})
const settle = async () => {
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

const date = { year: 412, month: 3, day: 5 }
const member = (id: number, name: string, mixed: boolean) => ({
	castMemberId: id,
	lorebookId: 1,
	lorebookName: "Porto Alto",
	memberName: name,
	note: {
		v: 1 as const,
		differences: [
			{
				branchId: null,
				line: "main",
				at: { kind: "date" as const, date },
				appearance: null,
				fields: ["description"]
			}
		],
		...(mixed ? { mixedGreetings: true as const } : {})
	}
})
const list = (...members: ReturnType<typeof member>[]) => ({
	count: members.length,
	members
})
const mountCard = async (res: ReturnType<typeof list>) => {
	app = mount(CastUpgradeCard, { target: document.body })
	flushSync()
	listeners.get("admin:castLiftNotes")!(res)
	await settle()
}
const follow = () =>
	[...document.querySelectorAll("button")].find((b) =>
		b.textContent?.includes("Follow the card's greetings")
	)

describe("CastUpgradeCard", () => {
	test("absent with an empty list", async () => {
		await mountCard(list())
		expect(document.querySelector("#cast-upgrade")).toBeNull()
	})

	test("a row per member, in words", async () => {
		await mountCard(
			list(member(5, "Bianca", false), member(6, "Caio", false))
		)
		const text = document.querySelector("#cast-upgrade")!.textContent!
		expect(text).toContain("Since the upgrade")
		expect(text).toContain("Bianca in Porto Alto")
		expect(text).toContain("Caio in Porto Alto")
		expect(text).toContain(
			"reads the description differently than before the upgrade."
		)
		expect(follow()).toBeUndefined()
	})

	test("Follow emits with the id; the reply replaces the list", async () => {
		await mountCard(list(member(5, "Bianca", true)))
		expect(document.body.textContent).toContain("their own list")
		follow()!.click()
		await settle()
		expect(emitted).toEqual([
			["admin:castLiftFollowGreetings", { castMemberId: 5 }]
		])
		expect(follow()!.disabled).toBe(true)
		listeners.get("admin:castLiftFollowGreetings")!(
			list(member(6, "Caio", false))
		)
		await settle()
		expect(document.body.textContent).not.toContain("Bianca")
		expect(document.body.textContent).toContain("Caio in Porto Alto")
	})

	test("a refusal shows inline, never a toast", async () => {
		await mountCard(list(member(5, "Bianca", true)))
		follow()!.click()
		await settle()
		listeners.get("admin:castLiftFollowGreetings:error")!({
			error: "Not an admin."
		})
		await settle()
		expect(
			document.querySelector("[data-cast-upgrade-problem]")?.textContent
		).toContain("Not an admin.")
		expect(follow()!.disabled).toBe(false)
		expect(toast.error).not.toHaveBeenCalled()
	})
})
