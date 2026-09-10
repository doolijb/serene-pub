/**
 * The non-LLM scene-cast proposal.
 *
 * ## What these assertions are for
 *
 * The justification for this mechanism is not its accuracy — it is its **failure
 * profile**: omission, never fabrication. A missed NPC costs a link; a wrong
 * participant *widens what a relationship asserts about who knows it*, because
 * the cast bounds relationship visibility (plan §6). So the tests that matter
 * most here are the ones that fail if a guard is removed, and every guard has
 * one. Break `PROMOTING_SITES`, the calendar stoplist, the entry-key drop, the
 * vocative's containing-range bound, its right-hand bound, the speech tag's
 * quotation requirement or its clause-break rule, and a named test below turns
 * red with a *fabricated person* in the message.
 *
 * ## The corpus
 *
 * `HOLLOW` and `FERRY` are two of the five hand-audited transcripts the
 * measurement ran on, reproduced verbatim, with the ground truth that was
 * written **before** any classifier existed. They are here rather than a
 * paraphrase because every trap they carry is a trap that was declared in
 * advance and then measured: a silent session character, two narrator-voiced
 * NPCs, a discussed-only NPC, a reported past presence, and a vocative.
 *
 * The headline numbers (sender 100.0 %/88.5 %, roster 92.6 %/96.2 %, NPC subset
 * 100 %/66.7 %) are over all five transcripts and eight spans; that harness
 * lives outside the repo. What is pinned here is every individual verdict those
 * numbers are made of for these two fixtures, which is the part a regression
 * would move.
 */

import { describe, it, expect } from "vitest"
import { buildGazetteer } from "$lib/server/pipelines/ranking/entities"
import {
	CALENDAR_NON_PERSONS,
	SCENE_CAST_PROPOSER,
	classifySite,
	isExtractorArtefact,
	proposeSceneCast,
	quotedRanges,
	renderEvidence,
	type CastTurn,
	type RosterMember
} from "$lib/server/utils/sceneCastProposal"

// ── the hollow fixture ──────────────────────────────────────────────────────
//
// A narrator-run inn. Two session rows; four people with none. Declared traps:
//
//   T1 SILENT SESSION CHARACTER — Sister Adaeze is in the room from the first
//      turn to the last, is never named and never speaks. Text alone MUST miss
//      her; only the roster can supply her.
//   T2 NARRATOR-VOICED NPC — Grust and Petra Kell act and speak inside turns
//      whose sender is the narrator, so the sender is not who is acting.
//   T3 DISCUSSED-ONLY NPC — Magistrate Venn is talked about at length and never
//      appears.
//   T4 REPORTED PAST PRESENCE — Old Mabry "was in that chair last night".
//   T5 VOCATIVE — `"Grust. Two."` names a present man inside a quotation with no
//      verb and no speech tag.
//   T6 A NAME THAT IS A PLACE — the Hollow is the inn, and it is a lore entry.

const HOLLOW_GAZETTEER = buildGazetteer([
	{ name: "Rell Vantage", ref: { kind: "persona", id: 20 } },
	{ name: "Sister Adaeze", ref: { kind: "character", id: 21 } },
	{ name: "The Hollow", ref: { kind: "entry", id: 22 } }
])

const HOLLOW_ROSTER: RosterMember[] = [
	{ key: "persona:20", name: "Rell Vantage" },
	{ key: "character:21", name: "Sister Adaeze" }
]

