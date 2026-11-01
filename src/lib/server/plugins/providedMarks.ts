/**
 * 🚧 (M2c) The mark a plugin's **provided book** carries, and the pure helpers
 * around it. No database, no schema: the ownership rule is data in two JSON
 * columns that exist already (no column was added for it).
 *
 *  · a book: `lorebooks.extra_json.provided = { plugin, slug, version, sha256,
 *    uuid, entries }`;
 *  · a character the book brought: `characters.extensions.serenepub.provided =
 *    { plugin, slug, version, uuid }`.
 *
 * ## A mark only counts on the row it was written for
 * Each mark names the row's own `uuid`. A copy of a book (`duplicateLorebookRows`
 * drops the uuid and mints a fresh one) or a character card re-imported from a
 * file reads as no plugin's: the mark is there, the uuid is not the row's.
 * `markedBook` / `markedCharacter` are the only readers, and both check it.
 *
 * ## A person's edit can never mint it
 * `lorebooks:update` writes an allowlist with no `extra_json`; a book file's
 * `extra_json` is rebuilt from three numbers (`extractLorebookLevelExtraJson`);
 * the character update keeps the STORED mark and drops a sent one
 * (`keepStoredProvidedMark`), and a character import drops a file's
 * (`withoutProvidedMark`).
 */

/** What the book remembers of one provided entry. */
export interface ProvidedEntryMark {
	/** The `lorebook_entries.id` it landed as. */
	id: number
	/** The row's content hash when the plugin last wrote it: a different hash now means a person edited it. */
	hash: string
	/** The hash of the file's entry that was written: the same upstream means nothing to do. */
	up: string
}

export interface ProvidedBookMark {
	plugin: string
	slug: string
	version: string
	sha256: string
	uuid: string
	entries: Record<string, ProvidedEntryMark>
	/** A newer version that was NOT written (the book's write mode is Review or Off). */
	held?: { version: string; sha256: string; mode: "review" | "off" }
}

export interface ProvidedCharacterMark {
	plugin: string
	slug: string
	version: string
	uuid: string
}

const isObject = (v: unknown): v is Record<string, any> =>
	!!v && typeof v === "object" && !Array.isArray(v)

/** The book's mark when it is genuinely this row's (`uuid` matches), else null. */
export function markedBook(
	extraJson: unknown,
	bookUuid: string
): ProvidedBookMark | null {
	const m = isObject(extraJson) ? extraJson.provided : undefined
	if (
		!isObject(m) ||
		typeof m.plugin !== "string" ||
		typeof m.slug !== "string" ||
		typeof m.version !== "string" ||
		m.uuid !== bookUuid
	)
		return null
	return {
		plugin: m.plugin,
		slug: m.slug,
		version: m.version,
		sha256: typeof m.sha256 === "string" ? m.sha256 : "",
		uuid: m.uuid,
		entries: isObject(m.entries) ? (m.entries as ProvidedBookMark["entries"]) : {},
		...(isObject(m.held) ? { held: m.held as ProvidedBookMark["held"] } : {})
	}
}

/** The character's mark when it is genuinely this row's, else null. */
export function markedCharacter(
	extensions: unknown,
	characterUuid: string
): ProvidedCharacterMark | null {
	const m = isObject(extensions) ? extensions.serenepub?.provided : undefined
	if (
		!isObject(m) ||
		typeof m.plugin !== "string" ||
		typeof m.slug !== "string" ||
		m.uuid !== characterUuid
	)
		return null
	return {
		plugin: m.plugin,
		slug: m.slug,
		version: typeof m.version === "string" ? m.version : "",
		uuid: m.uuid
	}
}

/** `extensions` without any `serenepub.provided` (a file or a form cannot mint one). */
export function withoutProvidedMark<T extends Record<string, unknown> | undefined>(
	extensions: T
): T {
	const sp = isObject(extensions) ? (extensions as any).serenepub : undefined
	if (!isObject(sp) || !("provided" in sp)) return extensions
	const { provided: _drop, ...rest } = sp
	return { ...(extensions as object), serenepub: rest } as unknown as T
}

