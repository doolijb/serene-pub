/**
 * Stats and states, as two node bindings.
 *
 * ⚠ **Beside `bindings.ts` rather than inside it**, for the reason
 * `bindings.relationships.ts` states: that file is four thousand lines and more
 * than one lane appends to it at a time. `coreBindings()` assembles its map
 * from parts, so a part lives where its own code does.
 *
 * ## The read goes through the host; the write does not, and that is a finding
 *
 * `core:query/session-state@1` reads through `ctx.read("session_state")` like
 * every other Query, so it inherits the scoping refusal. So do the two 🚧
 * lorebook reads (2026-09-27): `core:query/lorebook-state@1`
 * (`ctx.read("lorebook_state")`) and `core:query/stat-trail@1`
 * (`ctx.read("stat_trail")`), scoped to the session's lorebook or one the
 * run's scope grants.
 *
 * `core:query/resolve-state-changes@1` needs one thing `ctx.read` cannot give
 * it — the CONFIGURATION resolved for one owner and one slot, which is what
 * says whether stamina 90 is a legitimate number — so it takes the same dynamic
 * import on the same terms. It validates rather than writes; the point of doing
 * it here is that a change refused at the gate is never shown to a player as
 * something to accept.
 *
 * `core:task/set-state@1` is a task, and a task's `ctx` has no write seam —
 * only an outlet's `ctx.commit` does. A pipeline may hold any number of
 * write-class outlets beside its one live row (F7), so a write-class outlet
 * is where this belongs. Until it is one, the handler reaches the database
 * directly, through a **dynamic** import that keeps a PGlite handle out of
 * the module graph that `bindingCompat` and the registry tests load. This is
 * the deviation, stated where it lives.
 */

import type { Bindings } from "@serene-pub/sdk"
import { getAttributeSlot, halt, ok, reads } from "@serene-pub/sdk"
import type * as C from "@serene-pub/contracts"
import type { CoreQueryCtx, NodeInput } from "./bindingTypes"
import type { RenderRun } from "$lib/server/pipelines/prompt/renderers"
import type { StateChange } from "$lib/server/state/write"

/** A change the node was handed, sanity-checked before anything is written. */
function readChanges(raw: unknown): StateChange[] {
	if (!Array.isArray(raw)) return []
	return raw.filter((c): c is StateChange => {
		if (!c || typeof c !== "object") return false
		const owner = (c as { owner?: { kind?: unknown; id?: unknown } }).owner
		if (typeof owner?.kind !== "string" || typeof owner?.id !== "number")
			return false
		// One arm since phase 3b: an item moving is a list change on the
		// inventory stat, which `resolve-state-changes` already turned it into.
		return typeof (c as { slotId?: unknown }).slotId === "string"
	})
}

/**
 * `resolve-state-changes`' `owners` (lair re-plan R10): participant
 * references resolved to cast owners — `null` when unwired, so an owner-less
 * change stays the world's. A reference that is not `character:<id>`, or a
 * character the session does not seat (`seated` throws its sentence), is a
 * sentence on `refused` and no owner; a reference named twice counts once.
 */
export async function ownersFrom(
	raw: unknown,
	sessionId: number,
	seated: (owner: { kind: "session_cast"; id: number }) => Promise<void>,
	refused: string[]
): Promise<Array<{ kind: "session_cast"; id: number }> | null> {
	if (raw === undefined || raw === null) return null
	const refs = Array.isArray(raw) ? raw : [raw]
	const out: Array<{ kind: "session_cast"; id: number }> = []
	for (const ref of refs) {
		const m = typeof ref === "string" ? /^character:(\d+)$/.exec(ref.trim()) : null
		if (!m) {
			refused.push(
				`${JSON.stringify(ref)} is not a cast member of session ${sessionId}, so nothing was set on it.`
			)
			continue
		}
		const owner = { kind: "session_cast" as const, id: Number(m[1]) }
		if (out.some((o) => o.id === owner.id)) continue
		try {
			await seated(owner)
			out.push(owner)
		} catch (e) {
			refused.push(e instanceof Error ? e.message : String(e))
		}
	}
	return out
}

