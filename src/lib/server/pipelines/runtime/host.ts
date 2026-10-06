/**
 * Core's side of the executor: the I/O a binding is not allowed to do itself.
 *
 * The executor sequences; the host performs effects. A binding describes what
 * it wants — "read these messages", "write this message" — and this module is
 * what actually touches the database. That split is not ceremony:
 *
 *   · it is the only way a **sidecar** Consumer can ever work, since a separate
 *     process has no database channel (F19). In-process and out-of-process
 *     Consumers obeying the same contract means the review gate sees the same
 *     thing in both cases — a payload, before anything has happened.
 *   · it keeps every effect inside the substrate the review gate, the budget
 *     and the receipt already sit in. A binding that closed over `db` would be
 *     outside all three, and nothing would look wrong until an admin asked why
 *     a run wrote something the receipt does not mention.
 *
 * Scope enforcement lives here too, for the same reason: the host is handed the
 * **node** that asked, so a Query's read is checked against what that spec is
 * allowed to see rather than against the query it happened to send (F30).
 */

import { and, asc, count, desc, eq, gte, inArray, isNull, sql, type SQL } from "drizzle-orm"
import { MAIN_LINE } from "$lib/shared/lorebooks/lineReading"
import * as schema from "$lib/server/db/schema"
import {
	BINDING_VISIBILITY_POLICY,
	ENTRY_TYPE_IDS,
	WORLD_LORE_TYPE_ID,
	entryInsert,
	isEntryTypeId,
	nextPosition,
	toEntryRow
} from "$lib/server/utils/lorebookEntries"
import { entryDeclaration, bandOfType } from "$lib/server/entries/declarations"
import {
	MENTION_EXTRACTOR_VERSION,
	extractMentions
} from "$lib/server/pipelines/ranking/mentions"
import { buildScanWindow } from "$lib/server/pipelines/ranking/signals"
import type {
	FoldedSectionV1,
	FormAddressedPayload,
	FormBlock,
	HostServices,
	MediaRef,
	MessageBlock,
	NodeRef,
	ParticipantRef,
	Portrayals,
	RunLineage
} from "@serene-pub/sdk"
import type { ToolDeclaration } from "$lib/server/adapters/actions"
import {
	slotRef,
	isBuiltInSpec,
	isParticipantRef,
	parseParticipantRef,
	envoySlugOfRef,
	UNCLAIMED_LINE_NAME,
	FORM_ADDRESSED_INLET_ID,
	assignBlockHead,
	assignBlockIds,
	checkMessageBlocks,
	checkFoldedSections,
	foldedSectionsOf,
	withFoldedSections,
	foreignBlockActions,
	formBlocksOf,
	formFireOf,
	formAnswerSchema,
	stampBlockActions,
	undeclaredBlockFunctions,
	effectsLineVerdict,
	i18nText,
	opensLiveRow
} from "@serene-pub/sdk"
import { randomUUID } from "node:crypto"
import { CORE_BLOCKS_PART } from "$lib/server/messages/blocks"
import { loreWriteRefusal, loreWritesOffRefusal } from "$lib/server/messages/writes"
import { slotModelId } from "$lib/shared/connections/slotRef"
import type { RunProgress } from "$lib/shared/sockets/progress"
import type { RunArtifact } from "$lib/server/pipelines/runtime/receipts"
import { participantRowId } from "$lib/server/pipelines/runtime/portrayals"
import type { FormAwaitingPerson } from "$lib/server/notifications/openForm"
import { resolvePersonaName } from "$lib/shared/utils/resolveCharacterName"
import { streamingModeFrom } from "$lib/server/connections/streaming"
import { tether } from "$lib/server/pipelines/runtime/callTether"
import type { LiveRow, SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import type { StatusRelay } from "$lib/server/pipelines/runtime/runStatus"
import { broadcastToSessionUsers } from "$lib/server/sockets/utils/broadcastHelpers"
import { speakerRefOf } from "$lib/server/messages/sessionChanges"
import { errorWithoutQueryText } from "$lib/server/db/errors"
import {
	assertRelationshipWrite,
	linksOnReadingThatWay,
	LINKED_THAT_WAY,
	type LinkOnReading
} from "$lib/server/utils/relationshipGuards"
import { RELATIONSHIP_TEXT_LIMITS } from "$lib/shared/lorebooks/linkVocabulary"
import type { LineReading } from "$lib/server/state/reading"
import { SHOW_SPRITE_SPEC_ID } from "@serene-pub/core-catalog"
import {
	asShownSprite,
	nextSpriteMetadata,
	type ShownSprite
} from "$lib/shared/sprites"
import {
	DEFAULT_CHANNEL,
	DEFAULT_LANE,
	byLaneThenTime,
	canonicalChannel,
	channelRefusal,
	channelsOf,
	channelSpansLanes,
	channelWhere,
	isAllChannels,
	parseChannel,
	resolveChannel,
	sessionChannelShaping,
	stalenessHead,
	type ChannelRole,
	type ChannelVoice
} from "$lib/server/messages/channels"

// db is the global Db — see db/types.d.ts

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
	/** Who triggered the run, for authorship on writes. */
	userId?: number
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

/** One legacy message row — the model the reply path still writes. */
async function legacyMessage(db: Db, id: number) {
	const [row] = await db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, id))
		.limit(1)
	return row
}

/**
 * What follows a reply landing: the row is embedded for retrieval, and the
 * session's backlog is queued. Off the write, because that is where every
 * road converges now — a reply, a narration, a tool loop's answer.
 *
 * Both halves swallow: `autoEnqueueSession` is the fallback that catches a
 * message up through the background queue whether or not the inline embed
 * managed, and a reply that was written and then could not be embedded has
 * still been written.
 */
async function settledMessage(
	messageId: number,
	sessionId: number
): Promise<void> {
	const { autoEnqueueSession, ensureSessionMessageEmbedded } = await import(
		"$lib/server/embedding/vectorizationQueue"
	)
	try {
		await ensureSessionMessageEmbedded(messageId)
	} catch (err) {
		console.error(
			"[vectorization] Inline embed of new message failed:",
			err
		)
	}
	autoEnqueueSession(sessionId).catch(console.error)
}

/**
 * Whose annex a spec reads and writes by default (PLAN-turn-order §4.3):
 * its own **namespace** — the segment before the colon in its slug.
 * `core:spec/<genre>-turn-order` owns `core`; `acme.rp:spec/clock` owns `acme.rp`;
 * a user-authored spec owns `user:<slug>`. A host with no spec named (wired
 * by hand) owns `core`, which is the only owner such a host could mean.
 */
/**
 * Which definition produced the order being written (§4.2's `strategy`).
 *
 * Found by what the nodes are, never by a key (R26, M4): with the session's
 * `turnMode` at `model`, the spec's oracle produced it (the model path's
 * junction fires on exactly that); otherwise the task whose `main` publishes turn entries
 * — `strategy` on the plain line, `decide.rules.strategy` behind a model
 * path, whatever a plugin's spec calls it. Read off the running document,
 * where every rebind is already applied, so a receipt and the run cannot
 * disagree about what ran.
 *
 * Null for a spec with no such node, or a host with no document; nothing
 * else in core writes a turn order, so that is a hand-wired host.
 */
async function turnStrategyPin(
	db: Db,
	specId: string | undefined,
	sessionId: number,
	running?: HostScope["nodes"]
): Promise<string | null> {
	// The running document only: it carries every rebind, at every scope,
	// already applied — the same answer the run gave, by construction. A host
	// wired by hand with no document names no strategy; a second reading from
	// rows here would miss instance-scope rebinds and disagree (A7r review).
	if (!specId || !running?.length) return null
	return await strategyOfNodes(db, sessionId, running)
}

/** The strategy among a document's nodes: its oracle under `turnMode: model`, else the task publishing turn entries. */
async function strategyOfNodes(
	db: Db,
	sessionId: number,
	nodes: NonNullable<HostScope["nodes"]>
): Promise<string | null> {
	const oracle = nodes.find((n) => n.kind === "oracle")
	if (oracle) {
		const { resolveSessionSettings } = await import("$lib/server/sessions/settings")
		if ((await resolveSessionSettings(db, sessionId))?.fields?.turnMode === "model")
			return `${oracle.definitionId}@${oracle.definitionVersion}`
	}
	const registry = await db
		.select({
			definitionId: schema.pipelineDefinitionRegistry.definitionId,
			version: schema.pipelineDefinitionRegistry.version,
			ports: schema.pipelineDefinitionRegistry.ports
		})
		.from(schema.pipelineDefinitionRegistry)
	const publishesEntries = new Set(
		(registry as any[])
			.filter((r) => r.ports?.out?.main === "core:shape/turn-entries@1")
			.map((r) => `${r.definitionId}@${r.version}`)
	)
	const producer = nodes.find(
		(n) => n.kind === "task" && publishesEntries.has(`${n.definitionId}@${n.definitionVersion}`)
	)
	return producer ? `${producer.definitionId}@${producer.definitionVersion}` : null
}

/**
 * Every reference that may hold a turn in this session now: seated
 * characters and personas (a persona is a character row, 0132), and seated
 * envoys that speak in turn. Removed seats and on-action envoys are never
 * in it — the pool's floors, restated where the write happens.
 */
async function liveCastRefs(db: Db, sessionId: number): Promise<Set<string>> {
	const [characters, personas, envoys] = await Promise.all([
		db
			.select({ characterId: schema.sessionCharacters.characterId })
			.from(schema.sessionCharacters)
			.where(
				and(
					eq(schema.sessionCharacters.sessionId, sessionId),
					isNull(schema.sessionCharacters.removedAt)
				)
			),
		db
			.select({ personaId: schema.sessionPersonas.personaId })
			.from(schema.sessionPersonas)
			.where(
				and(
					eq(schema.sessionPersonas.sessionId, sessionId),
					isNull(schema.sessionPersonas.removedAt)
				)
			),
		import("$lib/server/pipelines/entities/envoys").then(({ seatedEnvoys }) =>
			seatedEnvoys(db, sessionId)
		)
	])
	const out = new Set<string>()
	for (const r of characters) if (r.characterId != null) out.add(`character:${r.characterId}`)
	for (const r of personas) if (r.personaId != null) out.add(`character:${r.personaId}`)
	for (const e of envoys as Array<{ slug: string; speaks?: string; removedAt?: unknown }>)
		if (e.removedAt == null && e.speaks !== "on-action") out.add(`envoy:${e.slug}`)
	return out
}

function annexOwnerOf(specId: string | undefined): string {
	if (!specId) return "core"
	const at = specId.indexOf(":")
	return at > 0 ? specId.slice(0, at) : specId
}

/** Deep equality for plain JSON values, key order ignored — what jsonb compares. */
function sameJson(a: unknown, b: unknown): boolean {
	const norm = (v: unknown): unknown =>
		Array.isArray(v)
			? v.map(norm)
			: v && typeof v === "object"
				? Object.fromEntries(
						Object.keys(v as object)
							.sort()
							.map((k) => [k, norm((v as Record<string, unknown>)[k])])
					)
				: v
	return JSON.stringify(norm(a)) === JSON.stringify(norm(b))
}

/**
 * The narrator's display name for a session, snapshotted onto a narration row
 * at the write so a later rename does not relabel messages already made.
 *
 * The `narratorName` field of the narrator pipeline's `context` prompts, as
 * that session resolves it — its own selection or override, else the
 * instance's configuration, else the shipped prompt. Read through the run's
 * `db` rather than the global one, for the reason every host read is: a run
 * against another database must not quietly read this from the
 * application's. Null when nothing resolves a name (no narrator pipeline
 * published), and callers fall back to "Narrator".
 */
export async function narratorNameFor(
	db: Db,
	sessionId: number,
	_userId: number | undefined
): Promise<string | null> {
	const [{ buildWorld }, { resolveConfigSources }, { CHAT_NARRATE_SPEC_ID }] =
		await Promise.all([
			import("$lib/server/pipelines/config/world"),
			import("@serene-pub/sdk"),
			import("$lib/server/pipelines/specs")
		])
	const world = await buildWorld(db, { specId: CHAT_NARRATE_SPEC_ID, sessionId })
	const sourced = resolveConfigSources(world as any, ["context"]) as any
	const name = sourced?.context?.prompts?.narratorName?.value
	return typeof name === "string" && name.trim() ? name : null
}

/**
 * The Providers that are "one prompt, one call, one string".
 *
 * A set rather than a switch: they take the same path, so enumerating them as
 * cases would be eleven copies of one line and eleven chances to omit the
 * twelfth.
 */
const STEP_TYPE_LIST = [
	"core:oracle/summarize-batch",
	"core:oracle/summarize-synth",
	"core:oracle/name-entry",
	"core:oracle/extract-cast",
	// The turn-order model path (PLAN-turn-order R41, M4).
	"core:oracle/turn-advise",
	"core:oracle/graph-pre-filter",
	"core:oracle/graph-node-resolution",
	"core:oracle/graph-perspective",
	"core:oracle/graph-node-description",
	"core:oracle/graph-state-detection"
]

const STEP_TYPES = new Set(STEP_TYPE_LIST)

/** Exported under a test-only name so a suite can check the set is complete. */
export const STEP_TYPES_FOR_TEST = STEP_TYPE_LIST

/**
 * How long an extension's tool hook may take.
 *
 * Shorter than a plugin *node*'s thirty seconds, and deliberately: a node runs
 * once on the spine, while a tool runs once per iteration of a loop bounded at
 * eight or more — so the same number would be a turn a person waits four
 * minutes for. The node's own `timeoutMs` (`core:oracle/run-tool@1`) bounds
 * the whole invocation on top of this; this is the inner deadline the sandbox
 * enforces.
 */
const TOOL_HOOK_TIMEOUT_MS = 15_000

/**
 * A slot reference's row id.
 *
 * A resolved `connection` or `sampling` slot is the id of a row in its own
 * table — never the row. Accepts the object form too, because a preset written
 * before configs existed may carry `{ ref: 3 }`.
 *
 * ⚠ The two slots do not resolve to the same KIND of thing, and this function
 * is where that stopped being an implementation detail. A `connection` resolves
 * to a reference (`{ id, kind, metadata }`); a `sampling` resolves to the
 * config's VALUES, id deliberately stripped, because the nodes that read a
 * sampling slot need the numbers — `core:task/context-budget@1` derives the
 * token budget from `contextTokens` and the batch cutter fits a transcript into
 * that same window. So this read `null` for every sampling slot ever resolved,
 * a per-node pick reached no dispatcher, and `resolveCapabilityTarget` — which
 * treats `null` as "this tier said nothing" — fell through to the capability
 * default. The budget moved with the pick and the request did not.
 *
 * `slotRef` is the executor's own answer to "which row did these values come
 * from", carried on the values object under a symbol so no value reader sees it.
 * Asked FIRST, because on a sampling slot the values may legitimately contain
 * neither `ref` nor `id` and the fallthrough below would go back to `null`.
 */
const refId = (v: unknown): number | null => {
	if (typeof v === "number") return v
	if (typeof v === "string" && /^\d+$/.test(v)) return Number(v)
	if (v && typeof v === "object") {
		const carried = slotRef(v)
		if (carried !== null) return refId(carried)
		// Recurses rather than restating a narrower rule: the executor hands
		// back `{id}` where the id is a STRING, and the branch above already
		// accepts a numeric string. Demanding a number here would make every
		// resolved slot null.
		return refId((v as any).ref ?? (v as any).id)
	}
	return null
}

/**
 * A message row id, as a spec hands one over: a bare id, or the
 * `{ status, ids }` write result an outlet publishes — `$.save.messageId` IS
 * that result, and `refId` alone reads its `id`, which it has none of.
 */
const messageRefId = (v: unknown): number | null =>
	refId(
		v && typeof v === "object" && "ids" in v
			? (v as { ids?: { id?: unknown } }).ids?.id
			: v
	)

/**
 * The MODEL half of a RESOLVED connection slot (0114).
 *
 * `refId` above reduces a resolved slot to the endpoint's row id; this is the
 * other half of the same pick, and the two are read separately because they
 * arrive by different routes. The executor resolves the slot's stored pair
 * against `world.connections` and hands back `{id, kind, metadata, modelId}` —
 * so the model half is on the DESCRIPTOR, under the same key name the stored
 * value uses.
 *
 * ⚠ It was read here with `slotModelId(p.connection)`, the reader for a STORED
 * value, against a descriptor that carried no `modelId` at all. That is not a
 * mismatch that fails: it returns null, every time, and null means "no model
 * named" — so a model chosen in the panel reached no request, and the run went
 * out against the endpoint alone looking entirely normal.
 *
 * Delegates to `slotModelId` rather than re-reading the key, because the two
 * shapes spell it identically **on purpose**: the descriptor carries the pick's
 * model half under the name the pick itself used, so one reader covers a
 * descriptor from an SDK that carries it and one from an SDK that does not
 * (null, the same answer as "no model named"). A second branch here would be a
 * copy of that reader that only ever returned what it already returns. What
 * this function adds is the NAME — a call site that says it is reading a
 * resolved slot, so the next person does not have to know that the coincidence
 * is deliberate.
 */
/**
 * A character-lore visibility subject no lorebook binding can carry — what a
 * WIRED `speaker` that names nobody in the cast reads as (W1, 2026-09-17).
 *
 * `isCharacterLoreEntryVisible` takes `number | null` and reads `null` as the
 * omniscient narrator, so "this voice is nobody" cannot be spelled `null`
 * without meaning "this voice knows everything" — which is the leak the
 * `speaker` port closes. Character ids are serials, `participantRowId` returns
 * only positive integers, and a binding's `characterId` is a foreign key to
 * one, so a negative subject matches no binding and is equal to no persona:
 * every branch of the rule then answers exactly what it answers for a speaker
 * nobody wrote private lore about.
 */
const NO_SUCH_CHARACTER = -1

/**
 * Whose private lore a `lorebook_entries` read is for.
 *
 * The run's scope, unless the query wired `speaker` — the per-speaker port
 * (W1) the two lore queries declare. See the long note at the read for why a
 * wired-but-unresolvable reference is `NO_SUCH_CHARACTER` rather than `null`.
 */
/**
 * Whether the query wired `speaker` to something. Absent, null, or an empty
 * string: the port is unwired (or wired to a node that published nothing this
 * turn).
 */
const speakerIsWired = (q: Record<string, any>): boolean =>
	q.speaker !== undefined && q.speaker !== null && q.speaker !== ""

const loreVisibilitySubject = (q: Record<string, any>): number | null => {
	const ref = q.speaker
	// Unwired: the scope decides as it always did.
	if (!speakerIsWired(q)) return q.currentCharacterId ?? null
	if (!isParticipantRef(ref)) return NO_SUCH_CHARACTER
	const parsed = parseParticipantRef(ref)
	if (parsed.kind !== "character") return NO_SUCH_CHARACTER
	return participantRowId(parsed.id) ?? NO_SUCH_CHARACTER
}

const connectionDescriptorModelId = (v: unknown): number | null =>
	slotModelId(v)

/**
 * The user half of a step's prompt.
 *
 * Built by the binding, not here. The summarize steps call
 * `summarizer/templates.ts` — the same builders the legacy path uses — so the
 * rules, the `<content>` contract and the per-lore-type wording live in exactly
 * one place and cannot drift from the path they are migrating off. This is the
 * fallback for the graph steps, which hand their scenes over as JSON.
 */
function stepUserPrompt(p: Record<string, any>): string {
	if (typeof p.userPrompt === "string") return p.userPrompt
	if (Array.isArray(p.scenes)) return JSON.stringify(p.scenes, null, 1)
	if (typeof p.content === "string") return p.content
	return ""
}

/** Salvage JSON a model wrapped in prose. Null when there is none to find. */
function tryJson(text: string): unknown {
	if (!text) return null
	try {
		return JSON.parse(text)
	} catch {
		const match = /[[{][\s\S]*[\]}]/.exec(text)
		if (!match) return null
		try {
			return JSON.parse(match[0])
		} catch {
			return null
		}
	}
}

export class HostScopeError extends Error {}

/**
 * A read a spec is not entitled to make is an **error, not an empty result**.
 *
 * Returning `[]` would let a mis-scoped pipeline look like a working one with a
 * quiet session, and the symptom — "the bot forgot everything" — points at
 * retrieval rather than at permissions, which is where the week goes.
 */
function assertScoped(
	node: NodeRef,
	wanted: number | undefined,
	allowed: number | undefined
) {
	if (wanted === undefined) return
	if (allowed === undefined || wanted !== allowed)
		throw new HostScopeError(
			`${node.key} (${node.definitionId}) asked for session ${wanted}, but this run is scoped to ` +
				`${allowed ?? "no session"}. A pipeline may only read the session it was started in.`
		)
}

/**
 * 🚧 Which lorebook a stat read may open (2026-09-27): the scope session's own,
 * or the one the run's scope grants (`HostScope.lorebookId`) — and no other.
 * A named lorebook outside those is **refused**, never filtered to nothing,
 * on `assertScoped`'s terms; lore queries cannot name a book at all, and this
 * is the same door with the one grant a sessionless read needs.
 *
 * 🚧 Where on the book (rulings 15 and 16, 2026-09-27; `state/reading.ts`):
 * the session's own line and moment when the book is the session's own;
 * otherwise the book's most recently used line at the head of its timeline.
 * Either way the fork cut is on. A pipeline may override all three —
 * `branch: 'main' | 'mostRecent' | 'session' | <id>`, `at: 'head' | <date>`,
 * `forkCut: false` — still inside the book it may read; a branch of another
 * book is refused like the book itself.
 */
