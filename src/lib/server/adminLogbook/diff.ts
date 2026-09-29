/**
 * The admin logbook's pure half: redaction, the field diff and the one-line
 * summary. No database, no sockets — `diff.test.ts` pins all of it.
 *
 * Redaction is by FIELD NAME, at every depth, and it is the only line between a
 * secret and a row every admin can read — so it errs wide. A redacted field
 * that changed is still recorded ("API key changed"); its values never are.
 */
import type { LogbookAction, LogbookChange } from "$lib/shared/adminLogbook"

/** Marks where a value was withheld. */
export const REDACTED = "[redacted]"

/** A clipped string ends with this, so the reader knows it was clipped. */
const CLIP = 240
const MAX_DEPTH = 2
const MAX_CHANGES = 60

/**
 * Fields never worth a line: bookkeeping every write touches, and the row id
 * (already the record's object id).
 */
const IGNORED_FIELDS = new Set([
	"id",
	"createdAt",
	"updatedAt",
	"lastLoginAt",
	"installedAt",
	"modelsSyncedAt",
	"draftUpdatedAt"
])

/**
 * True when a field of this name may hold a secret. Normalised (lower case,
 * no `_`/`-`) so `api_key`, `apiKey` and `API-KEY` are one name.
 *
 * `token` only as a SUFFIX: `maxTokens`, `tokenCounter` and `contextTokens`
 * are sampling knobs, `accessToken` and `charaVaultEncryptedToken` are not.
 */
export function isSecretField(name: string): boolean {
	const k = name.toLowerCase().replace(/[_\-\s]/g, "")
	if (
		/password|passphrase|secret|apikey|credential|ciphertext|encrypted|authtag|privatekey|cookie|recoverykey|recoverycode|authorization|bearer|totp/.test(
			k
		)
	)
		return true
	if (k.endsWith("token") || k.endsWith("tokenhash") || k.endsWith("hash"))
		return true
	if (k === "iv" || k.endsWith("tokeniv") || k === "code" || k === "codes")
		return true
	return false
}

function clip(s: string): string {
	return s.length > CLIP ? `${s.slice(0, CLIP)}…` : s
}

/**
 * A value safe to store: secret fields withheld at every depth, long strings
 * clipped, anything deeper than a few levels flattened to clipped JSON.
 */
export function redactValue(value: unknown, depth = 0): unknown {
	if (value == null) return value ?? null
	if (typeof value === "string") return clip(value)
	if (typeof value === "number" || typeof value === "boolean") return value
	if (typeof value === "bigint") return value.toString()
	if (value instanceof Date) return value.toISOString()
	if (depth >= 4) return clip(safeJson(value))
	if (Array.isArray(value)) {
		const out = value.slice(0, 50).map((v) => redactValue(v, depth + 1))
		if (value.length > 50) out.push(`… ${value.length - 50} more`)
		return out
	}
	if (typeof value === "object") {
		const out: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[k] = isSecretField(k)
				? v == null || v === ""
					? v
					: REDACTED
				: redactValue(v, depth + 1)
		}
		return out
	}
	return clip(String(value))
}

function safeJson(v: unknown): string {
	try {
		return JSON.stringify(v, (_k, x) =>
			typeof x === "bigint" ? x.toString() : x
		)
	} catch {
		return String(v)
	}
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return (
		v != null &&
		typeof v === "object" &&
		!Array.isArray(v) &&
		!(v instanceof Date)
	)
}

function same(a: unknown, b: unknown): boolean {
	if (a === b) return true
	if (a == null && b == null) return true
	if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
	return safeJson(a) === safeJson(b)
}

/** `defaultLanguage` → "default language"; `baseUrl` → "base URL". */
export function humanizeField(path: string): string {
	return path
		.split(".")
		.map((part) =>
			part
				.replace(/^is(?=[A-Z])/, "")
				.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
				.replace(/[_-]+/g, " ")
				.toLowerCase()
				.replace(/\burl\b/g, "URL")
				.replace(/\bid\b/g, "ID")
				.replace(/\bapi\b/g, "API")
				.replace(/\bttl\b/g, "TTL")
				.replace(/\bcss\b/g, "CSS")
				.trim()
		)
		.join(" › ")
}

/**
 * The fields that differ between two snapshots of one object. Plain objects
 * are walked a couple of levels (`values.temperature`), so a sampling config's
 * one changed knob is one line, not "values changed". A secret field that
 * changed is a line with `redacted` and no values.
 */
export function diffSnapshots(
	before: Record<string, unknown> | null | undefined,
	after: Record<string, unknown> | null | undefined
): LogbookChange[] {
	const out: LogbookChange[] = []
	walk(before ?? {}, after ?? {}, "", 0, out)
	return out.slice(0, MAX_CHANGES)
}