const HOLLOW: CastTurn[] = [
	{
		index: 1,
		senderKey: null,
		content:
			"The common room of the Hollow was three-quarters empty and all of the empty was on the door side, which is how you can tell a place has had a bad week. Grust had the taps and a rag and the expression of a man doing sums he does not like."
	},
	{
		index: 2,
		senderKey: "persona:20",
		senderName: "Rell Vantage",
		content:
			'I took the corner bench with my back to the stone and put my hat on the table where he could see it. "Grust. Two."'
	},
	{
		index: 3,
		senderKey: null,
		content:
			'Grust poured two without looking up and set them down hard enough to make the point. "You\'ll want to know about the magistrate," he said. "Everyone who comes in wanting two wants to know about the magistrate."'
	},
	{
		index: 4,
		senderKey: "persona:20",
		senderName: "Rell Vantage",
		content: '"Then tell me about the magistrate."'
	},
	{
		index: 5,
		senderKey: null,
		content:
			'"Venn\'s been sitting on the writ for eleven days," Grust said. "Magistrate Venn does not sign a thing in a month with an R in it, and there\'s an R in this one, and there\'s an R in the next one too."'
	},
	{
		index: 6,
		senderKey: "persona:20",
		senderName: "Rell Vantage",
		content:
			"I drank one of the two and left the other where it was. Beside me the second cup went untouched, which was the answer I had expected and did not enjoy getting."
	},
	{
		index: 7,
		senderKey: null,
		content:
			'The door came open on the weather and a courier came in with it — Petra Kell, still in the riding coat, still with the satchel strap across her. She did not sit down. "Is Vantage here?"'
	},
	{
		index: 8,
		senderKey: null,
		content:
			"Grust tipped his head at the corner bench without a word, and Petra Kell crossed the room and put a folded packet on the table between the two cups."
	},
	{
		index: 9,
		senderKey: "persona:20",
		senderName: "Rell Vantage",
		content: '"From Venn?"'
	},
	{
		index: 10,
		senderKey: null,
		content:
			'"From Venn\'s clerk," Petra Kell said. "Which is not the same and you know it is not the same. Old Mabry was in that chair last night saying the same word and he got the same packet and it did him no good either."'
	},
	{
		index: 11,
		senderKey: "persona:20",
		senderName: "Rell Vantage",
		content: '"Did Mabry read it?"'
	},
	{
		index: 12,
		senderKey: null,
		content:
			'"Mabry cannot read," Grust said from the taps, "which has never once slowed him down." Petra Kell laughed and did not sit down and went back out into the weather without taking anything to drink.'
	},
	{
		index: 13,
		senderKey: "persona:20",
		senderName: "Rell Vantage",
		content:
			"I broke the seal with a thumbnail and read it twice, and then I turned it round on the table so that the second cup's owner could read it too, which is as close to asking for an opinion as I get."
	},
	{
		index: 14,
		senderKey: null,
		content:
			"Grust watched all of that from the taps and went back to his sums. Old Mabry had been in that same chair the night before and had left by the yard door before dawn, and outside the rain got into the gutter and stayed there."
	}
]

const hollow = (roster: RosterMember[] = HOLLOW_ROSTER) =>
	proposeSceneCast(HOLLOW, { gazetteer: HOLLOW_GAZETTEER, roster })

const labelled = (roster?: RosterMember[]) =>
	Object.fromEntries(
		hollow(roster).participants.map((m) => [m.key, m.evidenceLabel])
	)

// ── the ferry fixture ───────────────────────────────────────────────────────
//
// One room and a wall. Toma leaves the room in turn 2 and keeps acting audibly
// for the rest of the span — under the narrative model he never leaves the
// SCENE, and a cast set that drops him is wrong. Ostrek speaks from outside and
// is never seen; he is the one measured miss, and the reason is stated below.

const FERRY_GAZETTEER = buildGazetteer([
	{ name: "Ines Marek", ref: { kind: "persona", id: 30 } },
	{ name: "Toma", ref: { kind: "character", id: 31 } }
])

const FERRY_ROSTER: RosterMember[] = [
	{ key: "persona:30", name: "Ines Marek" },
	{ key: "character:31", name: "Toma" }
]

