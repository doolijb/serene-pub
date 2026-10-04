/**
 * Pure mapping helpers for importing a parsed CharacterBook (lorebook/world
 * info, CCv2/CCv3 spec) into Serene Pub's entry shape. Kept free of DB imports
 * so the mapping logic can be unit tested without a database — the type
 * declarations it reads are code, not rows.
 */

import {
	coerceDeclaredField,
	declaredFields,
	entryDeclaration
} from "$lib/server/entries/declarations"
import {
	SELECTIVE_LOGIC_BY_ST_CODE,
	type SelectiveLogic
} from "$lib/server/pipelines/ranking/signals"
import type { MatchMode } from "$lib/server/pipelines/ranking/weights"
import { ENTRY_PROVENANCES } from "$lib/server/utils/lorebookEntries"
import {
	entryTypeIdOfExportKey,
	HISTORY_TYPE_ID,
	LOCATION_TYPE_ID,
	type EntryTypeId
} from "$lib/shared/entries/types"
// How deep an imported nesting may go, and the ceiling that ends a walk over a
// chain that turns out to contain a cycle — `assertAnchorEntry`'s own limit,
// so the import refuses exactly what a re-parent would.
import { MAX_ANCHOR_DEPTH } from "$lib/shared/lorebooks/limits"
// Which types may be filed at all — the re-parent's first question, asked of
// the declaration (places plan B2).
import { declaresParent } from "$lib/server/entries/declarations"
// A key that could take unbounded time to match is not read as a pattern
// (plan S3) — the import's refusal, since an import cannot stop to ask.
import { runawayPatternOf } from "$lib/shared/entries/runawayPattern"

/**
 * True if a lorebook-shaped object actually has entries — handles both a
 * proper array and the legacy object-keyed-by-index shape (see
 * normalizeLegacyLorebookData). CharacterCard's own `character_book` getter
 * always returns a placeholder object (`{entries: [], ...}`) even for cards
 * with no book at all, so a plain truthiness check on the book itself isn't
 * enough — this is what actually distinguishes "has a book" from "doesn't".
 */
export function hasLorebookEntries(book: unknown): boolean {
	const entries = (book as any)?.entries
	if (Array.isArray(entries)) return entries.length > 0
	if (entries && typeof entries === "object")
		return Object.keys(entries).length > 0
	return false
}

/**
 * Normalizes older/legacy lorebook JSON shapes before handing off to
 * parseImportedLorebook(), which only understands a narrow set of shapes
 * (a raw array, `{entries: [...]}`, or a full card's nested
 * `data.character_book.entries`) and silently produces an *empty* book —
 * not an error — for anything else. Two real-world legacy shapes this
 * patches:
 *   - SillyTavern's older World Info export keys entries by a numeric index
 *     object (`{entries: {"0": {...}, "1": {...}}}`) rather than an array.
 *   - Some tools write a single-string `key`/`keysecondary` field instead
 *     of the `keys`/`secondary_keys` arrays the spec expects.
 */
export function normalizeLegacyLorebookData(rawData: unknown): any {
	if (!rawData || typeof rawData !== "object") return rawData

	let entries = (rawData as any).entries
	if (entries && !Array.isArray(entries) && typeof entries === "object") {
		entries = Object.values(entries)
	}
	if (!Array.isArray(entries)) return rawData

	// Only touches a field when it actually needs normalizing (present, but
	// not already array-shaped) — never invents `key`/`keysecondary` on an
	// entry that never had them. An already-normalized entry (eg. Serene
	// Pub's own prior export) is returned untouched, byte-for-byte; without
	// this, every re-import of an unedited lorebook would gain phantom empty
	// `keysecondary: []`/duplicate `key: [...]` fields the original export
	// never had, making its hash never match the existing row's and turning
	// every "unchanged" re-import into a false "conflict".
	const normalizedEntries = entries.map((entry: any) => {
		if (!entry || typeof entry !== "object") return entry
		const patch: Record<string, unknown> = {}

		if ("key" in entry && !Array.isArray(entry.key)) {
			patch.key = entry.key ? [entry.key] : []
		}
		if (!Array.isArray(entry.keys)) {
			patch.keys = Array.isArray(entry.key)
				? entry.key
				: entry.key
					? [entry.key]
					: []
		}
		if ("keysecondary" in entry && !Array.isArray(entry.keysecondary)) {
			patch.keysecondary = entry.keysecondary ? [entry.keysecondary] : []
		}

		return Object.keys(patch).length > 0 ? { ...entry, ...patch } : entry
	})

	return { ...rawData, entries: normalizedEntries }
}

/** A lorebook import payload's own fields, read straight off the parsed JSON. */
export interface ParsedImportedLorebook {
	name?: string
	description?: string
	extensions: Record<string, any>
	entries: any[]
}

/**
 * The lorebook `lorebooks:import` is about to write, read off the raw parsed
 * JSON.
 *
 * ⚠ **This deliberately replaces `CharacterBook.from_json()`**, which is
 * unusable here for one reason: its constructor runs `_keys_fix()`, splitting
 * **every** key on `[,|;，；]`. A regex key written `/foo|bar/i` arrived as two
 * keys — `/foo` and `bar/i` — and `useRegexOf` then, correctly, called the
 * entry a literal. The bulk SillyTavern import (sockets/import.ts) hands its
 * entries straight to `mapImportedEntry`, so **the same file imported
 * differently depending on which door it came through**, and "regex by key
 * shape" was only trustworthy for keys containing none of those characters.
 * Reading the JSON here is the whole of the fix; nothing else about the two
 * doors differed.
 *
 * What `from_json` did that this must keep doing, since dropping any of it
 * silently empties something that used to arrive populated:
 *
 *  · **entries** — the first of `data` itself (a bare array), `data.entries`,
 *    or `data.data.character_book.entries`, else `[]`. Same order of
 *    preference, so every shape that parsed before still parses. Deliberately
 *    *not* deep-cloned as the reader did: nothing downstream writes to an
 *    entry, and the clone existed so `_keys_fix` had something of its own to
 *    rewrite.
 *  · **name** and **description** — off `data.character_book`, then
 *    `data.data.character_book`, then `data` itself. Left `undefined` when the
 *    file states neither, which is what `from_json` also left them (it assigns
 *    over its own class defaults), and what the caller's
 *    `card.name || "Imported Lorebook"` is there for.
 *  · **extensions** — the same three-step lookup, defaulting to `{}`. This is
 *    the one backfill that carries data: `extensions.serenepub` is where
 *    bindings, embedded characters/personas and the narrative graph live.
 *  · **the non-object guard** — `from_json` threw on a null/non-object payload
 *    and the handler reported it to the user; that stays a throw.
 *
 * One behaviour it deliberately does not keep: `_keys_fix` iterated
 * `entry.keys` unguarded, so an entry with no key list at all — reachable
 * through the nested-card shape, which normalizeLegacyLorebookData does not
 * reach into — threw "keys is not iterable" and failed the whole import. The
 * bulk door has always mapped that same entry happily, and closing that gap is
 * the point of this function.
 *
 * Three of the reader's defaults are deliberately **not** reproduced:
 * `recursive_scanning ?? true`, `scan_depth ?? 10`, and `token_budget`
 * (which `from_json` left undefined anyway). Nothing reads them off the parsed
 * book — `extractLorebookLevelExtraJson` (sockets/lorebooks.ts) reads all three
 * off the RAW payload precisely so the reader's fabricated values never reach a
 * row, and its comment says so.
 */
