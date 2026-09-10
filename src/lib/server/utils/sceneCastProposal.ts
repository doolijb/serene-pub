/**
 * Who was IN a scene — proposed from the transcript, with no model.
 *
 * ## What this answers, and what it does not
 *
 * The **narrative** presence question: is this name a *participant* in the span,
 * or somebody the span merely *talks about*? A character who walks out of the
 * room is still in the scene; silence inside a scene is not absence. Nothing
 * here tries to locate a body and nothing here closes an interval mid-scene —
 * that was measured separately and rejected (67 % false-departure rate), and a
 * genre wanting physical presence should hold structured state rather than parse
 * prose for it.
 *
 * The output is a **proposal**. It pre-fills the Review & Save screen with its
 * evidence visible; a person accepts, edits or drops each row, and only then is
 * anything written. Nothing here writes.
 *
 * ## Two tiers that fail in opposite directions
 *
 * STRUCTURAL — the message **sender** is definitional (somebody who spoke in the
 * span was in the span) and the session **roster** is a standing fact about the
 * session. Neither is inferred and neither can be wrong about a session member.
 *
 * TEXTUAL — everything the structural tier cannot see: an NPC the narrator
 * voices, a side character with no row. This is the only part that is
 * *inferred*, and therefore the only part that can fabricate.
 *
 * They are not competitors. Measured on five hand-audited transcripts, text
 * alone misses 11 of 26 participants (pronoun-referenced protagonists), and the
 * roster is the only source that finds a character present for fourteen turns
 * who is never named and never speaks. Text is the only source that finds an NPC
 * every one of whose turns was sent by the narrator.
 *
 * ## The discriminator, and why it is deliberately narrow
 *
 * A name whose every occurrence sits inside quotation marks is being *talked
 * about*. A name carrying a **speech tag** is speaking. A name **addressed**
 * inside a quotation is being spoken to, and you address the person who is
 * there.
 *
 * ⚠ **Only those two sites promote, and that is the ship decision, not a
 * default.** A measured `broad` variant also promoted a *narration subject* —
 * a name with a verb against it in narration — which buys ~12 points of recall
 * and starts proposing places, because prose gives places active verbs
 * constantly (*"Ferrier's Row did not catch"*). There is no option for it here.
 * The failure profile has to stay **omission, never fabrication**: a missed NPC
 * costs a link, a wrong participant *widens what a relationship asserts about
 * who knows it* (plan §6 — the cast bounds relationship visibility).
 *
 * Because narration-subject cannot promote, the reported-past guard the `broad`
 * variant needed (*"Old Mabry had been in that same chair the night before"* is
 * narration with a verb and is not presence) is **inert here** and is therefore
 * not carried: under speech-gating that sentence is withheld either way. Its
 * verb lexicon is the one thing this file would otherwise have to keep in sync
 * with a tagger it does not have.
 *
 * ## Measured
 *
 * 8 spans across 5 hand-audited transcripts, ground truth declared before the
 * classifier existed:
 *
 * | structural       | precision | recall |
 * |------------------|-----------|--------|
 * | sender           | 100.0 %   | 88.5 % |
 * | sender + roster  |  92.6 %   | 96.2 % |
 *
 * On the NPC subset — participants with **no session row**, the only part text
 * has to supply — 100 % precision, 66.7 % recall. **Zero fabricated people in
 * any configuration.** Cost: 40 000 turns in ~661 ms, no model, no network.
 *
 * The two whole-corpus false positives are both real session characters the
 * roster promoted from *discussed* to *participant* — a spurious link, not an
 * erasure — and both are exactly the rows whose evidence line reads `roster`
 * alone, which is why the evidence is shown rather than summarised.
 *
 * ## ⚠ A recall limit that is structural, stated rather than discovered
 *
 * `annotations/loadVocabulary` contributes a gazetteer name only for a binding
 * that names a **character or a persona**. An unbound "background" binding — the
 * kind the narrative graph mints for an NPC — has no row to resolve *to*, so its
 * name never enters the gazetteer and can never be a resolved hit here. Such a
 * name still reaches the proposal through the **open tier**, as a *suggested new
 * character*, and `resolveOrCreateBindingByName` collapses it onto the existing
 * binding at save time. The cost is that it arrives looking new when it is not.
 * That is a limit of the vocabulary, not of this file, and it narrows as the
 * recognition-vocabulary lane widens what resolves.
 *
 * ## Where this is going
 *
 * Plan §3: the cast extractor ships as a **declared SDK node type**, so
 * pipelines and genres can use it rather than it being buried in the summarizer.
 * Everything here is pure and free of `$lib/server/db`, so that declaration is a
 * thin wrapper over `proposeSceneCast` — see `SCENE_CAST_PROPOSER` for the id it
 * should claim.
 */

