/**
 * The entry types, as the engine asks them questions.
 *
 * The declarations live in `@serene-pub/core-catalog`; this is the app's reader
 * for them. Everything here answers *the type says so* rather than *the code
 * knows* — which field plays the title, how siblings order, whether a priority
 * bonus applies, what the declared default of a field is. A fourth shape gets
 * those answers by declaring them.
 *
 * ## Why in-process declarations and not registry rows
 *
 * `entryProjection.ts` reads **rows**, deliberately: install-time truth is the
 * table, and a `transport: 'process'` type has no descriptor in this process at
 * all. Nothing here is install-time truth. These are the questions a *render*
 * and a *projection* ask, per turn, in the hot path — a database read per lore
 * block would be a query for a fact this build already knows, and entry types
 * are core-authored in this release (`describeEntryType` refuses anything else
 * at the author's line), so the two sources cannot disagree without the build
 * being wrong. If plugin-authored types are ever switched on, this reader moves
 * to rows and the callers do not change.
 *
 * ⚠ Declaring an entry type *registers* it, so the catalog import below is
 * load-bearing — it is what puts core's entry types in `allEntryTypes()`. The
 * package's `sideEffects` names its entry and every registering module for
 * exactly this reason (a pure entry once let a release build drop this
 * import); `scripts/coreCatalogRegistrations.int.test.ts` builds the shape for
 * real, and `assertEntryDeclarations()` is what notices at boot if a bundler
 * ever drops it anyway.
 */

import "@serene-pub/core-catalog"
import { allEntryTypes } from "@serene-pub/sdk"
import type { EntryRoles, EntryShape, FieldDecl } from "@serene-pub/sdk"
import {
	ENTRY_TYPE_IDS,
	ENTRY_TYPE_VERSION,
	type EntryTypeId
} from "$lib/shared/entries/types"

export interface EntryTypeDeclaration {
	/** The bare id — `core:entry/history`. The version is a separate column. */
	typeId: EntryTypeId
	version: number
	roles: EntryRoles
	fields: Record<string, FieldDecl>
	sourceKind: string
	/**
	 * What the type is called in an exported file.
	 *
	 * Read back so the shared `ENTRY_EXPORT_KEY` table can be checked against
	 * the declaration rather than against itself — a mirror needs something to
	 * compare with or it is just a second copy.
	 */
	exportKey?: string
	render?: EntryShape["render"]
}

/** `core:entry/history@1` → `["core:entry/history", 1]`. */
const splitPin = (pin: string): [string, number] => {
	const at = pin.lastIndexOf("@")
	return at < 0
		? [pin, ENTRY_TYPE_VERSION]
		: [pin.slice(0, at), Number(pin.slice(at + 1))]
}

const BY_TYPE_ID = new Map<string, EntryTypeDeclaration>()
for (const descriptor of allEntryTypes()) {
	const [typeId, version] = splitPin(descriptor.id)
	const shape = descriptor.entryShape
	BY_TYPE_ID.set(typeId, {
		typeId: typeId as EntryTypeId,
		version,
		roles: shape.roles ?? {},
		fields: (shape.fields ?? {}) as Record<string, FieldDecl>,
		sourceKind: shape.sourceKind,
		exportKey: shape.exportKey,
		render: shape.render
	})
}

/** What a type declares, or `undefined` for a type this build does not know. */
export const entryDeclaration = (
	typeId: string
): EntryTypeDeclaration | undefined => BY_TYPE_ID.get(typeId)

/** Every declared entry type, in declaration order. */
export const entryDeclarations = (): EntryTypeDeclaration[] => [
	...BY_TYPE_ID.values()
]

/**
 * The budget band a type's rows compete in.
 *
 * Falls back to the id itself for an unknown type, which is a name no band
 * answers — deliberately, so it is dropped with a receipt by `select()` rather
 * than silently scored against `undefined`. `assertEntryDeclarations` is what
 * stops that being reachable at all.
 *
 * ⚠ Reads the SDK's declared `sourceKind` key, which is the same concept under
 * its older name. The key is frozen into `core:entry/*@1`'s content hash, so it
 * moves with a version bump and not with a rename; the boundary is here.
 */
