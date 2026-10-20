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
	value?: unknown
	/** A piece: its name, a compendium row id, or a written-out piece. */
	piece?: unknown
	reason?: string
	/** `hit` / `use` / `traverse`: the selector the check is on. */
	check?: string
	/** `hit` / `use` / `traverse`: the number the check is against. */
	against?: number
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
	 * 🚧 Whether time runs out on timed pieces (PLAN-genre-restructure §4,
	 * lane 2, 2026-10-19): `pieces: false` — the session's *End what runs
	 * out* task (`timed-expiry`) is Off, and nothing timed counts down or
	 * leaves; `conditions: false` — *Track conditions* (`conditions`) is Off,
	 * and the `conditions` repertoire's pieces neither tick nor end. Absent
	 * (a genre that declares neither task): both run, as before.
	 */
	expiry?: { pieces?: boolean; conditions?: boolean; review?: boolean }
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
		natural: number
		total: number
		against?: number
		band?: string
		five?: FiveBand
		label?: string
		/** 🚧 Who made the check, when not the outcome's owner (a traverse's actor, Q2-1). */
		actor?: string
	}
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
}