const FERRY: CastTurn[] = [
	{
		index: 1,
		senderKey: "persona:30",
		senderName: "Ines Marek",
		content:
			"The hut is one room and the stove is in the wrong corner of it, which I have said before and will say again. I had the ledger open and the lamp turned down and my coat still on."
	},
	{
		index: 2,
		senderKey: "character:31",
		senderName: "Toma",
		content:
			'"The chain\'s slipping again," Toma said, already reaching for the door. "I\'ll have it before the tide turns." He went out and did not shut the door properly behind him, because he never does.'
	},
	{
		index: 3,
		senderKey: "persona:30",
		senderName: "Ines Marek",
		content:
			"I got up and shut it. Through the boards I could hear him at the winch, the ratchet and then the pause and then the ratchet, and I could tell from the pauses that it was worse than he had said."
	},
	{
		index: 4,
		senderKey: "character:31",
		senderName: "Toma",
		content:
			'"It\'s the third link," he called through the wall, in the voice he uses when he wants me to hear it and not to come out. "Don\'t come out. It\'s the third link and I\'ve got it."'
	},
	{
		index: 5,
		senderKey: "persona:30",
		senderName: "Ines Marek",
		content:
			"I did not come out. I wrote the tide in the ledger and left the line for the crossing blank, because a blank line is easier to fill than a wrong one is to cross out."
	},
	{
		index: 6,
		senderKey: null,
		content:
			'Somebody knocked twice on the shutter rather than the door — the wardsman\'s knock. "Ostrek," he said from outside, not opening anything. "Is the ferry running or is it not? I have four carts and a magistrate\'s patience."'
	},
	{
		index: 7,
		senderKey: "persona:30",
		senderName: "Ines Marek",
		content:
			'"It is running in an hour," I said to the shutter, which is a thing you can only say to a shutter if you are certain, and I was not certain, and Ostrek went away up the bank sounding no happier than he had arrived.'
	},
	{
		index: 8,
		senderKey: "character:31",
		senderName: "Toma",
		content: '"Who was that?" Toma called, over the ratchet.'
	},
	{
		index: 9,
		senderKey: "persona:30",
		senderName: "Ines Marek",
		content:
			'"Ostrek. Four carts." I did not open the door and he did not ask me to.'
	},
	{
		index: 10,
		senderKey: "persona:30",
		senderName: "Ines Marek",
		content:
			"The ratchet stopped at about the half hour and did not start again, and then the door came open on Toma with his hands black to the wrist and the third link in his fist, and he put it on the ledger where the tide line was, which ruined the page and made the point."
	}
]

// ── micro-fixtures, one per guard ───────────────────────────────────────────

const turn = (content: string, index = 1): CastTurn[] => [
	{ index, content, senderKey: null }
]

/**
 * A gazetteer for the micro-fixtures.
 *
 * ⚠ Needed, and the reason is a limit worth stating. `extractEntities`' rule 1
 * drops a lone capitalised word in sentence-initial position unless something
 * corroborates it, and a terminator inside a quotation puts a name in exactly
 * that position — so `"Toss. Two."` yields nothing at all from the OPEN tier.
 * The vocative rule below is therefore reliable for names the world knows and
 * opportunistic for names it does not. See `the extractor's own recall limit`.
 */
const KNOWN = buildGazetteer([
	{ name: "Kestrel", ref: { kind: "character", id: 7 } },
	{ name: "Toss", ref: { kind: "character", id: 8 } }
])

const proposedKeys = (
	turns: CastTurn[],
	gazetteer = buildGazetteer([]),
	roster: RosterMember[] = []
) =>
	proposeSceneCast(turns, { gazetteer, roster }).participants.map(
		(m) => m.key
	)

// ════════════════════════════════════════════════════════════════════════════

