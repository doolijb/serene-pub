/**
 * The tools an install has with no extensions at all.
 *
 * Four reads, and each one answers a question a model asks when it is about to
 * guess: what does this world say about X, what exactly does entry N say, when
 * did anyone last mention Y, and what has already been summarised. Everything
 * here goes through `ctx.read` — see `ToolContext` for why a tool may not have
 * queries of its own.
 *
 * ## Literal, not regular expressions
 *
 * `grep_transcript` matches a **substring**, and that is a decision rather than
 * a simplification. A model writing a regular expression writes one that is
 * subtly wrong far more often than one that is subtly clever, and a pattern
 * from a model is untrusted input reaching a backtracking engine — the shape
 * that turns a search into a stalled turn. What the model actually wants is
 * "find where this was said", which a substring answers.
 */

import {
	intArg,
	strArg,
	ToolError,
	type CoreTool,
	type ToolContext
} from "$lib/server/pipelines/runtime/tools"
import { STATE_TOOLS } from "$lib/server/pipelines/runtime/tools/stateTools"
import { keysText } from "$lib/server/pipelines/ranking/signals"

/** How much of a hit's surroundings comes back, in characters, either side. */
const EXCERPT_PAD = 90

/** The most messages any one transcript search reads. */
const TRANSCRIPT_WINDOW = 2000

/**
 * When a search is too common to be an answer.
 *
 * Above this share of the searched messages matching, the result is a list of
 * everywhere rather than a location, so the search narrows itself to whole
 * words and says so. Half is the point where a hit stops distinguishing
 * anything: a model asking where "the" appears has asked nothing.
 */
const NOISE_RATIO = 0.5

const lower = (s: unknown) => String(s ?? "").toLowerCase()

/** An excerpt around the first hit, with the ends marked when it is a window. */
function excerpt(content: string, at: number, length: number): string {
	const from = Math.max(0, at - EXCERPT_PAD)
	const to = Math.min(content.length, at + length + EXCERPT_PAD)
	return (
		(from > 0 ? "…" : "") +
		content.slice(from, to).replace(/\s+/g, " ").trim() +
		(to < content.length ? "…" : "")
	)
}

/** Every index at which `needle` occurs in `haystack`. Both already lowered. */
function occurrences(haystack: string, needle: string): number[] {
	const at: number[] = []
	if (!needle) return at
	let i = haystack.indexOf(needle)
	while (i >= 0) {
		at.push(i)
		i = haystack.indexOf(needle, i + needle.length)
	}
	return at
}

/** The same, but only where the match stands as a whole word. */
function wordOccurrences(haystack: string, needle: string): number[] {
	const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c)
	return occurrences(haystack, needle).filter(
		(i) => !isWord(haystack[i - 1]) && !isWord(haystack[i + needle.length])
	)
}

/**
 * A lore entry the model can act on: what it is called, where it came from,
 * and what it says. `content` is the hydrated entry — bindings substituted,
 * decorator lines stripped — because that is what the host's read returns and
 * what a reader would see in the app.
 */
const asEntry = (e: any) => ({
	id: e.id,
	name: e.name ?? null,
	source: e.source,
	// One line of text, as a person reads a key list — the read hands the
	// stored list on (one element per key).
	keys: keysText(e.keys),
	content: String(e.content ?? "")
})

