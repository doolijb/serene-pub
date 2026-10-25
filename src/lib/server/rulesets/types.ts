/**
 * 🚧 The ruleset handler's shapes (`core:task/ruleset-resolve@1`,
 * PLAN-rulesets §25, §30, §32; BACKBONE §4).
 *
 * The handler is host TypeScript: `engine.ts` is the pure half (phases, dice,
 * blocks), `read.ts` gathers what it reads from a session, `resolve.ts` runs
 * the moment and writes what `apply` decided through the state gate. These
 * are the shapes the three share.
 */

import type {
	BridgeDecl,
	FiveBand,
	OutcomeBlock,
	OutcomeCard,
	PieceProps,
	RenderDepth,
	RepertoireDecl,
	Rigour,
	RulesetConventions,
	RulesetDecl,
	SlotPiece,
	SlotValue,
	StoryCalendar
} from "@serene-pub/sdk"
import type { StoryClock } from "$lib/shared/lorebooks/storyDate"
import type { StateOwner } from "$lib/server/state/owners"

/**
 * The handler's moments, as the `mode` port names them. The engine runs two
 * (`runResolve`, `runApply`): `advance` is `apply` with no deltas, and 🚧
 * `propose` (lane 2, 2026-10-19) is `apply` whose every change is filed for
 * review — a task on **Review** (Story's *Keep the sheets*, *Track
 * conditions*) carrying its pieces as proposals instead of dropping them.
 */
export type RulesetMode = "resolve" | "apply" | "advance" | "propose"

// ── What the engine reads ───────────────────────────────────────────────────

/** One held piece, resolved to its props (inline, compendium row or lore entry, overrides laid over). */
export interface HeldPiece {
	/** The stable sort and match key: the lower-cased name. */
	key: string
	props: PieceProps
	count: number
	form: SlotPiece["kind"]
	/** The stored item, untouched — what a `remove` change names. */
	item: SlotPiece
}

/** One repertoire slot an owner carries, with what it holds. */
export interface HeldRepertoire {
	slotId: string
	repertoire: RepertoireDecl
	pieces: HeldPiece[]
}

/** One stat an owner carries, as the ruleset names it. */
export interface OwnerStat {
	slotId: string
	/** The selector name (`str`), the slot's bare key. */
	selector: string
	type: string
	value: SlotValue | undefined
	/** A `derived` slot's Liquid expression. */
	derive?: string
	/** 🚧 The stat entry's config says its numbers may show at prose rigour. */
	showNumbers?: boolean
	/** Only the holder's own voice hears it (earshot). */
	holderOnly?: boolean
	/** The slot's display label. */
	label: string
	/** 🚧 The configuration's `max` in force for this owner, when it is a number (a pool's refill). */
	max?: number
	/** 🚧 Who sees it, when its ruleset attribute says (D4): a visibility word or a scope. */
	visibility?: string
	/**
	 * 🚧 A **free text** attribute (`kind: 'text'`, RF fix 2 item 2): its
	 * value is a holder's own prose, read as a sentence of its own rather than
	 * inline beside the numbers.
	 */
	prose?: true
}

/** A field the ruleset does not own (a genre's or a custom one) — rendered as prose. */
export interface OwnerCustomField {
	slotId: string
	label: string
	value: SlotValue
	holderOnly?: boolean
	/**
	 * 🚧 A list field holding a repertoire of a ruleset the session does not
	 * play (its `config.repertoire`, parsed): kept in words (P2-6) — a change
	 * naming that repertoire lands here as a piece's name and description.
	 */
	parked?: { ruleset: string; repertoire: string }
}

/** One owner the handler resolves. */
export interface OwnerView {
	/** `world` · `character:4` · `player-seat:2` · `location:12`. */
	key: string
	owner: StateOwner
	name: string
	stats: OwnerStat[]
	repertoires: HeldRepertoire[]
	custom: OwnerCustomField[]
	/** The bag a derived stat's expression reads as `owner` (bare and qualified keys). */
	bag: Record<string, SlotValue>
}

/** A relationship between two owners present, read from the session's lorebooks. */
export interface Tie {
	id: number
	from: string
	to: string
	type: string
	reverseType?: string | null
	title?: string
	description?: string
}

