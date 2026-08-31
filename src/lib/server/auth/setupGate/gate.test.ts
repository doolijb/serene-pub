/**
 * The setup gate's allowlist (27 §1, generalising 26 §10).
 *
 * A handful of strings decide whether a session that owes setup is stopped or
 * quietly let through, so they are asserted directly rather than only via a
 * full handshake. A regression here is silent: everything keeps working, and
 * the gate simply stops meaning anything.
 */
import { describe, expect, test } from "vitest"
import { isBlockedDuringSetup } from "./index"

describe("isBlockedDuringSetup", () => {
	test("permits exactly what a session needs to finish setup", () => {
		// Report its own state, set a password, enrol or submit a code,
		// identify itself, or give up.
		for (const event of [
			"account:setupState",
			"account:setPassword",
			"totp:status",
			"totp:verify",
			"totp:enroll:begin",
			"totp:enroll:confirm",
			"users:current",
			"auth:logout"
		]) {
			expect(isBlockedDuringSetup(event)).toBe(false)
		}
	})

	test("blocks ordinary application traffic", () => {
		for (const event of [
			"characters:list",
			"sessions:get",
			"users:update",
			"connections:create",
			"systemSettings:get"
		]) {
			expect(isBlockedDuringSetup(event)).toBe(true)
		}
	})

	test("still blocks the 2FA surface that setup does not need", () => {
		// Disabling, reissuing codes or clearing someone else's factor all
		// require a session that has already finished its own setup.
		for (const event of [
			"totp:disable",
			"totp:regenerateCodes",
			"totp:adminClear"
		]) {
			expect(isBlockedDuringSetup(event)).toBe(true)
		}
	})

	test("blocks tunnel control — a pending session must not expose the instance", () => {
		for (const event of [
			"tunnels:enable",
			"tunnels:updateConfig",
			"tunnels:get"
		]) {
			expect(isBlockedDuringSetup(event)).toBe(true)
		}
	})

	test("defaults to blocking an event it has never heard of", () => {
		// Fail closed: a handler added later is gated without having to know
		// this list exists.
		expect(isBlockedDuringSetup("some:future:handler")).toBe(true)
	})
})
