/**
 * The host's own types: a run's scope (`HostScope`), the fires an outlet
 * commits (`PendingFire`), the refusal a mis-scoped read or write throws
 * (`HostScopeError`), core's widening of the SDK's `HostServices`, and a
 * session's per-channel prompt shaping.
 *
 * A leaf: `host.ts` re-exports what it exported, and every `host.*.ts` reads
 * these from here, never from `host.ts`.
 */

import type {
	FormAddressedPayload,
	FormBlock,
	HostServices,
	NodeRef,
	ParticipantRef,
	Portrayals,
	RunLineage
} from "@serene-pub/sdk"
import type { RunProgress } from "$lib/shared/sockets/progress"
import type { RunArtifact } from "$lib/server/pipelines/runtime/receipts"
import type { FormAwaitingPerson } from "$lib/server/notifications/openForm"
import type { LiveRow, SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import type { StatusRelay } from "$lib/server/pipelines/runtime/runStatus"
import type { ChannelRole, ChannelVoice } from "$lib/server/messages/channels"

/**
 * A fire an outlet committed for the host to dispatch after the receipt
 * (U5d review, W2) — everything `fireAction` needs, plus the child's run id,
 * chosen at the commit so the committing run's receipt can name it, and the
 * spec the fire routes to, so a refusal can be receipted against it.
 */
export interface PendingFire {
	runId: string
	specId: string
	/** The identity the fire names — the block's stamped `action`, else the sole declarer of its `fn` (plans/31 V2). */
	action: string
	messageId: number
	blockId: string
	payload: Record<string, unknown>
	/** The participant the fire is made as — the form's addressee. */
	as: ParticipantRef
	/**
	 * The cycle cap that refused the fire at the commit (01 §8; U5d review
	 * S-b), when one did. The commit only records it: the would-be child's
	 * row is written by `dispatchFires`, **after** the committing run's own
	 * receipt, so the tree's rows land in dispatch order — a refusal
	 * receipted inside the commit landed the child before its parent.
	 * A fire carrying this is never dispatched.
	 */
	refused?: string
}

export interface HostScope {
	/**
	 * The run these effects belong to.
	 *
	 * Read by everything that has to be attributable *outside* the graph: the
	 * progress an image render reports, which a client keys its card on and
	 * cancels by, and the run a prompts-slot template renders under — the same
	 * association `RenderRun` makes for the two rendering bindings, because a
	 * template naming a plugin's engine is a sandboxed hook call and
	 * cancellation reaches it only by run id.
	 *
	 * **Optional, and legitimately absent.** `createHost` takes no scope at all
	 * for a caller that has none — the parity harness, a test poking one
	 * binding — and a host with no run is one nothing is trying to attribute.
	 * `runSpec` always has a run and always passes it, so an absent id here
	 * means a host wired by hand rather than a run that lost its name; an id
	 * invented to satisfy the type would be worse than the absence, since it
	 * would name a run nobody can find.
	 */
	runId?: string
	/**
	 * Each model call's loadout chain in receipt words, keyed by node key
	 * (I12; `loadoutChainsOf(world)`). Absent on a host wired by hand.
	 */
	loadoutChains?: Record<string, string>
	/** The session this run belongs to. Reads outside it are refused, not filtered. */
	sessionId?: number
	/**
	 * 🚧 A lorebook this run is granted beside its session's own (2026-09-27,
	 * the lorebook stat reads): a run triggered against a BOOK rather than a
	 * session — none is wired yet — reads that book's stats with no session.
	 * `lorebook_state` / `stat_trail` read the session's lorebook or this
	 * one and refuse any other (`lorebookInScope`).
	 */
	lorebookId?: number
	/**
	 * 🚧 The card a **card action** runs on (`runtime/cardAction.ts`) — set
	 * only there, with no session. A model call's files may be that card's
	 * own (`dispatch.ts` `resolveAttachments`): the caller checked the person
	 * may act on the card.
	 */
	cardCharacterId?: number
	/**
	 * 🚧 The cast member a **card action** runs on, set only by `runCardAction` for a member run
	 * (then `cardCharacterId` is unset).
	 */
	cardActionCastMemberId?: number
	/** Who triggered the run, for authorship on writes. */
	userId?: number
	/**
	 * 🚧 The applet that draws this session, on a run that came through the
	 * session's press door (`frameCauseOfRun`). Carried beside `userId` onto each plugin hook
	 * call this run makes; the library-write node below still asks its own
	 * `libraryWriteMode`, not this.
	 */
	frameCause?: import("$lib/server/sockets/appletCause").FrameCause
	/**
	 * A message being composed but not yet stored.
	 *
	 * The draft preview (`sessions:promptTokenCount`) fires on a debounce while
	 * somebody types, so the text it is previewing is intentionally not a row.
	 * The turn itself never needs this — by then the user's message has been
	 * written — which is why it lives on the scope rather than on a port.
	 *
	 * Appended by the `session_messages` read, so every Query that reads history
	 * sees the same conversation the run would see. Doing it in one binding
	 * instead would leave retrieval scoring against a message the renderer
	 * shows, or the reverse.
	 */
	draftMessage?: { content: string; personaId?: number | null }
	/**
	 * Whose turn it is. Null in narrator mode.
	 *
	 * A property of the run, like `sessionId` — and it has to reach the provider,
	 * because `composeStops` (`connections/stops.ts`) excludes the *speaking*
	 * character's own name from the stop list. Without it the prompt seeds `Ash: ` and also stops on
	 * `Ash:`, so any model that opens by repeating the name returns an empty
	 * string. The legacy path passed it on the adapter; the pipeline's
	 * `generate-text` node has no port for it, and nothing carried it.
	 */
	currentCharacterId?: number | null
	/**
	 * 🚧 The speaker of a card-less seat; set only when `currentCharacterId`
	 * is null — a member id, never a card id.
	 */
	currentCastMemberId?: number | null
	/**
	 * Who portrays each participant this run concerns — resolved once at
	 * run start by `resolvePortrayals` and pinned on the receipt (R-21 (4)).
	 * Here, read-only, for the host's own seams that need the answer
	 * without a port (the form-addressed pipeline, U5d). ⚠ Never exposed on
	 * a node's `ctx`: nodes stay blind to who is present, and a definition
	 * that needs the answer declares an in-port the spec wires. Absent for
	 * a host wired by hand, and on a pre-call preview (`runSpec`).
	 */
	readonly portrayals?: Portrayals
	/**
	 * The message verb re-driving this run's row, when one is — a
	 * `regenerate`, a `swipe`'s fresh alternative or an `extend` (R-15,
	 * 2026-09-16). Read by `update-message` at the finishing write so the
	 * `message-updated` it emits says which verb rewrote the row, and the
	 * next reply's inlet sees the rewrite in its `sessionChanges`. Absent on a
	 * fresh turn, whose finishing write changes no history a pipeline has
	 * seen.
	 */
	verb?: "regenerate" | "swipe" | "extend"
	/**
	 * Which channel this turn was **triggered on** — the stored string, lane
	 * included (`main`, `manuscript`, `phone:3`). Absent means `main`, which
	 * is every session whose genre declares no channel of its own.
	 *
	 * ⚠ A property of the run and not of a row, which is why it is here: the
	 * turn's channel is decided by the trigger, and the newest message is
	 * only *usually* on it. The one thing the host does with it is answer
	 * what that channel's declared `voice` is (`turnChannelVoice` on the cast
	 * read), from the shaping it already caches — so the seed line is the one
	 * the channel calls for even before that channel has any rows.
	 */
	channel?: string
	/**
	 * What the verb's row held before its handler cleared it — a
	 * regenerate's (U5b review W3). Recorded as `previous` on the
	 * `message-updated` the finishing write emits, so the next reply's inlet
	 * sees what the regenerate replaced the way it sees what an edit
	 * replaced. Absent on every other verb: a swipe's fresh alternative keeps
	 * the old text in the row's history and `message-swiped` already carried
	 * it; an extend replaces nothing.
	 */
	previous?: { content: string }
	/**
	 * The form this run was fired to ANSWER (U5f, R-15 *Staleness and
	 * order*) — a press on a `choices`/`form` block, by a person or by the
	 * answer pipeline. `fireAction` puts it here the way `verb` rides, and
	 * `create-message` stamps it on every row the run writes as
	 * `metadata.answersForm`, so the row reads as the answer to that form
	 * and never as the conversation moving on from the form's row
	 * (`stalenessHead`). Absent on every run that is not a form's answer.
	 *
	 * `toOwner` (lair pass B12): the form was put to the session's OWNER —
	 * an out-of-fiction question, like the Lair's knock. The owner's own line
	 * in answer is their steering, so it lands as a send (see
	 * `message-completed` in `create-message`). Never stamped on the row.
	 */
	answersForm?: { messageId: number; blockId: string; toOwner?: boolean }
	/**
	 * 🚧 The **plan row** whose turn this run takes (Lair character turns,
	 * owner ruling 2026-09-30) — set by `runReply` for a planned turn (a fire
	 * `via: 'plan'`, or a verb re-driving a row one wrote), the way
	 * `answersForm` rides. `create-message` stamps it on every row the run
	 * writes as `metadata.planRowId`: a planned turn's rows belong to the
	 * turn that planned them, so its yield, its retake and the world's open
	 * anchor read them as that turn's (`turnYield.ts`, `state/write.ts`).
	 * Absent on every other run.
	 */
	planRowId?: number
	/** 🚧 The depth below which this run's `sources` may not reach (its registration's `minAgeOf`); absent = 0. */
	minAge?: number
	/** 🚧 Every message id a read handed this run (pass 5b's read frontier) — the receipt check on `sources`. Mutated in place. */
	readMessageIds?: Set<number>
	/**
	 * The document this run is executing, by slug — `runSpec` always names
	 * it. Read by the built-in writes' commits, which refuse to perform under
	 * any document but the built-in's own (U5b review W8): the item rule was
	 * judged by the handler that started THAT spec, and a payload reaching
	 * `delete-message@1` from any other document was judged by nobody.
	 * Absent on a host wired by hand, which no built-in reaches.
	 */
	specId?: string
	/**
	 * **Who owns the document this run is executing** — the plugin's slug
	 * (`showcase.battleship`), or absent when the spec is core's (D-6).
	 *
	 * Resolved at `runSpec` from the spec ROW's `source_plugin_id`, never from
	 * the id's namespace segment. The difference is the whole point: a
	 * namespace is a claim a manifest makes about itself, and ownership is a
	 * fact this instance wrote when it installed the package. A document that
	 * named itself `core:spec/…` would read as core's from its id and as a
	 * plugin's from its row, and only one of those was checked at install.
	 *
	 * `readonly`, and read by the host's own seams rather than exposed on a
	 * node's `ctx`: nodes stay blind to who owns the document running them, the
	 * same posture `portrayals` takes. No commit case charges work to it yet —
	 * the plugin-data outlet stays unbound — so today its one reader is
	 * `assertBuiltInSpec`, which refuses a built-in write to any owned
	 * document.
	 *
	 * ⚠ Not `NodeRef`. A node's owner is its DEFINITION's owner, which is a
	 * different question with a different answer inside one run: a plugin's
	 * spec is mostly core's nodes.
	 */
	readonly ownerPluginId?: string
	/**
	 * What the running document contributes — its `contributes.actions[]`
	 * (U5d). Read by the message writes to stamp a block's `action` with the
	 * identity of the declaration it fires (`stampBlockActions`) and to
	 * refuse a block naming a key this document declares no action for,
	 * or one whose action is `world` (the effects line). Absent on a host
	 * wired by hand, where no block is stamped.
	 */
	contributes?: unknown
	/**
	 * The running document's inlet, pinned (`core:inlet/user-message@1`).
	 * Read by `answer-form`, which performs only under
	 * `core:inlet/form-addressed@1` — the form it answers is the one the
	 * event carried, and a document entered any other way has none (U5d).
	 */
	inletDefinitionId?: string
	/**
	 * The running document's inlet lock — the events it hears. Read by
	 * `record-event`, which judges the recording scope on the subjects this
	 * document serves (E1b); the running document's, not its row's, so a
	 * draft run or a republish mid-run is judged on what actually runs.
	 */
	input?: { event?: string; events?: readonly string[] }
	/**
	 * The running document's nodes, every rebind already applied (session and
	 * instance scope alike — `applyNodeRebinds` ran at load). Read by
	 * `turnStrategyPin`, so the order's `strategy` names what actually ran.
	 */
	nodes?: ReadonlyArray<{ key: string; kind: string; definitionId: string; definitionVersion: number }>
	/**
	 * Where this run stands in a tree of runs (01 §8; U5d) — absent for a
	 * root. Read by `answer-form`, whose fire is this run's child.
	 */
	lineage?: RunLineage
	/**
	 * This run was fired by auto-advance (PLAN-turn-order §4.6). Rides onto
	 * every session event the run's writes cause, as `cause.auto`.
	 */
	auto?: boolean
	/**
	 * How this turn was reached — the fired entry's `via` (`runTurn`'s request; `strategy`,
	 * `script`, `voice`, `pick`, `narrate`, `unprompted`…). Read by the message write, which
	 * stamps an unprompted narrator line's `turnCause` (★T-1). Absent on a host wired by hand.
	 */
	via?: string
	/**
	 * The forms this run addressed to a participant the AI portrays (R-15
	 * *Forms*; U5d), pushed by the message writes when a block's
	 * `addressee` resolves — through the pinned `portrayals` — to `ai`, and
	 * dispatched as `form-addressed` by `runSpec` once the receipt is saved.
	 * Mutated in place like `artifacts`, for the same reason. Absent on a
	 * host wired by hand, where an addressed form is written and waits.
	 */
	addressed?: Array<{ payload: FormAddressedPayload; form: FormBlock }>
	/**
	 * The forms this run put to a PERSON — or to nobody, or to a reference
	 * the run never pinned, which the owner answers — pushed by the same
	 * message writes beside `addressed`, so `runSpec` can raise their
	 * `open-form` notifications once the receipt is saved
	 * (PLAN-notifications §5; `notifications/openForm.ts`). Mutated in place
	 * like `addressed`. Absent on a host wired by hand: its forms wait
	 * unannounced.
	 */
	formsAwaitingPeople?: FormAwaitingPerson[]
	/**
	 * The fires this run committed and did not run (U5d review, W2): an
	 * `answer-form` commit checks the oracle's answer, asks the cycle caps,
	 * chooses the child's run id and **collects** the fire here; `runSpec`
	 * dispatches each through `fireAction` once this run's receipt is saved
	 * — outside any node timeout, as this run's child, with this run's `io`
	 * and stop signal. Mutated in place like `addressed`, for the same
	 * reason. Absent on a host wired by hand, where nothing fires.
	 */
	fires?: PendingFire[]
	/**
	 * Where streamed tokens go while a Provider is still generating, for a
	 * caller that is not filling a message row — the comparison tool, a test.
	 *
	 * A reply's stream goes to the run's **live row** (`live`), routed by core
	 * from the executor's `run.liveRow` (R-21 (2)); this sink is the older
	 * seam and still honoured beside it. On the scope rather than in the call
	 * payload, because a payload is a *value*: it lands in the receipt and in
	 * every downstream node's input, and a socket handle is not a thing to
	 * write down.
	 */
	sink?: {
		onChunk?: (chunk: string) => void
		onReasoning?: (chunk: string) => void
		/**
		 * Where a Provider that cannot stream reports its progress instead.
		 *
		 * Text arrives a token at a time, so streaming IS the progress report. An
		 * image arrives all at once after a minute of silence, so without this
		 * there is nothing to show but a spinner and no way to tell a slow render
		 * from a hung one. Same reasoning for it living on the scope rather than
		 * the payload: a callback is not a value to write into a receipt.
		 */
		onProgress?: (event: RunProgress) => void
	}
	/** Aborts an in-flight provider call when the run is cancelled. */
	signal?: AbortSignal
	/**
	 * Where this host writes down what it made — the run's artifact collector.
	 *
	 * ⚠ **The single source of truth for a run's output.** Every commit below
	 * that writes a row pushes one entry; `generate-image` pushes through
	 * `dispatchImage`, whose `createMedia` loop is the only place the file and
	 * variant ids exist. `saveReceipt` turns the array into
	 * `pipeline_run_artifacts` rows and derives `is_preview` from whether it is
	 * empty.
	 *
	 * The array is **mutated in place** rather than returned, because the
	 * commits are called by the executor and their return values are node
	 * outputs — a published port shape, not a channel back to the host's owner.
	 *
	 * **Optional, and legitimately absent**, exactly like `runId`: a host wired
	 * by hand (the parity harness, a test poking one binding) has no run to
	 * attribute anything to, and pushing into an array nobody reads would be
	 * bookkeeping with no reader. `runSpec` always supplies one.
	 */
	artifacts?: RunArtifact[]
	/**
	 * Where the rows this run writes are announced to the session's users.
	 *
	 * The pipeline owns its reply row (09-B B4, R-17): the placeholder the
	 * composer shows is the row `create-message` commits, so the commit is
	 * what broadcasts it — the trigger inserts nothing. Absent,
	 * nothing is broadcast: a host wired by hand, an event-triggered run with
	 * no socket behind it. A socket server is not a value and never reaches a
	 * payload; it lives on the scope for the same reason `sink` did.
	 */
	io?: SessionIo
	/**
	 * The run's live row — streaming, the queue item, the stage, and what
	 * happens to the row if the run ends with it still open. Created by
	 * `runSpec` beside the scope and read here at the oracle's call with the
	 * executor's `run.liveRow`. See `liveRow.ts`.
	 */
	live?: LiveRow
	/**
	 * The run's status relay (R-19) — where `ctx.status` lands after the
	 * executor: `{speaker}` filled, the live row written, the session list
	 * told. Read here for the one status the host itself sets: the LLM
	 * queue's `queued` / `loading` on the oracle's call, said in the same
	 * voice as a node's. Absent on a host wired by hand and on a pre-call
	 * preview, where nobody is watching.
	 */
	status?: StatusRelay
}

export class HostScopeError extends Error {}

const PEOPLE_SENTENCE = Symbol.for("serene-pub.peopleSentence")

/**
 * 🚧 Marks a halt's words as for the people in the session: the raise site
 * says so, never a text match. Returns `value`; does nothing when `sentence`
 * is not a non-empty string, so a pass-through can write
 * `forPeople(x, peopleSentenceOf(e))`.
 */
export function forPeople<T extends object>(
	value: T,
	sentence: string | undefined
): T {
	if (typeof sentence === "string" && sentence !== "") {
		;(value as Record<symbol, unknown>)[PEOPLE_SENTENCE] = sentence
	}
	return value
}

/** 🚧 The people sentence `forPeople` attached to `value`, or `undefined`. */
export function peopleSentenceOf(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null) return undefined
	const s = (value as Record<symbol, unknown>)[PEOPLE_SENTENCE]
	return typeof s === "string" ? s : undefined
}