/**
 * 🚧 `resolve-state-changes`'s `keeps` (stat ownership, owner ruling
 * 2026-09-30), read as whose books this keeper keeps: `'world'` (the world
 * and its places), a `character:<id>` reference (that seat), or a party
 * speaker fact (`{ characterId }`, or `{ name }` as the planner wrote it,
 * resolved against the cast the way a change's owner is). A list keeps the
 * union of its items, read flat, an absent item adding nobody — the Lair's
 * Castellan keeper wires `['world', …the delvers it voiced]`. Null when
 * unwired: any owner. Anything else keeps nobody: every change refused,
 * rather than every change let through.
 */
type Keeps = { world: boolean; cast: Set<number> }
async function keepsFrom(
	raw: unknown,
	castNamed: (name: string) => Promise<number | null>
): Promise<Keeps | null> {
	if (raw === undefined || raw === null) return null
	const keeps: Keeps = { world: false, cast: new Set() }
	const items = Array.isArray(raw) ? raw.flat(Infinity) : [raw]
	for (const item of items) {
		if (item === "world") {
			keeps.world = true
			continue
		}
		if (typeof item === "string") {
			const m = /^character:(\d+)$/.exec(item.trim())
			if (m) keeps.cast.add(Number(m[1]))
			continue
		}
		if (!item || typeof item !== "object") continue
		const fact = item as { characterId?: unknown; name?: unknown }
		if (typeof fact.characterId === "number") keeps.cast.add(fact.characterId)
		else if (typeof fact.name === "string" && fact.name.trim()) {
			const id = await castNamed(fact.name)
			if (id !== null) keeps.cast.add(id)
		}
	}
	return keeps
}

/**
 * `set-state`'s `worldRow` (lair pass R8): a committed write result's row id,
 * `undefined` when unwired, `false` when it is anything else — a bare id or a
 * literal is not a row this run wrote.
 */
function readWorldRow(raw: unknown): number | undefined | false {
	if (raw === undefined || raw === null) return undefined
	if (typeof raw !== "object") return false
	const w = raw as { status?: unknown; ids?: { id?: unknown } }
	if (w.status !== "committed") return false
	return typeof w.ids?.id === "number" ? w.ids.id : false
}

/** One item's supply as `core:query/item-supply@1` answers it, read defensively. */
interface SupplyLine {
	name: string
	supply: string
	limit: number | null
	remaining: number | null
	/** Held count per owner, `${kind}:${id}` — what a remove can free. */
	held: Map<string, number>
}

/** The `supply` port, by entry id. Absent or malformed: no line, no check. */
function readSupply(raw: unknown): Map<number, SupplyLine> {
	const out = new Map<number, SupplyLine>()
	if (!Array.isArray(raw)) return out
	for (const row of raw) {
		if (!row || typeof row !== "object") continue
		const r = row as Record<string, unknown>
		if (typeof r.entryId !== "number") continue
		const held = new Map<string, number>()
		for (const h of Array.isArray(r.holders) ? r.holders : []) {
			const holder = h as { ownerKind?: unknown; ownerId?: unknown; count?: unknown }
			const key = `${holder.ownerKind}:${holder.ownerId}`
			held.set(key, (held.get(key) ?? 0) + (Number(holder.count) || 0))
		}
		out.set(r.entryId, {
			name: typeof r.name === "string" && r.name ? r.name : `entry ${r.entryId}`,
			supply: String(r.supply ?? "unlimited"),
			limit: typeof r.limit === "number" ? r.limit : null,
			remaining: typeof r.remaining === "number" ? r.remaining : null,
			held
		})
	}
	return out
}

/**
 * A `base` port's value as a state version, or null when nothing usable was
 * wired: the port is optional, and a spec that wires none writes against
 * whatever is current.
 */
function readBase(raw: unknown): number | null {
	return typeof raw === "number" && Number.isInteger(raw) && raw >= 0
		? raw
		: null
}

/**
 * A written value, in the type its slot is declared with.
 *
 * This is the step that knows which slot it is, which is why the conversion
 * happens here rather than at the write: `slotFor` has just turned "hp" into
 * `core:slot/hp@1`, and one line later `checkSlotValue` refuses `"14"` for an
 * integer slot. Both are right on their own, and between them a keeper that
 * wrote its numbers as text lost every change with a refusal sentence nobody
 * asked for.
 *
 * It matters more now than it did: the shipped keeper schema types `value` as a
 * STRING, because the grammar the llama.cpp family compiles a schema through
 * cannot express "a number here and a word there" in one list.
 *
 * Only the two directions a model plausibly writes, and only when the text
 * genuinely is one. Anything else is passed through untouched so the write's own
 * refusal still names the real problem.
 */
