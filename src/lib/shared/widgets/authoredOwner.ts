/**
 * The owner grammar of an **authored component** (C6): a component an admin
 * writes or clones in the app, kept as a row of this instance — never a
 * plugin's, never packaged, never core's.
 *
 * Every remote component runs under an OWNER: `core`, a plugin id, or — for
 * an authored component — its **authored owner id**, `authored.<authored id>`
 * (`authored.k3x9q2m7p1`). One authored component is one owner: its own UI
 * worker, its own grants, its own enable switch (owner ruling 2026-09-25).
 *
 * The grammar is a plugin slug's (`^[a-z0-9]+([.-][a-z0-9]+)*$`) on purpose:
 * everything that carries an owner — a widget id (`<owner>:<slug>`), a URL
 * segment, a worker name — already accepts it, so no reader grows a third
 * grammar. It can never BE a plugin's because the first label `authored` is
 * reserved: a plugin install refuses it (`pluginIdFindings`) and every read of
 * `plugins` rows hides one stored before that rule (`notCoreRow`). And it is
 * never `core`: the prefix is not `core`, and a page grants core's trust only
 * to owner `core` with a `/core-ui/` module.
 *
 * Light on purpose — no database, no node builtins — so the plugin store, the
 * frame host and the client can all read it.
 */

/** The reserved first label of every authored owner id. A plugin id may not start with it. */
export const AUTHORED_OWNER_LABEL = "authored"

/** `authored.` — the prefix an authored owner id carries. */
export const AUTHORED_OWNER_PREFIX = `${AUTHORED_OWNER_LABEL}.`

/**
 * An **authored id**: ten characters of `[a-z0-9]` (about 51 bits), random,
 * minted once at creation and never changed — the row's key and the owner
 * id's tail. Short enough to read in a worker name, long enough that two
 * never meet (the primary key refuses the one that would).
 */
export const AUTHORED_ID = /^[a-z0-9]{10}$/

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"

/** A fresh authored id (`crypto.getRandomValues`, rejection-sampled so every character is equally likely). */
export function newAuthoredId(): string {
	let out = ""
	const buf = new Uint8Array(16)
	while (out.length < 10) {
		crypto.getRandomValues(buf)
		for (const b of buf) {
			// 252 = 7 × 36: the bytes above it would bias the first characters.
			if (b < 252 && out.length < 10) out += ALPHABET[b % 36]
		}
	}
	return out
}

export const isAuthoredId = (id: unknown): id is string => typeof id === "string" && AUTHORED_ID.test(id)

/** The owner an authored component runs under: `authored.<id>`. */
export function authoredOwnerId(id: string): string {
	if (!isAuthoredId(id)) throw new Error(`'${id}' is not an authored id — ten of [a-z0-9]`)
	return AUTHORED_OWNER_PREFIX + id
}

/** The authored id an owner id names, or `null` when it is not an authored owner id. */
export function parseAuthoredOwnerId(owner: unknown): string | null {
	if (typeof owner !== "string" || !owner.startsWith(AUTHORED_OWNER_PREFIX)) return null
	const id = owner.slice(AUTHORED_OWNER_PREFIX.length)
	return isAuthoredId(id) ? id : null
}

/**
 * True for any id in the reserved namespace — `authored` itself or anything
 * starting `authored.` — whether or not the tail is a well-formed authored
 * id. This is the test a plugin id is refused by: the whole namespace is
 * reserved, not only the ids this build mints.
 */
export function isReservedAuthoredNamespace(id: unknown): boolean {
	return typeof id === "string" && (id === AUTHORED_OWNER_LABEL || id.startsWith(AUTHORED_OWNER_PREFIX))
}

/**
 * The served URL of an authored component's compiled module (its
 * **artifact**): `/authored-ui/<authored owner id>/<artifact hash>.js`.
 *
 * Versioned by the artifact hash, so a recompile is a new URL — the UI
 * worker's module map caches a URL for its life, and a stale module under the
 * old URL can never answer for the new one. ⚠ P3 serves this route (from the
 * component cache, `Cache-Control: immutable`, never the source); until it
 * exists the URL 404s, which is why nothing is offered without an artifact.
 */
export function authoredArtifactSrc(id: string, artifactHash: string): string {
	if (!/^[a-f0-9]{16,128}$/.test(artifactHash)) throw new Error(`'${artifactHash}' is not an artifact hash`)
	return `/authored-ui/${authoredOwnerId(id)}/${artifactHash}.js`
}

/** The inverse of {@link authoredArtifactSrc} over the route's tail, or `undefined` for anything else. */
export function parseAuthoredArtifactSrc(rest: string | null | undefined): { id: string; artifactHash: string } | undefined {
	const m = /^(authored\.[a-z0-9]{10})\/([a-f0-9]{16,128})\.js$/.exec(rest ?? "")
	if (!m) return undefined
	const id = parseAuthoredOwnerId(m[1])
	return id ? { id, artifactHash: m[2]! } : undefined
}
