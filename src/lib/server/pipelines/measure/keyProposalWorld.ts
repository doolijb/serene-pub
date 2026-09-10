/**
 * The world `keyProposalCorpus.test.ts` measures key generation in.
 *
 * Not a test file (no `*.test.ts` suffix), so vitest's `include` never picks it
 * up as a suite of its own — `corpus.ts`'s convention, for its reason.
 *
 * ## What has to be true of this world for the measurement to mean anything
 *
 * The question is *"does giving a history entry generated keys make it findable
 * without making every history entry fire at once"*, and four properties of the
 * fixture decide whether an answer to that is worth reading:
 *
 * 1. **Every scene shares its cast.** Cade is in all twelve summaries and Vell
 *    in nine. That is the whole hazard: an extractor that keys on who was
 *    present produces twelve entries that fire together, and a world where each
 *    scene had its own cast could not observe it.
 * 2. **The probes are paraphrases, never excerpts.** A conversation built by
 *    copying a sentence out of the summary measures `String.includes` and
 *    nothing else. Each probe below is written the way a session would arrive at
 *    the same subject — different words, different order, sometimes naming the
 *    thing only obliquely — so recall here is recall.
 * 3. **Scenes deliberately overlap.** 301 and 306 are both about the Lowmarket
 *    cistern, and 303 and 309 are both about the broken seal, so a probe about
 *    one *should* reach the other. A corpus scoring every cross-entry hit as a
 *    false fire would report a mechanism working correctly as broken, so each
 *    probe declares every entry it is legitimately about in `targets` and only
 *    what is outside that list counts against precision.
 * 4. **The lorebook is a lorebook, not a history lane.** World lore and
 *    character lore are present because they are part of the collection
 *    distinctiveness is measured in, and because a key colliding with world lore
 *    is as real a collision as one colliding with another summary.
 *
 * ## What it cannot observe
 *
 * It is one world, in English, of thirty entries — twelve of them history.
 * It can show a mechanism failing and it can show one behaving sensibly at this
 * size; it cannot establish a threshold's value for a book of four hundred
 * entries, and no number produced from it should be read that way.
 *
 * ⚠ **Its size is itself a finding.** The world was thirteen entries first, and
 * at that size idf could not tell a domain noun from an ordinary English verb:
 * `left`, `night`, `read` and `answer` all scored as distinctive, because on a
 * small book almost everything is rare. Every gate that leans on the corpus gets
 * sharper as the book grows, and the report says so rather than quoting the
 * larger world's numbers as if they held everywhere.
 */

import type { MessageRow } from "$lib/server/pipelines/ranking/keywordQuery"
import type { GazetteerName } from "$lib/server/pipelines/ranking/entities"
import type { RetrievalBand } from "$lib/server/pipelines/ranking/weights"

export interface WorldEntry {
	id: number
	source: RetrievalBand
	/** The row's title. History rows have none — `entryInsert` stores `null`. */
	name: string | null
	content: string
	bindingCharacterId?: number
}

/** A probe: a conversation, and which entries it is genuinely about. */
export interface Probe {
	id: string
	/** What a reader needs to know about why this probe is shaped as it is. */
	about: string
	messages: MessageRow[]
	/**
	 * The scene this conversation was written about. **Recall is measured
	 * against this and only this.**
	 */
	targets: number[]
	/**
	 * Entries a reader would also accept — the same place, the same object, the
	 * next day.
	 *
	 * ⚠ **Separate from `targets` so the accounting cannot be gamed.** Recall
	 * never counts these, so widening the list can only make the mechanism look
	 * *worse* at finding things; over-firing does exclude them, because
	 * surfacing the other half of a two-part scene is retrieval working, not
	 * failing, and scoring it as a miss would report a correct mechanism as
	 * broken. Every one is justified in the probe's own `about`.
	 */
	related?: number[]
}

const CADE = 1
const VELL = 2
const MAREK = 3

/**
 * The cast, as the gazetteer's first tier.
 *
 * Aliases included, because a cast name is refused under *every* surface form it
 * answers to and a fixture that gave each character one name could not show
 * that. "The captain" is Vell here, and so is "Vell".
 */
export const CAST: GazetteerName[] = [
	{ name: "Cade", ref: { kind: "character", id: CADE } },
	{ name: "Captain Vell", ref: { kind: "character", id: VELL } },
	{ name: "Vell", ref: { kind: "character", id: VELL } },
	{ name: "Marek", ref: { kind: "character", id: MAREK } }
]