export function parseImportedLorebook(
	rawData: unknown
): ParsedImportedLorebook {
	if (typeof rawData !== "object" || rawData === null) {
		throw new Error("Lorebook data must be an object.")
	}
	const data = rawData as any

	const entries = Array.isArray(data)
		? data
		: Array.isArray(data.entries)
			? data.entries
			: Array.isArray(data.data?.character_book?.entries)
				? data.data.character_book.entries
				: []

	// The book's own metadata can sit one level down (a whole card) or be the
	// payload itself (a bare lorebook file) — and, as in the reader, the two
	// lookups are independent: a payload with top-level `entries` still takes
	// its name from a `character_book` alongside them if there is one.
	const book = data.character_book ?? data.data?.character_book ?? data

	return {
		name: book?.name,
		description: book?.description,
		extensions: book?.extensions ?? {},
		entries
	}
}

/**
 * Resolves narrative graph nodes' real `parentNodeId` links from their
 * exported `localId`/`parentLocalId` pairs, enforcing the app's own
 * `narrativeNodes.parentNodeId` invariant ("2-level max": a node's parent
 * must not itself have a parent). A crafted or malformed import can
 * otherwise link a node to itself, or chain aliases deeper than the schema
 * is meant to support — both silently, since the DB column itself has no
 * constraint preventing either. Two cases are skipped rather than linked:
 *   - a node listing itself as its own parent (`parentLocalId === localId`)
 *   - a node whose chosen parent already has its own parent in the source
 *     data (linking would create a 3rd alias level)
 * Pure/DB-free so this logic can be unit tested without a database —
 * restoreNarrativeGraph (lorebooks.ts) does the actual DB update per link.
 */
export function resolveParentNodeLinks(
	rawNodes: Array<{ localId?: unknown; parentLocalId?: unknown }>,
	nodeLocalIdToRealId: Map<number, number>
): Array<{ realId: number; parentRealId: number }> {
	const parentLocalIdByLocalId = new Map<number, number>()
	for (const node of rawNodes) {
		if (
			typeof node?.localId === "number" &&
			typeof node?.parentLocalId === "number"
		) {
			parentLocalIdByLocalId.set(node.localId, node.parentLocalId)
		}
	}

	const links: Array<{ realId: number; parentRealId: number }> = []
	for (const node of rawNodes) {
		if (
			typeof node?.localId !== "number" ||
			typeof node?.parentLocalId !== "number"
		) {
			continue
		}
		const { localId, parentLocalId } = node as {
			localId: number
			parentLocalId: number
		}
		if (parentLocalId === localId) continue
		if (parentLocalIdByLocalId.has(parentLocalId)) continue

		const realId = nodeLocalIdToRealId.get(localId)
		const parentRealId = nodeLocalIdToRealId.get(parentLocalId)
		if (!realId || !parentRealId) continue
		links.push({ realId, parentRealId })
	}
	return links
}

/**
 * Resolves each imported entry's `anchorEntryId` from the local ids its file
 * states, refusing the links the app's own re-parent refuses.
 *
 * Four are dropped rather than written: the parent of an entry whose type
 * declares no `parent` field role (a place is never filed — places plan B2,
 * 2026-09-29; `unfileable` below names them so the caller can say so), a
 * parent this import never inserted, an entry filed under itself, and a link
 * whose chain of parents leads back to the entry being filed — a cycle, which
 * the column itself does not prevent and which hangs any walk over the tree. A
 * cycle drops every link in it, because none of them is the one that is right.
 *
 * `localId` is null for an entry the document points at from nowhere: such an
 * entry cannot be a link in a cycle, since every member of one is some other
 * member's parent. `typeId` absent is a type that files. Pure/DB-free so this
 * is unit testable without a database — `insertLorebookEntries`
 * (lorebooks.ts) does the per-link update.
 */
export function resolveAnchorEntryLinks(
	pending: Array<{
		realId: number
		localId: number | null
		anchorLocalId: number
		typeId?: string
	}>,
	entryLocalIdToRealId: Map<number, number>
): Array<{ realId: number; anchorRealId: number }> {
	const filed = pending.filter((p) => !unfileable(p))
	const anchorLocalIdByLocalId = new Map<number, number>()
	for (const { localId, anchorLocalId } of filed)
		if (localId !== null) anchorLocalIdByLocalId.set(localId, anchorLocalId)

	const links: Array<{ realId: number; anchorRealId: number }> = []
	for (const { realId, localId, anchorLocalId } of filed) {
		const anchorRealId = entryLocalIdToRealId.get(anchorLocalId)
		if (anchorRealId === undefined || anchorRealId === realId) continue

		let cursor: number | undefined = anchorLocalId
		for (
			let depth = 0;
			cursor !== undefined && depth < MAX_ANCHOR_DEPTH;
			depth++
		) {
			if (cursor === localId) break
			cursor = anchorLocalIdByLocalId.get(cursor)
		}
		// A walk that reaches a root leaves nothing in hand. Anything else
		// stopped on the entry itself or ran past the ceiling, and a chain that
		// does either is not one this entry may join.
		if (cursor !== undefined) continue

		links.push({ realId, anchorRealId })
	}
	return links
}

/**
 * Whether an imported entry's stated parent must be dropped because its type
 * is never filed (declares no `parent` field role) — the re-parent's first
 * refusal, so the import writes nothing the editor would refuse.
 */
