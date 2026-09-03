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
	// Retained for comparing against HISTORICAL builds, not because alphas are
	// still shipped — dropping it would rank an installed 0.x-alpha at 0, below
	// every known pre-release, and hard-fail startup for anyone upgrading off
	// one. Do not cull this on nomenclature grounds.
	if (type === "alpha") return 3
	if (type === "rc") return 2
	if (type === "pr") return 1
	return 0
}

/**
 * Whether a build is a pre-release — i.e. whether it must run watermarked with
 * its update check switched off.
 *
 * NOT the plain semver rule. In this project `alpha` and `beta` are statements
 * about the project's *maturity*, not about release vs pre-release: `0.6.0-beta`
 * IS a release, and ships as a production build. `-pr-N`, `-rc-N` and `-dev`
 * are the genuine pre-releases.
 *
 *   (none)          -> release
 *   -beta           -> release   (maturity label, not a release stage)
 *   -pr-N -rc-N -dev-> pre-release
 *   anything else   -> pre-release, deliberately
 *
 * That last line is the important one: unknown suffixes FAIL CLOSED. A typo, a
 * `-rc.1`, an `-alpha`, or a suffix invented after this was written all count
 * as pre-releases, because the cost of wrongly watermarking a release is a
 * cosmetic annoyance while the cost of wrongly un-watermarking a preview build
 * is shipping something that looks production-grade and phones GitHub. Only
 * `beta` is on the release side, and only by exact match — `-beta-2` is not
 * `-beta`, so it too falls closed.
 *
 * Agrees with .github/workflows/release.yml, which marks `-beta` tags as
 * `is_prerelease=false` on GitHub and routes every unrecognised suffix to its
 * own fail-closed branch. There is one rule here, not two that can drift.
 *
 * Deliberately NOT built on parseVersion()/releaseChannelRank(): those only
 * understand the suffix shapes this project has actually shipped
 * (`-pr-N`, `-rc-N`, `-alpha`, `-beta`), and anything else falls through to
 * `type: null` — i.e. an unrecognised suffix like `0.6.0-rc.1` would parse as a
 * FORMAL RELEASE and quietly turn the gating off for exactly the builds that
 * need it. This reads the string directly so there is no such gap.
 *
 * Build metadata is not a pre-release marker, so `1.0.0+abc-def` is a release;
 * a leading `v` is tolerated so a GitHub tag name can be passed in directly.
 */
export function isPrereleaseVersion(version: string): boolean {
	// Build metadata (`+...`) is dropped first, so a `-` inside it can never be
	// mistaken for a pre-release suffix.
	const core = version.trim().replace(/^v/i, "").split("+")[0]
	const dash = core.indexOf("-")
	if (dash === -1) return false // no suffix at all — a formal release
	return core.slice(dash + 1).toLowerCase() !== "beta"
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
