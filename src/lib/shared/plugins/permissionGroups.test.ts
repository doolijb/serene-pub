import { describe, it, expect } from "vitest"
import { groupPermissionRows, setGroupTicks } from "./permissionGroups"

const rows = [
	{ key: "network:x.com" },
	{ key: "widget:lore" },
	{ key: "applet:characters:read" },
	{ key: "storage-per-user" },
	{ key: "event:session:message" }
]

describe("the review list's groups", () => {
	it("heads session, applet, then this pub, and leaves an empty group out", () => {
		const g = groupPermissionRows(rows)
		expect(g.map((x) => x.heading)).toEqual([
			"In a session",
			"Outside a session — its applet",
			"On this pub"
		])
		expect(g[0]!.rows.map((r) => r.key)).toEqual(["widget:lore", "event:session:message"])
		expect(g[1]!.rows.map((r) => r.key)).toEqual(["applet:characters:read", "storage-per-user"])
		expect(groupPermissionRows([{ key: "storage" }]).map((x) => x.group)).toEqual(["system"])
	})

	it("allow-all / deny-all touch only the group's own keys", () => {
		const ticks = { "widget:lore": true, "network:x.com": true, "applet:characters:read": false }
		const off = setGroupTicks(ticks, ["widget:lore"], false)
		expect(off).toEqual({ "widget:lore": false, "network:x.com": true, "applet:characters:read": false })
		expect(setGroupTicks(off, ["applet:characters:read"], true)["applet:characters:read"]).toBe(true)
		expect(ticks["widget:lore"]).toBe(true)
	})
})
