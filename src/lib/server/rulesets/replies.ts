/**
 * 🚧 **Replies carry changes** — the host side of JSON replies (PLAN-
 * rulesets-functions D7; owner ruling R7, 2026-10-22: an option on Story's
 * reply, off by default, a preset may turn it on).
 *
 * With the option on, the reply is one JSON object a model answers in
 * strict mode (`generate-json@1` instead of `generate-text@1`):
 *
 *     { "message": "…the reply's prose…",
 *       "changes": [ { "owner": "Ann", "attribute": "affection", "op": "add", "value": 2 }, … ] }
 *
 *  · the **schema** is built from the session's ruleset — its attributes
 *    (each as delta operations, never a rewritten sheet), its entry types
 *    (an entry gained or lost) — and the owners the turn reads
 *    (`replySchemaOf`); a ruleset from scratch gets `message` and no
 *    changes to make;
 *  · the **message** reaches the live row as it streams: `MessageStreamer`
 *    reads the `message` field out of the partial JSON, chunk by chunk, and
 *    hands on only the new prose — the `changes` are held until the object
 *    closes;
 *  · the **changes** go through the ruleset handler like any delta
 *    (`replyChangesAsDeltas` → `ruleset-resolve`'s `deltas`, in the
 *    registration's mode: Full applies, Review proposes).
 */

import { i18nText, tieSidesOf, type FieldDecl, type RulesetAttributeDecl, type RulesetEntryTypeDecl } from "@serene-pub/sdk"
import { attributeSlotsOf, sectionsOf } from "./functionRun"
import type { ProposedDelta, ZoneOp } from "./types"

type JsonSchema = Record<string, unknown>

/** The operations a reply's change may ask of an attribute, by its kind. */
export const REPLY_OPS_BY_KIND: Readonly<Record<string, readonly string[]>> = Object.freeze({
	number: ["add", "set"],
	pool: ["add", "spend"],
	tally: ["add"],
	label: ["set"],
	list: ["add", "remove"]
})

/** An attribute's kind, as a reply reads it: its own, else a number. */
const kindOf = (a: RulesetAttributeDecl): string => a.kind ?? "number"

/**
 * 🚧 A tie's fields a reply may `set` (ties T3, 2026-10-23): each declared
 * field of a relational entry type with a far end — never the bookkeeping
 * (`towards`, `edge`) — with what it holds, in words.
 */
export function tieFieldsOf(e: RulesetEntryTypeDecl): { field: string; words: string }[] {
	if (tieSidesOf(e) === undefined) return []
	return Object.entries(e.fields ?? {})
		.filter(([k, f]) => k !== "towards" && k !== "edge" && ["integer", "number", "enum", "string", "text"].includes((f as FieldDecl).type))
		.map(([k, f]) => {
			const d = f as FieldDecl & { min?: number; max?: number; of?: readonly string[] }
			const holds =
				d.type === "enum" ? (d.of ?? []).join(" | ") : d.type === "integer" || d.type === "number" ? `${d.min ?? "…"}–${d.max ?? "…"}` : "words"
			return { field: k, words: `${k} (${holds})` }
		})
}

/**
 * 🚧 The reply schema for a session's ruleset and the owners its turn reads
 * (strict: every property required, nothing else allowed). Each change names
 * its owner (by name), what it changes — an `attribute` (`op` by its kind,
 * `value` an amount or words) or an `entryType` (`add` / `remove` an entry
 * by `name`) — and why.
 *
 * In the grammar subset every backend compiles (`jsonSchemaToGbnf`: no
 * `null`, no type unions — GM 2026-10-23, G1 ★4): a member that does not
 * apply is **empty text** (`attribute: ""` for an entry, `entryType: ""`
 * and `name: ""` for a value, `value: ""` for an entry), each enum carries
 * `""`, and `value` is text a number is read out of
 * (`replyChangesAsDeltas`) — as the reckoning's change grammar is
 * (`RECKON_CHANGE_SCHEMA`).
 */
