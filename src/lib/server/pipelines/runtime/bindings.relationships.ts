/**
 * The relationship mechanism's binding, in its own module.
 *
 * ⚠ **Beside `bindings.ts` rather than inside it**, and the reason is
 * mechanical rather than stylistic: that file is four thousand lines and is
 * being appended to by more than one lane at a time, so a handler added in the
 * middle of it is a conflict waiting to happen. `coreBindings()` already
 * spreads a group in (`...graphSteps()`), which is the seam this uses — the map
 * is assembled from parts, so a part can live where its own code does.
 *
 * What it binds: `core:query/relationship-search@1`, the narrative graph read
 * as ranked candidates in the `relationships` budget band (ruling 2026-09-10,
 * Q1 — the ruling's word for it is *arm*; the type's own note says why the id
 * does not spell it). The two nodes it sits beside —
 * `relationships-perspectives@1` and `relationships-known@1` — walk the same
 * graph and publish it as three keyed sections; what the prompt renders is this
 * band when a run allocated any of it and those sections when it did not, which
 * `prompt/rankedRelationships.ts` decides.
 */

import type { Bindings } from "@serene-pub/sdk"
import { ok } from "@serene-pub/sdk"
import type * as C from "@serene-pub/contracts"
import type { CoreQueryCtx, NodeInput } from "./bindingTypes"
import type { GraphRelationshipRow } from "$lib/server/utils/graphContextFormatter"
import type {
	GraphEntryLink,
	GraphEntryLinkEnd
} from "$lib/server/utils/graphEntryLinks"
import {
	capRanked,
	rankRelationships
} from "$lib/server/pipelines/ranking/relationshipRanking"
import { keywordQuery } from "$lib/server/pipelines/ranking/keywordQuery"
import { withDefaults } from "$lib/server/pipelines/ranking/weights"
// ⚠ A cycle with `bindings.ts`, which imports this module's own export back.
// Both sides import a hoisted function declaration and call it at run time, not
// at module evaluation, so the cycle resolves; the alternative is a second
// spelling of the vocabulary the lore lanes match against, which is exactly the
// divergence this hop must not have.
import { castEntityRefs } from "./bindings"

/**
 * How one tie reads once it is in the prompt.
 *
 * JSON, matching the three sections the two sibling queries publish and the
 * layouts that render them — the shape was A/B tested before 0.1.0 and prose is
 * opt-in everywhere else in this codebase, so a mechanism inventing prose here
 * would be the one place the rule does not hold. `with` leads on a legendary tie
 * because the heading is the figure and the counterpart is the news.
 */
const contentOf = (row: GraphRelationshipRow): string =>
	JSON.stringify(
		row.counterpart ? { with: row.counterpart, ...row.entry } : row.entry
	)

/** The three lanes, as a sentence a receipt can say out loud. */
const LANE_LABELS: Record<GraphRelationshipRow["lane"], string> = {
	yourRelationships: "how the speaker regards others",
	howOthersRegardYou: "how others regard the speaker",
	legendaryFigures: "figures everyone knows of"
}

// ─── The link hop ─────────────────────────────────────────────────────────────

/**
 * One endpoint reached from an entry the lore mechanisms chose this turn.
 *
 * ⚠ **One hop, and the shape is what enforces it.** The hop expands the entries
 * the *scan* chose, never the endpoints it just produced — so the room reaches
 * the tunnel and stops, and the location on the tunnel's far side is two hops
 * away and out.
 */
interface LinkedRow {
	/** `narrative_relationships.id` — the edge that carried the hop. */
	id: number
	/** The endpoint reached. */
	name: string
	/** The chosen entry it was reached from. */
	from: string
	entry: { type: string; secrecy: string; status?: string; note?: string }
	updatedAt: number
}

/** The same wording the cast traversal puts on an edge's visibility. */
const secrecyLabel = (visibility: string): string =>
	visibility === "secret"
		? "Only I know"
		: visibility === "public"
			? "Everyone knows"
			: "We both know"