/** A change the model proposed, as the `deltas` port carries it. */
export interface ProposedDelta {
	owner: unknown
	/** A stat or field: its slot id or bare key. */
	slot?: string
	/** A repertoire id of the ruleset (`things`). */
	repertoire?: string
	op: string
	/** A piece: its name, a compendium row id, or a written-out piece. */
	piece?: unknown
	reason?: string
	/** `hit` / `use` / `traverse`: the selector the check is on. */
	check?: string
	/** `hit` / `use` / `traverse`: the number the check is against. */
	against?: number
	/**
	 * A change's amount (`add`, `spend`, …) or the value a `set` writes. 🚧 On
	 * a check (2026-10-22), what its **check method** reads: under `bid`, how
	 * much is spent (absent: the least spend that buys a success); under
	 * `none`, how it went as the game master or the model judged it — one of
	 * the ruleset's degrees by id or word, else words of its own.
	 */
	value?: unknown
	/**
	 * 🚧 `hit` / `use`: who the piece is aimed at (2026-10-18, P2-1) — an
	 * owner's key, reference or name, whose sheet a `harm`, `heal` or `cure`
	 * lands on; any other name is told, never written. Absent: a heal or a
	 * cure lands on the holder, a harm on nobody. ⚠ Not a mechanic's
	 * `target` (a selector) — which is why it is not called that (R1).
	 */
	aimedAt?: unknown
	/**
	 * 🚧 `traverse`: who makes the check (PLAN-dc-after-walk2 Q2-1, owner
	 * ruling ★6) — an owner's key, reference or name. The way stays its
	 * place's piece (`owner`); the roll is the actor's — their skill, their
	 * modifiers — and a trap that springs on a failure springs on them.
	 * Absent: the delta's owner rolls, as before. Never in a model's grammar:
	 * a genre infers it (the seat whose declaration names the way).
	 */
	actor?: unknown
	/**
	 * 🚧 Who asked for the change (D3/D4, 2026-10-23): `rules` — one of the
	 * ruleset's functions (R8: it returned the delta, the outlet applies it),
	 * which may `set` a ruleset value the model may only move by an amount.
	 * Absent: the model's proposal. Read by the write gate's `changedBy`.
	 */
	origin?: "rules"
}

/**
 * 🚧 One entry in a zone (D5): a copy stamped from its lorebook entry —
 * `entryId` kept so a function may read the source, null for one made in
 * play — its entry type, name and fields; `exposed` when its holder revealed
 * it beyond its zone's visibility (D4).
 */
export interface ZoneEntry {
	entryId: number | null
	entryType: string
	name: string
	fields: Record<string, unknown>
	count?: number
	exposed?: true
	/** 🚧 A held tie side's owner (T1): whose side it is (`HeldEntry.sideOwner`). */
	sideOwner?: string
}

/**
 * 🚧 A change to what sits in a zone, as a function asks it (R8: asked,
 * never written by the function): `move` an entry from one zone to another
 * (`zone` → `to`, across owners with `toOwner`), `add` one (from its entry,
 * by id or name, or written out), `remove` one, `reveal` (expose) or `hide`
 * it. `zone` defaults to `carried`.
 *
 * 🚧 `set` (ties on the graph, T2, 2026-10-23): one field of a held entry —
 * to `value`, or moved `by` a number — held to the field's bounds (a number)
 * or its words (a choice). What lands is what reads onto the lorebook.
 * A tie side is named by `{ entryType, towards }`.
 */
export interface ZoneOp {
	op: "move" | "add" | "remove" | "reveal" | "hide" | "set"
	owner: string
	entry: unknown
	zone?: string
	to?: string
	toOwner?: string
	/** `set`: the field. */
	field?: string
	/** `set`: its new value. */
	value?: unknown
	/** `set`: how far a number moves. */
	by?: number
	key: string
}