export const unfileable = (pending: { typeId?: string }): boolean =>
	pending.typeId !== undefined && !declaresParent(pending.typeId)

export interface LorebookEntryLike {
	keys: string[]
	content: string
	enabled: boolean
	constant?: boolean
	name?: string
	comment?: string
	priority?: number
	case_sensitive?: boolean
	use_regex?: boolean
	/**
	 * The condition keys, under the CCv2/V3 spec's own name — and, because a
	 * native World Info file spells the same field `keysecondary` and
	 * normalizeLegacyLorebookData feeds that shape through verbatim, under
	 * that name too. See `secondaryKeysOf`.
	 */
	secondary_keys?: string[]
	keysecondary?: string[]
	/**
	 * SillyTavern's gate on the condition: false means *ignore my condition
	 * keys*, and its scanner honours it (`entry.selective && …keysecondary`).
	 * Absent is not false — ST's own entry template defaults it to true, so
	 * only an explicit `false` suppresses. See `selectiveLogicOf`.
	 */
	selective?: boolean
	/**
	 * ST's `selectiveLogic` **integer**, as a native World Info file spells it
	 * (top-level); a `character_book` carries the same integer at
	 * `extensions.selectiveLogic`. Typed `unknown` because a foreign file can
	 * write anything here and only a known code is read — see
	 * `selectiveLogicOf`.
	 */
	selectiveLogic?: unknown
	/**
	 * SillyTavern's *native* World Info export keys this camelCase and puts it
	 * at the top of the entry (its native entries have no `extensions` bag at
	 * all); the CCv2/V3 `character_book` form of the same flag lives at
	 * `extensions.match_whole_words`. Both shapes reach this mapper, since
	 * normalizeLegacyLorebookData() feeds the native one through verbatim.
	 */
	matchWholeWords?: boolean | null
	extensions?: Record<string, any>
}

/**
 * SillyTavern's *native* World Info entry, as a `worlds/*.json` file spells it.
 *
 * The same facts as a CCv2/V3 `character_book` entry under different names:
 * `key` for `keys`, `disable` for the negation of `enabled`, `caseSensitive`
 * for `case_sensitive`, `comment` for the title. ST's own
 * `convertWorldInfoToCharacterBook` is the translation table this mirrors.
 */
export interface NativeWorldInfoEntryLike {
	key?: unknown
	keys?: unknown
	/**
	 * The native spelling of `secondary_keys`. Deliberately **not** renamed by
	 * the adapter below: the mapper reads both names anyway, because
	 * `lorebooks:import` reaches a native-shaped entry through
	 * normalizeLegacyLorebookData, which does not rename it either.
	 */
	keysecondary?: unknown
	/** Native and CCv2 spell these two the same. See `LorebookEntryLike`. */
	selective?: unknown
	selectiveLogic?: unknown
	comment?: unknown
	content?: unknown
	constant?: unknown
	disable?: unknown
	enabled?: unknown
	caseSensitive?: unknown
	case_sensitive?: unknown
	matchWholeWords?: boolean | null
	extensions?: Record<string, any>
}

/**
 * A native World Info entry under the names the mapper reads — a **shape**
 * adapter, never a second mapping.
 *
 * Two import paths reach ST data: `lorebooks:import` takes one CCv2/V3
 * `character_book`, and the bulk data-directory import walks `worlds/*.json`,
 * which is ST's own storage format rather than the interchange one. Only the
 * field *names* differ, so the difference is resolved here and both paths then
 * run the one mapper — `useRegexOf` decides regex from key shape, `matchModeOf`
 * reads the declared whole-word intent, `extensions` is preserved into
 * `extraJson`, and `priority` is clamped, once, in one place.
 *
 * ⚠ **Strictly additive.** A native name only fills a CCv2 field the entry does
 * not already carry, and only when it is actually present: `!entry.disable` on
 * an entry that never had `disable` would read `enabled: true` and overwrite a
 * genuine `enabled: false`. Which name wins is decided by `hasOwnProperty`, not
 * truthiness, for that reason.
 *
 * `order` is deliberately **not** aliased onto `priority`. ST's `order` is an
 * insertion index (its default is 100), not a 1-3 importance band, and clamping
 * one into the other reads "every imported entry is maximum priority" — see the
 * note at the call site in sockets/import.ts.
 */
export function normalizeNativeWorldInfoEntry(
	entry: NativeWorldInfoEntryLike
): LorebookEntryLike {
	const has = (key: string) =>
		Object.prototype.hasOwnProperty.call(entry, key)
	const source = entry as Record<string, unknown>

	const keys = has("keys") ? source.keys : has("key") ? source.key : undefined

	const caseSensitive = has("case_sensitive")
		? source.case_sensitive
		: source.caseSensitive

	// Each narrowed field is written *after* the spread so it wins: a native
	// `comment` that is not a string has to be removed, not merely not-added,
	// or it reaches the mapper's `entry.name || entry.comment` and a number
	// lands in a text column.
	return {
		...(entry as Record<string, any>),
		keys: Array.isArray(keys) ? (keys as string[]) : [],
		content: typeof source.content === "string" ? source.content : "",
		enabled: has("enabled")
			? source.enabled !== false
			: has("disable")
				? !source.disable
				: true,
		comment:
			typeof source.comment === "string" ? source.comment : undefined,
		case_sensitive:
			typeof caseSensitive === "boolean" ? caseSensitive : undefined
	}
}

/**
 * Strips Serene Pub's own `serenepub` bookkeeping key out of an entry's
 * `extensions` bag before stashing the rest into `extraJson`. Without this,
 * re-importing something Serene Pub itself exported would nest last time's
 * `serenepub` metadata inside `extraJson`, which the next export would then
 * wrap in a *new* `serenepub` key — accumulating a layer of stale nesting on
 * every round trip. `serenepub` metadata is always re-derived fresh from the
 * DB row's real columns at export time, so it never needs to be preserved as
 * opaque foreign data.
 */
function omitSerenepubExtension(
	extensions: Record<string, any> | undefined
): Record<string, any> {
	if (!extensions) return {}
	const { serenepub, ...rest } = extensions
	return rest
}

/**
 * Clamp an entry's priority into Serene Pub's supported 1-3 range, as a whole
 * number (the type's CHECK holds it to one): a fraction rounds, and anything
 * that is not a finite number is the default, 1.
 */
export function normalizeLorebookEntryPriority(
	priority: number | null | undefined
): number {
	if (typeof priority !== "number" || !Number.isFinite(priority)) return 1
	return Math.min(3, Math.max(1, Math.round(priority)))
}