/**
 * Which of this book's linked entries the turn is actually about.
 *
 * ⚠ **The same scan the lore lanes run, not a second reading of one.**
 * `keywordQuery` over the same `lorebook_entries` and `session_messages` is what
 * "the entries the lore mechanisms chose this turn" means; asking the question a
 * different way here would give the hop a different answer from the one the
 * prompt is built on, which is the failure every read in this subsystem is
 * arranged to prevent.
 *
 * ⚠ **Its parameters are the declared defaults, not the lore lanes' configured
 * ones.** Scan depth and the rest are slots on those three nodes and this node
 * declares none of them, so a book whose lanes were retuned can choose an entry
 * this does not. Declaring them here is a public-contract change with a
 * re-projection cost, so it is reported rather than made.
 */
async function chosenEntryIds(
	input: NodeInput<typeof C.relationshipSearch>,
	ctx: CoreQueryCtx
): Promise<Set<number>> {
	const [entries, messages, cast] = await Promise.all([
		ctx.read("lorebook_entries", {
			sessionId: input?.scope?.sessionId,
			currentCharacterId: input?.scope?.currentCharacterId ?? null
		}),
		ctx.read("session_messages", {
			sessionId: input?.scope?.sessionId,
			limit: 100
		}),
		ctx.read("session_cast", { sessionId: input?.scope?.sessionId })
	])
	const result = keywordQuery({
		entries: entries ?? [],
		messages: messages ?? [],
		entityRefs: castEntityRefs(cast),
		retrieval: withDefaults({}).retrieval,
		countTokens: (text: string) => ctx.countTokens(text)
	})
	// A candidate's `id` is `string | number` because other bands address rows
	// that way; a lore candidate's is a `lorebook_entries.id`.
	return new Set(
		(result.candidates ?? [])
			.map((c) => c.id)
			.filter((id): id is number => typeof id === "number")
	)
}

/**
 * The hop itself: edges touching a chosen entry, as their other end.
 *
 * An edge both of whose ends were already chosen contributes nothing — the
 * endpoint is in the prompt on its own account — and an endpoint reached twice
 * is contributed once, by the more recently changed edge, so a crossroads does
 * not spend its band four times over.
 */
function linkedRows(
	links: readonly GraphEntryLink[],
	chosen: ReadonlySet<number>
): LinkedRow[] {
	const isChosen = (end: GraphEntryLinkEnd) =>
		end.kind === "entry" && chosen.has(end.id)
	const best = new Map<string, LinkedRow>()
	for (const link of links) {
		for (const [near, far] of [
			[link.from, link.to],
			[link.to, link.from]
		] as const) {
			if (!isChosen(near) || isChosen(far)) continue
			const key = `${far.kind}:${far.id}`
			const row: LinkedRow = {
				id: link.id,
				name: far.name,
				from: near.name,
				entry: {
					type: link.relationshipType,
					secrecy: secrecyLabel(link.visibility),
					...(link.status && link.status !== "active"
						? { status: link.status }
						: {}),
					...(link.description ? { note: link.description } : {})
				},
				updatedAt: link.updatedAt
			}
			const standing = best.get(key)
			if (
				!standing ||
				row.updatedAt > standing.updatedAt ||
				(row.updatedAt === standing.updatedAt && row.id < standing.id)
			)
				best.set(key, row)
		}
	}
	// Newest edge first, id behind it — the same determinism claim
	// `rankRelationships` makes, and the order the band below is stamped in.
	return [...best.values()].sort(
		(a, b) => b.updatedAt - a.updatedAt || a.id - b.id
	)
}