export const bandOfType = (typeId: string): string =>
	BY_TYPE_ID.get(typeId)?.sourceKind ?? typeId

/**
 * Whether a type's rows earn the author's priority bonus.
 *
 * ⚠ **Absent means no bonus, never "absent means 1 and gets the bonus".**
 * History has never had a priority column and both rankers excluded it for that
 * reason. Under one table every type has column-shaped access to everything, so
 * the rule that used to be enforced by a missing column is enforced by a
 * missing *field role* — history declares no `priority`, and that is the whole
 * test.
 * Ungate this and every prompt containing history changes.
 */
export const declaresPriority = (typeId: string): boolean =>
	BY_TYPE_ID.get(typeId)?.roles.priority !== undefined

/**
 * Whether a type's entries may be filed under another entry (Part of) — it
 * declares the `parent` field role (places plan B2, 2026-09-29).
 *
 * ⚠ The one question every writer of `anchor_entry_id` asks before filing a
 * row: the re-parent (`assertAnchorEntry`, which a dated re-parent goes
 * through too) and the import. A place declares no parent — places join by
 * relationships — so it is refused because its declaration says so, never
 * because a handler names its type. Unknown types: no.
 */
export const declaresParent = (typeId: string): boolean =>
	BY_TYPE_ID.get(typeId)?.roles.parent !== undefined

/**
 * The declared default of one field, or `null`.
 *
 * `null` and not `undefined`: the three wire rows this replaces emitted the
 * column default for a field that had one (`priority` 1, `year` 1, `graphed`
 * false) and SQL NULL for a nullable one with none (`category`, `month`,
 * `day`), and a client binds a form control to both. Absent-from-`fields` and
 * declared-with-no-default are the same state to a reader, which is what makes
 * this one lookup rather than two.
 */
export const fieldDefault = (typeId: string, field: string): unknown => {
	const decl = BY_TYPE_ID.get(typeId)?.fields[field]
	return decl?.default ?? null
}

/**
 * Every declared field of a type, in declaration order.
 *
 * Order matters only in that it is stable: the projection spreads them onto the
 * wire row and a reordering would change key order in a serialized payload.
 */
export const declaredFields = (typeId: string): string[] =>
	Object.keys(BY_TYPE_ID.get(typeId)?.fields ?? {})

/**
 * A value from a foreign file, as this field is declared.
 *
 * The importer's job is to record what the author specified; its *other* job is
 * to refuse what would not survive the trip. A declared `integer` that arrives
 * as `"412"` is not a year, and storing it would put a string where every
 * reader expects a number — in jsonb, where no column type is there to refuse
 * it. So a value of the wrong declared type falls back to the field's declared
 * default, or to `null` when it has none, which is the same answer an absent
 * key gets.
 *
 * The four scalar kinds and `enum` are checked, each against what it declares:
 * an `integer` must be whole, a number must sit inside a declared `min`/`max`,
 * and an `enum` must be one of its `of` — an item's `supply: "bottomless"`
 * would otherwise land in the column and read as nothing any reader knows.
 * Anything else passes through, because an unchecked kind is a kind this app
 * has no opinion about yet and inventing one here would be the mapper deciding
 * a schema question.
 */
export function coerceDeclaredField(
	typeId: string,
	field: string,
	value: unknown
): unknown {
	const decl = BY_TYPE_ID.get(typeId)?.fields[field]
	if (!decl) return value ?? null
	const inRange = (n: number) =>
		Number.isFinite(n) &&
		(decl.min === undefined || n >= decl.min) &&
		(decl.max === undefined || n <= decl.max)
	const ok =
		decl.type === "string"
			? typeof value === "string"
			: decl.type === "boolean"
				? typeof value === "boolean"
				: decl.type === "integer"
					? typeof value === "number" &&
						Number.isInteger(value) &&
						inRange(value)
					: decl.type === "number"
						? typeof value === "number" && inRange(value)
						: decl.type === "enum"
							? typeof value === "string" &&
								(decl.of ?? []).includes(value)
							: value !== undefined && value !== null
	return ok ? value : (decl.default ?? null)
}

