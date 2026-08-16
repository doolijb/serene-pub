/**
 * Round-10 audit fix (HIGH): registerVectorizationHandlers used to
 * unconditionally register EVERY connecting socket (admin or not) as a
 * global vectorization progress emitter. Progress payloads
 * (priorityQueue/history) span every user's chats/lorebooks/characters
 * instance-wide, so a non-admin becoming the emitter meant cross-tenant
 * disclosure. Fixed by gating registration on socket.user.isAdmin and
 * unregistering on disconnect.
 */
import { describe, expect, test, vi } from "vitest"

vi.mock("$lib/server/db", () => ({ db: {} }))

function fakeSocket(isAdmin: boolean) {
	const disconnectHandlers: Array<() => void> = []
	return {
		user: { id: 1, isAdmin },
		on: (event: string, cb: () => void) => {
			if (event === "disconnect") disconnectHandlers.push(cb)
		},
		triggerDisconnect: () => disconnectHandlers.forEach((cb) => cb())
	}
}

const noopRegister = () => {}

describe("registerVectorizationHandlers — progress emitter admin gate", () => {
	test("a non-admin socket is never registered as a progress emitter", async () => {
		const {
			registerVectorizationHandlers
		} = await import("./vectorization")
		const { pauseVectorization } = await import(
			"$lib/server/embedding/vectorizationQueue"
		)

		const spyEmit = vi.fn()
		const socket = fakeSocket(false)
		registerVectorizationHandlers(socket, spyEmit, noopRegister)

		pauseVectorization()
		expect(spyEmit).not.toHaveBeenCalled()
	})

	test("an admin socket is registered as a progress emitter and unregistered on disconnect", async () => {
		const {
			registerVectorizationHandlers
		} = await import("./vectorization")
		const { pauseVectorization } = await import(
			"$lib/server/embedding/vectorizationQueue"
		)

		const spyEmit = vi.fn()
		const socket = fakeSocket(true)
		registerVectorizationHandlers(socket, spyEmit, noopRegister)

		pauseVectorization()
		expect(spyEmit).toHaveBeenCalledWith(
			"vectorization:progress",
			expect.objectContaining({ status: "paused" })
		)

		spyEmit.mockClear()
		socket.triggerDisconnect()
		pauseVectorization()
		expect(spyEmit).not.toHaveBeenCalled()
	})
})
