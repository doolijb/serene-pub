/**
 * Where files go (28 §8).
 *
 * The shape is today's — files nested under the entity they belong to — stated
 * once as six rules so one function can answer for every upload and import
 * source, instead of five hand-built paths that drifted.
 */
import path from "node:path"
// From drizzle.config, not $lib/server/utils, even though the two functions are
// byte-identical: utils imports this module's siblings, so taking it from there
// would close a `media -> utils -> media` import cycle. This codebase has
// already lost a production-only startup to a cycle around a top-level await
// (see db/index.ts), and drizzle.config depends on nothing of ours.
import { getAppDataDir } from "$lib/server/db/drizzle.config"
import type { MediaVariantName } from "$lib/shared/constants/MediaVisibility"

export interface MediaProvenance {
	userId: number
	characterId?: number | null
	personaId?: number | null
	sessionId?: number | null
	messageId?: number | null
}

/** Absolute root that every media path is resolved against and jailed inside. */
export function mediaRoot(): string {
	return path.resolve(getAppDataDir())
}

/**
 * Rule 1 — **deepest known parent wins**, in one fixed precedence applied
 * everywhere: message → session, character, persona, else a user-level bucket.
 *
 * Rule 6 — **import sources do not get their own tree.** A character card, an
 * ST folder import and a manual upload all land under the entity they produced.
 * Separate roots per importer is how you end up with two layouts for one thing,
 * which is the mess this replaces.
 */
function relDir(p: MediaProvenance, bucket?: string): string {
	const user = path.join("data", "users", String(p.userId))
	if (p.messageId || p.sessionId) {
		// A message asset is a session asset; the message is the finer-grained
		// stamp, not a separate place on disk.
		return path.join(user, "sessions", String(p.sessionId ?? 0))
	}
	if (p.characterId) return path.join(user, "characters", String(p.characterId))
	if (p.personaId) return path.join(user, "personas", String(p.personaId))
	return path.join(user, bucket ?? "uploads")
}

/**
 * Rule 3 — the filename is `{hash}.{ext}`. The hash makes a write idempotent
 * and dedupe free; the real extension (from `sniffMedia`, never from the
 * client) keeps a directory listing legible to the admin who is reading it.
 *
 * Rule 5 — nothing user-controlled is ever in here. `filename` is display
 * metadata and is not sanitised into a path, because it never reaches one.
 *
 * Rule 2 — the caller stores the result once, at insert; `variants.path` is
 * authoritative from then on. Re-parenting a row does NOT move the file, which
 * is what keeps stale-id grouping (28 §2) from breaking file resolution.
 */
export function mediaRelPath(
	p: MediaProvenance,
	hash: string,
	ext: string,
	opts?: { bucket?: string }
): string {
	return path.join(relDir(p, opts?.bucket), `${hash}.${ext}`)
}

/**
 * Rule 4 — a derived variant sits beside the file's other bytes, named
 * `{file hash}.{variant}.{ext}` so a directory listing groups them.
 *
 * It used to string-parse the parent row's stored path, because a thumbnail
 * carried no provenance of its own and so had nothing else to derive a
 * location from. 0182 made that false: provenance is on the FILE, and every
 * variant of a file shares it, so the directory comes from the same `relDir`
 * rule as the original and there is no path surgery left to get wrong.
 *
 * The stem is the FILE's hash (the original's bytes), not the variant's own —
 * the point is that `abcd.png`, `abcd.thumb.webp` and `abcd.display.webp` sort
 * next to each other, and that deleting an entity's directory takes its
 * derivatives with it in one sweep.
 *
 * ⚠ `variant` reaches a filename, and it arrives from `?v=` on a URL. Pass
 * only a value that has been through `parseMediaVariant` — the type says so,
 * and `variants_variant_check` refuses a bad one at the database as well.
 *
 * The one case where a variant does NOT land beside its original: a file in a
 * user-level bucket (a background). The bucket is not a column, so provenance
 * cannot reproduce it and the variant lands in the default `uploads` dir
 * instead. Harmless — a variant is resolved through its own stored path, never
 * by re-deriving one — and preferable to re-introducing the string parse for
 * the sake of tidiness.
 */
export function variantRelPath(
	file: MediaProvenance & { hash: string },
	variant: MediaVariantName,
	ext: string
): string {
	return path.join(relDir(file), `${file.hash}.${variant}.${ext}`)
}

/**
 * Resolve a stored relative path to an absolute one, asserting containment.
 *
 * The id-addressed route (28 §7) means `relPath` comes from a row rather than
 * from a caller, so this is an assertion rather than a defence — but it is one
 * line and it is forever, matching what `messages/assets.ts` already does.
 */
export function resolveMediaPath(relPath: string): string {
	const root = mediaRoot()
	const abs = path.resolve(root, relPath)
	if (abs !== root && !abs.startsWith(root + path.sep)) {
		throw new Error("media path resolved outside the data directory")
	}
	return abs
}