async function lorebookInScope(
	db: Db,
	node: NodeRef,
	scope: HostScope,
	q: Record<string, any>
): Promise<{
	lorebookId: number | null
	sessionId?: number
	branchId: number | null
	reading?: import("$lib/server/state/reading").LineReading
}> {
	assertScoped(node, q.sessionId, scope.sessionId)
	const sessionId: number | undefined = q.sessionId ?? scope.sessionId
	let own: number | null = null
	let branchId: number | null = null
	if (sessionId !== undefined) {
		const [session] = await db
			.select({
				lorebookId: schema.sessions.lorebookId,
				branchId: schema.sessions.lorebookBranchId
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		own = session?.lorebookId ?? null
		branchId = session?.branchId ?? null
	}
	const granted = scope.lorebookId ?? null
	const wanted = typeof q.lorebookId === "number" ? q.lorebookId : undefined
	if (wanted !== undefined && wanted !== own && wanted !== granted)
		throw new HostScopeError(
			`${node.key} (${node.definitionId}) asked for lorebook ${wanted}, but this run may read only ` +
				`${[own, granted].filter((id) => id !== null).map((id) => `lorebook ${id}`).join(" or ") || "no lorebook"}. ` +
				`A pipeline may only read its own session's lorebook, or one its scope grants.`
		)
	const lorebookId = wanted ?? own ?? granted
	if (lorebookId === null) return { lorebookId, sessionId, branchId: null }
	const { readingOf, sessionReadingOf, storyDateFrom, BranchRefusal } = await import(
		"$lib/server/state/reading"
	)
	const refuse = (why: string) => new HostScopeError(`${node.key} (${node.definitionId}): ${why}`)
	const isOwn = lorebookId === own && sessionId !== undefined
	const sessionReading = isOwn ? await sessionReadingOf(db, sessionId!) : null

	// The line: named, else the session's, else the most recently used.
	let branch: "main" | "mostRecent" | number
	const b = q.branch
	if (b === undefined || b === null)
		branch = sessionReading ? (sessionReading.branchId ?? "main") : "mostRecent"
	else if (b === "main" || b === "mostRecent") branch = b
	else if (b === "session") {
		if (!isOwn) throw refuse(`branch "session" needs the scope session's own lorebook.`)
		branch = branchId ?? "main"
	} else if (typeof b === "number" && Number.isInteger(b)) branch = b
	else throw refuse(`branch must be "main", "mostRecent", "session" or a branch id of this lorebook.`)

	// The moment: named, else the session's (only on its own line), else the head.
	let moment: import("$lib/shared/lorebooks/storyDate").StoryDate | null
	const at = q.at
	if (at === undefined || at === null)
		moment =
			sessionReading && (b === undefined || b === null || b === "session")
				? sessionReading.moment
				: null
	else if (at === "head") moment = null
	else {
		moment = storyDateFrom(at)
		if (!moment) throw refuse(`at must be "head" or a story date { year, month?, day? }.`)
	}
	if (q.forkCut !== undefined && q.forkCut !== null && typeof q.forkCut !== "boolean")
		throw refuse(`forkCut must be true or false.`)

	try {
		const reading = await readingOf(db, lorebookId, {
			branch,
			moment,
			forkCut: q.forkCut !== false
		})
		return { lorebookId, sessionId, branchId: reading.branchId, reading }
	} catch (e) {
		if (e instanceof BranchRefusal) throw refuse(e.message)
		throw e
	}
}

/**
 * One eager-indexing pass, in words, for the receipt.
 *
 * The rule this serves is the one a mechanism that cannot run keeps breaking: *an
 * unavailable mechanism subtracts a signal, and the receipt has to say so where
 * a person reads it.* A promotion that indexed nothing because the model was not
 * resident, and a promotion that indexed nothing because there was nothing to
 * do, produce identical search results and are completely different facts. So
 * both get a sentence, and a bound that bound says it bound — a slow turn and a
 * partially-covered one are the two things a person needs to be able to explain.
 *
 * Intentionally not emitted at all when there was nothing to index: a note per
 * turn saying "nothing to do" is noise that would train people to stop reading
 * the notes.
 */
function describePromotion(
	what: string,
	report: {
		requested: number
		processed: number
		remaining: number
		boundHit: boolean
		reason: string
	}
): string | undefined {
	if (report.requested === 0) return undefined
	if (report.processed === 0)
		return `${report.requested} ${what} were missing and none were indexed — ${report.reason}`
	if (report.boundHit || report.remaining > 0)
		return (
			`indexed ${report.processed} of ${report.requested} missing ${what} before searching — ` +
			`${report.reason}; the rest stay queued`
		)
	return `indexed ${report.processed} missing ${what} before searching`
}

/**
 * Media references → the message parts that show them.
 *
 * A reference is a uuid, so the row has to be looked up — and looking it up is
 * also what makes the reference *checkable*. Every row is required to belong
 * either to this run's session or to the user the run is acting as; a uuid is
 * unguessable, but "unguessable" is not an access rule, and a spec that could
 * name any uuid could post any user's private image into a session.
 *
 * A reference that does not resolve is skipped rather than fatal. The image was
 * rendered and stored; failing the write over one missing row would throw away
 * the message and the other images with it.
 */
async function mediaParts(
	db: Db,
	refs: unknown[],
	sessionId: number,
	scope: HostScope,
	node: NodeRef
): Promise<Array<{ type: string; data: Record<string, unknown> }>> {
	const { eq } = await import("drizzle-orm")
	const schema = await import("$lib/server/db/schema")
	const parts: Array<{ type: string; data: Record<string, unknown> }> = []

	for (const ref of refs) {
		const uuid =
			typeof ref === "string"
				? ref
				: ((ref as Record<string, any>)?.uuid as string | undefined)
		if (!uuid) continue

		// The FILE row, and only the file row (0182). Provenance for the
		// ownership check and the display variant's mime for the part both live
		// here, so one query answers both — putting a `variants` lookup on this
		// path is the one thing the split exists to prevent.
		const [row] = await db
			.select()
			.from(schema.files)
			.where(eq(schema.files.uuid, uuid))
			.limit(1)
		if (!row) continue

		// …or already shown in this session by an attachment part (§6.3 of
		// PLAN-composer-attachments) — the same three-way rule dispatch keeps.
		const ownedHere =
			(row.sessionId != null && row.sessionId === sessionId) ||
			(scope.userId != null && row.userId === scope.userId) ||
			(await (
				await import("$lib/server/attachments/references")
			).isFileReferencedInSession(db, row.id, sessionId))
		if (!ownedHere)
			throw new HostScopeError(
				`${node.key} (${node.definitionId}) tried to post media ${uuid}, which belongs ` +
					`to neither this session nor the user this run is acting as.`
			)

		const alt = (ref as Record<string, any>)?.text
		// One writer for the part (`attachments/partData`): the image's
		// width, height and name, a file's mime, name and size — so a
		// generated image and a person's attachment are the same part.
		const { mediaPartFor } = await import("$lib/server/attachments/partData")
		parts.push(mediaPartFor(row, { alt: alt ? String(alt) : null }))
	}

	return parts
}

/**
 * The embedding module, imported once.
 *
 * It was `await import(...)` inside each call. Two Provider nodes running in
 * parallel — which is exactly what a retrieval block does — then raced on the
 * same dynamic import, and one of them observed a module that reported no model
 * loaded while its sibling embedded happily. The symptom was a provider error on
 * a healthy session, on one of two identical calls, depending on timing.
 *
 * One promise, created on first use and reused: there is no second import to
 * race with, and the module is still not loaded for an instance that never
 * embeds.
 */
let embeddingModule: Promise<typeof import("$lib/server/embedding")> | null =
	null
const embeddingApi = () => (embeddingModule ??= import("$lib/server/embedding"))

/**
 * One end of a lore link, as a spec can hand it over.
 *
 * Three spellings, because three are what a spec actually has: a bare id, the
 * `{ status, ids }` write result an outlet publishes (every `write-result@1`
 * port resolves to the whole result, so `$.save.entryId` IS this), and a
 * `{ id }` row. Anything else is a name, and names are resolved against the
 * book.
 */
const linkEndId = (raw: unknown): number | null => {
	if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
	if (typeof raw === "string")
		return /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null
	if (!raw || typeof raw !== "object") return null
	const o = raw as Record<string, unknown>
	const ids = (o.ids ?? null) as Record<string, unknown> | null
	for (const v of [ids?.entryId, ids?.id, o.entryId, o.id])
		if (typeof v === "number" && Number.isFinite(v)) return v
	return null
}

/**
 * The other end of a lore link — an entry id, or a **name** resolved within
 * this lorebook (L2, 2026-09-17).
 *
 * An end is an entry the session sees (plan A27, `whyUnseen(…, "session")`):
 * on its line at its moment and, as the line's amendments leave it by then,
 * neither archived nor switched Off — what every session reader of the book
 * answers by, the hop that reads links back included. A link to an entry the
 * session does not see would be a link its own story never reads.
 *
 * A name is what lets a link follow a create without holding an id — a later
 * outlet in the same run, or a later run, has only the name to go on. It is
 * found by the rooms' own name rule (`entryNamed`: the name exactly, then a
 * looser spelling with a leading "the" aside, then a key), over the names the
 * session shows — as amended, never a stored title a dated change replaced.
 * It is also the half that can be wrong, and each way is refused with a
 * sentence rather than repaired:
 *
 *  · **Nothing answers to it.** Creating the missing entry here would make a
 *    link outlet a second entry writer, which is the write law again with the
 *    name changed.
 *  · **Two entries answer to it alike.** Picking one would link the wrong
 *    room, and it would do it silently — a duplicate name is the author's to
 *    resolve, and the refusal is what tells them it exists.
 *  · **Only an entry the session does not see answers.** The same sentence as
 *    an id pointing at it.
 *
 * One lorebook, both ends: an edge whose ends live in two books belongs to
 * neither and the row carries one `lorebook_id`, so a cross-book end is
 * refused exactly as the socket handlers refuse one — held again here because
 * a pipeline does not come through them.
 */
async function resolveLoreLinkEnd(
	tx: Db,
	lorebookId: number,
	raw: unknown,
	where: string,
	/** The session's reading: its line's chain, fork cuts and moment. */
	reading: LineReading
): Promise<number> {
	const { entriesAsRead, entryNamed } = await import(
		"$lib/server/state/entriesOnReading"
	)
	const { unseenSentence } = await import("$lib/shared/lorebooks/placeSight")
	const id = linkEndId(raw)
	if (id !== null) {
		const [row] = await entriesAsRead(tx, lorebookId, reading, "session", null, [id])
		if (!row)
			throw new HostScopeError(
				`${where}: entry ${id} is not in this session's lorebook, so there is nothing here to link it to. Both ends of a link live in one book.`
			)
		if (row.unseen)
			throw new HostScopeError(
				`${where}: ${unseenSentence(row.name ? `'${row.name}'` : `entry ${id}`, row.unseen)}`
			)
		return row.entryId
	}
	const name = typeof raw === "string" ? raw.trim() : ""
	if (!name)
		throw new HostScopeError(
			`${where}: there is nothing to link to — wire an entry id, the write result of the entry that made it, or the name of an entry in this session's lorebook.`
		)
	const hit = entryNamed(
		name,
		await entriesAsRead(tx, lorebookId, reading, "session", null)
	)
	if (hit.kind === "one") return hit.entryId
	if (hit.kind === "tie")
		throw new HostScopeError(
			`${where}: “${name}” is the name of more than one entry in this session's lorebook (${hit.names.map((n) => `'${n}'`).join(", ")}), and picking one would link the wrong one silently. Rename one of them, or wire the entry's id.`
		)
	if (hit.kind === "unseen")
		throw new HostScopeError(`${where}: ${unseenSentence(`'${hit.name}'`, hit.why)}`)
	throw new HostScopeError(
		`${where}: no entry in this session's lorebook is called “${name}”. Write it first — a link outlet never creates the entry it names.`
	)
}

/**
 * One link a spec asked for, taken apart — the SDK's `LoreLinkInput`
 * (`@serene-pub/contracts`), unchecked: every field is whatever arrived, and
 * `writeLoreLink` reads only strings from it.
 */
interface LoreLinkRequest {
	to: unknown
	linkType?: unknown
	reverseLinkType?: unknown
	name?: unknown
	description?: unknown
}

/**
 * The links an outlet was handed: a list of names, ids, or `LoreLinkInput`s
 * (`{ to, linkType?, reverseLinkType?, name?, description? }`, places plan B2).
 * Anything that is not a list is none, and an entry with no `to` is dropped
 * here so the refusal below names the wiring rather than an empty object.
 * ⚠ The retired `label` is not read (no alias): it was the description under
 * a second name.
 */
const loreLinkRequests = (raw: unknown): LoreLinkRequest[] => {
	if (!Array.isArray(raw)) return []
	const out: LoreLinkRequest[] = []
	for (const item of raw) {
		if (item === null || item === undefined) continue
		if (typeof item === "object" && !Array.isArray(item)) {
			const o = item as Record<string, unknown>
			// A `{ to, … }` request, or a bare write result / row, which is
			// itself the other end.
			out.push(
				"to" in o
					? {
							to: o.to,
							linkType: o.linkType,
							reverseLinkType: o.reverseLinkType,
							name: o.name,
							description: o.description
						}
					: { to: o }
			)
		} else out.push({ to: item })
	}
	return out
}

/**
 * The relationship type a row carries when nothing said. Free text in the row
 * and free text here — the app's list is a vocabulary of suggestions, never a
 * constraint, and nothing reads a relationship type semantically (places plan
 * B2): which way a link walks is its `reverse_relationship_type`, and nothing
 * said is one way.
 */
const DEFAULT_LORE_LINK_TYPE = "leads to"

/**
 * A request's text field, trimmed and cut to its `RELATIONSHIP_TEXT_LIMITS`
 * ceiling — a cut, never a refusal, since a model wrote it (as the graph
 * build's apply cuts). Anything that is not a string is empty.
 */
const loreLinkText = (v: unknown, limit: number): string =>
	typeof v === "string" ? v.trim().slice(0, limit).trim() : ""

/** Where a session's lore writes land: its line, as a branch, and its reading. */
interface LoreWriteLine {
	/** Stamped on every row written. Null is main — shared. */
	branchId: number | null
	/**
	 * The dating a dated row written here carries (plan A22): the latest
	 * history entry the session's reading sees (`writeDatingAt`), null when
	 * it sees none. A lore link is dated by it, as a session's stat is.
	 */
	historyEntryId: number | null
	/**
	 * The session's whole reading — its line's chain, fork cuts and moment —
	 * which a lore link's ends are judged on (`resolveLoreLinkEnd`) and asks
	 * whether the session already reads that link.
	 */
	reading: LineReading
}

/**
 * The line a session's lore writes land on (finding #0): the session's own
 * `lorebook_branch_id`, validated against its book by `sessionReadingOf` — a
 * stale id reads (and writes) main rather than failing the turn. A write from
 * a session on a branch that stamped nothing landed on main and so on every
 * line.
 */
async function loreWriteLineOf(
	db: Db,
	sessionId: number,
	lorebookId: number
): Promise<LoreWriteLine> {
	const { sessionReadingOf, writeDatingAt } = await import(
		"$lib/server/state/reading"
	)
	const reading = (await sessionReadingOf(db, sessionId)) ?? {
		lorebookId,
		branchId: null,
		moment: null,
		forkedAt: null,
		line: MAIN_LINE
	}
	return {
		branchId: reading.branchId ?? null,
		historyEntryId: (await writeDatingAt(db, reading))?.historyEntryId ?? null,
		reading
	}
}

/** What `writeLoreLink` did: the row's id, and whether this call made it. */
interface LoreLinkWrite {
	id: number
	/**
	 * The row's own `from` end: the requested `from`, or — when the session
	 * already read the link drawn from the far end (its mirror) — the far end.
	 */
	fromEntryId: number
	/**
	 * False when the session already read the link (the same way, or its
	 * mirror): the id is the standing row's, and nothing was written.
	 */
	written: boolean
}

/** A lore link that shares words with one the session reads, but not all of them. */
const LINKED_IN_PART =
	"The link that stands says only part of what this one asks, and a pipeline never rewords a link. Change it in the lorebook, or ask for what it already says."

/** Why a lore link the session holds is not read: it is ended, or secret. */
const linkNotStanding = (link: LinkOnReading): string =>
	link.visibility === "secret"
		? "That link is secret, and a pipeline never reveals a secret link."
		: `That link is ${link.status}, and a pipeline never reopens a link.`

/**
 * Write one lore link, on the session's line — or find the one that already
 * says it (places plan B2).
 *
 * **Idempotent, as the session reads.** The question is "does this session
 * already read this link?" (`linksOnReadingThatWay`, review round): a
 * relationship with this name (case aside) that the session's reading holds —
 * its own line or one it inherits (main's before the fork), undated or dated
 * at or before its moment — and that says EVERYTHING the request says: the
 * same words read from the same end, both ways when both were asked, or its
 * true mirror drawn from the far end. Its id comes back with `written: false`
 * and nothing is inserted, so a re-run, a swipe or a repeated line in `links`
 * never stacks a room's ways out. The standing row is never rewritten: a
 * pipeline's repeat does not reword a link somebody drew.
 *
 * Refused with a sentence, never answered with a row the request does not
 * match: a row that shares ONE sentence and not the rest (a one-way door
 * where both ways was asked — a second row would say that sentence twice, and
 * no call here can add the way back), and a row that says it all but no
 * longer stands (resolved, broken, secret) — nothing the session reads would
 * state it, and a pipeline does not reopen or reveal it.
 *
 * ⚠ **A found row is not the run's.** The caller must not record it as a
 * `lore_link` artifact the run `created`: an undo of the run would delete a
 * row it never made. (Nothing undoes by artifact today; the rule stands for
 * whatever does. One known gap from B1: 0193 folded stored duplicates keeping
 * the one with the most description, so a pre-B1 row recorded as a run's may
 * now stand in for a hand-drawn twin it absorbed — an undo built later must
 * not delete a relationship by artifact alone.)
 */
async function writeLoreLink(
	tx: Db,
	lorebookId: number,
	fromEntryId: number,
	req: LoreLinkRequest,
	where: string,
	line: LoreWriteLine
): Promise<LoreLinkWrite> {
	const toEntryId = await resolveLoreLinkEnd(
		tx,
		lorebookId,
		req.to,
		where,
		line.reading
	)
	const ends = { fromNodeId: null, fromEntryId, toNodeId: null, toEntryId }
	const linkType =
		loreLinkText(req.linkType, RELATIONSHIP_TEXT_LIMITS.wording) ||
		DEFAULT_LORE_LINK_TYPE
	// Blank is one way — NULL in the row, never an empty wording.
	const reverseLinkType =
		loreLinkText(req.reverseLinkType, RELATIONSHIP_TEXT_LIMITS.wording) ||
		null
	const name = loreLinkText(req.name, RELATIONSHIP_TEXT_LIMITS.name)
	const description = loreLinkText(
		req.description,
		RELATIONSHIP_TEXT_LIMITS.description
	)
	const saying = {
		lorebookId,
		title: name,
		relationshipType: linkType,
		reverseRelationshipType: reverseLinkType
	}
	// The guard the canvas's writes go through (plan B0): never an entry
	// linked to itself — a room whose way out names the room. Judged before
	// the standing-row lookup, so a self-link is refused, never "found".
	await assertRelationshipWrite(tx, { op: "create", ends, where })
	const held = await linksOnReadingThatWay(tx, ends, saying, line.reading)
	const whole =
		held.find((link) => link.saysAll && link.standing) ??
		held.find((link) => link.saysAll)
	if (whole?.standing)
		return {
			id: whole.id,
			fromEntryId: whole.fromEntryId ?? fromEntryId,
			written: false
		}
	if (whole)
		throw new HostScopeError(
			`${where}: ${LINKED_THAT_WAY} ${linkNotStanding(whole)}`
		)
	if (held.length)
		throw new HostScopeError(`${where}: ${LINKED_THAT_WAY} ${LINKED_IN_PART}`)
	// Inserted on the session's own line at its dating (`writeDatingAt`,
	// plan A22) — a history entry the reading sees, so the row is one the
	// reading holds, and the unique index's exact twin (line and dating are
	// in it) was found above rather than raised here.
	const [row] = await tx
		.insert(schema.narrativeRelationships)
		.values({
			lorebookId,
			// An entry-ended edge: the two CHECK constraints require exactly
			// one of node/entry per side, so both node columns stay null.
			fromNodeId: null,
			toNodeId: null,
			fromEntryId,
			toEntryId,
			relationshipType: linkType,
			reverseRelationshipType: reverseLinkType,
			title: name,
			description,
			// The session's line: a road drawn on a fork is that fork's road.
			branchId: line.branchId,
			// Where the session stands: a road found in Year 7 was not there
			// from the start of the line.
			historyEntryId: line.historyEntryId
		})
		.returning({ id: schema.narrativeRelationships.id })
	return { id: row!.id, fromEntryId, written: true }
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
 * A message outlet's `sections` in-port, checked (B4; D5, 2026-09-27):
 * `undefined` when none were given, the normalized list otherwise, and a
 * malformed list refused by the node's key and the section's position — the
 * SDK's one `checkFoldedSections`, so the host and a spec's own tests agree.
 */
function foldedSectionsIn(
	node: NodeRef,
	raw: unknown
): FoldedSectionV1[] | undefined {
	const { sections, refusal } = checkFoldedSections(raw)
	if (refusal) throw new HostScopeError(`${node.key}: ${refusal}.`)
	return sections
}

export function createHost(db: Db, scope: HostScope = {}): CoreHostServices {
	/**
	 * The live row's channel, once this run has opened it (W1). A run writes
	 * as often as it likes, but a second message on the reply's own channel
	 * is two rows racing for one place. The validator refuses that where the
	 * channel is a literal; a wired channel is known only here, so the host
	 * refuses the rest. One host serves one run, so the fact is the run's.
	 */
	let liveChannel: string | undefined
	/**
	 * The live row itself, so the write that FINISHES it can end the race
	 * (amended 2026-09-27, lair pass B16 — the SDK's F7 says the same): a
	 * settled row holds its place, and a message written after it lands after
	 * it. Before the finish, a second message on the channel still races.
	 */
	let liveRowId: number | undefined
	const racesLiveRow = (nodeKey: string, raw: unknown): string | null => {
		if (liveChannel === undefined) return null
		const channel = canonicalChannel(raw)
		return channel === liveChannel
			? `${nodeKey}: refused — a second message on channel '${channel}', the live row's channel; put it on the live row as blocks, or on another channel`
			: null
	}
	/**
	 * The genre's per-channel prompt shaping (R-C), read **once per host**.
	 *
	 * A fact about the genre, and a genre does not change under a run, so a
	 * turn that reads history several times pays for one registry lookup
	 * rather than one per read. `null` — the answer for every genre that
	 * declares only bare slugs — is cached like any other answer, so the
	 * ordinary session pays once and then nothing.
	 */
	const shapingBySession = new Map<
		number,
		Promise<ChannelShaping | null>
	>()
	const channelShaping = (
		sessionId: number
	): Promise<ChannelShaping | null> => {
		let cached = shapingBySession.get(sessionId)
		if (!cached) {
			cached = sessionChannelShaping(db, sessionId)
			shapingBySession.set(sessionId, cached)
		}
		return cached
	}
	/**
	 * The `lorebook_entries` read's per-run memo (plan C4): one book read per
	 * session, book and reading, with its scans inside. See the case. Cleared
	 * by the one lore write this host makes, `core:outlet/create-lore-entry`.
	 */
	const lorebookReads = new Map<string, Promise<any>>()

	/**
	 * A row this run wrote, announced to everyone in the session. The trigger
	 * announces nothing of its own. A no-op with no socket server on the scope
	 * (see `HostScope.io`).
	 */
	const announce = async (row: {
		sessionId: number
		[k: string]: unknown
	}) => {
		if (!scope.io) return
		await broadcastToSessionUsers(
			scope.io,
			row.sessionId,
			"sessionMessage",
			{
				sessionMessage: row
			}
		)
	}

	/**
	 * The same announcement with the row's parts attached — for a row that
	 * just gained a block tree (U5d), so the client renders the buttons off
	 * the frame rather than after a reload. The plain `announce` stays for
	 * every other write: its frame is the legacy row, which is what the live
	 * stream and the parity gate compare.
	 */
	const announceWithParts = async (messageId: number) => {
		if (!scope.io) return
		const row = await legacyMessage(db, messageId)
		if (!row) return
		const { attachParts } = await import("$lib/server/messages/store")
		const [withParts] = await attachParts(db, [row])
		await announce(withParts ?? row)
	}

	/**
	 * The annex write (§4.3), shared by `set-session-annex` and the annex
	 * field's `set-annex-field` (2026-09-26): one owner's document, merged
	 * into what is there unless `merge` is off, under
	 * `pg_advisory_xact_lock(hashtext('annex'), sessionId)` through
	 * `jsonb_set`; the artifact, `annex-changed` and every member's view
	 * re-sent when the value moved.
	 *
	 * The callers have already held the write to the owner's **annex
	 * declaration** (ruling 2026-09-26) and hand over, per key written, the
	 * audience it declares (R57) — stored beside the value, so the stored
	 * audience is always the declaration's. A key the declaration does not
	 * cover (`declared` lacks it) is **legacy**: written before the ruling,
	 * never writable again, kept — `merge` off replaces the declared keys
	 * and leaves those where they are, so no write loses data it could not
	 * itself have written.
	 */
	const writeAnnexDocument = async (
		node: NodeRef,
		sessionId: number,
		owner: string,
		value: Record<string, unknown>,
		merge: boolean,
		audienceOf: Record<string, readonly string[]>,
		declared: ReadonlySet<string>
	) => {
		const { canonicalParticipantRef } = await import("@serene-pub/sdk")
		// Stored in each reference's one spelling, so every reader's
		// lookup — keyed canonically — finds it.
		const canonical = (refs: readonly string[] | undefined) =>
			[...new Set((refs ?? []).map((r) => canonicalParticipantRef(r)))].sort()
		const annex = await db.transaction(async (tx) => {
			await tx.execute(
				sql`select pg_advisory_xact_lock(hashtext('annex'), ${sessionId})`
			)
			const [current] = await tx
				.select({
					annex: schema.sessions.annex,
					audiences: schema.sessions.annexAudiences
				})
				.from(schema.sessions)
				.where(eq(schema.sessions.id, sessionId))
				.limit(1)
			if (!current) return null
			const held = (current.annex ?? {}) as Record<string, unknown>
			const previous =
				held[owner] && typeof held[owner] === "object" &&
				!Array.isArray(held[owner])
					? (held[owner] as Record<string, unknown>)
					: {}
			const heldAudiences = (
				(current.audiences ?? {}) as Record<string, Record<string, string[]>>
			)[owner] ?? {}
			// Legacy keys (no declaration covers them) survive a replace.
			const legacy = Object.fromEntries(
				Object.entries(previous).filter(([k]) => !declared.has(k))
			)
			const next = merge ? { ...previous, ...value } : { ...legacy, ...value }
			const nextAudiences: Record<string, string[]> = merge
				? { ...heldAudiences }
				: Object.fromEntries(
						Object.entries(heldAudiences).filter(([k]) => !declared.has(k))
					)
			for (const key of Object.keys(value)) {
				const see = canonical(audienceOf[key])
				if (see.length) nextAudiences[key] = see
				else delete nextAudiences[key]
			}
			if (sameJson(previous, next) && Object.hasOwn(held, owner))
				return { next, changed: false, seen: false }
			// Whether anybody's view can have moved: a value somebody
			// may see was written, or one they could see was dropped.
			// A pipelines-only write — most of them — pushes nothing.
			const seen =
				Object.keys(value).some((k) => (nextAudiences[k]?.length ?? 0) > 0) ||
				Object.keys(heldAudiences).some((k) => !Object.hasOwn(nextAudiences, k))
			await tx.execute(sql`
				update ${schema.sessions}
				set ${sql.identifier("annex")} = jsonb_set(
					coalesce(${schema.sessions.annex}, '{}'::jsonb),
					ARRAY[${owner}]::text[],
					${JSON.stringify(next)}::jsonb,
					true
				),
				${sql.identifier("annex_audiences")} = jsonb_set(
					coalesce(${schema.sessions.annexAudiences}, '{}'::jsonb),
					ARRAY[${owner}]::text[],
					${JSON.stringify(nextAudiences)}::jsonb,
					true
				)
				where ${schema.sessions.id} = ${sessionId}
			`)
			return { next, changed: true, seen }
		})
		if (annex === null)
			throw new HostScopeError(
				`${node.key}: session ${sessionId} no longer exists`
			)
		// An unchanged write wrote nothing: no artifact, no event.
		if (annex.changed) record(node, "session", sessionId, "updated")
		// `annex-changed` (R30/R45): the one event a pipeline's own
		// state causes, after the transaction (the emitter's plugin
		// fan-out must never run inside one) and only when the value
		// moved — so a spec bound to it that rewrites the same value
		// cannot feed itself.
		if (annex.changed)
			await emit(
				"core:event/annex-changed@1",
				{ sessionId, owner },
				{ kind: "run" },
				{ asChild: true }
			)
		// Every member's own view, re-sent (R57): what each may see
		// of the annex, never the annex.
		if (annex.changed && annex.seen && scope.io) {
			const { pushAnnexViews } = await import("$lib/server/sessions/annexViews")
			await pushAnnexViews(db, scope.io, sessionId).catch((err) =>
				console.warn(`[annex] the view push for session ${sessionId} failed:`, err)
			)
		}
		// An unchanged document wrote nothing, and says so: the
		// executor then skips the write's event (M3/W1).
		return {
			written: annex.changed,
			sessionId,
			owner,
			annex: annex.next
		}
	}

	/**
	 * Write down a row this run just made.
	 *
	 * Called at the write, by the code that did it — never reconstructed
	 * afterwards from a node's published output. Two reasons it cannot be:
	 * every commit publishes its own shape, and the outputs are redacted for a
	 * non-admin reading their own receipt, so the ids are not reliably there to
	 * read. A no-op when the host has no collector (see `HostScope.artifacts`).
	 */
	const record = (
		node: NodeRef,
		kind: RunArtifact["kind"],
		entityId: unknown,
		action: RunArtifact["action"]
	) => {
		if (!scope.artifacts || typeof entityId !== "number") return
		scope.artifacts.push({ kind, entityId, action, nodeKey: node.key })
	}

	/**
	 * A session event this run's write caused (PLAN-turn-order §4.1, A2),
	 * through the one emitter. `cause` is the run's unless the write is a
	 * person's edit, hide, delete or swipe performed by a built-in's run —
	 * then `{ kind: 'edit', userId, runId }`: the person did it, this run
	 * wrote it. A spec the genre binds to the event runs as this run's
	 * CHILD (`childLineage`), so the cycle caps hold across the event; the
	 * payload's own `lineage` is this run's place in the tree. A host with
	 * no user on its scope (wired by hand) emits nothing: there is nobody
	 * to emit as, and no run to be the child of.
	 */
	const emit = async (
		event: string,
		payload: Record<string, unknown> & { sessionId: number },
		cause: { kind: "run" | "edit" | "user" },
		/**
		 * `asChild`: dispatch as a child of this run, so the lineage caps
		 * apply (01 §8). For an event a spec can re-cause by answering it —
		 * `annex-changed`, where a spec bound to it may write the annex
		 * again — unlike a recompute, which cannot (see below). Such an
		 * event also never carries `auto`: it is raised mid-run, and the
		 * round continues on the reply's `message-completed`, never on a
		 * write made while the reply is still streaming (R34).
		 */
		opts: { asChild?: boolean } = {}
	) => {
		if (scope.userId == null) return
		const { emitSessionEvent } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		const { childLineage, listenerLineage } = await import(
			"$lib/server/pipelines/runtime/lineage"
		)
		await emitSessionEvent(db, {
			sessionId: payload.sessionId,
			userId: scope.userId,
			event,
			payload: {
				...payload,
				event,
				cause: {
					kind: cause.kind,
					...(cause.kind === "edit" || cause.kind === "user"
						? { userId: scope.userId }
						: {}),
					...(scope.runId ? { runId: scope.runId } : {}),
					// Whether auto-advance fired this run (§4.6) — the fact
					// `round` continues on. Only ever true on a run's own
					// cause: a person's edit is never automatic.
					...(cause.kind === "run" && scope.auto && !opts.asChild ? { auto: true } : {})
				},
				...(scope.lineage ? { lineage: scope.lineage } : {})
			},
			/**
			 * **Inside this run's tree, on the listener lane** (R65).
			 *
			 * A spec bound to a data event is core's own listener lane (§3's
			 * diagram), not this pipeline's fan-out, so it never spends the
			 * writing run's descendant budget: counting the turn-order
			 * recompute there once made a message carrying nine questions
			 * starve its own answers. But it rides the tree, so a loop — a
			 * spec answering `message-completed` that writes a message — meets
			 * the depth cap and parks for the session owner instead of running
			 * forever (B3 review). `turn-order-changed` does not come through
			 * here: auto-advance answers it under its own cause rule and cap.
			 *
			 * `asChild` is the counted form, for an event a spec re-causes by
			 * answering it mid-run (`annex-changed`, a recording).
			 */
			...(scope.runId
				? {
						...(opts.asChild
							? { lineage: childLineage({ runId: scope.runId, lineage: scope.lineage }) }
							: {
									lineage: listenerLineage({ runId: scope.runId, lineage: scope.lineage }),
									depthOnly: true
								})
					}
				: {}),
			io: scope.io,
			signal: scope.signal
		})
	}

	/**
	 * A built-in write performs only under the built-in's own document
	 * (U5b review W8) — `validate()` refuses the placement at publish, and
	 * this is the same refusal at the write, for a document that reached the
	 * host without passing through it. A host with no document named (wired
	 * by hand) is not judged here: there is no document to judge.
	 *
	 * **Ownership decides before the id does** (D-6). `isBuiltInSpec` matches
	 * five literal core ids, which is a fact about the string; an owned
	 * document is refused whatever its id says, because the owner is a fact
	 * this instance wrote when it installed the package and the id is a claim
	 * the package makes about itself. The two only disagree for a document
	 * naming itself `core:spec/builtin-*` out of a plugin's folder — which
	 * `readPluginPackage` already refuses at install — and this is the same
	 * refusal at the write, for a row that reached the database another way.
	 */
	const assertBuiltInSpec = (node: NodeRef) => {
		if (scope.ownerPluginId !== undefined)
			throw new HostScopeError(
				`${node.key} (${node.definitionId}) is a built-in write and '${scope.specId}' is owned ` +
					`by the plugin '${scope.ownerPluginId}'. Only core's own built-in specs may perform ` +
					`one — the write's permission was judged by the handler that started that spec, ` +
					`and by nothing a package can supply.`
			)
		if (scope.specId === undefined || isBuiltInSpec(scope.specId)) return
		throw new HostScopeError(
			`${node.key} (${node.definitionId}) is a built-in write and '${scope.specId}' is not a ` +
				`built-in's spec. Only core:spec/builtin-* may perform one — the write's permission ` +
				`was judged by the handler that started that spec, and by nothing this document ` +
				`can supply. A manifest permission for a plugin spec to place one is not granted in ` +
				`this release.`
		)
	}

	/**
	 * The item rule, at the write (U5b review C1): may the run's actor act on
	 * THIS row? The handler asked the same question before the run began, on
	 * the id it was given; this asks it on the id the write is about to use,
	 * because the two can differ — a review gate folds an edit into the
	 * payload between them — and ownership is not a property the payload
	 * carries. No actor is no permission: the only default that can be
	 * wrong in one direction is the one that grants.
	 */
	const assertMayAct = async (node: NodeRef, messageId: number) => {
		const { canActOnMessage, MESSAGE_ACTION_REFUSAL } = await import(
			"$lib/server/messages/permissions"
		)
		if (
			scope.userId != null &&
			(await canActOnMessage(db, messageId, scope.userId))
		)
			return
		throw new HostScopeError(
			`${node.key}: ${MESSAGE_ACTION_REFUSAL}`
		)
	}

	/**
	 * Message blocks, written (20 §6; R-15 *Forms*; U5d) — the `blocks`
	 * in-port of `create-message` and `update-message`, one path for both.
	 *
	 * The tree is validated with the SDK's gate; a block naming a key this
	 * document declares no action for is refused with the key named
	 * (nothing would ever hold a press to an audience for it); a block
	 * naming a `world` action is refused — the effects line: an
	 * out-of-fiction effect never rides a message where a character could be
	 * asked to answer it. What passes is stamped with the writing spec's
	 * action identity, a block id and the **channel head** (U5f, R-15
	 * *Staleness and order*: the greatest message id on the row's channel
	 * at this write among rows that are not answers to this row's own
	 * forms — the row itself, for a fresh create — read through
	 * `stalenessHead`, the one definition the fire door compares against; a
	 * head a spec wrote is dropped), and stored as ONE `core:blocks` part.
	 *
	 * Then the forms: for every block with an `addressee`, the run's
	 * **pinned** portrayals answer who portrays them this turn (R-21 (4)) —
	 * `ai` means the form goes on the run's `addressed` list for `runSpec`
	 * to dispatch as `form-addressed` once the receipt is saved; a person,
	 * nobody, or a reference the run never pinned means the block waits for
	 * a click, as a form put to a person does — and goes on the run's
	 * `formsAwaitingPeople`, as does a form with no addressee, for `runSpec`
	 * to raise its `open-form` notification. An addressed form whose
	 * function no action of this document declares was refused above; one
	 * left unstamped — several actions on one function — is refused here,
	 * since a form nobody can be held to is a form nobody can answer.
	 *
	 * Returns what it stored, so a caller's receipt can say so. `replace`
	 * (U5d review, S5) is the update write's: the row's existing `core:blocks`
	 * part is replaced rather than a second appended — a message's block
	 * tree is a value a write sets.
	 */
	const writeBlocks = async (
		node: NodeRef,
		row: { id: number; sessionId: number; channel: string },
		raw: unknown,
		opts: { replace?: boolean } = {}
	): Promise<MessageBlock[] | null> => {
		if (raw === undefined || raw === null) return null
		if (!Array.isArray(raw)) {
			throw new HostScopeError(
				`${node.key}: 'blocks' is not a list — wire a block list (a MessageBlock[]), or leave it unwired`
			)
		}
		if (!raw.length) return null
		const findings = checkMessageBlocks(raw)
		if (findings.length)
			throw new HostScopeError(
				`${node.key}: the blocks do not validate — ` +
					findings.map((f) => `${f.path}: ${f.message} (${f.fix})`).join("; ")
			)
		const spec = { id: scope.specId ?? "", contributes: scope.contributes }
		let blocks = raw as MessageBlock[]
		if (scope.specId !== undefined) {
			const undeclared = undeclaredBlockFunctions(blocks, spec)
			if (undeclared.length)
				throw new HostScopeError(
					`${node.key}: the blocks name ${undeclared.map((f) => `'${f}'`).join(", ")}, which ` +
						`'${scope.specId}' declares no action for — a block's press is held to an ` +
						`action's audience, so declare one under contributes.actions[] first`
				)
			/**
			 * The effects line at the write (01 §13: `core:verdict/effects-line`,
			 * heard as a `block`), with its one exception (L1, ruled
			 * 2026-09-17): a block addressed to the **owner** passes, because
			 * the owner is already the whole of a `world` action's `act`
			 * audience and pressing the button is the owner acting. The
			 * refusal is therefore about the blocks that are still questions
			 * somebody in the fiction could be asked.
			 */
			const line = effectsLineVerdict.judge({ kind: "block", blocks, spec })
			if (!line.ok) throw new HostScopeError(`${node.key}: ${i18nText(line.sentence)}`)
			blocks = stampBlockActions(blocks, spec)
			// A block pointing at ANOTHER spec's declaration on purpose (Ask's
			// options fire Answer): held to the installed declaration — it
			// must exist for the session's genre, it may not be `world`, and
			// the option's `fn` must be THAT action's function (U5d review,
			// S2): an identity is which declaration judges the press, and a
			// press whose function disagrees with it would be judged by one
			// declaration and routed by another.
			const foreign = foreignBlockActions(blocks, spec)
			if (foreign.length) {
				const fnsByIdentity = new Map<string, Set<string>>()
				/**
				 * Who each foreign identity was put to (L1): every addressee
				 * of every block naming it, handed to the same verdict this
				 * spec's own declarations were judged by. An identity named
				 * by two blocks is admitted only if BOTH are the owner's —
				 * one question a character could be asked is one too many —
				 * which is the verdict's rule over the list, not this door's.
				 */
				const addresseesByIdentity = new Map<string, unknown[]>()
				for (const form of formBlocksOf(blocks)) {
					const refs = form.kind === "choices" ? form.actions : [form]
					for (const ref of refs) {
						if (ref.action === undefined) continue
						const set = fnsByIdentity.get(ref.action) ?? new Set<string>()
						set.add(ref.fn)
						fnsByIdentity.set(ref.action, set)
						const put = addresseesByIdentity.get(ref.action) ?? []
						put.push(form.addressee)
						addresseesByIdentity.set(ref.action, put)
					}
				}
				const { listGenreActions, STANDARD_GENRE_ID } = await import(
					"$lib/server/pipelines/entities/sessionGenres"
				)
				const { parseActionIdentity } = await import("$lib/shared/actions/identity")
				const [session] = await db
					.select({ genreId: schema.sessions.genreId })
					.from(schema.sessions)
					.where(eq(schema.sessions.id, row.sessionId))
					.limit(1)
				const offered = await listGenreActions(db, session?.genreId ?? STANDARD_GENRE_ID)
				for (const identity of foreign) {
					const parsed = parseActionIdentity(identity)
					const found =
						parsed &&
						offered.find((a) => a.specSlug === parsed.specSlug && a.key === parsed.key)
					if (!found)
						throw new HostScopeError(
							`${node.key}: the blocks name the action '${identity}', which nothing ` +
								`published for this session's genre declares — a block fires a declared ` +
								`action or nothing`
						)
					const crossed = effectsLineVerdict.judge({
						kind: "identity",
						identity,
						effects: found.effects,
						addressees: addresseesByIdentity.get(identity) ?? []
					})
					if (!crossed.ok)
						throw new HostScopeError(`${node.key}: ${i18nText(crossed.sentence)}`)
					const disagreeing = [...(fnsByIdentity.get(identity) ?? [])].filter(
						(fn) => fn !== found.key
					)
					if (disagreeing.length)
						throw new HostScopeError(
							`${node.key}: the blocks name '${identity}' with fn ${disagreeing
								.map((fn) => `'${fn}'`)
								.join(", ")}, but that action's key is '${found.key}' — a block's fn is ` +
								`the named action's key, or the identity is the wrong one`
						)
				}
			}
		}
		blocks = assignBlockIds(blocks, () => randomUUID())
		if (formBlocksOf(blocks).length) {
			// The channel head at issue (U5f): the row is on the channel, so
			// the head is at least the row; a later line on it — one that is
			// not an answer to a form on this row — moves the head and stales
			// every unanswered form issued before.
			const head =
				(await stalenessHead(db, row.sessionId, row.channel, row.id)) ?? row.id
			blocks = assignBlockHead(blocks, head)
		}
		// An addressed form is held to ONE identity per option — every option
		// of a question, not the first (U5d review, W6): the oracle may pick
		// any of them, and the one it picks is what fires. Since V2 a key
		// names at most one action of a spec, so an option left unstamped
		// here is one the spec declares nothing for (a host wired by hand).
		for (const form of formBlocksOf(blocks)) {
			if (!form.addressee) continue
			const refs = form.kind === "choices" ? form.actions : [form]
			const unstamped = refs.filter((ref) => ref.action === undefined)
			if (unstamped.length)
				throw new HostScopeError(
					`${node.key}: the form '${form.id}' is addressed to ${form.addressee} but ` +
						`${unstamped.map((r) => `'${r.fn}'`).join(", ")} names no action of ` +
						`'${scope.specId ?? "this document"}', so no identity could be stamped — a form ` +
						`nobody can be held to is a form nobody can answer; name the action on the block, ` +
						`or declare the key`
				)
		}
		if (opts.replace) {
			const { replaceBlocksPart } = await import("$lib/server/messages/blocks")
			await replaceBlocksPart(db, row.id, blocks)
		} else {
			const { appendParts } = await import("$lib/server/messages/store")
			await appendParts(db, row.id, [
				{ type: CORE_BLOCKS_PART, data: { blocks } }
			])
		}
		for (const form of formBlocksOf(blocks)) {
			if (!form.id) continue
			const who = form.addressee ? scope.portrayals?.[form.addressee] : undefined
			if (who?.by !== "ai" || !form.addressee) {
				// Waits for a click: the person's who portrays the addressee,
				// else the owner's (W4) — raised as `open-form` after the
				// receipt, like the AI's dispatch.
				const userId = who?.by === "person" ? Number(who.userId) : NaN
				scope.formsAwaitingPeople?.push({
					messageId: row.id,
					blockId: form.id,
					userId: Number.isInteger(userId) && userId > 0 ? userId : null
				})
				continue
			}
			// The first option's identity names the declaration on the event;
			// the option the answer picks is what fires (`formFireOf`).
			const action = form.kind === "choices" ? form.actions[0]!.action! : form.action!
			scope.addressed?.push({
				payload: {
					sessionId: row.sessionId,
					messageId: row.id,
					blockId: form.id,
					action,
					addressee: form.addressee
				},
				form
			})
		}
		return blocks
	}

	/**
	 * Named rather than returned as a literal, because one branch of `call`
	 * needs a read: a core tool sees the session through the host's own
	 * enumerated seam (see `ToolContext`), and the alternative — a second
	 * copy of those queries beside the switch — is the drift this file's
	 * whole shape exists to prevent.
	 */
	const host: CoreHostServices = {
		// Read-only, and a data property rather than a method because it is a
		// fact about the run and not a service the executor calls. The executor
		// reaches only for the four named methods, so carrying it costs the
		// wire nothing.
		get ownerPluginId() {
			return scope.ownerPluginId
		},
		async read(table, query, node) {
			const q = (query ?? {}) as Record<string, any>

			switch (table) {
				case "session_messages": {
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return []

					/**
					 * Channel scoping (20 §7, R6) — in the `where`, not after
					 * the limit.
					 *
					 * An omitted channel is the session's default lane,
					 * `main`, and never a union: see `messages/channels.ts`
					 * for why an unqualified read resolves rather than
					 * refuses. `ALL_CHANNELS` is the union and has to be
					 * asked for by name.
					 *
					 * It was a post-filter over ids fetched from the mirror,
					 * which meant "the last 40 on this lane" was really "how
					 * many of the last 40 in the session happened to be on
					 * it" — silently short, and indistinguishable from a lane
					 * with little history.
					 *
					 * Lanes (ruling 2026-09-09): a **bare slug is the whole
					 * channel** and `slug:n` is one lane of it. The window is
					 * still the newest `limit` rows — a whole-channel read of
					 * five conversations wants the recent traffic across them,
					 * not the opening of the first — and the rows are then put
					 * in lane-then-time order, so the five read as five. On a
					 * channel that has only lane 1, which is every channel that
					 * existed before this shipped, `byLaneThenTime` is exactly
					 * the `reverse()` it replaces.
					 */
					const channel = resolveChannel(q.channel)
					const spansLanes = channelSpansLanes(channel)

					// `isHidden` is the existing convention for a message that should
					// not reach a model. Honoured here rather than left to each
					// binding, so a new Query type cannot forget it.
					/**
					 * ⚠ And `isGenerating`, on the same footing (ruling
					 * 2026-09-08, D-2). **A row that is still being written is
					 * not a stored message**, and this read is the one seam
					 * every message query in the product goes through — the
					 * history window, the keyword scan, the entity and semantic
					 * mechanisms — so the rule is stated once here rather than
					 * four times downstream where one of them would forget it.
					 *
					 * The legacy path always excluded it (`generateResponse.ts`
					 * loads the session with `ne(cm.id, generatingMessage.id)`)
					 * and this path never did, which was two bugs wearing one
					 * omission:
					 *
					 * - an **extend** keeps its partial text on the row, so the
					 *   partial arrived at every retrieval mechanism as though
					 *   somebody had said it — lore keyed on a word the model
					 *   had half-written was retrieved on the strength of the
					 *   model's own unfinished sentence;
					 * - and an ordinary turn's row is blank, so every prompt
					 *   carried an empty `"Alice: "` transcript line immediately
					 *   before the seed line that says the same thing.
					 *
					 * The partial still reaches the model — as
					 * `continuationPrefill` on the seed line, which is the one
					 * place a continuation belongs.
					 */
					/**
					 * **Only the unplayed talk** (lair re-plan R13): a side
					 * channel's rows since the story's newest generated line,
					 * people's lines and the replies fired there — see
					 * `sessions/unplayedTalk.ts`. The binding refuses it on
					 * `main` before it gets here. Same filters, same order,
					 * same cap: the window is the newest `limit` of the talk.
					 */
					/**
					 * **One row, by id** (lair re-plan R11): the message a
					 * press on a message's ⋮ was made on — `session-history@1`'s
					 * `messageId` in-port. This session's only, and hidden or
					 * still-generating reads as nothing, as in any window;
					 * the channel selector, the window and the talk filters do
					 * not apply to a row named outright.
					 */
					const byId =
						typeof q.messageId === "number" && Number.isInteger(q.messageId)
							? q.messageId
							: null
					/**
					 * **Sized by the window** (history window, 2026-10-03):
					 * `readTokens` is `session-history@1`'s wired `budget`,
					 * doubled (`historyReadTokens`). The window is then the
					 * newest rows up to that estimate — every row when they
					 * never reach it, never more than `HISTORY_READ_MAX_ROWS` —
					 * in place of the newest `limit`. Two reads, so a long
					 * session's text beyond the window never leaves the
					 * database: each row's size first (`octet_length`, which
					 * Postgres answers off the stored header), then the rows
					 * from the first one kept. Same filters, same order as the
					 * count window below; not for the talk or a row by id.
					 */
					const windowWhere = and(
						eq(schema.sessionMessages.sessionId, sessionId),
						eq(schema.sessionMessages.isHidden, false),
						eq(schema.sessionMessages.isGenerating, false),
						channelWhere(schema.sessionMessages.channel, channel)
					)
					const readTokens =
						byId === null &&
						q.unplayedOnly !== true &&
						typeof q.readTokens === "number" &&
						q.readTokens > 0
							? q.readTokens
							: 0
					const sizedFrom = readTokens
						? await (async () => {
								const { historyReadRowCount, HISTORY_READ_MAX_ROWS } =
									await import("$lib/server/pipelines/prompt/transcriptFit")
								const sizes = await db
									.select({
										id: schema.sessionMessages.id,
										bytes: sql<number>`coalesce(octet_length(${schema.sessionMessages.content}), 0)`
									})
									.from(schema.sessionMessages)
									.where(windowWhere)
									.orderBy(desc(schema.sessionMessages.id))
									.limit(HISTORY_READ_MAX_ROWS)
								const n = historyReadRowCount(
									sizes.map((s: { bytes: unknown }) => Number(s.bytes)),
									readTokens
								)
								return n > 0 ? Number(sizes[n - 1].id) : null
							})()
						: undefined
					const read =
						byId !== null
							? await db
									.select()
									.from(schema.sessionMessages)
									.where(
										and(
											eq(schema.sessionMessages.id, byId),
											eq(schema.sessionMessages.sessionId, sessionId),
											eq(schema.sessionMessages.isHidden, false),
											eq(schema.sessionMessages.isGenerating, false)
										)
									)
									.limit(1)
							: q.unplayedOnly === true
							? await (
									await import("$lib/server/sessions/unplayedTalk")
								).unplayedTalkRows(
									db,
									sessionId,
									channel,
									Math.min(q.limit ?? 100, 500)
								)
							: sizedFrom === null
								? []
								: sizedFrom !== undefined
									? (
											await db
												.select()
												.from(schema.sessionMessages)
												.where(
													and(
														windowWhere,
														gte(schema.sessionMessages.id, sizedFrom)
													)
												)
												.orderBy(desc(schema.sessionMessages.id))
										).reverse()
									: // Reversed after a descending limit: "the most recent
										// N, in reading order" is what every caller wants, and
										// doing it here means no binding has to remember which
										// end it got.
										(
											await db
												.select()
												.from(schema.sessionMessages)
												.where(windowWhere)
												.orderBy(desc(schema.sessionMessages.id))
												.limit(Math.min(q.limit ?? 100, 500))
										).reverse()
					/**
					 * **Side channels as talk** (`talkOnly`, lair re-plan R10's
					 * fold-in of the R9 follow-up): every non-`main` row that
					 * is not talk — a greeting a create run wrote, a story
					 * turn's beats row — dropped by its creating run's inlet
					 * channel, the fact the unplayed talk reads. After the
					 * window, so it may hand on fewer than `limit`.
					 */
					const ordered =
						byId === null && q.talkOnly === true && q.unplayedOnly !== true
							? await (
									await import("$lib/server/sessions/unplayedTalk")
								).sideTalkOnly(db, read)
							: read
					/**
					 * The genre's per-channel prompt shaping (R-C), resolved
					 * once per host and `null` for every genre that declares
					 * none. Carried onto the rows here because this is the one
					 * place a message and its session are both in hand — a
					 * task node downstream has the row and no way to ask what
					 * its channel means.
					 */
					const shaping = await channelShaping(sessionId)
					const history = (
						spansLanes ? byLaneThenTime(ordered) : ordered
					).map((r) => toMessage(r, shaping))

					// The uncommitted draft goes last, where the real message
					// would be. `id: -1` marks it as belonging to no row.
					//
					// Only on a read that includes the composer's own lane:
					// the draft is what somebody is typing into the session's
					// main composer, and appending it to a read of `map` would
					// be the mixing this scoping exists to prevent. A
					// per-channel composer is later work; when it arrives the
					// draft grows a channel and this comparison uses it.
					//
					// The composer's lane is `main` lane 1, so a whole-channel
					// read of `main` and a read of `main:1` both include it and
					// a read of `main:2` does not.
					const draftLane = parseChannel(channel)
					if (
						byId === null &&
						scope.draftMessage?.content?.trim() &&
						(isAllChannels(channel) ||
							(draftLane.slug === DEFAULT_CHANNEL &&
								draftLane.lane === DEFAULT_LANE))
					)
						history.push(
							toMessage(
								{
									id: -1,
									sessionId,
									role: "user",
									channel: DEFAULT_CHANNEL,
									content: scope.draftMessage.content,
									personaId:
										scope.draftMessage.personaId ?? null,
									characterId: null,
									isHidden: false
								},
								shaping
							)
						)

					return history
				}

				case "sessions": {
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return []
					return await db
						.select()
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
				}

				case "session_settings": {
					// The settings document (PLAN-turn-order §4.12, way 2):
					// `core:query/session-settings@1` re-reads it after a
					// write that may have moved a value. One resolver behind
					// the declared node — sessions/settings.ts — the same
					// posture as the greetings read below.
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return null
					const { resolveSessionSettings } = await import(
						"$lib/server/sessions/settings"
					)
					return await resolveSessionSettings(db, sessionId)
				}

				case "session_annex": {
					/**
					 * One owner's annex document (PLAN-turn-order §4.3).
					 *
					 * The owner is the running spec's own namespace unless
					 * the node's params name another AND `sharedAnnex` is on
					 * — the default is the whole safety of the field: a spec
					 * reads its own document without saying anything, and
					 * has to say `sharedAnnex` out loud to read anybody
					 * else's. A refusal answers `{}` with a note rather than
					 * halting: the annex is memory, and a read of memory
					 * that is not there is an ordinary state.
					 */
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return null
					if (q.view === "template") {
						/**
						 * The template view (typed templates P6, owner ruling
						 * Q1): every DECLARED key of every owner in scope —
						 * core and the enabled plugins, for this session's
						 * genre — keyed by owner. Not one owner's document, so
						 * `owner` / `sharedAnnex` do not apply; law T2 lets
						 * this read feed only a template's `annex` port, so it
						 * reaches a prompt and nowhere else.
						 */
						const [row] = await db
							.select({ annex: schema.sessions.annex })
							.from(schema.sessions)
							.where(eq(schema.sessions.id, sessionId))
							.limit(1)
						if (!row) return null
						const { templateAnnex, sessionGenreOf } = await import(
							"$lib/server/sessions/annexFields"
						)
						return await templateAnnex(
							db,
							await sessionGenreOf(db, sessionId),
							(row.annex ?? {}) as Record<string, unknown>
						)
					}
					const params = (q.params ?? {}) as {
						owner?: unknown
						sharedAnnex?: unknown
					}
					const own = annexOwnerOf(scope.specId)
					const named =
						typeof params.owner === "string" && params.owner.trim()
							? params.owner.trim()
							: null
					const owner =
						named && named !== own
							? params.sharedAnnex === true
								? named
								: null
							: own
					if (owner === null) return {}
					const [row] = await db
						.select({
							annex: schema.sessions.annex,
							audiences: schema.sessions.annexAudiences
						})
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					if (!row) return null
					const annex = (row.annex ?? {}) as Record<string, unknown>
					const doc = annex[owner]
					const whole =
						doc && typeof doc === "object" && !Array.isArray(doc)
							? (doc as Record<string, unknown>)
							: {}
					if (q.view !== "ai") return whole
					// The AI's view (R57): only what the model's context may
					// carry — for this speaker, when the prompt has one.
					const { aiHolds, visibleTo } = await import("@serene-pub/sdk")
					const { isParticipantRef, canonicalParticipantRef } = await import("@serene-pub/sdk")
					const speaker =
						typeof q.speaker === "string" && isParticipantRef(q.speaker)
							? canonicalParticipantRef(q.speaker)
							: null
					// Who may see each key is the owner's declaration's to say
					// (ruling 2026-09-26): a key none covers — legacy data a
					// write stored before the ruling — is pipelines only.
					const { declaredAudiences, sessionGenreOf } = await import(
						"$lib/server/sessions/annexFields"
					)
					const audiences = await declaredAudiences(db, await sessionGenreOf(db, sessionId))
					return (
						visibleTo({ [owner]: whole }, audiences, (refs) =>
							aiHolds(refs, speaker as never)
						)[owner] ?? {}
					)
				}

				case "history_attachments": {
					// The files a transcript's rows show (PLAN-composer-
					// attachments §3.5) — `core:query/history-attachments@1`.
					// Always the run's own session: a message id of any other
					// session contributes nothing, however it got here.
					const sessionId = scope.sessionId
					if (sessionId === undefined) return {}
					const ids = Array.isArray(q.messageIds)
						? (q.messageIds as unknown[]).filter(
								(id): id is number => typeof id === "number"
							)
						: []
					const { historyAttachmentsFor } = await import(
						"$lib/server/attachments/history"
					)
					return historyAttachmentsFor(db, {
						sessionId,
						messageIds: ids,
						textFileBytes:
							typeof q.textFileBytes === "number"
								? q.textFileBytes
								: undefined
					})
				}

				case "session_greetings": {
					// The create pipeline's read (24 §12, T8): the cast's
					// greeting entries, interpolated, position-ordered. The
					// implementation lives in sessions/greetings.ts — one
					// implementation behind the declared node.
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return []
					const { collectSessionGreetings } = await import(
						"$lib/server/sessions/greetings"
					)
					const { entries } = await collectSessionGreetings(
						db,
						sessionId
					)
					return entries
				}

				case "envoy_greeting": {
					// The create pipeline's other read (lair re-plan R6): a
					// seated envoy's declared greeting, interpolated — one
					// implementation behind the declared node, in
					// sessions/greetings.ts. Undefined when the envoy is not
					// seated or declares none.
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return undefined
					const { collectEnvoyGreeting } = await import(
						"$lib/server/sessions/greetings"
					)
					return await collectEnvoyGreeting(
						db,
						sessionId,
						typeof q.envoy === "string" ? q.envoy : undefined
					)
				}

				case "summarize_source": {
					/**
					 * The messages a summary is drawn from, with sender *names*.
					 *
					 * A separate read from `session_messages` because the two want
					 * different things: retrieval wants the recent window in
					 * reading order; a summary wants a chosen range — possibly
					 * the whole session — and it wants `senderName` resolved, since
					 * the drafting prompt renders speakers and a batch of
					 * "Unknown: ..." lines summarizes a conversation nobody had.
					 *
					 * The selection rule mirrors the legacy handler exactly: an
					 * explicit id list is taken as given (a person picked those
					 * messages, hidden or not); "everything" filters hidden.
					 *
					 * "Everything" means everything *on one channel* (20 §7):
					 * a summary that quietly folded a side conversation into
					 * the account of the main one would be wrong in a way
					 * nothing downstream could detect. A picked list is still
					 * taken as given — the person picked those rows, lane and
					 * all.
					 */
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return []

					const messageIds: number[] | undefined = Array.isArray(
						q.messageIds
					)
						? q.messageIds.map(Number).filter(Number.isFinite)
						: undefined

					const rows = await db
						.select()
						.from(schema.sessionMessages)
						.where(
							messageIds
								? and(
										eq(
											schema.sessionMessages.sessionId,
											sessionId
										),
										inArray(
											schema.sessionMessages.id,
											messageIds
										)
									)
								: and(
										eq(
											schema.sessionMessages.sessionId,
											sessionId
										),
										eq(
											schema.sessionMessages.isHidden,
											false
										),
										channelWhere(
											schema.sessionMessages.channel,
											q.channel
										)
									)
						)
						.orderBy(asc(schema.sessionMessages.id))
						.limit(Math.min(q.limit ?? 5000, 5000))

					const charIds: number[] = [
						...new Set<number>(
							rows
								.filter((m) => m.characterId)
								.map((m) => Number(m.characterId))
						)
					]
					const personaIds: number[] = [
						...new Set<number>(
							rows
								.filter((m) => m.personaId)
								.map((m) => Number(m.personaId))
						)
					]
					const characters = charIds.length
						? await db
								.select()
								.from(schema.characters)
								.where(inArray(schema.characters.id, charIds))
						: []
					const personas = personaIds.length
						? await db
								.select()
								.from(schema.characters)
								.where(
									inArray(schema.characters.id, personaIds)
								)
						: []
					const characterName = new Map(
						characters.map((c) => [c.id, c.name])
					)
					const personaName = new Map(
						personas.map((p) => [p.id, resolvePersonaName(p)])
					)
					/**
					 * An envoy's line names it by reference and holds no
					 * character (U5g), and a line nobody claimed names nobody:
					 * both are named here — the envoy's declared name, the
					 * narrator name the row carries, else the generic
					 * `UNCLAIMED_LINE_NAME` (ruled 2026-09-26, never "Unknown").
					 */
					const envoyName = new Map<string, string>()
					if (rows.some((m) => envoySlugOfRef((m.metadata as any)?.speaker))) {
						const { sessionDeclaredEnvoys } = await import(
							"$lib/server/pipelines/entities/envoys"
						)
						for (const d of await sessionDeclaredEnvoys(db, sessionId))
							envoyName.set(d.slug, i18nText(d.name, "en") || d.slug)
					}
					const unclaimedName = (m: (typeof rows)[number]): string => {
						const slug = envoySlugOfRef((m.metadata as any)?.speaker)
						return (
							(slug && (envoyName.get(slug) ?? slug)) ||
							(m.metadata as any)?.narratorName ||
							i18nText(UNCLAIMED_LINE_NAME, "en")
						)
					}

					/**
					 * Lane-grouped, like every other whole-channel read — see
					 * the `messages` case above for the rule. A bare slug is the
					 * whole channel (ruling 2026-09-09), and five private
					 * conversations under one slug are five conversations: a
					 * summary of them interleaved by timestamp is an account of
					 * a conversation nobody had.
					 *
					 * Applied AFTER the query, over exactly the rows it
					 * returned, so the window itself is untouched. And not at
					 * all for a picked id list: `channelWhere` never ran for
					 * one, and the person picked those rows lane and all.
					 */
					const ordered =
						!messageIds && channelSpansLanes(q.channel)
							? byLaneThenTime(rows)
							: rows

					return ordered.map((m) => ({
						...toMessage(m),
						senderName:
							(m.characterId &&
								characterName.get(m.characterId)) ||
							(m.personaId && personaName.get(m.personaId)) ||
							(m.role === "user" ? "User" : unclaimedName(m))
					}))
				}

				case "lorebook_entries": {
					// The session's lorebook, or nothing. A pipeline cannot name a
					// lorebook it was not triggered against — lore is session-scoped
					// data and a spec that could reach any lorebook could read one
					// belonging to another user's session.
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return []

					const [session] = await db
						.select()
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					if (!session?.lorebookId) return []

					/**
					 * Where the session reads its book (owner ruling 3,
					 * 2026-09-28): its line — the ancestor chain with every
					 * fork cut — at its story clock, or at the head of the
					 * line when it has no clock. Two things follow and both
					 * were missing (findings #135, #143, #144):
					 *
					 *  - **which rows**: shared rows plus the chain's own, a
					 *    dated row cut at the moment and at its step's fork
					 *    (`entryOnReadingSql`). A fork's entry reaching main,
					 *    or a sibling's reaching this line, is lore from a
					 *    story this session is not in;
					 *  - **what they say**: every entry amendment on the line
					 *    that has happened by the moment, applied to the wire
					 *    row before ANY mechanism sees it (`entryAt`) — so the
					 *    keyword scan, the vector gate, the listing and the
					 *    prompt all read the entry as it stands now, not as it
					 *    was first written. (Its stored VECTOR is still the
					 *    base text's — owner ruling R1, see `ragContext.ts`.)
					 *
					 * On main with no clock the rule is `branch_id IS NULL`
					 * and no amendment exists, so a book with no lines reads
					 * exactly what it always did — the parity corpus pins it.
					 */
					const { sessionReadingOf } = await import(
						"$lib/server/state/reading"
					)
					const {
						MAIN_HEAD,
						amendedFieldNames,
						entryAt,
						entryOnReadingSql,
						entryOverlaysFor
					} = await import("$lib/server/state/entriesOnReading")
					const reading =
						(await sessionReadingOf(db, sessionId)) ?? MAIN_HEAD
					/**
					 * **The book is read once per run** (plan C4). A respond turn asks
					 * this case up to six times — the three keyword lanes, the vector and
					 * entity arms, the hop — and every one of them read the same book at
					 * the same reading: the overlays, the cast, the seats, the scan.
					 * Everything that does not depend on the asker is now read once and
					 * kept on the host (`lorebookReads`; one host serves one run), keyed
					 * on the session, its book and the reading. The reading is still
					 * asked every time, so a clock the run advanced reads a new moment,
					 * never the old one. Per asker, only the narrowings (one scan each,
					 * also kept) and the speaker's gate run again.
					 *
					 * A run is a snapshot: nothing invalidates the memo except a lore
					 * entry this host itself writes (`core:outlet/create-lore-entry`
					 * clears it), so a run that files a room and then lists the book
					 * sees the room. No content hash moves — the rows are the rows the
					 * reads always produced.
					 */
					// Narrowed above; a closure would widen it again.
					const bookId: number = session.lorebookId
					const bookKey = `${sessionId}:${bookId}:${JSON.stringify(reading)}`
					let bookPending = lorebookReads.get(bookKey)
					if (!bookPending) {
						bookPending = (async () => {
							const overlays = await entryOverlaysFor(
								db,
								bookId,
								reading
							)
							const amended = amendedFieldNames(overlays)

							/**
							 * Each row as the reading sees it, keyed by id — the wire
							 * shape (`toEntryRow`), with the keys left as the stored
							 * LIST: joining them for the wire and splitting them again
							 * in the matcher tore a regex `{1,3}` in two (finding
							 * #146). The editor now sends amendment `keys` as a list
							 * too; an amendment stored before that may still hold the
							 * comma string, and the matcher reads both.
							 */
							const resolvedOf = (row: any) =>
								entryAt(
									{
										...toEntryRow(row),
										keys: row.keys ?? [],
										secondaryKeys: row.secondaryKeys ?? []
									} as any,
									overlays,
									reading
								)

							/**
							 * Normalized here, at the read, for the same reason
							 * `session_messages` honours `isHidden` here rather than in
							 * each binding: a new Query type cannot forget it.
							 *
							 * Two transforms, and **both were missing on the pipeline
							 * path entirely** — found by mapping what only the legacy
							 * engines called. `@@` decorator lines were reaching models
							 * as literal text while `handlebarsLint.ts` promises users
							 * they are stripped, and `{{char:1}}` binding placeholders
							 * were arriving unsubstituted. The still-legacy token-count
							 * preview *did* strip them, so the number on screen and the
							 * prompt actually sent disagreed on any session using either.
							 *
							 * The legacy function is reused rather than reimplemented.
							 * A second copy of "what a lore entry looks like once it is
							 * ready" is exactly the drift this branch keeps finding —
							 * and this one would show up as a prompt difference nobody
							 * could localise. It relocates with the module when the
							 * legacy split happens; it does not get rewritten.
							 */
							const bindings = await db
								.select()
								.from(schema.lorebookBindings)
								.where(
									eq(
										schema.lorebookBindings.lorebookId,
										bookId
									)
								)
							/**
							 * Every card of each member's (plan A25): the linked one and
							 * each a dated change draws them with, on any line and at
							 * any date. A seat holding any of them is that member, so
							 * the private-lore gate below reads them as `memberCards`
							 * on the binding.
							 */
							const { castMemberCards } = await import(
								"$lib/server/utils/castMemberCards"
							)
							const { cardsOf } = await castMemberCards(
								db,
								bookId
							)
							/**
							 * Each member as the session's reading has them (plan A19):
							 * a cast amendment by then renames them, and a tag reads
							 * as the card the reading draws them with — a dated
							 * Unlink, Link or Change card included, as the editor's
							 * chip does — else as that name. `characterId` stays the
							 * member's own: it is the key a seat holds, and the
							 * private-lore gate below reads it.
							 */
							const { castOverlaysFor, castMemberAt } = await import(
								"$lib/server/state/entriesOnReading"
							)
							const castOverlays = await castOverlaysFor(
								db,
								bookId,
								reading
							)
							const atReading = bindings.map((b) =>
								castMemberAt(b, castOverlays, reading)
							)
							const hydrated = (await hydrateBindings(db, atReading)).map(
								(m, i) => ({
									...m,
									name: m.name ?? null,
									characterId: bindings[i].characterId,
									memberCards: cardsOf.get(m.id) ?? []
								})
							)
							/**
							 * Which character each binding names, for character lore's
							 * co-occurrence signal.
							 *
							 * Resolved here because the rows are already in hand — the
							 * ranker asking for them again would be a second query per
							 * turn for a fact this read has already paid for. A binding
							 * naming nobody resolves to null, which is what legacy's
							 * `binding?.characterId` test does.
							 *
							 * The card is the one this session SEATS of the member's
							 * (plan A25) — the signal asks whether that card spoke, and
							 * a seat holding the keeper's card speaks as it — else the
							 * linked card. The linked card wins when both are seated.
							 */
							const seated = new Set(
								(
									await db
										.select({
											characterId:
												schema.sessionCharacters.characterId
										})
										.from(schema.sessionCharacters)
										.where(
											eq(
												schema.sessionCharacters.sessionId,
												sessionId
											)
										)
								).map((r) => r.characterId)
							)
							const bindingCharacter = new Map<number, number | null>(
								bindings.map((b) => [
									b.id,
									b.characterId != null && seated.has(b.characterId)
										? b.characterId
										: ((cardsOf.get(b.id) ?? []).find((c) =>
												seated.has(c)
											) ??
											b.characterId ??
											null)
								])
							)
							const boundCharacterOf = (e: any) =>
								e?.lorebookBindingId != null
									? (bindingCharacter.get(e.lorebookBindingId) ??
										null)
									: null
							// The visibility rule below reads the session's personas, so
							// they are part of the shape it is handed.
							const sessionPersonas = await db
								.select()
								.from(schema.sessionPersonas)
								.where(eq(schema.sessionPersonas.sessionId, sessionId))
							const asSession = {
								lorebookId: bookId,
								lorebook: {
									id: bookId,
									lorebookBindings: hydrated
								},
								sessionPersonas: sessionPersonas.map((cp) => ({
									persona: { id: cp.personaId }
								}))
							} as any

							const {
								populateLorebookEntryBindings,
								isCharacterLoreEntryVisible,
								castTagName
							} = await import(
								"$lib/server/pipelines/prompt/characterLore"
							)
							const ready = (e: any) =>
								populateLorebookEntryBindings(e, asSession)
							/**
							 * The cast member an anchored row is bound to, named as the
							 * reading has them (`castTagName` — the name its cast tag
							 * reads as). Assemble's `characterLore` shows it beside the
							 * entry, so a template placing the block apart from the
							 * cards still says whose each secret is. Null for a row
							 * bound to nobody.
							 */
							const hydratedById = new Map(
								hydrated.map((b: any) => [b.id, b])
							)
							const castMemberOf = (e: any): string | null => {
								const b =
									e?.lorebookBindingId != null
										? hydratedById.get(e.lorebookBindingId)
										: undefined
								return (b && castTagName(b)) || null
							}

							/**
							 * The annotation lane's own content hash, borrowed whole —
							 * see `entrySourceHash`. Imported the way this case imports
							 * everything else it needs, so the module graph a socket
							 * pulls in is unchanged.
							 */
							const { entrySourceHash } = await import(
								"$lib/server/annotations"
							)

							/**
							 * Each row as the reading sees it, made ready for a prompt
							 * (`ready` rewrites the content in place, so it runs once
							 * per row per run, never once per asker).
							 */
							const entries = new Map<number, any>()
							const entryOf = (row: { id: number }) => {
								let entry = entries.get(row.id)
								if (!entry) {
									entry = ready(resolvedOf(row))
									entries.set(row.id, entry)
								}
								return entry
							}
							return {
								amended,
								entryOf,
								asSession,
								boundCharacterOf,
								castMemberOf,
								entrySourceHash,
								isCharacterLoreEntryVisible,
								scans: new Map<
									string,
									Promise<Array<typeof schema.lorebookEntries.$inferSelect>>
								>()
							}
						})()
						lorebookReads.set(bookKey, bookPending)
						// A failed read is not a snapshot: the next asker reads again.
						bookPending.catch(() => lorebookReads.delete(bookKey))
					}
					const {
						amended,
						entryOf,
						asSession,
						boundCharacterOf,
						castMemberOf,
						entrySourceHash,
						isCharacterLoreEntryVisible,
						scans
					} = await bookPending


					/**
					 * The five optional narrowings, added for
					 * `core:query/lorebook-entries@1` — the **listing** door.
					 *
					 * Every one of them is a no-op when the caller omits it, so
					 * the retrieval path (`loreFor`, `lorebook-triggers@1`,
					 * which pass `sessionId` and `currentCharacterId` and
					 * nothing else) reads exactly the SQL it always did: the
					 * whole book, no `LIMIT`, disabled and archived rows
					 * included. That last part is load-bearing rather than
					 * incidental — the keyword scan reports a disabled entry on
					 * `skipped` with a reason, which is how a person is told
					 * why their lore did not come in, and a filter here would
					 * turn that sentence into silence.
					 *
					 * The listing asks for the other posture — `enabled: true`,
					 * `archived: false` — because it answers *does this exist*
					 * and *pick one of these*, where a switched-off room must
					 * not exist and a shelved suspect must not be picked.
					 * `archived`'s own column comment is the rule: *don't
					 * retrieve it and don't show it to me.*
					 */
					const wheres = [
						eq(
							schema.lorebookEntries.lorebookId,
							session.lorebookId
						),
						entryOnReadingSql(reading)
					]
					/**
					 * The narrowings an amendment can move — the title, Off,
					 * archived — are asked of the RESOLVED row once one of the
					 * line's amendments sets that field: the stored column is
					 * then not what the entry says. Otherwise they stay in SQL,
					 * and so does the row ceiling below.
					 */
					const afterResolve: Array<(e: any) => boolean> = []
					// Bare type ids, no `@version`: a type's rows are its rows
					// across versions, and `type_version` is its own column.
					// An id no type declares matches nothing, which is the
					// honest answer to a typo.
					const wantedTypes = Array.isArray(q.entryTypes)
						? q.entryTypes.filter(
								(t: unknown) =>
									typeof t === "string" && t.length > 0
							)
						: []
					if (wantedTypes.length)
						wheres.push(
							inArray(schema.lorebookEntries.typeId, wantedTypes)
						)
					/**
					 * Exact, case-insensitive, both ends trimmed — never a
					 * substring and never a pattern. The question this answers
					 * is "is there an entry called X", and a match that also
					 * returned "X Door" would answer one nobody asked; the
					 * search-shaped reading of this is the keyword scan, which
					 * already exists.
					 *
					 * `title` is the column the `title` **field role** names on
					 * both types that declare one (`core-catalog/entries.ts`).
					 * History declares no title at all, so a named read lists
					 * no history — the same `null` `toEntryRow` already
					 * publishes for it.
					 */
					if (typeof q.name === "string" && q.name.trim() !== "") {
						const wanted = q.name.trim().toLowerCase()
						if (amended.has("name"))
							afterResolve.push(
								(e) =>
									typeof e.name === "string" &&
									e.name.trim().toLowerCase() === wanted
							)
						else
							wheres.push(
								sql`lower(btrim(${schema.lorebookEntries.title})) = ${wanted}`
							)
					}
					if (typeof q.enabled === "boolean") {
						const want = q.enabled
						if (amended.has("enabled"))
							afterResolve.push((e) => (e.enabled !== false) === want)
						else
							wheres.push(
								eq(schema.lorebookEntries.enabled, want)
							)
					}
					if (typeof q.archived === "boolean") {
						const want = q.archived
						if (amended.has("archived"))
							afterResolve.push((e) => (e.archived === true) === want)
						else
							wheres.push(
								eq(schema.lorebookEntries.archived, want)
							)
					}

					/**
					 * One scan of one table for every type.
					 *
					 * Ordered by id because a single scan interleaves the
					 * types, and partitioning in memory preserves whatever
					 * order the heap gave, which is arbitrary. Id order is the
					 * one deterministic choice.
					 *
					 * Under a ceiling the NEWEST rows are the ones kept (plan
					 * A27): read from the newest down, then put back in id
					 * order. A book past the ceiling otherwise dropped the room
					 * Answer the door had just built from the next turn's
					 * `{{knownLocations}}`.
					 */
					const capped = typeof q.limit === "number"
					const scan = db
						.select()
						.from(schema.lorebookEntries)
						.where(and(...wheres))
						.orderBy(
							capped
								? desc(schema.lorebookEntries.id)
								: asc(schema.lorebookEntries.id)
						)
					/**
					 * A ceiling on **rows read**, and the gate below may still
					 * reduce it: a caller asking for 50 and speaking as a
					 * character can be handed fewer, because the 50 cheapest
					 * rows to fetch are chosen before anyone asks who may see
					 * them. Limiting after the gate would mean reading the
					 * whole book to honour a cap, which is the cost the cap
					 * exists to avoid. In the case the listing exists for —
					 * narrator-shaped, nothing gated — the count is exact.
					 */
					// One scan per set of narrowings per run (C4): the retrieval
					// lanes all ask the bare book and share it.
					const scanKey = JSON.stringify([
						wantedTypes,
						typeof q.name === "string" ? q.name.trim().toLowerCase() : null,
						typeof q.enabled === "boolean" ? q.enabled : null,
						typeof q.archived === "boolean" ? q.archived : null,
						capped ? q.limit : null
					])
					let scanned = scans.get(scanKey)
					if (!scanned) {
						scanned = (async () => {
							let rows: Array<typeof schema.lorebookEntries.$inferSelect>
							if (afterResolve.length === 0) {
								rows = await (capped ? scan.limit(q.limit) : scan)
							} else {
								// A narrowing an amendment moved: every candidate is
								// resolved before it is asked, and the ceiling counts
								// what survived — never rows an amendment turned away.
								rows = []
								for (const row of await scan) {
									if (capped && rows.length >= q.limit) break
									if (!afterResolve.every((keep) => keep(entryOf(row))))
										continue
									rows.push(row)
								}
							}
							// Back in id order: the ceiling chose which rows, never their order.
							if (capped) rows.reverse()
							return rows
						})()
						scans.set(scanKey, scanned)
						scanned.catch(() => scans.delete(scanKey))
					}
					const rows = await scanned


					/**
					 * Character lore is private self-knowledge.
					 *
					 * An entry bound to a character is visible only while
					 * generating *as* that character; one bound to nothing is
					 * the Narrator's alone. The legacy engines have always
					 * enforced this and the pipeline path never did — so every
					 * character's private lore has been competing for the same
					 * ranking budget as world lore on every turn, and would
					 * have leaked outright the moment character lore was wired
					 * into the cast cards.
					 *
					 * `currentCharacterId` is `null` in narrator mode, which the
					 * rule treats as omniscient. A read that does not supply it
					 * is therefore narrator-shaped by default — the callers all
					 * pass it, and the coalesce keeps `undefined` from silently
					 * meaning "some character".
					 *
					 * ## `speaker` — per-speaker scope (W1, 2026-09-17)
					 *
					 * The run has ONE scope and a gather runs ONCE, so without
					 * a per-speaker subject every voice of a multi-agent turn
					 * would be handed every character's private lore (Whodunit
					 * would leak its suspects to each other).
					 * `core:query/character-lore@1` and
					 * `core:query/lorebook-triggers@1` declare a `speaker`
					 * in-port for that — a participant reference the spec wires
					 * INSIDE the clause — and it is the subject here, in place
					 * of the scope's.
					 *
					 * ⚠ A wired `speaker` never widens the gate. Absent, null or
					 * empty (the port unwired, which is every spec written
					 * before this — and a free-form side character, whose
					 * context publishes null), the scope decides exactly as it
					 * did. Wired and naming a character row, that character
					 * decides. Wired and naming anybody else — an envoy, a
					 * role, a bare name — the subject is
					 * `NO_SUCH_CHARACTER`, a value no binding can carry, so the
					 * voice reads no private lore at all. That third case is
					 * the one that must not fall back to `null`: `null` is the
					 * omniscient narrator, and "this voice is nobody" would
					 * then mean "this voice knows everything", which is the
					 * leak the port exists to close.
					 */
					const speaker = loreVisibilitySubject(q)
					const visible = (e: any) =>
						isCharacterLoreEntryVisible(e, asSession, speaker)

					// Tagged with their source rather than returned as three lists,
					// because every consumer downstream — scoring, budgeting, the
					// receipt — keys on source, and splitting them again at each
					// step is three chances to forget one.
					//
					// ⚠ World, then character, then history — the order the
					// three concatenated lists had. Nothing downstream is
					// documented to depend on it, which is exactly why it is
					// not the thing to change here.
					const out: any[] = []
					for (const typeId of ENTRY_TYPE_IDS) {
						const decl = entryDeclaration(typeId)
						// The privacy gate is the type's declared anchor
						// policy, not a branch on which shape this is. World
						// lore declares no anchor, so it is not asked; history
						// declares none either. Types select policies and never
						// author them, and this is the one core implements.
						const gated =
							decl?.roles.anchor?.policy ===
							BINDING_VISIBILITY_POLICY
						const source = bandOfType(typeId) as
							| "worldLore"
							| "characterLore"
							| "history"
						for (const row of rows) {
							if (row.typeId !== typeId) continue
							const entry = entryOf(row)
							if (gated && !visible(entry)) continue
							out.push(
								toLoreEntry(
									entry,
									source,
									boundCharacterOf(entry),
									gated ? castMemberOf(entry) : null,
									// ⚠ `row`, not `entry`. The stored columns
									// are what a later reader can hash again;
									// the hydrated entry is not reproducible
									// from the database alone.
									entrySourceHash(row)
								)
							)
						}
					}

					/**
					 * `withLinks` (places plan B2): each listed row's lore
					 * links, said from that row — `LoreLinkRow[]` on `links`.
					 *
					 * The relationship hop's own reading (`readGraphEntryLinks`:
					 * the session's line at its moment, standing and not
					 * secret, both ends live), projected per row by
					 * `loreLinkRowsOf` — so a room's ways out in a prompt and
					 * the hop never disagree. Absent, rows carry no `links`
					 * key at all.
					 *
					 * ⚠ **A far end is named for the WIRED speaker only.** A
					 * listing with no `speaker` wired is read once and may be
					 * shared by every voice in the turn — the Lair's rooms are
					 * (B6 review round): one read feeds the narration, the
					 * planner and each delver's prompt. The scope's subject is
					 * then whoever heads the turn, or nobody on an envoy's
					 * turn (`null`, the omniscient narrator) — not the one
					 * reading. So, unwired, gated character lore that is not
					 * itself listed is named as a far end only when
					 * `NO_SUCH_CHARACTER` may see it: when any voice may (a
					 * persona's lore). Wired, the speaker decides, as for a
					 * listed row. A far end the listing itself carries is
					 * named either way — the output already holds it.
					 */
					if (q.withLinks === true && out.length) {
						const { readGraphEntryLinks, loreLinkRowsOf } =
							await import("$lib/server/utils/graphEntryLinks")
						const standing =
							(await readGraphEntryLinks(db, sessionId)) ?? []
						const listed = new Set(out.map((e) => e.id))
						const farIds = [
							...new Set(
								standing.flatMap((l) =>
									[l.from, l.to]
										.filter(
											(end) =>
												end.kind === "entry" &&
												!listed.has(end.id)
										)
										.map((end) => end.id)
								)
							)
						]
						// Listed rows passed the gate already; a far end the
						// listing did not carry is asked here, by its type's
						// declared anchor policy — for the wired speaker, or
						// for any voice when none is wired (above).
						const seen = new Set<number>(listed)
						const farRows = farIds.length
							? await db
									.select()
									.from(schema.lorebookEntries)
									.where(
										inArray(schema.lorebookEntries.id, farIds)
									)
							: []
						const farSubject = speakerIsWired(q)
							? speaker
							: NO_SUCH_CHARACTER
						for (const row of farRows) {
							const gated =
								entryDeclaration(row.typeId)?.roles.anchor
									?.policy === BINDING_VISIBILITY_POLICY
							if (
								!gated ||
								isCharacterLoreEntryVisible(
									entryOf(row),
									asSession,
									farSubject
								)
							)
								seen.add(row.id)
						}
						// A listed row the gate withheld is not in `out`, so
						// it is unseen here too: `listed` is what went out.
						for (const e of out)
							e.links = loreLinkRowsOf(e.id, standing, (id) =>
								seen.has(id)
							)
					}
					return out
				}


				case "session_cast": {
					/**
					 * Who is in the session, and the prompt config they speak under.
					 *
					 * One read rather than three, because the cast is only useful
					 * assembled: a character row without its `sessionCharacters` join
					 * carries no `enabled`, and `enabled` is what decides whether
					 * that character is named in the prompt and given a turn.
					 * Splitting them would let a spec read the characters and skip
					 * the join, which is a switched-off character in every prompt
					 * and no error anywhere.
					 *
					 * ⚠ **Every seat, switched off or not** (2026-09-27): a seat
					 * the cast list switched off (`session_characters.is_active`)
					 * is still a seat, and goes out with `enabled: false` so a
					 * pipeline or a widget can filter on it. Every reader that
					 * must not see one filters on `enabled` itself — the turn
					 * pool, the rotation, the prompt's `characterNames`, the
					 * choice-options node.
					 *
					 * The rows go out raw. Which of them are shown, named, or
					 * trimmed is `promptFields.resolveContextInput`'s decision — the
					 * host retrieves, it does not choose.
					 */
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return null

					const [session] = await db
						.select()
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					if (!session) return null

					// `position` and `removedAt` ride along for the next-speaker
					// strategies (19 §5): the rotation is ordered by position and
					// must not seat a soft-removed participant. Inert to the
					// prompt path — `resolveContextInput` picks fields by name.
					const [sessionCharacters, sessionPersonas] =
						await Promise.all([
							db
								.select({
									// `is_active` in the table, `enabled` on
									// every read a pipeline or widget takes
									// (R5: translated here, at the seam).
									enabled: schema.sessionCharacters.isActive,
									position: schema.sessionCharacters.position,
									removedAt:
										schema.sessionCharacters.removedAt,
									character: schema.characters
								})
								.from(schema.sessionCharacters)
								.innerJoin(
									schema.characters,
									eq(
										schema.sessionCharacters.characterId,
										schema.characters.id
									)
								)
								.where(
									eq(
										schema.sessionCharacters.sessionId,
										sessionId
									)
								),
							db
								.select({
									persona: schema.characters,
									position: schema.sessionPersonas.position,
									removedAt: schema.sessionPersonas.removedAt
								})
								.from(schema.sessionPersonas)
								.innerJoin(
									schema.characters,
									eq(
										schema.sessionPersonas.personaId,
										schema.characters.id
									)
								)
								.where(
									eq(
										schema.sessionPersonas.sessionId,
										sessionId
									)
								)
						])

					/**
					 * The other half of the alias union, per cast member.
					 *
					 * `characters.aliases` rides on the
					 * rows above already; `lorebook_bindings.absorbedAliases` —
					 * where `narrativeGraph:mergeNode` puts the identity a merge
					 * absorbed — does not, and that column's schema note makes
					 * reading **both** mandatory for any consumer matching on
					 * names. It is kept out of `aliases` on purpose: `aliases`
					 * is a one-directional sync target replaced wholesale on
					 * every entity edit, so an absorbed name written there would
					 * vanish the next time that sync ran.
					 *
					 * Read here rather than at each consumer because this is the
					 * one place that already knows both the session and its
					 * lorebook. Attached per row and inert to the prompt path —
					 * `resolveContextInput` picks fields by name, as it does
					 * with `position` and `removedAt`.
					 */
					// ONE map: a voiced character's binding is a character
					// binding, so the cast and the voices read the same key
					// space. `absorbedByPersona` is an alias of it so both call
					// sites below still say which side they are on.
					const absorbedByCharacter = new Map<number, string[]>()
					const absorbedByPersona = absorbedByCharacter
					/**
					 * The book's whole roster, not just the seated part of it.
					 *
					 * The same rows the alias map above is built from, kept
					 * whole and passed on, because retrieval's gazetteer needs
					 * the names of characters this session never seated — a
					 * lorebook binds a cast far larger than any one scene, and
					 * `annotations/loadVocabulary` has always read all of them.
					 * Retrieval reading only the seated ones is how the two
					 * subsystems came to disagree about what one lorebook is
					 * called.
					 *
					 * Carried on the cast read rather than given a read of its
					 * own purely to avoid a second query: this block already
					 * has the rows, and `loreFor` runs three times a turn with
					 * `lorebook-triggers` behind it. Inert to the prompt path
					 * for the same reason `absorbedAliases` is.
					 */
					let lorebookBindings: Array<{
						characterId: number | null
						name: string | null
						aliases: string[]
						absorbedAliases: string[]
					}> = []
					if (session.lorebookId) {
						const stored = await db
							.select({
								id: schema.lorebookBindings.id,
								characterId:
									schema.lorebookBindings.characterId,
								name: schema.lorebookBindings.name,
								aliases: schema.lorebookBindings.aliases,
								absorbedAliases:
									schema.lorebookBindings.absorbedAliases
							})
							.from(schema.lorebookBindings)
							.where(
								eq(
									schema.lorebookBindings.lorebookId,
									session.lorebookId
								)
							)
							// Stable, and the same order `loadVocabulary` reads
							// them in: two bindings claiming one name must be
							// settled the same way on both sides.
							.orderBy(asc(schema.lorebookBindings.id))
						/**
						 * Each member as the session's reading sees them
						 * (findings #38/#144): a name or an alias a cast
						 * amendment set by the session's clock is what the
						 * story calls them now. The card stays the member's
						 * own — it is the key a seat holds.
						 */
						const { sessionReadingOf } = await import(
							"$lib/server/state/reading"
						)
						const { MAIN_HEAD, castOverlaysFor, castMemberAt } =
							await import("$lib/server/state/entriesOnReading")
						const castReading =
							(await sessionReadingOf(db, sessionId)) ?? MAIN_HEAD
						const castOverlays = await castOverlaysFor(
							db,
							session.lorebookId,
							castReading
						)
						const bindings = stored.map(({ id: _id, ...b }) => {
							const m = castMemberAt(
								{ id: _id, ...b },
								castOverlays,
								castReading,
								{ keepCard: true }
							)
							return {
								characterId: b.characterId,
								name: m.name ?? null,
								aliases: Array.isArray(m.aliases) ? m.aliases : [],
								absorbedAliases: Array.isArray(m.absorbedAliases)
									? m.absorbedAliases
									: []
							}
						})
						lorebookBindings = bindings
						// Every card of a member's carries what they absorbed —
						// the linked one and each a dated change draws them with
						// (plan A25) — so a seat holding either hears it.
						const { castMemberCards } = await import(
							"$lib/server/utils/castMemberCards"
						)
						const { cardsOf } = await castMemberCards(
							db,
							session.lorebookId
						)
						for (const [i, b] of bindings.entries()) {
							const names = Array.isArray(b.absorbedAliases)
								? b.absorbedAliases
								: []
							if (!names.length) continue
							// An unbound background graph node has no card, so
							// it contributes no absorbed identity to anybody.
							for (const id of cardsOf.get(stored[i].id) ?? [])
								absorbedByCharacter.set(id, [
									...(absorbedByCharacter.get(id) ?? []),
									...names
								])
						}
					}

					/**
					 * The seated envoys (plans/29 R-18; U5g): cast rows with
					 * `envoy_slug`, each joined to its declaration — name,
					 * description, image, `speaks` — because an envoy has no
					 * character row for the `innerJoin` above to find. Live
					 * and departed, like the character rows, with `position`
					 * and `removedAt` riding along for the turn strategies;
					 * `speaks` is what tells a strategy whether it may pick
					 * one (`in-turn`) or never may (`on-action`).
					 */
					const { seatedEnvoys, sessionDeclaredEnvoys } = await import(
						"$lib/server/pipelines/entities/envoys"
					)
					const envoys = await seatedEnvoys(db, sessionId)
					/**
					 * What the prompt's transcript names a line under, beside
					 * the seats: an envoy that speaks unseated (an action's
					 * envoy; the genre's fallback), and the narrator name a
					 * line nobody claims falls back to when the genre declares
					 * no fallback envoy (ruled 2026-09-26). Read by
					 * `SessionMessageProcessor`; inert everywhere else. The
					 * declarations are cached per genre, so this is no query.
					 */
					const seatedSlugs = new Set(envoys.map((e) => e.slug))
					const declaredEnvoys = (
						await sessionDeclaredEnvoys(db, sessionId)
					).filter((d) => !seatedSlugs.has(d.slug))
					const sessionNarratorName = await narratorNameFor(
						db,
						sessionId,
						undefined
					)
					/**
					 * The session's members by user id — the owner and the
					 * guests — under the name the session view gives a line
					 * a person writes as themselves (`getMessageCharacter`):
					 * display name, else username (lair pass B11). A genre
					 * with no persona system has no other name for that
					 * line, and an empty one prompts as `": …"`. Read by
					 * `SessionMessageProcessor` only when a user line has no
					 * other name; inert everywhere else.
					 */
					const memberRows = await db
						.select({
							id: schema.users.id,
							displayName: schema.users.displayName,
							username: schema.users.username
						})
						.from(schema.users)
						.where(
							inArray(schema.users.id, [
								session.userId,
								...(
									await db
										.select({ userId: schema.sessionGuests.userId })
										.from(schema.sessionGuests)
										.where(
											eq(schema.sessionGuests.sessionId, sessionId)
										)
								).map((g) => g.userId)
							])
						)
					const memberNames: Record<number, string> = {}
					for (const m of memberRows) {
						const name = m.displayName?.trim() || m.username?.trim()
						if (name) memberNames[m.id] = name
					}

					/**
					 * Whose name a turn triggered on THIS TURN'S channel seeds
					 * under (R-C, 2026-09-17) — the declared `voice` of
					 * `scope.channel`'s slug, from the shaping this host
					 * already caches.
					 *
					 * It rides the cast read for one reason: it is the only
					 * value `core:task/build-template-context@1` and
					 * `core:task/process-messages@1` are *both* wired to, and
					 * the two halves of the seed decision are one rule
					 * (`prompt/seedLine.ts`). A port of its own would need a
					 * wire on every spec that assembles a prompt, which is a
					 * document change on each of them for a fact none of them
					 * varies.
					 *
					 * ⚠ **Absent unless the trigger NAMED a channel**, and
					 * that is the load-bearing half. A turn that named none
					 * would resolve to `main` here and `main`'s voice would
					 * then *override* the trigger row's — so a writing room,
					 * whose turns are triggered on the manuscript and say so
					 * nowhere yet, would grow back the trailing `Verity:` this
					 * whole rule exists to remove. Silence means "nobody told
					 * me", never "main", and `processMessages` keeps reading
					 * the trigger row until every trigger speaks up.
					 *
					 * ⚠ **And absent unless the genre shapes channels**, on
					 * the same terms as `channelRole` on a row:
					 * `channelShaping` answers `null` for every genre that
					 * lists only bare slugs, so the cast a pre-R-C session
					 * reads is the object it was before this existed — no key,
					 * not a key holding the default.
					 */
					const named =
						typeof scope.channel === "string" &&
						scope.channel.trim()
							? parseChannel(resolveChannel(scope.channel)).slug
							: null
					const turnChannelVoice = named
						? (await channelShaping(sessionId))?.get(named)?.voice
						: undefined

					/**
					 * The session's story time for the prompt's `currentDate`
					 * (DESIGN-story-time §3, P5, P3): the session's own clock
					 * when it has one, else the present on its line (the
					 * line's clock, else its newest history entry), and the
					 * declared calendar to spell it through. Absent — no key —
					 * without a book, so a chat's cast is the object it
					 * always was.
					 */
					const { sessionStoryNowOf, bookCalendarOf } = await import(
						"$lib/server/state/storyTime"
					)
					const storyTime =
						session.lorebookId != null
							? {
									now: await sessionStoryNowOf(db, sessionId),
									calendar: await bookCalendarOf(db, session.lorebookId)
								}
							: null

					/**
					 * How much of each card a non-speaking character shows
					 * (2026-09-27): the genre field `characterDetail`, off
					 * the same cascade the settings form reads
					 * (`genreFieldsFor` — stored, pinned, declared default).
					 *
					 * On the cast read for `turnChannelVoice`'s reason: it is
					 * the one value `build-template-context` is wired to on
					 * every spec, and a port of its own would be a wire on
					 * each of them for a fact none of them varies. ⚠ Absent —
					 * no key — for a genre that declares no such field, so the
					 * cast those sessions read is the object it was.
					 */
					const { genreFieldsFor, playerLabelFor } = await import(
						"$lib/server/pipelines/entities/sessionGenres"
					)
					const sessionFields = await genreFieldsFor(db, sessionId)
					const characterDetail = sessionFields.characterDetail
					/**
					 * 🚧 The session's AI replies so far (AN1), for the
					 * author's note's `interval`: the main channel's completed
					 * assistant lines — the reply being written now is still
					 * generating and is not one of them, so a regenerate counts
					 * as the reply it replaces did. On the cast read for
					 * `characterDetail`'s reason. ⚠ Absent — no key, no
					 * query — unless the genre declares the note (an object
					 * value), so every other session's cast is the object it
					 * was.
					 */
					const replyCount =
						sessionFields.authorsNote &&
						typeof sessionFields.authorsNote === "object" &&
						!Array.isArray(sessionFields.authorsNote)
							? Number(
									(
										await db
											.select({ n: count() })
											.from(schema.sessionMessages)
											.where(
												and(
													eq(schema.sessionMessages.sessionId, sessionId),
													eq(schema.sessionMessages.role, "assistant"),
													eq(schema.sessionMessages.channel, "main"),
													eq(schema.sessionMessages.isGenerating, false)
												)
											)
									)[0]?.n ?? 0
								)
							: undefined
					/**
					 * What a person's persona-less line is called (lair
					 * re-plan R4): the session's override, else the genre's
					 * `playerLabel`, resolved here once — read at prompt
					 * time, never stamped on a row. `SessionMessageProcessor`
					 * names those lines by it (before `memberNames`), and
					 * every context builder puts it on the template context
					 * as `{{playerLabel}}`. On the cast read for
					 * `characterDetail`'s reason. ⚠ Absent — no key — for a
					 * genre that declares none, so their cast is the object
					 * it was.
					 */
					const playerLabel = await playerLabelFor(db, sessionId)
					return {
						...(playerLabel ? { playerLabel } : {}),
						...(turnChannelVoice ? { turnChannelVoice } : {}),
						...(storyTime ? { storyTime } : {}),
						...(typeof characterDetail === "string"
							? { characterDetail }
							: {}),
						...(replyCount !== undefined ? { replyCount } : {}),
						sessionCharacters: sessionCharacters.map((cc) => ({
							...cc,
							enabled: cc.enabled !== false,
							absorbedAliases:
								absorbedByCharacter.get(cc.character?.id) ?? []
						})),
						sessionPersonas: sessionPersonas.map((cp) => ({
							...cp,
							// A persona seat has no switch; it is always
							// taking part. Said, so one filter serves both.
							enabled: true,
							absorbedAliases:
								absorbedByPersona.get(cp.persona?.id) ?? []
						})),
						envoys,
						declaredEnvoys,
						...(sessionNarratorName ? { sessionNarratorName } : {}),
						memberNames,
						lorebookBindings,
						sessionScenario: session.scenario ?? null,
						isGroup: Boolean(session.isGroup),
						/**
						 * Whose session this cast is (B2, 2026-10-03) — the key
						 * the speaker's example dialogue is picked by, so the
						 * pick holds for the whole session instead of being
						 * re-drawn from each run's seed (`build-template-context`).
						 */
						sessionId
					}
				}

				case "session_state": {
					/**
					 * The session's resolved stats and states.
					 *
					 * Through the read seam like every other Query, so a
					 * scoping refusal names the node that asked and a spec
					 * cannot reach another session's state by supplying an id.
					 * The resolution itself is `$lib/server/state` — imported
					 * here rather than in the binding, which is what keeps the
					 * binding module free of a database handle.
					 */
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined)
						return {
							world: {},
							cast: {},
							slots: [],
							version: 0
						}
					const { stateFor } = await import(
						"$lib/server/state/resolve"
					)
					return await stateFor(db, sessionId)
				}

				case "lorebook_state": {
					/**
					 * 🚧 A lorebook's durable stats — its world, cast members
					 * and places — with no session needed (2026-09-27). Scoped
					 * by `lorebookInScope`; an owner of another book is
					 * refused rather than read as empty.
					 */
					const { lorebookId, reading } = await lorebookInScope(db, node, scope, q)
					if (lorebookId === null) return null
					const { lorebookStateFor, lorebookLinks, normalizeOwner, LorebookOwnerRefusal } =
						await import("$lib/server/state/lorebookState")
					// The book's owners as this reading sees them (finding #41).
					const links = await lorebookLinks(db, lorebookId, reading)
					const owner = q.owner == null ? undefined : normalizeOwner(q.owner, links)
					if (owner === null)
						throw new HostScopeError(
							`${node.key} (${node.definitionId}): the owner filter names nobody — use "world", { kind: "cast_member", id } or { kind: "location", id }.`
						)
					try {
						return await lorebookStateFor(
							db,
							{
								lorebookId,
								reading,
								owner,
								slotIds: Array.isArray(q.slotIds) ? q.slotIds : undefined
							},
							{ links }
						)
					} catch (e) {
						if (e instanceof LorebookOwnerRefusal)
							throw new HostScopeError(`${node.key} (${node.definitionId}): ${e.message}`)
						throw e
					}
				}

				case "stat_trail": {
					/**
					 * 🚧 One stat's values over time for one owner
					 * (2026-09-27): the scope session's message-anchored rows,
					 * the book's timeline across sessions, or both.
					 */
					const { lorebookId, sessionId, reading } = await lorebookInScope(db, node, scope, q)
					if (lorebookId === null) return null
					const { statTrailFor } = await import("$lib/server/state/statTrail")
					const { lorebookLinks, normalizeOwner, LorebookOwnerRefusal } = await import(
						"$lib/server/state/lorebookState"
					)
					const links = await lorebookLinks(db, lorebookId, reading)
					const owner = normalizeOwner(q.owner ?? "world", links)
					if (owner === null)
						throw new HostScopeError(
							`${node.key} (${node.definitionId}): the owner names nobody — use "world", { kind: "cast_member", id } or { kind: "location", id }.`
						)
					// A session reading a book that is not its own has no
					// messages in that book to read.
					const [own] =
						sessionId !== undefined
							? await db
									.select({ lorebookId: schema.sessions.lorebookId })
									.from(schema.sessions)
									.where(eq(schema.sessions.id, sessionId))
									.limit(1)
							: []
					try {
						return await statTrailFor(db, {
							lorebookId,
							sessionId: own?.lorebookId === lorebookId ? sessionId : undefined,
							reading,
							owner,
							slotId: typeof q.slotId === "string" ? q.slotId : "",
							mode: q.mode,
							last: typeof q.last === "number" ? q.last : undefined,
							sinceMessageId:
								typeof q.sinceMessageId === "number" ? q.sinceMessageId : undefined,
							sinceDate:
								q.sinceDate && typeof q.sinceDate.year === "number" ? q.sinceDate : undefined
						})
					} catch (e) {
						if (e instanceof LorebookOwnerRefusal)
							throw new HostScopeError(`${node.key} (${node.definitionId}): ${e.message}`)
						throw e
					}
				}

				case "graph_scenes": {
					// Scenes with their messages, in order. The graph builder
					// walks them one at a time and each step reads the same
					// list, which is why this is one read rather than one per
					// step — five identical queries would be five chances for
					// them to disagree about what "this session" contains.
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return []
					return await db
						.select()
						.from(schema.scenes)
						.where(eq(schema.scenes.sessionId, sessionId))
						.orderBy(asc(schema.scenes.id))
				}

				case "graph_context": {
					/**
					 * The speaker's relationship summary, as structure.
					 *
					 * Returns what `buildGraphContextData` assembles rather
					 * than the rows behind it, deliberately: a second
					 * derivation here would be two readings of one graph that
					 * agree until somebody edits one — the failure the whole
					 * parity effort exists to prevent.
					 *
					 * It returns the *object* and not the finished string. The
					 * rendering belongs to the variable layout, and a value
					 * that arrives pre-stringified is one no layout can change.
					 *
					 * Null whenever the session has no lorebook, or the speaker
					 * has no bound node, or there are no relationships. That is
					 * the common case on an install that never opened the
					 * graph, and it is not an error.
					 */
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return null

					const [session] = await db
						.select({ lorebookId: schema.sessions.lorebookId })
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					if (!session?.lorebookId) return null

					const { buildGraphContextData } = await import(
						"$lib/server/utils/graphContextFormatter"
					)
					return (
						(await buildGraphContextData({
							sessionId,
							lorebookId: session.lorebookId,
							speakerCharacterId: q.currentCharacterId ?? null,
							speakerPersonaId: null,
							// The host's own connection, not the module-scope
							// one — see the note on the parameter.
							db
						})) ?? null
					)
				}

				case "graph_relationships": {
					/**
					 * The same graph, one row per tie, ranked elsewhere.
					 *
					 * ⚠ **One traversal, two projections**, which is the same
					 * rule the case above states: a second walk written for
					 * `core:query/relationship-search@1` would be two readings
					 * of one graph that agree until somebody edits one. `buildGraphRelationshipRows` and
					 * `buildGraphContextData` are two projections of
					 * `collectGraphLayers`, so the visibility rules, the alias
					 * suppression and the participant scope cannot diverge
					 * between what the prompt renders and what the budget
					 * ranks.
					 *
					 * `null` on the same three conditions — no session, no
					 * lorebook, no bound speaker node — and an empty array when
					 * the graph is simply empty. The query reads the difference:
					 * one is "there is no graph here", the other is "there is,
					 * and it has nothing to say about this speaker".
					 */
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return null

					const [session] = await db
						.select({ lorebookId: schema.sessions.lorebookId })
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					if (!session?.lorebookId) return null

					const { buildGraphRelationshipRows, buildCastRelationshipRows } =
						await import("$lib/server/utils/graphContextFormatter")
					/**
					 * ⚠ **Nobody speaking takes the cast-wide read** (genre
					 * plan F6(a)). A null `currentCharacterId` is nobody's
					 * voice — an Adventure turn's planner and narrator — and
					 * the speaker's walk has nowhere to start from, so it
					 * answers every tie a cast member holds that is not their
					 * secret, in their own lane, which the speaker's two
					 * sections never render. Same line, and layer 2's
					 * visibility rule (`CAST_WIDE_VISIBILITY`).
					 *
					 * ⚠ Keyed on the missing speaker, not on a request, so
					 * every null-speaker read gets it — Chat's envoy turns
					 * included, where nothing renders the lane. Withholding
					 * secrets is what makes that safe; at a non-zero share
					 * there it still spends band room on ties no section
					 * shows. An explicit param on `relationship-search@1` would
					 * close it, at a contract move (review 2026-09-29).
					 */
					if (q.currentCharacterId == null)
						return (
							(await buildCastRelationshipRows({
								sessionId,
								lorebookId: session.lorebookId,
								db
							})) ?? null
						)
					return (
						(await buildGraphRelationshipRows({
							sessionId,
							lorebookId: session.lorebookId,
							speakerCharacterId: q.currentCharacterId ?? null,
							speakerPersonaId: null,
							db
						})) ?? null
					)
				}

				case "cast_presences": {
					/**
					 * Who is in the world, and when (plan E-2, R4): the
					 * presences on the session's line and the moment it reads
					 * at. The line is resolved HERE, so no node ever sees
					 * another line's spans (`presencesOnReading`). No session,
					 * or no book: nothing, at the head.
					 */
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return { rows: [], at: null }
					const { presencesOnReading } = await import(
						"$lib/server/state/presencesOnReading"
					)
					return await presencesOnReading(db, sessionId)
				}

				case "graph_entry_links": {
					/**
					 * The edges the cast traversal cannot see.
					 *
					 * A separate read rather than more rows on
					 * `graph_relationships`, and the reason is the one stated
					 * on that case: it is a projection of `collectGraphLayers`,
					 * which walks outward from the speaker's node. An edge
					 * between two places has no speaker to walk from, so it is
					 * not a row that traversal left out — it is a different
					 * question, asked once, by the link hop alone.
					 *
					 * `null` on no session and no lorebook, `[]` on a lorebook
					 * whose entries are not linked to anything — which is every
					 * book until somebody draws a road.
					 */
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return null

					const { readGraphEntryLinks } = await import(
						"$lib/server/utils/graphEntryLinks"
					)
					return await readGraphEntryLinks(db, sessionId)
				}

				case "available_tools": {
					/**
					 * What tools this session can call, right now.
					 *
					 * Instance state like `embedding_status` next door, and for
					 * the same reason it is a read rather than config: which
					 * extensions are installed and enabled is a fact about this
					 * moment, and a spec resolved before an admin enabled one
					 * would advertise a list that is already wrong.
					 *
					 * Declarations only — a name, a sentence and a JSON Schema.
					 * Nothing here can run anything; `core:oracle/run-tool@1`
					 * does that, and resolves the same list again through the
					 * same module so the advertisement and the dispatch cannot
					 * disagree.
					 */
					const { toolProviders } = await import(
						"$lib/server/pipelines/runtime/tools/resolve"
					)
					const providers = await toolProviders(db, {
						plugins: q.plugins !== false
					})
					const include: string[] = Array.isArray(q.include)
						? q.include.filter(
								(n: unknown) => typeof n === "string"
							)
						: []
					const declared = providers.map((t) => t.declaration)
					// The author's order, not the registry's: `include` is a
					// list a spec wrote, and the order tools are advertised in
					// is one of the few things an author can use to steer which
					// one a model reaches for first.
					return include.length
						? include
								.map((n) => declared.find((d) => d.name === n))
								.filter((d): d is NonNullable<typeof d> => !!d)
						: declared
				}

				case "embedding_status": {
					/**
					 * Whether vector search is usable on this instance, right now.
					 *
					 * Instance state, not data — which is why it arrives through a
					 * read rather than along an edge, and not as config either:
					 * config resolves before the run, and "is the embedding model
					 * loaded" is a fact about this moment.
					 *
					 * Delegates to `isModelReady()`, which is what the existing RAG
					 * gate in promptBuilder already uses. Intentionally not a second
					 * rule: it distinguishes *enabled* from *loaded and validated*,
					 * and re-deriving that here would eventually disagree with the
					 * legacy path about whether RAG is on — which is exactly the
					 * kind of divergence the parity corpus cannot see, because both
					 * paths would be internally consistent and different.
					 */
					const { isModelReady, getLoadedModelId } =
						await embeddingApi()
					const available = isModelReady()
					return {
						available,
						model: getLoadedModelId(),
						reason: available
							? undefined
							: "no embedding model is loaded and validated"
					}
				}

				case "vector_search": {
					/**
					 * Semantic retrieval, scored here rather than downstream.
					 *
					 * The cosine pass stays in the host for the same reason lore
					 * rows arrive without their `embedding` column: a vector is a
					 * few hundred floats, and moving candidate vectors along a data
					 * edge would put them in the run's values, its receipt and
					 * every downstream node's input. Ranking *policy* — MMR, per
					 * source caps, thresholds — is a Task and stays swappable; this
					 * is the retrieval itself.
					 *
					 * **Several query vectors, several ranked lists.** The legacy
					 * engine embeds the current window and the recent window
					 * separately and fuses their ranks, because "what is being said
					 * now" and "what was being said just before" are different
					 * questions and one blended embedding answers neither. The
					 * candidate pool is fetched once and scored against each.
					 */
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)

					const vectors: number[][] = Array.isArray(q.vectors)
						? q.vectors.filter(Array.isArray)
						: Array.isArray(q.vector)
							? [q.vector]
							: []
					if (sessionId === undefined || vectors.length === 0)
						return {
							lists: [],
							similarity: [],
							candidates: [],
							truncated: []
						}

					const {
						getSessionRagContext,
						fetchScopedCandidates,
						rankScopedCandidates
					} = await import("$lib/server/embedding/ragContext")
					const { getLoadedModelId } = await embeddingApi()

					const modelId = getLoadedModelId()
					if (!modelId)
						return {
							lists: [],
							similarity: [],
							candidates: [],
							truncated: []
						}

					const context = await getSessionRagContext(sessionId)

					/**
					 * **Index what this search is about to look at and cannot
					 * see, before it looks.**
					 *
					 * A row in scope with no current vector is invisible to the
					 * fetch below — it is not ranked low, it is not there — so a
					 * lorebook saved a moment ago contributes nothing at all
					 * until the background pass reaches it. The fix is not a
					 * second synchronous embed path beside the queue: these rows
					 * are **promoted to the front of the existing queue**, and
					 * the node resumes once its scope is covered. Fairness,
					 * failure backoff and model handling stay in one place.
					 *
					 * Bounded twice — the scan caps how many rows may be named,
					 * the lane caps how many are indexed and for how long —
					 * because this is synchronous work inside a turn.
					 *
					 * ⚠ Never throws into the turn. A promotion that cannot
					 * complete degrades to a report, which is the governing
					 * rule's "subtracts a signal, never halts": the search runs
					 * over whatever is indexed and the receipt says what was
					 * missing.
					 */
					const { promoteScopedVectors } = await import(
						"$lib/server/embedding/vectorizationQueue"
					)
					const promotion = await promoteScopedVectors(
						context,
						modelId,
						{
							// Only what the fetch below will look at: a row
							// embedded for a source it never searches is an
							// embed call inside the turn bought for nothing.
							sources: q.sources,
							excludeRecentMessages: q.excludeRecentMessages,
							channel: resolveChannel(q.channel)
						}
					)
					/**
					 * `truncated` rides back out untouched.
					 *
					 * The fetch is capped per source and scores nothing, so a
					 * capped source hands back its newest rows rather than its
					 * closest ones. Dropping that here would leave the mechanism
					 * reporting a `considered` count for a pool it silently
					 * never saw the whole of.
					 */
					const { candidates, truncated } =
						await fetchScopedCandidates(context, {
							modelId,
							sources: q.sources,
							excludeRecentMessages: q.excludeRecentMessages,
							// The semantic mechanism reaches the prompt, so it is
							// scoped exactly like the history read (20 §7): an
							// omitted channel is `main`, never every lane at
							// once. Lore is not lane-scoped — an entry belongs
							// to the world, not to a conversation.
							channel: resolveChannel(q.channel)
						})

					const topK = q.topK ?? 40
					const lists = vectors.map((vector) =>
						rankScopedCandidates(candidates, vector, topK).map(
							toCandidate
						)
					)

					/**
					 * `cos(i, j)` over the union of what came back.
					 *
					 * Derived, bounded and one-way: MMR needs to know which
					 * candidates resemble each other, and this answers that
					 * without any embedding leaving the host. N² is real — a topK
					 * in the thousands would want a different shape — but at the
					 * tens this mechanism works in it is smaller than two raw vectors.
					 */
					const union = new Map<string, any>()
					for (const list of lists)
						for (const hit of list)
							if (!union.has(`${hit.source}:${hit.id}`))
								union.set(`${hit.source}:${hit.id}`, hit)

					const byKey = new Map(
						candidates.map((c: any) => [`${c.source}:${c.id}`, c])
					)
					const order = [...union.keys()]
					const similarity = order.map((a) =>
						order.map((b) =>
							a === b
								? 1
								: cosine(
										byKey.get(a)?.embedding,
										byKey.get(b)?.embedding
									)
						)
					)

					return {
						lists,
						similarity,
						// The fused-set order the matrix is indexed against, so a
						// Task can line the two up without guessing.
						candidates: order.map((k) => union.get(k)),
						truncated,
						/**
						 * What the eager pass did, for the receipt. A turn that
						 * took a second longer because it embedded twelve
						 * entries first has to be able to say so.
						 */
						indexing: describePromotion("vectors", promotion)
					}
				}

				case "entity_annotations": {
					/**
					 * The entity mechanism's index — design §13.5, and the IO half of
					 * it. Scoring is `ranking/entitySearch.ts`; the two are
					 * split for the reason the cosine pass is not: this one
					 * reads rows and returns keys, which is a small answer, and
					 * keeping the arithmetic pure is what makes it testable
					 * without a database.
					 *
					 * **One vocabulary for both sides.** The window's entities
					 * and the corpus's annotations are keys out of the same
					 * gazetteer, or they are two alphabets that never meet — a
					 * window resolving "Alice" to `character:5` would not find
					 * an entry annotated `open:alice`. It is built from the
					 * session's **lorebook**, so every session over one book
					 * agrees and the identity of that vocabulary rides on every
					 * stored row.
					 *
					 * **Which entries.** The caller passes the ids, and that is
					 * the privacy gate rather than a second one: `entryIds`
					 * comes from this host's own `lorebook_entries` read, which
					 * has already withheld character lore that is not the
					 * speaker's own. Re-deriving visibility here would be a
					 * second implementation of the rule bug 2 was about, free
					 * to disagree with the first.
					 */
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)

					const {
						loadVocabulary,
						readEntryAnnotations,
						residentModelSpans,
						searchMessageAnnotations
					} = await import("$lib/server/annotations")
					const {
						promoteEntryAnnotations,
						enqueueSessionAnnotation
					} = await import("$lib/server/annotations/queue")
					const { extractEntities } = await import(
						"$lib/server/pipelines/ranking/entities"
					)

					const empty = {
						entities: [],
						entries: [],
						messages: [],
						diagnostics: {
							annotatedEntries: 0,
							rewroteEntries: 0,
							deferredEntries: 0,
							messagesFound: 0
						}
					}
					if (sessionId === undefined) return empty

					const [session] = await db
						.select()
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					if (!session) return empty

					const vocabulary = await loadVocabulary(
						db,
						session.lorebookId ?? null
					)

					const entryIds: number[] = Array.isArray(q.entryIds)
						? q.entryIds.map(Number).filter(Number.isFinite)
						: []

					/**
					 * Entries are repaired before they are read — §13.4's
					 * small-N regime — but **through the annotation lane's
					 * queue, not beside it**. The ids this query scoped are
					 * promoted to the front of that queue, indexed, and the node
					 * resumes when its scope is covered.
					 *
					 * Bounded twice, because this is synchronous work inside a
					 * turn: the lane caps how many items one promotion may
					 * process and how long it may take, so a book with two
					 * hundred un-annotated entries cannot silently stall a first
					 * message. Whatever the bound left is still queued and the
					 * background pass finishes it, which is why a partial
					 * promotion costs a smaller search rather than a wrong one.
					 *
					 * ⚠ Never throws and never blocks indefinitely: a promotion
					 * that cannot complete comes back as a report, and its
					 * `reason` goes on the receipt below.
					 */
					const pass = await promoteEntryAnnotations(
						entryIds,
						vocabulary,
						session.lorebookId ?? null
					)
					const index = await readEntryAnnotations(
						db,
						entryIds,
						vocabulary
					)

					const window: string =
						typeof q.window === "string" ? q.window : ""
					/**
					 * Tier zero over the window as well, when — and only when —
					 * the entity model is resident. The stored rows were read
					 * by it, so a window read the same way names what they
					 * name, lower-case and unfamiliar names included.
					 *
					 * ⚠ Never a load and never a wait: `residentModelSpans`
					 * asks the lease and nothing else, so a model that is not
					 * up answers no spans and the window is extracted
					 * lexically, exactly as before — an unavailable mechanism
					 * subtracts a signal.
					 */
					const windowPass = await residentModelSpans(window)
					const { entities, extractorVersion } = extractEntities(
						window,
						vocabulary.gazetteer,
						windowPass.spans
					)

					const maxMessages = Math.max(0, Number(q.maxMessages) || 0)
					/**
					 * Fetched far wider than it is returned, and deliberately.
					 *
					 * The rows come back newest-first, so fetching exactly
					 * `maxMessages` would take the most *recent* matches and
					 * then rank them — truncating before scoring, which is bug
					 * 3's shape in a new place. Widened to the annotation
					 * batch's ceiling so the ranking has a pool, and capped
					 * rather than unbounded because a session's whole history
					 * can match on one common name.
					 */
					const found =
						maxMessages > 0
							? await searchMessageAnnotations(
									db,
									sessionId,
									entities.map((e) => e.key),
									vocabulary,
									{ beforeId: q.beforeId }
								)
							: { hits: [], truncated: false }
					const messages = found.hits

					/**
					 * The transcript's own annotations, **queued** and not
					 * waited for — the one hard rule §13.4 states for this side,
					 * now expressed as a group on the annotation lane instead of
					 * a detached promise. Same "never blocks a turn" guarantee,
					 * with the work visible, bounded and interleaved with
					 * everything else that lane owes.
					 *
					 * Only when the message half is switched on: an install that
					 * has not asked for retrieval over its transcript should not
					 * be writing an index for it. That first write is also what
					 * opts the session into the lane's background sweep.
					 */
					if (maxMessages > 0)
						enqueueSessionAnnotation(
							sessionId,
							session.lorebookId ?? null,
							session.name ?? `Session #${sessionId}`
						)

					return {
						extractorVersion,
						gazetteerHash: vocabulary.hash,
						entities,
						entries: [...index].map(([id, keys]) => ({
							id,
							keys,
							entityLabels: index.entityLabels.get(id) ?? {}
						})),
						messages,
						diagnostics: {
							annotatedEntries: index.size,
							rewroteEntries: pass.processed,
							deferredEntries: pass.remaining,
							/**
							 * What the eager pass did, in words, for the
							 * receipt. A slow turn has to be explicable and so
							 * does a partial one — *"indexed 25 of 60 entries
							 * before searching (bounded)"* is the difference
							 * between a mechanism degrading and a mechanism
							 * disappearing.
							 */
							entityIndexing: describePromotion(
								"entry names",
								pass
							),
							messagesFound: messages.length,
							/**
							 * The message search hit its ceiling, so what it
							 * ranked is not the whole matching corpus.
							 * Reported for `vector-search`'s reason: a
							 * truncated retrieval and a complete one produce
							 * results that look exactly alike.
							 */
							messagesTruncated: found.truncated
						}
					}
				}

				case "recalled_lines": {
					/**
					 * The rows behind entity-search's recalled lines
					 * (2026-09-27), in reading order, each with its **turn**:
					 * its 1-based position among its channel's visible
					 * messages — what a reader of that channel would count to
					 * reach it. Hidden and still-generating rows are excluded
					 * from the read and from the count, the rule
					 * `session_messages` states for every prompt-facing read.
					 *
					 * Rows only, for naming by the transcript's own chain
					 * (`processMessages`); no channel shaping, because a
					 * recalled line is one line, never a folio.
					 */
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					const ids: number[] = Array.isArray(q.ids)
						? q.ids
								.map(Number)
								.filter((id: number) => Number.isInteger(id) && id > 0)
						: []
					if (sessionId === undefined || !ids.length) return []
					const sm = schema.sessionMessages
					const rows = await db
						.select({
							row: sm,
							// Qualified by hand: inside the subquery an
							// unqualified column is the inner row's own.
							turn: sql<number>`(select count(*)::int from session_messages earlier
								where earlier.session_id = session_messages.session_id
								and earlier.channel = session_messages.channel
								and earlier.is_hidden = false
								and earlier.is_generating = false
								and earlier.id <= session_messages.id)`
						})
						.from(sm)
						.where(
							and(
								eq(sm.sessionId, sessionId),
								inArray(sm.id, ids),
								eq(sm.isHidden, false),
								eq(sm.isGenerating, false)
							)
						)
						.orderBy(asc(sm.id))
					// The row exactly as the transcript read carries it, so the
					// one naming chain names it the same way.
					return rows.map((r: { row: any; turn: number }) => ({
						...toMessage(r.row),
						turn: Number(r.turn)
					}))
				}

				case "mention_spans": {
					/**
					 * What the scene refers to by **describing** it — the query
					 * half of the entity-vector space (retrieval plan phase 4).
					 *
					 * A host read rather than a pure Task, and the vocabulary is
					 * why: a definite description that turns out to be an
					 * authored lower-case name — *"the ashguard"* — must be
					 * dropped here, because the exact matcher owns it. A Task
					 * cannot know that, and a linker that received it would be
					 * offering a vector opinion about something already matched
					 * exactly.
					 *
					 * The same `loadVocabulary` the entity mechanism uses, so the two
					 * mechanisms cannot disagree about what counts as a name.
					 */
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)

					const empty = {
						extractorVersion: MENTION_EXTRACTOR_VERSION,
						gazetteerHash: undefined as string | undefined,
						mentions: [] as any[],
						diagnostics: { claimed: 0 }
					}
					if (sessionId === undefined) return empty

					const [session] = await db
						.select()
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					if (!session) return empty
					// No book, nothing a description could be linked to: the
					// mechanism is unavailable, so it is skipped (R5) — and the
					// embed of its texts is never bought (lorebooks A23(b)).
					if (session.lorebookId == null) return empty

					const { loadVocabulary } = await import(
						"$lib/server/annotations"
					)
					const vocabulary = await loadVocabulary(
						db,
						session.lorebookId ?? null
					)

					const scanDepth = Math.max(1, Number(q.scanDepth) || 10)
					/**
					 * The guaranteed window, read the same way `keywordQuery`
					 * and the entity mechanism read it — newest `scanDepth` messages,
					 * in reading order. Not the whole history: a description is
					 * a reference to what is *being* discussed, and *"the
					 * captain"* from forty turns ago is a different captain.
					 */
					const rows = await db
						.select({ content: schema.sessionMessages.content })
						.from(schema.sessionMessages)
						.where(
							and(
								eq(schema.sessionMessages.sessionId, sessionId),
								eq(schema.sessionMessages.isHidden, false),
								channelWhere(
									schema.sessionMessages.channel,
									resolveChannel(q.channel)
								)
							)
						)
						.orderBy(desc(schema.sessionMessages.id))
						.limit(scanDepth)
					const window = buildScanWindow(
						rows.reverse(),
						scanDepth
					).raw

					const all = extractMentions(window, vocabulary.gazetteer)
					const limit = Math.max(0, Number(q.limit) || 0)
					return {
						extractorVersion: all.extractorVersion,
						gazetteerHash: vocabulary.hash,
						mentions: limit
							? all.mentions.slice(0, limit)
							: all.mentions,
						diagnostics: {
							/**
							 * Descriptions an authored name was already sitting
							 * on — the exact matcher's, and correctly not this
							 * mechanism's. Counted by the detector rather than by
							 * scanning twice.
							 */
							claimed: all.claimed,
							windowChars: window.length
						}
					}
				}

				case "entity_link": {
					/**
					 * Mention → name, measured — the retrieval half of the
					 * entity-vector mechanism.
					 *
					 * The cosine pass runs here for `vector_search`'s reason and
					 * not a new one: a vector is a few hundred floats, and
					 * moving candidate vectors along a data edge would put them
					 * in the run's values, in its receipt and in every
					 * downstream node's input. What crosses the edge is a name,
					 * a mention and a number.
					 *
					 * ## The index is repaired before it is read
					 *
					 * §13.4's small-N regime: entries are few and change rarely,
					 * so a bounded pass brings the name vectors up to date in
					 * place rather than hoping a background job got there first.
					 * The pass is capped, so a book nobody has indexed converges
					 * over a turn or two instead of one reply paying for all of
					 * it — and `readEntityVectors` re-checks every identity
					 * afterwards, because "the repair ran" is an assumption and
					 * this is the reader.
					 */
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)

					const empty = {
						hits: [] as any[],
						diagnostics: {
							names: 0,
							indexed: 0,
							reindexed: 0,
							deferredEntries: 0
						}
					}
					if (sessionId === undefined) return empty

					const entryIds: number[] = Array.isArray(q.entryIds)
						? q.entryIds.map(Number).filter(Number.isFinite)
						: []
					const mentions: Array<{ text: string; position: number }> =
						Array.isArray(q.mentions) ? q.mentions : []
					const vectors: number[][] = Array.isArray(q.vectors)
						? q.vectors.filter(Array.isArray)
						: []
					if (
						!entryIds.length ||
						!mentions.length ||
						vectors.length !== mentions.length
					)
						return empty

					const [session] = await db
						.select()
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					if (!session) return empty

					const { getLoadedModelId, batchEmbed } =
						await embeddingApi()
					const modelId = getLoadedModelId()
					if (!modelId) return empty

					const { loadVocabulary } = await import(
						"$lib/server/annotations"
					)
					const { ensureEntityVectors, readEntityVectors } =
						await import("$lib/server/embedding/entityVectors")
					const vocabulary = await loadVocabulary(
						db,
						session.lorebookId ?? null
					)

					const pass = await ensureEntityVectors(db, {
						lorebookId: session.lorebookId ?? null,
						entryIds,
						gazetteerHash: vocabulary.hash,
						modelId,
						batchEmbed
					})
					const names = await readEntityVectors(
						db,
						entryIds,
						vocabulary.hash,
						modelId
					)

					/**
					 * Every mention against every name, and the honest bound on
					 * that is the two caps above it: `MAX_MENTIONS` on one side
					 * and `MAX_NAMES_PER_ENTRY` per entry on the other, over a
					 * pool that is already the ranker's candidate list. No
					 * threshold is applied — ruling R4 — so what comes back is
					 * every positive comparison and the ranking is the mechanism's.
					 */
					const hits: any[] = []
					for (const name of names)
						for (let i = 0; i < mentions.length; i++) {
							const mention = mentions[i]!
							const score = cosine(vectors[i], name.vector)
							if (!(score > 0)) continue
							hits.push({
								entryId: name.entryId,
								mention: mention.text,
								name: name.name,
								nameKind: name.kind,
								// Clamped, not rescaled: a similarity above 1 is
								// floating-point noise and one below 0 is "less
								// alike than unrelated", which is not evidence
								// and must never subtract from a score.
								score: Math.min(1, score),
								position: Number(mention.position) || 0
							})
						}

					return {
						hits,
						diagnostics: {
							/** Name vectors this turn could actually compare. */
							names: names.length,
							indexed: new Set(names.map((n) => n.entryId)).size,
							reindexed: pass.written,
							/**
							 * Entries the batch cap left for the next pass. Not
							 * an error — the mechanism links fewer entries this turn
							 * and the same number more next turn, which is
							 * staleness degrading to correct-and-verbose rather
							 * than to silently-wrong.
							 */
							deferredEntries: pass.deferred
						}
					}
				}

				default:
					throw new HostScopeError(
						`${node.key} (${node.definitionId}) tried to read '${table}', which no Query type is ` +
							`bound to. Reads are enumerated here on purpose — a table nobody listed is a ` +
							`table nobody reviewed for scope.`
					)
			}
		},

		async call(payload, node, run, handles) {
			const p = (payload ?? {}) as Record<string, any>
			/**
			 * The node's clock, tied to the request below (`callTether`): the
			 * dispatch aborts on the run's cancel or the node's own timeout,
			 * and the request's signs of life keep an idle node's window open.
			 */
			const line = tether(handles, scope.signal)

			switch (node.definitionId) {
				case "core:oracle/embed-text": {
					// The embedding call is a Provider because it reaches a model
					// (16 §1) — a Query may not. Splitting it out also means the
					// run's budget and receipt see the embedding call, which they
					// would not if retrieval quietly made it.
					const { embed, batchEmbed, isModelReady } =
						await embeddingApi()
					if (!isModelReady())
						throw new Error(
							"no embedding model is loaded and validated, so text cannot be embedded"
						)

					const texts: string[] = Array.isArray(p.texts)
						? p.texts.filter((t: unknown) => typeof t === "string")
						: p.text !== undefined && p.text !== null
							? [String(p.text)]
							: []

					// **No texts means no vectors**, not one vector of an empty
					// string. A session on its first turn has no "recent" window,
					// so this is a normal state rather than an edge case — and
					// the previous shape embedded `undefined`, which crashed
					// inside the model wrapper and surfaced as a provider error
					// on a perfectly healthy session.
					if (texts.length === 0) return { vectors: [], vector: null }

					const vectors =
						texts.length > 1
							? await batchEmbed(texts)
							: [await embed(texts[0]!)]
					return { vectors, vector: vectors[0] }
				}

				case "core:oracle/pick-sprite": {
					/**
					 * The sprite picker's two effects (DESIGN-sprites §5.2):
					 * what the speaker can show, and the vectors to choose
					 * with. The binding decides who is speaking and does the
					 * arithmetic; this reads and embeds, and nothing else.
					 *
					 * ⚠ The line's text arrives on the payload, wired from the
					 * step that wrote it — never re-read from the row (owner,
					 * 2026-10-05). The run's own row is named only to leave it
					 * out of the speaker's recent faces.
					 *
					 * The set is decided in `spriteChoicesFor` — the spec's
					 * `set`, then the override, the amendment, the card's
					 * default — and `decidedBy` rides out on the receipt.
					 */
					const sessionId = p.sessionId ?? scope.sessionId
					assertScoped(node, p.sessionId, scope.sessionId)
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to choose a sprite in — wire 'scope' from the inlet.`
						)
					const characterId = Number(p.characterId)
					const { spriteChoicesFor } = await import(
						"$lib/server/sprites/choices"
					)
					const choices = await spriteChoicesFor(db, {
						sessionId,
						characterId,
						set: p.set,
						excludeMessageId:
							typeof run.liveRow === "number" ? run.liveRow : undefined
					})
					if (choices.labels.length === 0)
						return { choices, lineVector: null, labelVectors: null }
					// Through the install's active embedding connection — the
					// star, by policy: the picker has no connection slot, as
					// `embed-text` has none. ⚠ With an embedding service that
					// is a provider call, one per reply whose speaker has
					// sprites; a speaker without sprites never reaches here.
					// Label vectors are cached per model (`sprites/vectors.ts`).
					const { spriteVectors } = await import(
						"$lib/server/sprites/vectors"
					)
					const { getLoadedModelId, batchEmbed } = await embeddingApi()
					const text = typeof p.text === "string" ? p.text : ""
					const vectors = await spriteVectors(text, choices.labels, {
						modelId: getLoadedModelId(),
						batchEmbed
					})
					return { choices, ...vectors }
				}

				/**
				 * All three generate nodes, through one dispatcher (20 §9).
				 *
				 * `generate-with-tools` is `generate-text` with a `tools`
				 * in-port and a `toolCall` out-port; `generate-json` is the same
				 * request asking for a shape instead of a turn. Both are
				 * separate pins only because the first is published and frozen.
				 * Three cases would be three copies of a fifty-line forward,
				 * which is how they would come to differ about a stop sequence.
				 */
				case "core:oracle/generate-json":
				case "core:oracle/generate-with-tools":
				case "core:oracle/generate-text": {
					/**
					 * The generation itself, through the existing adapters.
					 *
					 * This is the point of the whole split: the prompt was built by
					 * Tasks that anyone can inspect, and this sends it. Note what
					 * the binding does *not* get back — no connection, no URL, no
					 * key, no headers. See `dispatch.ts` for why that line is not
					 * negotiable rather than merely tidy.
					 */
					const { dispatchGeneration } = await import(
						"$lib/server/pipelines/runtime/dispatch"
					)
					if (scope.sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to generate in — the run was started without a session scope`
						)

					/**
					 * Streaming is run-level (R-21 (2)). The executor says
					 * which row this run is filling; core decides whether THIS
					 * oracle's stream is the reply's prose (declared — `streamingSteps`)
					 * and routes it there. The binding asked for text and gets
					 * text — it never learns there was a row.
					 *
					 * The live row is also what the queue's stage lands on and
					 * what the client's Stop cancels by, so the queue item is
					 * put on it before the call is enqueued — a very fast Stop
					 * must never find a generating row with nothing to cancel.
					 */
					const liveRow =
						typeof run.liveRow === "number"
							? run.liveRow
							: undefined
					// The reply's phase, off the same split as its text: the
					// status reads *{speaker} is reasoning* while the trace
					// streams and goes back to the node's own (*is typing*) at
					// the first body token (`StatusRelay.reasoning`).
					const stream = scope.live?.attach(run.liveRow, node.key, {
						onPhase: (phase) =>
							scope.status?.reasoning(phase === "reasoning")
					})
					const queueItemId =
						liveRow !== undefined && scope.live
							? await scope.live.claim(liveRow)
							: undefined

					let result: Awaited<ReturnType<typeof dispatchGeneration>>
					try {
						const sessionId = scope.sessionId
						result = await line.hold(() => dispatchGeneration({
							compiledPrompt: p.compiledPrompt,
							db,
							sessionId,
							userId: scope.userId,
							// The payload's value when a caller supplied one,
							// otherwise the run's. Neither is authoritative alone:
							// a dispatch-only caller knows the speaker, and a spec
							// has no port to put it on.
							currentCharacterId:
								p.currentCharacterId ??
								scope.currentCharacterId ??
								null,
							generatingMessageMetadata:
								p.generatingMessageMetadata ?? {},
							// The `attachments` in-port: media REFERENCES, in the
							// order they are to be sent. `dispatch` turns them into
							// bytes — checking each one against this run's session
							// and user on the way, the same rule `mediaParts` above
							// applies to media posted into a message.
							attachments: Array.isArray(p.attachments)
								? (p.attachments as unknown[] as MediaRef[])
								: undefined,
							// Tier 2 — this node's own slots, exactly as the
							// `generate-image` sibling below already forwards them.
							// Omitting them was why the panel's Connection and
							// Sampling pickers on the reply step did nothing.
							connectionId: refId(p.connection),
							// The MODEL half of the same slot (0114), off the
							// resolved descriptor. A slot authored before the split
							// names none, and that resolves as unconfigured through
							// the tiers below — so nothing stored needs migrating
							// and nothing already configured changes.
							connectionModelId: connectionDescriptorModelId(
								p.connection
							),
							samplingId: refId(p.sampling),
							// The author's own stop sequences, off the node's
							// `params` slot (ruling 2026-09-10). Forwarded, never
							// interpreted: the dispatch composes them together with
							// the connection's completion template and the scene's
							// speaker labels, and applies the wire rule once.
							stopSequences: Array.isArray(p.stopSequences)
								? (p.stopSequences as string[])
								: undefined,
							// The author's send shape, off the same `params` slot.
							// Forwarded, never interpreted: which wire `auto`
							// resolves to needs the connection, and the connection
							// is resolved one layer down.
							streaming: streamingModeFrom(p.streaming),
							// The `tools` in-port — `advertise-tools`' `native`
							// door, forwarded verbatim. Empty on `generate-text`,
							// which declares no such port, so that node's requests
							// are byte-identical to what they always were.
							tools: Array.isArray(p.tools)
								? (p.tools as ToolDeclaration[])
								: undefined,
							/**
							 * The structured-output ask — `generate-json`'s and
							 * nobody else's.
							 *
							 * Forwarded as a REQUEST, never as an answer: which
							 * door it actually goes out through needs the
							 * connection, and the connection is resolved one layer
							 * down. Absent on the other two pins, so their requests
							 * are byte-identical to what they always were.
							 */
							structured:
								node.definitionId === "core:oracle/generate-json"
									? { schema: p.schema ?? undefined }
									: undefined,
							// Every chunk, body or reasoning, is a sign of life
							// for the node's idle clock (`callTether`).
							onChunk: (chunk) => {
								line.pulse()
								stream?.onChunk(chunk)
								scope.sink?.onChunk?.(chunk)
							},
							onReasoning: (chunk) => {
								line.pulse()
								stream?.onReasoning(chunk)
								scope.sink?.onReasoning?.(chunk)
							},
							onReplyFacts: (facts) => stream?.onReplyFacts(facts),
							// The run's cancel OR the node's own timeout: a node
							// that timed out must not leave the request running.
							signal: line.signal,
							/**
							 * Through the LLM queue — one model call at a time
							 * across the application, the same lane every other
							 * generating step takes (`dispatchStep`,
							 * `runQueuedLLMCall`). The queue's status reaches
							 * the run's status relay (R-19), which says
							 * *waiting for the model* / *loading the model* on
							 * the live row while the call waits its turn or a
							 * managed backend loads, and restores the node's
							 * own status (*typing*) once it generates.
							 */
							queue: {
								// What the row this run fills IS — narration
								// or a character's turn — read off the live
								// row, which learned it from the placeholder's
								// commit. The payload's metadata is the
								// fallback for a dispatch-only caller with no
								// row: the narrate specs never set it, so
								// reading it first filed every narrator call
								// as `session`.
								taskType: (scope.live?.narration ??
								p.generatingMessageMetadata?.isNarratorResponse)
									? "narratorPrompt"
									: "session",
								sessionId: scope.sessionId,
								messageId: liveRow,
								userId: scope.userId,
								queueItemId,
								// Waiting its turn and a model loading are the
								// node's honest wait, not a stall: each change
								// pulses, and `hold` keeps beating between them.
								onStatusChange: (status) => {
									line.pulse()
									scope.status?.queue(status)
								}
							}
						}))
					} catch (err) {
						// The object, for the row's error write at the end of
						// the run — the executor keeps only the message, and
						// the redaction rule needs the class. See `LiveRow`.
						scope.live?.failedWith(err)
						throw err
					}
					// The stream has drained: whatever the throttle held back
					// lands now, before the port value moves on to the write.
					if (stream) await scope.live?.flush()
					return result
				}

				case "core:oracle/generate-image": {
					/**
					 * The render, through the image adapters.
					 *
					 * Same line as generate-text: the binding hands over the ids
					 * its slots resolved to and gets media REFERENCES back — never
					 * the connection, never its key, and never the bytes.
					 * `dispatchImage` explains why the bytes stop there.
					 */
					const { dispatchImage } = await import(
						"$lib/server/pipelines/runtime/dispatchImage"
					)
					// A render pulses like a reply: on every progress report
					// and on the in-flight beat (`callTether`).
					return await line.hold(() => dispatchImage(db, {
						prompt: String(p.prompt ?? ""),
						negative:
							p.negative === undefined || p.negative === null
								? undefined
								: String(p.negative),
						prompts: p.prompts ?? null,
						connectionId: refId(p.connection),
						connectionModelId: connectionDescriptorModelId(
							p.connection
						),
						samplingId: refId(p.sampling),
						sessionId: scope.sessionId ?? null,
						userId: scope.userId ?? null,
						// The run, for the prompts-slot render. Inert while that
						// slot renders in core's engine and load-bearing the
						// moment it names a plugin's — see `dispatchImage`'s
						// `render`.
						runId: scope.runId,
						// The run's artifact collector, handed down because the
						// `files` and `variants` ids only exist inside
						// `createMedia` — a Provider that writes rows publishes
						// media REFERENCES on its port, so there is nothing on
						// the receipt for the run to be reconstructed from.
						artifacts: scope.artifacts,
						nodeKey: node.key,
						signal: line.signal,
						// The author's send shape. On a render `off` is what
						// stops the progress poll and the previews, so it is
						// read where `onProgress` is decided rather than here.
						streaming: streamingModeFrom(p.streaming),
						// Forwarded only when somebody is listening AND the run
						// can be named. The first half is so an adapter that can
						// report progress does not pay to compute it for a run
						// nobody is watching (a background trigger, a test); the
						// second is because `runId` is what a client keys its
						// progress card on and what Cancel sends back, so an
						// event carrying one that identifies nothing opens a card
						// nobody can clear and nobody can stop. Never stamp `""`
						// here: the listening socket overwrites it with its own
						// id, which hides the hole.
						onProgress:
							scope.sink?.onProgress && scope.runId
								? (e) => {
										line.pulse()
										scope.sink!.onProgress!({
											runId: scope.runId!,
											nodeKey: node.key,
											...e
										})
									}
								: undefined
					}))
				}

				case "core:oracle/run-tool": {
					/**
					 * The one node that runs a tool (20 §9).
					 *
					 * Behind `call` rather than `read` because a tool is not a
					 * read: the canonical one is an extension's sandboxed hook,
					 * which may reach the network under its own grants, and the
					 * outward calls of a run all live behind this seam.
					 *
					 * ⚠ **A failing tool returns, it does not throw.** The model
					 * asked for something; "there is no such entry" is an answer
					 * it can act on, and a throw would end the turn at the one
					 * moment the agent could have recovered. Only an internal
					 * fault — a bug in this host — escapes, and `run-tool`'s
					 * binding turns even that into a result the loop can carry.
					 */
					const name = String(p.tool ?? "")
					const args =
						p.args &&
						typeof p.args === "object" &&
						!Array.isArray(p.args)
							? (p.args as Record<string, unknown>)
							: {}

					const { resolveTool } = await import(
						"$lib/server/pipelines/runtime/tools/resolve"
					)
					const provider = await resolveTool(db, name)
					if (!provider)
						return {
							tool: name,
							error: `there is no tool called '${name}'.`
						}

					try {
						if (provider.kind === "core") {
							const { ToolError } = await import(
								"$lib/server/pipelines/runtime/tools"
							)
							try {
								const result = await provider.tool.run(args, {
									// The host's own read, handed to the tool:
									// one enumerated seam, so a tool inherits
									// the hidden-message convention and the
									// character-lore privacy gate without
									// knowing they exist. `node` travels with
									// it so a scoping refusal names the node
									// that asked.
									// `read` is optional on `HostServices` —
									// a host may implement none, and a tool
									// asking one of those sees an empty
									// session rather than a crash. The same
									// shape the executor uses for the same
									// reason.
									read: async (
										table: any,
										query?: unknown
									) =>
										host.read
											? await host.read(
													table,
													query,
													node
												)
											: [],
									sessionId: scope.sessionId,
									currentCharacterId:
										scope.currentCharacterId ?? null,
									// The run's cancel or the node's timeout.
									signal: line.signal,
									// The state tools' one door. Granted only
									// where there is a session to propose
									// against; absent, they refuse by name.
									propose: scope.sessionId
										? async (change: unknown) => {
												const { proposeChange } =
													await import(
														"$lib/server/state/write"
													)
												return await proposeChange(
													db,
													{
														sessionId:
															scope.sessionId!,
														updatedBy: `run:${scope.runId ?? "unknown"}`
													},
													change as never
												)
											}
										: undefined
								})
								return { tool: name, result }
							} catch (e) {
								if (e instanceof ToolError)
									return { tool: name, error: e.message }
								throw e
							}
						}

						/**
						 * An extension's tool, through the hook dispatch that
						 * already exists — permissions, deadline, seeded RNG and
						 * the invocation log all apply because none of them is
						 * reimplemented here.
						 *
						 * The seed label carries the tool name and the run, so
						 * two calls to one tool in a single loop roll
						 * differently and a replay with the recorded seed rolls
						 * the same. Dark when the plugin subsystem is off, which
						 * is where `toolProviders` finds no enabled rows at all
						 * — so this branch is unreachable rather than guarded
						 * twice.
						 */
						const { pluginsEnabled } = await import(
							"$lib/server/plugins/flag"
						)
						const { getManager } = await import(
							"$lib/server/plugins"
						)
						if (!pluginsEnabled())
							return {
								tool: name,
								error: `'${name}' is provided by an extension, and extensions are switched off on this pub.`
							}
						const manager = getManager()
						const r = await manager.callHook(
							provider.binding.pluginId,
							provider.binding.hook,
							{ input: { tool: name, args } },
							{
								// A tool is the oracle's own reach outward,
								// delegated: storage and fetch (R-3).
								kind: "oracle",
								timeoutMs: TOOL_HOOK_TIMEOUT_MS,
								seedLabel: `${scope.runId ?? "run"}:tool:${name}`,
								user:
									scope.userId != null
										? String(scope.userId)
										: undefined,
								runId: scope.runId,
								// A tool called from another package's pipeline —
								// or a person's — runs with only the secrets its
								// owner lends (R63).
								foreignPipeline: provider.binding.pluginId !== scope.ownerPluginId
							}
						)
						return r.ok
							? { tool: name, result: r.value }
							: {
									tool: name,
									error:
										r.reason ??
										`the extension providing '${name}' could not answer.`
								}
					} catch (e) {
						// The internal fault. Reported as a result rather than
						// thrown for the same reason the tool's own failure is:
						// a loop that ends on a host bug loses the whole turn,
						// and the receipt records this node's output either way.
						return {
							tool: name,
							error: `'${name}' failed: ${(e as Error).message}`
						}
					}
				}

				default: {
					/**
					 * Every summarize and graph step, through one dispatcher.
					 *
					 * They differ in how the *user* prompt is built and in
					 * nothing else — same adapter, same queue, same resolution of
					 * connection and sampling from the node's slots. Listing them
					 * case by case would be eleven copies of one call.
					 */
					if (STEP_TYPES.has(node.definitionId)) {
						const { dispatchStep } = await import(
							"$lib/server/pipelines/runtime/dispatchStep"
						)
						// Queued, then unstreamed: the in-flight beat is its
						// only sign of life (`callTether`).
						const { text, connection } = await line.hold(() => dispatchStep(db, {
							systemPrompt: String(p.systemPrompt ?? ""),
							userPrompt: stepUserPrompt(p),
							connectionId: refId(p.connection),
							connectionModelId: connectionDescriptorModelId(
								p.connection
							),
							samplingId: refId(p.sampling),
							label: p.label,
							signal: line.signal,
							// A step that asks for a shape (turn-advise) gets the
							// strongest structured door its connection has.
							...(p.schema ? { schema: p.schema } : {})
						}))
						// Steps that ask for JSON get it parsed here rather than
						// in each binding: the models wrap it in prose often
						// enough that every caller would need the same salvage.
						//
						// `connection` rather than the old `via` string: this
						// value is the node's receipt output, and a non-admin can
						// read their own receipt (`pipelines:run`). Under this key
						// the projection takes it away from them and leaves it for
						// an administrator.
						return { text, connection, json: tryJson(text) }
					}

					throw new Error(
						`${node.key} (${node.definitionId}) has no dispatch path in core. A Provider core ` +
							`cannot call is one a user could add to a pipeline and watch fail at run time.`
					)
				}
			}
		},

		async commit(payload, node) {
			const p = (payload ?? {}) as Record<string, any>

			switch (node.definitionId) {
				case "core:outlet/create-message": {
					// The run's own session and user, and only those: payload-
					// borne `sessionId`/`userId` overrides were read here and
					// nothing declared or supplied them (U2 residual,
					// 2026-09-16). A port that let a spec write into another
					// session, or as another user, would be a scope escape
					// wearing a port's clothes — so the reads went rather than
					// the declarations arriving.
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to write to — the run was started without a session scope`
						)
					/**
					 * Which lane it lands on (20 §7). Absent is `main`, so a
					 * pipeline that has never heard of channels writes where
					 * it always did.
					 *
					 * A lane the session does not have is refused rather than
					 * coerced: a message on a channel no surface subscribes to
					 * is a message nobody will ever see, which is the shape of
					 * data loss even though the row is right there. Same
					 * posture as `assertScoped` — refused, not filtered.
					 *
					 * The refusal is on the **channel**, not the lane: a genre
					 * declares slugs and its pipelines allocate lanes at
					 * runtime, so `text-messages:6` needs no permission that
					 * `text-messages` did not already have.
					 */
					const refusal = await channelRefusal(
						db,
						sessionId,
						p.channel
					)
					if (refusal)
						throw new HostScopeError(`${node.key}: ${refusal}`)
					const race = racesLiveRow(node.key, p.channel)
					if (race) throw new HostScopeError(race)

					const { insertLegacy, updateLegacyWhere } = await import(
						"$lib/server/messages/store"
					)

					/**
					 * The pipeline owns its row (09-B B4, R-17). What this
					 * node commits is the row the composer shows, the run's
					 * live row and the row Stop finalises — so the two facts
					 * a placeholder needs are on the payload, declared:
					 * `generating`, and who it is for.
					 */
					const generating = p.generating === true
					/**
					 * Narration: not a character's turn. `characterId` stays
					 * **null** even when a real speaker was picked — that is the
					 * whole of "not inserted into the round-robin" surviving
					 * contact with the database. The rotation (`rotationTurns`) drops
					 * `isNarratorResponse` rows before it matches ids, but the
					 * column is also what `computeDueCharacter` reads on every
					 * other path, and a side-character turn is not the
					 * character's turn in any of them. The identity rides on
					 * `metadata.sideCharacter` (the side-character fact), where
					 * the run and the receipt read it.
					 *
					 * The name is resolved at the write, which is where the row
					 * is: the speaker's where one was named, else the session's
					 * narrator config's, else the default — the same three-way
					 * fallback, resolved at the write rather than by the trigger.
					 */
					const narration = p.narration === true
					// The side-character fact, off the `sideCharacter` in-port
					// (was `speaker` until 2026-09-16). Stored under
					// `metadata.sideCharacter` since U5g (migration 0138 moved
					// the rows): `metadata.speaker` is the participant
					// reference now, on the row as on the inlet (R1).
					const sideCharacter =
						p.sideCharacter && typeof p.sideCharacter === "object"
							? (p.sideCharacter as {
									name?: string
									characterId?: number | null
									known?: boolean
								})
							: null
					/**
					 * Who is speaking, as a participant reference (R-18 (3);
					 * U5g) — the `speaker` in-port, `character:<id>` or
					 * `envoy:<slug>`. Stored as `metadata.speaker`. For an
					 * envoy it is the row's ONLY identity: there is no
					 * character row for `characterId` to name, and the client
					 * renders the envoy's name and image from the session view
					 * by this reference. A well-formed reference only; anything
					 * else is not stored rather than stored as noise.
					 */
					const namedRef =
						typeof p.speaker === "string" && isParticipantRef(p.speaker)
							? p.speaker
							: null
					/**
					 * Everyone has a name (ruled 2026-09-26). An envoy named
					 * here must be one this session declares — refused by
					 * name, since a line under a slug nothing declares renders
					 * under nobody. And a fresh line nobody claims — no
					 * character, persona, speaker, side character or narration
					 * — posts as the running document's action envoy, else the
					 * genre's fallback envoy (`unclaimedLineSpeaker`); with
					 * neither it stays speakerless and readers name it with the
					 * narrator name, then `UNCLAIMED_LINE_NAME`. A claimed row
					 * (regenerate, swipe, extend) keeps the identity it has.
					 */
					const {
						unclaimedLineSpeaker,
						undeclaredSpeakerRefusal
					} = await import("$lib/server/pipelines/entities/envoys")
					const namedEnvoy = envoySlugOfRef(namedRef)
					if (namedEnvoy) {
						const undeclared = await undeclaredSpeakerRefusal(
							db,
							sessionId,
							namedEnvoy
						)
						if (undeclared)
							throw new HostScopeError(`${node.key} ${undeclared}`)
					}
					const unclaimed =
						!namedRef &&
						!narration &&
						!sideCharacter &&
						p.row == null &&
						refId(p.characterId) == null &&
						p.personaId == null &&
						(p.role ?? "assistant") === "assistant"
					const speakerRef =
						namedRef ??
						(unclaimed
							? await unclaimedLineSpeaker(db, sessionId, {
									specId: scope.specId,
									contributes: scope.contributes
								})
							: null)
					const narratorName = narration
						? sideCharacter?.name ||
							(await narratorNameFor(
								db,
								sessionId,
								scope.userId
							)) ||
							"Narrator"
						: undefined
					const instructions =
						typeof p.instructions === "string" &&
						p.instructions.trim()
							? p.instructions
							: undefined
					// Folded sections (B4): checked before anything is
					// written, so a malformed list writes nothing at all.
					const sections = foldedSectionsIn(node, p.sections)
					// `answersForm` is the host's fact (U5f): a spec's or a
					// client's copy is dropped, and the run's own — the form
					// `fireAction` was fired for — is stamped in its place.
					const { answersForm: _claimed, ...givenMetadata } =
						(p.metadata ?? {}) as Record<string, unknown>
					const metadata: Record<string, unknown> = {
						...givenMetadata,
						...(narratorName ? { narratorName } : {}),
						...(instructions
							? { narratorInstructions: instructions }
							: {}),
						...(sideCharacter ? { sideCharacter } : {}),
						...(speakerRef ? { speaker: speakerRef } : {}),
						...(scope.answersForm
							? {
									answersForm: {
										messageId: scope.answersForm.messageId,
										blockId: scope.answersForm.blockId
									}
								}
							: {}),
						...(scope.planRowId !== undefined
							? { planRowId: scope.planRowId }
							: {})
					}
					if (sections?.length) metadata.sections = sections
					/**
					 * 🚧 The turns a planner's row plans (Lair character
					 * turns): resolved to participant references here, once,
					 * and stored — the history projects it for the turn
					 * order and `turn-plan@1` (`sessions/turnPlan.ts`).
					 */
					if (p.turnPlan != null) {
						const { storedTurnPlan } = await import("$lib/server/sessions/turnPlan")
						const turnPlan = await storedTurnPlan(db, sessionId, p.turnPlan)
						if (turnPlan) metadata.turnPlan = turnPlan
					}

					/**
					 * An existing row, claimed rather than inserted (the
					 * inlet's `messageId` on a regenerate, swipe or extend).
					 * Reset to generating; its text and swipe history stay as
					 * the verb left them — an extend's partial is the prefill
					 * the seed line carries, and the live row joins onto it.
					 * Refused outside this session, like every other reach.
					 */
					const claimId =
						typeof p.row === "number"
							? p.row
							: typeof p.row === "string" && /^\d+$/.test(p.row)
								? Number(p.row)
								: null
					let row: Awaited<ReturnType<typeof insertLegacy>>
					/** The pressing person's own line — see `message-completed` below. */
					let personsOwnLine = false
					if (claimId !== null) {
						const existing = await legacyMessage(db, claimId)
						if (!existing)
							throw new HostScopeError(
								`${node.key}: no message ${claimId} to take as the placeholder`
							)
						assertScoped(node, existing.sessionId, scope.sessionId)
						/**
						 * Only a row that is ALREADY generating can be claimed.
						 * The verb's handler set it so before the run started;
						 * that state is what says "this row is waiting for a
						 * run". Without the check `row` was a port through
						 * which an authored spec could take over any settled
						 * message in the session — somebody's finished reply,
						 * the user's own line — reset it to generating and
						 * overwrite it at `save`. Fenced in the write as well,
						 * so a row released between the read and the claim
						 * (a Stop landing exactly then) is refused too rather
						 * than resurrected.
						 */
						if (!existing.isGenerating)
							throw new HostScopeError(
								`${node.key}: message ${claimId} is not generating, so it is not a ` +
									`placeholder this run may claim — only a row a regenerate, swipe ` +
									`or extend has already set generating can be taken over.`
							)
						const [claimed] = await updateLegacyWhere(
							db,
							and(
								eq(schema.sessionMessages.id, claimId),
								eq(schema.sessionMessages.isGenerating, true)
							),
							{
								// A stale status from the run this row last
								// waited on says nothing about this one.
								generationStatus: null,
								queueItemId: null,
								error: null,
								// A re-driven row's outcome is the run's to
								// decide: a stop before this claim is cleared.
								generationOutcome: null,
								// Sections handed to the claim are the shown
								// alternative's (B4) — normally they come
								// with the save instead.
								...(sections
									? {
											metadata: withFoldedSections(
												existing.metadata,
												sections
											)
										}
									: {})
							}
						)
						if (!claimed)
							throw new HostScopeError(
								`${node.key}: message ${claimId} was released before this run could claim it`
							)
						row = claimed
					} else {
						/**
						 * Who speaks, as a cast row. Wired, or — when only the
						 * `speaker` reference names a character — that
						 * reference's row: `character:<id>` and a `characterId`
						 * are one fact, so a spec that says who speaks the one
						 * way has said it the other (lair pass B16: a delver's
						 * row carries the reference its context resolved).
						 */
						const namedRow = speakerRef
							? parseParticipantRef(speakerRef)
							: null
						const speakerRow =
							namedRow?.kind === "character"
								? participantRowId(namedRow.id)
								: null
						const characterId = narration
							? null
							: (refId(p.characterId) ?? speakerRow ?? null)
						/**
						 * A person's own line — through their presence, or as
						 * themselves.
						 *
						 * A character that is the RUN OWNER's presence in this
						 * session — a persona — writes the PERSON's row, not a
						 * character's (personas merged into characters, 0132:
						 * a persona is a character row with `is_persona`, and
						 * the message's role columns keep the `persona_id`
						 * name). The `adventure-answer` road names the pressed
						 * option's addressee as `characterId`; committed as a
						 * character row it resolves against the cast, where a
						 * persona never is, and the line rendered as "Unknown"
						 * (2026-09-17). A `speaker` of `user:<id>` naming the
						 * run owner, with no character at all, is the same
						 * person answering as themselves — a persona-less line
						 * is its author's: `role: user` under their id, no
						 * persona (handover 2026-09-17 §4).
						 *
						 * The presence is decided from the run's PINNED
						 * portrayals (R-21 (4)), the one membership read every
						 * run already pays: `person` for `character:<id>` is
						 * exactly "a live `session_personas` row whose owner
						 * is a member", with the holder's id on it. Three
						 * things keep both readings to the person's OWN press:
						 * the holder — or the `user:` reference — must be the
						 * run owner (a press is admitted only to the presence's
						 * person, `fireAction`); the run must be a ROOT — a
						 * dispatched run is the system's, and the AI's answer
						 * as a character who became a member's presence
						 * mid-answer stays the AI's line (W3); and a generating
						 * placeholder is the model's row, never a person's. A
						 * spec that names `personaId` itself has already said
						 * so and is left alone; a host with no portrayals
						 * (hand-wired, a preview) writes what it was given.
						 */
						const ownPress =
							p.personaId == null &&
							!scope.lineage &&
							!generating &&
							scope.userId != null
						const presence =
							ownPress && characterId !== null
								? scope.portrayals?.[`character:${characterId}`]
								: undefined
						const asPersona =
							presence?.by === "person" &&
							presence.userId === String(scope.userId)
						const speakerParsed = speakerRef
							? parseParticipantRef(speakerRef)
							: null
						const asSelf =
							ownPress &&
							characterId === null &&
							speakerParsed?.kind === "user" &&
							participantRowId(speakerParsed.id) === scope.userId
						// Only the owner's answer to a question put to the OWNER
						// (the Lair's knock): out of the fiction, their answer is
						// their steering and the story moves on as from a send.
						// Every other line a run writes as a person — an in-story
						// answer, a question they ask — stays the run's.
						personsOwnLine =
							(asPersona || asSelf) && scope.answersForm?.toOwner === true
						row = await insertLegacy(db, {
							sessionId,
							userId: scope.userId ?? null,
							characterId: asPersona ? null : characterId,
							personaId: asPersona
								? characterId
								: (p.personaId ?? null),
							role:
								p.role ??
								(asPersona || asSelf ? "user" : "assistant"),
							// Canonical, so `text-messages:1` and `text-messages`
							// cannot land in the column as two lanes.
							channel: canonicalChannel(p.channel),
							content: String(p.text ?? ""),
							metadata,
							isNarratorResponse: narration,
							isGenerating: generating
						})
					}

					record(
						node,
						"message",
						row.id,
						claimId !== null ? "updated" : "created"
					)
					// The composer's placeholder IS this row (R-17): announced
					// from the write, so the client sees it the moment it
					// exists — before a token has been spent on it.
					scope.live?.opened(row)
					await announce(row)

					// Media posted WITH the message (the `media` in-port).
					//
					// It has to happen here rather than in a following
					// `attach-image`, because a message created inside a run
					// cannot be the target of a later node — `write-result@1` is
					// not assignable to `row-ids@1`, deliberately, since under
					// async review the row may never exist. So the write that
					// creates the message is the write that attaches its images.
					if (Array.isArray(p.media) && p.media.length) {
						const parts = await mediaParts(
							db,
							p.media,
							sessionId,
							scope,
							node
						)
						if (parts.length) {
							const { appendParts } = await import(
								"$lib/server/messages/store"
							)
							await appendParts(db, row.id, parts)
							// The files are the run's output too — the message
							// alone would say a reply happened and lose the
							// images it was actually about.
							for (const part of parts)
								record(
									node,
									"file",
									part.data.assetId,
									"attached"
								)
						}
					}

					// Blocks posted WITH the message (the `blocks` in-port,
					// U5d) — for the reason media is: the write that creates
					// the row is the write that gives it its parts. A form
					// among them addressed to the AI goes on the run's list
					// for `runSpec` to dispatch once the receipt is saved.
					const blocks = await writeBlocks(node, row, p.blocks)
					if (blocks || sections?.length)
						await announceWithParts(row.id)

					// A row that is not generating LANDED (PLAN-turn-order
					// §4.1): a person's own line through an action, a reply
					// written whole. Never for a placeholder — that row
					// completes when `update-message` finishes it.
					//
					// The cause is the PERSON's when the row is the owner's own
					// answer to a question put to the owner, on their own press
					// (lair pass B12, 2026-09-27) — the Lair's "the party go on"
					// once the knock is answered: their steering, so auto-advance
					// treats it as a send (§4.6). Every other row a run lands is
					// the run's.
					if (row.isGenerating !== true)
						await emit(
							"core:event/message-completed@1",
							{ sessionId: row.sessionId, messageId: row.id },
							{ kind: personsOwnLine ? "user" : "run" }
						)

					// A placeholder or a claimed row is the run's live row; a
					// complete message is an ordinary write (F7, W1 — see
					// `racesLiveRow`). A claimed row keeps the channel it
					// already sits on, whatever the payload says.
					if (opensLiveRow(p) && liveChannel === undefined) {
						liveChannel = canonicalChannel(
							claimId !== null
								? (row as { channel?: unknown }).channel
								: p.channel
						)
						liveRowId = row.id
					}
					return { id: row.id, sessionId: row.sessionId }
				}

				case "core:outlet/seed-greetings": {
					// The create pipeline's write (24 §12, T8) — the same
					// implementation the imperative path used, behind the
					// declared node. Empty greetings are an ordinary state.
					// The run's own session and user — see `create-message`.
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to write to — the run was started without a session scope`
						)
					const userId = scope.userId
					if (userId === undefined || userId === null)
						throw new HostScopeError(
							`${node.key} has no user to write as — the run was started without a user scope`
						)
					/**
					 * The same refusal `create-message` makes, for the same
					 * reason: a greeting seeded onto a channel the genre never
					 * declared is N messages nothing will ever render. The
					 * genre's own `greeting.channel` counts as declared
					 * (`channelsOf`), so a genre redirecting its own greetings
					 * cannot trip this — only a pipeline wiring in some other
					 * value can.
					 */
					const greetingRefusal = await channelRefusal(
						db,
						sessionId,
						p.channel
					)
					if (greetingRefusal)
						throw new HostScopeError(
							`${node.key}: ${greetingRefusal}`
						)
					// Empty greetings write nothing, so they race nothing.
					const race =
						Array.isArray(p.greetings) && p.greetings.length > 0
							? racesLiveRow(node.key, p.channel)
							: null
					if (race) throw new HostScopeError(race)

					const { writeSessionGreetings } = await import(
						"$lib/server/sessions/greetings"
					)
					const ids = await writeSessionGreetings(db, {
						sessionId,
						userId,
						entries: Array.isArray(p.greetings) ? p.greetings : [],
						// Canonicalised here as well as inside
						// `writeSessionGreetings`: this is a write path, and a
						// write path normalises where it can see the value.
						channel: canonicalChannel(p.channel)
					})
					// ⚠ **N messages, all of them recorded.** This is the case
					// the old single `message_id` column structurally could not
					// hold: `writtenMessageId` read `output.ids.id` off the
					// first committed consumer, this consumer publishes `ids[]`,
					// and so a greeting seed recorded nothing at all.
					for (const id of ids) record(node, "message", id, "created")
					// Each seeded greeting is a row that landed (§4.1): one
					// `message-completed` per row, as the create-message
					// commit emits for the one row it writes.
					for (const id of ids)
						await emit(
							"core:event/message-completed@1",
							{ sessionId, messageId: id },
							{ kind: "run" }
						)
					return { ids, count: ids.length, sessionId }
				}

				case "core:outlet/update-message": {
					/**
					 * The target is a row id from the inlet, or the write
					 * result of an earlier outlet in this run — the reply's
					 * `$.placeholder.messageId`, whose `ids.id` IS a row id by
					 * the time this node runs (09-B B4).
					 */
					const target = p.target
					const id = refId(
						target && typeof target === "object" && "ids" in target
							? (target as { ids?: { id?: unknown } }).ids?.id
							: target
					)
					if (id === null)
						throw new HostScopeError(
							`${node.key} was given no message id to update — wire 'target' from the ` +
								`inlet's row id, or from the placeholder outlet that created the row.`
						)
					const { updateLegacyWhere, updateLegacy } = await import(
						"$lib/server/messages/store"
					)
					const current = await legacyMessage(db, id)
					if (!current)
						throw new HostScopeError(
							`${node.key}: no message ${id} to update`
						)
					assertScoped(node, current.sessionId, scope.sessionId)
					const text = String(p.text ?? "")
					// Folded sections (B4), checked before either write.
					const sections = foldedSectionsIn(node, p.sections)

					/**
					 * The row decides which of the two updates this is.
					 *
					 * **Still generating** — the placeholder this run created:
					 * finish it. The text lands joined onto whatever a continue
					 * started from, the reasoning trace and the swipe slot are
					 * written through the one builder that keeps their
					 * invariants, and the flags that end the generation are
					 * cleared. Fenced on the row still generating: a Stop that
					 * released it first wins — and when the released row is
					 * THIS run's own live row, winning means the reply that
					 * arrived after the stop is dropped, not written. Before
					 * that rule was code, a Stop landing between the fence
					 * check and the write fell through to the edit below and
					 * put the whole reply over the partial the person had just
					 * kept, marked as their edit.
					 *
					 * **Settled** — a person's edit, a rewrite from outside the
					 * run: the text replaces, and the row says it was edited.
					 * Never the run's own PLACEHOLDER: the only way that row is
					 * settled while its run is still going is a Stop, so the
					 * reply that arrived after it is dropped here too. A row
					 * this run created complete and now edits is not that —
					 * it was never open — and takes the edit as written.
					 */
					const ownRow =
						scope.live?.id === id && scope.live.placeholder === true
					if (ownRow && !current.isGenerating)
						return { id: current.id, sessionId: current.sessionId }
					if (current.isGenerating) {
						const { buildReasoningMetadata } = await import(
							"$lib/server/messages/reasoningMetadata"
						)
						const { joinContinuation } = await import(
							"$lib/server/messages/continuation"
						)
						// Onto the PREFILL — what the row held when the
						// placeholder claimed it — never onto its current
						// text: the live row has been rewriting that with the
						// stream, already joined, and joining again would
						// write the reply twice. Without a live row nothing
						// streamed, and the row still holds the prefill.
						const content = joinContinuation(
							scope.live?.id === id
								? scope.live.prefill
								: (current.content ?? ""),
							text
						)
						const reasoning =
							typeof p.reasoning === "string" && p.reasoning.length
								? p.reasoning
								: undefined
						// A generation that ended with NO reasoning clears what
						// its live frames showed in the fold — a model asked to
						// reason that never did streamed its reply there until
						// the stream ended (`splitReasoningStream`, `requested`).
						const shown = (
							current.metadata as { reasoning?: unknown } | null
						)?.reasoning
						const stale =
							reasoning === undefined &&
							typeof shown === "string" &&
							shown.length > 0
						const thought = buildReasoningMetadata(
							current.metadata,
							content,
							stale ? null : reasoning,
							true
						)
						/**
						 * The shown alternative's folded sections are the
						 * save's, whole (B4): a regenerate replaces what the
						 * slot held and a save with none clears it, while the
						 * other alternatives keep theirs. A slot that had none
						 * and gets none is left alone, so a row that never
						 * carried sections is written exactly as before.
						 */
						const base = thought ?? current.metadata
						const touchesSections =
							!!sections?.length ||
							foldedSectionsOf(base).length > 0
						const metadata = touchesSections
							? withFoldedSections(base, sections ?? [])
							: thought
						const [finished] = await updateLegacyWhere(
							db,
							and(
								eq(schema.sessionMessages.id, id),
								eq(schema.sessionMessages.isGenerating, true)
							),
							{
								content,
								isGenerating: false,
								generationStatus: null,
								generationOutcome: null,
								queueItemId: null,
								error: null,
								...(metadata !== null ? { metadata } : {})
							}
						)
						if (finished) {
							record(node, "message", finished.id, "updated")
							// The live row is settled: what this run writes
							// on its channel from here on lands after it
							// (F7, "beside, not after" — see `liveRowId`).
							if (finished.id === liveRowId) {
								liveChannel = undefined
								liveRowId = undefined
							}
							// Blocks a reply ends with — a question put to
							// the cast — set once the text has landed (the
							// row's one block tree, S5), and announced with
							// the parts so the buttons show without a reload.
							const blocks = await writeBlocks(node, finished, p.blocks, {
								replace: true
							})
							if (blocks || touchesSections)
								await announceWithParts(finished.id)
							else await announce(finished)
							// A verb's rewrite is a change to history a
							// pipeline has already seen (R-15): recorded for
							// the next reply's inlet with the verb on it —
							// and, for a regenerate, with what it replaced
							// (`scope.previous`, W3). A fresh turn's finish is
							// the history growing, not moving, and records
							// nothing.
							if (scope.verb)
								await emit(
									"core:event/message-updated@1",
									{
										sessionId: finished.sessionId,
										messageId: finished.id,
										verb: scope.verb,
										...(scope.previous
											? { previous: scope.previous }
											: {})
									},
									{ kind: "run" }
								)
							// The reply LANDED (PLAN-turn-order §4.1): the
							// event the turn-order spec answers, emitted from
							// the finishing write whether the turn was fresh
							// or a verb's — a row that is not generating.
							await emit(
								"core:event/message-completed@1",
								{
									sessionId: finished.sessionId,
									messageId: finished.id
								},
								{ kind: "run" }
							)
							await settledMessage(
								finished.id,
								finished.sessionId
							)
							return {
								id: finished.id,
								sessionId: finished.sessionId
							}
						}
						// The fence missed on the run's own row: somebody
						// released it between the read above and the write —
						// a Stop, which wins. The row is left exactly as the
						// release left it, holding the partial; nothing is
						// recorded, because nothing was written.
						if (ownRow) {
							const released = (await legacyMessage(db, id))!
							return {
								id: released.id,
								sessionId: released.sessionId,
								notes: [
									"dropped: row released before the write"
								]
							}
						}
					}

					const row = await updateLegacy(db, id, {
						content: text,
						isEdited: true,
						// An edit that hands the row sections means these
						// sections, for the shown alternative (B4); one that
						// hands none leaves them.
						...(sections
							? {
									metadata: withFoldedSections(
										current.metadata,
										sections
									)
								}
							: {})
					})
					if (!row)
						throw new HostScopeError(
							`${node.key}: no message ${id} to update`
						)
					record(node, "message", row.id, "updated")
					// The row's one block tree, replaced (S5) — an edit that
					// hands the row new blocks means these blocks.
					const blocks = await writeBlocks(node, row, p.blocks, { replace: true })
					if (blocks || sections) await announceWithParts(row.id)
					else await announce(row)
					return { id: row.id, sessionId: row.sessionId }
				}

				// ── The built-in writes (R-15, 2026-09-16) ──────────────────
				//
				// Each is the write half of one message verb, reached through
				// its own one-node spec (`core:spec/builtin-*`, `runBuiltIn`).
				// The venue's handler made the permission checks on the id it
				// was asked about; here they are made AGAIN, on the id the
				// write is about to use (U5b review C1) — the two can differ,
				// because a review gate may fold an edit into the payload
				// between them, and the ownership a handler judged is not a
				// property the payload carries. So: the document is the
				// built-in's own (`assertBuiltInSpec`), the target is checked
				// against the run's session like every other reach, the actor
				// may act on THIS row (`assertMayAct`), the row is changed, the
				// artifact is recorded, the row is announced as today, and the
				// change is written for the next reply's inlet with what was
				// lost or replaced. The event itself rides the outlet's
				// `causesEvent` onto the receipt.

				case "core:outlet/set-turn-order": {
					/**
					 * The one write path for `metadata.turnOrder` (PLAN
					 * §4.2, §4.4) — and the only outlet that writes
					 * `metadata` at all.
					 *
					 * Two drops before the write, each a receipt note rather
					 * than a refusal: an entry naming a ref the pool did not
					 * admit (a script or a plugin strategy cannot seat
					 * somebody nobody pooled), and an entry on a channel
					 * this session does not have (a turn nothing would ever
					 * render). Then `writeTurnOrder`, whose staleness rule
					 * is what stands between two recomputes finishing out of
					 * order — and a stale write is a note too, never an
					 * error: a newer order already answers a newer event.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to write a turn order for — the run was started without a session scope`
						)
					const candidates = Array.isArray(p.candidates)
						? (p.candidates as Array<Record<string, unknown>>)
						: []
					// Candidates as the pool published them, held to the live cast
					// (M4 review): the pool node is swappable and contributable, so
					// its floors — no removed seat, no on-action envoy — are
					// re-checked here, where no swap can reach (§6).
					const live = await liveCastRefs(db, sessionId)
					const admitted = new Set(
						candidates.map((c) => String(c?.ref)).filter((ref) => live.has(ref))
					)
					const [row] = await db
						.select({ genreId: schema.sessions.genreId })
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					const { getSessionGenre, STANDARD_GENRE_ID } = await import(
						"$lib/server/pipelines/entities/sessionGenres"
					)
					const declared = new Set(
						channelsOf(
							(
								await getSessionGenre(
									db,
									row?.genreId ?? STANDARD_GENRE_ID
								)
							)?.shape
						)
					)
					const notes: string[] = []
					const order: Array<Record<string, unknown>> = []
					for (const raw of Array.isArray(p.order) ? p.order : []) {
						if (!raw || typeof raw !== "object") continue
						const entry = raw as Record<string, unknown>
						if (entry.ref !== null && !admitted.has(String(entry.ref))) {
							notes.push(
								`dropped ${String(entry.ref)}: not a candidate this recompute pooled`
							)
							continue
						}
						if (typeof entry.channel === "string" && entry.channel) {
							const channel = canonicalChannel(entry.channel)
							if (!declared.has(parseChannel(channel).slug)) {
								notes.push(
									`dropped ${String(entry.ref ?? "the narrator")}: this session has no channel '${entry.channel}'`
								)
								continue
							}
							entry.channel = channel
						}
						order.push(entry)
					}

					const at = Number(p.basedOnAt)
					const next = {
						v: 1 as const,
						order: order as never,
						candidates: candidates as never,
						basedOnAt: Number.isFinite(at) ? at : Date.now(),
						computedAt: Date.now(),
						runId: scope.runId ?? null,
						event:
							typeof p.event === "string" && p.event ? p.event : null,
						// Which strategy produced this order (§4.2's
						// `strategy`): the node the spec ran, read off the
						// running document rather than guessed — the key is
						// `strategy` by the spec's own declaration (§4.5).
						strategy: await turnStrategyPin(db, scope.specId, sessionId, scope.nodes)
					}
					const { writeTurnOrder } = await import(
						"$lib/server/sessions/turnOrder"
					)
					const result = await writeTurnOrder(db, sessionId, next)
					if (!result.written) {
						notes.push(
							result.reason === "stale"
								? "not written: a newer turn order already answers a newer event"
								: "not written: the session no longer exists"
						)
						const { readTurnOrder } = await import("@serene-pub/sdk")
						const [current] = await db
							.select({ metadata: schema.sessions.metadata })
							.from(schema.sessions)
							.where(eq(schema.sessions.id, sessionId))
							.limit(1)
						return {
							written: false,
							sessionId,
							notes,
							turnOrder: readTurnOrder(current?.metadata)
						}
					}
					record(node, "session", sessionId, "updated")
					/**
					 * `turn-order-changed`, carrying **the inlet's cause**
					 * (PLAN-turn-order §4.4) — not this run's.
					 *
					 * That is the whole of auto-advance's rule: the listener
					 * asks why the order moved, and the answer has to be why
					 * the *event* fired, not that a pipeline wrote a row. A
					 * person's send recomputes and may fire; a person's edit
					 * recomputes and may not. `causesEvent` on the
					 * declaration is what a receipt records; this is the
					 * emission, on the one road every session event takes.
					 */
					if (scope.userId != null) {
						const { emitSessionEvent } = await import(
							"$lib/server/pipelines/runtime/sessionEvents"
						)
						const cause =
							p.cause && typeof p.cause === "object"
								? (p.cause as Record<string, unknown>)
								: { kind: "system" }
						await emitSessionEvent(db, {
							sessionId,
							userId: scope.userId,
							event: "core:event/turn-order-changed@1",
							payload: {
								sessionId,
								runId: scope.runId ?? null,
								turnOrder: next,
								cause,
								...(scope.lineage ? { lineage: scope.lineage } : {})
							},
							io: scope.io,
							signal: scope.signal
						})
					}
					return {
						written: true,
						sessionId,
						...(notes.length ? { notes } : {}),
						turnOrder: next
					}
				}

				case "core:outlet/set-session-annex": {
					/**
					 * The annex write (§4.3): one owner's document, merged
					 * into what is there unless `merge` is off, under
					 * `pg_advisory_xact_lock(hashtext('annex'), sessionId)`
					 * through `jsonb_set` — so two specs writing two owners'
					 * documents at once cannot lose each other's, and
					 * neither can read-modify-write the column.
					 *
					 * Naming another owner needs `sharedAnnex`; without it
					 * the write is refused with a note rather than silently
					 * landing in the spec's own document, which would be the
					 * worse of the two failures.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to write an annex for — the run was started without a session scope`
						)
					const params = (p.params ?? {}) as {
						owner?: unknown
						merge?: unknown
						sharedAnnex?: unknown
					}
					const own = annexOwnerOf(scope.specId)
					const named =
						typeof params.owner === "string" && params.owner.trim()
							? params.owner.trim()
							: null
					if (named && named !== own && params.sharedAnnex !== true)
						return {
							written: false,
							sessionId,
							notes: [
								`refused: '${own}' may not write the annex of '${named}' — set 'Write another owner' on this node to allow it`
							]
						}
					const owner = named ?? own
					const value =
						p.value && typeof p.value === "object" && !Array.isArray(p.value)
							? (p.value as Record<string, unknown>)
							: {}
					// One annex declaration per owner (ruling 2026-09-26): the
					// write names only keys the owner declares for this
					// session's genre, and each value fits its declared shape.
					// Judged here at every write,
					// whatever publish saw: a wired value's keys are known
					// only now. The audience stored is the declaration's.
					const { annexWriteRefusals } = await import("@serene-pub/sdk")
					const { annexFieldsOfOwner, sessionGenreOf } = await import(
						"$lib/server/sessions/annexFields"
					)
					const genreId = await sessionGenreOf(db, sessionId)
					const fields = await annexFieldsOfOwner(db, genreId, owner)
					const refusals = annexWriteRefusals(fields, {
						owner,
						keys: Object.keys(value),
						genre: genreId,
						values: value
					})
					if (refusals.length)
						throw new HostScopeError(`${node.key}: refused — ${refusals.join("; ")}`)
					return await writeAnnexDocument(
						node,
						sessionId,
						owner,
						value,
						params.merge !== false,
						Object.fromEntries(fields.map((f) => [f.key, f.see])),
						new Set(fields.map((f) => f.key))
					)
				}

				case "core:outlet/set-annex-field": {
					/**
					 * An annex field's write (2026-09-26): `{ field, value }`,
					 * put there by `fireAction` after judging the press. Judged
					 * again here, off the declaration and never off the
					 * payload — an undeclared key, a value its shape refuses
					 * or an audience that is not one halts the run — then
					 * written through the one annex write into
					 * `annex[<owner>][<key>]`, merged, under the declared
					 * audience. The owner is the declaring package, so a field
					 * can write nobody else's document.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to write an annex field for — the run was started without a session scope`
						)
					const payload = (p.payload ?? {}) as { field?: unknown; value?: unknown }
					const {
						annexFieldValueRefusal,
						parseAnnexFieldAction
					} = await import("@serene-pub/sdk")
					const target = parseAnnexFieldAction(payload.field)
					if (!target)
						throw new HostScopeError(
							`${node.key}: refused — '${String(payload.field)}' is not an annex field's identity (<owner>:annex#<key>)`
						)
					const [session] = await db
						.select({ genreId: schema.sessions.genreId })
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					const { annexFieldFor } = await import("$lib/server/sessions/annexFields")
					const field = await annexFieldFor(db, session?.genreId ?? "core:genre/chat", String(payload.field))
					if (!field)
						throw new HostScopeError(
							`${node.key}: refused — '${target.key}' is not an annex field '${target.owner}' declares for this session`
						)
					// Declared but pipeline-written only: no press may set it.
					if (!field.decl.act?.length)
						throw new HostScopeError(
							`${node.key}: refused — '${target.key}' is set by '${target.owner}''s pipelines only`
						)
					const fault = annexFieldValueRefusal(field.decl, payload)
					if (fault) throw new HostScopeError(`${node.key}: refused — ${fault}`)
					const { dataAudienceFindings } = await import("@serene-pub/sdk")
					const audienceFault = dataAudienceFindings(field.decl.see)
					if (audienceFault) throw new HostScopeError(`${node.key}: refused — ${audienceFault}`)
					const { annexFieldsOfOwner } = await import("$lib/server/sessions/annexFields")
					const ownerFields = await annexFieldsOfOwner(
						db,
						session?.genreId ?? "core:genre/chat",
						field.owner
					)
					return await writeAnnexDocument(
						node,
						sessionId,
						field.owner,
						{ [field.decl.key]: payload.value },
						true,
						{ [field.decl.key]: field.decl.see },
						new Set(ownerFields.map((f) => f.key))
					)
				}

				case "core:outlet/record-event": {
					/**
					 * A package's event, recorded (R45/R47/R52, E1b). The
					 * recording is a write — the ledger row — and the event it
					 * causes is the one it names; bound pipelines run as
					 * children of this run, so the depth cap bounds a chain.
					 *
					 * Refused here, at run time, whatever publish saw: an event
					 * no installed package declares (withdrawn on uninstall),
					 * and a pipeline outside the event's recording scope. Scope
					 * is judged on the subjects this spec serves — its inlet
					 * lock's events, or on the action event its actions.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to record an event in — the run was started without a session scope`
						)
					// A recording is a write on someone's behalf; a run with no
					// user would record for nobody and the listeners could not
					// be run as anyone.
					if (scope.userId === undefined)
						throw new HostScopeError(
							`${node.key} has no user to record an event for — the run was started without one`
						)
					const eventId = typeof p.event === "string" ? p.event : ""
					const { mayRecord, eventScopeOf } = await import("$lib/server/plugins/pluginEvents")
					const { subjectsOf, recordedPayloadFindings } = await import("@serene-pub/sdk")
					const [session] = await db
						.select({ genreId: schema.sessions.genreId })
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					if (!session) throw new HostScopeError(`${node.key}: session ${sessionId} does not exist`)
					const subjects = subjectsOf({
						id: scope.specId ?? "",
						input: scope.input ?? {},
						contributes: scope.contributes
					} as never)
					const verdict = mayRecord(eventId, session.genreId, subjects)
					if (!verdict.ok)
						throw new HostScopeError(`${node.key}: refused — ${verdict.reason}`)
					// The payload is checked again here, whatever publish saw: a
					// wired value is only known now, and a listener trusts it.
					const payloadProblem = recordedPayloadFindings(
						eventScopeOf(eventId, session.genreId)!.payload,
						p.payload
					)
					if (payloadProblem)
						throw new HostScopeError(`${node.key}: refused — ${payloadProblem}`)
					await emit(
						eventId,
						{ sessionId, payload: p.payload ?? null },
						{ kind: "run" },
						{ asChild: true }
					)
					record(node, "session", sessionId, "updated")
					return { written: true, sessionId, event: eventId }
				}

				case "core:outlet/delete-message": {
					assertBuiltInSpec(node)
					const id = refId(p.target)
					if (id === null)
						throw new HostScopeError(
							`${node.key} was given no message id to delete — wire 'target' from the inlet.`
						)
					const current = await legacyMessage(db, id)
					if (!current)
						throw new HostScopeError(
							`${node.key}: no message ${id} to delete`
						)
					assertScoped(node, current.sessionId, scope.sessionId)
					await assertMayAct(node, id)
					const { deleteLegacy } = await import(
						"$lib/server/messages/store"
					)
					// Both worlds — the store owns the mirror — and the
					// `messages.id` cascade retracts the state this line
					// anchored.
					await deleteLegacy(db, id)
					record(node, "message", id, "deleted")
					const lost = {
						content: current.content,
						role: current.role,
						speaker: speakerRefOf(current),
						channel: current.channel,
						metadata: current.metadata
					}
					await emit(
						"core:event/message-deleted@1",
						{ sessionId: current.sessionId, messageId: id, lost },
						{ kind: "edit" }
					)
					return { id, sessionId: current.sessionId, lost }
				}

				case "core:outlet/advance-story-clock": {
					/**
					 * Move the SESSION's story clock (DESIGN-story-time P3,
					 * §5 `advance(n, unit)`) through its book's calendar —
					 * never the book's present. A wired `by` / `unit` wins
					 * over the parameter. Every refusal halts the run with
					 * the sentence and writes nothing: no book, no present
					 * to start from, a step of nothing, a result that does
					 * not land.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session whose clock to advance — the run was started without a session scope`
						)
					const params = (p.params ?? {}) as { by?: unknown; unit?: unknown }
					const by = p.by !== undefined && p.by !== null ? p.by : (params.by ?? 1)
					const unit =
						typeof p.unit === "string" && p.unit.trim()
							? p.unit.trim()
							: (params.unit ?? "hours")
					const { advanceSessionStoryClock, StoryClockRefusal } = await import(
						"$lib/server/state/storyTime"
					)
					let moved: Awaited<ReturnType<typeof advanceSessionStoryClock>>
					try {
						moved = await advanceSessionStoryClock(
							db,
							sessionId,
							by as number,
							unit as import("$lib/shared/lorebooks/storyDate").StoryTimeUnit
						)
					} catch (e) {
						if (e instanceof StoryClockRefusal)
							throw new HostScopeError(`${node.key}: ${e.message}`)
						throw e
					}
					record(node, "session", sessionId, "updated")
					// What the session inherits is read as of its clock, so
					// every tab reads its state afresh.
					if (scope.io)
						await broadcastToSessionUsers(scope.io, sessionId, "state:changed", {
							sessionId
						} satisfies Sockets.State.Changed.Response)
					// And the session itself moved: `session-updated` names the
					// clock, as `sessions:update` does for a person's move, so a
					// spec bound to it and an open settings form hear it. A
					// child of this run (`asChild`): a spec answering it may
					// advance the clock again, and the lineage caps that loop.
					await emit(
						"core:event/session-updated@1",
						{ sessionId, changed: ["storyClock"] },
						{ kind: "run" },
						{ asChild: true }
					)
					if (scope.io) {
						const { broadcastSessionRow } = await import(
							"$lib/server/sessions/rowPush"
						)
						broadcastSessionRow(scope.io, sessionId)
					}
					return { id: sessionId, sessionId, clock: moved.clock, label: moved.label }
				}

				case "core:outlet/show-sprite": {
					/**
					 * Record a line's **shown sprite** (DESIGN-sprites §5.2) on
					 * its ACTIVE swipe — `swipes.spriteHistory[currentIdx]`,
					 * mirrored to `metadata.sprite` exactly as `reasoning` is.
					 *
					 * Who chose it is the node's `source`, a literal the spec
					 * wrote (2026-10-05): `picker` on the reply specs, `person`
					 * in `core:spec/show-sprite`. Stated, not trusted — a
					 * `person` is accepted from core's own sprite action and
					 * no other spec, and the item rule is checked like an
					 * edit's. A picker never overwrites a person's pick, and a
					 * picker's null pick writes nothing.
					 */
					if (p.source !== "picker" && p.source !== "person")
						throw new HostScopeError(
							`${node.key} was given no source — write source: 'picker' or 'person'.`
						)
					const byPerson = p.source === "person"
					const id = messageRefId(p.target)
					if (id === null)
						throw new HostScopeError(
							`${node.key} was given no message id — wire 'target' from the saved line.`
						)
					const current = await legacyMessage(db, id)
					if (!current)
						throw new HostScopeError(
							`${node.key}: no message ${id} to show a sprite on`
						)
					assertScoped(node, current.sessionId, scope.sessionId)
					if (byPerson) {
						if (
							scope.ownerPluginId !== undefined ||
							scope.specId !== SHOW_SPRITE_SPEC_ID
						)
							throw new HostScopeError(
								`${node.key}: only core's own sprite action records a person's pick.`
							)
						await assertMayAct(node, id)
					}
					const decided = nextSpriteMetadata(
						current.metadata as Record<string, any>,
						p.pick,
						byPerson
					)
					// Nothing written — a picker's null pick, a person's pick
					// standing, the same sprite again — so `written: false`:
					// the executor causes no `sprite-shown`. The step runs
					// after every reply, faceless or not.
					if (decided.kept) {
						return {
							id: current.id,
							sessionId: current.sessionId,
							sprite: decided.sprite,
							kept: true,
							written: false
						}
					}
					const next = decided.sprite
					const patched = decided.metadata
					const { updateLegacy } = await import(
						"$lib/server/messages/store"
					)
					const row = await updateLegacy(db, id, { metadata: patched })
					if (!row)
						throw new HostScopeError(
							`${node.key}: no message ${id} to show a sprite on`
						)
					record(node, "message", row.id, "updated")
					await announce(row)
					await emit(
						"core:event/sprite-shown@1",
						{
							sessionId: row.sessionId,
							messageId: row.id,
							characterId: row.characterId ?? null,
							sprite: next,
							source: next?.source ?? (byPerson ? "person" : "picker")
						},
						{ kind: byPerson ? "edit" : "run" }
					)
					return {
						id: row.id,
						sessionId: row.sessionId,
						sprite: next,
						kept: false
					}
				}

				case "core:outlet/hide-message": {
					assertBuiltInSpec(node)
					const id = refId(p.target)
					if (id === null)
						throw new HostScopeError(
							`${node.key} was given no message id to hide — wire 'target' from the inlet.`
						)
					const current = await legacyMessage(db, id)
					if (!current)
						throw new HostScopeError(
							`${node.key}: no message ${id} to hide`
						)
					assertScoped(node, current.sessionId, scope.sessionId)
					await assertMayAct(node, id)
					const hidden = p.hidden === true
					const { updateLegacy } = await import(
						"$lib/server/messages/store"
					)
					const row = await updateLegacy(db, id, { isHidden: hidden })
					if (!row)
						throw new HostScopeError(
							`${node.key}: no message ${id} to hide`
						)
					record(node, "message", row.id, "hidden")
					await announce(row)
					await emit(
						"core:event/message-hidden@1",
						{ sessionId: row.sessionId, messageId: row.id, hidden },
						{ kind: "edit" }
					)
					return { id: row.id, sessionId: row.sessionId, hidden }
				}

				case "core:outlet/edit-message": {
					assertBuiltInSpec(node)
					const id = refId(p.target)
					if (id === null)
						throw new HostScopeError(
							`${node.key} was given no message id to edit — wire 'target' from the inlet.`
						)
					const current = await legacyMessage(db, id)
					if (!current)
						throw new HostScopeError(
							`${node.key}: no message ${id} to edit`
						)
					assertScoped(node, current.sessionId, scope.sessionId)
					await assertMayAct(node, id)
					/**
					 * A floor's write is a person's rewrite of a SETTLED row.
					 * A row still generating belongs to the run filling it,
					 * whose `update-message` finishes it; rewriting under a
					 * live stream would race the frames the live row is
					 * persisting.
					 */
					if (current.isGenerating)
						throw new HostScopeError(
							`${node.key}: message ${id} is still being written — stop it first, or wait.`
						)
					const text = String(p.text ?? "")
					const previous = { content: current.content }
					// The selected alternative follows the edit, so a swipe
					// back and forth does not resurrect the old text.
					const metadata = current.metadata as Record<string, any>
					const swipes = metadata?.swipes
					const { committedContent, updateLegacy } = await import(
						"$lib/server/messages/store"
					)
					const patch: Partial<
						typeof schema.sessionMessages.$inferInsert
					> = {
						content: text,
						isEdited: true,
						// The vector goes only when the stored words do, so
						// retrieval never matches words the row does not
						// hold. Judged on the text as the store will save it
						// (edge whitespace off), so a save of the same words
						// keeps it. The queue re-embeds on the text hash
						// either way.
						...(committedContent(text) !== current.content
							? {
									embedding: null,
									embeddingModel: null,
									embeddingSourceHash: null
								}
							: {})
					}
					if (swipes && Array.isArray(swipes.history)) {
						const currentIdx = swipes.currentIdx ?? 0
						const history = [...swipes.history]
						if (currentIdx >= 0 && currentIdx < history.length)
							history[currentIdx] = text
						patch.metadata = {
							...metadata,
							swipes: { ...swipes, history }
						}
					}
					const row = await updateLegacy(db, id, patch)
					if (!row)
						throw new HostScopeError(
							`${node.key}: no message ${id} to edit`
						)
					record(node, "message", row.id, "edited")
					await announce(row)
					await emit(
						"core:event/message-edited@1",
						{ sessionId: row.sessionId, messageId: row.id, previous },
						{ kind: "edit" }
					)
					return { id: row.id, sessionId: row.sessionId, previous }
				}

				case "core:outlet/swipe-message": {
					assertBuiltInSpec(node)
					const id = refId(p.target)
					if (id === null)
						throw new HostScopeError(
							`${node.key} was given no message id to swipe — wire 'target' from the inlet.`
						)
					const current = await legacyMessage(db, id)
					if (!current)
						throw new HostScopeError(
							`${node.key}: no message ${id} to swipe`
						)
					assertScoped(node, current.sessionId, scope.sessionId)
					await assertMayAct(node, id)
					if (current.isGenerating)
						throw new HostScopeError(
							`${node.key}: message ${id} is still being written — stop it first, or wait.`
						)
					const metadata = (current.metadata ?? {}) as Record<
						string,
						any
					>
					/**
					 * The alternatives as the row keeps them: `history` is
					 * every text, `reasoningHistory` the reasoning beside each,
					 * `currentIdx` which is showing (null until a second
					 * alternative exists — the shape the swipe handlers have
					 * always written).
					 */
					const swipes = {
						currentIdx: null as number | null,
						history: [] as string[],
						reasoningHistory: [] as (string | null)[],
						// DESIGN-sprites §3.3: each alternative keeps its own face.
						spriteHistory: [] as (ShownSprite | null)[],
						...(metadata.swipes ?? {})
					}
					const previous = {
						content: current.content,
						swipeIndex: swipes.currentIdx
					}
					let swipeIndex: number
					if (typeof p.text === "string") {
						// Record a new alternative and select it. The first
						// swipe on a row seeds the history with what the row
						// already holds, so nothing showing is lost.
						if (swipes.currentIdx === null) {
							swipes.currentIdx = 0
							swipes.history = [current.content]
							// The face the row already shows belongs to the
							// alternative it already holds.
							swipes.spriteHistory = [
								asShownSprite(metadata.sprite)
							]
						}
						while (
							swipes.reasoningHistory.length < swipes.history.length
						)
							swipes.reasoningHistory.push(null)
						while (
							swipes.spriteHistory.length < swipes.history.length
						)
							swipes.spriteHistory.push(null)
						swipes.history.push(p.text)
						swipes.reasoningHistory.push(null)
						swipes.spriteHistory.push(null)
						swipeIndex = swipes.history.length - 1
					} else {
						const index = Number(p.index)
						if (
							!Number.isInteger(index) ||
							index < 0 ||
							index >= swipes.history.length
						)
							throw new HostScopeError(
								`${node.key}: message ${id} has no alternative ${String(p.index)} to select — ` +
									`it holds ${swipes.history.length}.`
							)
						swipeIndex = index
					}
					swipes.currentIdx = swipeIndex
					const { updateLegacy } = await import(
						"$lib/server/messages/store"
					)
					const row = await updateLegacy(db, id, {
						content: swipes.history[swipeIndex] ?? "",
						metadata: {
							...metadata,
							swipes,
							// The reasoning shown follows the alternative.
							reasoning: swipes.reasoningHistory[swipeIndex] ?? null,
							// And so does the face (DESIGN-sprites §3.3).
							sprite: swipes.spriteHistory?.[swipeIndex] ?? null
						},
						// A stop belongs to the alternative that was streaming
						// (U5b review W2): selecting another one — an existing
						// alternative, or a fresh one being recorded — leaves
						// the mark behind. Staying put keeps it.
						...(swipeIndex !== previous.swipeIndex
							? { generationOutcome: null }
							: {})
					})
					if (!row)
						throw new HostScopeError(
							`${node.key}: no message ${id} to swipe`
						)
					record(node, "message", row.id, "swiped")
					await announce(row)
					await emit(
						"core:event/message-swiped@1",
						{
							sessionId: row.sessionId,
							messageId: row.id,
							previous,
							swipeIndex
						},
						{ kind: "edit" }
					)
					return {
						id: row.id,
						sessionId: row.sessionId,
						swipeIndex,
						previous
					}
				}

				case "core:outlet/branch-session": {
					assertBuiltInSpec(node)
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to branch — the run was started without a session scope`
						)
					const fromMessageId = refId(p.fromMessage)
					if (fromMessageId === null)
						throw new HostScopeError(
							`${node.key} was given no message to branch at — wire 'fromMessage' from the inlet.`
						)
					// Owner-only, re-checked at the write (C1): a branch
					// copies the whole history into a new session, unbounded
					// by any rate limit, and a guest must not grow the owner's
					// storage with sessions the owner never asked for.
					{
						const { sessionAccessFor } = await import(
							"$lib/server/messages/permissions"
						)
						const access =
							scope.userId != null
								? await sessionAccessFor(
										db,
										sessionId,
										scope.userId
									)
								: null
						if (!access?.isOwner)
							throw new HostScopeError(
								`${node.key}: only the session's owner may branch it.`
							)
					}
					const { branchSession } = await import(
						"$lib/server/sessions/branch"
					)
					const created = await branchSession(db, {
						sessionId,
						fromMessageId,
						title:
							typeof p.title === "string" && p.title.trim()
								? p.title
								: null
					})
					record(node, "session", created.id, "created")
					// On the NEW session: its first reply learns it was
					// forked, and from where. The source's history is
					// untouched, so it has nothing to be told.
					// A person's history operation, like an edit: it never
					// fires a turn (§4.6) — the branch's own recompute gives
					// the new session its order (§4.5).
					await emit(
						"core:event/session-branched@1",
						{
							sessionId: created.id,
							fromSessionId: sessionId,
							fromMessageId
						},
						{ kind: "edit" }
					)
					return { id: created.id, sessionId: created.id }
				}

				// ── The form's answer (R-15 *Forms*; U5d, 2026-09-17) ──────
				//
				// Commits an oracle's answer to a form **exactly as a click
				// would** — by making the click's fire, not by running it. The
				// commit checks the answer against the form, asks the cycle
				// caps, chooses the child's run id and **collects** the fire on
				// the scope (`fires`, W2); `runSpec` dispatches it through
				// `fireAction` — the road `sessions:fireAction` takes — as
				// the addressee, once this run's receipt is saved, outside any
				// node timeout and as this run's child. A grandchild parked at
				// review parks nothing here.
				//
				// Every outcome of the answer is a **halt**, never a throw (W1):
				// an oracle that missed the form, a form that is gone, a cap
				// that refused — each is a legible end of this run with the
				// sentence on its receipt, and a cap's refusal is receipted for
				// the would-be child as well (`refusalReceipt`, written by
				// `dispatchFires` after this run's own row — S-b), so the
				// tree's reader sees where it stopped. Only a wiring fault
				// throws.
				case "core:outlet/answer-form": {
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to answer in — the run was started without a session scope`
						)
					if (scope.userId === undefined || scope.userId === null)
						throw new HostScopeError(
							`${node.key} has no run owner to act under — the run was started without a user scope`
						)
					// Under the form-addressed inlet alone: the form this
					// answers is the one the event carried, and a document
					// entered any other way has none (validate() refuses the
					// placement; this is the same refusal at the write).
					if (
						scope.inletDefinitionId !== undefined &&
						scope.inletDefinitionId !== FORM_ADDRESSED_INLET_ID
					)
						throw new HostScopeError(
							`${node.key} (${node.definitionId}) answers a form as its addressee, and ` +
								`'${scope.specId ?? "this document"}' was entered through ` +
								`${scope.inletDefinitionId}, not ${FORM_ADDRESSED_INLET_ID} — only the ` +
								`pipeline the form-addressed event ran has a form to answer`
						)
					const messageId = refId(p.messageId)
					const blockId = typeof p.blockId === "string" ? p.blockId : null
					const addressee =
						typeof p.addressee === "string" && isParticipantRef(p.addressee)
							? p.addressee
							: null
					if (messageId === null || !blockId || !addressee)
						throw new HostScopeError(
							`${node.key} was given no form to answer — wire 'messageId', 'blockId' and ` +
								`'addressee' from the form-addressed inlet`
						)
					/** The legible end: this run halts on the sentence, and nothing fires. */
					const halted = (reason: string) => ({
						id: messageId,
						sessionId,
						halt: `${node.key}: ${reason}`
					})
					// The block, off the ROW — never off the port, whose copy
					// a reviewer or a script could have shaped.
					const { loadFormBlock } = await import("$lib/server/messages/blocks")
					const block = await loadFormBlock(db, messageId, blockId)
					if (!block)
						return halted(
							`no form '${blockId}' on message ${messageId} — it was removed before the answer arrived`
						)
					const [subject] = await db
						.select({ sessionId: schema.sessionMessages.sessionId })
						.from(schema.sessionMessages)
						.where(eq(schema.sessionMessages.id, messageId))
						.limit(1)
					assertScoped(node, subject?.sessionId, scope.sessionId)
					if (block.addressee !== addressee)
						return halted(
							`the form '${blockId}' is addressed to ${block.addressee ?? "nobody"}, not ${addressee}`
						)
					// Answered once (W7): the row says who already did.
					if (block.answered)
						return halted(
							`the form '${blockId}' was already answered by ${block.answered.by}`
						)
					// The answer against the form's schema (R-15): the oracle's
					// document, checked here before anything fires. A `form`
					// block's values are checked field by field; a `choices`
					// block's answer must name one of its options.
					const fire = formFireOf(block, p.answer)
					if (!fire) {
						const schemaText = JSON.stringify(formAnswerSchema(block))
						return halted(
							`the answer ${JSON.stringify(p.answer)} does not fit the form — its schema is ${schemaText}`
						)
					}
					if (block.kind === "form") {
						const { checkValues } = await import("@serene-pub/sdk")
						const faults = checkValues(block.fields, fire.payload)
						if (faults.length)
							return halted(
								`the answer does not fit the form — ` +
									faults.map((f) => `${f.message} (${f.fix})`).join("; ")
							)
					}
					// Which spec the fire routes to — named on the fire so a
					// refusal can be receipted against it, by the same rule
					// `fireAction` routes with (plans/31 V2): the identity the
					// block stamped, else the genre's sole declarer of its `fn`,
					// and that identity's declarer if it still serves.
					const { resolveSubjectVerdict, listGenreActions, soleDeclarer, STANDARD_GENRE_ID } =
						await import("$lib/server/pipelines/entities/sessionGenres")
					const { parseActionIdentity, actionIdentity } = await import(
						"$lib/shared/actions/identity"
					)
					const [session] = await db
						.select({ genreId: schema.sessions.genreId })
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					const genreId = session?.genreId ?? STANDARD_GENRE_ID
					let identity = fire.action ?? null
					if (!identity) {
						const sole = soleDeclarer(await listGenreActions(db, genreId), fire.fn)
						if (!sole)
							return halted(
								`the form's '${fire.fn}' names no single action of this session's genre — ` +
									`a block fires a declared action or nothing`
							)
						identity = actionIdentity(sole)
					}
					const routed = await resolveSubjectVerdict(db, genreId, identity, {
						sessionId,
						spec: parseActionIdentity(identity)?.specSlug ?? null
					})
					if (!routed.spec)
						return halted(`nothing serves '${identity}' for this session's genre`)
					const childRunId = randomUUID()
					const pending: PendingFire = {
						runId: childRunId,
						specId: routed.spec,
						action: identity,
						messageId,
						blockId,
						payload: fire.payload,
						as: addressee
					}
					// The cycle caps, asked at the door (01 §8; W1): a refusal
					// halts this run on the cap, and the would-be child's row —
					// lineage filled, the routed spec named — is written by
					// `dispatchFires` after this run's receipt (S-b), so the
					// parent's row lands before the child's. The commit only
					// records the refusal on the fire.
					if (scope.runId) {
						const { childLineage, admitDescendant } = await import(
							"$lib/server/pipelines/runtime/lineage"
						)
						const lineage = childLineage({ runId: scope.runId, lineage: scope.lineage })
						const cap = admitDescendant(lineage)
						if (cap) {
							scope.fires?.push({ ...pending, refused: cap })
							return halted(cap)
						}
					}
					scope.fires?.push(pending)
					return {
						id: messageId,
						sessionId,
						answer: fire.payload,
						firedAction: identity,
						firedRunId: childRunId
					}
				}

				// Attachments (20 §1): bytes into the session's asset store,
				// a typed part onto the message — never bytes in a row, never
				// a foreign URL. Both consumers are gate-eligible (`effects:
				// 'write'`; attach-image even defaults review ON, F14's proof
				// case), so what the reviewer approves is what lands.
				case "core:outlet/attach-image":
				case "core:outlet/attach-audio": {
					const media = (p.image ?? p.audio ?? p) as Record<
						string,
						any
					>
					/**
					 * The row, read as `update-message` reads its own
					 * `target` one case up: a row id from the inlet, or the
					 * write result of an earlier outlet in this run — the
					 * reply's placeholder, whose `ids.id` is a row id by the
					 * time this node runs (R-17). The media reference's own
					 * `messageId` still answers for a caller outside the graph.
					 */
					const targetRef = p.target
					const messageId =
						refId(media.messageId ?? p.messageId) ??
						refId(
							targetRef && typeof targetRef === "object" && "ids" in targetRef
								? (targetRef as { ids?: { id?: unknown } }).ids?.id
								: targetRef
						)
					if (messageId === null)
						throw new HostScopeError(
							`${node.key} was given no message id to attach to — wire 'target' from the ` +
								`inlet's row id, or from the outlet that created the row.`
						)
					// A REFERENCE first, bytes only as the legacy path.
					//
					// `media.ts` is explicit that media travels as a reference and
					// never as bytes, and everything that produces media in a run
					// now stores it and passes a uuid. A base64 payload is still
					// accepted because a caller outside the graph may genuinely
					// have only bytes — but it is the fallback, not the contract.
					const uuid =
						typeof media.uuid === "string" ? media.uuid : null
					const b64 =
						typeof media.data === "string" ? media.data : null
					if (!uuid && !b64)
						throw new HostScopeError(
							`${node.key} was given neither a media reference ('uuid') nor bytes ('data').`
						)
					const { getMessage, appendParts } = await import(
						"$lib/server/messages/store"
					)
					const target = await getMessage(db, messageId)
					if (!target)
						throw new HostScopeError(
							`${node.key}: no message ${messageId} to attach to`
						)
					assertScoped(node, target.sessionId, scope.sessionId)
					const isImage = node.definitionId.includes("attach-image")

					let asset: { id: number; mime: string }
					if (uuid) {
						const [found] = await mediaParts(
							db,
							[media],
							target.sessionId,
							scope,
							node
						)
						if (!found)
							throw new HostScopeError(
								`${node.key}: no media ${uuid} to attach`
							)
						await appendParts(db, messageId, [found as any])
						// The file already existed — this run attached it — and
						// the message it landed on changed.
						record(node, "file", found.data.assetId, "attached")
						record(node, "message", messageId, "updated")
						// The write-result's `id` is the MESSAGE row on both
						// paths (ruled at the U6 review): it is what a later
						// `target: $.attach.main` chains to. The asset rides
						// under its own key.
						return {
							id: messageId,
							messageId,
							assetId: found.data.assetId,
							sessionId: target.sessionId
						}
					}

					const { createSessionAsset } = await import(
						"$lib/server/messages/assets"
					)
					const stored = await createSessionAsset(db, {
						sessionId: target.sessionId,
						bytes: Buffer.from(b64!, "base64"),
						mime:
							typeof media.mime === "string"
								? media.mime
								: isImage
									? "image/png"
									: "application/octet-stream",
						createdBy: scope.userId ?? null
					})
					// A part addresses the FILE and records the display variant's
					// mime — same rule as `mediaParts` above, and for the same
					// reason: what a part stores must not be a fact about one
					// stored representation, because that representation can be
					// culled or re-pointed under it.
					record(node, "file", stored.file.id, "created")
					record(node, "variant", stored.original.id, "created")
					asset = {
						id: stored.file.id,
						// The projection is always written; the fallback is the
						// row it was projected from, already in hand here.
						mime: stored.file.displayMime ?? stored.original.mime
					}
					// The same part writer as every other path
					// (`attachments/partData`): the stored file's width,
					// height, name and size ride on the part.
					const { mediaPartFor } = await import(
						"$lib/server/attachments/partData"
					)
					await appendParts(db, messageId, [
						mediaPartFor(stored.file, {
							as: isImage ? "image" : "file",
							alt: media.alt ? String(media.alt) : null,
							name: media.name ? String(media.name) : null,
							mime: asset.mime
						}) as any
					])
					record(node, "message", messageId, "updated")
					// The message row as `id` here too — see the reference
					// path above — with the asset it stored under `assetId`.
					return {
						id: messageId,
						messageId,
						assetId: asset.id,
						sessionId: target.sessionId
					}
				}

				case "core:outlet/create-lore-entry": {
					/**
					 * The finished summary, written as a lore entry.
					 *
					 * Which *kind* of entry comes from the pipeline that ran,
					 * and since L3 (2026-09-17) that is finally true: the
					 * `entryType` param says which, and an unknown id is
					 * refused rather than filed as world lore. The four
					 * summarize namespaces still exist so the *press* decides
					 * which pipeline runs; this is that decision reaching the
					 * row.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to write a lore entry for — the run was started without a session scope`
						)

					const [session] = await db
						.select()
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)

					/**
					 * Declared writes (R-B): a genre whose lorebook is a
					 * *reference* writes nothing into it, whatever spec is
					 * bound here. This is the only pipeline outlet that
					 * writes lore, so it is the only place the law needs
					 * stating — and it is stated at the write rather than by
					 * hiding the affordance, because the affordance is not
					 * what a user-attached pipeline goes through.
					 *
					 * Before the lorebook check: "this genre never writes
					 * here" is true whether or not a book is attached, and
					 * telling somebody to attach one would send them to a
					 * screen that cannot help.
					 */
					// The genre's declared writes, then the book owner's lore
					// write mode: Off refuses the write (plan A22). Review
					// changes writes: this outlet is reviewed only when the
					// spec parks it (`settings.review`), which the mode cannot
					// force.
					const noLore =
						(await loreWriteRefusal(db, sessionId)) ??
						(await loreWritesOffRefusal(db, sessionId))
					if (noLore) throw new HostScopeError(`${node.key}: ${noLore}`)

					if (!session?.lorebookId)
						throw new HostScopeError(
							`${node.key}: this session has no lorebook, so there is nowhere to save the summary. Read one into this session first.`
						)

					const name = String(p.name ?? "").trim() || "Untitled"
					const content = String(p.content ?? "")

					/**
					 * Which kind of entry this pipeline writes (L3).
					 *
					 * Refused and never coerced: a typo that silently files
					 * rooms as world lore is the defect this replaces, and the
					 * refusal names the declared types so the fix is in the
					 * sentence. Absent is world lore, the agnostic shape, so
					 * every spec written before the param keeps doing exactly
					 * what it did.
					 */
					const typeId =
						String(p.params?.entryType ?? "").trim() ||
						WORLD_LORE_TYPE_ID
					if (!isEntryTypeId(typeId))
						throw new HostScopeError(
							`${node.key}: '${typeId}' is not a declared entry type, so there is nothing to file this under. The declared types are ${ENTRY_TYPE_IDS.join(", ")}.`
						)

					/**
					 * ⚠ `position` is allocated rather than left at the old
					 * column default of `0`.
					 *
					 * It is unique per `(lorebook_id, type_id)` on the unified
					 * table, so the second summary written into a lorebook
					 * would collide on `0` instead of landing beside the
					 * first. The allocator is the socket handlers' — first free
					 * slot from 1 — under the same advisory lock, so a summary
					 * written while somebody is adding an entry by hand cannot
					 * race it.
					 */
					const lorebookId = session.lorebookId
					/**
					 * The links, in the SAME transaction as the row (L2).
					 *
					 * `core:outlet/link-lore-entries@1` may follow this outlet
					 * (F7 limits only the live row), but that is a second
					 * transaction. Writing them together is the honest shape
					 * when they are one thought: a room whose exits
					 * name an entry that is not there fails **with** the room
					 * rather than leaving half a room behind, because the
					 * refusal is raised inside the transaction.
					 */
					const links = loreLinkRequests(p.links)
					// The session's line, read before the transaction (only
					// `tx` inside it): the entry and its links are that
					// line's own, never main's by omission (finding #0).
					const line = await loreWriteLineOf(db, sessionId, lorebookId)
					const { row, linkIds, madeLinkIds } = await db.transaction(
						async (tx) => {
							await tx.execute(
								sql`select pg_advisory_xact_lock(${lorebookId})`
							)
							const [created] = await tx
								.insert(schema.lorebookEntries)
								.values(
									entryInsert(
										{
											typeId,
											lorebookId,
											name,
											content,
											branchId: line.branchId,
											position: await nextPosition(
												tx,
												lorebookId,
												typeId
											)
										},
										// A pipeline wrote it, never a person: the
										// rail's machine-written scope counts it.
										{ provenance: "pipeline" }
									)
								)
								.returning()
							const ids: number[] = []
							// The rows THIS write made. A link the list states
							// twice is found the second time (`written: false`),
							// and is the run's once, not twice.
							const made: number[] = []
							for (const link of links) {
								const wrote = await writeLoreLink(
									tx,
									lorebookId,
									created!.id,
									link,
									node.key,
									line
								)
								ids.push(wrote.id)
								if (wrote.written) made.push(wrote.id)
							}
							return { row: created!, linkIds: ids, madeLinkIds: made }
						}
					)
					// The run's book read (C4) predates this entry: a later
					// read in the same run must see it.
					lorebookReads.clear()
					// Invisible to the run until now: a summarize pipeline wrote
					// an entry and the run row said it had produced nothing.
					record(node, "lore_entry", row.id, "created")
					for (const id of madeLinkIds)
						record(node, "lore_link", id, "created")
					// `linkIds` is one id per requested link, in order: a
					// repeated link names the row it repeated.
					return {
						id: row.id,
						lorebookId,
						...(linkIds.length ? { linkIds } : {})
					}
				}

				case "core:outlet/link-lore-entries": {
					/**
					 * One link between two entries of this session's lorebook
					 * (L2, 2026-09-17) — a room's exit, who keeps what, what
					 * stands near what.
					 *
					 * The same session scoping, the same lorebook and the same
					 * `writes.lore` refusal as the entry write beside it: a
					 * link is a change to the book, so a genre whose lorebook
					 * is a *reference* writes none, whatever spec is bound
					 * here. Stated at the write rather than by hiding the
					 * affordance, because the affordance is not what a
					 * user-attached pipeline goes through.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to link lore in — the run was started without a session scope`
						)

					// The genre's declared writes, then the book owner's lore
					// write mode: Off refuses the write (plan A22). Review
					// changes writes: this outlet is reviewed only when the
					// spec parks it (`settings.review`), which the mode cannot
					// force.
					const noLore =
						(await loreWriteRefusal(db, sessionId)) ??
						(await loreWritesOffRefusal(db, sessionId))
					if (noLore) throw new HostScopeError(`${node.key}: ${noLore}`)

					const [session] = await db
						.select()
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					if (!session?.lorebookId)
						throw new HostScopeError(
							`${node.key}: this session has no lorebook, so there is nothing to link. Read one into this session first.`
						)

					const lorebookId = session.lorebookId
					const line = await loreWriteLineOf(db, sessionId, lorebookId)
					// Both ends under the book's own lock, for the reason the
					// entry write takes it: an end resolved by name must not be
					// renumbered or renamed out from under the insert — and the
					// standing-row lookup must not race a second run's insert.
					const { fromId, link } = await db.transaction(
						async (tx) => {
							await tx.execute(
								sql`select pg_advisory_xact_lock(${lorebookId})`
							)
							const from = await resolveLoreLinkEnd(
								tx,
								lorebookId,
								p.from,
								node.key,
								line.reading
							)
							return {
								fromId: from,
								link: await writeLoreLink(
									tx,
									lorebookId,
									from,
									{
										to: p.to,
										linkType: p.params?.linkType,
										reverseLinkType: p.params?.reverseLinkType,
										name: p.name,
										description: p.description
									},
									node.key,
									line
								)
							}
						}
					)
					/**
					 * Idempotent (places plan B2): a link the session already
					 * reads answers with the standing row's id, and it is not
					 * this run's — no artifact (an undo must never delete it)
					 * and `written: false`, so the executor causes no
					 * `lore-link-created`: nothing was linked. `fromEntryId` is
					 * the row's own: on a mirror, the far end.
					 */
					if (!link.written)
						return {
							id: link.id,
							fromEntryId: link.fromEntryId,
							lorebookId,
							written: false
						}
					record(node, "lore_link", link.id, "created")
					return { id: link.id, fromEntryId: fromId, lorebookId }
				}

				case "core:outlet/graph-proposal": {
					/**
					 * A proposal, and deliberately nothing more.
					 *
					 * The build stops here. Applying it is a person's decision on
					 * the Review Proposal screen, and this returning a proposal id
					 * rather than node ids is what makes that structural: nothing
					 * downstream can mistake it for rows that exist.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to propose graph changes for`
						)
					return {
						status: "proposed",
						sessionId,
						proposal: p.proposal ?? null
					}
				}

				/**
				 * ⚠ `embedding_status` is a **read**, not a commit. It is answered
				 * by the `read` switch above — search for the other
				 * `case "embedding_status"` — and that is the block the four
				 * `ctx.read("embedding_status", …)` sites in `bindings.ts` reach.
				 *
				 * A second copy sat here until it was deleted, and it was
				 * unreachable: this switch is on `node.typeId`, whose labels are
				 * namespaced type ids, and no node definition is named
				 * `embedding_status`. Being unreachable, it was also free to be
				 * wrong, and was — it read a `localModel` column
				 * `vectorization_configs` has never had, which would have called
				 * every local-mode install unconfigured. Do not re-add it: the live
				 * block answers "is a backend loaded and validated *right now*",
				 * and deriving that from configuration instead would report
				 * available on a configured-but-cold install while
				 * `core:oracle/embed-text` still throws.
				 */
				default:
					throw new HostScopeError(
						`${node.key} (${node.definitionId}) has no commit path in core. A Consumer that core ` +
							`cannot perform is one a user could add to a pipeline and watch fail at run time.`
					)
			}
		}
	}

	/**
	 * No failed query's text leaves the host (`db/errors.ts`).
	 *
	 * The executor keeps only a thrown error's `message`, and that message
	 * becomes the node's reason, the run's `haltReason`, the reply row's error
	 * (`LiveRow` → `persistGenerationErrorRow`, shown to every member of the
	 * session), a `reply-failed` notification and a plugin binding's view of
	 * the failure. Since drizzle-orm 0.44 a failed query's message is its SQL
	 * and every value it bound, so a query that fails under `read`, `call` or
	 * `commit` leaves here as the plain sentence (a wrapper's own words kept),
	 * and the whole error goes to the server log. Every other error passes
	 * through as the same object, so no class a caller checks is lost.
	 *
	 * The generate road records the raw error on the live row BEFORE this
	 * (`scope.live?.failedWith`), so the row's error write still reads the
	 * class — `friendlyErrorFromUnknown` answers a failed query itself.
	 */
	const plain = (e: unknown, node: NodeRef): unknown => {
		const safe = errorWithoutQueryText(e)
		if (safe !== e)
			console.error(
				`[pipelines] ${node.key} (${node.definitionId}): a query failed; the run reads the plain sentence. It was:`,
				e
			)
		return safe
	}
	const { read, call, commit } = host
	host.read = async (table, query, node) => {
		try {
			return await read!.call(host, table, query, node)
		} catch (e) {
			throw plain(e, node)
		}
	}
	host.call = async (payload, node, run, handles) => {
		try {
			// `handles` forwarded: dropping them here would cut every
			// request off from its node's clock (`callTether`).
			return await call!.call(host, payload, node, run, handles)
		} catch (e) {
			throw plain(e, node)
		}
	}
	host.commit = async (payload, node) => {
		try {
			return await commit!.call(host, payload, node)
		} catch (e) {
			throw plain(e, node)
		}
	}
	return host
}