/**
 * SillyTavern's key-shape grammar, mirrored exactly from `parseRegexFromString`
 * (public/scripts/world-info.js): a leading `/`, a non-greedy body of at least
 * one character, a closing `/`, and only real JavaScript flags after it.
 */
const DELIMITED_REGEX_KEY = /^\/([\w\W]+?)\/([gimsuy]*)$/
/** Its companion check — a `/` inside the body that isn't backslash-escaped. */
const UNESCAPED_DELIMITER = /(^|[^\\])\//

/**
 * The bare regex source of a key written in SillyTavern's `/pattern/flags`
 * form, or null when the key is a plain literal — the same three-step answer
 * `parseRegexFromString` gives, so Serene Pub calls a key a regex exactly when
 * SillyTavern's own scanner does: it must parse as `/body/flags`, its body must
 * not contain an unescaped delimiter, and it must compile.
 *
 * Compilation is checked *with* the declared flags (as SillyTavern does, so the
 * accept/reject decision matches), but only the body is returned: Serene Pub
 * has nowhere to keep flags. `g`/`y` mean nothing to the fresh `new RegExp()`
 * that ranking/signals.ts builds per test, and `i` is already how a
 * non-`caseSensitive` entry behaves there (both sides get lowercased) — but an
 * `m`/`s`/`u`-dependent pattern genuinely does change meaning on the way in.
 * That is the honest limit of what this schema can carry, not an oversight.
 *
 * The body is kept byte-for-byte, `\/` escapes included. JavaScript treats `\/`
 * and `/` identically inside a pattern, so unescaping buys nothing here and
 * would corrupt a `\\/` (a literal backslash before the delimiter) — which is
 * precisely what SillyTavern's own `pattern.replace('\\/', '/')` does, since a
 * string-argument replace only touches the first occurrence.
 *
 * ⚠ **A runaway pattern is not a regex key either** (plan S3) — one that can
 * take unbounded time to match, `/(a+)+$/`. It is read the way an invalid one
 * is: its entry imports as a literal, the key sits in its list delimiters and
 * all where its author can see it, and it never runs. That is the editor's
 * refusal made without a person to refuse to — and the same direction the
 * mixed-entry rule below takes: under-matching, visibly.
 */
export function parseDelimitedRegexKey(key: unknown): string | null {
	if (typeof key !== "string") return null
	const match = DELIMITED_REGEX_KEY.exec(key)
	if (!match) return null
	const [, pattern, flags] = match
	if (UNESCAPED_DELIMITER.test(pattern)) return null
	try {
		new RegExp(pattern, flags)
	} catch {
		// Invalid syntax is not a regex key at all — SillyTavern falls back to
		// matching the whole `/.../` string as plain text, and so do we.
		return null
	}
	if (runawayPatternOf(pattern)) return null
	return pattern
}

/**
 * Whether Serene Pub should match this entry's keys as regexes.
 *
 * Deliberately *not* `entry.use_regex`. SillyTavern's character_book exporter
 * sets that flag on every entry it writes, unconditionally
 * (`src/endpoints/characters.js`: `use_regex: true, // ST keys are always
 * regex`), and the comment is untrue of SillyTavern's own runtime: `matchKeys`
 * (public/scripts/world-info.js) asks `parseRegexFromString` about each *key*
 * and treats it as a regex only in `/pattern/flags` form, matching everything
 * else as plain text. Trusting the flag turned every imported key into a
 * pattern, so a literal key holding `.`, `+`, `?`, `(`, `[` or `|` quietly
 * matched the wrong text — `a.b` firing on "axb" — with only an
 * outright-invalid pattern falling back to substring (ranking/signals.ts).
 *
 * So the keys' shape decides, exactly as SillyTavern decides it. Serene Pub
 * stores one `useRegex`/`matchMode` per *entry* though, not per key, which
 * forces two rulings a per-key scanner never has to make:
 *
 *   - A **mixed** entry (some keys delimited, some not) cannot be represented
 *     faithfully. It imports as a literal, keys verbatim, delimiters and all.
 *     That direction is the deliberate one: calling the entry a regex silently
 *     re-reads its plain keys as patterns, which is the exact bug this
 *     replaces and is invisible in use, whereas a literal `/foo|bar/i` key
 *     simply never fires and sits in the entry's key list where the user can
 *     see it and split the entry in two. Under-matching, visibly, beats
 *     over-matching, silently.
 *   - An entry with **no keys** has no shape to read, so it is a literal —
 *     which also lets its declared whole-word intent through (moot, but
 *     consistent). The cost is that a keyless entry's meaningless
 *     `use_regex: true` does not survive a re-export.
 *
 * Our own exports re-read as regex on shape alone: lorebookExportMapper.ts
 * writes a regex entry's keys in `/pattern/flags` form (and, as a bonus, they
 * are finally read as one by SillyTavern too).
 *
 * ⚠ **One exemption: a Serene Pub 0.5.x export.** 0.5 wrote a regex entry's
 * keys BARE beside an honest `use_regex: true` (its `use_regex` was the row's
 * own column, never SillyTavern's constant), so on shape alone every 0.5 regex
 * entry imported as a literal and silently stopped matching. An entry carrying
 * Serene Pub's own `extensions.serenepub.entryType` marker AND `use_regex:
 * true` is therefore a regex when every key compiles as a bare pattern. The
 * marker is forgeable, but forging it can only change how the forger's own
 * file reads — and SillyTavern never writes it, so the constant-`true` problem
 * above cannot reach this branch.
 */
export function useRegexOf(entry: LorebookEntryLike): boolean {
	const keys = entry.keys ?? []
	if (keys.length === 0) return false
	const regex =
		keys.every((key) => parseDelimitedRegexKey(key) !== null) ||
		isSerenePubBareRegexEntry(entry)
	// The condition keys are read in the same mode, so a regex entry whose
	// condition key is a runaway pattern would run it (plan S3): the entry
	// imports as a literal instead, like a mixed one.
	return regex && !secondaryKeysOf(entry).some(runawayConditionKey)
}

/** A condition key that would run as a runaway pattern on a regex entry. */
const runawayConditionKey = (key: unknown): boolean => {
	if (typeof key !== "string" || !key.trim()) return false
	const delimited = DELIMITED_REGEX_KEY.exec(key)
	return !!runawayPatternOf(delimited ? delimited[1]! : key.trim())
}

