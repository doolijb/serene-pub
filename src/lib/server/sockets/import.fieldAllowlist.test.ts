/**
 * Round-9 audit fix (MEDIUM): the SillyTavern bulk-folder import used to
 * hand-roll its own separate character/persona insert field lists instead
 * of routing through characterFieldsFromParsedData/personaFieldsFromParsedData
 * (the canonical, round-8-audited allowlists that explicitly strip a
 * spoofed id/uuid from parsed card data) — safe only by coincidence, since
 * neither duplicate happened to read id/uuid either, but with no guard
 * against future drift if a sensitive column were ever added to the
 * canonical list without also touching the duplicate. import.ts now calls
 * these functions directly, so this is really just a regression guard on
 * the canonical helpers' own stripping behavior — proving id/uuid (and any
 * other field outside the allowlist) never survive into the values object
 * import.ts's character/persona inserts spread onto db.insert(...).
 */
import { describe, expect, test, vi } from "vitest"
import { characterFieldsFromParsedData } from "./characters"
import { personaFieldsFromParsedData } from "./personas"

// Pure-function test — doesn't touch the DB at all — but characters.ts/
// personas.ts both import the real `db` at module scope, which otherwise
// triggers a real connection/lock-check against the on-disk dev database
// purely as an import side effect. A bare stub (not a real createTestDb()
// PGlite instance — nothing here ever calls it, and spinning up a real
// instance per test file risks a WASM-level crash from multiple concurrent
// PGlite instances in the same worker) is enough to short-circuit that
// import.
vi.mock("$lib/server/db", () => ({ db: {} }))

describe("characterFieldsFromParsedData — id/uuid stripping (regression guard)", () => {
	test("a spoofed id/uuid in parsed card data never survives into the insert fields", () => {
		const spoofed = {
			id: 999999,
			uuid: "11111111-1111-1111-1111-111111111111",
			name: "Legit Name",
			description: "Legit description"
		}
		const fields = characterFieldsFromParsedData(spoofed) as Record<
			string,
			unknown
		>
		expect(fields).not.toHaveProperty("id")
		expect(fields).not.toHaveProperty("uuid")
		expect(fields.name).toBe("Legit Name")
	})
})

describe("personaFieldsFromParsedData — id/uuid stripping (regression guard)", () => {
	test("a spoofed id/uuid never survives into the insert fields", () => {
		const spoofed = {
			id: 888888,
			uuid: "22222222-2222-2222-2222-222222222222",
			name: "Legit Persona",
			description: "Legit description"
		}
		const fields = personaFieldsFromParsedData(spoofed) as Record<
			string,
			unknown
		>
		expect(fields).not.toHaveProperty("id")
		expect(fields).not.toHaveProperty("uuid")
		expect(fields.name).toBe("Legit Persona")
	})
})