function asSlotType(
	slotId: string,
	value: string | number | boolean
): string | number | boolean {
	if (typeof value !== "string") return value
	const decl = getAttributeSlot(slotId)
	if (!decl) return value
	if (decl.type === "integer") {
		const asNumber = Number(value.trim())
		return Number.isInteger(asNumber) ? asNumber : value
	}
	if (decl.type === "boolean") {
		const word = value.trim().toLowerCase()
		if (word === "true") return true
		if (word === "false") return false
	}
	return value
}

/**
 * The slot a planner's world hint names: the plan schema writes a JSON
 * property camelCase (`timeOfDay`), a slot's local name is kebab-case
 * (`time-of-day`).
 *
 * ⚠ **No list of hints** (2026-09-26: location is a premade stat, not a
 * built-in). Every hint the planner wrote is matched against the slots THIS
 * session keeps on the world, and a hint for one it does not — `location` in a
 * genre that puts it on each character — is not a change and not a refusal: a
 * planner restating where the party is has asked for nothing.
 */
const hintSlotName = (key: string): string =>
	key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/**
 * 🚧 The custom-reading ports of the lorebook reads (ruling 16): passed
 * through as wired, only when wired — the host validates them and refuses a
 * bad one with a sentence, so a value is never quietly read as the default.
 */
function readingOverrides(input: unknown): { branch?: unknown; at?: unknown; forkCut?: unknown } {
	const i = (input ?? {}) as Record<string, unknown>
	return {
		...(i.branch != null ? { branch: i.branch } : {}),
		...(i.at != null ? { at: i.at } : {}),
		...(i.forkCut != null ? { forkCut: i.forkCut } : {})
	}
}

