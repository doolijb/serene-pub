/**
 * The retrieval explanation's projection (design §9, plan Part 6).
 *
 * Pure, so it is asserted against a hand-written receipt rather than a run: the
 * whole point of `explainRetrieval` taking its entries as an argument is that
 * "what does this receipt mean" can be tested without a database.
 *
 * What is pinned here is the part that would regress silently. A projection
 * that quietly stopped naming keys, folded the vector mechanism's `historyEntry` onto
 * nothing, or dropped the two pin warnings would still render a full-looking
 * panel — and the panel is the only thing anybody reads. Every assertion below
 * is a sentence a user would otherwise never see.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("$lib/server/db", () => ({
	db: {},
	getCryptoSecretKey: () => "retrieval-explain-test-secret"
}))

const entry = (
	id: number,
	typeId: string,
	title: string,
	keys: string[] = [],
	extra: { constant?: boolean; enabled?: boolean } = {}
) => ({
	id,
	typeId,
	title,
	keys,
	constant: extra.constant ?? false,
	enabled: extra.enabled ?? true
})

/** The three declared types, keyed the way the projection looks them up. */
const ENTRIES = new Map<string, any>([
	[
		"worldLore:1",
		entry(1, "core:entry/world-lore", "The Ashguard", [
			"ashguard",
			"gate",
			"silverwood"
		])
	],
	["worldLore:2", entry(2, "core:entry/world-lore", "The Silver Road", ["road"])],
	[
		"worldLore:3",
		entry(3, "core:entry/world-lore", "The Oath", ["oath"], {
			constant: true
		})
	],
	["worldLore:4", entry(4, "core:entry/world-lore", "A Disabled Note", [], {
		enabled: false
	})],
	["history:7", entry(7, "core:entry/history", "The Siege", ["siege"])]
])

const decision = (over: Record<string, any> = {}) => ({
	candidate: {
		id: 1,
		source: "worldLore",
		tokens: 120,
		signals: { keyword: 2 / 3 },
		priority: 1,
		payload: { name: "The Ashguard", content: "A wall of grey stone." },
		...(over.candidate ?? {})
	},
	score: 0.67,
	reason: "filled_scored",
	included: true,
	why: "scored 0.670, 120 tokens",
	...Object.fromEntries(
		Object.entries(over).filter(([k]) => k !== "candidate")
	)
})

const receipt = (over: Record<string, any> = {}) => ({
	nodes: [
		{
			nodeKey: "lore-world",
			seq: 1,
			output: {
				hits: [{ id: 1, source: "worldLore" }],
				skipped: [
					{
						id: 2,
						source: "worldLore",
						reason: "no key matched in the last 10 messages"
					}
				],
				diagnostics: {
					scanDepth: 10,
					recursionDepth: 1,
					windowChars: 400,
					considered: 4,
					matched: 1,
					admitThreshold: 0.4,
					admittedByEvidence: 1,
					vectorSearch: "unavailable (no embedding model)"
				}
			}
		},
		{
			nodeKey: "vector",
			seq: 2,
			output: {
				// The index vocabulary, which is NOT the budget vocabulary.
				skipped: [
					{
						id: 7,
						source: "historyEntry",
						// ⚠ Was "handled by the keyword scan" — the vector
						// mechanism's per-entry `retrieval_strategy` decline, which
						// migration 0204 removed along with the column. This is
						// the reason it can still emit: visibility, its one
						// remaining exclusion. The case under test is the
						// *spelling* fold, not the sentence.
						reason: "not visible to the current speaker"
					}
				],
				diagnostics: {
					vectorSearch: "available (nomic-embed-text)",
					queries: 2,
					considered: 30,
					matched: 4,
					truncated: [{ source: "message", fetched: 2000, available: 5400 }]
				}
			}
		},
		{
			nodeKey: "merge",
			seq: 3,
			output: {
				diagnostics: {
					disjoint: true,
					warning: "Wire core:task/concat-candidates@1 instead."
				}
			}
		},
		{
			nodeKey: "rank",
			seq: 4,
			output: {
				decisions: [decision()],
				groups: {
					worldLore: {
						allocated: 500,
						used: 120,
						entries: 1,
						cap: 8
					}
				}
			}
		}
	],
	...over
})

/**
 * The shape a real session with one lorebook of two entries produces: one band
 * that scanned something, two that had nothing in scope, and three mechanisms
 * that could not run. Named rather than folded into `receipt()` because the
 * whole assertion is the *list*, in order, whole.
 */
const barrenSession = () => ({
	nodes: [
		{
			nodeKey: "gather.worldLore.read",
			seq: 1,
			output: {
				hits: [{ id: 1, source: "worldLore" }],
				diagnostics: {
					scanDepth: 10,
					considered: 2,
					matched: 1,
					entities: ["ashguard"],
					vectorSearch: "no embedding model is loaded and validated"
				}
			}
		},
		{
			nodeKey: "gather.characterLore.read",
			seq: 2,
			output: {
				diagnostics: {
					scanDepth: 10,
					considered: 0,
					matched: 0,
					entities: ["ashguard"]
				}
			}
		},
		{
			nodeKey: "gather.historyEntries.read",
			seq: 3,
			output: {
				diagnostics: {
					scanDepth: 10,
					considered: 0,
					matched: 0,
					entities: ["ashguard"]
				}
			}
		},
		{
			nodeKey: "semantic.arm.search",
			seq: 4,
			output: {
				diagnostics: {
					vectorSearch: "off — no entries requested (maxEntries is 0)"
				}
			}
		},
		{
			nodeKey: "names.arm.link",
			seq: 5,
			output: {
				diagnostics: {
					entityLink:
						"nothing to link — no descriptions were found in the " +
						"window, or the mention scan is switched off"
				}
			}
		}
	]
})