import {
	extractEntities,
	entityKey,
	EMPTY_GAZETTEER,
	type Entity,
	type EntityRef,
	type Gazetteer
} from "$lib/server/pipelines/ranking/entities"

/**
 * The identity this proposal is made under.
 *
 * Also the node type id the SDK declaration should claim, so the wrapper and the
 * receipt agree without a second string. ⚠ Bump it if the promoting sites, the
 * stoplist or the vocative bounds change — a proposal is shown to a person with
 * its evidence, and evidence produced by a rule that has since moved is worse
 * than no evidence.
 */
export const SCENE_CAST_PROPOSER = "core:extract/scene-cast-speech-gated@1"

/**
 * Verbs that make the capitalised word beside them a speaker.
 *
 * ⚠ **A second copy of `ranking/entities.ts`'s private `SPEECH_VERBS`**, plus
 * `told/tells/noted/notes`. It is duplicated rather than imported because that
 * one is not exported and its module carries `EXTRACTOR_VERSION`, whose whole
 * discipline is that changing what the extractor sees invalidates every stored
 * annotation. This file stores nothing, so widening its list must not be able to
 * force a re-extraction of every message in the install. **Follow-up:** if
 * `entities.ts` ever exports the set, take it and keep the four extra pairs
 * here, rather than deleting this and silently losing them.
 */
const SPEECH_VERBS = new Set(
	`said says asked asks replied replies answered answers
	 added adds continued continues repeated repeats
	 shouted shouts yelled yells cried cries called calls
	 whispered whispers murmured murmurs muttered mutters breathed breathes
	 growled growls hissed hisses snapped snaps barked barks grunted grunts
	 laughed laughs sighed sighs
	 offered offers admitted admits agreed agrees insisted insists
	 demanded demands warned warns explained explains observed observes
	 remarked remarks retorted retorts drawled drawls mused muses purred purrs
	 told tells noted notes`
		.split(/\s+/)
		.filter(Boolean)
)

/**
 * Capitalised common nouns the open tier mints as people.
 *
 * ⚠ **Load-bearing, and measured.** Days and months are capitalised in English
 * and nothing else about them says they are not a name: `"…this week.
 * Thursday."` is byte-for-byte the shape of `"Grust. Two."`, so a weekday
 * arrives as an open-tier entity and then collects a *vocative* exactly as a
 * person would. Without this list, NPC-subset precision falls from 100 % to
 * 66.7 % and `June`, `Thursday`, `Tuesday` and `August` are proposed as people.
 */
export const CALENDAR_NON_PERSONS = new Set(
	`monday tuesday wednesday thursday friday saturday sunday
	 january february march april may june july august september october november
	 december spring summer autumn winter`
		.split(/\s+/)
		.filter(Boolean)
)

/**
 * Open-tier strings that are extractor artefacts rather than names.
 *
 * Both shapes were defects in `EXTRACTOR_VERSION` `@1` and both are fixed in
 * `@2` (`stopwordForm` for the contraction, `JOIN_GAP` for the glued run), so on
 * today's extractor this filter fires on nothing. It is kept deliberately: it
 * can only ever **remove** a candidate, so it cannot cost precision, and it is
 * the cheapest available guarantee that a future extractor change cannot
 * reintroduce a fabricated person here without someone noticing.
 *
 * ⚠ The apostrophe is not glue. `Ferrier's Row` is one name, and an earlier
 * version of this test deleted it along with the artefacts.
 *
 * Exported only so its own test can reach it: on today's extractor no input to
 * `proposeSceneCast` can make it fire, and an untested guard against a
 * regression is not a guard.
 */
