/**
 * The handler gate for a session that still owes a second factor (26 §10).
 *
 * Four strings decide whether an unverified session is asked for a code or
 * quietly let through, so they are asserted directly rather than only via a
 * full handshake. A regression here is silent: everything keeps working, and
 * 2FA simply stops meaning anything.
 */
import { describe, expect, test } from "vitest"
import { isBlockedWhilePendingMfa } from "./index"

describe("isBlockedWhilePendingMfa", () => {
	test("permits exactly what a pending session needs to make progress", () => {
		// Report its own state, submit a code, identify itself, or give up.
		for (const event of [
			"totp:status",
			"totp:verify",
			"users:current",
			"auth:logout"
		]) {
			expect(isBlockedWhilePendingMfa(event)).toBe(false)
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
			expect(isBlockedWhilePendingMfa(event)).toBe(true)
		}
	})

	test("blocks the rest of the 2FA surface, not just unrelated events", () => {
		// Enrolling, disabling, reissuing codes or clearing someone else's
		// factor all require a session that has already cleared its own.
		for (const event of [
			"totp:enroll:begin",
			"totp:enroll:confirm",
			"totp:disable",
			"totp:regenerateCodes",
			"totp:adminClear"
		]) {
			expect(isBlockedWhilePendingMfa(event)).toBe(true)
		}
	})

	test("blocks tunnel control — a pending session must not expose the instance", () => {
		for (const event of [
			"tunnels:enable",
			"tunnels:updateConfig",
			"tunnels:get"
		]) {
			expect(isBlockedWhilePendingMfa(event)).toBe(true)
		}
	})

	test("defaults to blocking an event it has never heard of", () => {
		// Fail closed: a handler added later is gated without having to know
		// this list exists.
		expect(isBlockedWhilePendingMfa("some:future:handler")).toBe(true)
	})
})
