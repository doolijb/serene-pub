/**
 * 🚧 **Does a package version satisfy a requirement's range?** (A16,
 * PLAN-layering §12) — the half of a manifest's `requires` the SDK parses
 * (`parseRequirement`, `requirementRanges`) and the host enforces: at
 * install, and at every preset sync, where a preset whose requirement is
 * missing, disabled or out of range is withdrawn (nothing is deleted).
 *
 * The npm range forms a package author writes: `1.2.3`, `=1.2.3`, `^1.2`,
 * `~1.2.3`, `>=1.2 <2`, `1.x`, `1.2.*`, `*`, and `a || b`. A prerelease
 * version (`1.2.3-pr.5`) compares by its numbers, then before its release.
 * A range this cannot read is unsatisfied — said, never guessed.
 */

type Version = { major: number; minor: number; patch: number; pre: string | null }

/** A version's parts, or null when it is not one. Missing parts read 0. */
export function parseVersion(raw: string): Version | null {
	const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(raw.trim())
	if (!m) return null
	return { major: +m[1]!, minor: +(m[2] ?? 0), patch: +(m[3] ?? 0), pre: m[4] ?? null }
}

function compare(a: Version, b: Version): number {
	if (a.major !== b.major) return a.major - b.major
	if (a.minor !== b.minor) return a.minor - b.minor
	if (a.patch !== b.patch) return a.patch - b.patch
	if (a.pre === b.pre) return 0
	if (a.pre === null) return 1
	if (b.pre === null) return -1
	return a.pre < b.pre ? -1 : 1
}

type Comparator = { op: "<" | "<=" | ">" | ">=" | "="; v: Version }

/** One space-separated set of comparators, or null when a part cannot be read. */
function comparatorsOf(set: string): Comparator[] | null {
	const out: Comparator[] = []
	const parts = set.trim().split(/\s+/).filter(Boolean)
	if (!parts.length) return []
	for (const part of parts) {
		if (part === "*" || part === "x" || part === "X") continue
		const m = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(part)
		if (!m) return null
		const op = m[1] ?? ""
		const body = m[2]!
		const wild = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-[0-9A-Za-z.-]+)?$/.exec(body)
		if (!wild) return null
		const isWild = (p: string | undefined) => p === undefined || /^[xX*]$/.test(p)
		const [, ma, mi, pa] = wild
		if (isWild(ma)) continue
		const v = parseVersion(body.replace(/\.[xX*]/g, ""))
		if (!v) return null
		const partial = isWild(mi) ? 1 : isWild(pa) ? 2 : 3
		if (op === "^" || op === "~" || ((op === "" || op === "=") && partial < 3)) {
			// The upper bound: ^ keeps the leftmost non-zero part; ~ and a
			// partial version keep what was stated.
			let upper: Version
			if (op === "^" && partial === 3) {
				upper =
					v.major > 0
						? { major: v.major + 1, minor: 0, patch: 0, pre: null }
						: v.minor > 0
							? { major: 0, minor: v.minor + 1, patch: 0, pre: null }
							: { major: 0, minor: 0, patch: v.patch + 1, pre: null }
			} else if (op === "^" && partial === 2) {
				upper = v.major > 0 ? { major: v.major + 1, minor: 0, patch: 0, pre: null } : { major: 0, minor: v.minor + 1, patch: 0, pre: null }
			} else if (partial === 1) upper = { major: v.major + 1, minor: 0, patch: 0, pre: null }
			else upper = { major: v.major, minor: v.minor + 1, patch: 0, pre: null }
			out.push({ op: ">=", v: { ...v, pre: v.pre } }, { op: "<", v: { ...upper, pre: "0" } })
			continue
		}
		out.push({ op: (op || "=") as Comparator["op"], v })
	}
	return out
}

const holds = (c: Comparator, v: Version): boolean => {
	const d = compare(v, c.v)
	switch (c.op) {
		case "<":
			return d < 0
		case "<=":
			return d <= 0
		case ">":
			return d > 0
		case ">=":
			return d >= 0
		case "=":
			return d === 0
	}
}

/** Does `version` satisfy `range`? False when either cannot be read. */
export function satisfiesRange(version: string, range: string): boolean {
	const v = parseVersion(version)
	if (!v) return false
	for (const set of range.split("||")) {
		const cs = comparatorsOf(set)
		if (cs && cs.every((c) => holds(c, v))) return true
	}
	return false
}
