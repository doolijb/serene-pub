/**
 * The Managed card's Server URL is the stored address — the one Serene Pub
 * reaches KoboldCPP at — and never a second spelling built from the port. An
 * imported row whose address and port disagree (repaired only at the next
 * start) shows what the app is using, as Document View's KoboldCPP page does.
 */
import { describe, expect, test, vi } from "vitest"
import { render } from "svelte/server"

vi.mock("$app/environment", () => ({ dev: false, building: false }))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: () => () => {},
	useInterest: () => () => {}
}))
vi.mock("$lib/client/components/connections/useMachineHardware.svelte", () => ({
	useMachineHardware: () => ({ hardware: null })
}))

import KoboldCppSettingsTab from "./KoboldCppSettingsTab.svelte"

describe("Managed KoboldCPP settings: Server URL", () => {
	test("shows the stored address, not one made from the port", () => {
		const html = render(KoboldCppSettingsTab, {
			props: { isManaged: true },
			context: new Map<any, any>([
				[
					"koboldCppSettingsCtx",
					{
						settings: {
							koboldCppManagedMode: "managed",
							koboldCppManagerBaseUrl: "http://localhost:5005",
							koboldCppManagedPort: 5001
						}
					}
				]
			])
		}).body
		expect(html).toContain("Server URL")
		expect(html).toContain("http://localhost:5005")
		expect(html).not.toContain("http://localhost:5001")
	})
})
