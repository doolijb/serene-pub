/**
 * Spec identity: **owner + slug + version** (12 §3b, 02 §3).
 *
 * Two versioning schemes live in this system and conflating them causes real confusion,
 * so they are stated apart:
 *
 * - **Types pin at an integer version** — `core:query/chat-history@1`. A pin is exact;
 *   a spec references one version and never floats.
 * - **Specs upgrade at semver** — `1.2.0`. An import replaces the installed copy when it
 *   is newer and is ignored when it is not, which is the rule already ruled for imported
 *   pipelines.
 *
 * So a spec id carries **no `@N` suffix**. The version is not part of the identity; it is
 * what the identity is compared *at*.
 */

export interface SpecIdentity {
	/** Who ships it: a plugin slug, `core`, or absent for a hand-imported document. */
	owner?: string
	/** Stable, PK-agnostic reference. Unique per owner. */
	slug: string
	version: string
}

const SLUG_PART = /^[a-z0-9]+([./-][a-z0-9]+)*$/

/**
 * Parse `owner:slug` — `chariot.rp:chat`, `core:chat-turn`, or a bare `chat-turn` for a
 * document someone hand-wrote and imported.
 */
export function parseSpecId(id: string): { owner?: string; slug: string } {
	// Tolerated and ignored: a trailing @N. It is type-pin syntax that reads like a
	// version here, and silently treating it as one is how a spec ends up with two.
	const withoutPin = id.replace(/@\d+$/, '')
	const i = withoutPin.indexOf(':')
	if (i === -1) return { slug: withoutPin }
	return { owner: withoutPin.slice(0, i), slug: withoutPin.slice(i + 1) }
}

export function assertSpecId(id: string): void {
	const { owner, slug } = parseSpecId(id)
	if (!SLUG_PART.test(slug) || (owner !== undefined && !SLUG_PART.test(owner))) {
		throw new Error(
			`'${id}' is not a valid spec id. Use 'owner:slug' — 'chariot.rp:chat', 'core:chat-turn' — ` +
				`or a bare slug for a hand-imported document. Lowercase, digits, hyphens and dots only. ` +
				`The **semver** goes in meta.version, never in the id: a spec upgrades by version, and an ` +
				`id that carries one cannot be matched across upgrades.`,
		)
	}
}

// ── Semver, only as much as the upgrade rule needs ──────────────────────────

const parts = (v: string) => {
	const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v)
	if (!m) return null
	return { major: +m[1]!, minor: +m[2]!, patch: +m[3]!, pre: m[4] }
}

/** −1, 0, 1. A prerelease sorts below the release it leads to. */
export function compareVersions(a: string, b: string): number {
	const x = parts(a)
	const y = parts(b)
	if (!x || !y) return a === b ? 0 : a < b ? -1 : 1
	for (const k of ['major', 'minor', 'patch'] as const) {
		if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1
	}
	if (x.pre === y.pre) return 0
	if (x.pre === undefined) return 1
	if (y.pre === undefined) return -1
	return x.pre < y.pre ? -1 : 1
}

export type ImportDecision =
	| { action: 'install'; reason: string }
	| { action: 'replace'; reason: string }
	| { action: 'ignore'; reason: string }
	| { action: 'conflict'; reason: string }

/**
 * The import rule, already ruled: **a newer version replaces the installed copy; an equal
 * or older one is ignored.** Ownership is checked first, because "newer" is not a licence
 * to overwrite somebody else's row — a plugin update must not silently take over a spec
 * an admin imported by hand, or one another plugin ships.
 */
export function decideImport(incoming: SpecIdentity, installed?: SpecIdentity): ImportDecision {
	if (!installed) return { action: 'install', reason: 'nothing installed under this slug' }
	if ((incoming.owner ?? null) !== (installed.owner ?? null)) {
		return {
			action: 'conflict',
			reason:
				`'${incoming.slug}' is installed under owner '${installed.owner ?? '(none)'}' and the ` +
				`import claims '${incoming.owner ?? '(none)'}'. Ownership is not transferred by importing — ` +
				`rename the slug, or remove the installed copy deliberately`,
		}
	}
	const c = compareVersions(incoming.version, installed.version)
	if (c > 0) return { action: 'replace', reason: `${incoming.version} is newer than ${installed.version}` }
	return {
		action: 'ignore',
		reason: `${incoming.version} is not newer than the installed ${installed.version}`,
	}
}

/** Display form for logs and diffs — never a storage key. */
export const qualify = (i: SpecIdentity) => `${i.owner ? `${i.owner}:` : ''}${i.slug}@${i.version}`
