/**
 * One entry shape, branded by the type it declares.
 *
 * `world_lore_entries`, `character_lore_entries` and `history_entries` were
 * three near-identical tables with no discriminator column anywhere: **the
 * subtype was the table**. `lorebook_entries` replaced them as storage, and
 * this module replaces them on the wire — one row shape, one socket namespace,
 * one set of types, with `typeId` carrying the fact the table used to carry.
 *
 * ## The ambient-type decision, made rather than drifted into
 *
 * The three `Select*Entry` ambient globals inferred from the surviving legacy
 * tables *deliberately*, because that inference is what kept
 * `attachCharacterLoreToCharacters(entries: SelectCharacterLoreEntry[])` a
 * compile-time guard against being handed world lore. Those types named the
 * **wire row**, and the wire contract dies here — so the guard had to be
 * recovered or knowingly given up. It is recovered, as
 * **`LorebookEntry<typeId>`**, and the brand is not a phantom:
 *
 *   · `typeId` is a **real, non-null column** on `lorebook_entries` with a
 *     foreign key into `pipeline_definition_registry`. Narrowing it narrows the
 *     row's declared field half with it, so
 *     `LorebookEntry<"core:entry/character-lore">` and
 *     `LorebookEntry<"core:entry/world-lore">` are mutually unassignable in
 *     *both* directions — the discriminant blocks one way, the field half the
 *     other. That is the same refusal the two ambient globals produced.
 *   · A phantom brand would have bought the same compile-time refusal and
 *     nothing else. This one is **checkable at runtime too** (`isEntryOfType`),
 *     so the guard survives the boundary a type cannot cross — a socket
 *     payload, an import file, a row read back out of the database. A guard
 *     that stops at the type checker is exactly the guard that was missing
 *     when a world lore id could be edited through the character lore events.
 *
 * The cost, stated: a mixed list is a discriminated union rather than three
 * lists, so a reader that wants one shape narrows with `switch (e.typeId)` or
 * `entriesOfType`. That is the shape the data actually has.
 *
 * ## The field half is per type, and the declaration is the source
 *
 * `EntryFieldsByType` mirrors `core-catalog/src/entries.ts` — world lore has a
 * category and a priority, character lore a priority, history a date and two
 * flags. It is stated here because the client needs the shapes without loading
 * the SDK's registry, and `entryTypeShapes.test.ts` fails if it drifts from the
 * declaration. **The declaration is the source of truth; this is a mirror with
 * an alarm on it**, which is the same arrangement `DEFAULT_SIGNAL_WEIGHTS`
 * needed for `sourceKind`.
 */

/** The declared types. Bare ids — the version is a separate column. */
export const WORLD_LORE_TYPE_ID = "core:entry/world-lore"
export const CHARACTER_LORE_TYPE_ID = "core:entry/character-lore"
export const HISTORY_TYPE_ID = "core:entry/history"
/**
 * A place the story can be in, and can be walked out of (L3, 2026-09-17).
 *
 * World lore's shape — agnostic, about the world, private from nobody, in the
 * `worldLore` band. What earns it a type is that a *place* is a thing other
 * places are next to: its exits are **link rows**
 * (`core:outlet/link-lore-entries@1`), never a field, so "which rows are the
 * map" is a question a reader can finally ask.
 */
export const LOCATION_TYPE_ID = "core:entry/location"

/**
 * In the order the tabs read, which is also the order a mixed read returns —
 * world, then character, then history, then locations. Nothing downstream is
 * documented to depend on it, which is exactly why it is written down rather
 * than rebuilt per caller.
 */
export const ENTRY_TYPE_IDS = [
	WORLD_LORE_TYPE_ID,
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	LOCATION_TYPE_ID
] as const

export type EntryTypeId = (typeof ENTRY_TYPE_IDS)[number]

/**
 * The version every core entry type is pinned at.
 *
 * `type_id` + `type_version` is a real foreign key into
 * `pipeline_definition_registry`, so these are not free strings — a misspelling is a
 * constraint violation rather than a row no reader ever asks for. A `@2` is a
 * schema change, and a schema change comes with the code that knows about it.
 */
export const ENTRY_TYPE_VERSION = 1

export const isEntryTypeId = (v: unknown): v is EntryTypeId =>
	typeof v === "string" && (ENTRY_TYPE_IDS as readonly string[]).includes(v)

/**
 * The type-specific half of a row, per type — `fields` jsonb, projected flat.
 *
 * Flat and not nested, because that is what the three wire rows already were
 * and what every curated editor already binds to. The nesting exists in
 * storage, where it belongs; a form field is a form field.
 */