/**
 * The row shape a Query publishes.
 *
 * Deliberately narrow: a binding gets what a prompt needs, not the whole row.
 * `queueItemId`, `embedding` and `debugMeta` have no business reaching a plugin
 * that asked for session history, and the cheapest way to guarantee that is to
 * never put them in the value (F30).
 */
/** What leaves the host for one hit: an id, a score and the text. */
function toCandidate(item: any) {
	return {
		id: item.id,
		source: item.source,
		score: item.score,
		name: item.name ?? null,
		content: textOf(item),
		lorebookId: item.lorebookId ?? null,
		priority: item.priority ?? 1
	}
}

/**
 * The hit's text, whichever column its source keeps it in.
 *
 * `content` is not universal across `ScopedRagItem`: a graph node keeps its
 * text in `summary`, a relationship in `description`, and so do a character and
 * a persona. Reading `content` alone published all four with an empty string —
 * which the vector mechanism then costed at zero tokens, so they took result slots
 * and carried nothing into the prompt.
 *
 * A coalesce and not a wider projection: the row's other exclusive fields
 * (`year`, `fromNodeId`, `status`, `reason`) still do not cross the edge,
 * because nothing downstream reads them off a vector hit.
 */
function textOf(item: any): string {
	return item.content ?? item.summary ?? item.description ?? ""
}

