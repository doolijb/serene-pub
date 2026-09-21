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

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	BINDING_VISIBILITY_POLICY,
	DEFAULT_VECTOR_NAME,
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
	FORM_ADDRESSED_INLET_ID,
	assignBlockHead,
	assignBlockIds,
	checkMessageBlocks,
	foreignBlockActions,
	formBlocksOf,
	formFireOf,
	formAnswerSchema,
	stampBlockActions,
	undeclaredBlockFunctions,
	effectsLineVerdict,
	i18nText
} from "@serene-pub/sdk"
import { randomUUID } from "node:crypto"
import { CORE_BLOCKS_PART } from "$lib/server/messages/blocks"
import { loreWriteRefusal } from "$lib/server/messages/writes"
import { slotModelId } from "$lib/shared/connections/slotRef"
import type { RunProgress } from "$lib/shared/sockets/progress"
import type { RunArtifact } from "$lib/server/pipelines/runtime/receipts"
import { participantRowId } from "$lib/server/pipelines/runtime/portrayals"
import { resolvePersonaName } from "$lib/shared/utils/resolveCharacterName"
import { streamingModeFrom } from "$lib/server/connections/streaming"
import type { LiveRow, SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import type { StatusRelay } from "$lib/server/pipelines/runtime/runStatus"
import { broadcastToSessionUsers } from "$lib/server/sockets/utils/broadcastHelpers"
import {
	recordSessionChange,
	speakerRefOf
} from "$lib/server/messages/sessionChanges"
import {
	DEFAULT_CHANNEL,
	DEFAULT_LANE,
	byLaneThenTime,
	canonicalChannel,
	channelRefusal,
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
	/** Who triggered the run, for authorship on writes. */
	userId?: number
	/**
	 * A message being composed but not yet stored.
	 *
	 * The draft preview (`sessions:promptTokenCount`) fires on a debounce while
	 * somebody types, so the text it is previewing is deliberately not a row.
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
	 * `regenerate`, a `swipe`'s fresh alternative or a `continue` (R-15,
	 * 2026-09-16). Read by `update-message` at the finishing write so the
	 * `message-updated` it emits says which verb rewrote the row, and the
	 * next reply's inlet sees the rewrite in its `sessionChanges`. Absent on a
	 * fresh turn, whose finishing write changes no history a pipeline has
	 * seen.
	 */
	verb?: "regenerate" | "swipe" | "continue"
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
	 * it; a continue replaces nothing.
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
	 */
	answersForm?: { messageId: number; blockId: string }
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
	 * Where this run stands in a tree of runs (01 §8; U5d) — absent for a
	 * root. Read by `answer-form`, whose fire is this run's child.
	 */
	lineage?: RunLineage
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
		onThinking?: (chunk: string) => void
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
 * The narrator's display name for a session, snapshotted onto a narration row
 * at the write so a later rename does not relabel messages already made.
 *
 * The session's own override (Edit Session) wins, else the instance default —
 * the same chain `resolveNarratorPromptConfig` walks with the retired user
 * layer removed. Read through the run's `db` rather than the global one, for
 * the reason every host read is: a run against another database must not
 * quietly read this from the application's.
 */
export async function narratorNameFor(
	db: Db,
	sessionId: number,
	_userId: number | undefined
): Promise<string | null> {
	const [session] = await db
		.select({
			narratorPromptConfigId: schema.sessions.narratorPromptConfigId
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	let configId = session?.narratorPromptConfigId ?? null
	if (configId == null) {
		const [system] = await db
			.select({
				defaultNarratorPromptConfigId:
					schema.systemSettings.defaultNarratorPromptConfigId
			})
			.from(schema.systemSettings)
			.limit(1)
		configId = system?.defaultNarratorPromptConfigId ?? null
	}
	if (configId == null) return null
	const [config] = await db
		.select({ narratorName: schema.narratorPromptConfigs.narratorName })
		.from(schema.narratorPromptConfigs)
		.where(eq(schema.narratorPromptConfigs.id, configId))
		.limit(1)
	return config?.narratorName ?? null
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
		// Recurses rather than restating a narrower rule. The branch above
		// already accepts a numeric string; this one used to demand a number,
		// and the executor hands back `{id}` where the id is a STRING — so every
		// resolved slot became null here, in the one function whose whole job is
		// to read one.
		return refId((v as any).ref ?? (v as any).id)
	}
	return null
}

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
const loreVisibilitySubject = (q: Record<string, any>): number | null => {
	const ref = q.speaker
	// Absent, null, or an empty string: the port is unwired (or wired to a
	// node that published nothing this turn), and the scope decides as it
	// always did.
	if (ref === undefined || ref === null || ref === "") return q.currentCharacterId ?? null
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
				`${allowed ?? "no session"}. A pipeline may only read the session it was triggered in.`
		)
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
 * Deliberately not emitted at all when there was nothing to index: a note per
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

		const ownedHere =
			(row.sessionId != null && row.sessionId === sessionId) ||
			(scope.userId != null && row.userId === scope.userId)
		if (!ownedHere)
			throw new HostScopeError(
				`${node.key} (${node.definitionId}) tried to post media ${uuid}, which belongs ` +
					`to neither this session nor the user this run is acting as.`
			)

		const alt = (ref as Record<string, any>)?.text
		parts.push(
			row.kind === "image"
				? {
						type: "core:image",
						data: {
							assetId: row.id,
							...(alt ? { alt: String(alt) } : {})
						}
					}
				: {
						type: "core:file",
						data: {
							assetId: row.id,
							// The display variant's mime,
							// denormalised onto the file so this
							// stays one query. Null would mean a
							// file with no display pointer, which
							// `createMedia` never leaves behind.
							mime: row.displayMime ?? "application/octet-stream",
							...(row.filename ? { name: row.filename } : {})
						}
					}
		)
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
 * A name is the half that makes the one-write law survivable: F7 allows one
 * write-class outlet per pipeline, so a run that creates a room cannot also
 * link it, and the *next* run has only the name to go on. It is also the half
 * that can be wrong in two ways, and both are refused with a sentence rather
 * than repaired:
 *
 *  · **Nothing answers to it.** Creating the missing entry here would make a
 *    link outlet a second entry writer, which is the write law again with the
 *    name changed.
 *  · **Two entries answer to it.** Picking one would link the wrong room, and
 *    it would do it silently — a duplicate name is the author's to resolve,
 *    and the refusal is what tells them it exists.
 *
 * Case and surrounding space are ignored, which is the one normalisation the
 * app already performs on a link's own type (`entries:counts`). One lorebook,
 * both ends: an edge whose ends live in two books belongs to neither and the
 * row carries one `lorebook_id`, so a cross-book end is refused exactly as the
 * socket handlers refuse one — held again here because a pipeline does not
 * come through them.
 */
async function resolveLoreLinkEnd(
	tx: Db,
	lorebookId: number,
	raw: unknown,
	where: string
): Promise<number> {
	const id = linkEndId(raw)
	if (id !== null) {
		const [row] = await tx
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.id, id),
					eq(schema.lorebookEntries.lorebookId, lorebookId)
				)
			)
			.limit(1)
		if (!row)
			throw new HostScopeError(
				`${where}: entry ${id} is not in this session's lorebook, so there is nothing here to link it to. Both ends of a link live in one book.`
			)
		return row.id
	}
	const name = typeof raw === "string" ? raw.trim() : ""
	if (!name)
		throw new HostScopeError(
			`${where}: there is nothing to link to — wire an entry id, the write result of the entry that made it, or the name of an entry in this session's lorebook.`
		)
	const matches = await tx
		.select({
			id: schema.lorebookEntries.id,
			title: schema.lorebookEntries.title
		})
		.from(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, lorebookId),
				sql`lower(trim(${schema.lorebookEntries.title})) = ${name.toLowerCase()}`
			)
		)
		.orderBy(asc(schema.lorebookEntries.id))
		.limit(2)
	if (!matches.length)
		throw new HostScopeError(
			`${where}: no entry in this session's lorebook is called “${name}”. Write it first — a link outlet never creates the entry it names.`
		)
	if (matches.length > 1)
		throw new HostScopeError(
			`${where}: “${name}” is the name of more than one entry in this session's lorebook, and picking one would link the wrong one silently. Rename one of them, or wire the entry's id.`
		)
	return matches[0]!.id
}