/** Everything one resolution reads. */
export interface EngineInput {
	ruleset: RulesetDecl
	rigour: Rigour
	owners: OwnerView[]
	/** Declared actions, by owner key (or one text for everybody, under `*`). */
	actions: Record<string, string>
	deltas: ProposedDelta[]
	/** Story time passed, in the ruleset's unit. */
	elapsed: number
	ties: Tie[]
	/** The session's present round (`rounds.ts`) — what a turn-long piece counts from. */
	turn: number
	/** The conventions as the session's ruleset settings make them; absent, the ruleset's own. */
	conventions?: RulesetConventions
	/**
	 * 🚧 The session's ruleset setting values, by setting name — what the
	 * handler reads by id where a choice is no convention (Vis Itineris's
	 * `casting: points`). Absent: every setting at its default.
	 */
	settings?: Readonly<Record<string, string>>
	/** Run-seeded randomness — only `apply` rolls. */
	random?: () => number
	/**
	 * 🚧 Ruleset bridges onto this ruleset from the fields the owners carry;
	 * phase 4 applies them additively. ⏳ The SDK keeps no bridge registry
	 * yet (`defineBridge` hands its declaration back), so a run passes none;
	 * a direct caller may.
	 */
	bridges?: readonly BridgeDecl[]
	/**
	 * The story's present on the session's calendar, for real date arithmetic
	 * (`on: at`, timed pieces); a free-form book (`calendar` null) steps by
	 * the smallest-part rule. Null with no clock: nothing dated fires.
	 */
	clock?: { now: StoryClock; calendar: StoryCalendar | null } | null
	/**
	 * 🚧 Whose view the prompt is built for (earshot): `'gm'` — the owner's or
	 * game master's — reads the `gm` block; an owner key reads that holder's
	 * holder-only fields inline. Absent: the acting cast's shared view.
	 */
	viewer?: string | null
	/** What the ruleset's `derived`-phase scripts computed, by owner key (`scripts.ts`). */
	scripted?: Readonly<Record<string, ScriptedValues>>
	/**
	 * 🚧 What the ruleset's `effects`-phase scripts laid on each owner for the
	 * events in play (2026-10-22), by owner key — folded in with the pieces'
	 * own passive effects, before the `derived` phase (`earlyPhases`).
	 */
	effects?: Readonly<Record<string, ScriptedEffects>>
	/**
	 * 🚧 The check phases a driver answers (2026-10-22): with `preRoll`, a
	 * check asks before it is resolved (`EngineAsk` `pre-roll`); with
	 * `postRoll`, after (`post-roll`). Absent: nothing is asked — the
	 * engine runs straight through (`runApply`).
	 */
	checkAsks?: { preRoll?: boolean; postRoll?: boolean }
	/**
	 * 🚧 The session's `card-draw` decks as this moment finds them, by check
	 * method key (`annex.core.rulesetDecks`); a deck absent, or of
	 * another scene, is shuffled anew. `scene` is the open scene the decks
	 * belong to (null: none open — the session is one scene); `deckSeed`
	 * seeds each shuffle, so a deck's order is fixed by session, scene and
	 * shuffle, never by the run.
	 */
	decks?: Readonly<Record<string, DeckState>>
	scene?: number | null
	deckSeed?: string
	/**
	 * 🚧 Whether time runs out on timed pieces (PLAN-genre-restructure §4,
	 * lane 2, 2026-10-19): `pieces: false` — the session's *End what runs
	 * out* task (`timed-expiry`) is Off, and nothing timed counts down or
	 * leaves; `conditions: false` — *Track conditions* (`conditions`) is Off,
	 * and the pieces of a repertoire tagged `condition` (🚧 2026-10-22) neither tick nor end. Absent
	 * (a genre that declares neither task): both run, as before.
	 */
	expiry?: { pieces?: boolean; conditions?: boolean; review?: boolean }
	/**
	 * 🚧 What each owner's zones hold (D5, 2026-10-23), by owner key then zone
	 * type id — the session's stored zones (`zones.ts`). The `carried` zone of a
	 * ruleset before sections is its repertoires' pieces, read in place.
	 */
	zones?: Readonly<Record<string, Readonly<Record<string, readonly ZoneEntry[]>>>>
	/**
	 * 🚧 What this viewer may not see (D4), by owner key: the slots whose
	 * attribute's visibility (a `gm` word or a scope) keeps them from the
	 * view the blocks are built for — worked out before the engine runs.
	 */
	hidden?: Readonly<Record<string, ReadonlySet<string>>>
}

