/**
 * Version comparison and release-channel rules — the single source of truth
 * for "is this release newer than what I'm running" and "should I be told
 * about it at all".
 *
 * This logic previously existed twice, in two different and disagreeing forms:
 * db/index.ts compared release types properly (it has to, to decide whether to
 * migrate), while hooks.server.ts's update check stripped the pre-release
 * suffix entirely and compared only major.minor.patch. That second form meant
 * `0.5.0-beta` and `0.5.0` compared EQUAL, so the stable release of your own
 * base version — the single most important upgrade to hear about — never
 * produced a notification.
 */

export interface ParsedVersion {
	major: number
	minor: number
	patch: number
	/** `null` for a formal release, otherwise "pr" | "rc" | "alpha" | "beta". */
	type: string | null
	/** The counter in e.g. `-rc-2`; 0 when absent. */
	num: number
}

/** Format: X.Y.Z, X.Y.Z-type, or X.Y.Z-type-N. A leading `v` is tolerated so
 * GitHub tag names (`v0.5.0-beta`) can be passed in directly. */
export function parseVersion(version: string): ParsedVersion {
	const match = version
		.trim()
		.replace(/^v/i, "")
		.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)(?:-(\d+))?)?$/i)
	if (!match) {
		return { major: 0, minor: 0, patch: 0, type: null, num: 0 }
	}
	const [, major, minor, patch, type, num] = match
	return {
		major: parseInt(major, 10),
		minor: parseInt(minor, 10),
		patch: parseInt(patch, 10),
		type: type ? type.toLowerCase() : null,
		num: num ? parseInt(num, 10) : 0
	}
}

/**
 * How "released" a build is. This is the order THIS project actually ships in,
 * not semver's alphabetical pre-release ordering: 0.5.0 went pr -> rc -> beta,
 * so beta ranks above rc here.
 *
 * A suffix missing from this list falls to 0, which makes it look older than
 * every known pre-release and will hard-fail startup for anyone upgrading onto
 * it — exactly what an unmapped "beta" did once already. Add new suffixes here
 * BEFORE tagging a release with one.
 */
export function releaseChannelRank(type: string | null): number {
	if (!type) return 5 // formal release
	if (type === "beta") return 4
	if (type === "alpha") return 3
	if (type === "rc") return 2
	if (type === "pr") return 1
	return 0
}

/** Compare two version strings. -1 if a < b, 1 if a > b, 0 if equal. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
	const vA = parseVersion(a)
	const vB = parseVersion(b)

	// Base version is king: 0.4.2-pr-1 > 0.4.1-alpha.
	if (vA.major !== vB.major) return vA.major < vB.major ? -1 : 1
	if (vA.minor !== vB.minor) return vA.minor < vB.minor ? -1 : 1
	if (vA.patch !== vB.patch) return vA.patch < vB.patch ? -1 : 1

	const rankA = releaseChannelRank(vA.type)
	const rankB = releaseChannelRank(vB.type)
	if (rankA !== rankB) return rankA < rankB ? -1 : 1

	if (vA.num !== vB.num) return vA.num < vB.num ? -1 : 1
	return 0
}

/**
 * Whether someone running `current` should be told about `candidate`.
 *
 * Two independent conditions, both required:
 *
 *  1. It is actually newer (compareVersions).
 *  2. It is at least as stable as what they're running —
 *     `rank(candidate) >= rank(current)`.
 *
 * Condition 2 is the channel rule. You hear about your own channel and
 * everything more finished than it, never anything less finished:
 *
 *   on 0.5.0        (stable) -> only stable releases
 *   on 0.5.0-beta   (beta)   -> 0.6.0 and 0.6.0-beta, but NOT 0.6.0-rc-1 or -pr-1
 *   on 0.5.0-rc-1   (rc)     -> rc, alpha, beta and stable, but not pr
 *   on 0.5.0-pr-1   (pr)     -> everything
 *
 * Someone who opted into a beta build has opted into beta-grade stability, not
 * into release-candidate churn; someone on a stable build never wants a
 * pre-release notice at all. Running a pre-release is the only signal of
 * consent this can rely on, so it is the one it uses.
 */
export function shouldNotifyAboutRelease(
	current: string,
	candidate: string
): boolean {
	if (compareVersions(candidate, current) !== 1) return false
	const currentRank = releaseChannelRank(parseVersion(current).type)
	const candidateRank = releaseChannelRank(parseVersion(candidate).type)
	return candidateRank >= currentRank
}

/**
 * The newest release from `candidates` that `current` should be notified
 * about, or null if there is none.
 *
 * Takes the whole list rather than one candidate because GitHub's
 * `/releases/latest` endpoint EXCLUDES pre-releases entirely — a beta user
 * could never be told about a newer beta through it. The update check has to
 * read the full `/releases` list and filter here instead.
 */
export function pickNotifiableRelease(
	current: string,
	candidates: string[]
): string | null {
	let best: string | null = null
	for (const candidate of candidates) {
		if (!shouldNotifyAboutRelease(current, candidate)) continue
		if (best === null || compareVersions(candidate, best) === 1) {
			best = candidate
		}
	}
	return best
}