async function explain(
	r: any,
	entries = ENTRIES,
	opts: { limit?: number; entriesRead?: boolean } = {}
) {
	const { explainRetrieval } = await import("./pipelines")
	return explainRetrieval(r, entries as any, opts)
}

describe("explainRetrieval — content vocabulary before numbers", () => {
	it("names the keys that matched rather than reporting a signal value", async () => {
		const out = await explain(receipt())
		const row = out.rows.find((r) => r.key.endsWith("worldLore:1"))!
		expect(row.title).toBe("The Ashguard")
		expect(row.verdict).toBe(
			"Included — matched 2 of its 3 keys (ashguard, gate, silverwood)."
		)
		// The number is present, and it is the SECOND level.
		expect(row.criteria[0].label).toBe("Its keys")
		expect(row.criteria[0].value).toBeCloseTo(2 / 3, 5)
		expect(row.verdict).not.toMatch(/0\.6/)
	})

	it("names a single key exactly, because it can", async () => {
		const out = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "rank",
						seq: 1,
						output: {
							decisions: [
								decision({
									candidate: {
										id: 2,
										source: "worldLore",
										tokens: 20,
										signals: { keyword: 1 },
										payload: { name: "The Silver Road" }
									}
								})
							],
							groups: {}
						}
					}
				]
			})
		)
		expect(out.rows[0].criteria[0].detail).toBe(
			"matched “road” in the scanned messages"
		)
	})

	it("carries the engine's own arithmetic on the second level only", async () => {
		const out = await explain(receipt())
		const row = out.rows[0]
		expect(row.why).toContain("scored 0.670, 120 tokens")
		expect(row.reason).toBe("filled_scored")
		expect(row.score).toBeCloseTo(0.67, 5)
		// The score is in `why` once, inside the engine's own sentence — not a
		// second time as a bare "score 0.670" the reason's own prose already
		// states.
		expect(row.why).toHaveLength(1)
		expect(row.why!.join(" ")).not.toMatch(/score 0\.670(?!,)/)
	})

	it("does not repeat a criterion's number: the column carries the figure once", async () => {
		const out = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "rank",
						seq: 1,
						output: {
							decisions: [
								decision({
									candidate: {
										id: 2,
										source: "worldLore",
										tokens: 20,
										signals: { tfidf: 0.27, lastRefRecency: 0.98 },
										payload: { name: "The Silver Road" }
									}
								})
							],
							groups: {}
						}
					}
				]
			})
		)
		const criteria = out.rows[0].criteria
		const tfidf = criteria.find((c) => c.label === "Uncommon words in common")!
		const lastRef = criteria.find((c) => c.label === "Last referred to")!
		expect(tfidf.detail).toBe("wording the rest of the lorebook does not share")
		expect(tfidf.detail).not.toMatch(/0\.27/)
		expect(tfidf.value).toBeCloseTo(0.27, 5)
		expect(lastRef.detail).toBe("came up recently in the conversation")
		expect(lastRef.detail).not.toMatch(/0\.98/)
		expect(lastRef.value).toBeCloseTo(0.98, 5)
	})

	it("still lists the matched keys in the keyword criterion's own parenthetical", async () => {
		// Unlike tfidf/lastRefRecency, "Its keys" names content (which keys hit),
		// not a score — that parenthetical is not the defect and stays.
		const out = await explain(receipt())
		const row = out.rows.find((r) => r.key.endsWith("worldLore:1"))!
		expect(row.criteria[0].detail).toBe(
			"matched 2 of its 3 keys (ashguard, gate, silverwood)"
		)
	})

	/**
	 * ⚠ Two signals the engine computed and this panel could not name.
	 *
	 * `RETRIEVAL_CRITERION_ORDER` is the *filter* the criterion loop reads, not
	 * an ordering over everything available, so a signal missing from it renders
	 * nowhere at all — `retrievalCriterion`'s `default:` branch is unreachable
	 * from that loop and cannot catch it. `proximity` is computed on every scan
	 * and `signals.semantic` on every vector hit; both are declared, writable
	 * weights (`signalProximity`, `signalSemantic`) that `score()` multiplies
	 * in. A reader who raised either got no line saying it had done anything.
	 */
	it("names the proximity and semantic signals it scores by", async () => {
		const out = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "rank",
						seq: 1,
						output: {
							decisions: [
								decision({
									candidate: {
										id: 1,
										source: "worldLore",
										tokens: 20,
										signals: {
											keyword: 1,
											proximity: 0.61,
											semantic: 0.72
										},
										payload: { name: "The Ashguard" }
									}
								})
							],
							groups: {}
						}
					}
				]
			})
		)
		const criteria = out.rows[0].criteria
		const near = criteria.find(
			(c) => c.label === "Its keywords, close together"
		)!
		const meaning = criteria.find((c) => c.label === "Similar in meaning")!
		expect(near.detail).toBe(
			"two or more of its keywords matched near each other rather than scattered across the scanned messages"
		)
		expect(near.detail).not.toMatch(/0\.61/)
		expect(near.value).toBeCloseTo(0.61, 5)
		expect(meaning.detail).toBe(
			"it is about what the conversation is about, without needing a word in common"
		)
		expect(meaning.detail).not.toMatch(/0\.72/)
		expect(meaning.value).toBeCloseTo(0.72, 5)
		// Proximity qualifies the key match, so it reads directly after it
		// rather than among the structural criteria at the end.
		expect(criteria.map((c) => c.label).slice(0, 2)).toEqual([
			"Its keys",
			"Its keywords, close together"
		])
	})

	/**
	 * ⚠ The panel said the opposite of what happened.
	 *
	 * `core:query/vector-search@1` writes its cosine to `signals.semantic` and
	 * deliberately stamps **no** `presetScore` — one there would make every
	 * signal weight inert — so a candidate only the vector mechanism found had
	 * no keyword, no name match and no preset, fell through every branch of
	 * `retrievalMarker`, and was labelled *No signal*.
	 */
	it("marks a hit only the vector mechanism found as a similarity, not as no signal", async () => {
		const out = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "rank",
						seq: 1,
						output: {
							decisions: [
								decision({
									candidate: {
										id: 2,
										source: "worldLore",
										tokens: 20,
										signals: { semantic: 0.72 },
										payload: {
											name: "The Silver Road",
											foundBy: "vector-search"
										}
									}
								})
							],
							groups: {}
						}
					}
				]
			})
		)
		expect(out.rows[0].marker).toBe("Similarity")
		expect(out.rows[0].markerKind).toBe("semantic")
	})

	it("names the mention the entity-vector mechanism linked, not just its score", async () => {
		// The fourth mechanism links a conversational mention to one of the entry's
		// names by meaning — "the captain" to "Captain Vell" — and `linkNote`
		// already wrote that sentence onto the candidate's payload. The
		// criterion repeats that sentence rather than reporting a bare score.
		const out = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "rank",
						seq: 1,
						output: {
							decisions: [
								decision({
									candidate: {
										id: 2,
										source: "worldLore",
										tokens: 20,
										signals: { entityVector: 0.83 },
										payload: {
											name: "The Silver Road",
											entityLinks: [
												"matched “the captain” → Captain Vell"
											]
										}
									}
								})
							],
							groups: {}
						}
					}
				]
			})
		)
		const criterion = out.rows[0].criteria.find(
			(c) => c.label === "A name it's called by, in the scene"
		)!
		expect(criterion.detail).toBe(
			"matched “the captain” → Captain Vell"
		)
		expect(criterion.detail).not.toMatch(/0\.83/)
		expect(criterion.value).toBeCloseTo(0.83, 5)
	})
})