/**
 * 🚧 A `card-draw` deck between moments (2026-10-22): the scene it was
 * shuffled for, how many times it has been shuffled there, and how many of
 * its cards are drawn. Its order is `seededRandom(deckSeed:method:scene:shuffle)`'s
 * — stored as three numbers, never as cards.
 */
export interface DeckState {
	scene: number | null
	shuffle: number
	drawn: number
}

/**
 * 🚧 What one owner's `effects`-phase scripts laid on for the events in
 * play (2026-10-22): bonuses stacked like a piece's, degree steps on checks,
 * riders in words — and each script's explain and failures.
 */
export interface ScriptedEffects {
	modifies: { target: string; value: number; label: string; bonusType?: string; seedKey: string }[]
	adjust: { target: string; by: number; seedKey: string }[]
	riders: { text: string; seedKey: string }[]
	explain: { seedKey: string; text: string }[]
	failed: { seedKey: string; why: string }[]
}

/**
 * 🚧 A check as a `pre-roll` script reads it (2026-10-22): what is
 * attempted, by whom, decided by which check method (its key, kind and
 * options), against what, the modifier's terms and the edge.
 */
export interface CheckAskContext {
	op: string
	/** Who makes the check — an owner key. */
	by: string
	selector: string
	label: string
	method: { key: string | null; kind: string; options: Record<string, unknown> }
	against?: number
	/** The selector the check reads (a modifier, a pool's size, a value compared) and its value. */
	base?: { selector: string; value: number }
	terms: { label: string; value: number }[]
	edge: number
	piece?: string
	aimedAt?: string
}

/** 🚧 A resolved check as a `post-roll` script reads it: the ask's context and how it came out. */
export interface CheckResultContext extends CheckAskContext {
	rolled?: number
	natural?: number
	faces?: number[]
	pool?: { size: number; successes: number; successOn?: number }
	cards?: OutcomeCard[]
	versus?: string
	margin?: number
	degree: { id: string; label: string; five: FiveBand } | null
}

/**
 * 🚧 What the engine asks a driver mid-check (2026-10-22): the `pre-roll`
 * scripts before a check resolves, the `post-roll` ones after. `values` are
 * the checker's resolved values.
 */
export type EngineAsk =
	| { phase: "pre-roll"; owner: string; values: Record<string, SlotValue>; check: CheckAskContext }
	| { phase: "post-roll"; owner: string; values: Record<string, SlotValue>; check: CheckResultContext }

/**
 * 🚧 A `pre-roll` answer: a target of its own, an edge, dice added to a
 * pool, another of the ruleset's check methods (by key), options laid over
 * the method's for this check, and bonuses.
 */
export interface PreRollAnswer {
	against?: number
	edge?: -1 | 0 | 1
	pool?: number
	method?: string
	options?: Record<string, unknown>
	modifies?: { value: number; label: string }[]
}

/** 🚧 A `post-roll` answer: the degree moved `shift` steps or set to a band by id, and riders told after it. */
export interface PostRollAnswer {
	shift?: number
	degree?: string
	riders?: string[]
}

/** What one owner's `derived`-phase scripts returned, laid over in phase 3. */
export interface ScriptedValues {
	/** Selector → value (`strength-mod: 3`, `proficiency: 2`). */
	values: Record<string, SlotValue>
	/** Bonuses on a check or stat (`attack.melee +2 proficiency`), stacked like a piece's. */
	modifies: { target: string; value: number; label: string; bonusType?: string; seedKey: string }[]
	/** Each script's own explain sentence. */
	explain: { seedKey: string; text: string }[]
	/** Scripts that failed or were not found — the reason, never silent. */
	failed: { seedKey: string; why: string }[]
}

// ── What it returns ─────────────────────────────────────────────────────────

/**
 * One labelled block for a context template to place (§32): its text at the
 * depth it renders at, an estimate of its tokens (the budget recounts with
 * the run's tokenizer), its `priority` (higher stays longer) and the renders
 * at the other depths, so a budget degrades a block (full → summary → index)
 * before it drops it. No `min`/`max`: a block is never truncated, only
 * stepped down or dropped (audit C5).
 */
export interface RulesetBlock {
	text: string
	tokens: number
	priority: number
	depth: RenderDepth
	/** The block at each depth it can render at. Absent depths render as the next shallower. */
	depths: Partial<Record<RenderDepth, string>>
}

