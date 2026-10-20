/** 🚧 Why you were signed out (PLAN-dc-after-walk2 Q3-7, N17): said once, then forgotten. */
import { afterEach, describe, expect, test } from "vitest"
import { noteSignedOutWhy, takeSignedOutWhy } from "./signedOutNotice"

const store = new Map<string, string>()
;(globalThis as { sessionStorage?: unknown }).sessionStorage = {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
	removeItem: (k: string) => void store.delete(k)
}

afterEach(() => store.clear())

describe("signed-out notice", () => {
	test("noted before the reload, read once by the sign-in form", () => {
		expect(takeSignedOutWhy()).toBeNull()
		noteSignedOutWhy("User accounts are on now, so everyone signs in.")
		expect(takeSignedOutWhy()).toBe("User accounts are on now, so everyone signs in.")
		expect(takeSignedOutWhy()).toBeNull()
	})

	test("storage that throws says nothing, and never throws", () => {
		const saved = (globalThis as { sessionStorage?: unknown }).sessionStorage
		;(globalThis as { sessionStorage?: unknown }).sessionStorage = {
			getItem: () => {
				throw new Error("blocked")
			},
			setItem: () => {
				throw new Error("blocked")
			},
			removeItem: () => {
				throw new Error("blocked")
			}
		}
		try {
			expect(() => noteSignedOutWhy("x")).not.toThrow()
			expect(takeSignedOutWhy()).toBeNull()
		} finally {
			;(globalThis as { sessionStorage?: unknown }).sessionStorage = saved
		}
	})
})