/** `next` carrying exactly the STORED mark (or none): a save never changes it. */
export function keepStoredProvidedMark(
	next: Record<string, unknown> | undefined,
	stored: unknown
): Record<string, unknown> | undefined {
	const cleaned = withoutProvidedMark(next)
	const kept = isObject(stored) ? (stored as any).serenepub?.provided : undefined
	if (!isObject(kept) || !isObject(cleaned)) return cleaned
	const sp = isObject((cleaned as any).serenepub) ? (cleaned as any).serenepub : {}
	return { ...cleaned, serenepub: { ...sp, provided: kept } }
}

/** The slug of a provided file: its basename without `.lorebook.json` / `.json`. */
export function providedSlugOf(path: string): string {
	const base = path.split("/").pop() ?? path
	return base.replace(/\.lorebook\.json$/i, "").replace(/\.json$/i, "")
}

/** `a.b.c` versions in order (numeric parts, then a prerelease tail as text); negative: a < b. */
export function compareVersions(a: string, b: string): number {
	const split = (v: string) => {
		const [core, pre = ""] = v.split(/-(.*)/s)
		return { n: core.split(".").map((x) => parseInt(x, 10) || 0), pre }
	}
	const x = split(a)
	const y = split(b)
	for (let i = 0; i < Math.max(x.n.length, y.n.length); i++) {
		const d = (x.n[i] ?? 0) - (y.n[i] ?? 0)
		if (d) return d
	}
	if (x.pre === y.pre) return 0
	if (!x.pre) return 1
	if (!y.pre) return -1
	// Prerelease tails like "pr-7": compare their numbers, then the text.
	const nx = parseInt(/(\d+)$/.exec(x.pre)?.[1] ?? "", 10)
	const ny = parseInt(/(\d+)$/.exec(y.pre)?.[1] ?? "", 10)
	if (Number.isFinite(nx) && Number.isFinite(ny) && nx !== ny) return nx - ny
	return x.pre < y.pre ? -1 : 1
}

/**
 * 🚧 (M2c) What core keeps on the plugin's row about the things it provides
 * (`plugins.provided`): `dismissed` — the provided books an administrator
 * deleted by hand, by slug. The sync never imports a dismissed slug again;
 * the row (and with it the list) goes at uninstall, so reinstalling provides
 * them anew.
 */
export interface PluginProvidedState {
	dismissed?: Record<string, ProvidedBookDismissal>
	/** 🚧 (M2c fix) A provided book whose last import or upgrade failed, by slug: the sentence and when. Cleared by the next success. */
	failed?: Record<string, { at: string; reason: string }>
	/** 🚧 (M2c fix) Entries the last import or upgrade refused, by slug: each names its entry and the type nothing here declares. */
	refused?: Record<string, string[]>
}

/** 🚧 (M2c fix) The failed and refused records out of a `plugins.provided` value (empty when absent or malformed). Pure. */
export function providedOutcomes(provided: unknown): {
	failed: ReadonlyMap<string, string>
	refused: ReadonlyMap<string, readonly string[]>
} {
	const failed = new Map<string, string>()
	const refused = new Map<string, readonly string[]>()
	const f = isObject(provided) ? provided.failed : undefined
	if (isObject(f))
		for (const [slug, v] of Object.entries(f))
			if (isObject(v) && typeof v.reason === "string") failed.set(slug, v.reason)
	const r = isObject(provided) ? provided.refused : undefined
	if (isObject(r))
		for (const [slug, v] of Object.entries(r))
			if (Array.isArray(v) && v.length) refused.set(slug, v.filter((x): x is string => typeof x === "string"))
	return { failed, refused }
}

/** One hand-deleted provided book: when, by whom (null: unknown), at which version. */
export interface ProvidedBookDismissal {
	at: string
	by: number | null
	version: string
}

/** The dismissed slugs out of a `plugins.provided` value already read (empty when absent or malformed). Pure. */
export function dismissedProvidedBooks(provided: unknown): ReadonlyMap<string, ProvidedBookDismissal> {
	const out = new Map<string, ProvidedBookDismissal>()
	const d = isObject(provided) ? provided.dismissed : undefined
	if (!isObject(d)) return out
	for (const [slug, v] of Object.entries(d))
		if (isObject(v) && typeof v.at === "string")
			out.set(slug, {
				at: v.at,
				by: typeof v.by === "number" ? v.by : null,
				version: typeof v.version === "string" ? v.version : ""
			})
	return out
}