export function replySchemaOf(ruleset: { id: string } & object, owners: readonly { key: string; name: string }[]): JsonSchema {
	const s = sectionsOf(ruleset)
	const attributes = (s.attributes ?? []).filter((a) => a.slot === undefined || a.borrowed !== true)
	const entryTypes = (s.entryTypes ?? []).filter((e) => e.entryable !== false)
	const ops = [...new Set(attributes.flatMap((a) => REPLY_OPS_BY_KIND[kindOf(a)] ?? ["set"]))]
	// 🚧 A tie's side carries fields a reply may set (ties T3): under its entry type, by `field`.
	const ties = entryTypes.map((e) => ({ e, fields: tieFieldsOf(e) })).filter((t) => t.fields.length)
	const describe = (a: RulesetAttributeDecl) =>
		`${a.id} (${kindOf(a)}${a.bounds ? `, ${a.bounds.min ?? "…"}–${a.bounds.max ?? "…"}` : ""}${a.of?.length ? `: ${a.of.join(" | ")}` : ""}): ${(REPLY_OPS_BY_KIND[kindOf(a)] ?? ["set"]).join(" or ")}`
	const message: JsonSchema = { type: "string", description: "The reply, as the story tells it." }
	if (!attributes.length && !entryTypes.length)
		return { type: "object", properties: { message }, required: ["message"], additionalProperties: false }
	const kinds = [...(attributes.length ? ["attribute"] : []), ...(entryTypes.length ? ["entry"] : [])]
	const change: JsonSchema = {
		type: "object",
		properties: {
			owner: { type: "string", ...(owners.length ? { enum: owners.map((o) => o.name) } : {}), description: "Whose it is." },
			changes: { type: "string", enum: kinds, description: "An attribute's value, or an entry gained or lost." },
			attribute: {
				type: "string",
				enum: [...attributes.map((a) => a.id), ""],
				description: attributes.length ? `The attribute — ${attributes.map(describe).join("; ")}; empty for an entry.` : "Always empty."
			},
			entryType: {
				type: "string",
				enum: [...entryTypes.map((e) => e.id), ""],
				description: entryTypes.length
					? `The kind of entry — ${entryTypes
							.map((e) => {
								const tie = ties.find((t) => t.e === e)
								return `${e.id} (${i18nText(e.name) ?? e.id}${tie ? `; each person's own side, named for whom it is towards — set ${tie.fields.map((f) => f.words).join(", ")}` : ""})`
							})
							.join("; ")}; empty for an attribute.`
					: "Always empty."
			},
			op: { type: "string", enum: [...new Set([...ops, ...(entryTypes.length ? ["add", "remove"] : []), ...(ties.length ? ["set"] : [])])] },
			...(ties.length
				? {
						field: {
							type: "string",
							enum: [...new Set(ties.flatMap((t) => t.fields.map((f) => f.field))), ""],
							description: "The field of a tie's side a change sets; empty for anything else."
						}
					}
				: {}),
			value: { type: "string", description: `An amount, or the words a label${ties.length ? " or a tie's field" : ""} is set to; empty for an entry gained or lost.` },
			name: { type: "string", description: `An entry's name${ties.length ? " (a tie's side: whom it is towards)" : ""}; empty for an attribute.` },
			reason: { type: "string", description: "Why, in a few words." }
		},
		required: ["owner", "changes", "attribute", "entryType", "op", ...(ties.length ? ["field"] : []), "value", "name", "reason"],
		additionalProperties: false
	}
	return {
		type: "object",
		properties: { message, changes: { type: "array", items: change, description: "What the reply changes — deltas, never a rewritten sheet." } },
		required: ["message", "changes"],
		additionalProperties: false
	}
}