export function stateBindings(run: RenderRun = {}): Bindings {
	return {
		"core:query/session-state@1": reads<typeof C.sessionState>(
			async (
				input: NodeInput<typeof C.sessionState>,
				ctx: CoreQueryCtx
			) => {
				const state = (await ctx.read("session_state", {
					sessionId: input?.scope?.sessionId
				})) as { version?: unknown }
				// The state version (U5f), on its own port so a spec can hand
				// it back as `base` — a port reference names one port.
				const version =
					typeof state?.version === "number" ? state.version : 0
				return ok({ main: state, state, version })
			},
			{ ports: ["scope"] }
		),

		/**
		 * 🚧 A lorebook's durable stats — world, cast members, places — with
		 * no session needed (2026-09-27). Through `ctx.read`, so the host's
		 * lorebook scoping refuses a book the run is not entitled to.
		 */
		"core:query/lorebook-state@1": reads<typeof C.lorebookState>(
			async (input: NodeInput<typeof C.lorebookState>, ctx: CoreQueryCtx) => {
				const slotIds = input?.params?.slotIds
				const state = await ctx.read("lorebook_state", {
					sessionId: input?.scope?.sessionId,
					lorebookId: typeof input?.lorebookId === "number" ? input.lorebookId : undefined,
					owner: input?.owner ?? undefined,
					...readingOverrides(input),
					slotIds: Array.isArray(slotIds)
						? slotIds.filter((s): s is string => typeof s === "string")
						: undefined
				})
				if (!state)
					return halt(
						"there is no lorebook to read stats from — wire this node's scope port to a session with a lorebook, or name one the run may read"
					)
				return ok({ main: state, state })
			},
			{ ports: ["scope", "lorebookId", "owner", "branch", "at", "forkCut"], params: ["slotIds"] }
		),

		/**
		 * 🚧 One stat's values over time for one owner (2026-09-27): by
		 * message in the scope session, by story date across sessions, or
		 * both. Through `ctx.read`, on `lorebook-state`'s scoping.
		 */
		"core:query/stat-trail@1": reads<typeof C.statTrail>(
			async (input: NodeInput<typeof C.statTrail>, ctx: CoreQueryCtx) => {
				const slotId = input?.params?.slotId
				if (typeof slotId !== "string" || !slotId.trim())
					return halt("name the stat to follow in this node's slotId parameter")
				const since = (input?.since ?? {}) as { messageId?: unknown; date?: unknown }
				const date = since.date as { year?: unknown; month?: unknown; day?: unknown } | undefined
				const trail = await ctx.read("stat_trail", {
					sessionId: input?.scope?.sessionId,
					lorebookId: typeof input?.lorebookId === "number" ? input.lorebookId : undefined,
					owner: input?.owner ?? "world",
					...readingOverrides(input),
					slotId,
					mode: input?.params?.mode,
					last: typeof input?.params?.last === "number" ? input.params.last : 50,
					sinceMessageId: typeof since.messageId === "number" ? since.messageId : undefined,
					sinceDate:
						date && typeof date.year === "number"
							? {
									year: date.year,
									month: typeof date.month === "number" ? date.month : null,
									day: typeof date.day === "number" ? date.day : null
								}
							: undefined
				})
				if (!trail)
					return halt(
						"there is no lorebook to read a stat's trail from — wire this node's scope port to a session with a lorebook, or name one the run may read"
					)
				return ok({ main: trail, trail, points: trail.points })
			},
			{
				ports: ["scope", "lorebookId", "owner", "since", "branch", "at", "forkCut"],
				params: ["slotId", "mode", "last"]
			}
		),

		/**
		 * 🚧 How many of each item are held and left (attributes phase 3a) —
		 * what a genre pipeline reads before it hands one out. It answers and
		 * never enforces: supply is the pipeline's to keep (owner ruling).
		 *
		 * Through the database like `resolve-state-changes` below, on the same
		 * stated terms: the answer needs `valueOf` over every owner and list
		 * slot, which `ctx.read` cannot give. Scoped by the `scope` port — only
		 * item entries in THAT session's lorebook are answered for.
		 */
		"core:query/item-supply@1": reads<typeof C.itemSupply>(
			async (input: NodeInput<typeof C.itemSupply>) => {
				const sessionId = input?.scope?.sessionId
				if (typeof sessionId !== "number")
					return halt(
						"there is no session to count items in — wire this node's scope port"
					)
				const raw = input?.entryIds
				const entryIds = Array.isArray(raw)
					? raw.filter(
							(id): id is number => typeof id === "number" && Number.isInteger(id)
						)
					: undefined
				const { itemSupplyFor } = await import("$lib/server/state/supply")
				const { db } = await import("$lib/server/db")
				const supply = await itemSupplyFor(db, sessionId, entryIds)
				return ok({ main: supply, supply })
			},
			{ ports: ["scope", "entryIds"] }
		),

		/**
		 * Changes a model NAMED, turned into changes `set-state` can write.
		 *
		 * ## Why the resolution is shared with the tools and not restated
		 *
		 * `set_state`, `give_item` and `take_item` do exactly this when a model
		 * asks through a tool call; this does it when a model answers with a
		 * JSON block. `ownerFor` and `slotFor` are imported from there rather
		 * than rewritten, because a name that resolves to one character through
		 * a tool and to another through a block is a stat landing on the wrong
		 * person depending on how the model happened to ask.
		 *
		 * ## A refusal is a result, not a halt
		 *
		 * A keeper that named five changes and got one name wrong should land
		 * four and a sentence about the fifth. `refused` carries the sentences
		 * so the receipt can show them; halting would lose the other four, which
		 * is the argument `set-state`'s own per-change refusal already makes.
		 */
		"core:query/resolve-state-changes@1": reads<
			typeof C.resolveStateChanges
		>(
			async (
				input: NodeInput<typeof C.resolveStateChanges>,
				ctx: CoreQueryCtx
			) => {
				const sessionId = input?.scope?.sessionId
				if (typeof sessionId !== "number")
					return halt(
						"there is no session to resolve these names against — wire this node's scope port"
					)
				const named = Array.isArray(input?.changes) ? input.changes : []
				// The version this turn read (U5f), passed through onto every
				// resolved change so `set-state` can rebase each one.
				const base = readBase(input?.base)
				const { ownerFor, slotFor, trackedSlotIds } = await import(
					"$lib/server/pipelines/runtime/tools/stateTools"
				)
				// The session's own vocabulary, once for the whole list: a slot
				// is matched within what THIS session tracks, never against every
				// declaration the process holds.
				const tracked = await trackedSlotIds(sessionId)
				const { ToolError } = await import(
					"$lib/server/pipelines/runtime/tools"
				)
				/**
				 * The write's own validation, run HERE — the same deviation
				 * `set-state` states in the header, and for the same reason: a
				 * Query's `ctx` reads tables, and what this needs is the
				 * configuration resolved for one owner and one slot.
				 *
				 * ⚠ **This is the gate that makes a proposal worth showing.** A
				 * keeper answered a live Rest with stamina 90 on a slot that
				 * stops at 10, mood "Thoughtful" on an enum that does not hold
				 * it, and weather "Overcast with Storm Clouds, Threatening Rain
				 * and Thunder" — and every one of them landed in front of the
				 * player as a change to accept or reject. Nothing downstream
				 * could have caught it: `propose` stores the payload, and the
				 * refusal only arrives if somebody presses Accept.
				 *
				 * `validateValue` rather than a second check written here, so
				 * what is refused at the gate and what is refused at the write
				 * are one sentence out of one function.
				 */
				const {
					StateRefusal,
					validateValue,
					assertTracked,
					assertLoreRefsInSession,
					assertSessionOwner,
					loreRefNamed
				} = await import("$lib/server/state/write")
				const { INVENTORY_SLOT_ID, inventoryChange } = await import(
					"$lib/server/state/inventory"
				)
				/**
				 * 🚧 Item supply, when the spec wired it (attributes phase
				 * 3b). Core never enforces supply — the owner ruled it a genre
				 * pipeline's (2026-09-25) — so this check exists only where a
				 * genre put `core:query/item-supply@1`'s answer on the
				 * `supply` port: wiring it IS the genre's decision. A grant
				 * past what is left (a unique item somebody holds, the fourth
				 * of three) is a sentence on `refused`; a take frees what that
				 * owner actually held, so a hand-over reported in one turn
				 * (take, then give) passes. The tally runs across the turn, so
				 * two grants of the last key cannot both pass.
				 */
				const supply = readSupply(
					(input as { supply?: unknown })?.supply
				)
				const supplyRefusal = (
					owner: { kind: string; id: number },
					entryId: number,
					delta: number
				): string | null => {
					const line = supply.get(entryId)
					if (!line) return null
					const who = `${owner.kind}:${owner.id}`
					if (delta < 0) {
						const had = line.held.get(who) ?? 0
						const freed = Math.min(-delta, had)
						line.held.set(who, had - freed)
						if (line.remaining !== null) line.remaining += freed
						return null
					}
					if (line.remaining === null) return null
					if (delta > line.remaining)
						return line.supply === "unique"
							? `${line.name} is unique and is already held, so it cannot be handed out again.`
							: `only ${line.remaining} of ${line.name} ${line.remaining === 1 ? "is" : "are"} left (of ${line.limit}), so ${delta} cannot be handed out.`
					line.remaining -= delta
					line.held.set(who, (line.held.get(who) ?? 0) + delta)
					return null
				}
				const { valueOf } = await import("$lib/server/state/resolve")
				const { db } = await import("$lib/server/db")
				// The tools' own context shape, which is all `ownerFor` reads: the
				// session, and a read of its cast. Both come from this node's scope,
				// so the cast matched against is the cast of the session on the
				// port.
				const toolCtx = {
					sessionId,
					read: (table: any, query?: unknown) =>
						ctx.read(table, query)
				} as any

				const changes: unknown[] = []
				const refused: string[] = []
				// A take before a give, whatever order the model wrote them
				// in: the supply tally must see the item freed before it is
				// handed on. Stable, so every other change keeps its place.
				const isTake = (raw: unknown) => {
					const l = raw as Record<string, unknown> | null
					return (
						!!l &&
						typeof l === "object" &&
						Number.isFinite(Number(l.entryId ?? l.entry_id)) &&
						Number(l.delta ?? l.quantity) < 0
					)
				}
				const ordered = [
					...named.filter(isTake),
					...named.filter((raw) => !isTake(raw))
				]
				/**
				 * One (owner, slot) per turn, and the first one written wins.
				 *
				 * The keeper reports what the scene MADE true and the planner
				 * hints at what it is ABOUT, so the two can name one slot in
				 * one turn. Two proposals for one value is two buttons saying
				 * opposite things about the same number.
				 */
				const claimed = new Set<string>()
				const claim = (
					owner: { kind: string; id: number },
					slotId: string
				) => `${owner.kind}:${owner.id}:${slotId}`

				/**
				 * 🚧 **Whose stats this keeper keeps** (`keeps`, owner ruling
				 * 2026-09-30): `'world'` — the world and its places; a
				 * `character:<id>` — that member alone. A change to anybody
				 * else is a sentence, never a write. Unwired, anyone.
				 */
				const keeps = await keepsFrom(
					(input as { keeps?: unknown })?.keeps,
					async (name) => {
						try {
							const owner = await ownerFor(toolCtx, name)
							return owner.kind === "session_cast" ? owner.id : null
						} catch (e) {
							if (e instanceof ToolError) return null
							throw e
						}
					}
				)
				const keptRefusal = (
					owner: { kind: string; id: number },
					named: string
				): string | null => {
					if (!keeps) return null
					const who = named.trim() || (owner.kind === "session_cast" ? "a delver" : "the world")
					if (owner.kind !== "session_cast")
						return keeps.world
							? null
							: `the world's stats (${who}) are kept on the world's turn, so this keeper — a delver's own — left them alone.`
					if (keeps.cast.has(owner.id)) return null
					if (!keeps.world)
						return `${who} is not whose turn this was, so this keeper — that delver's own — left their stats alone.`
					return keeps.cast.size
						? `${who} did not speak this turn, so this keeper — the world's and the speakers' — left their stats alone.`
						: `${who}'s stats are theirs to keep on their own turn, so this keeper — the world's — left them alone.`
				}
				/** The owner name the change was written with, for its refusal. */
				let namedOwner = ""

				/** Coerce, validate, and take the change or leave a sentence. */
				const take = async (
					owner: { kind: "session" | "session_cast" | "session_location"; id: number },
					slotId: string,
					written: unknown
				): Promise<void> => {
					const kept = keptRefusal(owner, namedOwner)
					if (kept) {
						refused.push(kept)
						return
					}
					const value =
						typeof written === "number" ||
						typeof written === "string" ||
						typeof written === "boolean"
							? // 🚧 A place the lorebook names, on a slot that
								// may point at one, is that place (a location).
								await loreRefNamed(db, sessionId, slotId, asSlotType(slotId, written))
							: null
					// Throws a sentence naming the slot and what it accepts,
					// which is the whole of why nothing invalid is proposed.
					await validateValue(db, { sessionId, owner, slotId, value })
					claimed.add(claim(owner, slotId))
					changes.push({
						owner,
						slotId,
						value,
						...(base !== null ? { base } : {})
					})
				}

				/**
				 * The `owners` port (lair re-plan R10): who a change naming no
				 * owner is for, as participant references — the Whisper's
				 * recipients. Each resolves to a seated cast member once, here;
				 * anything else is a sentence, and the change is made on each
				 * owner that did resolve. Unwired, an owner-less change is the
				 * world's, as before.
				 */
				const owners = await ownersFrom(
					(input as { owners?: unknown })?.owners,
					sessionId,
					(owner) => assertSessionOwner(db, sessionId, owner),
					refused
				)
				const lines: Array<{
					line: Record<string, unknown>
					owner?: { kind: "session_cast"; id: number }
				}> = []
				for (const raw of ordered) {
					if (!raw || typeof raw !== "object") continue
					const line = raw as Record<string, unknown>
					if (owners && typeof line.owner !== "string")
						for (const owner of owners) lines.push({ line, owner })
					else lines.push({ line })
				}

				for (const { line, owner: given } of lines) {
					namedOwner = typeof line.owner === "string" ? line.owner : ""
					try {
						const owner =
							given ??
							(await ownerFor(
								toolCtx,
								typeof line.owner === "string" ? line.owner : ""
							))
						const entryId = Number(line.entryId ?? line.entry_id)
						if (Number.isFinite(entryId)) {
							// The item arm: something changing hands, which is
							// an add or remove on the owner's inventory stat
							// (phase 3b — the possession edges are retired). A
							// delta of zero is not a change, and a missing one
							// means "one of it" — which is what `give_item`
							// reads too. A keeper's answer names this arm
							// `inventory`; its `path` joins it to `values`
							// before this node, so a line never carries it.
							const asked = Number(line.delta ?? line.quantity)
							const delta =
								Number.isFinite(asked) && asked !== 0
									? Math.trunc(asked)
									: 1
							const kept = keptRefusal(owner, namedOwner)
							if (kept) {
								refused.push(kept)
								continue
							}
							const change = inventoryChange(owner, entryId, delta, base)!
							// The gate's own doors, asked HERE so nothing it
							// would refuse is shown as a change to accept: the
							// session must track inventory, and what comes in
							// must be its own lorebook's.
							await assertTracked(db, sessionId, INVENTORY_SLOT_ID)
							await assertLoreRefsInSession(db, sessionId, change)
							const refusal = supplyRefusal(owner, entryId, delta)
							if (refusal) {
								refused.push(refusal)
								continue
							}
							changes.push(change)
							continue
						}
						const slot =
							typeof line.slot === "string"
								? line.slot
								: typeof line.slotId === "string"
									? line.slotId
									: ""
						// Neither arm. Worth its own sentence rather than
						// `slotFor`'s: an empty name reached a live receipt as
						// "there is no '' to set here", which reads as a model
						// mistake and was in fact a whole document arriving
						// where one change was expected.
						if (!slot.trim()) {
							refused.push(
								"a change arrived with no slot and no item on it, so there was nothing to set."
							)
							continue
						}
						await take(owner, slotFor(slot, tracked), line.value)
					} catch (e) {
						// A name this scene does not hold, or a value its slot
						// does not accept, is a sentence rather than a failure
						// — see the header.
						if (e instanceof ToolError || e instanceof StateRefusal)
							refused.push(e.message)
						else throw e
					}
				}

				/**
				 * The planner's world hints, resolved as the changes they are.
				 *
				 * They were a required part of the plan's schema and were read
				 * by NOBODY: a first turn that planned "the archive, night,
				 * storm" left Location unset, the world strip empty and the
				 * narrator anchored to nothing. A hint equal to what the world
				 * already says proposes nothing, which is what makes it safe to
				 * ask the planner to restate an unchanged state.
				 */
				const hints = (input as { plan?: { worldHints?: unknown } })
					?.plan?.worldHints
				if (hints && typeof hints === "object") {
					const { vocabularyFor } = await import("$lib/server/state/resolve")
					const { slotValueForStorage } = await import("@serene-pub/sdk")
					// What this session keeps on the WORLD, by the slot's local name.
					const onWorld = new Map(
						(await vocabularyFor(db, sessionId)).slots
							.filter((t) => t.appliesTo.includes("world"))
							.map((t) => [t.key, t.id])
					)
					const owner = { kind: "session" as const, id: sessionId }
					namedOwner = "world"
					for (const [key, wanted] of Object.entries(hints as Record<string, unknown>)) {
						if (typeof wanted !== "string" || !wanted.trim()) continue
						const slotId = onWorld.get(hintSlotName(key))
						if (!slotId) continue
						try {
							if (claimed.has(claim(owner, slotId))) continue
							const held = await valueOf(db, { sessionId, owner, slotId })
							const next = await loreRefNamed(db, sessionId, slotId, wanted.trim())
							// Proposing what is already true is a button that
							// changes nothing, on every turn the world holds
							// still — and a place is the same place whether
							// the hint named it or the state points at it.
							if (
								held !== undefined &&
								JSON.stringify(slotValueForStorage(held)) ===
									JSON.stringify(slotValueForStorage(next))
							)
								continue
							await take(owner, slotId, wanted.trim())
						} catch (e) {
							if (
								e instanceof ToolError ||
								e instanceof StateRefusal
							)
								refused.push(e.message)
							else throw e
						}
					}
				}

				const main = {
					changes,
					...(refused.length ? { refused } : {})
				}
				return ok({ main, changes, refused })
			},
			{ ports: ["changes", "owners", "keeps", "scope", "plan", "base", "supply"] }
		),

		"core:task/set-state@1": reads<typeof C.setState>(
			async (input: NodeInput<typeof C.setState>) => {
				const sessionId = input?.scope?.sessionId
				if (typeof sessionId !== "number")
					return halt(
						"there is no session to change state in — wire this node's scope port"
					)

				const changes = readChanges(input?.changes)
				// Producing nothing is a legitimate outcome: a turn where the model
				// changed nothing is the ordinary turn, not a failed one.
				if (!changes.length)
					return ok({
						main: { applied: [], proposed: [] },
						applied: [],
						proposed: []
					})

				const mode =
					input?.params?.mode === "apply" ? "apply" : "propose"
				/**
				 * The state version the changes are deltas against (U5f): the
				 * node's `base` for every change that does not carry its own.
				 * In `apply` mode a change whose slot moved past it lands on
				 * `refused` with the versions named — the rebase is the write's
				 * (`applyChange`), and the next turn's `resolve-state-changes`
				 * re-resolves; a run never re-enters an earlier node. In
				 * `propose` mode the base is stamped on the proposal for the
				 * accept to judge the same way.
				 */
				const nodeBase = readBase(input?.base)
				const { applyAutomatic, loreWriteModeOnce, proposeChange, StateRefusal } =
					await import("$lib/server/state/write")
				const { db } = await import("$lib/server/db")
				// A change to the BOOK in apply mode follows the book owner's
				// lore write mode (plan A22): Full applies, Review changes
				// proposes, Off refuses with the sentence naming the mode.
				const modeOf = loreWriteModeOnce(db, sessionId)

				// ⚠ **No `messageId`.** Under the turn lock (R9) a change
				// anchors to the OWNER's own latest reply — that character's,
				// or the session's newest message for the world — and stays
				// open until they speak again. Naming the session's newest
				// message here would file Verity's change against Marrow's
				// reply and, worse, be refused as sealed the moment anybody
				// else had spoken since her: every keeper write in a group
				// session, and every write for a character who has not spoken
				// yet. `anchorFor` resolves it per owner, which is the one
				// place that decision is made.
				const ctxWrite = {
					sessionId,
					updatedBy: `run:${run.runId ?? "unknown"}`
				}
				/**
				 * **The row the world's changes are filed at** (lair pass R8,
				 * 2026-09-28) — declared on `worldRow`, never inferred, and
				 * only for world-owned changes: a cast member's change still
				 * resolves to that member's open anchor above. A write result
				 * from THIS run only (the port's shape: a row id is not
				 * assignable to it), so the row is the run's own, and a run's
				 * own row is open to it for the rest of its turn
				 * (`WriteContext.ownAnchor`). Anything else is refused.
				 */
				const worldRow = readWorldRow(input?.worldRow)
				if (worldRow === false)
					return halt(
						"worldRow takes a message this run wrote, as that write's result — wire an earlier create-message's messageId"
					)
				const ctxFor = (change: StateChange) =>
					worldRow !== undefined && change.owner.kind !== "session_cast"
						? { ...ctxWrite, messageId: worldRow, ownAnchor: true }
						: ctxWrite

				const applied: number[] = []
				const proposed: number[] = []
				const refused: string[] = []
				for (const raw of changes) {
					const change =
						raw.base == null && nodeBase !== null
							? { ...raw, base: nodeBase }
							: raw
					try {
						if (mode === "apply") {
							const done = await applyAutomatic(db, ctxFor(change), change, undefined, modeOf)
							if ("applied" in done) applied.push(done.applied)
							else proposed.push(done.proposed)
						} else
							proposed.push(
								await proposeChange(db, ctxFor(change), change)
							)
					} catch (e) {
						// A change the declaration refuses is a *result*: the other
						// changes in the list were still legitimate, and halting the
						// turn over one bad number would lose them all.
						if (e instanceof StateRefusal) refused.push(e.message)
						else throw e
					}
				}

				const main = {
					applied,
					proposed,
					...(refused.length ? { refused } : {})
				}
				return ok({ main, applied, proposed, refused })
			},
			{ ports: ["changes", "scope", "base", "worldRow"], params: ["mode"] }
		)
	}
}