describe("the narrow question: participants with no session row", () => {
	it("proposes an NPC the narrator voices, whose every turn a narrator sent", () => {
		// T2. Grust and Petra Kell have no session row and never send a message,
		// so neither the sender rule nor the roster can see them. Text is the
		// only source there is, and this is the whole reason text is in the
		// union at all.
		const keys = hollow().participants.map((m) => m.key)
		expect(keys).toContain("open:grust")
		expect(keys).toContain("open:petra kell")
	})

	it("does not propose a name the span only discusses", () => {
		// T3/T4. Venn is talked about across four turns; Mabry across three, once
		// in narration with an explicit past-time adverbial. All four keys are
		// quotation-bounded or narrated without a speech tag, and none of them is
		// a person who was there.
		const keys = hollow().participants.map((m) => m.key)
		expect(keys).not.toContain("open:venn")
		expect(keys).not.toContain("open:magistrate venn")
		expect(keys).not.toContain("open:mabry")
		expect(keys).not.toContain("open:old mabry")
	})

	it("proposes a roster member who is never named and never speaks", () => {
		// T1. Sister Adaeze is present in all fourteen turns as "the second cup".
		// Her textual evidence is literally nothing, so this is the case that
		// justifies keeping the roster in the union: dropping a member who WAS
		// there is the dangerous direction, and only a standing fact prevents it.
		expect(labelled()["character:21"]).toBe("roster")
	})

	it("keeps the fullest surface form as the name to create", () => {
		// `Petra` and `Petra Kell` are the same open-tier key; the longer form is
		// the one a new binding would be created under.
		const petra = hollow().participants.find(
			(m) => m.key === "open:petra kell"
		)
		expect(petra?.name).toBe("Petra Kell")
	})
})

describe("the evidence a person reviews", () => {
	it("cites the kind and the turns, for every member", () => {
		expect(labelled()).toEqual({
			"persona:20": "sender@2,4,6,9,11,13 + roster",
			"character:21": "roster",
			"open:grust": "speech-tag@5,12",
			"open:petra kell": "speech-tag@10,12"
		})
	})

	it("renders a roster row without turn numbers, because it is not a site", () => {
		expect(
			renderEvidence([
				{ kind: "sender", turns: [1, 4] },
				{ kind: "roster", turns: [] },
				{ kind: "vocative", turns: [2] }
			])
		).toBe("sender@1,4 + roster + vocative@2")
	})

	it("names the proposer, so a stale evidence string is identifiable", () => {
		expect(hollow().proposerVersion).toBe(SCENE_CAST_PROPOSER)
		expect(SCENE_CAST_PROPOSER).toMatch(/@\d+$/)
	})

	it("orders the strongest evidence first", () => {
		const proposal = proposeSceneCast(FERRY, {
			gazetteer: FERRY_GAZETTEER,
			roster: FERRY_ROSTER
		})
		expect(proposal.participants.map((m) => m.evidenceLabel)).toEqual([
			"sender@2,4,8 + roster + speech-tag@2,8",
			"sender@1,3,5,7,9,10 + roster"
		])
	})
})

describe("⚠ nothing is proposed that no evidence supports", () => {
	it("gives every proposed member at least one evidence item", () => {
		for (const fixture of [
			hollow(),
			proposeSceneCast(FERRY, {
				gazetteer: FERRY_GAZETTEER,
				roster: FERRY_ROSTER
			})
		])
			for (const member of fixture.participants)
				expect([member.key, member.evidence.length > 0]).toEqual([
					member.key,
					true
				])
	})

	it("proposes nobody at all from a passage that names nobody", () => {
		expect(
			proposedKeys(turn("the rain got into the gutter and stayed there."))
		).toEqual([])
	})

	it("proposes nobody from an empty span", () => {
		const proposal = proposeSceneCast([], {
			gazetteer: HOLLOW_GAZETTEER
		})
		expect(proposal.participants).toEqual([])
		expect(proposal.withheld).toEqual([])
	})

	it("holds back a name that is only ever inside quotation marks", () => {
		const proposal = proposeSceneCast(
			turn('"Kestrel took the north road," she told him, "before dawn."'),
			{ gazetteer: KNOWN }
		)
		expect(proposal.participants).toEqual([])
		expect(proposal.withheld.map((w) => [w.key, w.reason])).toEqual([
			["character:7", "quoted"]
		])
	})
})

