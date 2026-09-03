/**
 * Round-10 audit fix (MEDIUM): registerKoboldCppHandlers registered every
 * emitter reassignment site unconditionally (and, before this fix, even
 * re-bound on individual handler calls) — since every KoboldCPP handler is
 * already admin-only, a non-admin socket should never be wired up to any
 * of the three telemetry emitter sets (download progress, binary download
 * progress, subprocess status) in the first place. This exercises the
 * registration-time gate itself, and confirms it registers/unregisters
 * (on disconnect) the two downstream modules' real exported
 * registerEmitter/unregisterEmitter functions.
 */
import { afterEach, describe, expect, test, vi } from "vitest"

// koboldcpp.ts transitively imports $lib/server/auth, which needs
// getCryptoSecretKey() from this module at import time — a bare `{db:{}}`
// stub (used elsewhere for pure-function tests) breaks that, so it's
// stubbed directly here too. Deliberately NOT using importOriginal(),
// which would trigger $lib/server/db/index.ts's own module-level
// meta.json/lock-check side effects against the real on-disk dev database
// — safe alone, but a source of flaky collisions with other unmocked test
// files' locks when the full suite runs in parallel.
vi.mock("$lib/server/db", () => ({
	db: {},
	getCryptoSecretKey: () => "test-crypto-secret-key"
}))

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
const noopEmit = () => {}

describe("registerKoboldCppHandlers — which events are actually wired up", () => {
	test("the image-model event is registered and the instance-level one is gone", async () => {
		// A handler that is exported but never registered fails in SILENCE: the
		// client emits, nothing answers, and the only symptom is a button that
		// does nothing. Registration is a line in a list of thirty-odd, which is
		// exactly the kind of line that gets missed when one event replaces
		// another.
		const { registerKoboldCppHandlers } = await import("./koboldcpp")
		const events: string[] = []

		registerKoboldCppHandlers(
			fakeSocket(true),
			noopEmit,
			(_socket: any, handler: { event: string }) => {
				events.push(handler.event)
			}
		)

		expect(events).toContain("koboldcpp:connectImageModel")
		// An image model is named by a CONNECTION now — one connection, one
		// model — so the instance-level selection this replaces must not still
		// be answering.
		expect(events).not.toContain("koboldcpp:setImageModel")
		// ...and its text twin is untouched.
		expect(events).toContain("koboldcpp:connectModel")
	})
})

describe("registerKoboldCppHandlers — telemetry emitter admin gate", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	test("a non-admin socket registers none of the three telemetry emitters", async () => {
		const { registerKoboldCppHandlers } = await import("./koboldcpp")
		const binaryManager = await import(
			"$lib/server/koboldcpp/binaryManager"
		)
		const subprocessManager = await import(
			"$lib/server/koboldcpp/subprocessManager"
		)
		const binarySpy = vi.spyOn(binaryManager, "registerEmitter")
		const subprocessSpy = vi.spyOn(subprocessManager, "registerEmitter")

		const socket = fakeSocket(false)
		registerKoboldCppHandlers(socket, noopEmit, noopRegister)

		expect(binarySpy).not.toHaveBeenCalled()
		expect(subprocessSpy).not.toHaveBeenCalled()
	})

	test("an admin socket registers all three telemetry emitters, and unregisters them on disconnect", async () => {
		const { registerKoboldCppHandlers } = await import("./koboldcpp")
		const binaryManager = await import(
			"$lib/server/koboldcpp/binaryManager"
		)
		const subprocessManager = await import(
			"$lib/server/koboldcpp/subprocessManager"
		)
		const binaryRegisterSpy = vi.spyOn(binaryManager, "registerEmitter")
		const binaryUnregisterSpy = vi.spyOn(binaryManager, "unregisterEmitter")
		const subprocessRegisterSpy = vi.spyOn(
			subprocessManager,
			"registerEmitter"
		)
		const subprocessUnregisterSpy = vi.spyOn(
			subprocessManager,
			"unregisterEmitter"
		)

		const socket = fakeSocket(true)
		registerKoboldCppHandlers(socket, noopEmit, noopRegister)

		expect(binaryRegisterSpy).toHaveBeenCalledTimes(1)
		expect(subprocessRegisterSpy).toHaveBeenCalledTimes(1)
		expect(binaryUnregisterSpy).not.toHaveBeenCalled()
		expect(subprocessUnregisterSpy).not.toHaveBeenCalled()

		socket.triggerDisconnect()

		expect(binaryUnregisterSpy).toHaveBeenCalledTimes(1)
		expect(subprocessUnregisterSpy).toHaveBeenCalledTimes(1)
	})
})