describe("explainRetrieval — every explanation carries an action", () => {
	it("attaches the two real levers, at their current values", async () => {
		const out = await explain(receipt())
		const row = out.rows[0]
		expect(row.entry).toEqual({
			id: 1,
			typeId: "core:entry/world-lore",
			constant: false,
			enabled: true,
			keys: ["ashguard", "gate", "silverwood"]
		})
	})

	it("heads a history row with its date when nothing else names it", async () => {
		// The candidate payload IS the lore row, so the date is there even when
		// the entry read found nothing — and `#12` is the worst possible name
		// for the one declared type that has no title.
		const out = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "rank",
						seq: 1,
						output: {
							decisions: [
								decision({
									candidate: {
										id: 12,
										source: "history",
										tokens: 30,
										signals: {},
										payload: {
											name: null,
											year: 412,
											month: 3,
											content: "It lasted a winter."
										}
									}
								})
							],
							groups: {}
						}
					}
				]
			}),
			new Map()
		)
		expect(out.rows[0].title).toBe("Year 412, Mo. 3")
	})

	it("offers no lever for a candidate with no entry behind it", async () => {
		const out = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "rank",
						seq: 1,
						output: {
							decisions: [
								decision({
									candidate: {
										id: 99,
										source: "messages",
										tokens: 10,
										signals: {},
										payload: { content: "Well met." }
									}
								})
							],
							groups: {}
						}
					}
				]
			})
		)
		// A message has neither `constant` nor `enabled`; inventing a lever for
		// it would be inventing schema.
		expect(out.rows[0].entry).toBeUndefined()
	})
})

describe("explainRetrieval — the reasons a row would otherwise be lost in", () => {
	const withDecisions = (decisions: any[], groups: any = {}) =>
		receipt({
			nodes: [
				{ nodeKey: "rank", seq: 1, output: { decisions, groups } }
			]
		})

	it("says both halves for a pin that was dropped, and warns as well", async () => {
		const out = await explain(
			withDecisions([
				decision({
					candidate: {
						id: 3,
						source: "worldLore",
						tokens: 9000,
						signals: {},
						pinned: true,
						payload: { name: "The Oath" }
					},
					reason: "excluded_pinned_token_limit",
					included: false,
					score: 0,
					why: "pinned, but 9000 tokens does not fit"
				})
			])
		)
		const row = out.rows[0]
		expect(row.marker).toBe("Always include")
		expect(row.verdict).toBe(
			"Marked always-include, and still left out: it does not fit the context window."
		)
		// `renderSelection`'s argument, honoured: one row among hundreds is not
		// findable, so the drop is also stated where it cannot be missed.
		expect(out.warnings.join(" ")).toMatch(
			/1 entry marked always-include did not fit the context window \(World lore\)/
		)
	})

	it("warns about a zero-share group, which no band row can show", async () => {
		const out = await explain(
			withDecisions([
				decision({
					candidate: {
						id: 3,
						source: "worldLore",
						tokens: 10,
						signals: {},
						pinned: true,
						payload: { name: "The Oath" }
					},
					reason: "excluded_pinned_group_disabled",
					included: false,
					score: 0,
					why: "worldLore has a zero share"
				})
			])
		)
		expect(out.warnings.join(" ")).toMatch(/share is zero/)
	})

	it("warns about a source no budget group owns", async () => {
		const out = await explain(
			withDecisions([
				decision({
					candidate: {
						id: 5,
						source: "narrativeNode",
						tokens: 10,
						signals: {},
						payload: {}
					},
					reason: "excluded_unknown_source",
					included: false,
					score: 0,
					why: "narrativeNode has no budget group"
				})
			])
		)
		expect(out.rows[0].verdict).toMatch(
			/nothing budgets for “narrativeNode”/
		)
		expect(out.warnings.join(" ")).toMatch(/no budget group/)
	})

	it("names the entry cap when the band knows it", async () => {
		const out = await explain(
			withDecisions(
				[
					decision({
						candidate: {
							id: 2,
							source: "worldLore",
							tokens: 10,
							signals: {},
							payload: { name: "The Silver Road" }
						},
						reason: "excluded_budget",
						included: false,
						score: 0,
						why: "worldLore already has its maximum of 8 entries"
					})
				],
				{
					worldLore: {
						allocated: 500,
						used: 500,
						entries: 8,
						cap: 8
					}
				}
			)
		)
		expect(out.rows[0].verdict).toBe(
			"Left out — World lore was already holding its maximum of 8 entries."
		)
		expect(out.bands[0].dropped).toBe(1)
	})
})