export interface EntryFieldsByType {
	[WORLD_LORE_TYPE_ID]: {
		category: string | null
		priority: number
	}
	[CHARACTER_LORE_TYPE_ID]: {
		priority: number
		/**
		 * The `anchor` role's column (`anchor_binding_id`), under the name the
		 * wire has always used.
		 *
		 * Per type rather than on the base, because the *declaration* is what
		 * puts it here: character lore declares
		 * `anchor: { column, policy: 'core:policy/binding-visibility@1' }` and
		 * the other two declare no anchor at all. World lore is about the
		 * world, so there is nobody it could be private from — that absence is
		 * the declaration doing its job, and flattening the column onto every
		 * shape would erase it.
		 */
		lorebookBindingId: number | null
	}
	[HISTORY_TYPE_ID]: {
		year: number
		month: number | null
		day: number | null
		isCompleted: boolean
		graphed: boolean
	}
	/**
	 * World lore's field half exactly, because a location IS world lore's shape
	 * — the type exists for the edges, not for a column. ⚠ No `exits`: the
	 * settings language has no reference type, so an `exits` field could only
	 * hold names, with no foreign key and no cascade when the room it names is
	 * deleted. That is the parseable `Exits:` line this type replaced, one
	 * column over.
	 */
	[LOCATION_TYPE_ID]: {
		category: string | null
		priority: number
	}
}

/** The columns the engine reads for every type, whatever it declares. */
export interface EntryColumns {
	id: number
	lorebookId: number
	/**
	 * The `title` role, under the name the wire has always used.
	 *
	 * `null` for a type that declares no `title` role — history is not named,
	 * it is *dated*, and its heading is the date. A type that declares one gets
	 * `""` rather than null where the column is empty, which is what the
	 * `NOT NULL` columns this replaces produced.
	 */
	name: string | null
	/** Comma-delimited, as authored. `text[]` in storage since 0188. */
	keys: string
	/**
	 * The condition keys, comma-delimited like `keys`. `text[]` in storage.
	 *
	 * Empty when the entry has no condition, which is every entry that has
	 * never been given one.
	 */
	secondaryKeys: string
	/**
	 * `andAny` / `andAll` / `notAny` / `notAll`, or null for no condition.
	 *
	 * Typed as a plain string here rather than as the union, because this is
	 * what came off a `text` column and a value from a build that declared a
	 * fifth mode has to arrive rather than fail to type. `isSelectiveLogic`
	 * narrows it where it is read.
	 */
	selectiveLogic: string | null
	/**
	 * The `parent` role's column — the entry this one is filed under, or null
	 * for a root.
	 *
	 * On the base rather than per type: the column is one traversal edge for
	 * every shape (a district's city, a scene's history entry, an amendment's
	 * base), and the workspace's tree nests every kind on it at once.
	 *
	 * ⚠ **Writable, and validated on the way in.** `null` is top level. The
	 * handler refuses a parent in another lorebook, a parent that does not
	 * exist, the entry itself, and any target whose own chain of parents leads
	 * back to this entry — a cycle is a tree nothing can draw and a walk
	 * nothing can end.
	 */
	anchorEntryId: number | null
	/**
	 * The line this entry was written on. `null` is **shared**.
	 *
	 * ⚠ Shared is the default and the common case: a branch duplicates nothing,
	 * so the entries both lines agree about are one row with `null` here. Only
	 * an entry created while reading a branch carries an id, and only that
	 * line sees it (`rowsOnLine`, `$lib/shared/lorebooks/amendments.ts`).
	 */
	branchId: number | null
	matchMode: string | null
	useRegex: boolean | null
	caseSensitive: boolean
	recursionDepth: number | null
	content: string
	constant: boolean
	enabled: boolean
	/**
	 * Out of the manager's way, and out of retrieval — a different fact from
	 * `enabled`.
	 *
	 * `enabled: false` is a switch on a row the author still keeps in front of
	 * them; archiving is what a row gets when it should stop occupying the
	 * list without being destroyed. Writable, like `enabled`.
	 */
	archived: boolean
	/**
	 * Who wrote this row — `human`, `summarizer`, `graph-builder`.
	 *
	 * ⚠ **Projected, never written from a client.** It is the fact that decides
	 * whether a machine writer may overwrite a sentence a person typed, so a
	 * payload that could set it would be a payload that could claim to be a
	 * person. `splitUpdate` does not name it and `entryInsert` leaves it at the
	 * column's default.
	 */
	provenance: string
	extraJson: Record<string, any>
	/** `'YYYY-MM-DD'` — the legacy `date` column's string, kept for the client. */
	createdAt: string
	updatedAt: Date
	position: number
	embedding: number[] | null
	embeddingModel: string | null
	vectorizedAt: Date | null
}

/**
 * One entry, branded by its declared type.
 *
 * Distributive on purpose: bare `LorebookEntry` is the union of the three, so a
 * mixed list is a discriminated union that `switch (e.typeId)` narrows, and
 * `LorebookEntry<"core:entry/history">` is exactly one shape.
 */