/**
 * The lorebook.
 *
 * ⚠ History rows carry `name: null` on purpose. That is what `entryInsert`
 * writes for a type whose declaration has no `title` role, and it is half the
 * defect being fixed: with no title `nameMatchSignal` is 0, so with no keys
 * either there is no way in at all.
 */
export const ENTRIES: WorldEntry[] = [
	// ── world lore ───────────────────────────────────────────────────────
	{
		id: 101,
		source: "worldLore",
		name: "Lowmarket",
		content:
			"Lowmarket is the lower ward's market square, raised over an old cistern that still feeds the tanners' yards. The bells of the ward gate are audible from every corner of it."
	},
	{
		id: 102,
		source: "worldLore",
		name: "The Pewterers' Guild",
		content:
			"The Pewterers' Guild keeps its hall on the cistern road and holds most of the debt paper in the lower wards. A guild seal on a writ is worth more than the writ."
	},
	{
		id: 103,
		source: "worldLore",
		name: "The Ashguard Riders",
		content:
			"The Ashguard Riders answer to the Order of the Ward. They patrol the ward gates, read proclamations, and are the only riders permitted inside the walls after dark."
	},
	{
		id: 104,
		source: "worldLore",
		name: "Saltgate",
		content:
			"Saltgate is the harbour quarter. Most smuggling into the city comes through its wharves, and the watch has never held a rota there for longer than a season."
	},
	// ── character lore ───────────────────────────────────────────────────
	{
		id: 201,
		source: "characterLore",
		name: "Cade — trade",
		bindingCharacterId: CADE,
		content:
			"Cade is a courier who works the lower wards. He knows the bells well enough to keep time by them and has never once been caught carrying."
	},
	{
		id: 202,
		source: "characterLore",
		name: "Vell — office",
		bindingCharacterId: VELL,
		content:
			"Captain Vell commands the night watch and keeps the writ ledger. Vell was promoted over three officers with longer service and none of them have forgotten it."
	},
	{
		id: 203,
		source: "characterLore",
		name: "Marek — the forge",
		bindingCharacterId: MAREK,
		content:
			"Marek is a smith on Anvil Row. He does not take guild work and says so to anyone who asks, which is most of the reason he is still poor."
	},
	// ── history: twelve scenes, one cast ─────────────────────────────────
	{
		id: 301,
		source: "history",
		name: null,
		content:
			"Cade met Captain Vell at the Lowmarket cistern before dawn. Vell handed over a sealed writ naming a debt owed to the Pewterers' Guild, and warned that the Ashguard Riders had begun searching the lower wards for it. Cade hid the writ beneath the cistern grate and left before the bells."
	},
	{
		id: 302,
		source: "history",
		name: null,
		content:
			"Fire took the Thornfield granary during the night watch. Cade pulled two apprentices clear of the collapsing loft while Vell organised a bucket line from the mill race. The tithe barley stored for winter was lost, and the reeve has not yet said who will answer for it."
	},
	{
		id: 303,
		source: "history",
		name: null,
		content:
			"Cade brought the broken seal to Marek at the forge on Anvil Row. Marek recognised the Pewterers' mark and refused the work, saying the guild would know his hand anywhere. Cade left the seal with him overnight against Marek's better judgement."
	},
	{
		id: 304,
		source: "history",
		name: null,
		content:
			"Vell and Cade argued on the sea wall about the watch rota. Vell accused the courier trade of feeding the smuggling out of Saltgate, and Cade said the watch had never once held that quarter. Neither gave ground, and Cade walked back through the fog alone."
	},
	{
		id: 305,
		source: "history",
		name: null,
		content:
			"The Ashguard Riders mustered at the ward gates and read a proclamation aloud. Cade watched from the crowd as the Riders named three couriers wanted for questioning. Vell was not among the officers present, which Cade noticed and did not mention afterwards."
	},
	{
		id: 306,
		source: "history",
		name: null,
		content:
			"The Lowmarket cistern collapsed after the spring rains and flooded the undercroft where the writ had been hidden. Cade searched the drowned chamber for a day and found nothing but silt. Vell posted a watch on the ruin and would not say what she was guarding."
	},
	{
		id: 105,
		source: "worldLore",
		name: "Anvil Row",
		content:
			"Anvil Row runs behind the tanners' yards. Six forges work it and the noise carries as far as the market square when the wind is off the water."
	},
	{
		id: 106,
		source: "worldLore",
		name: "The night watch",
		content:
			"The night watch keeps a rota of four turns between the bells. Officers answer to the captain of the ward and nobody has held the harbour turn for a full season."
	},
	{
		id: 107,
		source: "worldLore",
		name: "Thornfield",
		content:
			"Thornfield lies a day north of the walls. Its granary takes the tithe barley for the whole valley and the reeve there answers to no guild."
	},
	{
		id: 108,
		source: "worldLore",
		name: "The Order of the Ward",
		content:
			"The Order of the Ward is what is left of the old garrison. It reads proclamations, keeps the gates, and has not fought anyone in living memory."
	},
	{
		id: 109,
		source: "worldLore",
		name: "Debt paper",
		content:
			"A debt in the lower wards is written on paper and sold on. Most of it passes through the guild halls, and a paper with a seal on it is worth more than one without."
	},
	{
		id: 110,
		source: "worldLore",
		name: "The tanners' yards",
		content:
			"The tanners work the water that comes off the old cistern. The smell reaches the market square on a still day and nobody who lives there mentions it any more."
	},
	{
		id: 111,
		source: "worldLore",
		name: "The mill race",
		content:
			"The mill race runs from the north wall down to the harbour. It is the only fast water inside the walls and every bucket line in the city has drawn from it."
	},
	{
		id: 112,
		source: "worldLore",
		name: "Couriers",
		content:
			"Couriers carry paper the guilds would rather not send by hand. The trade is legal, barely, and the watch has never once made a charge stick against one."
	},
	{
		id: 204,
		source: "characterLore",
		name: "Cade — the bells",
		bindingCharacterId: CADE,
		content:
			"Cade counts the bells to keep time and has done since he was small. He says a courier who cannot hear the bells is a courier who will be late once and then never again."
	},
	{
		id: 205,
		source: "characterLore",
		name: "Vell — the promotion",
		bindingCharacterId: VELL,
		content:
			"Vell was raised over three officers with longer service. She has never said a word about it and neither have they, which is its own kind of answer."
	},
	{
		id: 206,
		source: "characterLore",
		name: "Marek — the guild",
		bindingCharacterId: MAREK,
		content:
			"Marek refused a guild place twice. He will do any work that comes to the forge and none that comes with a seal on it, and he is poor for the second half of that."
	},
	{
		id: 307,
		source: "history",
		name: null,
		content:
			"Cade carried a bundle of debt paper from the harbour to the guild hall and was stopped twice on the way by officers who found nothing. Vell had signed neither stop and said so afterwards, in front of both officers."
	},
	{
		id: 308,
		source: "history",
		name: null,
		content:
			"The reeve of Thornfield came down to the city to answer for the barley and was kept waiting three days. Cade carried the letters that kept him waiting. Vell knew and said nothing at the time."
	},
	{
		id: 309,
		source: "history",
		name: null,
		content:
			"Marek melted the broken seal down rather than copy it, and told Cade afterwards that a forged mark would have cost them both a hand. Cade paid him for the work anyway and Marek took it."
	},
	{
		id: 310,
		source: "history",
		name: null,
		content:
			"A courier was taken at the harbour gate carrying nothing at all. Vell held the charge for a day and let it go. Cade heard about it from the tanners before the watch made it public."
	},
	{
		id: 311,
		source: "history",
		name: null,
		content:
			"Cade waited out a storm in the mill race undercroft with two apprentices from the granary. They talked all night about the fire and none of them mentioned the barley."
	},
	{
		id: 312,
		source: "history",
		name: null,
		content:
			"Vell walked the sea wall alone after the argument and came back with nothing settled. She wrote a rota that gave the harbour turn to nobody, which the officers read as an answer and Cade read as a question."
	}
]

