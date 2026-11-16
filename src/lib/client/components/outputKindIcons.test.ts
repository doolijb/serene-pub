/**
 * The four explicit output-kind icon maps stay in step with the table they
 * draw from. Each used to be `Icons[name]` over the whole lucide namespace,
 * which drew any name `OUTPUT_KIND_ICONS` could hold; the explicit maps draw
 * only the names they list and fall back to `Boxes` for the rest. So a kind
 * added to the table without a map entry would silently draw a box — this
 * test makes that a failure at the table, where the author is.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { OUTPUT_KIND_ICONS } from "$lib/shared/constants/outputKinds"

const ROOT = join(import.meta.dirname, "../../../..")
const MAP_FILES = [
	"src/lib/client/admin/sections/defaults/Page.svelte",
	"src/lib/client/components/loadouts/LoadoutsGrid.svelte",
	"src/lib/client/components/loadouts/LoadoutsLedger.svelte",
	"src/lib/client/components/connections/DefaultsLedger.svelte"
]

/** The member names inside `const OUTPUT_KIND_COMPONENTS … = { … }`. */
function mapMembers(source: string): Set<string> {
	const m = /const OUTPUT_KIND_COMPONENTS[^=]*=\s*\{([^}]*)\}/.exec(source)
	if (!m) throw new Error("no OUTPUT_KIND_COMPONENTS map found")
	return new Set(
		m[1]!
			.split(",")
			.map((s) => s.trim().split(":")[0]!.trim())
			.filter(Boolean)
	)
}

describe("output-kind icon maps", () => {
	for (const rel of MAP_FILES) {
		it(`${rel} lists every icon OUTPUT_KIND_ICONS names`, () => {
			const members = mapMembers(readFileSync(join(ROOT, rel), "utf8"))
			const missing = Object.values(OUTPUT_KIND_ICONS).filter(
				(name) => !members.has(name)
			)
			expect(missing, `add these to the map in ${rel}`).toEqual([])
		})
	}
})
