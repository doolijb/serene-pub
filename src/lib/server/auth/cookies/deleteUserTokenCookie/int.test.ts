import { expect, test, vi } from "vitest"
import { deleteUserTokenCookie } from "."
import type { RequestEvent } from "@sveltejs/kit"

test("deleteUserTokenCookie: deletes userToken cookie", async () => {
	const deleteMock = vi.fn()

	const event = {
		cookies: {
			delete: deleteMock
		}
	} as unknown as RequestEvent

	deleteUserTokenCookie({ event })

	expect(deleteMock).toHaveBeenCalledWith("userToken", {
		path: "/",
		httpOnly: true,
		secure: true,
		sameSite: "strict"
	})
})
