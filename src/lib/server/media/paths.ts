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
 * Rule 2 — the caller stores the result once, at insert; `media.path` is
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
 * Rule 4 — a derivative sits beside its original, resolved from the parent's
 * stored path. That is the only way it could work: a thumbnail has no entity
 * provenance of its own (28 §5), so it has nothing else to derive a location
 * from. It also means deleting an entity's directory takes its derivatives with
 * it, with no second sweep.
 */
export function derivativeRelPath(
	parentPath: string,
	variant: string,
	ext: string
): string {
	const dir = path.dirname(parentPath)
	const base = path.basename(parentPath).replace(/\.[^.]+$/, "")
	return path.join(dir, `${base}.${variant}.${ext}`)
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