/** A reply as a model answered it: its message and its changes, whatever else it said. */
export function splitReply(json: unknown): { message: string; changes: unknown[] } {
	if (!json || typeof json !== "object" || Array.isArray(json)) return { message: typeof json === "string" ? json : "", changes: [] }
	const o = json as Record<string, unknown>
	return { message: typeof o.message === "string" ? o.message : "", changes: Array.isArray(o.changes) ? o.changes : [] }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** A member's text, trimmed; anything else (null, a number) is none. */
const textOf = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

/**
 * A change's `value` as the handler takes it: none for empty text (or null —
 * a backend that answers outside the grammar), a number where the text is
 * one, else the words.
 */
const valueOf = (v: unknown): unknown => {
	if (v === undefined || v === null) return undefined
	if (typeof v !== "string") return v
	const t = v.trim()
	if (!t) return undefined
	return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t
}

/**
 * 🚧 A reply's changes as the ruleset handler's deltas: an attribute's →
 * `{ owner, slot, op, value }` (its slot by the ruleset); an entry's → a
 * repertoire piece (a ruleset before sections, or an entry type an owner
 * keeps in a list slot — `listed`, read there wholly) or an ask of the
 * owner's carried zone (any other entry type of a ruleset in sections).
 * What names nothing the ruleset has is refused with why — never guessed.
 * 🚧 A tie's field (ties T3): `set` with `entryType` a tie, `name` whom the
 * side is towards, `field` and `value` → a zone ask `set` on the side the
 * change's owner holds.
 */
export function replyChangesAsDeltas(
	ruleset: { id: string; repertoires?: readonly { id: string }[] } & object,
	changes: readonly unknown[],
	listed: ReadonlySet<string> = new Set()
): { deltas: ProposedDelta[]; zoneOps: ZoneOp[]; refused: { change: unknown; why: string }[] } {
	const out = { deltas: [] as ProposedDelta[], zoneOps: [] as ZoneOp[], refused: [] as { change: unknown; why: string }[] }
	const { slotOf } = attributeSlotsOf(ruleset)
	const entryTypes = new Set((sectionsOf(ruleset).entryTypes ?? []).map((e) => e.id))
	// 🚧 A tie's fields a reply may set, by entry type (ties T3).
	const tieFields = new Map((sectionsOf(ruleset).entryTypes ?? []).map((e) => [e.id, new Set(tieFieldsOf(e).map((f) => f.field))] as const).filter(([, f]) => f.size))
	// A ruleset in sections says its entry types; its ⏳ read-back as repertoires is not where its entries live.
	const inSections = (ruleset as { entryTypes?: unknown }).entryTypes !== undefined
	const repertoires = new Set(inSections ? [...listed] : (ruleset.repertoires ?? []).map((r) => r.id))
	for (const c of changes) {
		if (!isRecord(c) || typeof c.op !== "string" || c.owner === undefined || c.owner === null) {
			out.refused.push({ change: c, why: "a change names its owner and its op" })
			continue
		}
		const reason = textOf(c.reason) || undefined
		const attribute = textOf(c.attribute)
		const entryType = textOf(c.entryType)
		// Empty text is none (the grammar has no null); where both are named, `changes` says which.
		const asEntry = !!entryType && (c.changes === "entry" || !attribute)
		if (attribute && !asEntry) {
			const slot = slotOf.get(attribute)
			if (!slot) {
				out.refused.push({ change: c, why: `${ruleset.id} has no attribute '${attribute}'` })
				continue
			}
			const value = valueOf(c.value)
			out.deltas.push({ owner: c.owner, slot, op: c.op, ...(value !== undefined ? { value } : {}), ...(reason ? { reason } : {}) })
		} else if (asEntry) {
			const name = textOf(c.name)
			if (!name) {
				out.refused.push({ change: c, why: "an entry gained or lost is named" })
				continue
			}
			if (c.op === "set") {
				// 🚧 A tie's field (ties T3): the side `owner` holds, towards `name`, set to `value`.
				const field = textOf(c.field)
				const value = valueOf(c.value)
				if (!tieFields.get(entryType)?.has(field))
					out.refused.push({ change: c, why: `${ruleset.id}'s '${entryType}' has no field '${field}' a reply may set` })
				else if (value === undefined) out.refused.push({ change: c, why: `a tie's ${field} is set to something` })
				else out.zoneOps.push({ op: "set", owner: String(c.owner), entry: { entryType, name }, field, value, key: "reply" })
			} else if (repertoires.has(entryType)) out.deltas.push({ owner: c.owner, repertoire: entryType, op: c.op, piece: name, ...(reason ? { reason } : {}) })
			else if (entryTypes.has(entryType) && (c.op === "add" || c.op === "remove"))
				out.zoneOps.push({ op: c.op, owner: String(c.owner), entry: c.op === "add" ? { name, entryType } : name, zone: "carried", key: "reply" })
			else out.refused.push({ change: c, why: `${ruleset.id} has no entry type '${entryType}' an entry may be ${c.op === "remove" ? "lost from" : "gained in"}` })
		} else out.refused.push({ change: c, why: "a change names an attribute or an entry type" })
	}
	return out
}

/**
 * 🚧 The `message` of a reply still streaming: decoded so far, and whether
 * its closing quote has arrived. Reads the top-level `"message"` string of
 * a partial JSON object — escapes decoded, a half-written escape held back.
 */
export function messageOfPartial(text: string): { message: string; closed: boolean } {
	let depth = 0
	let i = 0
	const n = text.length
	const readString = (from: number): { value: string; end: number; closed: boolean } => {
		let out = ""
		let j = from
		while (j < n) {
			const ch = text[j]!
			if (ch === '"') return { value: out, end: j + 1, closed: true }
			if (ch === "\\") {
				if (j + 1 >= n) break
				const e = text[j + 1]!
				if (e === "u") {
					if (j + 6 > n) break
					const code = parseInt(text.slice(j + 2, j + 6), 16)
					if (Number.isNaN(code)) break
					out += String.fromCharCode(code)
					j += 6
					continue
				}
				out += ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" } as Record<string, string>)[e] ?? e
				j += 2
				continue
			}
			out += ch
			j++
		}
		return { value: out, end: n, closed: false }
	}
	while (i < n) {
		const ch = text[i]!
		if (ch === "{" || ch === "[") depth++
		else if (ch === "}" || ch === "]") depth--
		else if (ch === '"') {
			const key = readString(i + 1)
			if (!key.closed) return { message: "", closed: false }
			i = key.end
			if (depth === 1 && key.value === "message") {
				while (i < n && /\s/.test(text[i]!)) i++
				if (text[i] !== ":") continue
				i++
				while (i < n && /\s/.test(text[i]!)) i++
				if (i >= n) return { message: "", closed: false }
				if (text[i] !== '"') return { message: "", closed: false }
				const v = readString(i + 1)
				return { message: v.value, closed: v.closed }
			}
			continue
		}
		i++
	}
	return { message: "", closed: false }
}

/**
 * 🚧 The live row's half of a JSON reply: fed the model's chunks as they
 * arrive, hands back only the prose of `message` that is new since the
 * last chunk — what the row shows while the `changes` wait for the object
 * to close.
 */
export class MessageStreamer {
	private buffer = ""
	private sent = 0
	push(chunk: string): string {
		this.buffer += chunk
		const { message } = messageOfPartial(this.buffer)
		if (message.length <= this.sent) return ""
		const fresh = message.slice(this.sent)
		this.sent = message.length
		return fresh
	}
	/** The message so far. */
	text(): string {
		return messageOfPartial(this.buffer).message
	}
	/** The whole answer so far, as the model wrote it. */
	raw(): string {
		return this.buffer
	}
}
