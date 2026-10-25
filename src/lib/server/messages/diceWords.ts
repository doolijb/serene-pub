/**
 * 🚧 **An outcome row, without its numbers** (Lair rewrite D3, 2026-10-21;
 * method-aware since 2026-10-22 — the dice words became **outcome words**).
 *
 * An outcome block (stored kind `dice`) is a check's result — dice, a pool,
 * cards, a comparison, a spend or a judgement — shown in the story under the
 * speaker that reports mechanics (the Lair's Oracle): the block for the
 * screen, the row's text for every prompt. A genre whose GM turns **Show
 * outcomes** off (the genre field `showDice: false` — its id kept) keeps
 * the result on the screen and takes the numbers out of every prompt: the
 * party read how it went, never the total or the target.
 *
 * So the write stamps, beside the row, its result in words with no number in
 * it (`metadata.diceWords`, its key kept: "Bram — Stealth: Failure.", one
 * line a block; a check decided by another method says how — "Bram — Nerve,
 * by a spend: Success."), and the history read hands a prompt those words in
 * place of the row's text while the session's `showDice` is off (`host.ts`,
 * `session-history`). The blocks themselves never enter a prompt
 * (`messages/blocks.ts`).
 */

import { inArray, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/** The genre field a session turns the outcomes' numbers out of its prompts with — _Show outcomes_ (⏳ id `showDice`, kept). */
export const SHOW_DICE_FIELD = "showDice"

/** The metadata key the numberless reading of an outcome row is stored under (⏳ `diceWords`, kept: stored rows hold it). */
export const DICE_WORDS_KEY = "diceWords"

type DiceLike = { kind?: unknown; method?: unknown; stat?: unknown; outcome?: unknown; by?: unknown; blocks?: unknown }

/**
 * 🚧 How a check was decided, in words with no number — said after what was
 * checked when it is anything but a die against a target (whose sentence is
 * the one every stored row already reads).
 */
const METHOD_WORDS: Readonly<Record<string, string>> = {
	"dice-pool": "by a pool of dice",
	"card-draw": "by the cards",
	compare: "by comparison",
	bid: "by a spend",
	none: "as judged"
}

/** Every `dice` block in a block tree, in order (groups walked). */
function diceBlocksOf(blocks: unknown): DiceLike[] {
	if (!Array.isArray(blocks)) return []
	const out: DiceLike[] = []
	for (const b of blocks as DiceLike[]) {
		if (!b || typeof b !== "object") continue
		if (b.kind === "dice") out.push(b)
		else if (b.kind === "group") out.push(...diceBlocksOf(b.blocks))
	}
	return out
}

/**
 * A block tree's outcomes, as words with no number: `<who> — <what>: <how it
 * went>.`, a line each (🚧 `<who> — <what>, <how it was decided>: <how it
 * went>.` for any check method but a die against a target), who named by
 * the session's seats (a character or a persona by name, a card-less seat
 * by its seat name). Null when the tree holds no outcome block.
 */
export async function outcomeWordsOf(db: Db, blocks: unknown): Promise<string | null> {
	const dice = diceBlocksOf(blocks)
	if (!dice.length) return null
	const refs = dice.map((d) => (typeof d.by === "string" ? d.by : ""))
	const characterIds = refs
		.map((r) => /^character:(\d+)$/.exec(r)?.[1])
		.filter((x): x is string => !!x)
		.map(Number)
	const seatIds = refs
		.map((r) => /^player-seat:(\d+)$/.exec(r)?.[1])
		.filter((x): x is string => !!x)
		.map(Number)
	const names = new Map<string, string>()
	if (characterIds.length)
		for (const c of await db
			.select({ id: schema.characters.id, name: schema.characters.name })
			.from(schema.characters)
			.where(inArray(schema.characters.id, characterIds)))
			if (c.name) names.set(`character:${c.id}`, c.name)
	for (const id of seatIds) {
		const [seat] = await db
			.select({ seatName: schema.sessionPersonas.seatName })
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.id, id))
			.limit(1)
		if (seat?.seatName) names.set(`player-seat:${id}`, seat.seatName)
	}
	const lines = dice.map((d, i) => {
		const who = names.get(refs[i]!)
		const what = typeof d.stat === "string" && d.stat.trim() ? d.stat.trim() : "The roll"
		const how = typeof d.outcome === "string" && d.outcome.trim() ? d.outcome.trim() : "it is done"
		const by = typeof d.method === "string" ? METHOD_WORDS[d.method] : undefined
		return `${who ? `${who} — ` : ""}${what}${by ? `, ${by}` : ""}: ${how.replace(/[.!]+$/, "")}.`
	})
	return lines.join("\n")
}

/** ⏳ The outcome words' name before 2026-10-22, when every check was a die's. Say `outcomeWordsOf`. */
export const diceWordsOf = outcomeWordsOf

/** Whether a session's genre fields keep the outcomes' numbers out of its prompts (_Show outcomes_ off). */
export const diceHidden = (fields: unknown): boolean =>
	!!fields && typeof fields === "object" && (fields as Record<string, unknown>)[SHOW_DICE_FIELD] === false