function walk(
	a: Record<string, unknown>,
	b: Record<string, unknown>,
	prefix: string,
	depth: number,
	out: LogbookChange[]
) {
	const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
	for (const key of keys) {
		if (depth === 0 && IGNORED_FIELDS.has(key)) continue
		const path = prefix ? `${prefix}.${key}` : key
		const x = a[key]
		const y = b[key]
		if (same(x, y)) continue
		if (isSecretField(key)) {
			out.push({ field: path, label: humanizeField(path), redacted: true })
			continue
		}
		if (depth < MAX_DEPTH && isPlainObject(x) && isPlainObject(y)) {
			walk(x, y, path, depth + 1, out)
			continue
		}
		out.push({
			field: path,
			label: humanizeField(path),
			before: redactValue(x ?? null),
			after: redactValue(y ?? null)
		})
	}
}

/** A value as the summary line prints it. */
export function formatValue(v: unknown): string {
	if (v == null || v === "") return "empty"
	if (typeof v === "boolean") return v ? "on" : "off"
	if (typeof v === "number") return String(v)
	if (typeof v === "string") {
		const s = v.length > 60 ? `${v.slice(0, 60)}…` : v
		return `“${s}”`
	}
	return "a new value"
}

function listLabels(labels: string[]): string {
	if (labels.length <= 1) return labels[0] ?? ""
	const shown = labels.slice(0, 4)
	const rest = labels.length - shown.length
	if (rest > 0) return `${shown.join(", ")} and ${rest} more`
	return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`
}

/**
 * Django's change message, in one line: "Added.", "Changed name and base
 * URL.", or for a single scalar field the values themselves.
 */
export function summarize(input: {
	action: LogbookAction
	objectTypeLabel: string
	objectLabel: string
	changes: LogbookChange[]
	/** A descriptor's own sentence, which wins when present. */
	verb?: string | null
}): string {
	const named = input.objectLabel ? ` “${input.objectLabel}”` : ""
	if (input.verb) return input.verb
	switch (input.action) {
		case "add":
			return `Added ${input.objectTypeLabel}${named}`
		case "delete":
			return `Deleted ${input.objectTypeLabel}${named}`
		case "other":
			return `Acted on ${input.objectTypeLabel}${named}`
		case "change": {
			const c = input.changes
			if (c.length === 0) return "No fields changed"
			if (c.length === 1) {
				const only = c[0]
				if (only.redacted) return `Changed ${only.label}`
				const scalar = (v: unknown) =>
					v == null || ["string", "number", "boolean"].includes(typeof v)
				if (scalar(only.before) && scalar(only.after))
					return `Changed ${only.label} from ${formatValue(only.before)} to ${formatValue(only.after)}`
				return `Changed ${only.label}`
			}
			return `Changed ${listLabels(c.map((x) => x.label))}`
		}
	}
}

/**
 * The first plausible id in a handler's result: `result.id`, or the `id` of the
 * first object-valued property (`{ connection: { id } }`, `{ sampling: { id } }`).
 * `key` names the property (dotted for depth) when a response carries several.
 */
export function idFromResult(result: unknown, key?: string): string | null {
	if (!isPlainObject(result)) return null
	const asId = (v: unknown) =>
		typeof v === "number" || (typeof v === "string" && v !== "")
			? String(v)
			: null
	if (key) {
		// Dotted: `backup.name` reads `result.backup.name`.
		let inner: unknown = result
		for (const part of key.split(".")) {
			if (!isPlainObject(inner)) return null
			inner = inner[part]
		}
		return isPlainObject(inner) ? asId(inner.id) : asId(inner)
	}
	const direct = asId(result.id)
	if (direct) return direct
	for (const v of Object.values(result)) {
		if (isPlainObject(v)) {
			const id = asId(v.id)
			if (id) return id
		}
	}
	return null
}

/** A handler's reply that says it refused (the `{ error }` convention). */
export function isRefusal(result: unknown): boolean {
	return isPlainObject(result) && !!result.error
}

/**
 * The listed parameters as a diff with only `after` values — the record for a
 * change that has no object to snapshot (a download, a restart).
 */
export function paramChanges(
	params: unknown,
	fields: readonly string[]
): LogbookChange[] {
	if (!isPlainObject(params)) return []
	const out: LogbookChange[] = []
	for (const f of fields) {
		const v = params[f]
		if (v === undefined) continue
		if (isSecretField(f)) {
			if (v == null || v === "") continue
			out.push({ field: f, label: humanizeField(f), redacted: true })
			continue
		}
		out.push({
			field: f,
			label: humanizeField(f),
			after: redactValue(v)
		})
	}
	return out
}