/** Cosine similarity, host-side, so no embedding reaches a data edge. */
function cosine(a?: number[], b?: number[]): number {
	if (!a || !b) return 0
	let dot = 0
	let na = 0
	let nb = 0
	for (let i = 0; i < a.length; i++) {
		const x = a[i] ?? 0
		const y = b[i] ?? 0
		dot += x * y
		na += x * x
		nb += y * y
	}
	if (na === 0 || nb === 0) return 0
	return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function toMessage(r: any, shaping?: ChannelShaping | null) {
	const channel = r.channel ?? DEFAULT_CHANNEL
	/**
	 * How this row's channel enters a prompt (R-C, 2026-09-17), when its genre
	 * says anything about it.
	 *
	 * ⚠ **Absent unless the genre shapes channels**, and that is deliberate:
	 * `channelShapingOf` answers `null` for every genre that lists only bare
	 * slugs, so a row read for a pre-R-C session is byte-identical to the row
	 * that was read before this existed — no key, not a key holding the
	 * default. The assembled prompt cannot drift for a genre that declared
	 * nothing, because there is nothing new on the row to read.
	 */
	const shape = shaping?.get(parseChannel(channel).slug)
	return {
		id: r.id,
		role: r.role,
		content: r.content,
		characterId: r.characterId ?? null,
		personaId: r.personaId ?? null,
		isNarratorResponse: r.isNarratorResponse,
		// Who voiced it, when a row says so by reference (`envoy:<slug>`) —
		// the turn rules read it (an envoy's reply has no character id). Only
		// when present, so every other row reads exactly as it did.
		...(typeof r.metadata?.speaker === "string" ? { speaker: r.metadata.speaker } : {}),
		// Which lane it came from, carried rather than dropped (20 §7). A read
		// is scoped to one channel, but a whole-channel read spans that
		// channel's lanes (ruling 2026-09-09), so this is what tells the five
		// private conversations under one slug apart without a second read.
		channel,
		...(shape ? { channelRole: shape.role } : {}),
		...(shape?.voice ? { channelVoice: shape.voice } : {}),
		// Whose line a person's own row is, when no persona says so — the
		// prompt names it after the member (lair pass B11). Only then, so a
		// persona's row reads exactly as it did.
		...(r.role === "user" && !r.personaId && r.userId != null
			? { userId: r.userId }
			: {}),
		// 🚧 The turns a planner's row plans (Lair character turns): what the
		// narrator strategy and `turn-plan@1` read. Only on such a row.
		...(r.metadata?.turnPlan && typeof r.metadata.turnPlan === "object"
			? { turnPlan: r.metadata.turnPlan }
			: {}),
		// A stopped row ends a standing turn plan (R34). Only when stopped.
		...(r.generationOutcome === "stopped" ? { stopped: true } : {}),
		createdAt: r.createdAt
	}
}

/**
 * A lore entry, narrowed to what retrieval and scoring need.
 *
 * `embedding` is deliberately absent: it is a large float array, it would
 * travel through every data edge and land in every receipt, and nothing
 * downstream of the vector search has any use for it. Vector similarity is
 * computed during retrieval and arrives as a score.
 */
/**
 * Bindings with the card each one names.
 *
 * `populateLorebookEntryBindings` reads `binding.character` to resolve
 * `{{char:1}}` into a name, and the binding rows carry only ids — so without
 * this the substitution silently does nothing, which is the failure it is being
 * wired in to fix. Two queries rather than a join per binding: a lorebook has a
 * handful of bindings and this runs once per read.
 *
 * A deleted card is nobody in a lorebook (plan A25): its member reads as their
 * own name, as a member with no card does (`character` null).
 */
async function hydrateBindings(db: Db, bindings: any[]): Promise<any[]> {
	const characterIds = [
		...new Set(bindings.map((b) => b.characterId).filter(Boolean))
	]

	const characters = characterIds.length
		? await db
				.select()
				.from(schema.characters)
				.where(
					and(
						inArray(schema.characters.id, characterIds),
						eq(schema.characters.isDeleted, false)
					)
				)
		: []

	const byCharacter = new Map(characters.map((c) => [c.id, c]))

	return bindings.map((b) => ({
		...b,
		character: b.characterId
			? (byCharacter.get(b.characterId) ?? null)
			: null
	}))
}

function toLoreEntry(
	row: any,
	source: "worldLore" | "characterLore" | "history",
	/**
	 * The character this entry's binding names, already resolved.
	 *
	 * Read by character lore's co-occurrence signal, which asks whether that
	 * character spoke recently — see `speakerCooccurrenceSignal`. Null for
	 * every entry that is not a character's.
	 */
	bindingCharacterId: number | null = null,
	/**
	 * The name of the cast member an anchored entry is bound to, as the
	 * session's reading has them — what Assemble's `characterLore` prints
	 * beside the entry. Null for an entry of an unanchored type, or bound to
	 * nobody.
	 */
	castMember: string | null = null,
	/**
	 * What this entry said when the run read it — `entrySourceHash` over the
	 * **stored** title, keys and content (16 §7c).
	 *
	 * Sixteen characters, computed once at the one read every mechanism shares, and
	 * carried from here into each candidate's `payload` and so into the
	 * receipt. That is the whole mechanism: a receipt records *what it decided*
	 * and never the text it decided about, so the explanation panel reads the
	 * live rows for titles and keys — and a rename after the run renders the
	 * new title against the old decision, silently. The fingerprint is what
	 * lets the panel tell those apart without storing a second copy of
	 * anybody's lore.
	 *
	 * Passed in rather than computed here because this function is handed the
	 * *hydrated* entry — bindings substituted, decorators stripped — and the
	 * fingerprint is over the stored row, which is the only shape the panel
	 * can recompute later. See `entrySourceHash`.
	 */
	fingerprint?: string
) {
	return {
		id: row.id,
		source,
		fingerprint,
		name: row.name ?? null,
		content: row.content ?? "",
		keys: row.keys ?? [],
		caseSensitive: row.caseSensitive ?? false,
		useRegex: row.useRegex ?? false,
		matchMode: row.matchMode ?? null,
		// `?? null` for the mode and `?? []` for the keys, because the two
		// absences mean the same thing and the matcher tests both: no mode is
		// no condition, and no condition keys is no condition either. A list,
		// never joined (finding #146).
		secondaryKeys: row.secondaryKeys ?? [],
		selectiveLogic: row.selectiveLogic ?? null,
		// `?? null` and not `?? 0`, because null is a value here: it means the
		// entry has no opinion and the node's ceiling decides. Coalescing to
		// zero would pin every untouched entry to "conversation only" and make
		// turning recursion on do nothing.
		recursionDepth: row.recursionDepth ?? null,
		priority: row.priority ?? 1,
		constant: row.constant ?? false,
		enabled: row.enabled ?? true,
		// Carried so a mechanism can exclude it (L1): this mapper is a column
		// whitelist, and a scoping column it drops fails OPEN — the archived
		// entry reached ranking as though it were live.
		archived: row.archived ?? false,
		position: row.position ?? 0,
		lorebookBindingId: row.lorebookBindingId ?? null,
		bindingCharacterId,
		castMember,
		/** History entries only; used for the recency signal. */
		year: row.year ?? null,
		month: row.month ?? null,
		day: row.day ?? null
	}
}
