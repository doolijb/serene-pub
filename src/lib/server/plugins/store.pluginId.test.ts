/**
 * The install's check on a plugin's id, held on the row write every install
 * path makes (`upsertPlugin`): the SDK slug grammar, and never `core` — the
 * owner id core's own widgets are answered as. Refused before the database
 * is touched.
 */
import { describe, expect, test } from "vitest"
import { pluginIdFindings, upsertPlugin } from "./store"

/** A database that fails the test if anything reaches it. */
const untouchable = new Proxy(
	{},
	{
		get(_t, key) {
			throw new Error(`the install reached the database (${String(key)})`)
		}
	}
) as never

const install = (pluginId: string) =>
	upsertPlugin(untouchable, {
		pluginId,
		name: "Impostor",
		bundleSource: "",
		bundleHash: "h",
		backends: ["quickjs"]
	})

describe("a plugin's id", () => {
	test("is a slug: dotted, never slashed or upper-cased", () => {
		expect(pluginIdFindings("chariot.dice-tray")).toEqual([])
		expect(pluginIdFindings("acme/hello")).toHaveLength(1)
		expect(pluginIdFindings("Acme")).toHaveLength(1)
		expect(pluginIdFindings("")).toHaveLength(1)
		expect(pluginIdFindings(undefined)).toHaveLength(1)
	})

	test("is never 'core', the app's own", () => {
		expect(pluginIdFindings("core")[0]).toMatch(/'core' is the app's own/)
	})

	test("is refused at the row write, before anything is stored", async () => {
		await expect(install("core")).rejects.toThrow(/plugin 'core' cannot be installed: id 'core' is the app's own/)
		await expect(install("acme/hello")).rejects.toThrow(/is not a plugin slug/)
	})
})