export const searchEntries: CoreTool = {
	name: "search_entries",
	description:
		"Search this session's lorebook — world lore, character lore and history — for entries whose title, keys or text contain a phrase. Returns matching entries with a short excerpt and the id to read in full.",
	parameters: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description:
					"The phrase to look for. Matched literally, ignoring case."
			},
			limit: {
				type: "integer",
				description:
					"How many entries to return at most. Defaults to 8."
			}
		},
		required: ["query"],
		additionalProperties: false
	},
	async run(args, ctx) {
		const query = strArg(args, "query", "q", "text", "name")
		if (!query)
			throw new ToolError("search_entries needs a query to look for.")
		const limit = intArg(args, "limit", 8, 25)

		const rows: any[] = await entriesFor(ctx)
		const needle = lower(query)
		const matches = rows
			.map(asEntry)
			.filter(
				(e) =>
					lower(e.name).includes(needle) ||
					lower(e.keys).includes(needle) ||
					lower(e.content).includes(needle)
			)

		return {
			query,
			searched: rows.length,
			found: matches.length,
			// Trimmed to the excerpt, never the whole entry: a search returning
			// twenty-five full lore entries would spend the next prompt's whole
			// budget answering a question the model asked to narrow one.
			entries: matches.slice(0, limit).map((e) => {
				const at = lower(e.content).indexOf(needle)
				return {
					id: e.id,
					name: e.name,
					source: e.source,
					excerpt:
						at >= 0
							? excerpt(e.content, at, query.length)
							: e.content.slice(0, EXCERPT_PAD * 2)
				}
			})
		}
	}
}

export const getEntry: CoreTool = {
	name: "get_entry",
	description:
		"Read one lorebook entry in full, by the id search_entries returned.",
	parameters: {
		type: "object",
		properties: {
			id: { type: "integer", description: "The entry's id." }
		},
		required: ["id"],
		additionalProperties: false
	},
	async run(args, ctx) {
		const id = Number(strArg(args, "id", "entryId", "entry_id"))
		if (!Number.isFinite(id))
			throw new ToolError("get_entry needs the numeric id of an entry.")

		// Found in the session's own entries rather than fetched by id, which
		// is what makes "an entry belonging to another session" unreachable
		// without a second scoping rule to get wrong — and what applies the
		// character-lore privacy gate the read already enforces.
		const row = (await entriesFor(ctx)).find((e: any) => e.id === id)
		if (!row)
			throw new ToolError(
				`there is no entry ${id} in this session's lorebook. Use search_entries to find one.`
			)
		return asEntry(row)
	}
}

export const grepTranscript: CoreTool = {
	name: "grep_transcript",
	description:
		"Find where a phrase was said in this conversation. Returns the messages containing it, who said it, how many times, and the text around the first hit.",
	parameters: {
		type: "object",
		properties: {
			text: {
				type: "string",
				description:
					"The phrase to look for. Matched literally, ignoring case."
			},
			limit: {
				type: "integer",
				description:
					"How many messages to return at most. Defaults to 10."
			}
		},
		required: ["text"],
		additionalProperties: false
	},
	async run(args, ctx) {
		const text = strArg(args, "text", "query", "q", "pattern")
		if (!text)
			throw new ToolError("grep_transcript needs a phrase to look for.")
		const limit = intArg(args, "limit", 10, 40)

		const messages: any[] = await ctx.read("session_messages", {
			sessionId: ctx.sessionId,
			limit: TRANSCRIPT_WINDOW
		})
		const needle = lower(text)

		const scan = (find: (h: string, n: string) => number[]) =>
			messages
				.map((m) => {
					const content = String(m.content ?? "")
					const at = find(lower(content), needle)
					return at.length
						? {
								messageId: m.id,
								sender: m.senderName ?? null,
								hits: at.length,
								excerpt: excerpt(content, at[0]!, text.length)
							}
						: null
				})
				.filter((h): h is NonNullable<typeof h> => h !== null)

		let hits = scan(occurrences)
		/**
		 * The auto-narrow, adopted only when it narrows something.
		 *
		 * Over the ratio the search is a list of everywhere rather than a
		 * location, so whole-word matching is tried — and kept only if it
		 * genuinely cut the answer down. Two ways it does not:
		 *
		 *  - It finds **nothing**. "Never said" about something said
		 *    constantly is the one wrong answer worse than a noisy one.
		 *  - It finds **the same messages**. A phrase that was already whole
		 *    words was never the noise this guards against, and reporting a
		 *    narrowing that changed nothing tells a model its question was
		 *    answered differently when it was not.
		 */
		let narrowed = false
		if (messages.length && hits.length / messages.length > NOISE_RATIO) {
			const tighter = scan(wordOccurrences)
			if (tighter.length && tighter.length < hits.length) {
				hits = tighter
				narrowed = true
			}
		}

		return {
			text,
			searched: messages.length,
			found: hits.length,
			// Said out loud, because the model asked one question and is being
			// answered a narrower one.
			...(narrowed
				? {
						narrowed:
							"matched too much of the conversation, so only whole-word matches are listed"
					}
				: {}),
			totalHits: hits.reduce((n, h) => n + h.hits, 0),
			// Newest first: "when did we last talk about this" is the question
			// being asked far more often than "when did we first".
			messages: hits.slice(-limit).reverse()
		}
	}
}