describe("explainRetrieval — what never reached the ranker", () => {
	it("is its own outcome, with the mechanism's own sentence", async () => {
		const out = await explain(receipt())
		const row = out.rows.find((r) => r.key === "skip:worldLore:2")!
		expect(row.outcome).toBe("skipped")
		expect(row.title).toBe("The Silver Road")
		expect(row.verdict).toBe(
			"Never reached the ranker — no key matched in the last 10 messages."
		)
	})

	it("does not report a decline for an entry another mechanism's ranker judged", async () => {
		// The mechanisms are independent and both run on every turn, so an entry the
		// keyword scan never matched is routinely one the vector mechanism finds and
		// the ranker then judges. Rendering both would put "never reached the
		// ranker" beside the row saying what the ranker decided.
		//
		// ⚠ The reason used to read "set to rag, handled by vector search" —
		// the keyword mechanism's own strategy decline, gone with the column in
		// migration 0204. An ordinary miss is what produces this case now, and
		// it produces it more often than the decline ever did.
		const out = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "lore-world",
						seq: 1,
						output: {
							skipped: [
								{
									id: 1,
									source: "worldLore",
									reason: "no key matched in the last 10 messages"
								}
							]
						}
					},
					{
						nodeKey: "rank",
						seq: 2,
						output: { decisions: [decision()], groups: {} }
					}
				]
			})
		)
		expect(out.rows).toHaveLength(1)
		expect(out.rows[0].outcome).toBe("included")
	})

	it("folds the vector mechanism's index spelling onto the budget group", async () => {
		const out = await explain(receipt())
		// `historyEntry:7` in the receipt, `history:7` on screen — otherwise the
		// entry renders nameless beside its own decision.
		const row = out.rows.find((r) => r.key === "skip:history:7")!
		expect(row.sourceLabel).toBe("History")
		expect(row.title).toBe("The Siege")
	})
})