describe("mutation guard — the promoting sites are speech tag and address, and nothing else", () => {
	it("withholds a name narration gives a verb to", () => {
		// ⚠ This is the whole `broad`-vs-`speech-gated` decision in one
		// assertion. Admitting `narration` buys ~12 points of recall and starts
		// proposing places, because prose gives places active verbs constantly.
		// Add "narration" to PROMOTING_SITES and this goes red.
		const proposal = proposeSceneCast(
			turn("Ferrier's Row did not catch, and the Row remembered it."),
			{}
		)
		expect(proposal.participants).toEqual([])
		expect(proposal.withheld.map((w) => w.reason)).toContain("narration")
	})

	it("withholds Ostrek, and says so: the one measured miss on the NPC subset", () => {
		// Honest limit, pinned rather than hidden. `"Ostrek," he said from
		// outside` is a quotation-opening vocative, and the shipped extractor's
		// sentence-initial rule drops that shape for the open tier — the
		// follower is `he`, not a verb of speaking. He survives extraction only
		// via `and Ostrek went away up the bank`, which is narration.
		//
		// The obvious fix is measured and rejected: admitting every
		// quote-bounded lone capital recovers him at 100 % → 33.3 % precision,
		// inventing `Granary`, `Two`, `Loose` and `From Venn` and promoting an
		// absent roofer. See PRESENCE.md §8/§9.
		const proposal = proposeSceneCast(FERRY, {
			gazetteer: FERRY_GAZETTEER,
			roster: FERRY_ROSTER
		})
		expect(proposal.participants.map((m) => m.key)).not.toContain(
			"open:ostrek"
		)
		expect(
			proposal.withheld.find((w) => w.key === "open:ostrek")
		).toMatchObject({ reason: "narration", turns: [7] })
	})
})

describe("the extractor's own recall limits, pinned rather than hidden", () => {
	it("cannot see a quotation-opening address to a name the world does not know", () => {
		// D4. `extractEntities` rule 1 drops a lone capitalised word in
		// sentence-initial position without corroboration, and a terminator
		// inside a quotation puts a name there. So the open tier is silent on
		// exactly the shape that carries the strongest presence evidence in the
		// language — you address the person who is there.
		//
		// ⚠ The obvious fix is measured and rejected (PRESENCE.md §8/§9): it
		// costs 100 % → 33.3 % NPC precision. If it is ever pursued it needs
		// corroboration from the whole SESSION, which a single-passage extractor
		// cannot supply, plus an EXTRACTOR_VERSION bump.
		expect(proposedKeys(turn('"Grust. Two."'))).toEqual([])
		// The same sentence, once the world knows the name:
		expect(
			proposedKeys(turn('"Grust. Two."'), buildGazetteer([
				{ name: "Grust", ref: { kind: "character", id: 9 } }
			]))
		).toEqual(["character:9"])
	})

	it("leaves an unbound background binding unresolved, so it arrives looking new", () => {
		// ⚠ The structural recall limit named in the module docblock.
		// `annotations/loadVocabulary` contributes a gazetteer name only for a
		// binding that names a CHARACTER or a PERSONA. The narrative graph's
		// unbound "background" bindings — precisely the NPC rows this mechanism
		// is best at finding — have no row to resolve to, so they stay open-tier
		// strings and reach the review screen as *suggested new characters*.
		//
		// Nothing is lost: `resolveOrCreateBindingByName` collapses the name onto
		// the existing binding at save time. The cost is that it is presented as
		// new when it is not, and that narrows as the recognition-vocabulary lane
		// widens what resolves.
		const proposal = hollow()
		const grust = proposal.participants.find((m) => m.key === "open:grust")
		expect(grust).toMatchObject({ tier: "open", ref: undefined })
	})
})

describe("mutation guard — the calendar stoplist", () => {
	it("does not propose a weekday addressed like a person", () => {
		// ⚠ `"…this week. Thursday."` is byte-for-byte the shape of
		// `"Grust. Two."`, and a weekday is a capitalised English common noun,
		// so it arrives as an open-tier entity and collects a vocative exactly
		// as a person would. Empty CALENDAR_NON_PERSONS and this goes red with a
		// fabricated person; measured, it costs NPC-subset precision 100 % →
		// 66.7 %.
		const keys = proposedKeys(
			turn('"It has to be inside this week. Thursday."')
		)
		expect(keys).not.toContain("open:thursday")
		expect(keys).toEqual([])
	})

	it("covers every day and month, not a sample", () => {
		for (const word of [
			"monday",
			"sunday",
			"january",
			"june",
			"august",
			"december"
		])
			expect(CALENDAR_NON_PERSONS.has(word)).toBe(true)
	})
})