/**
 * Boot assertion: the declarations this build reads are the ones it needs.
 *
 * Three failures, all of which are silent without it and all of which have
 * happened or nearly happened:
 *
 *  1. **A missing declaration.** Registration is a module side effect, so a
 *     bundler that drops `core-catalog/dist/entries.js` leaves this map empty —
 *     every field role unanswered, every declared default lost, and nothing to report
 *     it. The package names that module as its side-effectful exception; this
 *     is what checks the exception held.
 *  2. **`sourceKind` totality.** `DEFAULT_SIGNAL_WEIGHTS` is a *total* map over
 *     a closed union. A type declaring a band that map does not carry gets its
 *     candidates scored against `undefined` and dropped — **with a green parity
 *     suite**, because no fixture holds a type nothing declared. This already
 *     happened once: history was absent from every prompt between spec 1.8.0
 *     and 1.10.0. The SDK refuses an unbanded `sourceKind` at the author's
 *     line, but the SDK's list and this app's weight map are two lists, and two
 *     lists drift. This is the assertion that makes them one.
 *  3. **A type with no retrieval mechanism.** A declared type whose band no shipped
 *     weight map scores can never reach a prompt.
 *  4. **A retrieval mechanism's own band.** `sourceKind` totality is a property of
 *     *candidates*, not of entry types, and not every candidate comes from one:
 *     `core:query/entity-search@1` returns transcript in the `messages` band,
 *     which no entry type declares because a message is not an entry. Checked
 *     here rather than by a second assertion beside it, because there is one
 *     rule — every band a candidate can arrive in must be a band the weight and
 *     share maps carry — and two places enforcing it is two places to forget.
 *
 * Returns findings rather than throwing so boot can report all of them at once;
 * the caller decides that an empty return is the only acceptable answer.
 */
export function assertEntryDeclarations(
	bands: readonly string[],
	mechanismBands: ReadonlyArray<{
		mechanism: string
		sourceKind: string
	}> = []
): string[] {
	const findings: string[] = []

	for (const { mechanism, sourceKind } of mechanismBands)
		if (!bands.includes(sourceKind))
			findings.push(
				`retrieval mechanism '${mechanism}' emits candidates in band ` +
					`'${sourceKind}', which is not one of the budget bands ` +
					`(${bands.join(", ")}). The weight and share maps are total over ` +
					`those names, so its candidates would be scored against ` +
					`undefined and dropped, with a green parity suite and nothing ` +
					`in the receipt.`
			)

	for (const typeId of ENTRY_TYPE_IDS)
		if (!BY_TYPE_ID.has(typeId))
			findings.push(
				`entry type '${typeId}' is declared by no module in this build. ` +
					`Declaring one registers it, so this means ` +
					`'@serene-pub/core-catalog' (or its entries module) did not load ` +
					`before this reader — check that the package's \`sideEffects\` ` +
					`still names its entry and its entries module. ` +
					`Every field role is unanswered and every declared default is lost.`
			)

	for (const decl of BY_TYPE_ID.values())
		if (!bands.includes(decl.sourceKind))
			findings.push(
				`entry type '${decl.typeId}' declares sourceKind ` +
					`'${decl.sourceKind}', which is not one of the budget bands ` +
					`(${bands.join(", ")}). The weight and share maps are total over ` +
					`those names, so a sixth is not a new band — it is candidates ` +
					`scored against undefined and dropped, with a green parity suite ` +
					`and nothing in the receipt. Add the band to the maps, or declare ` +
					`one that exists.`
			)

	return findings
}