const CONTRACTION_PSEUDO =
	/^(?:i|we|you|he|she|it|they|that|there|who|what)['’](?:m|ve|ll|d|re)$/iu
const GLUED_RUN = /["“”,]/u

export const isExtractorArtefact = (entity: Entity): boolean =>
	entity.tier === "open" &&
	(CONTRACTION_PSEUDO.test(entity.text) || GLUED_RUN.test(entity.text))

/** What breaks the adjacency between a name and the verb beside it. */
const CLAUSE_BREAK = /[,;:—–()]/
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu

interface Token {
	lower: string
	start: number
	end: number
}

function tokensOf(text: string): Token[] {
	const out: Token[] = []
	for (const match of text.matchAll(WORD_RE))
		out.push({
			lower: match[0].toLowerCase(),
			start: match.index,
			end: match.index + match[0].length
		})
	return out
}

/**
 * Character ranges inside quotation marks.
 *
 * ⚠ The apostrophe is deliberately **not** a quote mark. `Ferrier's Row` and
 * `Sera's place` are not quotations, and a state machine that toggles on `'`
 * declares half of every roleplay turn to be dialogue — which would make every
 * narrated name look "discussed" and hand the whole cast to the roster.
 *
 * An unbalanced opener runs to the end of the passage, which is what a
 * multi-paragraph quotation looks like once its paragraphs are joined.
 */
export function quotedRanges(text: string): Array<[number, number]> {
	const out: Array<[number, number]> = []
	let open: number | null = null
	for (let i = 0; i < text.length; i++) {
		const c = text[i]
		if (c === '"' || c === "«") {
			if (open === null) open = i
			else {
				out.push([open, i + 1])
				open = null
			}
		} else if (c === "“") {
			if (open === null) open = i
		} else if (c === "”" || c === "»") {
			if (open !== null) {
				out.push([open, i + 1])
				open = null
			}
		}
	}
	if (open !== null) out.push([open, text.length])
	return out
}

const inRanges = (pos: number, ranges: ReadonlyArray<[number, number]>) =>
	ranges.some(([a, b]) => pos >= a && pos < b)

/**
 * What kind of site one occurrence of one name sits in.
 *
 * `speech-tag` and `vocative` are evidence of acting and promote; `quoted` and
 * `narration` do not. There is no fifth answer, and adding one is how a place
 * becomes a person.
 */
export type CastSite = "speech-tag" | "vocative" | "quoted" | "narration"

export function classifySite(
	text: string,
	tokens: readonly Token[],
	quotes: ReadonlyArray<[number, number]>,
	span: { start: number; end: number }
): CastSite {
	const quoted = inRanges(span.start, quotes)

	// The first token starting at or after the span's end, and the last one
	// starting before the span begins.
	let after = tokens.findIndex((t) => t.start >= span.end)
	if (after === -1) after = tokens.length
	let before = after - 1
	while (before >= 0 && tokens[before].start >= span.start) before--

	const nextTok = tokens[after]
	const prevTok = tokens[before]

	// ── speech tag ───────────────────────────────────────────────────────
	// `Cade said` / `said Cade`, with the verb in the same clause as the name
	// and a quotation mark somewhere in the passage. The quote requirement is
	// the extractor's own and it matters: without it *"Silence answered"* names
	// a speaker. The name itself must be OUTSIDE the quotation — a name inside
	// one beside a speech verb is being reported, not speaking.
	const hasQuote = quotes.length > 0
	const gapAfter = text.slice(span.end, nextTok?.start ?? text.length)
	const tagAfter =
		nextTok !== undefined &&
		SPEECH_VERBS.has(nextTok.lower) &&
		!CLAUSE_BREAK.test(gapAfter)
	const gapBefore = prevTok ? text.slice(prevTok.end, span.start) : ""
	const tagBefore =
		prevTok !== undefined &&
		SPEECH_VERBS.has(prevTok.lower) &&
		!CLAUSE_BREAK.test(gapBefore)
	if (hasQuote && !quoted && (tagAfter || tagBefore)) return "speech-tag"

	if (!quoted) return "narration"

	// ── vocative ─────────────────────────────────────────────────────────
	// A name inside a quotation, bounded on both sides by punctuation and
	// carrying no verb, is an address: `"Toss. There's a man in your road."`
	// The left boundary must be **this** quotation's own opening or a
	// comma/terminator, otherwise every object of a preposition qualifies.
	//
	// ⚠ The CONTAINING range, not any range. An earlier version asked
	// `quotes.some(([a]) => text.slice(a + 1, span.start).trim() === "")`, and a
	// quotation that OPENS AFTER the span makes that slice empty — so every name
	// in a two-quotation passage was a vocative. It promoted `Ferrier's Row`,
	// `the Row`, `June` and `Ferro`: four of the five false positives the first
	// measured run produced, all of them fabrications.
	const container = quotes.find(([a, b]) => span.start >= a && span.start < b)
	const openedHere =
		container !== undefined &&
		text.slice(container[0] + 1, span.start).trim().length === 0
	const leftOk =
		openedHere ||
		/[.!?,;—–]\s*["“]?\s*$/u.test(
			text.slice(Math.max(0, span.start - 4), span.start)
		)
	const rightOk = /^\s*[.!?,;]/u.test(text.slice(span.end))
	return leftOk && rightOk ? "vocative" : "quoted"
}

/** The sites that make a name a proposed participant. Speech-gated: these two. */
const PROMOTING_SITES = ["speech-tag", "vocative"] as const satisfies readonly CastSite[]

/** One turn of the span the cast is being proposed for. */
export interface CastTurn {
	/**
	 * How this turn is cited in an evidence string (`speech-tag@5,12`).
	 *
	 * The caller chooses the numbering. Callers in this repo pass the **1-based
	 * position within the selected span**, because that is what a person reading
	 * the review screen can count; a message id would be a number they cannot
	 * locate.
	 */
	index: number
	content: string
	/** The sender's cast key (`character:12`, `persona:3`), or null for a narrator turn. */
	senderKey?: string | null
	/** The sender's display name, for a member the text never spells out. */
	senderName?: string
}

/** A session row: a standing fact about the session, needing no inference. */
export interface RosterMember {
	/** `character:12` / `persona:3` — an `entityKey`. */
	key: string
	name: string
}

export type CastEvidenceKind = "sender" | "roster" | "speech-tag" | "vocative"

export interface CastEvidence {
	kind: CastEvidenceKind
	/** Turn indices. Always empty for `roster`, which is not a site in the text. */
	turns: number[]
}

export interface ProposedCastMember {
	/** `character:12` / `persona:3` for a resolved hit, `open:grust` otherwise. */
	key: string
	/** The fullest surface form seen — the label a person reads, and the name an unresolved member would be created under. */
	name: string
	tier: "gazetteer" | "open"
	/** Present only for a gazetteer hit. */
	ref?: EntityRef
	/** ⚠ Never empty. See `proposeSceneCast`. */
	evidence: CastEvidence[]
	/** `sender + speech-tag@5,12` — the evidence, rendered for a review screen. */
	evidenceLabel: string
}

/** Why a name the span mentions is *not* proposed. */
export type WithheldReason =
	/** Every occurrence sat inside quotation marks: the span talks about them. */
	| "quoted"
	/** Named in narration, but with no speech tag and no address. */
	| "narration"

export interface WithheldCastName {
	key: string
	name: string
	tier: "gazetteer" | "open"
	ref?: EntityRef
	reason: WithheldReason
	turns: number[]
}

export interface SceneCastProposal {
	proposerVersion: string
	/** Proposed participants, ordered strongest evidence first, then by name. */
	participants: ProposedCastMember[]
	/**
	 * Named in the span and deliberately **not** proposed.
	 *
	 * Diagnostic only. ⚠ Plan §6 ruled that `mentioned` is not surfaced to the
	 * user — this is here so the discriminator can be tested and audited
	 * directly, not so a screen can offer it back as a control.
	 */
	withheld: WithheldCastName[]
}

export interface SceneCastProposalOptions {
	/** The world's own vocabulary. Without one, only the open tier and the structural tier speak. */
	gazetteer?: Gazetteer
	/** Every active session character and persona — senders and silent members alike. */
	roster?: readonly RosterMember[]
}

interface CastRow {
	key: string
	name: string
	tier: "gazetteer" | "open"
	ref?: EntityRef
	sites: Record<CastSite, number[]>
	roster: boolean
	senderTurns: number[]
}

const emptySites = (): Record<CastSite, number[]> => ({
	"speech-tag": [],
	vocative: [],
	quoted: [],
	narration: []
})

/**
 * A key that can never name a person, whatever evidence lands on it.
 *
 * Two shapes, and both are anti-fabrication guards rather than tidiness:
 *
 *  - **`entry:`** — a gazetteer hit on a *lorebook entry title*. `The Hollow` is
 *    an inn and `Ferrier's Row` is a street; both resolve, and prose hands both
 *    of them verbs. A lore entry is never a member of the cast.
 *  - **a calendar word** in the open tier. See `CALENDAR_NON_PERSONS`.
 *
 * Applied at the end, so a place cannot be rescued by any amount of evidence.
 */
const isNonPerson = (key: string): boolean =>
	key.startsWith("entry:") ||
	(key.startsWith("open:") && CALENDAR_NON_PERSONS.has(key.slice(5)))

/**
 * Propose the cast of one span. Pure: no I/O, no clock, no randomness.
 *
 * ⚠ **The anti-fabrication property, and where it is enforced:** a member
 * reaches `participants` only by being pushed there from `evidence.length > 0`,
 * and the only things that can put an item in `evidence` are a sender turn, a
 * roster row, and the two promoting sites. There is no branch that proposes a
 * member without a reason, and no option that widens the promoting set. A
 * proposal a person cannot evaluate in place is one they dismiss by default, so
 * "has evidence" and "is proposed" are deliberately the same condition rather
 * than two that could drift.
 */
export function proposeSceneCast(
	turns: readonly CastTurn[],
	options: SceneCastProposalOptions = {}
): SceneCastProposal {
	const gazetteer: Gazetteer = options.gazetteer ?? EMPTY_GAZETTEER
	const rosterKeys = new Set((options.roster ?? []).map((m) => m.key))
	const rows = new Map<string, CastRow>()

	const rowFor = (seed: {
		key: string
		name: string
		tier: "gazetteer" | "open"
		ref?: EntityRef
	}): CastRow => {
		let row = rows.get(seed.key)
		if (!row) {
			row = {
				key: seed.key,
				name: seed.name,
				tier: seed.tier,
				ref: seed.ref,
				sites: emptySites(),
				roster: rosterKeys.has(seed.key),
				senderTurns: []
			}
			rows.set(seed.key, row)
		}
		// The fullest surface form wins: `Petra Kell` over `Petra`.
		if (seed.name.length > row.name.length) row.name = seed.name
		return row
	}

	for (const turn of turns) {
		const text = turn.content ?? ""
		const quotes = quotedRanges(text)
		const tokens = tokensOf(text)

		// ── structural: the sender ───────────────────────────────────────
		if (turn.senderKey) {
			const row = rowFor({
				key: turn.senderKey,
				name: turn.senderName ?? turn.senderKey,
				tier: turn.senderKey.startsWith("open:") ? "open" : "gazetteer"
			})
			if (!row.senderTurns.includes(turn.index))
				row.senderTurns.push(turn.index)
		}

		// ── textual ──────────────────────────────────────────────────────
		if (!text) continue
		for (const entity of extractEntities(text, gazetteer).entities) {
			if (isExtractorArtefact(entity)) continue
			const row = rowFor({
				key: entity.key,
				name: entity.text,
				tier: entity.tier,
				ref: entity.ref
			})
			for (const span of entity.spans) {
				const site = classifySite(text, tokens, quotes, span)
				if (!row.sites[site].includes(turn.index))
					row.sites[site].push(turn.index)
			}
		}
	}

	// A roster member the span never names and who never sends is still a row —
	// that case (present for fourteen turns, never named, never speaking) is the
	// single strongest argument for keeping the roster in the union, and text
	// sees literally nothing of it.
	for (const member of options.roster ?? [])
		rowFor({
			key: member.key,
			name: member.name,
			tier: member.key.startsWith("open:") ? "open" : "gazetteer"
		})

	const participants: ProposedCastMember[] = []
	const withheld: WithheldCastName[] = []

	for (const row of rows.values()) {
		if (isNonPerson(row.key)) continue

		const evidence: CastEvidence[] = []
		if (row.senderTurns.length)
			evidence.push({ kind: "sender", turns: [...row.senderTurns] })
		if (row.roster) evidence.push({ kind: "roster", turns: [] })
		for (const site of PROMOTING_SITES)
			if (row.sites[site].length)
				evidence.push({ kind: site, turns: [...row.sites[site]] })

		if (evidence.length === 0) {
			withheld.push({
				key: row.key,
				name: row.name,
				tier: row.tier,
				ref: row.ref,
				reason: row.sites.narration.length ? "narration" : "quoted",
				turns: [
					...new Set([...row.sites.narration, ...row.sites.quoted])
				].sort((a, b) => a - b)
			})
			continue
		}

		participants.push({
			key: row.key,
			name: row.name,
			tier: row.tier,
			ref: row.ref,
			evidence,
			evidenceLabel: renderEvidence(evidence)
		})
	}

	participants.sort(
		(a, b) =>
			b.evidence.length - a.evidence.length ||
			a.name.localeCompare(b.name) ||
			a.key.localeCompare(b.key)
	)
	withheld.sort(
		(a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key)
	)

	return { proposerVersion: SCENE_CAST_PROPOSER, participants, withheld }
}

/**
 * `sender + speech-tag@5,12` — one line a person can check against the text.
 *
 * The turn numbers are the point. "We think she was here" is not reviewable;
 * "she is addressed by name in turn 5" is, in about a second.
 */
export function renderEvidence(evidence: readonly CastEvidence[]): string {
	return evidence
		.map((e) => (e.turns.length ? `${e.kind}@${e.turns.join(",")}` : e.kind))
		.join(" + ")
}

/** Convenience for callers holding ids rather than keys. Re-exported so they need one import. */
export { entityKey }