describe("mutation guard — a lore entry is never a member of the cast", () => {
	it("does not propose a place the gazetteer resolves, however it is used", () => {
		// ⚠ `The Hollow` is the inn and a lorebook entry. A gazetteer hit
		// resolves it, and this passage hands it a speech tag outright. Drop the
		// `entry:` clause from `isNonPerson` and a building becomes a
		// participant — which would then bound a relationship's publicity.
		const keys = proposedKeys(
			turn('"That is not what I heard," the Hollow said.'),
			HOLLOW_GAZETTEER
		)
		expect(keys).not.toContain("entry:22")
		expect(keys).toEqual([])
	})

	it("keeps the inn out of the fourteen-turn fixture entirely", () => {
		const proposal = hollow()
		const all = [...proposal.participants, ...proposal.withheld]
		expect(all.map((r) => r.key)).not.toContain("entry:22")
	})
})

describe("mutation guard — the vocative's bounds", () => {
	it("is not satisfied by a quotation that opens AFTER the name", () => {
		// ⚠ The measurement bug that flattered the mechanism. Asking
		// `quotes.some(...)` instead of finding the CONTAINING range makes the
		// slice before an unrelated later quotation empty, so every name in a
		// two-quotation passage becomes a vocative. It promoted `Ferrier's Row`,
		// `the Row`, `June` and `Ferro` — four of the first run's five false
		// positives, all fabrications.
		const proposal = proposeSceneCast(
			turn(
				'She thought about Kestrel for a while. "It is late," she added. "Go home."'
			),
			{}
		)
		expect(proposal.participants).toEqual([])
	})

	it("requires punctuation on the right, not just a quotation on the left", () => {
		// `"Kestrel walked out"` opens the quotation with the name, so the LEFT
		// bound is satisfied; only the right-hand test separates an address from
		// a subject.
		const proposal = proposeSceneCast(turn('"Kestrel walked out."'), {
			gazetteer: KNOWN
		})
		expect(proposal.participants).toEqual([])
		expect(proposal.withheld.map((w) => w.reason)).toEqual(["quoted"])
	})

	it("does propose a name addressed at the head of a quotation", () => {
		// T5, the positive half — without it the guards above would be trivially
		// satisfiable by never promoting anything.
		expect(
			proposeSceneCast(turn('"Kestrel. Two."'), {
				gazetteer: KNOWN
			}).participants.map((m) => m.evidenceLabel)
		).toEqual(["vocative@1"])
	})

	it("does propose a name addressed after a terminator inside a quotation", () => {
		expect(
			proposedKeys(turn('"There is a man in your road. Toss."'), KNOWN)
		).toEqual(["character:8"])
	})
})

describe("mutation guard — the speech tag's own conditions", () => {
	it("needs a quotation somewhere in the passage", () => {
		// ⚠ The verb alone is far too weak: *"Silence answered"* is an ordinary
		// sentence. Drop `hasQuote` and every narrated abstraction beside a
		// speech verb becomes a speaker.
		expect(proposedKeys(turn("Silence answered Kestrel for a while."))).toEqual(
			[]
		)
		expect(proposedKeys(turn('"Well?" Kestrel answered.'))).toEqual([
			"open:kestrel"
		])
	})

	it("needs the name OUTSIDE the quotation", () => {
		// A name beside a speech verb *inside* a quotation is being reported on,
		// not speaking. Drop `!quoted` and every name in reported dialogue is a
		// participant.
		const proposal = proposeSceneCast(
			turn('"And then Kestrel said the road was shut," he told me.'),
			{}
		)
		expect(proposal.participants.map((m) => m.key)).not.toContain(
			"open:kestrel"
		)
	})

	it("needs the verb in the same clause as the name", () => {
		// A comma between the name and the verb is a clause boundary, so the
		// verb is not this name's.
		expect(
			classifySite(
				'"Go," Kestrel, who had said nothing, turned away.',
				[],
				[[0, 5]],
				{ start: 7, end: 14 }
			)
		).not.toBe("speech-tag")
	})
})