/** One link a spec asked for, taken apart. */
interface LoreLinkRequest {
	to: unknown
	linkType?: unknown
	label?: unknown
}

/**
 * The links an outlet was handed: a list of names, ids, or
 * `{ to, linkType?, label? }`. Anything that is not a list is none, and an
 * entry with no `to` is dropped here so the refusal below names the wiring
 * rather than an empty object.
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
					? { to: o.to, linkType: o.linkType, label: o.label }
					: { to: o }
			)
		} else out.push({ to: item })
	}
	return out
}

/**
 * The kind of link a row carries when nothing said.
 *
 * `leads to` is a **travel** kind (`TRAVEL_LINK_TYPES`), which is the one set
 * anything reads semantically: it is what turns a pair of entries into a place
 * you can walk between. Free text in the row and free text here — the app's
 * list is a vocabulary of suggestions, never a constraint.
 */
const DEFAULT_LORE_LINK_TYPE = "leads to"

/** Write one lore link. Returns the row's id. */
async function writeLoreLink(
	tx: Db,
	lorebookId: number,
	fromEntryId: number,
	req: LoreLinkRequest,
	where: string
): Promise<number> {
	const toEntryId = await resolveLoreLinkEnd(tx, lorebookId, req.to, where)
	const linkType =
		(typeof req.linkType === "string" ? req.linkType.trim() : "") ||
		DEFAULT_LORE_LINK_TYPE
	const label = typeof req.label === "string" ? req.label.trim() : ""
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
			description: label
		})
		.returning({ id: schema.narrativeRelationships.id })
	return row!.id
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

