/**
 * Who gets into `/recovery`, and what stops an action running twice.
 *
 * Both properties here are the only thing standing between "the database will
 * not open" and "anyone who can route to this port can replace the database",
 * because in recovery mode there is no database, therefore no accounts, no
 * sessions and nothing to authenticate with. The address rule *is* the
 * authentication, and the confirm token is the whole of the "are you sure".
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { RequestEvent } from "@sveltejs/kit"

const databaseState = vi.hoisted(() => ({ value: { ok: false } as any }))

vi.mock("$lib/server/startup", () => ({
	getDatabaseState: () => databaseState.value
}))

import {
	clearConfirmTokens,
	consumeConfirmToken,
	guardRecovery,
	issueConfirmToken
} from "./guard"
import { isRecoveryPeerAddress } from "$lib/server/db/recoveryAccess"

/** A request whose raw TCP peer is `address`. */
function eventFrom(
	address: string | null,
	options: { adapterAddress?: string } = {}
): RequestEvent {
	return {
		platform:
			address === null
				? undefined
				: { req: { socket: { remoteAddress: address } } },
		getClientAddress: () => {
			if (options.adapterAddress) return options.adapterAddress
			throw new Error("no adapter address")
		},
		url: new URL("http://localhost:3000/recovery")
	} as unknown as RequestEvent
}

beforeEach(() => {
	databaseState.value = { ok: false }
	clearConfirmTokens()
	delete process.env.ADDRESS_HEADER
})

afterEach(() => {
	delete process.env.ADDRESS_HEADER
})

describe("which addresses the recovery surface answers", () => {
	test.each([
		["127.0.0.1", true],
		["::1", true],
		["::ffff:127.0.0.1", true], // dual-stack listener's form of loopback
		["10.0.0.5", true],
		["172.16.4.4", true],
		["192.168.1.50", true],
		["::ffff:192.168.1.50", true],
		["169.254.10.1", true],
		["fd00::1", true], // fc00::/7 unique-local
		["fe80::1", true], // link-local
		["203.0.113.7", false],
		["8.8.8.8", false],
		["172.32.0.1", false], // just outside 172.16/12
		["2001:db8::1", false],
		["", false]
	])("%s → %s", (address, allowed) => {
		expect(isRecoveryPeerAddress(address)).toBe(allowed)
	})
})

describe("the gate on every route", () => {
	test("lets a loopback peer through while the database is broken", async () => {
		expect(await guardRecovery(eventFrom("127.0.0.1"))).toBeNull()
	})

	test("lets a private-network peer through", async () => {
		expect(await guardRecovery(eventFrom("10.0.0.5"))).toBeNull()
	})

	test("refuses a public peer, and its answer names nothing", async () => {
		const response = await guardRecovery(eventFrom("203.0.113.7"))
		expect(response).not.toBeNull()
		expect(response!.status).toBe(503)

		const body = await response!.text()
		// No path, no backup name, no action, no hint that a recovery surface
		// exists at all — see ruling 2.
		expect(body).not.toMatch(/serene-pub\.db|backups|\/recovery|meta\.json/)
		expect(body).not.toMatch(/[/\\][a-z]/i)
		expect(body.length).toBeLessThan(80)
	})

	test("is 404 on a healthy instance, local or not", async () => {
		databaseState.value = { ok: true }
		for (const address of ["127.0.0.1", "10.0.0.5", "203.0.113.7"]) {
			const response = await guardRecovery(eventFrom(address))
			expect(response?.status).toBe(404)
		}
	})

	test("refuses when the peer cannot be read and a header is configured", async () => {
		// The adapter's answer honours ADDRESS_HEADER, so believing it here
		// would be believing a header the client sent — which is exactly how a
		// remote client would claim to be 127.0.0.1.
		process.env.ADDRESS_HEADER = "x-forwarded-for"
		const response = await guardRecovery(
			eventFrom(null, { adapterAddress: "127.0.0.1" })
		)
		expect(response?.status).toBe(503)
	})

	test("falls back to the adapter's address when no header is configured", async () => {
		expect(
			await guardRecovery(
				eventFrom(null, { adapterAddress: "127.0.0.1" })
			)
		).toBeNull()
		expect(
			await guardRecovery(
				eventFrom(null, { adapterAddress: "203.0.113.7" })
			)
		).not.toBeNull()
	})
})

describe("the confirm token", () => {
	test("a post without one performs nothing", () => {
		expect(consumeConfirmToken(undefined, "restore", "a.tgz")).toBe(false)
		expect(consumeConfirmToken("", "restore", "a.tgz")).toBe(false)
		expect(consumeConfirmToken("not-a-token", "restore", "a.tgz")).toBe(
			false
		)
	})

	test("is spent exactly once, so a refresh cannot re-run the action", () => {
		const token = issueConfirmToken("restore", "a.tgz")
		expect(consumeConfirmToken(token, "restore", "a.tgz")).toBe(true)
		expect(consumeConfirmToken(token, "restore", "a.tgz")).toBe(false)
	})

	test("is bound to its action and its target", () => {
		const token = issueConfirmToken("delete-backup", "a.tgz")
		expect(consumeConfirmToken(token, "restore", "a.tgz")).toBe(false)

		const other = issueConfirmToken("delete-backup", "a.tgz")
		expect(consumeConfirmToken(other, "delete-backup", "b.tgz")).toBe(false)
	})

	test("does not grow without bound", () => {
		for (let i = 0; i < 200; i++) issueConfirmToken("restore", `b${i}.tgz`)
		// The most recent one still works; the map is capped behind it.
		const token = issueConfirmToken("restore", "last.tgz")
		expect(consumeConfirmToken(token, "restore", "last.tgz")).toBe(true)
	})
})