describe("mutation guard — an apostrophe is not a quotation mark", () => {
	it("does not read a possessive as opening dialogue", () => {
		// ⚠ A state machine that toggles on `'` declares half of every roleplay
		// turn to be dialogue, which would make every narrated name look
		// "discussed" and hand the entire cast to the roster.
		expect(quotedRanges("Ferrier's Row and Sera's place")).toEqual([])
	})

	it("closes an unbalanced opener at the end of the passage", () => {
		expect(quotedRanges('he said "and then')).toEqual([[8, 17]])
	})

	it("pairs straight, curly and guillemet marks", () => {
		expect(quotedRanges('“a” «b» "c"')).toEqual([
			[0, 3],
			[4, 7],
			[8, 11]
		])
	})
})

describe("mutation guard — extractor artefacts can only ever be removed", () => {
	it("rejects a contraction pseudo-entity and a run glued across punctuation", () => {
		// Both shapes were `@1` defects and both are fixed in `@2`, so nothing
		// reachable through `proposeSceneCast` fires this today. It is kept
		// because it can only remove a candidate, never add one: the cheapest
		// available guarantee that an extractor change cannot reintroduce a
		// fabricated person here unnoticed.
		const artefact = (text: string, tier: "open" | "gazetteer" = "open") =>
			isExtractorArtefact({
				key: `open:${text.toLowerCase()}`,
				text,
				tier,
				count: 1,
				spans: []
			})
		expect(artefact("I'm")).toBe(true)
		expect(artefact('Lowmarket," Cade')).toBe(true)
		expect(artefact("Ferrier's Row")).toBe(false)
		expect(artefact("Grust")).toBe(false)
		// A resolved gazetteer hit is never an artefact, whatever it looks like.
		expect(artefact("I'm", "gazetteer")).toBe(false)
	})
})

describe("the structural tier on its own", () => {
	it("proposes a sender who is never named in the text", () => {
		expect(
			proposeSceneCast(
				[
					{
						index: 3,
						content: "I put the lamp out and waited.",
						senderKey: "character:99",
						senderName: "Wren"
					}
				],
				{}
			).participants
		).toEqual([
			{
				key: "character:99",
				name: "Wren",
				tier: "gazetteer",
				ref: undefined,
				evidence: [{ kind: "sender", turns: [3] }],
				evidenceLabel: "sender@3"
			}
		])
	})

	it("cites each sender turn once, in order", () => {
		expect(labelled()["persona:20"]).toBe("sender@2,4,6,9,11,13 + roster")
	})

	it("without the roster, the silent member disappears rather than being demoted", () => {
		// The `sender` configuration, measured at 100 % precision / 88.5 %
		// recall: it never proposes anyone who was not there, and this is what
		// it costs.
		const keys = Object.keys(labelled([]))
		expect(keys).not.toContain("character:21")
		expect(keys).toEqual(
			expect.arrayContaining([
				"persona:20",
				"open:grust",
				"open:petra kell"
			])
		)
	})
})

describe("withheld names are diagnostic, not a control", () => {
	it("reports every name the span mentions and did not propose, with a reason", () => {
		expect(
			hollow().withheld.map((w) => `${w.key} ${w.reason}@${w.turns}`)
		).toEqual([
			"open:mabry quoted@11",
			"open:magistrate venn quoted@5",
			"open:old mabry narration@10,14",
			"open:venn quoted@5,9,10"
		])
	})

	it("never overlaps the proposed set", () => {
		const proposal = hollow()
		const proposed = new Set(proposal.participants.map((m) => m.key))
		for (const w of proposal.withheld)
			expect(proposed.has(w.key)).toBe(false)
	})
})