export const readSummary: CoreTool = {
	name: "read_summary",
	description:
		"Read what has already been summarised — the scenes of this session, or the standing world and character lore. Cheaper and more reliable than re-reading the conversation.",
	parameters: {
		type: "object",
		properties: {
			kind: {
				type: "string",
				enum: ["scene", "world", "character", "history"],
				description:
					"'scene' for this session's summarised scenes; the others read the lorebook's standing summaries."
			},
			name: {
				type: "string",
				description:
					"Only what is titled like this. Omit for everything of that kind."
			}
		},
		required: ["kind"],
		additionalProperties: false
	},
	async run(args, ctx) {
		const kind = lower(strArg(args, "kind", "type") || "scene")
		const name = strArg(args, "name", "title", "subject")
		const named = (v: unknown) => !name || lower(v).includes(lower(name))

		if (kind === "scene") {
			const scenes: any[] = await ctx.read("graph_scenes", {
				sessionId: ctx.sessionId
			})
			const summarised = scenes
				.filter((s) => s.summary && named(s.name))
				.map((s) => ({
					id: s.id,
					name: s.name ?? null,
					summary: String(s.summary)
				}))
			return {
				kind: "scene",
				found: summarised.length,
				summaries: summarised
			}
		}

		const source =
			kind === "world"
				? "worldLore"
				: kind === "character"
					? "characterLore"
					: kind === "history"
						? "history"
						: null
		if (!source)
			throw new ToolError(
				`read_summary does not know the kind '${kind}'. Ask for scene, world, character or history.`
			)

		const entries = (await entriesFor(ctx))
			.filter((e: any) => e.source === source && named(e.name))
			.map(asEntry)
		return {
			kind,
			found: entries.length,
			summaries: entries.map((e) => ({
				id: e.id,
				name: e.name,
				summary: e.content
			}))
		}
	}
}

/**
 * The session's lore, read once per tool call.
 *
 * Not cached across calls: a tool loop can run for a minute and a run that
 * answered from a stale copy of a lorebook the person is editing beside it
 * would be answering about a world that no longer exists.
 */
async function entriesFor(ctx: ToolContext): Promise<any[]> {
	/**
	 * The listing posture (finding #149), the same `core:query/lorebook-entries@1`
	 * asks for: a switched-off or shelved entry is not one the model may find,
	 * read or summarize. The host asks it of the entry as the session reads it,
	 * so an Off set by a dated amendment counts.
	 */
	const rows = await ctx.read("lorebook_entries", {
		sessionId: ctx.sessionId,
		currentCharacterId: ctx.currentCharacterId ?? null,
		enabled: true,
		archived: false
	})
	return Array.isArray(rows) ? rows : []
}

export const CORE_TOOLS: CoreTool[] = [
	searchEntries,
	getEntry,
	grepTranscript,
	readSummary,
	// The three that ask rather than read — see stateTools.ts for why asking is
	// not the write the rule above forbids.
	...STATE_TOOLS
]

export const coreTool = (name: string): CoreTool | undefined =>
	CORE_TOOLS.find((t) => t.name === name)