describe("explainRetrieval — the mechanism-level half no row can carry", () => {
	it("reports scan depth, the admission gate and vector availability", async () => {
		const out = await explain(receipt())
		const notes = out.notes.join("\n")
		expect(notes).toMatch(
			/World lore: 1 of 4 entries matched, scanning the last 10 messages, 1 level\(s\)/
		)
		expect(notes).toMatch(/admitted on relevance alone, at a threshold of 0\.40/)
		expect(notes).toMatch(/Vector search: unavailable \(no embedding model\)/)
		expect(notes).toMatch(/Vector search: available \(nomic-embed-text\)/)
	})

	/**
	 * ⚠ **A mechanism that cannot run has to say so where a person reads it.**
	 *
	 * The governing rule lets an unavailable mechanism subtract a signal, and
	 * the whole difference between *degrading* and *disappearing* is whether the
	 * receipt names it. `vectorSearch` has had a line since the lore gather branches
	 * carried it; the entity-vector mechanism recorded `entityLink` in its diagnostics
	 * and this projection rendered nothing for it, so "no embedding model",
	 * "switched off" and "found no link" were one silence with three causes.
	 *
	 * This is also what replaced `retrievalMode` (migration 0203): the control
	 * existed so an install without an embedding model could turn a mechanism off in
	 * bulk, and a receipt that names the absence is a better answer than a
	 * picker, because it says which screen to go to.
	 */
	it("names a mechanism that skipped, whichever way it could not run", async () => {
		const out = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "names.arm.link",
						seq: 1,
						output: {
							diagnostics: {
								maxLinks: 5,
								mentions: 2,
								linked: 0,
								entityLink:
									"nothing was embedded — no embedding model is loaded, or embedding is switched off"
							}
						}
					}
				]
			})
		)
		expect(out.notes.join("\n")).toContain(
			"Entity links: nothing was embedded — no embedding model is " +
				"loaded, or embedding is switched off."
		)
	})

	it("files the entity mechanism's line under the mechanism, not under whoever it enriched", async () => {
		// ⚠ This node returns the **whole candidate pool** with a signal
		// attached, so its first `main` row belongs to some other gather branch —
		// `nodeSource` would file a working turn's note under "World lore" and a
		// silent turn's under the node key. The prefix is fixed for that reason.
		const out = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "names.arm.link",
						seq: 1,
						output: {
							main: [{ id: 1, source: "worldLore" }],
							diagnostics: {
								entityLink: "available (nomic-embed-text)",
								linked: 1
							}
						}
					}
				]
			})
		)
		const notes = out.notes.join("\n")
		expect(notes).toContain("Entity links: available (nomic-embed-text).")
		expect(notes).not.toMatch(/World lore: available/)
	})

	/**
	 * Eager indexing has to be visible, for the same reason and one layer down.
	 *
	 * A query node that finds its scope un-indexed promotes those rows to the
	 * front of the background queue and waits for them. That is the only reason
	 * some turns are visibly slower than others, and the only reason a search
	 * sometimes covers less than the scope it named — and neither is inferable
	 * from the results, because a bound that bound and a scope that was fully
	 * covered produce the same shaped answer.
	 */
	it("says what a turn indexed before it searched", async () => {
		const out = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "semantic.arm.search",
						seq: 1,
						output: {
							diagnostics: {
								indexing:
									"indexed 12 missing vectors before searching"
							}
						}
					}
				]
			})
		)
		expect(out.notes.join("\n")).toContain(
			"Indexing: indexed 12 missing vectors before searching."
		)
	})

	it("says when the bound bound, and when nothing could be indexed at all", async () => {
		const bounded = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "semantic.arm.search",
						seq: 1,
						output: {
							diagnostics: {
								indexing:
									"indexed 25 of 60 missing vectors before searching — " +
									"bounded — 25 items indexed before the scope was covered; " +
									"the rest stay queued"
							}
						}
					}
				]
			})
		)
		expect(bounded.notes.join("\n")).toContain("the rest stay queued")

		const blocked = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "gather.entities.read",
						seq: 1,
						output: {
							diagnostics: {
								entityIndexing:
									"9 entry names were missing and none were indexed — " +
									"off — the annotation lane is switched off"
							}
						}
					}
				]
			})
		)
		// The mechanism degrading and the mechanism having nothing to do must not read the
		// same on the receipt.
		expect(blocked.notes.join("\n")).toContain(
			"Indexing: 9 entry names were missing and none were indexed"
		)
	})

	it("raises a wiring warning rather than burying it in diagnostics", async () => {
		const out = await explain(receipt())
		expect(out.warnings).toContain(
			"Wire core:task/concat-candidates@1 instead."
		)
		expect(out.warnings.join(" ")).toMatch(
			/could not read Messages \(the newest 2000 of 5400\) whole/
		)
	})

	/**
	 * ⚠ **A mechanism that had nothing to scan is not news.**
	 *
	 * The same rule the notes exist to serve, turned on the notes themselves.
	 * A session with one lorebook of two entries produced *nine* lines, and six
	 * of them said nothing: two bands with an empty scope each got their own
	 * "0 of 0 entries matched" and their own copy of the scene's entity list,
	 * which is one fact about the window rather than one fact per band. The
	 * lines a reader actually needed — what matched, what the scene named, and
	 * the three mechanisms that could not run — were the minority of their own
	 * report.
	 *
	 * So: content first. A band with nothing in scope contributes no line of
	 * its own and is folded into one sentence at the end, the scene is named
	 * once, and **every line that says why something did not happen stays** —
	 * those are the "an unavailable mechanism subtracts a signal" honesty and
	 * are the whole reason this half of the panel exists.
	 */
	it("folds the bands with nothing in scope into one sentence and names the scene once", async () => {
		const out = await explain(barrenSession())
		// Nine lines before this, six after, and the three that survive the
		// fold are the three that name a reason something did not happen.
		expect(out.notes).toEqual([
			"World lore: 1 of 2 entries matched, scanning the last 10 messages.",
			"The scene named ashguard.",
			"Vector search: no embedding model is loaded and validated.",
			"Vector search: off — no entries requested (maxEntries is 0).",
			"Entity links: nothing to link — no descriptions were found in " +
				"the window, or the mention scan is switched off.",
			"Character lore and history entries: nothing to scan."
		])
	})

	it("says one empty band in the singular", async () => {
		const out = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "gather.characterLore.read",
						seq: 1,
						output: {
							diagnostics: {
								scanDepth: 10,
								considered: 0,
								matched: 0
							}
						}
					}
				]
			})
		)
		expect(out.notes).toEqual(["Character lore: nothing to scan."])
	})

	it("names an empty gather branch in English, not by its dotted node key", async () => {
		// An empty scan's output has no `hits`/`main`/`skipped` entry for
		// `nodeSource` to read a source from, so the note falls back to the
		// node's own key — `gather.characterLore.read` and
		// `gather.historyEntries.read` are addresses, not sentences.
		const out = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "gather.characterLore.read",
						seq: 1,
						output: {
							diagnostics: { scanDepth: 10, considered: 0, matched: 0 }
						}
					},
					{
						nodeKey: "gather.historyEntries.read",
						seq: 2,
						output: {
							diagnostics: { scanDepth: 10, considered: 0, matched: 0 }
						}
					}
				]
			})
		)
		const notes = out.notes.join("\n")
		// Both branches are in scope of the fold above, so the assertion is
		// that they are named in English *there* — the naming is what this
		// test is about, and it survives the sentence they are named in.
		expect(notes).toContain(
			"Character lore and history entries: nothing to scan."
		)
		expect(notes).not.toMatch(/gather\./)
	})

	it("humanizes a gather branch it does not have an explicit label for", async () => {
		const out = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "gather.somethingNew.read",
						seq: 1,
						output: {
							diagnostics: { scanDepth: 10, considered: 0, matched: 0 }
						}
					}
				]
			})
		)
		expect(out.notes.join("\n")).toContain("Something New: nothing to scan.")
	})

	it("says a run recorded no ranking instead of rendering an empty list", async () => {
		const out = await explain({ nodes: [] })
		expect(out.ranked).toBe(false)
		expect(out.rows).toEqual([])
	})

	it("caps the row list and says how many it dropped", async () => {
		const many = Array.from({ length: 5 }, (_, i) =>
			decision({ candidate: { id: i + 1, source: "worldLore" } })
		)
		const out = await explain(
			receipt({
				nodes: [
					{ nodeKey: "rank", seq: 1, output: { decisions: many, groups: {} } }
				]
			}),
			ENTRIES,
			{ limit: 2 }
		)
		expect(out.rows).toHaveLength(2)
		expect(out.omitted).toBe(3)
	})
})

