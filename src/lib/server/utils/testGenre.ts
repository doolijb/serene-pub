/**
 * Test-only helper — not used by the running app.
 *
 * 🚧 RF fix 8 (owner ruling 2026-10-23): a genre brings no attributes — its
 * `slots`, `sheets` and `customAttributes` are retired and `genre()` refuses
 * them. The state engine's tests (storage, layering, the ledger, earshot,
 * places) still need a session that tracks a handful of slots, and where the
 * vocabulary comes from is not what they test. `genreKeeping` declares the
 * genre without the retired keys and has the host keep the slots its old
 * `slots` and `sheets` named — on the owners a sheet entry narrowed them to —
 * as the genre's **tool state** (`declareHostState`): tracked in that genre's
 * sessions exactly as a genre slot was, never an attribute.
 *
 * ⚠ What a genre sheet's entries also said — a per-slot `default`, `config`
 * and `required` — is retired with the sheets and is not kept here: a slot's
 * own declaration answers. A test about attributes the rules declare uses a
 * ruleset (`defineRuleset({ attributes })`) and the session's
 * `primaryRuleset` instead.
 */
import { declareHostState, genre, type AttributeSlotDecl, type GenreProps, type SlotAppliesTo } from "@serene-pub/sdk"

/** A sheet's entries as the retired `sheets` named them. */
interface SheetLike {
	readonly slots: readonly { readonly id: string; readonly appliesTo?: readonly SlotAppliesTo[] }[]
}

/** The retired attribute keys, accepted here for a test's fixture. */
export type GenreKeepingProps = GenreProps & {
	slots?: readonly AttributeSlotDecl[]
	sheets?: readonly SheetLike[]
	customAttributes?: "allow" | "deny"
}

/** Declare a test genre; the host keeps what its old `slots` and `sheets` named. */
export function genreKeeping(id: string, props: GenreKeepingProps) {
	const { slots, sheets, customAttributes: _custom, ...rest } = props
	const g = genre(id, rest as GenreProps)
	const kept: { slot: string; owners?: readonly SlotAppliesTo[] }[] = []
	for (const sheet of sheets ?? []) for (const e of sheet.slots) kept.push({ slot: e.id, ...(e.appliesTo ? { owners: e.appliesTo } : {}) })
	for (const s of slots ?? []) if (!kept.some((k) => k.slot === s.id)) kept.push({ slot: s.id })
	if (kept.length) declareHostState(kept.map((k) => ({ slot: k.slot, role: "tool" as const, genres: [g], ...(k.owners ? { owners: k.owners } : {}) })))
	return g
}
