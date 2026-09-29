/**
 * The managed connection view, rendered.
 *
 * `render` from `svelte/server`, like `indexRows.ssr.test.ts`: the repo has no
 * browser test environment, and what this component does IS the markup — a
 * header that carries the title AND the service chip, a status card assembled
 * from `managedConnectionView.ts`, and the setup screen the stage asks for.
 * This pins that the assembly happens at all, so a lane moving the props
 * contract has something that fails.
 *
 * ⚠ The states rendered here are the ones with no manager TAB inside them.
 * The tab components are the managers' own, they fetch on mount and read four
 * contexts, and rendering them on the server would be testing them rather than
 * this. The tab STRIP is asserted from `managedTabs` in the pure test next
 * door.
 *
 * ⚠ Not a design assertion. It checks sentences and the one class that carries
 * meaning (the teal managed chip), never layout utilities.
 */
import { describe, expect, test, vi } from "vitest"
import { render } from "svelte/server"

vi.mock("$app/environment", () => ({ dev: false, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))

import ManagedConnectionView from "./ManagedConnectionView.svelte"

/** The three contexts the view reads, as `Layout` provides them. */
function context(koboldCpp: Record<string, unknown> = {}) {
	return new Map<any, any>([
		["koboldCppSettingsCtx", { settings: koboldCpp }],
		["ollamaSettingsCtx", { settings: { ollamaManagerBaseUrl: "" } }],
		["panelsCtx", { digest: {} }]
	])
}

const base = {
	connectionId: 7,
	isAdmin: true,
	capabilityDefaults: {},
	managedConnectionIds: [7],
	onBack: () => {},
	onRefreshModels: () => {},
	onRemove: () => {},
	onOpenConnection: () => {}
}

describe("the managed connection view renders", () => {
	test("KoboldCPP with no mode chosen is the setup screen, titled and chipped", () => {
		const html = render(ManagedConnectionView, {
			props: { ...base, kind: "koboldcpp" as const, title: "My rig" },
			context: context({ koboldCppManagedMode: null })
		}).body
		// Title and service chip travel together (R5).
		expect(html).toContain("My rig")
		expect(html).toContain("preset-tonal-tertiary")
		expect(html).toContain("KoboldCPP")
		// No status card: nothing has answered, so there is nothing true to say.
		expect(html).not.toContain("Nothing loaded")
	})

	test("KoboldCPP pointed at somebody else's server asks for the address", () => {
		const html = render(ManagedConnectionView, {
			props: { ...base, kind: "koboldcpp" as const, title: "KoboldCPP" },
			context: context({
				koboldCppManagedMode: "external",
				koboldCppManagerBaseUrl: "http://box:5001"
			})
		}).body
		expect(html).toContain(
			"Point Serene Pub at the KoboldCPP you are already running."
		)
		expect(html).toContain("http://box:5001")
		expect(html).toContain("Test")
	})

	test("the remove dialog names the runtime and what survives it", () => {
		const html = render(ManagedConnectionView, {
			props: { ...base, kind: "koboldcpp" as const, title: "KoboldCPP" },
			context: context({ koboldCppManagedMode: null })
		}).body
		expect(html).toContain("Remove KoboldCPP from this pub")
	})
})