/**
 * A 0.5.x Serene Pub regex entry: marker, honest flag, bare compilable keys —
 * none of them a runaway pattern (plan S3; see `parseDelimitedRegexKey`).
 */
function isSerenePubBareRegexEntry(entry: LorebookEntryLike): boolean {
	if (entry.use_regex !== true) return false
	if (typeof entry.extensions?.serenepub?.entryType !== "string") return false
	return (entry.keys ?? []).every((key) => {
		if (typeof key !== "string" || key.length === 0) return false
		try {
			new RegExp(key)
		} catch {
			return false
		}
		return !runawayPatternOf(key)
	})
}

/**
 * A key list as Serene Pub stores it: comma-joined, and — for an entry
 * importing as a regex — stripped down to each key's bare pattern. The
 * stripping is what makes the regex real: ranking/signals.ts compiles a key
 * with `new RegExp(key)`, so a stored `/foo/i` would be a pattern matching the
 * literal slashes and never fire. This applies to our own exports too, which
 * now write the delimited form (see lorebookExportMapper.ts).
 *
 * One function for both lists because the *entry* is what is or is not a
 * regex: `selectiveLogicHolds` tests a condition key with the same
 * `matchesKey` the primary keys go through, so a condition key left delimited
 * on a regex entry would compile to a pattern matching literal slashes and
 * silently never hold.
 */
function importedKeyList(keys: string[], useRegex: boolean): string {
	return importedKeyArray(keys, useRegex).join(", ") || ""
}

/**
 * The same keys, NOT joined — what the `keys` / `secondary_keys` text[] columns
 * should hold.
 *
 * ⚠ The joined string above is re-split on every `,` when it is written
 * (`entryInsert` → `keysToArray`), which tears a regex quantifier `{1,3}` and a
 * literal key "Smith, John" in two (finding #146). The importer writes these
 * arrays straight into the columns instead, so one file key stays one stored
 * key. The joined form stays for callers that still speak the comma wire.
 */
export function importedKeyArray(keys: string[], useRegex: boolean): string[] {
	const list = (keys ?? []).filter(
		(key): key is string => typeof key === "string" && key.trim().length > 0
	)
	return useRegex
		? list.map((key) => parseDelimitedRegexKey(key) ?? key)
		: list.map((key) => key.trim())
}

/**
 * An entry's primary and condition keys as the text[] columns should store
 * them — one file key, one element, stripped of delimiters on a regex entry
 * exactly as `sharedEntryFields` strips them. For writers that store straight
 * into the columns rather than through the comma-joined wire (finding #146).
 */
export function importedKeyColumns(entry: LorebookEntryLike): {
	keys: string[]
	secondaryKeys: string[]
} {
	const useRegex = useRegexOf(entry)
	return {
		keys: importedKeyArray(entry.keys ?? [], useRegex),
		secondaryKeys: importedKeyArray(secondaryKeysOf(entry), useRegex)
	}
}

/** The entry's own keys, read as the entry's own regex-ness decides. */
function importedKeys(entry: LorebookEntryLike): string {
	return importedKeyList(entry.keys ?? [], useRegexOf(entry))
}

/**
 * The entry's condition keys, under whichever of the two names the file uses:
 * `secondary_keys` in the CCv2/V3 `character_book` schema, `keysecondary` in
 * SillyTavern's native World Info. The spec name wins where both are present,
 * which is what a file converted by SillyTavern's own exporter carries — and
 * what the lorebook import dialog produces, since it normalizes a singular
 * `keysecondary` onto *every* entry, empty array included.
 *
 * Array-or-nothing, exactly as the primary keys are read: a singular-string
 * `keysecondary` is turned into an array upstream (normalizeLegacyLorebookData
 * for `lorebooks:import`) rather than guessed at here, so both doors read the
 * same thing.
 */
export function secondaryKeysOf(entry: LorebookEntryLike): string[] {
	const keys = entry.secondary_keys ?? entry.keysecondary
	return Array.isArray(keys) ? keys : []
}

/**
 * How the file says its condition keys are read, as Serene Pub's own mode name
 * — or undefined for an entry that declares no condition, in which case the
 * row's `selectiveLogic` is left NULL and nothing is excluded.
 *
 * ⚠ **The integer is translated through `SELECTIVE_LOGIC_BY_ST_CODE`, never by
 * indexing a list.** SillyTavern's enum is `AND_ANY = 0, NOT_ALL = 1,
 * NOT_ANY = 2, AND_ALL = 3` — 1 and 3 are not the pair anybody guesses, so the
 * obvious four-element array silently inverts every book that used either. An
 * unknown code (a mode from a later SillyTavern) is no condition at all rather
 * than a guess at which one it meant.
 *
 * Three things have to be true before a mode is recorded, and each of them is
 * a fact the file states:
 *
 *  · **There are condition keys.** SillyTavern stamps `selectiveLogic: 0` onto
 *    every entry it writes, exactly as it stamps `use_regex: true` — so
 *    recording the mode unconditionally would put "andAny" on every row of
 *    every imported book, a rule about nothing, shown to the user as a live
 *    condition. `selectiveLogicHolds` reads keyless as "no condition" anyway,
 *    so the only thing that would carry is the noise.
 *  · **`selective` is not explicitly false.** That is SillyTavern's own gate on
 *    the condition, and its scanner honours it, so a false there means the book
 *    does not apply this condition and neither should we. Absent is not false:
 *    ST's entry template defaults it to true, and a foreign tool that never
 *    writes the field is not declining anything.
 *  · **The code is one SillyTavern actually defines.**
 *
 * The lookup is `extensions.selectiveLogic` first — where a `character_book`
 * carries it — then the top-level `selectiveLogic` a native World Info file
 * spells, which is the same precedence `matchModeOf` uses for the same reason.
 */
export function selectiveLogicOf(
	entry: LorebookEntryLike
): SelectiveLogic | undefined {
	if (entry.selective === false) return undefined
	if (secondaryKeysOf(entry).length === 0) return undefined

	const code = entry.extensions?.selectiveLogic ?? entry.selectiveLogic
	if (typeof code !== "number") return undefined
	return Object.prototype.hasOwnProperty.call(
		SELECTIVE_LOGIC_BY_ST_CODE,
		code
	)
		? SELECTIVE_LOGIC_BY_ST_CODE[code]
		: undefined
}

