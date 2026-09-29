/**
 * The first-run doors on an empty Connections index, rendered.
 *
 * `render` from `svelte/server`, like `indexRows.ssr.test.ts`. What is pinned
 * is the gating: the "On this machine" door installs and runs KoboldCPP, which
 * the Android app cannot do (the server refuses to switch either manager on),
 * so it hides there on `canRunLocalRuntimes` — the same predicate the Add menu
 * and the setup wizard hide their local-runtime items on.
 *
 * ⚠ Not a design assertion. It checks the doors' sentences, never layout.
 */
import { describe, expect, test, vi } from "vitest"
import { render } from "svelte/server"

vi.mock("$app/environment", () => ({ dev: false, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	useInterest: () => {},
	declareInterest: () => () => {},
	requestWithInterest: () => {}
}))

import ConnectionIndexView from "./ConnectionIndexView.svelte"

const noop = () => {}

function renderEmptyIndex(settings: { isAndroidWrapper?: boolean }) {
	return render(ConnectionIndexView, {
		props: {
			connectionsList: [],
			isLoading: false,
			syncingIds: new Set<number>(),
			syncingAll: false,
			onAddNew: noop,
			onEnableManager: noop,
			onOpenConnection: noop,
			onOpenModel: noop,
			onOpenCapability: noop,
			onSetUpChat: noop,
			onGetModel: noop,
			onOpenDownloads: noop,
			onRefresh: noop,
			onAddModel: noop
		},
		context: new Map<string, unknown>([
			["systemSettingsCtx", { settings }],
			["userCtx", { user: { id: 1, isAdmin: true } }]
		])
	}).body
}

const LOCAL_DOOR = "KoboldCPP, installed and run by Serene Pub."

describe("the first-run doors", () => {
	test("offer running KoboldCPP on this machine where it can run", () => {
		const html = renderEmptyIndex({ isAndroidWrapper: false })
		expect(html).toContain("Where should the writing happen?")
		expect(html).toContain(LOCAL_DOOR)
		expect(html).toContain("A service")
		expect(html).toContain("Something I already run")
	})

	test("hide the on-this-machine door in the Android app", () => {
		const html = renderEmptyIndex({ isAndroidWrapper: true })
		expect(html).toContain("Where should the writing happen?")
		expect(html).not.toContain(LOCAL_DOOR)
		// The other two doors stay — a service, or a server run elsewhere.
		expect(html).toContain("A service")
		expect(html).toContain("Something I already run")
	})
})