describe("explainRetrieval — the medal says how it got here", () => {
	it("marks fused candidates as found by both mechanisms", async () => {
		const out = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "rank",
						seq: 1,
						output: {
							decisions: [
								decision({
									candidate: {
										id: 1,
										source: "worldLore",
										tokens: 10,
										signals: {},
										presetScore: 0.033,
										payload: {
											name: "The Ashguard",
											foundBy: ["arm0#3", "arm1#1"]
										}
									}
								})
							],
							groups: {}
						}
					}
				]
			})
		)
		expect(out.rows[0].marker).toBe("Both arms")
		expect(out.rows[0].criteria[0].detail).toBe(
			"ranked 3rd and 1st by the arms that found it"
		)
		// A fused score is not a weighted sum, so no criterion pretends to a
		// contribution.
		expect(out.rows[0].criteria[0].value).toBeUndefined()
	})

	it("marks the entity mechanism's hits by what they shared", async () => {
		const out = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "rank",
						seq: 1,
						output: {
							decisions: [
								decision({
									candidate: {
										id: 1,
										source: "worldLore",
										tokens: 10,
										signals: { entityCooccurrence: 1 },
										presetScore: 0.5,
										payload: {
											name: "The Ashguard",
											foundBy: "entity-search",
											sharedEntities: ["ashguard", "gate"]
										}
									}
								})
							],
							groups: {}
						}
					}
				]
			})
		)
		expect(out.rows[0].marker).toBe("Shared entity")
		expect(
			out.rows[0].criteria.map((c) => c.detail).join(" | ")
		).toMatch(/ashguard, gate/)
	})

	it("marks a constant entry as the user's own instruction", async () => {
		const out = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "rank",
						seq: 1,
						output: {
							decisions: [
								decision({
									candidate: {
										id: 3,
										source: "worldLore",
										tokens: 10,
										signals: {},
										pinned: true,
										payload: { name: "The Oath" }
									},
									reason: "reserved",
									why: "constant entry"
								})
							],
							groups: {}
						}
					}
				]
			})
		)
		expect(out.rows[0].markerKind).toBe("pinned")
		expect(out.rows[0].verdict).toMatch(/retrieval is bypassed for it/)
	})
})

/**
 * The durability half — plan Part 6, and the defect it closes.
 *
 * A receipt keeps decisions and never content, so the panel reads the entry
 * rows live to put a title and keys beside a score. Rename an entry after its
 * run and it rendered the new title against the old decision with nothing
 * saying so: a composite that never existed, presented as a record. Each
 * candidate now carries `entrySourceHash` over the title, keys and content it
 * was scored with, and the projection compares that against the row as it is.
 *
 * ⚠ The hash is **not** recomputed here from a fixture's fields — that would
 * test the projection against itself. `entrySourceHash` is imported and run on
 * both sides, exactly as the run and the socket do, so a recipe that stopped
 * covering one of the three fields fails these rather than agreeing with
 * itself about a narrower one.
 */
