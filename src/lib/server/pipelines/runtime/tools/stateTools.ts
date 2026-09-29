/**
 * The three tools a model uses to ask for a change to the world.
 *
 * ## They propose. They never apply.
 *
 * Every other core tool is a read, and the rule above them (`tools/index.ts`)
 * says a tool may not write. These three do not break it: what they create is a
 * **request** — a `state_proposals` row with no effect on any value until a
 * person accepts it — which is the review gate the design puts between the
 * model and the fiction. A model that could set a number directly could rewrite
 * a character between two messages with nothing a player can refuse, and the
 * turn it happened in would look exactly like one where it did not.
 *
 * So the sentence each of these returns is deliberately in the future tense.
 * A model told "done" would go on to narrate the consequence of a change that
 * has not happened; told "asked", it narrates the attempt, which is what it
 * was actually able to do.
 *
 * ## Why the arguments are names and not ids
 *
 * A model addresses a character by name because that is what the transcript
 * gave it; making it quote a row id would mean a lookup tool call before every
 * change. The resolution to an owner happens here, against the session's own
 * cast, so a name that is not in the scene is refused by name rather than
 * silently applied to somebody else.
 */

import {
	strArg,
	ToolError,
	type CoreTool,
	type ToolContext
} from "$lib/server/pipelines/runtime/tools"
import { slotKey } from "$lib/server/state/keys"
import { inventoryChange } from "$lib/server/state/inventory"

/** A cast row as `session_cast` hands it over. */
const castName = (row: any): string =>
	String(row?.character?.name ?? row?.name ?? "")

const same = (a: string, b: string) =>
	a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * A name from the conversation, resolved to an owner.
 *
 * ⚠ **Exported for `core:query/resolve-state-changes@1`**, which is the same
 * resolution reached from a structured block instead of from a tool call. One
 * implementation, because a name that resolves one way through a tool and
 * another way through a JSON block is a stat that lands on the wrong character
 * depending on how the model happened to ask.
 */
export async function ownerFor(
	ctx: ToolContext,
	who: string
): Promise<{ kind: "session" | "session_cast" | "session_location"; id: number }> {
	// The world owner: what nobody is carrying, and where weather lives.
	if (!who || same(who, "world") || same(who, "the world")) {
		if (!ctx.sessionId)
			throw new ToolError("there is no session to change state in.")
		return { kind: "session", id: ctx.sessionId }
	}
	const cast: any = await ctx.read("session_cast", {
		sessionId: ctx.sessionId
	})
	/**
	 * ⚠ **`sessionCharacters`, and that spelling is the whole of it.**
	 *
	 * The host publishes the session row with the join under
	 * `sessionCharacters` (host.ts, `case "session_cast"`), because a character
	 * without its join carries no visibility. This read looked for
	 * `characters`, found nothing, and refused every name a model could
	 * possibly have used — so a tool call naming anybody answered "there is
	 * nobody called X in this scene" while X was plainly in it. Found by the
	 * adventure state-keeper, which resolves names through this same function.
	 *
	 * Both spellings and a bare array are accepted rather than the one, because
	 * the alternative is this function knowing which of its two callers it is
	 * serving.
	 */
	const rows = Array.isArray(cast)
		? cast
		: (cast?.sessionCharacters ?? cast?.characters ?? [])
	const match = (Array.isArray(rows) ? rows : []).find((r: any) =>
		same(castName(r), who)
	)
	const id = match?.character?.id ?? match?.id
	if (typeof id === "number") return { kind: "session_cast", id }
	// 🚧 A place (attributes phase 4): a location of the session's world holds
	// state too — "the key is left in the crypt". Asked after the cast, so a
	// character and a place sharing a name resolve to the character.
	const place = ctx.sessionId ? await locationNamed(ctx.sessionId, who) : null
	if (place !== null) return { kind: "session_location", id: place }
	throw new ToolError(
		`there is nobody called '${who}' in this scene, and no place by that name. Use the name as it appears in the conversation or the lorebook, or 'world'.`
	)
}

/** The entry id of the session's location called `name`, or null. */
async function locationNamed(sessionId: number, name: string): Promise<number | null> {
	// Dynamic, as `bindings.state.ts` reads the database: this module is
	// loaded by the tool registry, which must not open the database to load.
	const { db } = await import("$lib/server/db")
	const { sessionLinks } = await import("$lib/server/state/resolve")
	const { locations } = await sessionLinks(db, sessionId)
	return locations.find((l) => same(l.name, name))?.entryId ?? null
}

/**
 * The slot a model named, matched on its declared local name or its full id —
 * **within the session's own vocabulary**, `tracked` (`trackedSlotIds`).
 *
 * ⚠ Not the whole declaration registry. That registry is global — a genre
 * declaring weather declares it for the process — so matching against it put
 * a value on a session that does not track the slot, and the refusal told the
 * model "This session tracks:" followed by every slot any genre declared. A
 * session of a genre this process does not hold tracks nothing
 * (`vocabularyFor` fails closed), and every name is then refused.
 *
 * Exported on the same terms as `ownerFor` above, and for the same reason.
 */