/**
 * The author's declared *whole-word* matching intent, as Serene Pub's
 * `matchMode` — or undefined when the file expresses no intent, in which case
 * the row's `matchMode` is left NULL and today's behaviour stands.
 *
 * There is no whole-word field in the CCv2/V3 `character_book` schema itself;
 * SillyTavern carries it out-of-band as a *tri-state* — true / false / null —
 * under two names for the same flag:
 *   - `extensions.match_whole_words` in a `character_book` (its own
 *     originalWIDataKeyMap maps `matchWholeWords` to exactly this key), and
 *   - a top-level camelCase `matchWholeWords` in its native World Info JSON.
 * `null` is SillyTavern's "defer to my global setting" — and that global never
 * travels in the file, so a null/absent flag is genuinely unknowable here and
 * is deliberately NOT guessed at.
 *
 * Regex wins outright over whole-word, in both SillyTavern's scanner ("If the
 * needle is a regex ... override all the other options") and the V3 spec
 * (`use_regex` true means the other matching fields "SHOULD be ignored"), so a
 * regex entry's whole-word flag is meaningless. Leaving `matchMode` unset for
 * those keeps the existing `useRegex ? "regex" : "substring"` fallback in
 * ranking/signals.ts in charge, rather than restating its answer as a column.
 *
 * What that precedence hangs on is useRegexOf(), not the raw `use_regex` flag,
 * which is the whole point of that function: SillyTavern stamps `use_regex`
 * onto every entry it exports, so reading the flag here suppressed the
 * whole-word intent of practically every SillyTavern book. An entry whose keys
 * are plainly literal is not a regex entry no matter what the flag says, and
 * now gets the `match_whole_words` treatment it actually declared. The full
 * order is: keys' shape decides regex → a regex entry declares no matchMode →
 * anything else honours a real boolean `match_whole_words`.
 */
export function matchModeOf(
	entry: LorebookEntryLike
): "word" | "substring" | undefined {
	if (useRegexOf(entry)) return undefined

	const declared =
		entry.extensions?.match_whole_words ?? entry.matchWholeWords
	// Only a real boolean is intent. null (defer-to-global), absent, or any
	// junk a foreign tool wrote there all mean "not declared".
	if (typeof declared !== "boolean") return undefined
	return declared ? "word" : "substring"
}

// Who may be named as an entry's writer (`ENTRY_PROVENANCES`). `human` is the
// column's default and is never written into a file, so it is the answer for
// anything else.

/** The deepest per-entry recursion depth a file may state. */
const MAX_IMPORTED_RECURSION_DEPTH = 100

/**
 * The per-entry facts a format-2 file carries in its `serenepub` bag
 * (`entryFacts` on the export side), each read only when it is a value this
 * app holds — otherwise omitted, so the column keeps its default.
 *
 * ⚠ **`matchMode` is read here only as `regex`, and only when the keys read
 * as patterns** (`useRegexOf`). Word and substring travel on SillyTavern's own
 * `match_whole_words` (`matchModeOf`): SillyTavern keeps an entry's whole
 * `extensions` and writes it back, so a copy in this bag would come home
 * beside an edit made there and undo it. `regex` has no spelling there, but
 * its keys go out delimited, so keys a SillyTavern edit left plain — or that
 * plan S3 imports as a literal — are not re-read as patterns on the bag's
 * word. And `enabled`, when stated, is the entry's own switch: the spec's
 * field goes out off for an archived entry so a foreign reader does not fire
 * it.
 */
export function importedEntryFacts(entry: LorebookEntryLike): {
	archived?: boolean
	enabled?: boolean
	matchMode?: MatchMode
	recursionDepth?: number
	provenance?: string
} {
	const meta = entry.extensions?.serenepub ?? {}
	const depth = meta.recursionDepth
	return {
		...(meta.archived === true ? { archived: true } : {}),
		...(typeof meta.enabled === "boolean" ? { enabled: meta.enabled } : {}),
		...(meta.matchMode === "regex" && useRegexOf(entry)
			? { matchMode: "regex" as MatchMode }
			: {}),
		...(Number.isInteger(depth) &&
		depth >= 0 &&
		depth <= MAX_IMPORTED_RECURSION_DEPTH
			? { recursionDepth: depth }
			: {}),
		...(typeof meta.provenance === "string" &&
		(ENTRY_PROVENANCES as readonly string[]).includes(meta.provenance)
			? { provenance: meta.provenance }
			: {})
	}
}

// What every type carries, whatever it declares. `name` and `priority` are
// deliberately NOT here: they are the `title` and `priority` roles, and a type
// that declares neither — history — must not be handed either.
function sharedEntryFields(entry: LorebookEntryLike) {
	const facts = importedEntryFacts(entry)
	const matchMode = facts.matchMode ?? matchModeOf(entry)
	const selectiveLogic = selectiveLogicOf(entry)
	return {
		content: entry.content || "",
		keys: importedKeys(entry),
		// The condition keys are kept whether or not a mode was declared —
		// they are the author's data, and a mode arriving later (a re-import,
		// or the editor) has something to read. Stripped of their delimiters
		// on a regex entry for the reason `importedKeyList` states.
		secondaryKeys: importedKeyList(
			secondaryKeysOf(entry),
			useRegexOf(entry)
		),
		// Omitted rather than nulled when the file declares no condition, so
		// the column stays NULL — Serene Pub's own "no opinion" — exactly as
		// `matchMode` below is.
		...(selectiveLogic ? { selectiveLogic } : {}),
		enabled: facts.enabled ?? entry.enabled ?? true,
		constant: entry.constant ?? false,
		caseSensitive: entry.case_sensitive ?? false,
		// Read off the keys rather than the file's `use_regex`, which
		// SillyTavern writes as a constant `true` — see useRegexOf.
		useRegex: useRegexOf(entry),
		// Only set when the file actually declared the author's intent — the
		// key is omitted otherwise so the column stays NULL, which is Serene
		// Pub's own "no opinion, use the default". A book that says nothing
		// about whole-word matching imports exactly as it did before.
		...(matchMode ? { matchMode } : {}),
		...(facts.archived ? { archived: true } : {}),
		...(facts.recursionDepth !== undefined
			? { recursionDepth: facts.recursionDepth }
			: {}),
		...(facts.provenance ? { provenance: facts.provenance } : {}),
		// Preserves any *foreign* extension data verbatim (eg. SillyTavern's
		// rich per-entry bag: position, probability, depth, group, sticky,
		// cooldown, role, vectorized, etc.) so re-exporting later reproduces
		// it faithfully instead of silently discarding it, as this used to.
		extraJson: omitSerenepubExtension(entry.extensions)
	}
}