describe("explainRetrieval — the entry behind the decision, dated", () => {
	/** The stored row a run would have scored, and its live twin. */
	const STORED = {
		title: "The Ashguard",
		keys: ["ashguard", "gate", "silverwood"],
		content: "A wall of grey stone."
	}

	async function sourceHash(row: {
		title?: string | null
		keys?: string[] | string | null
		content?: string | null
	}) {
		const { entrySourceHash } = await import("$lib/server/annotations")
		return entrySourceHash(row)
	}

	/** The live entry map, with a fingerprint over whatever it now says. */
	async function liveEntries(
		row: Partial<typeof STORED> & { deleted?: boolean } = {}
	) {
		const live = { ...STORED, ...row }
		const map = new Map(ENTRIES)
		if (row.deleted) map.delete("worldLore:1")
		else
			map.set("worldLore:1", {
				...entry(1, "core:entry/world-lore", live.title, live.keys),
				fingerprint: await sourceHash(live)
			})
		return map
	}

	/** A receipt whose one candidate was scored against the stored row. */
	async function scoredReceipt(over: Record<string, any> = {}) {
		return receipt({
			nodes: [
				{
					nodeKey: "rank",
					seq: 1,
					output: {
						decisions: [
							decision({
								candidate: {
									id: 1,
									source: "worldLore",
									tokens: 120,
									signals: { keyword: 2 / 3 },
									payload: {
										name: STORED.title,
										content: STORED.content,
										fingerprint: await sourceHash(STORED)
									}
								}
							})
						],
						groups: {}
					}
				}
			],
			...over
		})
	}

	it("says nothing at all about a run whose entry is untouched", async () => {
		const out = await explain(
			await scoredReceipt(),
			await liveEntries(),
			{ entriesRead: true }
		)
		expect(out.rows[0].provenance).toBe("unchanged")
		expect(out.rows[0].provenanceNote).toBeUndefined()
		expect(out.rows[0].currentTitle).toBeUndefined()
		// Level one is unchanged from what it always was.
		expect(out.rows[0].title).toBe("The Ashguard")
	})

	it("heads a changed row with the recorded title and offers the live one as a reference", async () => {
		const out = await explain(
			await scoredReceipt(),
			await liveEntries({ title: "The Ashguard Gate" }),
			{ entriesRead: true }
		)
		const row = out.rows[0]
		expect(row.provenance).toBe("changed")
		// Content vocabulary, and a sentence rather than a number.
		expect(row.provenanceNote).toMatch(/edited since the run/i)
		expect(row.provenanceNote).not.toMatch(/\d/)
		// ⚠ The record heads the row; the live entry is clearly beside it.
		expect(row.title).toBe("The Ashguard")
		expect(row.currentTitle).toBe("The Ashguard Gate")
		// The decision itself is untouched by any of this.
		expect(row.outcome).toBe("included")
		expect(row.score).toBeCloseTo(0.67)
		// And the excerpt was always the recorded one.
		expect(row.excerpt).toBe("A wall of grey stone.")
	})

	it("says a deleted entry is gone and keeps the decision that named it", async () => {
		const out = await explain(
			await scoredReceipt(),
			await liveEntries({ deleted: true }),
			{ entriesRead: true }
		)
		const row = out.rows[0]
		expect(row.provenance).toBe("deleted")
		expect(row.provenanceNote).toMatch(
			/no longer in this session's lorebook/i
		)
		// The recorded title is the only one left, and it still heads the row.
		expect(row.title).toBe("The Ashguard")
		expect(row.currentTitle).toBeUndefined()
		expect(row.score).toBeCloseTo(0.67)
		// No live row means no levers — a toggle would write to nothing.
		expect(row.entry).toBeUndefined()
	})

	/**
	 * ⚠ **Perturbation, not assertion.** The requirement is that the
	 * fingerprint covers what was *scored* — keys, name and content — and the
	 * way to hold that is to move each of them independently and demand the
	 * projection notice. A recipe that hashed only `content` passes a
	 * hand-written "the hash differs" assertion and fails this.
	 */
	it.each([
		["its title", { title: "The Ashguard Gate" }],
		["one of its keys", { keys: ["ashguard", "portcullis", "silverwood"] }],
		["a key removed", { keys: ["ashguard", "gate"] }],
		["a key added", { keys: [...STORED.keys, "wall"] }],
		["its content", { content: "A wall of grey stone, and a gate." }]
	])(
		"reports a run as changed when %s moved",
		async (_what, perturbation) => {
			const out = await explain(
				await scoredReceipt(),
				await liveEntries(perturbation as any),
				{ entriesRead: true }
			)
			expect(out.rows[0].provenance).toBe("changed")
		}
	)

	it("claims nothing when the run recorded no fingerprint", async () => {
		// Every receipt written before this existed, and every mechanism that does
		// not carry one. Absence must not read as `unchanged`: the whole
		// defect is a panel presenting an unverified pairing as a verified
		// one, and a reassuring badge over an old receipt is that defect with
		// a new label.
		const out = await explain(
			receipt(),
			await liveEntries({ title: "Something Else Entirely" }),
			{ entriesRead: true }
		)
		expect(out.rows[0].provenance).toBeUndefined()
		expect(out.rows[0].provenanceNote).toBeUndefined()
	})

	it("does not call an entry deleted when the lorebook could not be read", async () => {
		// A run with no session, a deleted one, or a lorebook the asker no
		// longer owns all produce an empty map — which is also what a lorebook
		// that really lost every entry produces. Guessing turns "I could not
		// look" into "your lore is gone", on every row at once.
		const out = await explain(await scoredReceipt(), new Map() as any, {
			entriesRead: false
		})
		expect(out.rows[0].provenance).toBeUndefined()
		expect(out.rows[0].provenanceNote).toBeUndefined()
	})

	it("dates a skipped entry too, which is the row most often asked about", async () => {
		const fingerprint = await sourceHash(STORED)
		const out = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "lore-world",
						seq: 1,
						output: {
							skipped: [
								{
									id: 1,
									source: "worldLore",
									reason: "no key matched in the last 10 messages",
									fingerprint
								}
							]
						}
					}
				]
			}),
			await liveEntries({ keys: ["ashguard", "gate", "wall"] }),
			{ entriesRead: true }
		)
		const row = out.rows.find((r) => r.outcome === "skipped")!
		expect(row.provenance).toBe("changed")
		expect(row.verdict).toMatch(/Never reached the ranker/)
	})
})

/**
 * The part of an entry the hash cannot see, and why `unchanged` is rationed.
 *
 * `entrySourceHash` covers `title`, `keys` and `content` — the annotation
 * lane's definition of an entry's content, shared with it deliberately. History
 * declares **no title role**: it is not named, it is *dated*, its heading comes
 * out of `fields`, and that date feeds the recency signals. So an edited year
 * is an edit that changed the outcome and moved no hash.
 *
 * ⚠ Which makes `unchanged` the dangerous state rather than the safe one. Before
 * this lane the panel claimed nothing and was merely unverified; a badge saying
 * "this is what was scored" over a re-dated history entry would be the original
 * defect with a reassurance printed on it. So the projection reports `changed`
 * from the recorded heading where it has one, and stays **silent** rather than
 * claiming `unchanged` for a heading it cannot check.
 */
