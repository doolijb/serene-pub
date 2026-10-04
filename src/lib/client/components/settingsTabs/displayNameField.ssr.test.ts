/**
 * The Display name field in Settings › User, rendered.
 *
 * `render` from `svelte/server`, like `firstRunDoors.ssr.test.ts`. Pinned: the
 * field is there for whoever is signed in, whatever the mode — accounts on or
 * off, admin or member, Android or not. The account-only pieces (passphrase,
 * sign out) stay with accounts on.
 */
import { describe, expect, test, vi } from "vitest"
import { render } from "svelte/server"

vi.mock("$app/environment", () => ({ dev: false, building: false }))
vi.mock("$app/navigation", () => ({ goto: () => {} }))
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	useInterest: () => {},
	declareInterest: () => () => {},
	requestWithInterest: () => {},
	getInterestContext: () => undefined
}))

import UserSettingsTab from "./UserSettingsTab.svelte"

function renderTab(opts: {
	accounts: boolean
	isAdmin: boolean
	android?: boolean
}) {
	return render(UserSettingsTab, {
		props: {},
		context: new Map<string, unknown>([
			[
				"systemSettingsCtx",
				{
					settings: {
						isAccountsEnabled: opts.accounts,
						isAndroidWrapper: opts.android ?? false,
						defaultLanguage: "en"
					}
				}
			],
			[
				"userCtx",
				{
					user: {
						id: 1,
						username: "admin",
						displayName: null,
						isAdmin: opts.isAdmin
					}
				}
			],
			["userSettingsCtx", { settings: { effectiveLanguage: "en" } }],
			["panelsCtx", {}]
		])
	}).body
}

const FIELD = 'id="display-name"'

describe("the Display name field", () => {
	test("shows with accounts off", () => {
		const html = renderTab({ accounts: false, isAdmin: true })
		expect(html).toContain(FIELD)
	})

	test("shows with accounts off in the Android app", () => {
		const html = renderTab({
			accounts: false,
			isAdmin: true,
			android: true
		})
		expect(html).toContain(FIELD)
	})

	test("shows with accounts on, for an admin and for a member", () => {
		expect(renderTab({ accounts: true, isAdmin: true })).toContain(FIELD)
		expect(renderTab({ accounts: true, isAdmin: false })).toContain(FIELD)
	})

	test("the account-only actions stay with accounts on", () => {
		expect(renderTab({ accounts: false, isAdmin: true })).not.toContain(
			"Logout"
		)
		expect(renderTab({ accounts: true, isAdmin: true })).toContain("Logout")
	})
})
