import { afterEach, describe, expect, test, vi } from "vitest"
import type { RequestEvent } from "@sveltejs/kit"

// maxAge/secure/sameSite are computed from process.env at module load time,
// so each test stubs env vars and re-imports the module fresh.
describe("setUserTokenCookie", () => {
	const originalEnv = { ...process.env }

	afterEach(() => {
		process.env = { ...originalEnv }
		vi.resetModules()
	})

	test("sets a strict/secure cookie with maxAge derived from USER_TOKEN_EXPIRATION_HOURS in production", async () => {
		process.env.NODE_ENV = "production"
		process.env.USER_TOKEN_EXPIRATION_HOURS = "12"
		vi.resetModules()
		const { setUserTokenCookie } = await import("./index")

		const setMock = vi.fn()
		const event = { cookies: { set: setMock } } as unknown as RequestEvent

		setUserTokenCookie({ event, token: "testToken" })

		expect(setMock).toHaveBeenCalledWith("userToken", "testToken", {
			path: "/",
			httpOnly: true,
			secure: true,
			sameSite: "strict",
			maxAge: 60 * 60 * 12
		})
	})

	test("relaxes to a lax/non-secure cookie in development", async () => {
		process.env.NODE_ENV = "development"
		process.env.USER_TOKEN_EXPIRATION_HOURS = "24"
		vi.resetModules()
		const { setUserTokenCookie } = await import("./index")

		const setMock = vi.fn()
		const event = { cookies: { set: setMock } } as unknown as RequestEvent

		setUserTokenCookie({ event, token: "testToken" })

		expect(setMock).toHaveBeenCalledWith("userToken", "testToken", {
			path: "/",
			httpOnly: true,
			secure: false,
			sameSite: "lax",
			maxAge: 60 * 60 * 24
		})
	})
})