export function createHost(db: Db, scope: HostScope = {}): CoreHostServices {
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
	 * a click, as a form put to a person does. An addressed form whose
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
			if (!form.addressee || !form.id) continue
			const who = scope.portrayals?.[form.addressee]
			if (who?.by !== "ai") continue
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
					 * - a **continue** keeps its partial text on the row, so the
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
					const rows = await db
						.select()
						.from(schema.sessionMessages)
						.where(
							and(
								eq(schema.sessionMessages.sessionId, sessionId),
								eq(schema.sessionMessages.isHidden, false),
								eq(schema.sessionMessages.isGenerating, false),
								channelWhere(
									schema.sessionMessages.channel,
									channel
								)
							)
						)
						.orderBy(desc(schema.sessionMessages.id))
						.limit(Math.min(q.limit ?? 100, 500))

					// Reversed after a descending limit: "the most recent N, in
					// reading order" is what every caller wants, and doing it here
					// means no binding has to remember which end it got.
					const ordered = rows.reverse()
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
							(m.role === "user" ? "User" : "Unknown")
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
						)
					]
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
					if (typeof q.name === "string" && q.name.trim() !== "")
						wheres.push(
							sql`lower(btrim(${schema.lorebookEntries.title})) = ${q.name.trim().toLowerCase()}`
						)
					if (typeof q.enabled === "boolean")
						wheres.push(
							eq(schema.lorebookEntries.enabled, q.enabled)
						)
					if (typeof q.archived === "boolean")
						wheres.push(
							eq(schema.lorebookEntries.archived, q.archived)
						)

					/**
					 * One scan of one table, where three used to be.
					 *
					 * Ordered by id because the three scans it replaces had no
					 * `ORDER BY` at all and a single scan interleaves the
					 * types: partitioning in memory preserves whatever order
					 * the heap gave, which is arbitrary in both shapes. Id
					 * order is the one deterministic choice that agrees with
					 * the old arbitrary one wherever the old one was stable.
					 */
					const scan = db
						.select()
						.from(schema.lorebookEntries)
						.where(and(...wheres))
						.orderBy(asc(schema.lorebookEntries.id))
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
					const rows = await (typeof q.limit === "number"
						? scan.limit(q.limit)
						: scan)

					/**
					 * Which entries have a usable vector — the ids, not the
					 * vectors.
					 *
					 * The legacy shape carried `embedding` on the row itself
					 * and `toLoreEntry` reduced it to a boolean immediately.
					 * Now that vectors live in their own table, fetching them
					 * to answer the same boolean would pull every float in the
					 * lorebook across on every turn.
					 */
					const vectored = new Set<number>(
						(
							await db
								.select({
									entryId: schema.lorebookEntryVectors.entryId
								})
								.from(schema.lorebookEntryVectors)
								.where(
									and(
										inArray(
											schema.lorebookEntryVectors.entryId,
											rows.map((r) => r.id)
										),
										eq(
											schema.lorebookEntryVectors
												.vectorName,
											DEFAULT_VECTOR_NAME
										),
										eq(
											schema.lorebookEntryVectors
												.chunkIndex,
											0
										),
										sql`array_length(${schema.lorebookEntryVectors.vector}, 1) > 0`
									)
								)
						).map((v) => v.entryId)
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
								session.lorebookId
							)
						)
					const hydrated = await hydrateBindings(db, bindings)
					/**
					 * Which character each binding names, for character lore's
					 * co-occurrence signal.
					 *
					 * Resolved here because the rows are already in hand — the
					 * ranker asking for them again would be a second query per
					 * turn for a fact this read has already paid for. A binding
					 * naming a persona, or naming nobody, resolves to null,
					 * which is what legacy's `binding?.characterId` test does.
					 */
					const bindingCharacter = new Map<number, number | null>(
						bindings.map((b) => [b.id, b.characterId ?? null])
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
						lorebookId: session.lorebookId,
						lorebook: {
							id: session.lorebookId,
							lorebookBindings: hydrated
						},
						sessionPersonas: sessionPersonas.map((cp) => ({
							persona: { id: cp.personaId }
						}))
					} as any

					const {
						populateLorebookEntryBindings,
						isCharacterLoreEntryVisible
					} = await import(
						"$lib/server/pipelines/prompt/characterLore"
					)
					const ready = (e: any) =>
						populateLorebookEntryBindings(e, asSession)

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
					 * The run has ONE scope and a gather runs ONCE, so every
					 * voice of a multi-agent turn used to be handed every
					 * character's private lore: Adventure's and Lair's `each`
					 * voices read the same pool, and Whodunit wired no
					 * character-lore lane at all rather than leak its suspects
					 * to each other. `core:query/character-lore@1` and
					 * `core:query/lorebook-triggers@1` declare a `speaker`
					 * in-port for that — a participant reference the spec wires
					 * INSIDE the clause — and it is the subject here, in place
					 * of the scope's.
					 *
					 * ⚠ A wired `speaker` never widens the gate. Absent (the
					 * port unwired, which is every spec written before this),
					 * the scope decides exactly as it did. Wired and naming a
					 * character row, that character decides. Wired and naming
					 * anybody else — an envoy, a role, a free-form side
					 * character the cast does not hold — the subject is
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
							const entry = ready(toEntryRow(row))
							if (gated && !visible(entry)) continue
							out.push(
								toLoreEntry(
									entry,
									source,
									vectored.has(row.id),
									boundCharacterOf(entry),
									// ⚠ `row`, not `entry`. The stored columns
									// are what a later reader can hash again;
									// the hydrated entry is not reproducible
									// from the database alone.
									entrySourceHash(row)
								)
							)
						}
					}
					return out
				}

				case "session_cast": {
					/**
					 * Who is in the session, and the prompt config they speak under.
					 *
					 * One read rather than three, because the cast is only useful
					 * assembled: a character row without its `sessionCharacters` join
					 * carries no visibility, and visibility is what decides whether
					 * that character appears in the prompt at all. Splitting them
					 * would let a spec read the characters and skip the join, which
					 * is a hidden character in every prompt and no error anywhere.
					 *
					 * The rows go out raw. Which of them are shown, named, or
					 * minimal is `promptFields.resolveContextInput`'s decision — the
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
									isActive: schema.sessionCharacters.isActive,
									visibility:
										schema.sessionCharacters.visibility,
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
						const bindings = await db
							.select({
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
						lorebookBindings = bindings
						for (const b of bindings) {
							const names = Array.isArray(b.absorbedAliases)
								? b.absorbedAliases
								: []
							if (!names.length) continue
							// Nullable — an unbound background graph node sets
							// no character — so an unbound row contributes no
							// absorbed identity to anybody.
							const id = b.characterId
							if (id == null) continue
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
					const { seatedEnvoys } = await import(
						"$lib/server/pipelines/entities/envoys"
					)
					const envoys = await seatedEnvoys(db, sessionId)

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

					return {
						...(turnChannelVoice ? { turnChannelVoice } : {}),
						sessionCharacters: sessionCharacters.map((cc) => ({
							...cc,
							absorbedAliases:
								absorbedByCharacter.get(cc.character?.id) ?? []
						})),
						sessionPersonas: sessionPersonas.map((cp) => ({
							...cp,
							absorbedAliases:
								absorbedByPersona.get(cp.persona?.id) ?? []
						})),
						envoys,
						lorebookBindings,
						sessionScenario: session.scenario ?? null,
						isGroup: Boolean(session.isGroup)
					}
				}

				case "session_state": {
					/**
					 * The session's resolved stats, states and possessions.
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
							possessions: {},
							slots: [],
							version: 0
						}
					const { stateFor } = await import(
						"$lib/server/state/resolve"
					)
					return await stateFor(db, sessionId)
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

					const { buildGraphRelationshipRows } = await import(
						"$lib/server/utils/graphContextFormatter"
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
					 * gate in promptBuilder already uses. Deliberately not a second
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
							excludeRecentMessages:
								q.excludeRecentMessages ?? 10,
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
							excludeRecentMessages:
								q.excludeRecentMessages ?? 10,
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
					const { entities, extractorVersion } = extractEntities(
						window,
						vocabulary.gazetteer
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
							keys
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

		async call(payload, node, run) {
			const p = (payload ?? {}) as Record<string, any>

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
					 * oracle's stream is the reply's prose (`narratingProvider`)
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
					const stream = scope.live?.attach(run.liveRow, node.key)
					const queueItemId =
						liveRow !== undefined && scope.live
							? await scope.live.claim(liveRow)
							: undefined

					let result: Awaited<ReturnType<typeof dispatchGeneration>>
					try {
						result = await dispatchGeneration({
							compiledPrompt: p.compiledPrompt,
							db,
							sessionId: scope.sessionId,
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
							onChunk: (chunk) => {
								stream?.onChunk(chunk)
								scope.sink?.onChunk?.(chunk)
							},
							onThinking: (chunk) => {
								stream?.onThinking(chunk)
								scope.sink?.onThinking?.(chunk)
							},
							signal: scope.signal,
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
								onStatusChange: scope.status
									? (status) => scope.status!.queue(status)
									: undefined
							}
						})
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
					return await dispatchImage(db, {
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
						signal: scope.signal,
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
						// nobody can clear and nobody can stop. It used to stamp
						// `""` here — the socket that listens today overwrites
						// that with its own id, which is exactly why the hole was
						// invisible.
						onProgress:
							scope.sink?.onProgress && scope.runId
								? (e) =>
										scope.sink!.onProgress!({
											runId: scope.runId!,
											nodeKey: node.key,
											...e
										})
								: undefined
					})
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
									signal: scope.signal,
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
								error: `'${name}' is provided by an extension, and extensions are switched off on this instance.`
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
								runId: scope.runId
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
						const { text, connection } = await dispatchStep(db, {
							systemPrompt: String(p.systemPrompt ?? ""),
							userPrompt: stepUserPrompt(p),
							connectionId: refId(p.connection),
							connectionModelId: connectionDescriptorModelId(
								p.connection
							),
							samplingId: refId(p.sampling),
							label: p.label,
							signal: scope.signal
						})
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
					 * contact with the database. `getNextCharacterTurn` drops
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
					const speakerRef =
						typeof p.speaker === "string" && isParticipantRef(p.speaker)
							? p.speaker
							: null
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
							? { answersForm: scope.answersForm }
							: {})
					}

					/**
					 * An existing row, claimed rather than inserted (the
					 * inlet's `messageId` on a regenerate, swipe or continue).
					 * Reset to generating; its text and swipe history stay as
					 * the verb left them — a continue's partial is the prefill
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
									`or continue has already set generating can be taken over.`
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
								generationOutcome: null
							}
						)
						if (!claimed)
							throw new HostScopeError(
								`${node.key}: message ${claimId} was released before this run could claim it`
							)
						row = claimed
					} else {
						const characterId = narration
							? null
							: (refId(p.characterId) ?? null)
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
					if (blocks) await announceWithParts(row.id)

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
						const { buildThinkingMetadata } = await import(
							"$lib/server/messages/thinkingMetadata"
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
						const thinking =
							typeof p.thinking === "string" && p.thinking.length
								? p.thinking
								: undefined
						const metadata = buildThinkingMetadata(
							current.metadata,
							content,
							thinking,
							true
						)
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
							// Blocks a reply ends with — a question put to
							// the cast — set once the text has landed (the
							// row's one block tree, S5), and announced with
							// the parts so the buttons show without a reload.
							const blocks = await writeBlocks(node, finished, p.blocks, {
								replace: true
							})
							if (blocks) await announceWithParts(finished.id)
							else await announce(finished)
							// A verb's rewrite is a change to history a
							// pipeline has already seen (R-15): recorded for
							// the next reply's inlet with the verb on it —
							// and, for a regenerate, with what it replaced
							// (`scope.previous`, W3). A fresh turn's finish is
							// the history growing, not moving, and records
							// nothing.
							if (scope.verb)
								await recordSessionChange(db, {
									event: "core:event/message-updated@1",
									sessionId: finished.sessionId,
									messageId: finished.id,
									verb: scope.verb,
									...(scope.previous
										? { previous: scope.previous }
										: {}),
									runId: scope.runId
								})
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
						isEdited: true
					})
					if (!row)
						throw new HostScopeError(
							`${node.key}: no message ${id} to update`
						)
					record(node, "message", row.id, "updated")
					// The row's one block tree, replaced (S5) — an edit that
					// hands the row new blocks means these blocks.
					const blocks = await writeBlocks(node, row, p.blocks, { replace: true })
					if (blocks) await announceWithParts(row.id)
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
					await recordSessionChange(db, {
						event: "core:event/message-deleted@1",
						sessionId: current.sessionId,
						messageId: id,
						lost,
						runId: scope.runId
					})
					return { id, sessionId: current.sessionId, lost }
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
					await recordSessionChange(db, {
						event: "core:event/message-hidden@1",
						sessionId: row.sessionId,
						messageId: row.id,
						hidden,
						runId: scope.runId
					})
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
					const patch: Partial<
						typeof schema.sessionMessages.$inferInsert
					> = {
						content: text,
						isEdited: true,
						// Content changed — cleared so the vectorization
						// queue re-embeds it.
						embedding: null,
						embeddingModel: null
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
					const { updateLegacy } = await import(
						"$lib/server/messages/store"
					)
					const row = await updateLegacy(db, id, patch)
					if (!row)
						throw new HostScopeError(
							`${node.key}: no message ${id} to edit`
						)
					record(node, "message", row.id, "edited")
					await announce(row)
					await recordSessionChange(db, {
						event: "core:event/message-edited@1",
						sessionId: row.sessionId,
						messageId: row.id,
						previous,
						runId: scope.runId
					})
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
					 * every text, `thinkingHistory` the reasoning beside each,
					 * `currentIdx` which is showing (null until a second
					 * alternative exists — the shape the swipe handlers have
					 * always written).
					 */
					const swipes = {
						currentIdx: null as number | null,
						history: [] as string[],
						thinkingHistory: [] as (string | null)[],
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
						}
						while (
							swipes.thinkingHistory.length < swipes.history.length
						)
							swipes.thinkingHistory.push(null)
						swipes.history.push(p.text)
						swipes.thinkingHistory.push(null)
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
							thinking: swipes.thinkingHistory[swipeIndex] ?? null
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
					await recordSessionChange(db, {
						event: "core:event/message-swiped@1",
						sessionId: row.sessionId,
						messageId: row.id,
						previous,
						swipeIndex,
						runId: scope.runId
					})
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
					await recordSessionChange(db, {
						event: "core:event/session-branched@1",
						sessionId: created.id,
						fromSessionId: sessionId,
						fromMessageId,
						runId: scope.runId
					})
					return { id: created.id, sessionId: created.id }
				}

				// ── The form's answer (R-15 *Forms*; U5d, 2026-09-17) ──────
				//
				// Commits an oracle's answer to a form **exactly as a click
				// would** — by making the click's fire, not by running it. The
				// commit checks the answer against the form, asks the cycle
				// caps, chooses the child's run id and **collects** the fire on
				// the scope (`fires`, W2); `runSpec` dispatches it through
				// `fireAction` — the road `sessions:triggerFunction` takes — as
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
					await appendParts(db, messageId, [
						isImage
							? {
									type: "core:image",
									data: {
										assetId: asset.id,
										...(media.alt
											? { alt: String(media.alt) }
											: {})
									}
								}
							: {
									type: "core:file",
									data: {
										assetId: asset.id,
										mime: asset.mime,
										...(media.name
											? { name: String(media.name) }
											: {})
									}
								}
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
					const noLore = await loreWriteRefusal(db, sessionId)
					if (noLore) throw new HostScopeError(`${node.key}: ${noLore}`)

					if (!session?.lorebookId)
						throw new HostScopeError(
							`${node.key}: this session has no lorebook, so there is nowhere to save the summary. Attach one first.`
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
					 * would collide on `0` where it used to land beside the
					 * first. The allocator is the socket handlers' — first free
					 * slot from 1 — under the same advisory lock, so a summary
					 * written while somebody is adding an entry by hand cannot
					 * race it.
					 */
					const lorebookId = session.lorebookId
					/**
					 * The links, in the SAME transaction as the row (L2, F7).
					 *
					 * A pipeline has one write-class outlet, so a spec cannot
					 * create an entry here and then link it with
					 * `core:outlet/link-lore-entries@1` — those are two writes.
					 * Writing them together is the way round that costs
					 * nothing, and it is the honest one: a room whose exits
					 * name an entry that is not there fails **with** the room
					 * rather than leaving half a room behind, because the
					 * refusal is raised inside the transaction.
					 */
					const links = loreLinkRequests(p.links)
					const { row, linkIds } = await db.transaction(
						async (tx) => {
							await tx.execute(
								sql`select pg_advisory_xact_lock(${lorebookId})`
							)
							const [created] = await tx
								.insert(schema.lorebookEntries)
								.values(
									entryInsert({
										typeId,
										lorebookId,
										name,
										content,
										position: await nextPosition(
											tx,
											lorebookId,
											typeId
										)
									})
								)
								.returning()
							const ids: number[] = []
							for (const link of links)
								ids.push(
									await writeLoreLink(
										tx,
										lorebookId,
										created!.id,
										link,
										node.key
									)
								)
							return { row: created!, linkIds: ids }
						}
					)
					// Invisible to the run until now: a summarize pipeline wrote
					// an entry and the run row said it had produced nothing.
					record(node, "lore_entry", row.id, "created")
					for (const id of linkIds)
						record(node, "lore_link", id, "created")
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

					const noLore = await loreWriteRefusal(db, sessionId)
					if (noLore) throw new HostScopeError(`${node.key}: ${noLore}`)

					const [session] = await db
						.select()
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					if (!session?.lorebookId)
						throw new HostScopeError(
							`${node.key}: this session has no lorebook, so there is nothing to link. Attach one first.`
						)

					const lorebookId = session.lorebookId
					// Both ends under the book's own lock, for the reason the
					// entry write takes it: an end resolved by name must not be
					// renumbered or renamed out from under the insert.
					const { fromId, linkId } = await db.transaction(
						async (tx) => {
							await tx.execute(
								sql`select pg_advisory_xact_lock(${lorebookId})`
							)
							const from = await resolveLoreLinkEnd(
								tx,
								lorebookId,
								p.from,
								node.key
							)
							return {
								fromId: from,
								linkId: await writeLoreLink(
									tx,
									lorebookId,
									from,
									{
										to: p.to,
										linkType: p.params?.linkType,
										label: p.label
									},
									node.key
								)
							}
						}
					)
					record(node, "lore_link", linkId, "created")
					return { id: linkId, fromEntryId: fromId, lorebookId }
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
		// Which lane it came from, carried rather than dropped (20 §7). A read
		// is scoped to one channel, but a whole-channel read spans that
		// channel's lanes (ruling 2026-09-09), so this is what tells the five
		// private conversations under one slug apart without a second read.
		channel,
		...(shape ? { channelRole: shape.role } : {}),
		...(shape?.voice ? { channelVoice: shape.voice } : {}),
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
 * Bindings with the character or persona each one names.
 *
 * `populateLorebookEntryBindings` reads `binding.character` / `binding.persona`
 * to resolve `{{char:1}}` into a name, and the binding rows carry only ids —
 * so without this the substitution silently does nothing, which is the failure
 * it is being wired in to fix. Two queries rather than a join per binding: a
 * lorebook has a handful of bindings and this runs once per read.
 */
async function hydrateBindings(db: Db, bindings: any[]): Promise<any[]> {
	const characterIds = [
		...new Set(bindings.map((b) => b.characterId).filter(Boolean))
	]

	const characters = characterIds.length
		? await db
				.select()
				.from(schema.characters)
				.where(inArray(schema.characters.id, characterIds))
		: []

	const byCharacter = new Map(characters.map((c) => [c.id, c]))

	// `persona` is attached, and always null: a binding on a character the user
	// voices is a character binding, so `character` above answers for both and
	// this field exists only to keep a reader that asks for it from throwing.
	return bindings.map((b) => ({
		...b,
		character: b.characterId
			? (byCharacter.get(b.characterId) ?? null)
			: null,
		persona: null
	}))
}

function toLoreEntry(
	row: any,
	source: "worldLore" | "characterLore" | "history",
	/** Whether this entry has a usable vector, not the vector itself. */
	hasEmbedding: boolean,
	/**
	 * The character this entry's binding names, already resolved.
	 *
	 * Read by character lore's co-occurrence signal, which asks whether that
	 * character spoke recently — see `speakerCooccurrenceSignal`. Null for
	 * every entry that is not a character's.
	 */
	bindingCharacterId: number | null = null,
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
		keys: row.keys ?? "",
		caseSensitive: row.caseSensitive ?? false,
		useRegex: row.useRegex ?? false,
		matchMode: row.matchMode ?? null,
		// `?? null` for the mode and `?? ""` for the keys, because the two
		// absences mean the same thing and the matcher tests both: no mode is
		// no condition, and no condition keys is no condition either.
		secondaryKeys: row.secondaryKeys ?? "",
		selectiveLogic: row.selectiveLogic ?? null,
		// `?? null` and not `?? 0`, because null is a value here: it means the
		// entry has no opinion and the node's ceiling decides. Coalescing to
		// zero would pin every untouched entry to "conversation only" and make
		// turning recursion on do nothing.
		recursionDepth: row.recursionDepth ?? null,
		priority: row.priority ?? 1,
		constant: row.constant ?? false,
		enabled: row.enabled ?? true,
		position: row.position ?? 0,
		lorebookBindingId: row.lorebookBindingId ?? null,
		bindingCharacterId,
		/** History entries only; used for the recency signal. */
		year: row.year ?? null,
		month: row.month ?? null,
		day: row.day ?? null,
		hasEmbedding
	}
}
