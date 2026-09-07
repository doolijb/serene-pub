/**
 * What an entry is *called* — the index side of the entity-vector space.
 *
 * One vector per **name**, not one per entry (retrieval plan phase 4). This
 * module decides what the names are; `server/embedding/entityVectors.ts` turns
 * them into rows and `ranking/entityLink.ts` compares them to what the scene
 * said. Nothing here reads a table or embeds anything.
 *
 * ## Why the names are a set of short strings and not one blob
 *
 * A two-word mention compared against a whole-entry vector is a granularity
 * mismatch: the mention drowns in the average of two hundred words. Short
 * string against short string is what embeddings are most reliable at, and it
 * is the entire reason this space exists beside the content one rather than
 * inside it.
 *
 * ## Where a name comes from
 *
 *   · **the title** — what the author called the row;
 *   · **aliases the body declares** — *"also called the Ash Riders"*. These are
 *     extracted, which is why `ALIAS_EXTRACTOR_VERSION` rides on every stored
 *     vector: changing the patterns changes what the same unchanged body
 *     yields;
 *   · **the bound character's names** — for a character-anchored entry, the
 *     binding's `name`, its `aliases` and its `absorbedAliases`. All three,
 *     never a subset: `absorbedAliases` is where `narrativeGraph:mergeNode`
 *     puts the identity a merge absorbed and `aliases` is a sync target that is
 *     replaced wholesale, so feeding one half would resolve the absorbed name
 *     and not the name it was merged into.
 *
 * There is no entry-level alias column, deliberately not invented here: the
 * declared aliases the plan names are the binding's, and a fourth kind of name
 * store is a schema decision this seam should not make on its own.
 *
 * ## What is deliberately **not** a name
 *
 * The entry's `keys`. They are trigger words, they already have a mechanism —
 * the keyword arm, which matches them exactly and owns them — and embedding
 * them here would let this arm re-answer a question the exact matcher has
 * already answered better. Same rule as the mention side: exact matching owns
 * what it can match.
 */

/**
 * The identity of the alias reader.
 *
 * Beside `MENTION_EXTRACTOR_VERSION` and the gazetteer hash on every stored
 * vector, and versioned in the name for the same reason: extraction over
 * mutable text is derived data, and its own recipe is one of the three things
 * that can make the derivation stale while the source sits still.
 */
export const ALIAS_EXTRACTOR_VERSION = "core:extract/aliases-appositive@1"

/** Where one of an entry's names came from. Receipt vocabulary, not a weight. */
export type EntityNameKind = "title" | "alias" | "character"

export interface EntityName {
	/** The name itself, whitespace-collapsed. */
	text: string
	kind: EntityNameKind
}

/**
 * The longest name worth embedding.
 *
 * A name is a handful of words; anything longer is a sentence that happened to
 * follow *"also called"*, and a sentence embedded as a name compares against
 * nothing while costing a call. Characters rather than words because the cost
 * being bounded is the encoder's, which counts tokens.
 */
const MAX_NAME_LENGTH = 96

/** The shortest. One character is an initial or a list marker. */
const MIN_NAME_LENGTH = 2

/**
 * The most names one entry contributes.
 *
 * Every name is a row and an embedding call, and an import can leave a binding
 * carrying dozens of aliases. Bounded in declaration order — title first, then
 * the body's, then the character's — so what falls off the end is the least
 * distinctive rather than the most.
 */
export const MAX_NAMES_PER_ENTRY = 8

/**
 * A name-shaped run: a capitalised word, then up to three more, joined by
 * spaces, hyphens or a name particle.
 *
 * ⚠ **Built without the `i` flag, and that is not a style choice.** Under
 * case-insensitive matching JavaScript case-folds `\p{Lu}` as well, so it
 * matches lower-case letters too and the capitalisation requirement vanishes
 * entirely. With `giu` this pattern read *"also called an unpleasant business"*
 * as the alias `an unpleasant business` and *"Known as the Silent Gate by the
 * locals"* as `Silent Gate by the locals`. Found by a test, not by inspection.
 *
 * So the triggers below spell their own first letter as a class instead, and
 * this stays case-**sensitive**, which is what makes it capture a name rather
 * than a description.
 */
const NAME_RUN =
	"[\"\u201c\u201d']?((?:\\p{Lu}[\\p{L}\\p{N}'\u2019-]*)(?:[\\s-]+(?:of|the|de|van|von|al)?[\\s-]*\\p{Lu}[\\p{L}\\p{N}'\u2019-]*){0,3})"

/**
 * Appositive alias patterns.
 *
 * Deliberately narrow: each one is a phrase whose *whole purpose* is to
 * introduce a second name for the thing just discussed. A looser pattern —
 * *"the"* plus a capitalised run, say — would harvest every proper noun the
 * body happens to mention, and an entry would then answer to the names of
 * everything it talks about rather than to its own.
 *
 * Lower case is not captured, because a lower-case tail after *"also called"*
 * is a description of the thing rather than a name for it, and this space is
 * about names.
 */