/**
 * Which declared type a parsed entry restores as.
 *
 * An entry carrying Serene Pub's own `extensions.serenepub.entryType` marker
 * (anything previously exported by Serene Pub) goes back to the type it came
 * from; anything else — an external tool's lorebook, a bare CCv2/CCv3 file, a
 * marker from a release this build does not know — falls back to world lore,
 * the most agnostic shape, which is what this importer has always done for a
 * foreign source.
 *
 * ⚠ **The marker is a wire name, never a type id** (`world`, `character`,
 * `history`, and from format 2 `location` and `item`), and a file is read by
 * installs whose type registry is not this one.
 * `entryTypeIdOfExportKey` is the one translation table, shared with the
 * exporter.
 */
export function entryTypeIdOf(entry: LorebookEntryLike): EntryTypeId {
	return entryTypeIdOfExportKey(entry.extensions?.serenepub?.entryType)
}

/**
 * What one imported entry becomes: every type's shared columns, the roles the
 * type declares, and its declared fields under their own names.
 *
 * Named rather than inferred so a caller can hand the result straight to the
 * export mapper — which the round-trip tests do, and which is what keeps
 * "export then import then export again is the same bytes" a compile-checked
 * claim rather than a hopeful one.
 */
export interface ImportedEntryValues {
	content: string
	keys: string
	secondaryKeys: string
	selectiveLogic?: SelectiveLogic
	enabled: boolean
	constant: boolean
	caseSensitive: boolean
	useRegex: boolean
	matchMode?: MatchMode
	archived?: boolean
	recursionDepth?: number
	provenance?: string
	extraJson: Record<string, any>
	position: number
	name?: string
	/** The type's declared fields, under their declared names. */
	[field: string]: unknown
}

/**
 * A parsed lorebook entry as the values to insert, for whichever type it
 * restores as (minus `lorebookId`, which the caller assigns).
 *
 * One mapper where there were three, and the three differences are questions
 * put to the type's declaration rather than to which function was called:
 *
 *  · **a `title` role** takes the file's `name`, then its `comment`, then a
 *    placeholder — history declares none, and had no name column to put one in.
 *  · **a `priority` role** takes the file's priority, **clamped to 1–3**. The
 *    clamp is not the declared `min`/`max` doing the work and must not become
 *    it: a schema with `min: 1, max: 3` *rejects* a 7, and a foreign file
 *    carrying `priority: 7` has to import. History declares no priority role,
 *    so it gets none — *absent means no bonus*, never "absent means 1".
 *  · **every other declared field** is read out of the `serenepub` bag under
 *    its own name and coerced to its declared type, falling back to the
 *    declared default. That is where history's date and flags come from.
 *
 * ⚠ `insertion_order` is deliberately not read as `priority`. ST's `order` is
 * an insertion index whose default is 100, not a 1–3 importance band, and
 * clamping one into the other reads "every imported entry is maximum priority".
 */
export function mapImportedEntry(
	entry: LorebookEntryLike,
	typeId: EntryTypeId,
	position: number
): ImportedEntryValues {
	const decl = entryDeclaration(typeId)
	const meta = entry.extensions?.serenepub ?? {}
	const priorityField = decl?.roles.priority

	const fields: Record<string, any> = {}
	for (const field of declaredFields(typeId)) {
		if (field === priorityField) continue
		fields[field] = coerceDeclaredField(typeId, field, meta[field])
	}
	// A value in a field that narrows an empty one is dropped — a day with no
	// month means nothing, and the type's projected CHECK refuses it.
	for (const [field, spec] of Object.entries(decl?.fields ?? {}))
		if (spec.narrows && fields[spec.narrows] == null) fields[field] = null

	return {
		...sharedEntryFields(entry),
		position,
		...(decl?.roles.title
			? { name: entry.name || entry.comment || "Imported Entry" }
			: {}),
		...(priorityField
			? {
					[priorityField]: normalizeLorebookEntryPriority(
						entry.priority
					)
				}
			: {}),
		...fields
	}
}

/**
 * The format a lorebook file states (`extensions.serenepub.formatVersion`,
 * see `LOREBOOK_FORMAT_VERSION`): a whole number from 2, or 1 for a file that
 * states none — a Serene Pub 0.5 file, a foreign one, or one written before
 * places, items and stats travelled. Format 1 carries no stats and writes a
 * place or an item as world lore.
 */
export function lorebookFileFormatOf(data: unknown): number {
	const stated = (data as any)?.extensions?.serenepub?.formatVersion
	return Number.isInteger(stated) && stated >= 2 ? stated : 1
}

/** Where a file's stat rows land: the maps the import built as it went. */
export interface ImportedStatMaps {
	lorebookId: number
	bindingLocalIdToRealId: Map<number, number>
	entryLocalIdToRealId: Map<number, number>
	historyEntryLocalIdToRealId: Map<number, number>
	sceneLocalIdToRealId: Map<number, number>
	/** The type of every entry the import landed, by its id in this book. */
	entryTypeIdByRealId: Map<number, string>
	/**
	 * The entry types one reference on its own may name in this slot (a
	 * location names places): a list of type ids, `null` when the slot takes
	 * no reference on its own, `undefined` when this install does not declare
	 * the slot and so cannot judge.
	 */
	singleRefEntryTypes: (slotId: string) => readonly string[] | null | undefined
}

/** One stat row as it is inserted: the template layer of this book, on main. */
export interface ImportedStatRow {
	ownerKind: "lorebook" | "cast_member" | "location"
	ownerId: number
	slotId: string
	config?: Record<string, unknown>
	value?: { v: unknown }
	historyEntryId: number | null
	sceneId: number | null
	updatedBy: string
	note: string | null
}

/** A slot id's longest spelling a file may use, and a note's. */
const MAX_IMPORTED_SLOT_ID_CHARS = 200
const MAX_IMPORTED_STAT_NOTE_CHARS = 10_000

const plainObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v)

/**
 * A file's lore reference (`{ entryLocalId, count }`) as this book's
 * (`{ entryId, count }`), or null when the entry did not land here.
 */
function importedLoreRef(
	item: Record<string, unknown>,
	entryLocalIdToRealId: Map<number, number>
): { entryId: number; count?: number } | null {
	if (typeof item.entryLocalId !== "number") return null
	const entryId = entryLocalIdToRealId.get(item.entryLocalId)
	if (entryId === undefined) return null
	const count = item.count
	return typeof count === "number" && Number.isInteger(count) && count > 1
		? { entryId, count }
		: { entryId }
}