/** The labelled variables (`ruleset.voice`, `ruleset.sheet`, …). */
export type RulesetBlocks = Partial<
	Record<"voice" | "sheet" | "pieces" | "ties" | "custom" | "outcomes" | "gm", RulesetBlock>
> & {
	/**
	 * 🚧 Holder-only fields and pieces, one block per acting holder, when
	 * several cast act at once — each voice's prompt places its own
	 * (`{{ruleset.holders["character:4"]}}`). With one acting holder they
	 * render inline in `sheet` instead.
	 */
	holders?: Record<string, RulesetBlock>
}

/** One term of a resolved number, with where it came from. */
export interface ExplainTerm {
	value: number
	label: string
	origin: { kind: "base" | "piece" | "bridge" | "roll" | "derived"; ref: string }
}

/** How one number was reached — for receipts and ledgers, never a prompt. */
export interface ExplainLine {
	target: string
	total: number
	terms: ExplainTerm[]
	/** `17 = d20 12 + str 3 + proficiency 2`. */
	text: string
}

/** One resolved check or effect. */
export interface Outcome {
	owner: string
	kind: "check" | "effect" | "trigger"
	/** What happened, in words — what the outcomes block reads. */
	text: string
	/**
	 * 🚧 The explain line (its `target`) this outcome's number was reached by,
	 * when it is no check's — a damage or healing roll (2026-10-18, P2-1) —
	 * so a table line can show how it was rolled.
	 */
	explainKey?: string
	check?: {
		selector: string
		/** The die face a die-target kept. Absent under any other check method. */
		natural?: number
		/** The number the check came to (`OutcomeBlock.rolled`). Absent under `none`. */
		total?: number
		against?: number
		band?: string
		five?: FiveBand
		label?: string
		/** 🚧 Who made the check, when not the outcome's owner (a traverse's actor, Q2-1). */
		actor?: string
		/** 🚧 The check method that decided it (2026-10-22): its kind, and its key in the ruleset's methods. */
		method?: string
		methodKey?: string | null
	}
	/**
	 * 🚧 The **outcome block** for this check (2026-10-22): how it was decided
	 * — dice, a pool, cards, a comparison, a spend, or a judgement — as a
	 * genre posts it in the story (`OutcomeBlock`, stored kind `dice`).
	 */
	block?: OutcomeBlock
	/**
	 * 🚧 A row on the lorebook following a held tie side (T2, 2026-10-23):
	 * the tie's entry type. The outcome line says the graph moved with it —
	 * what the in-play outcome draws as "follows the bond".
	 */
	follows?: string
}

/** A proposed change the handler refused, with the reason's name and sentence. */
export interface RejectedDelta {
	delta: ProposedDelta
	reason: string
	why: string
	/** The proposal it was filed as, when one could be (`resolve.ts`). */
	proposalId?: number | null
}

/** A change the engine decided, in `applyChangeSet`'s shape plus where it came from. */
export interface EngineChange {
	owner: StateOwner
	slotId: string
	op?: "set" | "add" | "remove"
	value?: SlotValue
	items?: SlotPiece[]
	note?: string
	/**
	 * 🚧 Filed for review rather than applied (lane 2, 2026-10-19): a change
	 * a task on **Review** made — timed expiry on *End what runs out*'s
	 * Review. `resolve.ts` sends it through the gate in `propose` mode.
	 */
	held?: boolean
}

export interface EngineOutput {
	blocks: RulesetBlocks
	facts: Record<string, unknown>
	outcomes: Outcome[]
	explain: ExplainLine[]
	rejected: RejectedDelta[]
	changes: EngineChange[]
	/** Refused deltas a reviewer could still accept, as the change they would make. */
	reviewable: { change: EngineChange; rejected: RejectedDelta }[]
	/** 🚧 The `card-draw` decks this moment drew from, as it left them — `resolve.ts` stores them. */
	decks?: Record<string, DeckState>
}

/**
 * 🚧 An event a function raised (D3, 2026-10-23): collected while the moment
 * runs and **emitted after the receipt** (`emits.ts`), never inside it —
 * the event's id, its payload, the function that raised it and the owner it
 * ran for.
 */
export interface PendingEmit {
	event: string
	payload?: unknown
	key: string
	owner?: string
}