describe("explainRetrieval — what the fingerprint cannot see, it does not claim", () => {
	const HISTORY = "core:entry/history"

	async function sourceHash(row: {
		title?: string | null
		keys?: string[] | string | null
		content?: string | null
	}) {
		const { entrySourceHash } = await import("$lib/server/annotations")
		return entrySourceHash(row)
	}

	/** A history entry: no title column, a date in `fields`, one key. */
	const STORED = { title: null, keys: ["siege"], content: "It lasted a winter." }

	const liveHistory = async (year: number) => {
		const map = new Map(ENTRIES)
		map.set("history:7", {
			id: 7,
			typeId: HISTORY,
			title: `Year ${year}`,
			keys: ["siege"],
			constant: false,
			enabled: true,
			fingerprint: await sourceHash(STORED)
		})
		return map
	}

	/** The run scored it at 412, and recorded that heading on the candidate. */
	const datedReceipt = async () =>
		receipt({
			nodes: [
				{
					nodeKey: "rank",
					seq: 1,
					output: {
						decisions: [
							decision({
								candidate: {
									id: 7,
									source: "history",
									tokens: 20,
									signals: { recency: 0.5 },
									payload: {
										name: null,
										year: 412,
										content: STORED.content,
										fingerprint: await sourceHash(STORED)
									}
								}
							})
						],
						groups: {}
					}
				}
			]
		})

	it("calls a re-dated history entry changed, though its text never moved", async () => {
		// The hash matches — title, keys and content are untouched — and the
		// heading moved anyway. Recency scored the old date.
		const out = await explain(
			await datedReceipt(),
			await liveHistory(413),
			{ entriesRead: true }
		)
		const row = out.rows[0]
		expect(row.provenance).toBe("changed")
		expect(row.title).toBe("Year 412")
		expect(row.currentTitle).toBe("Year 413")
	})

	it("calls it unchanged when the date is where the run left it", async () => {
		const out = await explain(
			await datedReceipt(),
			await liveHistory(412),
			{ entriesRead: true }
		)
		expect(out.rows[0].provenance).toBe("unchanged")
		expect(out.rows[0].title).toBe("Year 412")
	})

	it("claims nothing for a skipped history row, whose heading it cannot check", async () => {
		// ⚠ A skip carries no payload, so there is no recorded date to compare
		// and the hash does not reach history's heading. The text is verified;
		// the heading is not; and the honest report of a half-check is silence,
		// not a badge saying the row is what was scored.
		const out = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "lore-history",
						seq: 1,
						output: {
							skipped: [
								{
									id: 7,
									source: "history",
									reason: "no key matched",
									fingerprint: await sourceHash(STORED)
								}
							]
						}
					}
				]
			}),
			await liveHistory(412),
			{ entriesRead: true }
		)
		const row = out.rows.find((r) => r.outcome === "skipped")!
		expect(row.provenance).toBeUndefined()
	})

	it("still verifies a skipped world-lore row, whose heading is a hashed column", async () => {
		// The contrast that makes the rule a rule rather than a shrug: world
		// lore declares `title`, the hash covers it, so a skip is fully
		// checkable and is checked.
		const stored = {
			title: "The Ashguard",
			keys: ["ashguard", "gate", "silverwood"],
			content: "A wall of grey stone."
		}
		const map = new Map(ENTRIES)
		map.set("worldLore:1", {
			...entry(1, "core:entry/world-lore", stored.title, stored.keys),
			fingerprint: await sourceHash(stored)
		})
		const out = await explain(
			receipt({
				nodes: [
					{
						nodeKey: "lore-world",
						seq: 1,
						output: {
							skipped: [
								{
									id: 1,
									source: "worldLore",
									reason: "no key matched",
									fingerprint: await sourceHash(stored)
								}
							]
						}
					}
				]
			}),
			map,
			{ entriesRead: true }
		)
		const row = out.rows.find((r) => r.outcome === "skipped")!
		expect(row.provenance).toBe("unchanged")
	})
})

/**
 * The stop sequences, carried through to the panel (ruling 2026-09-10).
 *
 * The three questions this answers are ones the old flat `string[]` could not:
 * WHAT went out, what was HELD BACK and by which rule, and which one actually
 * ended the reply. "Why did my reply run on past its turn" and "why did the
 * sequence I typed do nothing" are the two support questions this whole area
 * exists to close, and neither is answerable from a payload nobody kept.
 */
describe("explainRetrieval — the stop sequences", () => {
	const withStops = (stops: unknown) =>
		receipt({
			nodes: [
				{
					nodeKey: "generate",
					seq: 9,
					typeId: "core:provider/generate-text@1",
					output: { text: "hi", stops }
				}
			]
		})

	it("carries the generate node's sent, dropped, wire and hit", async () => {
		const out = await explain(
			withStops({
				sent: [
					{ value: "<<END>>", kind: "explicit" },
					{ value: "Vell:", kind: "speaker" }
				],
				dropped: [{ value: "@@stop@@", kind: "format" }],
				wire: "completion",
				hit: "<<END>>"
			})
		)
		expect(out.stops).toEqual({
			sent: [
				{ value: "<<END>>", kind: "explicit" },
				{ value: "Vell:", kind: "speaker" }
			],
			dropped: [{ value: "@@stop@@", kind: "format" }],
			wire: "completion",
			hit: "<<END>>"
		})
	})

	it("says nothing when the run recorded nothing", async () => {
		// Silence rather than an empty pair of lists: a run from before this was
		// recorded, or one that halted before the provider, has not told us that
		// no stop sequences were sent — it has told us nothing.
		expect((await explain(receipt())).stops).toBeUndefined()
	}, 30_000)

	it("ignores a malformed record rather than rendering half a row", async () => {
		// The receipt blob is JSON somebody could have written; a shape the
		// panel cannot read is dropped, not passed through to throw in a
		// component.
		expect(
			(await explain(withStops({ sent: "nope" }))).stops
		).toBeUndefined()
	}, 30_000)
})