export function relationshipSearchBindings(): Bindings {
	return {
		/**
		 * The narrative graph as candidates.
		 *
		 * Three things happen here and nothing else does. The graph is walked
		 * once — through the same `collectGraphLayers` the prompt's own
		 * sections come out of, so the two cannot disagree about visibility or
		 * aliases. The ties are ordered presence → speaker → recency, which is
		 * `rankRelationships`' whole job and is stated on every row. And the
		 * ceiling is applied, in the vocabulary the two sibling nodes already
		 * use.
		 *
		 * ⚠ **The order rides out as `presetScore`, deliberately.** The
		 * `relationships` band has carried a share, an entry cap and a full set
		 * of signal weights since the ranker was written, and every one of
		 * those weights is **0** — so a relationship scored by the weighted sum
		 * scores exactly nothing and sorts by authored position. Raising those
		 * defaults is a retune of a shipped type; publishing this node's own
		 * order as a score is what `presetScore` is for, and is how
		 * `core:query/entity-search@1` delivers its ranking too. Nothing is
		 * overridden by it: no other mechanism produces a `relationships`
		 * candidate, so there is no signal for this to displace.
		 *
		 * ⚠ **Empty is normal, not a halt.** An install that never opened the
		 * narrative graph has no relationships, and `optional: true` plus an
		 * empty list is what that install has always got from this subsystem.
		 */
		"core:query/relationship-search@1": async (
			input: NodeInput<typeof C.relationshipSearch>,
			ctx: CoreQueryCtx
		) => {
			const maxEntries = input?.params?.maxEntries
			const [rows, links]: [
				GraphRelationshipRow[] | null,
				GraphEntryLink[] | null
			] = await Promise.all([
				ctx.read("graph_relationships", {
					sessionId: input?.scope?.sessionId,
					currentCharacterId: input?.scope?.currentCharacterId ?? null
				}),
				ctx.read("graph_entry_links", {
					sessionId: input?.scope?.sessionId
				})
			])

			/**
			 * The hop, and the guard in front of it.
			 *
			 * ⚠ **No links, no scan.** `chosenEntryIds` re-runs the lore
			 * mechanisms' own scan, which is real work, and a book in which
			 * nobody has linked an entry to anything can never produce a hop —
			 * which is every book until somebody draws a road. The read that
			 * answers that is one indexed query, so the common install pays a
			 * query rather than a scan.
			 *
			 * ⚠ **Before the no-graph return, not after.** A book of places
			 * with no cast at all reads `null` from the cast traversal — there
			 * is no speaker node to walk from — and a hop that lived behind
			 * that return would be unreachable in exactly the book it was
			 * written for.
			 */
			const linked = links?.length
				? linkedRows(links, await chosenEntryIds(input, ctx))
				: []

			// `null` and `[]` are different answers and the receipt says which:
			// one is "this session has no graph to read", the other is "it has
			// one and it holds nothing about this speaker".
			if (!rows && linked.length === 0)
				return ok({
					main: [],
					hits: [],
					diagnostics: {
						considered: 0,
						matched: 0,
						present: 0,
						linked: 0,
						linkedEntries: [],
						relationships:
							"no narrative graph for this session, or the speaker has no node in it"
					}
				})

			const ranked = rankRelationships(rows ?? [])

			/**
			 * ⚠ **A band strictly under the direct one, derived rather than
			 * constant.** `rankRelationships` scores in `(0, 1]` and its floor
			 * moves with how many ties it ranked — recency alone is
			 * `0.1 / count` — so a constant "just below" would sit *above* the
			 * floor of a large graph. Dividing under the observed floor keeps
			 * every hop below every direct hit whatever the graph's size, and
			 * keeps the hops in their own order.
			 */
			const directFloor = ranked.length
				? Math.min(...ranked.map((r) => r.score))
				: 1
			const linkedRanked = linked.map((row, i) => ({
				...row,
				score:
					(directFloor * (linked.length - i)) / (linked.length + 1),
				via: "link" as const
			}))

			// One ceiling over both, so a hop competes for the same room rather
			// than spending a second allowance nobody set.
			const kept: Array<
				(typeof ranked)[number] | (typeof linkedRanked)[number]
			> = capRanked([...ranked, ...linkedRanked], maxEntries)

			const candidates = kept.map((row, position) => {
				if ("via" in row) {
					const content = JSON.stringify({
						with: row.from,
						...row.entry
					})
					return {
						id: row.id,
						source: "relationships",
						tokens: ctx.countTokens(content),
						signals: {},
						presetScore: row.score,
						position,
						payload: {
							id: row.id,
							name: row.name,
							content,
							/**
							 * ⚠ **No `lane`, and that is deliberate.** The
							 * three lanes are claims about the *speaker* — what
							 * they think of others, what others think of them,
							 * who the world has heard of — and a road between
							 * two places is none of them. Filing a hop under
							 * one would render it as a claim about the speaker,
							 * which is worse than not rendering it at all: the
							 * sections `relationshipSections` builds are keyed
							 * on lane, so a hop reaches the receipt and the
							 * budget and stops there until a section it belongs
							 * in exists.
							 */
							entry: row.entry,
							/** Which chosen entry the hop was reached from. */
							linkedFrom: row.from,
							foundBy: "relationships",
							via: "link"
						}
					}
				}
				const content = contentOf(row)
				return {
					id: row.id,
					source: "relationships",
					tokens: ctx.countTokens(content),
					/**
					 * ⚠ Empty, and not an oversight. Every signal the ranker
					 * knows how to weigh is a question about a lorebook entry —
					 * did its keys fire, does its title occur, is it about what
					 * is being said — and a graph edge answers none of them.
					 * Writing a signal here to look complete would give the
					 * band a number weighted at 0 and say nothing true.
					 */
					signals: {},
					presetScore: row.score,
					// `select` breaks a score tie on this, and this node has
					// already decided the order, so it hands over its own.
					position,
					payload: {
						id: row.id,
						name: row.name,
						content,
						lane: row.lane,
						...(row.counterpart
							? { counterpart: row.counterpart }
							: {}),
						/**
						 * The tie as a structure, beside the same tie as text.
						 *
						 * Two things rather than one spelling of it: `content`
						 * is what the budget COUNTED, and this is what the
						 * prompt's relationship sections are rebuilt from —
						 * keyed, grouped and laid out by the variable the
						 * template asks for. Parsing `content` back would make
						 * the render depend on a stringification staying
						 * reversible, which is a promise this module would then
						 * owe forever.
						 */
						entry: row.entry,
						...(row.figure ? { figure: row.figure } : {}),
						/**
						 * What the explanation panel keys its rank reasons off
						 * — the same field `entity-search` marks its own hits
						 * with, for the same purpose: a `presetScore` with no
						 * account of where it came from renders as a bare
						 * number, which is the one thing that panel exists not
						 * to do.
						 */
						foundBy: "relationships",
						rank: row.rank
					}
				}
			})

			const direct = kept.filter(
				(r): r is (typeof ranked)[number] => !("via" in r)
			)
			const hops = kept.filter(
				(r): r is (typeof linkedRanked)[number] => "via" in r
			)
			const present = direct.filter((r) => r.present).length
			const lanes = direct.reduce<Record<string, number>>((acc, r) => {
				acc[LANE_LABELS[r.lane]] = (acc[LANE_LABELS[r.lane]] ?? 0) + 1
				return acc
			}, {})

			return ok({
				main: candidates,
				hits: candidates,
				diagnostics: {
					considered: (rows?.length ?? 0) + linked.length,
					matched: candidates.length,
					present,
					maxEntries,
					lanes,
					/**
					 * The hop, named where a person reads it. A count alone
					 * cannot be checked against anything, so the endpoints it
					 * brought in are listed beside it.
					 */
					linked: hops.length,
					linkedEntries: hops.map((r) => r.name),
					/**
					 * The mechanism-level sentence, in the shape
					 * `explainRetrieval` reads the vector mechanism's and the
					 * entity-link mechanism's: one that produced less than it
					 * walked has to say why where a person reads it, or a
					 * ceiling is indistinguishable from an empty graph.
					 */
					relationships:
						candidates.length === 0 && maxEntries === 0
							? "off — the ceiling is 0, so the graph is left out"
							: `${direct.length} of ${rows?.length ?? 0} ties ranked, ` +
								`${present} with someone in the cast` +
								(hops.length
									? `, ${hops.length} reached through a link`
									: "")
				}
			})
		}
	}
}