/** A word, a number, a switch or nothing: what a value holds beside references. */
const isStatScalar = (v: unknown): boolean =>
	v === null ||
	typeof v === "string" ||
	typeof v === "boolean" ||
	(typeof v === "number" && Number.isFinite(v))

/** Stored types are unversioned; a slot's config may name either spelling. */
const bareTypeId = (typeId: string) => typeId.replace(/@\d+$/, "")

/**
 * A file's stat value with its lore references in this book's ids — or null
 * when nothing of it may be stored.
 *
 * ⚠ **A reference is read only as `{ entryLocalId }`, the file's own id.** An
 * object in any other shape is dropped — above all `{ entryId }`, which is a
 * row id of whichever install reads the file: stored as written, it would name
 * any book's entry, anyone's, and the state readers print a referenced entry's
 * title whatever book it is in. Then the rules the app's own writers hold
 * (`placeStats.ts assertLoreRefsInBook`, `write.ts assertLoreRefsInSession`):
 *
 *  - a **place's list** holds no place (itself included) and no history entry;
 *  - **one reference on its own** names an entry of the types its slot allows
 *    (`singleRefEntryTypes`), and none where the slot allows none;
 *  - a list names one entry once (the count is its multiplicity).
 *
 * A list drops what breaks a rule; a single value that breaks one is dropped
 * whole. An archived entry is kept: a reference may outlive the archive.
 */
function importedStatValue(
	value: unknown,
	slotId: string,
	ownerPlaceId: number | null,
	maps: ImportedStatMaps
): { v: unknown } | null {
	if (!plainObject(value) || !("v" in value)) return null
	const v = value.v
	const typeOf = (entryId: number) =>
		bareTypeId(maps.entryTypeIdByRealId.get(entryId) ?? "")
	if (plainObject(v)) {
		const ref = importedLoreRef(v, maps.entryLocalIdToRealId)
		if (ref === null) return null
		const allowed = maps.singleRefEntryTypes(slotId)
		if (allowed === null) return null
		if (allowed && !allowed.some((t) => bareTypeId(t) === typeOf(ref.entryId)))
			return null
		return { v: ref }
	}
	if (!Array.isArray(v)) return isStatScalar(v) ? { v } : null
	const held = new Set<number>()
	return {
		v: v.flatMap((item) => {
			if (isStatScalar(item)) return [item]
			if (!plainObject(item)) return []
			const ref = importedLoreRef(item, maps.entryLocalIdToRealId)
			if (ref === null || held.has(ref.entryId)) return []
			if (ownerPlaceId !== null) {
				const type = typeOf(ref.entryId)
				if (type === LOCATION_TYPE_ID || type === HISTORY_TYPE_ID) return []
			}
			held.add(ref.entryId)
			return [ref]
		})
	}
}

/**
 * The stat rows a file carries (`extensions.serenepub.stats`, format 2), as
 * rows of this book — owners and references remapped through what the import
 * landed. Best-effort like the graph: a row whose owner did not land, whose
 * slot id is not a string, or whose payload is not the stored shape is left
 * out rather than failing the import. Sizes are checked before any DB work
 * (`assertLorebookImportWithinLimits`).
 */
export function importedStatRows(
	serenepub: unknown,
	maps: ImportedStatMaps
): { configs: ImportedStatRow[]; values: ImportedStatRow[] } {
	const stats = plainObject(serenepub) ? serenepub.stats : undefined
	if (!plainObject(stats)) return { configs: [], values: [] }

	const owner = (
		row: Record<string, unknown>
	): Pick<ImportedStatRow, "ownerKind" | "ownerId"> | null => {
		if (row.ownerKind === "lorebook")
			return { ownerKind: "lorebook", ownerId: maps.lorebookId }
		if (
			row.ownerKind === "cast_member" &&
			typeof row.bindingLocalId === "number"
		) {
			const id = maps.bindingLocalIdToRealId.get(row.bindingLocalId)
			return id === undefined ? null : { ownerKind: "cast_member", ownerId: id }
		}
		// A place's stats live on a place: `location` names the owner kind,
		// and an entry of any other type has no place to hold them.
		if (row.ownerKind === "location" && typeof row.entryLocalId === "number") {
			const id = maps.entryLocalIdToRealId.get(row.entryLocalId)
			return id === undefined ||
				bareTypeId(maps.entryTypeIdByRealId.get(id) ?? "") !== LOCATION_TYPE_ID
				? null
				: { ownerKind: "location", ownerId: id }
		}
		return null
	}
	const dating = (row: Record<string, unknown>) => ({
		historyEntryId:
			typeof row.historyEntryLocalId === "number"
				? (maps.historyEntryLocalIdToRealId.get(row.historyEntryLocalId) ??
					null)
				: null,
		sceneId:
			typeof row.sceneLocalId === "number"
				? (maps.sceneLocalIdToRealId.get(row.sceneLocalId) ?? null)
				: null,
		updatedBy:
			typeof row.updatedBy === "string" &&
			row.updatedBy.length > 0 &&
			row.updatedBy.length <= MAX_IMPORTED_SLOT_ID_CHARS
				? row.updatedBy
				: "user",
		note:
			typeof row.note === "string" &&
			row.note.length <= MAX_IMPORTED_STAT_NOTE_CHARS
				? row.note
				: null
	})
	const slotIdOf = (row: Record<string, unknown>) =>
		typeof row.slotId === "string" &&
		row.slotId.length > 0 &&
		row.slotId.length <= MAX_IMPORTED_SLOT_ID_CHARS
			? row.slotId
			: null

	const rows = (raw: unknown, kind: "config" | "value") =>
		(Array.isArray(raw) ? raw : []).flatMap((row): ImportedStatRow[] => {
			if (!plainObject(row)) return []
			const who = owner(row)
			const slotId = slotIdOf(row)
			if (!who || !slotId) return []
			if (kind === "config") {
				if (!plainObject(row.config)) return []
				return [{ ...who, slotId, config: row.config, ...dating(row) }]
			}
			const value = importedStatValue(
				row.value,
				slotId,
				who.ownerKind === "location" ? who.ownerId : null,
				maps
			)
			return value === null ? [] : [{ ...who, slotId, value, ...dating(row) }]
		})

	return { configs: rows(stats.configs, "config"), values: rows(stats.values, "value") }
}