const ALIAS_PATTERNS: RegExp[] = [
	new RegExp(
		`\\b(?:[Aa]lso\\s+)?(?:[Kk]nown|[Rr]eferred\\s+to)\\s+as\\s+(?:[Tt]he\\s+)?${NAME_RUN}`,
		"gu"
	),
	new RegExp(
		`\\b(?:[Aa]lso\\s+)?(?:[Cc]alled|[Nn]amed|[Nn]icknamed|[Ss]tyled|[Dd]ubbed)\\s+(?:[Tt]he\\s+)?${NAME_RUN}`,
		"gu"
	),
	new RegExp(`\\b[Aa]\\.?k\\.?a\\.?\\s+(?:[Tt]he\\s+)?${NAME_RUN}`, "gu"),
	new RegExp(`\\b[Oo]r\\s+simply\\s+(?:[Tt]he\\s+)?${NAME_RUN}`, "gu")
]

const collapse = (text: string) =>
	text
		.replace(/\s+/gu, " ")
		.replace(/^["“”'\s]+|["“”'\s.,;:]+$/gu, "")
		.trim()

/**
 * The alternative names a body declares for its own subject.
 *
 * Bounded and order-preserving: the earliest appositive is the likeliest to be
 * about the entry itself, because an entry's body opens by saying what it is.
 */
export function extractAliases(
	content: string | null | undefined,
	limit = MAX_NAMES_PER_ENTRY
): string[] {
	if (typeof content !== "string" || !content) return []
	const out: string[] = []
	const seen = new Set<string>()
	for (const pattern of ALIAS_PATTERNS) {
		pattern.lastIndex = 0
		for (const m of content.matchAll(pattern)) {
			const name = collapse(m[1] ?? "")
			if (name.length < MIN_NAME_LENGTH) continue
			if (name.length > MAX_NAME_LENGTH) continue
			const key = name.toLowerCase()
			if (seen.has(key)) continue
			seen.add(key)
			out.push(name)
			if (out.length >= limit) return out
		}
	}
	return out
}

/** The row shape this needs off an entry, and nothing more. */
export interface NamedEntryRow {
	id: number
	title?: string | null
	content?: string | null
	anchorBindingId?: number | null
}

/** The row shape this needs off a binding. All three name columns. */
export interface NamedBindingRow {
	id: number
	name?: string | null
	aliases?: unknown
	absorbedAliases?: unknown
}

const bindingNames = (binding: NamedBindingRow | undefined): string[] =>
	binding
		? [
				binding.name,
				...(Array.isArray(binding.aliases) ? binding.aliases : []),
				...(Array.isArray(binding.absorbedAliases)
					? binding.absorbedAliases
					: [])
			].filter((n): n is string => typeof n === "string")
		: []

/**
 * Every name one entry answers to, deduplicated, in declaration order.
 *
 * Order is the cap's tie-break and nothing else reads it, but it is the order a
 * reader would list them in: what the author titled it, then what its own body
 * says it is also called, then who it belongs to.
 */
export function entityNamesFor(
	entry: NamedEntryRow,
	bindings: ReadonlyMap<number, NamedBindingRow>
): EntityName[] {
	const out: EntityName[] = []
	const seen = new Set<string>()
	const add = (raw: unknown, kind: EntityNameKind) => {
		if (typeof raw !== "string") return
		const text = collapse(raw)
		if (text.length < MIN_NAME_LENGTH || text.length > MAX_NAME_LENGTH)
			return
		const key = text.toLowerCase()
		if (seen.has(key)) return
		seen.add(key)
		if (out.length < MAX_NAMES_PER_ENTRY) out.push({ text, kind })
	}

	add(entry.title, "title")
	for (const alias of extractAliases(entry.content)) add(alias, "alias")
	if (entry.anchorBindingId != null)
		for (const name of bindingNames(bindings.get(entry.anchorBindingId)))
			add(name, "character")

	return out
}

/**
 * The identity of one entry's name set, for the freshness triple.
 *
 * Hashed over the compiled names rather than over the entry's text, and that
 * is the property the whole space is designed around: **renaming re-embeds
 * names without touching content vectors, and rewriting the body does not
 * re-embed the names.** A body edit that changes no appositive produces the
 * same list and therefore the same hash, so nothing is re-embedded; a title
 * edit changes it in one character.
 *
 * The kind is part of the material because it reaches the receipt — a name
 * whose provenance changed is a different answer to *"why did this link"*, even
 * when the string did not move.
 */
export function nameSetHash(
	names: readonly EntityName[],
	digest: (value: string) => string
): string {
	return digest(names.map((n) => `${n.kind} ${n.text}`).join(""))
}
