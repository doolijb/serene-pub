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
 * every other Query, so it inherits the scoping refusal.
 *
 * `core:query/resolve-state-changes@1` needs one thing `ctx.read` cannot give
 * it — the CONFIGURATION resolved for one owner and one slot, which is what
 * says whether stamina 90 is a legitimate number — so it takes the same dynamic
 * import on the same terms. It validates rather than writes; the point of doing
 * it here is that a change refused at the gate is never shown to a player as
 * something to accept.
 *
 * `core:task/set-state@1` has nowhere to go. A Task's `ctx` has no write seam
 * — only a Consumer's `ctx.commit` does — and it cannot be a write-class
 * Consumer, because a spec is allowed exactly one of those and that one is the
 * message (F7). So the handler reaches the database directly, through a
 * **dynamic** import that keeps a PGlite handle out of the module graph that
 * `bindingCompat` and the registry tests load. This is the deviation, stated
 * here rather than discovered later: the day a Task-level write seam exists,
 * this is what moves onto it.
 */

import type { Bindings } from "@serene-pub/sdk"
import { getAttributeSlot, halt, ok } from "@serene-pub/sdk"
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
		const value = c as { slotId?: unknown; entryId?: unknown }
		return (
			typeof value.slotId === "string" ||
			typeof value.entryId === "number"
		)
	})
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
 * The planner's three world hints, and the slots they are.
 *
 * The names on the left are the plan schema's — `timeOfDay`, because a JSON
 * schema property is written camelCase — and the names on the right are the
 * slots' own local names, which is what `slotFor` matches. By NAME rather than
 * by id, so a genre that declares its own `location` is served here too.
 */
const WORLD_HINTS: ReadonlyArray<readonly [string, string]> = [
	["location", "location"],
	["timeOfDay", "time-of-day"],
	["weather", "weather"]
]

export function stateBindings(run: RenderRun = {}): Bindings {
	return {
		"core:query/session-state@1": async (
			input: NodeInput<typeof C.sessionState>,
			ctx: CoreQueryCtx
		) => {
			const state = await ctx.read("session_state", {
				sessionId: input?.scope?.sessionId
			})
			return ok({ main: state, state })
		},

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
		"core:query/resolve-state-changes@1": async (
			input: NodeInput<typeof C.resolveStateChanges>,
			ctx: CoreQueryCtx
		) => {
			const sessionId = input?.scope?.sessionId
			if (typeof sessionId !== "number")
				return halt(
					"there is no session to resolve these names against — wire this node's scope port"
				)
			const named = Array.isArray(input?.changes) ? input.changes : []
			const { ownerFor, slotFor } = await import(
				"$lib/server/pipelines/runtime/tools/stateTools"
			)
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
			const { StateRefusal, validateValue } = await import(
				"$lib/server/state/write"
			)
			const { valueOf } = await import("$lib/server/state/resolve")
			const { db } = await import("$lib/server/db")
			// The tools' own context shape, which is all `ownerFor` reads: the
			// session, and a read of its cast. Both come from this node's scope,
			// so the cast matched against is the cast of the session on the
			// port.
			const toolCtx = {
				sessionId,
				read: (table: any, query?: unknown) => ctx.read(table, query)
			} as any

			const changes: unknown[] = []
			const refused: string[] = []
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

			/** Coerce, validate, and take the change or leave a sentence. */
			const take = async (
				owner: { kind: "session" | "session_cast"; id: number },
				slotId: string,
				written: unknown
			): Promise<void> => {
				const value =
					typeof written === "number" ||
					typeof written === "string" ||
					typeof written === "boolean"
						? asSlotType(slotId, written)
						: null
				// Throws a sentence naming the slot and what it accepts,
				// which is the whole of why nothing invalid is proposed.
				await validateValue(db, { sessionId, owner, slotId, value })
				claimed.add(claim(owner, slotId))
				changes.push({ owner, slotId, value })
			}

			for (const raw of named) {
				if (!raw || typeof raw !== "object") continue
				const line = raw as Record<string, unknown>
				try {
					const owner = await ownerFor(
						toolCtx,
						typeof line.owner === "string" ? line.owner : ""
					)
					const entryId = Number(line.entryId ?? line.entry_id)
					if (Number.isFinite(entryId)) {
						// The possession arm. A delta of zero is not a change,
						// and a missing one means "one of it" — which is what
						// `give_item` reads too.
						const asked = Number(line.delta ?? line.quantity)
						const delta =
							Number.isFinite(asked) && asked !== 0
								? Math.trunc(asked)
								: 1
						changes.push({ owner, entryId, delta })
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
					await take(owner, slotFor(slot), line.value)
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
			const hints = (input as { plan?: { worldHints?: unknown } })?.plan
				?.worldHints
			if (hints && typeof hints === "object")
				for (const [key, slot] of WORLD_HINTS) {
					const wanted = (hints as Record<string, unknown>)[key]
					if (typeof wanted !== "string" || !wanted.trim()) continue
					const owner = { kind: "session" as const, id: sessionId }
					try {
						const slotId = slotFor(slot)
						if (claimed.has(claim(owner, slotId))) continue
						const held = await valueOf(db, {
							sessionId,
							owner,
							slotId
						})
						// Proposing what is already true is a button that
						// changes nothing, on every turn the world holds
						// still.
						if (held === wanted.trim()) continue
						await take(owner, slotId, wanted.trim())
					} catch (e) {
						if (e instanceof ToolError || e instanceof StateRefusal)
							refused.push(e.message)
						else throw e
					}
				}

			const main = {
				changes,
				...(refused.length ? { refused } : {})
			}
			return ok({ main, changes, refused })
		},

		"core:task/set-state@1": async (
			input: NodeInput<typeof C.setState>
		) => {
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

			const mode = input?.params?.mode === "apply" ? "apply" : "propose"
			const {
				applyChange,
				newestMessageId,
				proposeChange,
				StateRefusal
			} = await import("$lib/server/state/write")
			const { db } = await import("$lib/server/db")

			const messageId = await newestMessageId(db, sessionId)
			const ctxWrite = {
				sessionId,
				updatedBy: `run:${run.runId ?? "unknown"}`,
				messageId
			}

			const applied: number[] = []
			const proposed: number[] = []
			const refused: string[] = []
			for (const change of changes) {
				try {
					if (mode === "apply")
						applied.push(await applyChange(db, ctxWrite, change))
					else
						proposed.push(await proposeChange(db, ctxWrite, change))
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
			return ok({ main, applied, proposed })
		}
	}
}