export function slotFor(named: string, tracked: readonly string[]): string {
	const exact = tracked.find((id) => id === named.trim())
	if (exact) return exact
	const bare = named.trim().toLowerCase()
	const found = tracked.find((id) => slotKey(id).toLowerCase() === bare)
	if (!found)
		throw new ToolError(
			`there is no '${named}' to set here. This session tracks: ${
				tracked.map(slotKey).join(", ") || "nothing"
			}.`
		)
	return found
}

/** The slot ids `sessionId` tracks — its vocabulary, what `slotFor` matches. */
export async function trackedSlotIds(sessionId: number): Promise<string[]> {
	// Dynamic, as `locationNamed` above: the tool registry loads this module
	// and must not open the database to do it.
	const { db } = await import("$lib/server/db")
	const { vocabularyFor } = await import("$lib/server/state/resolve")
	const vocabulary = await vocabularyFor(db, sessionId)
	return vocabulary.entries.map((e) => e.decl.id)
}

const ask = async (ctx: ToolContext, change: unknown): Promise<number> => {
	if (!ctx.propose)
		throw new ToolError(
			"changes to state cannot be requested on this step."
		)
	return await ctx.propose(change)
}

export const setState: CoreTool = {
	name: "set_state",
	description:
		"Ask to change one of the tracked values on a character or on the world — health, mood, weather. The change is shown to the player for approval and does not take effect until they accept it.",
	parameters: {
		type: "object",
		properties: {
			owner: {
				type: "string",
				description:
					"Whose value it is, by name as it appears in the conversation, or 'world'."
			},
			slot: {
				type: "string",
				description: "What is changing — 'hp', 'mood', 'weather'."
			},
			value: {
				description:
					"The new value. A whole number, one of the declared options, a line of text, or true/false."
			}
		},
		required: ["slot", "value"],
		additionalProperties: false
	},
	async run(args, ctx) {
		const owner = await ownerFor(
			ctx,
			strArg(args, "owner", "who", "target")
		)
		if (!ctx.sessionId)
			throw new ToolError("there is no session to change state in.")
		const slotId = slotFor(
			strArg(args, "slot", "stat", "name", "field"),
			await trackedSlotIds(ctx.sessionId)
		)
		const raw = (args as Record<string, unknown>).value
		const value =
			typeof raw === "number" ||
			typeof raw === "string" ||
			typeof raw === "boolean"
				? raw
				: null
		const id = await ask(ctx, { owner, slotId, value })
		return {
			proposalId: id,
			status: "proposed",
			// Future tense, on purpose — see the file header.
			message: `Asked to set ${slotId} to ${JSON.stringify(value)}. It is waiting for the player to accept it.`
		}
	}
}

export const giveItem: CoreTool = {
	name: "give_item",
	description:
		"Ask to add a lorebook entry to somebody's inventory, as an item they are carrying. Use search_entries to find the item's id first. The player approves it before it takes effect.",
	parameters: {
		type: "object",
		properties: {
			owner: {
				type: "string",
				description:
					"Who receives it, by name, or 'world' to leave it lying about."
			},
			entry_id: {
				type: "integer",
				description: "The entry id of the item, from search_entries."
			},
			quantity: {
				type: "integer",
				description: "How many. Defaults to one."
			}
		},
		required: ["entry_id"],
		additionalProperties: false
	},
	async run(args, ctx) {
		return await moveItem(args, ctx, 1, "give")
	}
}

export const takeItem: CoreTool = {
	name: "take_item",
	description:
		"Ask to remove an item from somebody's inventory. Use search_entries to find the item's id first. The player approves it before it takes effect.",
	parameters: {
		type: "object",
		properties: {
			owner: {
				type: "string",
				description: "Who loses it, by name, or 'world'."
			},
			entry_id: {
				type: "integer",
				description: "The entry id of the item, from search_entries."
			},
			quantity: {
				type: "integer",
				description: "How many. Defaults to one."
			}
		},
		required: ["entry_id"],
		additionalProperties: false
	},
	async run(args, ctx) {
		return await moveItem(args, ctx, -1, "take")
	}
}

/**
 * An item moving, as a list change on the owner's `inventory` stat (phase 3b:
 * the possession edges these tools once wrote are retired). `quantity` is the
 * held count added or removed — a remove below one drops the item.
 */
async function moveItem(
	args: Record<string, unknown>,
	ctx: ToolContext,
	sign: 1 | -1,
	verb: "give" | "take"
) {
	const owner = await ownerFor(ctx, strArg(args, "owner", "who", "target"))
	const entryId = Number(strArg(args, "entry_id", "entryId", "id", "item"))
	if (!Number.isFinite(entryId))
		throw new ToolError(
			`${verb}_item needs the entry id of the item. Find it with search_entries.`
		)
	const asked = Number(strArg(args, "quantity", "count", "amount")) || 1
	const delta = sign * Math.max(1, Math.trunc(Math.abs(asked)))
	const id = await ask(ctx, inventoryChange(owner, entryId, delta))
	return {
		proposalId: id,
		status: "proposed",
		message: `Asked to ${verb === "give" ? "add" : "remove"} ${Math.abs(delta)} of entry ${entryId} ${verb === "give" ? "to" : "from"} their inventory. It is waiting for the player to accept it.`
	}
}

/** The three, in the order the advertisement lists them. */
export const STATE_TOOLS: CoreTool[] = [setState, giveItem, takeItem]
