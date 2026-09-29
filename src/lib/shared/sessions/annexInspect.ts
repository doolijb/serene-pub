/**
 * The session data panel's words (owner-approved 2026-09-26): an annex
 * field's audience, setters and shape said plainly, and a value's preview.
 * Pure — the panel renders these, and the server reuses the secret check.
 *
 * The audience grammar is the SDK's participant references
 * (`participants.ts`); the phrases follow docs/pipelines.md's audience table.
 */
import type { FieldDecl } from "@serene-pub/sdk"

/** How one reference reads mid-phrase (lowercase first), for `see` or `act`. */
function refPhrase(ref: string, mode: "see" | "act"): string {
	const r = ref.trim()
	switch (r) {
		case "participant":
			// For a stored value, `participant` includes the model's context
			// (docs/pipelines.md), so the words say so; acting is people only.
			return mode === "see"
				? "everyone in the session, and the AI"
				: "everyone in the session"
		case "person":
			return "every person in the session"
		case "ai":
			return "the AI"
		case "owner":
			return "the session owner"
		case "admin":
			return "administrators"
		case "item":
			return "whoever owns the message"
		case "run-owner":
			return "whoever started the run"
	}
	const at = r.indexOf(":")
	if (at > 0) {
		const kind = r.slice(0, at)
		const id = r.slice(at + 1)
		if (kind === "user") return `user ${id}`
		if (kind === "character") return `whoever plays character ${id}`
		if (kind === "envoy") return `whoever plays the ${id} envoy`
	}
	return r
}

const capitalise = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s)

/** "a", "a and b", "a, b and c". */
function joinPhrases(parts: string[]): string {
	if (parts.length <= 1) return parts[0] ?? ""
	return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
}

function phrase(refs: readonly string[], mode: "see" | "act"): string {
	const unique = [...new Set(refs.map((r) => String(r).trim()).filter(Boolean))]
	if (!unique.length) return "Pipelines only"
	if (mode === "see" && unique.length === 1 && unique[0] === "ai") return "Only the AI"
	return capitalise(joinPhrases(unique.map((r) => refPhrase(r, mode))))
}

/** Who can see a stored value besides pipelines — its declared `see`, in plain words. */
export function annexAudienceWords(see: readonly string[] | null | undefined): string {
	return phrase(see ?? [], "see")
}

/** Who can change a value by hand — its declared `act`; none is pipelines only. */
export function annexSettersWords(act: readonly string[] | null | undefined): string {
	return phrase(act ?? [], "act")
}

const TYPE_WORDS: Record<string, string> = {
	string: "Text",
	text: "Text",
	number: "Number",
	integer: "Whole number",
	boolean: "Yes or no",
	"string[]": "List of text",
	secret: "Secret",
	share: "Shares",
	perMember: "Per member",
	strengths: "Strengths",
	media: "Media",
	enum: "Choice",
	list: "List",
	object: "Object"
}

/** A declared shape, briefly: "Whole number, 1 to 20", "List of text", "One of: a, b". */
export function annexShapeWords(shape: FieldDecl | undefined | null): string {
	if (!shape || typeof shape !== "object" || typeof shape.type !== "string") return "Any JSON"
	const base = TYPE_WORDS[shape.type] ?? shape.type
	switch (shape.type) {
		case "integer":
		case "number": {
			const { min, max } = shape
			if (min !== undefined && max !== undefined) return `${base}, ${min} to ${max}`
			if (min !== undefined) return `${base}, at least ${min}`
			if (max !== undefined) return `${base}, at most ${max}`
			return base
		}
		case "enum": {
			const options = shape.of?.length ? shape.of : (shape.members ?? []).map((m) => m.key)
			return options.length ? `One of: ${options.join(", ")}` : base
		}
		case "list":
			return shape.item ? `List of ${annexShapeWords(shape.item).toLowerCase()}` : base
		case "object": {
			const keys = Object.keys(shape.fields ?? {})
			return keys.length ? `Object (${keys.join(", ")})` : base
		}
		default:
			return base
	}
}

/** Does this shape hold a `secret` anywhere? The annex never keeps one (R61); checked defensively. */
export function annexShapeHoldsSecret(shape: FieldDecl | undefined | null): boolean {
	if (!shape || typeof shape !== "object") return false
	if (shape.type === "secret") return true
	if (shape.type === "list") return annexShapeHoldsSecret(shape.item)
	if (shape.type === "object")
		return Object.values(shape.fields ?? {}).some((f) => annexShapeHoldsSecret(f))
	return false
}

/** Pretty-printed JSON, cut at `limit` characters (with an ellipsis) — the panel expands to the whole. */
export function annexValuePreview(
	value: unknown,
	limit = 240
): { text: string; truncated: boolean } {
	let text: string
	try {
		text = JSON.stringify(value, null, 2) ?? String(value)
	} catch {
		text = String(value)
	}
	if (text.length <= limit) return { text, truncated: false }
	return { text: `${text.slice(0, limit)}…`, truncated: true }
}

/**
 * Whether the panel offers to edit a field in place (lair re-plan R13,
 * 2026-09-28): it is **settable** (its declaration names who may set it —
 * `act`), its shape is text, and its value is shown. The door still judges
 * the press (`act`, the action switch, the shape); this only decides whether
 * an Edit button is drawn. The Castellan's scratchpad is the first.
 */
export function annexEditsAsText(field: {
	act?: readonly string[] | null
	shape?: FieldDecl | null
	withheld?: boolean
}): boolean {
	if (field.withheld || !field.act?.length) return false
	const type = field.shape && typeof field.shape === "object" ? field.shape.type : undefined
	return type === "text" || type === "string"
}

/**
 * The ready-made action that sets one annex field, `<owner>:annex#<key>` —
 * the SDK's `annexFieldAction`, spelled here for the client, which does not
 * import the SDK's runtime.
 */
export const annexFieldActionOf = (owner: string, key: string): string =>
	`${owner}:annex#${key}`
