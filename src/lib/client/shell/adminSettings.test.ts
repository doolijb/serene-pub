/**
 * Every settings row lands on something: its `#target` is present, as an id,
 * a `data-field` or a SettingSwitch `name`, in the admin sources. A field
 * renamed without its row would otherwise open the page and land nowhere.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { adminSettings, matchAdminSettings } from "./adminSettings"

function svelteFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name)
		if (statSync(path).isDirectory()) return svelteFiles(path)
		return path.endsWith(".svelte") ? [path] : []
	})
}

const sources = [
	"src/lib/client/admin",
	"src/lib/client/components/admin",
	"src/lib/client/components/settingsTabs"
]
	.flatMap(svelteFiles)
	.map((f) => readFileSync(f, "utf8"))
	.join("\n")

describe("admin settings index", () => {
	const rows = adminSettings({ accountsEnabled: true })

	test.each(rows.filter((r) => r.href.includes("#") && !r.href.includes("#default:")))(
		"$label lands on its target",
		(row) => {
			const target = row.href.split("#")[1]
			const present = [`id="${target}"`, `data-field="${target}"`, `name="${target}"`].some((s) =>
				sources.includes(s)
			)
			expect(present, `${target} not found`).toBe(true)
		}
	)

	test("the Defaults rows land on the per-job row attribute", () => {
		expect(sources).toContain("data-field={`default:${combo.id}`}")
		expect(rows.some((r) => r.href === "/admin/defaults#default:text->text")).toBe(true)
	})

	test("accounts off hides the Users rows", () => {
		const off = adminSettings({ accountsEnabled: false })
		expect(off.some((r) => r.href.startsWith("/admin/users"))).toBe(false)
	})

	test("every word must match; label matches rank first", () => {
		const hits = matchAdminSettings(rows, "backup now", 5)
		expect(hits[0].label).toBe("Back up now")
		expect(matchAdminSettings(rows, "tunnel", 5)[0].label).toBe("Tunnel")
		expect(matchAdminSettings(rows, "zzzz", 5)).toEqual([])
	})
})