export type LorebookEntry<T extends EntryTypeId = EntryTypeId> =
	T extends EntryTypeId
		? EntryColumns & { typeId: T } & EntryFieldsByType[T]
		: never

/** The columns a client may set. The rest are the server's to decide. */
type WritableColumns = Omit<
	EntryColumns,
	| "id"
	| "createdAt"
	| "updatedAt"
	| "position"
	| "embedding"
	| "embeddingModel"
	| "vectorizedAt"
	// Who wrote the row is the server's answer — see the column.
	| "provenance"
>

/**
 * A new entry, as a writer states it.
 *
 * `lorebookId` and `typeId` are required — an entry with no book is nowhere,
 * and an entry with no type is the exact hole this whole step closes. The rest
 * are optional and take their column or declared default.
 */
export type NewLorebookEntry<T extends EntryTypeId = EntryTypeId> =
	T extends EntryTypeId
		? Partial<WritableColumns> &
				Partial<EntryFieldsByType[T]> & {
					typeId: T
					lorebookId: number
				}
		: never

/**
 * A patch to an existing entry.
 *
 * `typeId` rides along and is **not** a relocation: the handler uses it to
 * scope the write, so a world lore id presented to a character lore patch finds
 * no row rather than being edited through the wrong shape.
 */
export type LorebookEntryPatch<T extends EntryTypeId = EntryTypeId> =
	T extends EntryTypeId
		? Partial<WritableColumns> &
				Partial<EntryFieldsByType[T]> & {
					id: number
					typeId: T
					lorebookId?: number
				}
		: never

/** Narrow a row to one declared type — the runtime half of the brand. */
export const isEntryOfType = <T extends EntryTypeId>(
	entry: LorebookEntry,
	typeId: T
): entry is LorebookEntry<T> => entry.typeId === typeId

/** Every entry of one type, narrowed. The list form of `isEntryOfType`. */
export const entriesOfType = <T extends EntryTypeId>(
	entries: readonly LorebookEntry[],
	typeId: T
): LorebookEntry<T>[] =>
	entries.filter((e): e is LorebookEntry<T> => e.typeId === typeId)

/** The three names a lorebook file has ever carried. */
export type EntryExportKey = "world" | "character" | "history"

/**
 * What a type is called in an exported file.
 *
 * ⚠ **Never write `core:entry/world-lore@1` into a file.** The wire names are
 * `world` / `character` / `history`, they are what every lorebook Serene Pub
 * has ever exported carries in `extensions.serenepub.entryType`, and a file is
 * read by installs whose type registry is not this one. The mapping lives here
 * so both directions read the same table.
 *
 * **Partial, and that is the declaration doing its job** (L3, 2026-09-17). A
 * type outside the three names simply has none: no marker is honest, where a
 * marker no importer reads is a file that round-trips into the wrong shape.
 * `core:entry/location` is the first such type — exported, it is written as
 * world lore (`DEFAULT_EXPORT_KEY`), which is the correct degrade and what
 * every install that has never heard the word reads it back as. The marker
 * waits for an importer that knows it.
 */
export const ENTRY_EXPORT_KEY: Partial<Record<EntryTypeId, EntryExportKey>> = {
	[WORLD_LORE_TYPE_ID]: "world",
	[CHARACTER_LORE_TYPE_ID]: "character",
	[HISTORY_TYPE_ID]: "history"
}

/** What a type with no marker of its own is written as: the agnostic shape. */
export const DEFAULT_EXPORT_KEY: EntryExportKey = "world"

const TYPE_ID_BY_EXPORT_KEY = Object.fromEntries(
	Object.entries(ENTRY_EXPORT_KEY).map(([typeId, key]) => [key, typeId])
) as Record<EntryExportKey, EntryTypeId>

/**
 * The declared type an export key names.
 *
 * Anything else — a key from a tool that is not Serene Pub, a bare CCv2/CCv3
 * file, a marker from a future release — falls back to world lore, the most
 * agnostic shape, which is what this importer has always done for a foreign
 * source.
 */
export const entryTypeIdOfExportKey = (key: unknown): EntryTypeId =>
	(typeof key === "string" && TYPE_ID_BY_EXPORT_KEY[key as EntryExportKey]) ||
	WORLD_LORE_TYPE_ID

/** What the tabs call each type. Curated names, never "entry type". */
export const ENTRY_TYPE_LABEL = {
	[WORLD_LORE_TYPE_ID]: "World Lore",
	[CHARACTER_LORE_TYPE_ID]: "Character Lore",
	[HISTORY_TYPE_ID]: "History",
	[LOCATION_TYPE_ID]: "Places"
} as const satisfies Record<EntryTypeId, string>
