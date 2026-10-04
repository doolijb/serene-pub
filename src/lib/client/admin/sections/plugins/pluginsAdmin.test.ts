import { describe, expect, it } from "vitest"
import { pluginStatus, pluginUninstall } from "./pluginsAdmin"

const p = { pluginId: "acme/x", name: "X", enabled: true, warm: false }

describe("pluginStatus", () => {
	it("says Loaded or Idle only while the sandbox runs", () => {
		expect(pluginStatus({ ...p, warm: true }, true).label).toBe("Loaded")
		expect(pluginStatus(p, true).label).toBe("Idle")
		expect(pluginStatus({ ...p, warm: true }, false).label).toBe("Enabled")
		expect(pluginStatus({ ...p, enabled: false }, true).label).toBe("Disabled")
	})
})

describe("pluginUninstall", () => {
	it("speaks of uninstalling and lists what goes", () => {
		const d = pluginUninstall([{ ...p, swaps: { total: 2, off: 0, genreId: null } }])
		expect(d.title).toBe("Uninstall X?")
		expect(d.confirmLabel).toBe("Uninstall plugin")
		expect(d.objects[0].related?.map((r) => r.label)).toEqual(["Removed with it", "Withdrawn"])
		expect(d.summary).toContain("log history is kept")
	})
})