const peopleHaltsByRun = new Map<
	string,
	Array<{ said: string; sentence: string }>
>()

/**
 * 🚧 Records, under the run, a halt a binding saw marked for people; a
 * binding knows its run id but not its node key or the scope. No-op without a
 * run id.
 */
export function notePeopleHalt(
	runId: string | undefined,
	said: string,
	sentence: string
): void {
	if (!runId) return
	const list = peopleHaltsByRun.get(runId) ?? []
	list.push({ said, sentence })
	peopleHaltsByRun.set(runId, list)
}

/**
 * 🚧 The people sentence of the recorded halt whose words are `haltReason`
 * (the last such), and always forgets the run's records. The equality only
 * identifies which recorded halt ended the run; the raise site decided
 * whether it is for people.
 */
export function takePeopleSentence(
	runId: string,
	haltReason: string | undefined
): string | undefined {
	const list = peopleHaltsByRun.get(runId)
	peopleHaltsByRun.delete(runId)
	if (!list || haltReason === undefined) return undefined
	for (let i = list.length - 1; i >= 0; i--) {
		if (list[i].said === haltReason) return list[i].sentence
	}
	return undefined
}

/** A session's per-channel prompt shaping, by slug — see `channelShapingOf`. */
type ChannelShaping = Map<string, { role: ChannelRole; voice?: ChannelVoice }>

/**
 * Core's host, and the one fact it says about itself that `HostServices` has no
 * field for: which plugin owns the document being run (D-6).
 *
 * An app-side widening rather than an SDK field, because the answer is an
 * instance's — it comes from a row this install wrote — and `HostServices` is
 * the contract a *test* host implements too. Read-only: nothing may set a run's
 * owner after the scope was built.
 */
export interface CoreHostServices extends HostServices {
	readonly ownerPluginId?: string
}

/**
 * What a `read` case that lives outside `createHost` is handed: the host's
 * database, scope and self, the node that asked and its query.
 */
export interface HostReadArgs {
	db: Db
	scope: HostScope
	host: CoreHostServices
	node: NodeRef
	q: Record<string, any>
}

export { type ChannelShaping }
