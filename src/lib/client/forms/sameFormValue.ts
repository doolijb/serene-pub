/**
 * **Form equality** — is what a form holds the same, for "unsaved changes"
 * purposes, as what was saved?
 *
 * Raw `JSON.stringify(a) !== JSON.stringify(b)` answered "no" for values no
 * person would call different, and each of those was a false _You have
 * unsaved changes_ somewhere in the app:
 *
 *   - **key order** — a row rebuilt from the server lists its keys in a
 *     different order from the draft built from it;
 *   - **empties** — a field the form seeds as `""` against a column that
 *     reads `null`, or an optional key present-and-undefined vs absent;
 *   - **numbers from inputs** — `<input>` and `<select>` hand back `"5"`
 *     where the row held `5`;
 *   - **sets held as arrays** — ids a picker re-orders (`characterIds`).
 *
 * Arrays are compared in order unless the caller names their path as
 * `unordered`: order is meaningful by default (a prompt's blocks, a
 * template's slots), and saying so is the caller's job.
 *
 * Pure and dependency-free, so the rules above are pinned by node tests
 * (`sameFormValue.test.ts`). The tracker that uses it is
 * `unsavedEdits.svelte.ts`.
 */

export interface SameFormValueOptions {
	/**
	 * Paths whose arrays are sets: same members in any order is the same.
	 * A path is object keys joined by `.`; array positions add no segment,
	 * so `"cast.tags"` means the `tags` array of every element of `cast`.
	 */
	unordered?: readonly string[]
	/** Paths never compared (a stamp, a server-computed field). */
	ignore?: readonly string[]
}

/** `null`, `undefined`, `""` and `[]` all mean "nothing here" in a form. */
function isFormEmpty(v: unknown): boolean {
	return (
		v === null ||
		v === undefined ||
		v === "" ||
		(Array.isArray(v) && v.length === 0)
	)
}

const NUMERIC = /^\s*-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i

/** A number, or a string an input would have produced from one. */
function asNumber(v: unknown): number | null {
	if (typeof v === "number") return v
	if (typeof v === "string" && NUMERIC.test(v)) return Number(v)
	return null
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	if (v === null || typeof v !== "object") return false
	const proto = Object.getPrototypeOf(v)
	return proto === Object.prototype || proto === null
}

function join(path: string, key: string): string {
	return path ? `${path}.${key}` : key
}

function same(
	a: unknown,
	b: unknown,
	path: string,
	unordered: ReadonlySet<string>,
	ignore: ReadonlySet<string>
): boolean {
	if (Object.is(a, b)) return true
	if (isFormEmpty(a) && isFormEmpty(b)) return true
	if (isFormEmpty(a) || isFormEmpty(b)) return false

	if (typeof a === "number" || typeof b === "number") {
		const na = asNumber(a)
		const nb = asNumber(b)
		return na !== null && nb !== null && Object.is(na, nb)
	}

	if (a instanceof Date || b instanceof Date) {
		const ta = a instanceof Date ? a.getTime() : Date.parse(String(a))
		const tb = b instanceof Date ? b.getTime() : Date.parse(String(b))
		return !Number.isNaN(ta) && ta === tb
	}

	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b)) return false
		if (a.length !== b.length) return false
		if (!unordered.has(path)) {
			return a.every((x, i) => same(x, b[i], path, unordered, ignore))
		}
		// A set: each member of `a` claims one equal, unclaimed member of `b`.
		const claimed = new Array<boolean>(b.length).fill(false)
		return a.every((x) => {
			const i = b.findIndex(
				(y, j) => !claimed[j] && same(x, y, path, unordered, ignore)
			)
			if (i === -1) return false
			claimed[i] = true
			return true
		})
	}

	if (isPlainObject(a) && isPlainObject(b)) {
		const keys = new Set([...Object.keys(a), ...Object.keys(b)])
		for (const key of keys) {
			const p = join(path, key)
			if (ignore.has(p)) continue
			if (!same(a[key], b[key], p, unordered, ignore)) return false
		}
		return true
	}

	return false
}

/**
 * True when `a` and `b` are the same for unsaved-changes purposes: deep,
 * key order ignored, `null`/`undefined`/`""`/`[]` equal, numeric strings
 * equal to the number they spell, arrays ordered unless named `unordered`.
 */
export function sameFormValue(
	a: unknown,
	b: unknown,
	options: SameFormValueOptions = {}
): boolean {
	return same(
		a,
		b,
		"",
		new Set(options.unordered ?? []),
		new Set(options.ignore ?? [])
	)
}