export const HISTORY_IDS = ENTRIES.filter((e) => e.source === "history").map(
	(e) => e.id
)

/** A message from a character, so `speakersIn` has something to read. */
const said = (id: number, characterId: number | null, content: string): MessageRow => ({
	id,
	characterId,
	content
})

/**
 * ⚠ **Every probe is a paraphrase.** Not one of them contains a sentence from
 * the summary it targets. Where a probe does reuse a word, that word is a name
 * or a term of the world — which is the thing being tested, because a key that
 * only matches its own summary is a key that never fires.
 */
export const PROBES: Probe[] = [
	{
		id: "P1 · the paper Vell gave him",
		about:
			"Names the place and the debt but never the word 'writ'. If recall here depends on the summary's own noun, the mechanism is matching itself.",
		targets: [301],
		// 306 is the same cistern, flooded: a reader asking where the paper is
		// would want the entry saying the undercroft drowned.
		related: [306],
		messages: [
			said(1, CADE, "Do you still have the paper she gave me? The one about what I owe."),
			said(2, VELL, "It is where you left it. Under the grate at the cistern, in Lowmarket."),
			said(3, CADE, "Then it is under water by now.")
		]
	},
	{
		id: "P2 · the granary fire",
		about: "Names Thornfield and the tithe, and nothing else the summary says.",
		targets: [302],
		// 308 is the reeve of Thornfield answering for the same barley.
		related: [308],
		messages: [
			said(1, VELL, "The Thornfield granary still smells of smoke when the wind turns."),
			said(2, CADE, "We lost the whole tithe of barley that night and nobody has answered for it.")
		]
	},
	{
		id: "P3 · the broken seal",
		about:
			"Reaches the forge scene through the guild and the smith. Marek is cast, so his name is not a key — the entry has to be reachable without it.",
		targets: [303],
		// 301 is the Pewterers' debt the seal belongs to; 309 is what Marek did
		// with the seal the next day.
		related: [301, 309],
		messages: [
			said(1, CADE, "Marek never did finish the seal."),
			said(2, MAREK, "The Pewterers would know my hand on it. I told you that on Anvil Row and I meant it.")
		]
	},
	{
		id: "P4 · the rota argument",
		about: "Saltgate and the smuggling, without the sea wall or the fog.",
		targets: [304],
		messages: [
			said(1, VELL, "You still think the courier trade has nothing to do with the smuggling out of Saltgate?"),
			said(2, CADE, "I think the watch has never held that quarter for a season.")
		]
	},
	{
		id: "P5 · the proclamation",
		about: "The muster, reached through the Ashguard and the ward gates.",
		targets: [305],
		messages: [
			said(1, CADE, "They read a proclamation at the ward gates this morning."),
			said(2, VELL, "The Ashguard named three couriers. You should not have stood in that crowd.")
		]
	},
	{
		id: "P6 · the flooded undercroft",
		about:
			"About the collapse. H1 is legitimately also about the Lowmarket cistern, so it is declared a target here rather than counted as a false fire.",
		targets: [306],
		// 301 hid the writ in the undercroft that 306 floods, and 311 is the
		// mill race undercroft two apprentices waited out a storm in.
		related: [301, 311],
		messages: [
			said(1, VELL, "There is nothing left of the undercroft since the rains."),
			said(2, CADE, "I went down into the silt myself. A whole day, and nothing.")
		]
	},
	{
		id: "N · ordinary prose",
		about:
			"⚠ **The second number that decides it.** Ten messages of perfectly ordinary narrative English — handed, found, left, came back, went down — naming no place, no faction and no object from any scene. A scan window is ten messages deep by default, so this is the *size* a real one is, which the short probes above are not.\n\nIt exists because the short probes flatter a common-word key. `handed`, `left`, `found` and `came` are words a session says constantly and none of the six subject probes happens to contain, so a key on one of them looks harmless there and is not. Correct behaviour is that nothing fires.",
		targets: [],
		messages: [
			said(1, CADE, "He handed her the cup and she set it down without drinking."),
			said(2, VELL, "Outside, someone was calling a name she did not recognise."),
			said(3, CADE, "She found her coat where she had left it and went to the door."),
			said(4, VELL, "The light had gone and the street was empty in both directions."),
			said(5, CADE, "She came back an hour later and said nothing about where she had been."),
			said(6, VELL, "There was a line of people at the far end, waiting for something."),
			said(7, CADE, "He made no answer to that, which was answer enough."),
			said(8, VELL, "They walked back together and neither of them mentioned the time."),
			said(9, CADE, "Afterwards he broke a piece of bread and gave her half of it."),
			said(10, VELL, "It was late, and the question could keep until morning.")
		]
	},
	{
		id: "S · the shared-name probe",
		about:
			"⚠ **The number that decides it.** Two cast members, an ordinary exchange, and no subject from any scene. Every history entry has both of these people in it, so an extractor that keys on who was present makes all six fire here. Correct behaviour is that none do.",
		targets: [],
		messages: [
			said(1, CADE, "Cade nodded to Vell across the room and said nothing."),
			said(2, VELL, "Vell counted the coins again, then counted them a second time."),
			said(3, CADE, "It was late. Neither of them wanted to be the one to speak first.")
		]
	}
]
