/**
 * One session turn, run as a pipeline — the one road (09-B B4).
 *
 * This is the entry point every reply takes: load the published spec, build
 * the config world and the host, run to the end, hand back the receipt. The
 * spec creates its own reply row at a placeholder outlet, its oracle runs, and
 * its last outlet fills the row; nothing outside the run inserts a message.
 *
 * ## Streaming
 *
 * Tokens reach the user through the run's **live row** — the row the
 * placeholder committed, which the executor names on every oracle call and
 * core streams into (`liveRow.ts`). Never through the pipeline's values: a
 * socket handle is not a value, and would land in the receipt and in every
 * downstream node's input. The port still carries the finished text, so the
 * run is complete and replayable while the user watched it arrive.
 *
 * ## Stop
 *
 * A run-level guarantee. The executor tells the host once when the run ends
 * (`onRunEnd`), and a row the run created but never filled — stopped
 * mid-stream, failed, halted — is finalised there with whatever had arrived.
 * No node can do it: a cancelled run has nothing left to run.
 */

import {
	run,
	sessionEvents,
	type FormAddressedPayload,
	type FormBlock,
	type NodeEvent,
	type NodeSwap,
	type ParticipantRef,
	type Receipt,
	type ReceiptMeta,
	type StatusText
} from "@serene-pub/sdk"
import {
	childLineage,
	beginRoot,
	releaseRoot,
	type RunLineage
} from "$lib/server/pipelines/runtime/lineage"
import { createReviewer } from "$lib/server/pipelines/runtime/reviewGate"
import {
	createHost,
	type HostScope,
	type PendingFire
} from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { pluginNodeBindings } from "$lib/server/pipelines/runtime/pluginBindings"
import {
	loadPublished,
	RESPOND_SPEC_ID
} from "$lib/server/pipelines/boot/bootstrap"
import { specOwnerPluginId } from "$lib/server/pipelines/boot/store"
import {
	saveReceipt,
	type RunArtifact
} from "$lib/server/pipelines/runtime/receipts"
import {
	connectionStopsFor,
	makeScriptApplier,
	scriptExtras,
	scriptsEnabledFor
} from "$lib/server/pipelines/scripts/chains"
import { genreFieldsFor } from "$lib/server/pipelines/entities/sessionGenres"
// Imported for `tokenizerFor`, and for the eight loaders that module registers
// with the SDK as it evaluates. Both halves matter: the id below means nothing
// without a loader behind it, and importing the resolver is what guarantees the
// registration cannot be tree-shaken out from under it.
import { tokenizerFor } from "$lib/server/pipelines/runtime/tokenizers"
import { pluginsEnabled } from "$lib/server/plugins/flag"
import {
	createLiveRow,
	type SessionIo
} from "$lib/server/pipelines/runtime/liveRow"
import { noteRun } from "$lib/server/pipelines/runtime/capPause"
import { createStatusRelay } from "$lib/server/pipelines/runtime/runStatus"
import {
	stepStatuses,
	streamingSteps
} from "$lib/server/pipelines/runtime/specShape"
import {
	ownPresence,
	resolvePortrayals,
	turnRefs
} from "$lib/server/pipelines/runtime/portrayals"
import { getManager } from "$lib/server/plugins"
import { makePluginHookDispatch } from "$lib/server/plugins/hookDispatch"
import {
	markSessionChangesConsumed,
	peekSessionChanges,
	pendingSessionChanges
} from "$lib/server/messages/sessionChanges"
import { resolveChannel } from "$lib/server/messages/channels"
import type { PluginHookDispatch } from "$lib/server/pipelines/scripts/pluginDispatch"
import type { RunProgress } from "$lib/shared/sockets/progress"
import type { FormAwaitingPerson } from "$lib/server/notifications/openForm"
import { v4 as uuidv4 } from "uuid"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

export class PipelineUnavailableError extends Error {}

// db is the global Db — see db/types.d.ts

export interface TurnRequest {
	db: Db
	sessionId: number
	userId: number
	/**
	 * Fired by auto-advance (PLAN-turn-order §4.6). Forwarded to the run so
	 * its writes carry `auto` on their cause — without it a `round` never
	 * continues past the first automatic reply (A8 walk, 2026-09-24).
	 */
	auto?: boolean
	/** Whose turn it is. Null in narrator mode. */
	currentCharacterId: number | null
	/**
	 * Whose turn it is, as a **participant reference** (R-18 (3)) — the
	 * inlet's `speaker` port. Derived from `currentCharacterId` when absent
	 * (`character:<id>`, or null); a caller seating an envoy passes
	 * `envoy:<slug>` here, which no bare id can say.
	 */
	speaker?: ParticipantRef | null
	/**
	 * The side character speaking this turn, when one was named (ruling
	 * 2026-09-07) — see `SpecRunRequest.sideCharacter`.
	 */
	sideCharacter?: SpecRunRequest["sideCharacter"]
	/** A message being composed but not stored — see `HostScope.draftMessage`. */
	draftMessage?: { content: string; personaId?: number | null }
	/** The message that triggered this turn. */
	text: string
	/**
	 * Text an in-progress reply has already produced — an **extend** (ruling
	 * 2026-09-08, D-2).
	 *
	 * Absent on every other turn. It travels to the input node's
	 * `continuationPrefill` port and from there, on `core:spec/respond`, to
	 * `core:task/process-messages@1`, which puts it in the seed line the model
	 * writes from. Nothing else reads it.
	 *
	 * ⚠ It is **not** `text`, and the two must not be conflated. A continue
	 * re-retrieves as a full run: the triggering text is whatever an ordinary
	 * turn's would be, the row carrying this partial is excluded from every
	 * message read while it generates, and only the prompt sees it — where it
	 * counts against the budget like anything else in the prompt.
	 */
	continuationPrefill?: string
	/**
	 * Which channel the triggering message is on — the stored string, lane
	 * included (`main`, `manuscript`, `phone:3`). Absent means `main`, which
	 * is every session whose genre declares no channel of its own.
	 *
	 * It travels twice, because two different things need it: onto the
	 * inlet's `channel` port, where a genre's junction can branch on it, and
	 * onto the host scope, where the turn's channel is turned into the
	 * declared `voice` the seed line takes (`HostScope.channel`).
	 */
	channel?: string
	/**
	 * How this turn was reached — the fired entry's `via` (`strategy`,
	 * `script`, `voice`, `pick`, or `narrate` for the `core#narrate` press;
	 * lair pass R8). On the inlet's `via` port, where a genre routes on it.
	 * Absent is empty.
	 */
	via?: string
	/**
	 * The reply row this turn re-drives — a regenerate, swipe or extend of a
	 * message that already exists. On the inlet's `messageId` port; the spec's
	 * placeholder outlet claims it instead of inserting. Absent on a fresh turn.
	 */
	messageId?: number
	/**
	 * Which verb re-drives `messageId`, when one does — see
	 * `SpecRunRequest.verb`. Absent on a fresh turn.
	 */
	verb?: SpecRunRequest["verb"]
	/** What a regenerate's row held before its handler cleared it — see `SpecRunRequest.previous`. */
	previous?: SpecRunRequest["previous"]
	/** Where the rows this turn writes are announced — see `SpecRunRequest.io`. */
	io?: SessionIo
	/** Node lifecycle observation — see `SpecRunRequest.onNode`. */
	onNode?: SpecRunRequest["onNode"]
	/** The run's status changed — see `SpecRunRequest.onStatus`. */
	onStatus?: SpecRunRequest["onStatus"]
	/** Which spec to run. Defaults to core's. */
	specId?: string
	/**
	 * The seed for anything that varies.
	 *
	 * **Defaults to a fresh value per turn, not to something derived from the
	 * session.** It first defaulted to `turn:${sessionId}`, which is constant for the
	 * life of a session — so every turn would have picked the same example dialogue
	 * and the variety the seeding exists to preserve would have been quietly
	 * gone. The seed is recorded on the run row, so a caller reproducing a turn
	 * passes the recorded one back rather than reconstructing it.
	 */
	seed?: string
	/**
	 * This run's identity.
	 *
	 * Generated per run unless supplied. The SDK defaults it to the literal
	 * `"run:test"` when a host does not pass one, which is a reasonable default
	 * for a test and a trap for a host: every run would share an id, and the
	 * unique index on the receipt table is what caught it.
	 */
	runId?: string
	/** See `SpecRunRequest.overrides` — the comparison tool, and nothing else. */
	overrides?: SpecRunRequest["overrides"]
	/** Where streamed tokens go while the model is still generating. */
	sink?: HostScope["sink"]
	signal?: AbortSignal
	/** The same stop in the executor's shape — see `SpecRunRequest`. */
	cancelSignal?: () => { by: string; reason: string } | undefined
	/** Stop before the provider call and report what *would* be sent. */
	preview?: boolean
	/**
	 * Skip recording the receipt.
	 *
	 * For the comparison tool, which runs a preview against every session on the
	 * instance and would otherwise fill the run history with rows nobody asked
	 * for. A real turn always records.
	 */
	skipReceipt?: boolean
	/** Run-level facts the dispatch decided — see `SpecRunRequest.meta`. */
	meta?: ReceiptMeta
}

/**
 * Any published spec, run against this session — the entry every trigger shares.
 *
 * `runTurn` shapes the input for a session reply; the summarize and graph-build
 * sockets shape theirs. What none of them get to vary is the substrate: the
 * same world, the same host, the same bindings, the same receipt rule —
 * because two entry points that assembled those differently would be two
 * pipelines wearing one name.
 */
export interface SpecRunRequest {
	db: Db
	sessionId: number
	userId: number
	/**
	 * This run was started by auto-advance (PLAN-turn-order §4.6), not by a
	 * press. Every session event the run's writes cause carries it on the
	 * cause (`{ kind: 'run', runId, auto }`), which is the one fact the
	 * auto-advance listener reads to decide whether a `round` continues.
	 */
	auto?: boolean
	/** Which spec to run. */
	specId: string
	/**
	 * Whose turn it is, when the spec has one. Null or absent in narrator mode
	 * and for specs with no speaker at all (summarize, graph build).
	 *
	 * Reaches the provider through `HostScope`, because the stop list has to
	 * exclude the speaking character's own name — see the note there.
	 */
	currentCharacterId?: number | null
	/**
	 * Whose turn it is, as a participant reference — what the run's
	 * portrayals are resolved for (R-21 (4)) beside the cast, the members'
	 * presences, the owner and the run owner. Absent or null: the run asks
	 * about nobody in particular (a narrator turn, a summarize, a graph
	 * build) and `portrayals` is still pinned for the session's cast,
	 * presences and roles.
	 */
	speaker?: ParticipantRef | null
	/** A message being composed but not stored — see `HostScope.draftMessage`. */
	draftMessage?: { content: string; personaId?: number | null }
	/**
	 * Who is speaking this turn when they are **not a cast member** — the
	 * side-character trigger's first step (ruling 2026-09-07). Reaches the
	 * inlet on its `sideCharacter` port (was `speaker` until 2026-09-16,
	 * when that word became the participant reference above).
	 *
	 * ⚠ **participant ≠ character.** This is a fact about one turn, not a
	 * membership: nothing anywhere writes a `session_characters` row from it,
	 * and the round-robin never sees it — the rotation reads stored messages
	 * and drops narration rows before matching a character id, so exclusion is
	 * a property of the row this turn writes rather than a rule stated here.
	 *
	 * `characterId` is null for a free-form name, which is the whole point of
	 * the free-form case: a full participant for that turn with no row behind
	 * them. `known` is the new-name fact — whether the session's lorebook has
	 * heard of them — resolved once, before the run, and handed to the script
	 * hook as a declared extra rather than recomputed per link.
	 */
	sideCharacter?: {
		name: string
		characterId: number | null
		known: boolean
		/** The card, when the pick was a real character. */
		character?: Record<string, unknown> | null
	} | null
	/** The input node's value, shaped by the caller for the spec it names. */
	input: unknown
	/**
	 * The message verb re-driving this run's row — `regenerate`, `swipe` or
	 * `extend` — when one is (R-15, 2026-09-16). Reaches the host scope,
	 * where `update-message`'s finishing write puts it on the
	 * `message-updated` it records for the next reply's inlet: a rewrite is
	 * a change to history a pipeline has seen, and which verb made it is
	 * the fact worth carrying. Absent on a fresh turn and on every run that
	 * is not a reply.
	 */
	verb?: "regenerate" | "swipe" | "extend"
	/**
	 * Which channel this run's trigger is on (R-C, 2026-09-17). Reaches the
	 * host scope, which is where the turn's channel becomes the declared
	 * `voice` its seed line takes — see `HostScope.channel`. Absent means
	 * `main`; the inlet's own `channel` port is shaped by the caller beside
	 * this, on `input`.
	 */
	channel?: string
	/**
	 * What the verb's row held before its handler cleared it — a
	 * regenerate's, and only a regenerate's (U5b review W3). Reaches the
	 * host scope, where the finishing write records it as `previous` on the
	 * `message-updated` beside the verb: what a regenerate replaced is as
	 * much a change to history as what an edit replaced, and the handler is
	 * the only party that saw the text before it cleared the row.
	 */
	previous?: { content: string }
	/**
	 * The form this run answers (U5f) — set by `fireAction` for a press on a
	 * block; reaches the host scope, where `create-message` stamps it on the
	 * rows it writes as `metadata.answersForm`. See `HostScope.answersForm`.
	 */
	answersForm?: { messageId: number; blockId: string; toOwner?: boolean }
	/**
	 * Rows this run is producing that the caller already knows about. The
	 * host records everything the run writes as it is written, so almost no
	 * caller sets this; it is the head start for one that already owns a row
	 * the run will only read.
	 */
	artifacts?: RunArtifact[]
	/**
	 * Where the rows this run writes are announced to the session's users.
	 * The pipeline owns its reply row (R-17): the placeholder the composer
	 * shows is the row its outlet commits, so the commit announces it. Absent,
	 * nothing is broadcast — an event-triggered run, a test.
	 */
	io?: SessionIo
	seed?: string
	runId?: string
	sink?: HostScope["sink"]
	/**
	 * Node lifecycle observation — the executor's inherent progress (F34).
	 * Fires for every invocation with identity and never a payload, so any
	 * surface can drive a progress card without knowing the pipeline.
	 */
	onNode?: (event: NodeEvent) => void
	/**
	 * The run's status changed (R-19): a node said what it is doing —
	 * *{speaker} is thinking*, *{speaker} is typing* — or the LLM queue said
	 * the call is waiting or a model is loading. Handed the text with
	 * `{speaker}` already filled by the host (`runStatus.ts`), so a caller
	 * only has to put it on its own frame: the progress card's
	 * `pipelines:progress`, the summarize modal's own progress event. The
	 * live row and the session list are told by the host itself, before this
	 * fires. Never fired on a pre-call preview (`preview: true`): nobody is
	 * watching a token estimate.
	 */
	onStatus?: (nodeKey: string, text: StatusText) => void
	/**
	 * This run, or a run dispatched under it, has parked at a review gate
	 * (U5d review, R-b): the entry is stored and the person has the card.
	 * Handed down to every child (`dispatchAddressedForms`, `dispatchFires`)
	 * so the fact reaches whoever is holding an ack or a lock on the tree —
	 * `fireAction` races its own run against it and answers `parked`
	 * promptly rather than holding the session's trigger lock until the
	 * owner decides. Told once per gate.
	 */
	onParked?: (run: { runId: string; specId: string }) => void
	signal?: AbortSignal
	/**
	 * The same stop, in the shape the executor speaks (13 §3).
	 *
	 * `signal` reaches the *bindings*, which can listen for an event mid-call.
	 * The executor never listens — it only pauses between nodes — so it polls
	 * this instead, and a returned `{by, reason}` ends the run as `cancelled`
	 * with the actor on the receipt. Both are projections of one
	 * `AbortController`; see `runRegistry.cancellation`, which builds this.
	 *
	 * Absent, the run walks to the end whatever happens to `signal` — a node
	 * whose adapter was aborted but which returns rather than throwing takes
	 * the next node with it.
	 */
	cancelSignal?: () => { by: string; reason: string } | undefined
	/**
	 * Stop before a node and report what *would* happen there. `true` stops at
	 * the first Provider on the spine (debug preview); `{atNode}` stops at a
	 * named node — which is how a generate-and-review flow runs everything
	 * *except* its write, and hands the result to a person instead.
	 *
	 * A preview performs no writes (R-21 (1)): the spec's placeholder outlet
	 * runs before the halt and commits nothing, so a token estimate leaves no
	 * row behind. See `RunOptions.dry`.
	 */
	preview?: boolean | { atNode: string }
	/**
	 * Facts about *how this run was reached* that no node produced.
	 *
	 * Stamped onto the receipt beside everything the executor recorded, so the
	 * explain surface reads them from the one blob every other "why did the
	 * turn do that" answer already lives in. One key so far: `preset`, set when
	 * the session's preset bound this event to a pipeline this instance
	 * cannot resolve, and the genre's default ran instead (ruled 2026-09-10).
	 *
	 * ⚠ Not for anything a node can say. A node's own account belongs on its
	 * node row, where the trail is queryable; this is only for the facts that
	 * were decided before the first node existed.
	 *
	 * Typed by the SDK (`ReceiptMeta`, F2) and recorded by the executor
	 * through `RunOptions.meta`, never stamped on after the run.
	 */
	meta?: ReceiptMeta
	skipReceipt?: boolean
	/**
	 * Where this run stands in a tree of runs (01 §8; U5d): set by a
	 * dispatcher — `dispatchSessionEvent` for a `form-addressed` child,
	 * `fireAction` for the action an answer fires — and stamped on the
	 * receipt as `parentRunId` / `rootRunId` / `depth`. Absent for a root.
	 */
	lineage?: RunLineage
	/**
	 * Node parameters forced on top of everything the world resolved.
	 *
	 * For the A/B prompt-diff tool (`pipelines/measure/promptDiff.ts`), which
	 * runs one real session twice under two configurations and diffs what
	 * reached the model. It has to run **this** function rather than assembling
	 * its own world and calling `run()` — a comparison against a different
	 * substrate (no scripts, no plugin nodes, no tokenizer, no reviewer) would
	 * be a diff of two things neither of which ships.
	 *
	 * ⚠ **They win, and they have to.** Applied at `session` scope — the top of
	 * `SCOPE_ORDER` — with any existing row at the same address removed first,
	 * because `resolveConfigSources` takes the *first* candidate it finds at a
	 * scope and a stored session override would otherwise silently beat the
	 * value the tool was asked to measure. A measurement that can be overruled
	 * by the thing it is measuring against is worse than no measurement.
	 *
	 * `slot` defaults to `params`, which is where every retrieval and ranking
	 * control lives. Nothing else may set this: it is not reachable from a
	 * socket, a route or a trigger, and it must not become a fourth
	 * user-editable scope — that chain was deliberately narrowed (plan §3,
	 * phase 5).
	 */
	overrides?: Array<{
		nodeKey: string
		slot?: string
		path: string
		value: unknown
	}>
}

/**
 * Force a run's node parameters, ahead of every stored scope.
 *
 * Separate from `buildWorld` deliberately: the world is *what this install is
 * configured to do*, and this is a caller saying "run it as if it were
 * configured differently, without changing anything". Nothing is written.
 */
function forceOverrides(
	world: Awaited<ReturnType<typeof buildWorld>>,
	overrides: SpecRunRequest["overrides"],
	sessionId: number
): void {
	for (const o of overrides ?? []) {
		const slot = o.slot ?? "params"
		// Removed rather than shadowed — see the note on `overrides` above.
		for (let i = world.overrides.length - 1; i >= 0; i--) {
			const row = world.overrides[i]!
			if (
				row.nodeKey === o.nodeKey &&
				row.slot === slot &&
				row.path === o.path
			)
				world.overrides.splice(i, 1)
		}
		world.overrides.push({
			nodeKey: o.nodeKey,
			slot,
			path: o.path,
			value: o.value,
			scopeKind: "session",
			scopeId: sessionId
		})
	}
}

export async function runSpec(request: SpecRunRequest): Promise<Receipt> {
	// A root holds its run tree from its first instant to its last, whatever
	// it throws (E1c): a child its write caused may be queued before the root
	// returns, and the tree's count must survive until that child settles.
	if (request.lineage) return runSpecOnce(request)
	const runId = request.runId ?? uuidv4()
	beginRoot(runId)
	noteRun(runId, request.specId)
	try {
		return await runSpecOnce({ ...request, runId })
	} finally {
		releaseRoot(runId)
	}
}

async function runSpecOnce(request: SpecRunRequest): Promise<Receipt> {
	const { specId } = request
	const loaded = await loadPublished(request.db, specId)
	if (!loaded)
		throw new PipelineUnavailableError(
			`no published version of '${specId}'. Core publishes its own at startup, so ` +
				`this usually means the definition registry refused to sync — check the server log ` +
				`for a pipeline bootstrap warning.`
		)

	// Scope node rebinds (19 §5): a session that swapped its next-speaker
	// strategy — or any future node-type swap — lands here, on the freshly
	// loaded copy, shape-guarded so a stale row degrades to the pin. The
	// receipt then names the substituted type with no extra bookkeeping.
	const { applyNodeRebinds } = await import(
		"$lib/server/pipelines/entities/bindings"
	)
	// Which nodes a swap answered, for the receipt (F2): `run` records it
	// per row as `swap`, and `null` — the pin ran — everywhere else.
	const swaps: Record<string, NodeSwap> = {}
	const doc = await applyNodeRebinds(request.db, loaded, {
		specSlug: specId,
		sessionId: request.sessionId,
		swaps
	})

	// Whose document this is (D-6) — read from the spec ROW, joined to the
	// plugin that installed it, never inferred from the id's namespace. One
	// small query per run, beside the two the load above already costs, because
	// the answer has to be a row's and a row is where it is.
	const ownerPluginId = await specOwnerPluginId(request.db, specId)

	// The same run id the executor stamps below, hoisted so a plugin link's
	// invocation-log row soft-links to the run that fired it — and so the host
	// scope built just below can name the run its effects belong to.
	const runId = request.runId ?? uuidv4()
	// Who is running it, in the form every hook-facing call takes. Hoisted
	// beside the run id because the three consumers below — plugin nodes, the
	// script applier, and the rendering bindings — must name the same person.
	const user = request.userId != null ? String(request.userId) : undefined

	/**
	 * What this run leaves behind, collected as it happens.
	 *
	 * Seeded with whatever the caller already owns (the reply path's message
	 * row), then appended to by every host commit that writes — and by
	 * `dispatchImage`, which is the only place a rendered file's row id exists.
	 * `saveReceipt` turns it into `pipeline_run_artifacts` rows and derives
	 * `is_preview` from whether it stayed empty.
	 *
	 * A fresh array rather than the caller's, so a caller reusing a request
	 * object across runs does not accumulate the previous run's output.
	 */
	const artifacts: RunArtifact[] = [...(request.artifacts ?? [])]

	/**
	 * The forms this run addressed to a participant the AI portrays (R-15
	 * *Forms*; U5d), collected by the message writes and dispatched as
	 * `form-addressed` **after this run's receipt is saved** — the event is
	 * emitted after the write lands (01 §8), and a child that ran inside its
	 * parent's outlet would run inside the outlet's timeout. A dry run
	 * reaches no host and collects nothing.
	 */
	const addressed: Array<{ payload: FormAddressedPayload; form: FormBlock }> = []

	/**
	 * The forms this run put to a person (or to nobody — the owner's), each
	 * raised as an `open-form` notification after the receipt is saved, for
	 * the reason `addressed` waits: the row is announced once the write has
	 * landed, never from inside an outlet (PLAN-notifications §5).
	 */
	const formsAwaitingPeople: FormAwaitingPerson[] = []

	/**
	 * The fires this run's `answer-form` commits collected (U5d review, W2):
	 * each is the click an oracle's answer makes, dispatched through
	 * `fireAction` **after this run's receipt is saved** — outside any node
	 * timeout, as this run's child — for the same reason the addressed forms
	 * are. A commit that ran the action inside itself would run a model call,
	 * and a review gate, inside a write's timeout.
	 */
	const fires: PendingFire[] = []

	/**
	 * The run's live row — core's half of the pipeline owning its row. Which
	 * oracle streams is DECLARED by the document (`streamingSteps`, lair pass
	 * B3 / D6): a multi-step spec's planner and keeper must not write JSON
	 * into the row the narrator is filling, and a spec that declares nothing
	 * streams nothing. The executor says WHICH row; this says what happens
	 * to it.
	 */
	const live = createLiveRow({
		db: request.db,
		io: request.io,
		sessionId: request.sessionId,
		runId,
		userId: request.userId,
		streamingNodes: streamingSteps(doc)
	})

	/**
	 * Who portrays whom, resolved **once, here, before the first node** and
	 * pinned on the receipt (R-21 (4)) — like config, and for the same
	 * reason: a run that re-asked per node could answer differently across
	 * one turn as a member joined. The references a turn asks about are the
	 * inlet's speaker, the cast, the members' presences, the owner and the
	 * run owner (`turnRefs`); the answer rides on the host scope, read-only,
	 * for the host's own seams (U5d's form-addressed pipeline). No node's
	 * `ctx` carries it: nodes stay blind, and a definition that needs it
	 * declares an in-port.
	 *
	 * Resolved only where it means something: every run through here has a
	 * session, and the one kind that has nobody to portray is the pre-call
	 * preview (`preview: true` — the token count, the inspector's debug
	 * preview), which halts before any oracle and runs on every keystroke's
	 * debounce. A review-gated run (`{ atNode }` — a summarize parked at
	 * its save) reaches the model and is answered like a reply. Absent
	 * rather than empty, so a reader can tell "nobody asked" from "nobody
	 * here".
	 */
	const portrayals =
		request.preview === true
			? undefined
			: await resolvePortrayals(request.db, {
					sessionId: request.sessionId,
					runOwnerUserId: request.userId,
					refs: await turnRefs(
						request.db,
						request.sessionId,
						request.speaker
					),
					speaker: request.speaker
				})

	/**
	 * The run's status relay (R-19) — where `ctx.status` lands after the
	 * executor: `{speaker}` filled from the run's speaker, the live row
	 * written, the registry and the session's users told, the caller's own
	 * frame fed. Absent on a pre-call preview, exactly as `portrayals` is:
	 * the token estimate runs on every keystroke's debounce and nobody is
	 * watching it type.
	 */
	const status =
		request.preview === true
			? undefined
			: createStatusRelay({
					db: request.db,
					io: request.io,
					sessionId: request.sessionId,
					runId,
					live,
					speaker: request.speaker,
					sideCharacterName: request.sideCharacter?.name ?? null,
					userId: request.userId,
					onStatus: request.onStatus,
					// What each step says while it runs, as the spec declared
					// it (lair pass B18 / D5) — never a node key.
					declared: stepStatuses(doc)
				})

	const scope: HostScope = {
		// Everything the host does outside the graph is attributed to this run:
		// the progress an image render reports back to the person watching, and
		// the run a prompts-slot template renders under. This is the one place
		// holding both the run and the host wiring, the same reason
		// `coreBindings` is handed the run rather than reading it off `ctx`.
		runId,
		sessionId: request.sessionId,
		userId: request.userId,
		currentCharacterId: request.currentCharacterId,
		draftMessage: request.draftMessage,
		portrayals,
		verb: request.verb,
		// The turn's channel, for the one answer the host derives from it:
		// that channel's declared voice, on the cast read (R-C).
		channel: request.channel,
		previous: request.previous,
		answersForm: request.answersForm,
		// Which document this is, so the built-in writes can refuse to
		// perform under any but their own (U5b review W8).
		specId,
		// …and whose it is (D-6). Absent for core's own specs, which is the
		// same absence as "no plugin installed this" rather than a lookup that
		// failed — `specOwnerPluginId` reads the row's owner, and core's is
		// NULL by construction.
		ownerPluginId,
		// What this document contributes and how it was entered (U5d): the
		// message writes stamp a block's action from the former and refuse a
		// function the document declares no action for; `answer-form` refuses
		// to perform under any inlet but `form-addressed@1` by the latter.
		contributes: doc.contributes,
		inletDefinitionId: inletDefinitionIdOf(doc),
		input: (doc as { input?: { event?: string; events?: string[] } }).input,
		// The document as it runs — rebinds applied — for what reads a node's
		// definition after the fact (the turn order's `strategy`).
		nodes: doc.nodes.map((n: any) => ({
			key: n.key,
			kind: n.kind,
			definitionId: n.definitionId,
			definitionVersion: n.definitionVersion
		})),
		// Fired by auto-advance (PLAN-turn-order §4.6), so every session
		// event this run's writes cause says so on its cause.
		auto: request.auto,
		lineage: request.lineage,
		addressed,
		formsAwaitingPeople,
		fires,
		artifacts,
		io: request.io,
		live,
		status,
		sink: request.sink,
		signal: request.signal
	}

	// Hoisted so the run and the script applier share one seed — a script's
	// rolls are a function of the run seed and the link's address (18 §6), and
	// two seeds would make "replay with the recorded seed" a half-truth.
	const seed = request.seed ?? uuidv4()

	// The kill switch (18 §10): off means the host supplies no engine at all,
	// and the executor's seam makes that mean "every spec runs exactly as
	// before scripts existed" — chains and attachments kept, waiting.
	const scriptsOn = await scriptsEnabledFor(request.db)

	// The extension-hook executor. Behind the same seam as core scripts and
	// gated three ways: chains must be on at all, the plugin subsystem must be
	// enabled (dark by default in 0.6), and startup must have finished so a
	// link never stalls a turn on the ready-gate. When any is false, plugin
	// links are absorbed as skips and the pipeline is untouched.
	let pluginDispatch: PluginHookDispatch | undefined
	// A plugin's *nodes* on the spine (20 §9) — same gates as its chain
	// links: subsystem on, startup finished. Empty when dark, so the spread
	// below is a no-op and core specs run exactly as before.
	let pluginNodes: Awaited<ReturnType<typeof pluginNodeBindings>> = {}
	if (scriptsOn && pluginsEnabled()) {
		const manager = getManager()
		if (manager.isReady()) {
			pluginDispatch = makePluginHookDispatch(request.db, manager)
			pluginNodes = await pluginNodeBindings(request.db, manager, {
				seed,
				nowMs: Date.now(),
				runId,
				user,
				specOwner: ownerPluginId
			})
		}
	}

	const world = await buildWorld(request.db, {
		sessionId: request.sessionId,
		// Which pipeline is running, so its own configs and overrides are
		// read. Without it the run resolves against the legacy projection
		// only, and everything a person set in the pipeline panel is
		// invisible to the thing it was supposed to configure.
		specId
	})
	// A no-op on every path but the comparison tool's, which is the only caller
	// that supplies any. In memory, on this run's copy of the world — nothing
	// is written and the next turn resolves exactly as it would have.
	forceOverrides(world, request.overrides, request.sessionId)

	/**
	 * The settings document (PLAN-turn-order §4.12, R13), resolved **once
	 * per run, here, after every write that caused this run has landed** and
	 * before the first node — like `portrayals`, and for the same reason: a
	 * run that re-asked per node could read two answers across one turn.
	 *
	 * It reaches the graph as the inlet's `session` port (every core inlet
	 * that takes a session declares it; the identity binding hands it on),
	 * and the script applier as the read-only extra `session`. No node
	 * re-queries a table for a setting; `core:query/session-settings@1` is
	 * the one re-read, for a node placed after a write.
	 *
	 * Null only when the session is gone, in which case the input is handed
	 * on untouched and the run halts where it always has.
	 */
	const { resolveSessionSettings } = await import(
		"$lib/server/sessions/settings"
	)
	const session = await resolveSessionSettings(request.db, request.sessionId)
	const input =
		session &&
		request.input &&
		typeof request.input === "object" &&
		!Array.isArray(request.input)
			? {
					...(request.input as Record<string, unknown>),
					session,
					/**
					 * The document's **cast**, beside it (PLAN §8 (17)).
					 *
					 * `core:inlet/session-event@1` declares `cast` as its own
					 * port because a data edge is `{ node, port }` and
					 * nothing addresses a field inside a port's value — so
					 * the turn-order spec wires the pool's `cast` from here.
					 * The same value, projected once: an inlet that declares
					 * no `cast` port simply never publishes it.
					 */
					cast: session.cast
				}
			: request.input

	const receipt = await run(doc, {
		world,
		input,
		runId,
		seed,
		triggerSource: request.preview ? "ui" : "event",
		preview: request.preview,
		// Pinned on the receipt at construction — before node 1 runs.
		portrayals,
		// The swaps seated above, so each row says pin or swap (F2).
		swaps,
		// How the run was reached — a session preset's fallback — recorded
		// on the receipt as `meta` (SDK `ReceiptMeta`) at construction.
		...(request.meta && Object.keys(request.meta).length
			? { meta: request.meta }
			: {}),
		// Where this run stands in its tree, likewise (01 §8; U5d).
		lineage: request.lineage,
		// Core's bindings, with a plugin's process-transport nodes beside
		// them — a collision is impossible by construction (namespaced ids,
		// core: reserved at registration).
		// The run travels into core's bindings for one reason: a context
		// template or a variable layout can name a *plugin's* template engine,
		// and that render is a sandboxed hook call. Without the run id on it,
		// cancelling this run stops the executor between nodes and leaves the
		// render going — the SDK's `TaskCtx` carries no run id for a binding to
		// read, so this is where the association has to be made.
		bindings: { ...coreBindings({ runId, user }), ...pluginNodes },
		host: createHost(request.db, scope),
		// The script engine, behind the executor's seam (18 §4a). Chains are
		// config, so which ones run is already decided by the world above;
		// this is only *how* a link executes — sandboxed, seeded, recorded.
		...(scriptsOn
			? {
					applyScripts: makeScriptApplier(request.db, {
						seed,
						nowMs: Date.now(),
						// The speaker rides in beside the cast names: the
						// side-character hook declares `speakerName`,
						// `speakerCharacterId` and `speakerIsKnown` as extras,
						// and a declared extra a host never supplies is a
						// control with no effect wearing a contract.
						extras: await scriptExtras(request.db, {
							...scope,
							speaker: request.sideCharacter ?? null,
							// The settings document (§4.12, way 3): every
							// script point declares `session`; this is where
							// it gets its value, from the one resolution above.
							session
						}),
						// The connection's own stop guards ride along (18 §4b):
						// resolved by the same rule dispatch uses — the instance
						// default — so every spec running against that endpoint
						// inherits its model knowledge.
						connectionStops: await connectionStopsFor(request.db),
						// The extension-hook executor and the identity a plugin
						// link's invocation record carries. Undefined here means
						// the applier runs core scripts exactly as before.
						pluginDispatch,
						runId,
						user
					})
				}
			: {}),
		onNode: status
			? (event) => {
					// A declared step status shows from the node's start, so a
					// step whose handler says nothing still says what it is.
					if (event.phase === "start") status.started(event.nodeKey)
					request.onNode?.(event)
				}
			: request.onNode,
		// A node's status, as the handler wrote it; the relay fills
		// `{speaker}` and routes it (R-19). Absent on a pre-call preview.
		...(status ? { onStatus: (nodeKey, text) => status.set(nodeKey, text) } : {}),
		cancelSignal: request.cancelSignal,
		/**
		 * The run-level guarantee (R-17): a row this run created and did not
		 * fill is finalised here — stopped with the partial text, failed with
		 * the reason, released if the run merely ended. Awaited by the
		 * executor before the receipt is returned, so the row is settled
		 * before the receipt is stored. The status relay ends after it, so
		 * the session list hears `null` once the row has settled.
		 */
		onRunEnd: async (end) => {
			// `status.end()` in `finally`: a row that failed to finalise must
			// not also leave the session list stuck on the run's last status —
			// a rejecting `finish` would otherwise skip straight past it and
			// leave "is typing" showing for a run that is over.
			try {
				await live.finish({
					kind: end.kind,
					liveRow: end.liveRow,
					reason: end.receipt.haltReason
				})
			} finally {
				// What the run was doing when it died (R-21): the receipt's one
				// status, with `{speaker}` filled the way every shown one was —
				// done here, before the receipt is stored or returned.
				if (end.receipt.lastStatus && status)
					end.receipt.lastStatus = {
						...end.receipt.lastStatus,
						text: await status.fill(end.receipt.lastStatus.text)
					}
				await status?.end()
			}
		},
		// The connection's `tokenCounter` column, reaching the thing it was
		// always supposed to configure — read off THIS run's world, for the
		// connection the budget's provider resolves to (R-8: one resolution,
		// no second walk). An id rather than a function: the SDK loads it once
		// before the run and counts synchronously afterwards, so the
		// allocation loop stays a loop. An id nobody can load degrades to the
		// rough estimate and says so on the receipt — a tokenizer never fails a
		// turn.
		tokenizer: tokenizerFor(world, doc),
		// Every run can park at a gated node — the review position is a
		// config option (`settings.review`), so whether it *does* is the
		// person's to decide in the panel, never the trigger's to wire.
		reviewer: createReviewer({
			userId: request.userId,
			sessionId: request.sessionId,
			specId,
			signal: request.signal,
			...(request.onParked
				? { onParked: () => request.onParked!({ runId, specId }) }
				: {})
		})
	})

	// Recorded before returning, and never allowed to fail the turn. A run that
	// produced a good reply and then could not write its own receipt has still
	// produced a good reply.
	if (!request.skipReceipt)
		await saveReceipt(request.db, receipt, {
			sessionId: request.sessionId,
			userId: request.userId,
			/**
			 * What the caller named, then everything the run actually wrote,
			 * in the order it wrote it.
			 *
			 * One list rather than a precedence rule between two sources: a run
			 * can legitimately do both — write into a row the trigger created
			 * *and* create rows of its own — and the old "the Consumer's id
			 * wins, else the caller's" could only ever record one of them.
			 */
			artifacts,
			// The session hears its lore was ranked once the store commits (R81).
			io: request.io
		})

	/**
	 * The forms this run put to a person, announced now: whatever the run's
	 * outcome, a form it wrote is on the row and waits. Before the AI's
	 * dispatch below, which may take a model call. Never throws.
	 */
	if (formsAwaitingPeople.length) {
		try {
			const { raiseOpenForms } = await import(
				"$lib/server/notifications/openForm"
			)
			await raiseOpenForms(request.db, request.sessionId, formsAwaitingPeople)
		} catch (err) {
			console.warn(`[forms] open-form notifications for run ${runId} failed:`, err)
		}
	}
	/**
	 * The forms this run put to the AI, answered now (R-15 *Forms*; U5d):
	 * each is a `form-addressed` dispatch — a child run, receipted with this
	 * run as its parent, held to the cycle caps — awaited here so the whole
	 * tree completes before this run's caller returns, and a stop on this
	 * run reaches them. Only a run that went to the end asks: a halted or
	 * cancelled run's forms wait like a person's would. Never lets a child's
	 * failure fail this run — the child's receipt says what happened.
	 */
	if (addressed.length && receipt.outcome === "ok")
		await dispatchAddressedForms(request, receipt, addressed)
	/**
	 * The fires this run's answers made (W2), dispatched now for the same
	 * reasons — after the receipt, awaited, stoppable through this run's
	 * signal, never failing this run. The caps were asked at the commit
	 * (`answer-form`): a fire it refused carries the cap and is receipted
	 * here, after this run's own row (S-b), on a run that halted on it;
	 * every other fire is admitted and dispatched only when this run went
	 * to the end. `fireAction`'s own refusals are receipted as halted runs
	 * the tree's reader can see.
	 */
	if (fires.length) await dispatchFires(request, receipt, fires)

	return receipt
}

/**
 * Dispatch every fire a run's `answer-form` commits collected (U5d review,
 * W2), in order, through `fireAction` — the road a click takes — as the
 * addressee, under the run owner, as children of the run whose receipt was
 * just saved. The run's pinned portrayals ride along (W3): the answer was
 * the AI's when this run started, and a member joining as the addressee
 * mid-answer does not flip it.
 *
 * **Every fire leaves a row under its own id** — the answer's receipt names
 * `firedRunId`, and a run the inspector cannot find is worse than one that
 * says why it never ran:
 *
 * - a fire the commit's cap **refused** (`refused`, S-b) is receipted here,
 *   after the parent's row, and never dispatched;
 * - a `refused` outcome — the form was answered meanwhile, the action turned
 *   off — is receipted as a halted run;
 * - a `stopped` outcome with no receipt — the parent was stopped before the
 *   fire started (W-a) — is receipted as `cancelled`, actor and reason as
 *   the executor would have stamped them;
 * - a throw on the way (W-a) is receipted as a halt on the error's sentence,
 *   and never fails this run;
 * - a run **parked** at review (R-b) leaves no row yet: it keeps its handle,
 *   its receipt lands when the owner decides, and this tree returns without
 *   it so the trigger lock and the ack are released.
 */
async function dispatchFires(
	request: SpecRunRequest,
	receipt: Receipt,
	fires: ReadonlyArray<PendingFire>
): Promise<void> {
	const { fireAction } = await import("$lib/server/pipelines/runtime/fireAction")
	const { refusalReceipt } = await import(
		"$lib/server/pipelines/runtime/sessionEvents"
	)
	const lineage = childLineage({ runId: receipt.runId, lineage: request.lineage })
	const row = async (
		fire: PendingFire,
		reason: string,
		stop?: { by: string }
	) => {
		try {
			await refusalReceipt(request.db, {
				runId: fire.runId,
				specId: fire.specId,
				sessionId: request.sessionId,
				userId: request.userId,
				lineage,
				reason,
				...(stop ? { outcome: "cancelled" as const, cancelledBy: stop.by } : {})
			})
		} catch (err) {
			// The row is the last resort; failing to write it must not take
			// the parent's return with it.
			console.warn(`[forms] the fire ${fire.runId} could not be receipted:`, err)
		}
	}
	for (const fire of fires) {
		if (fire.refused) {
			await row(fire, fire.refused)
			continue
		}
		// A run that did not go to the end fires nothing: a fire collected
		// by a run that was then stopped, or halted at a later node, is not
		// an answer the story has. (A cap's own halt carries `refused` and
		// was receipted above.)
		if (receipt.outcome !== "ok") continue
		try {
			await announceChildRun(request, receipt, fire.specId)
			const outcome = await fireAction(request.db, {
				sessionId: request.sessionId,
				action: fire.action,
				messageId: fire.messageId,
				blockId: fire.blockId,
				payload: fire.payload,
				actor: { userId: request.userId, as: fire.as },
				runId: fire.runId,
				io: request.io,
				parentSignal: request.signal,
				lineage,
				portrayals: receipt.portrayals,
				onProgress: request.sink?.onProgress,
				onStatus: request.onStatus,
				onParked: request.onParked,
				// A child parked at review settles long after every root has
				// pushed (U5e, review W-A2): its own settle re-sends the
				// list, or the grey it left stays until someone reloads.
				onSettled: () => {
					void import("$lib/server/sessions/actionsPush").then(
						({ pushSessionActions }) =>
							pushSessionActions(request.io, request.sessionId)
					)
				}
			})
			if (outcome.kind === "refused") await row(fire, outcome.error)
			else if (outcome.kind === "stopped" && !outcome.receipt)
				await row(fire, outcome.reason, { by: outcome.by })
		} catch (err) {
			console.warn(
				`[forms] the answer to form ${fire.blockId} on message ${fire.messageId} did not fire:`,
				err
			)
			await row(
				fire,
				`the fire did not run: ${err instanceof Error ? err.message : String(err)}`
			)
		}
	}
}

/**
 * A child run is starting: one frame on the parent's progress card naming
 * it (U5d review, S4) — *Answer a form (chat)*, the spec's display name —
 * so the person who pressed sees the tree being made, before the child's
 * own statuses arrive on the same card.
 *
 * The frame CLEARS the standing status (`status: null`), and has to: the
 * card shows a status in place of the stage, and a status once sent stands
 * until the next — so the parent's last status (*is thinking*) hid every
 * child's stage, and the tree was invisible from the card (2026-09-17). A
 * status is about the node that set it, and that node's run has ended; the
 * child's own statuses replace the stage as they arrive, as before.
 */
async function announceChildRun(
	request: SpecRunRequest,
	receipt: Receipt,
	specId: string
): Promise<void> {
	if (!request.sink?.onProgress) return
	const [spec] = await request.db
		.select({ name: schema.pipelineSpecs.name })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, specId))
		.limit(1)
	// No `runId` and no `specId`: the SINK keys the frame. On the trigger
	// road `fireAction`'s wrapper stamps its own run's id and spec after the
	// spread, so the child's stage lands on the root's card (S4); a sink that
	// spreads the event LAST (`runReply.progress`) would otherwise take a key
	// this function chose, and a frame keyed to a run the client never saw
	// start is a card nobody can clear (2026-09-17 review, W2).
	request.sink.onProgress({
		sessionId: request.sessionId,
		stage: spec?.name ?? specId,
		status: null
	} as RunProgress)
}

/** The document's inlet, pinned — `core:inlet/user-message@1` — or undefined for a document with none. */
function inletDefinitionIdOf(doc: {
	nodes: Array<{ kind: string; definitionId: string; definitionVersion: number }>
}): string | undefined {
	const inlet = doc.nodes.find((n) => n.kind === "inlet")
	return inlet ? `${inlet.definitionId}@${inlet.definitionVersion}` : undefined
}

/**
 * Dispatch every `form-addressed` event a run collected, in order, through
 * the same path the lifecycle events take (`dispatchSessionEvent`), as
 * children of the run that wrote the forms.
 */
async function dispatchAddressedForms(
	request: SpecRunRequest,
	receipt: Receipt,
	addressed: ReadonlyArray<{ payload: FormAddressedPayload; form: FormBlock }>
): Promise<void> {
	const { dispatchSessionEvent } = await import(
		"$lib/server/pipelines/runtime/sessionEvents"
	)
	const { parseParticipantRef } = await import("@serene-pub/sdk")
	const { participantRowId } = await import(
		"$lib/server/pipelines/runtime/portrayals"
	)
	const [session] = await request.db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, request.sessionId))
		.limit(1)
	const genreId = session?.genreId ?? "core:genre/chat"
	const lineage = childLineage({ runId: receipt.runId, lineage: request.lineage })
	const { resolveSessionEventSpec } = await import(
		"$lib/server/pipelines/runtime/sessionEvents"
	)
	const answerSpec = await resolveSessionEventSpec(
		request.db,
		genreId,
		sessionEvents.formAddressed,
		{ sessionId: request.sessionId }
	)
	for (const { payload, form } of addressed) {
		const parsed = parseParticipantRef(payload.addressee)
		try {
			if (answerSpec) await announceChildRun(request, receipt, answerSpec)
			await dispatchSessionEvent(request.db, {
				sessionId: request.sessionId,
				userId: request.userId,
				genreId,
				event: sessionEvents.formAddressed,
				lineage,
				io: request.io,
				signal: request.signal,
				// The child's frames ride the parent's card (S4), and a park
				// anywhere under it reaches whoever holds the ack (R-b).
				sink: request.sink,
				onStatus: request.onStatus,
				onParked: request.onParked,
				input: {
					main: payload,
					sessionScope: {
						sessionId: request.sessionId,
						currentCharacterId: null
					},
					sessionId: request.sessionId,
					messageId: payload.messageId,
					blockId: payload.blockId,
					form,
					action: payload.action,
					addressee: payload.addressee,
					characterId:
						parsed.kind === "character" ? participantRowId(parsed.id) : null,
					fields: await genreFieldsFor(request.db, request.sessionId)
				}
			})
		} catch (err) {
			console.warn(
				`[forms] answering the form ${payload.blockId} on message ${payload.messageId} failed:`,
				err
			)
		}
	}
}

/**
 * Run a turn and return its receipt.
 *
 * The receipt is the return value rather than the generated text, and that is
 * deliberate: a caller needs to know *whether* it ran, what it decided, and what
 * it wrote, and a turn that halted legibly is a normal outcome rather than an
 * exception. Text is on the receipt for callers that only want that.
 */
export async function runTurn(request: TurnRequest): Promise<Receipt> {
	// The speaker as a reference: what the caller said, else the bare id
	// spelled as one, else nobody (a narrator turn).
	const speaker: ParticipantRef | null =
		request.speaker !== undefined
			? request.speaker
			: request.currentCharacterId != null
				? `character:${request.currentCharacterId}`
				: null
	// Hoisted from `runSpec` so the changes below can be marked as read by
	// the run that reads them, under the id that run's receipt carries.
	const runId = request.runId ?? uuidv4()
	/**
	 * What the built-ins did since the last reply (R-15): the inlet's
	 * `sessionChanges` port. A real turn CONSUMES them — each change is
	 * delivered to at most one run — and a preview or a comparison run only
	 * looks: the token estimate fires on every keystroke and must never eat
	 * what the turn should see.
	 *
	 * Read now, marked AFTER the run, and only when the run produced a reply
	 * (U5b review W1): a turn that fails at the oracle, or is stopped before
	 * it wrote, saw the changes in no sense that matters, and the next turn
	 * must see them. The mark is by the ids read here AND still-unconsumed,
	 * so two runs racing on the same read cannot both claim a row — the
	 * loser's mark comes back short, which is logged below rather than
	 * assumed away. A change written while this run ran is left for the
	 * next one either way.
	 */
	/**
	 * Who **pressed** — the inlet's `presser` port (G9, 2026-09-17).
	 *
	 * The run's owner, as a participant reference: their persona in this
	 * session where they have one (`character:<id>` — a persona IS a
	 * character, and a line written as them is written as that
	 * character), else themselves. The same resolution a form answered by
	 * nobody in particular already used, so the two cannot disagree about who
	 * a person is here.
	 *
	 * ⚠ Not `speaker`. `speaker` is whose turn it is — who the reply comes
	 * out as — and on nearly every turn the two differ: a person types and a
	 * character answers. This is the other end of that sentence, and the port
	 * a spec wires into `create-message@1`'s `speaker` to write a line AS the
	 * person who pressed.
	 */
	const presserPresence = await ownPresence(
		request.db,
		request.sessionId,
		request.userId
	)
	const presser: ParticipantRef =
		presserPresence !== null
			? `character:${presserPresence}`
			: `user:${request.userId}`
	const looking = !!(request.preview || request.skipReceipt)
	const pending = looking
		? {
				changes: await peekSessionChanges(
					request.db,
					request.sessionId
				),
				ids: [] as number[]
			}
		: await pendingSessionChanges(request.db, request.sessionId)
	const receipt = await runSpec({
		db: request.db,
		sessionId: request.sessionId,
		userId: request.userId,
		specId: request.specId ?? RESPOND_SPEC_ID,
		currentCharacterId: request.currentCharacterId,
		speaker,
		draftMessage: request.draftMessage,
		sideCharacter: request.sideCharacter ?? null,
		verb: request.verb,
		channel: request.channel,
		previous: request.previous,
		io: request.io,
		onNode: request.onNode,
		onStatus: request.onStatus,
		input: {
			text: request.text,
			/**
			 * The extend verb's one value (ruling 2026-09-08, D-2). Empty on
			 * every other turn — the port resolves, the seed line renders
			 * empty, and the model starts the reply as it always did. Specs
			 * whose input type declares no such port never resolve it.
			 */
			continuationPrefill: request.continuationPrefill ?? "",
			/**
			 * Which channel the triggering message is on (R-C, 2026-09-17).
			 * Always supplied — `main` when the trigger named none — for the
			 * same reason `continuationPrefill` always carries `""`: a port a
			 * junction may compare against is no use if half the turns leave
			 * it unresolved. Specs whose input type declares no such port
			 * never resolve it.
			 */
			channel: resolveChannel(request.channel),
			// How the turn was reached (R8) — always supplied, for the same
			// reason `channel` is: a junction compares against it.
			via: request.via ?? "",
			// The side-character trigger's first step, on the input node's own
			// port — so the receipt answers "why did this turn sound like
			// Vell" afterwards rather than only the trigger knowing. Null on
			// every other pipeline, whose input types declare no such port and
			// therefore never resolve it.
			sideCharacter: request.sideCharacter ?? null,
			// Whose turn it is, as a participant reference (R-18 (3)) — the
			// one port that answers "who is speaking" for a library character
			// and a genre's envoy alike. `characterId` beside it is the same
			// answer as a bare id, one release longer, for the readers that
			// still take the id.
			speaker,
			// And who PRESSED — see above. Always supplied, for the reason
			// `channel` always is: a port a spec may wire is no use if half
			// the turns leave it unresolved.
			presser,
			// Both as ports and bundled. A query that wants the pair takes the
			// scope; a node that wants only the speaker takes the id, instead
			// of accepting the whole scope and reaching into it.
			sessionId: request.sessionId,
			characterId: request.currentCharacterId ?? null,
			// The speaker rides on the session scope: a scope for a turn is this
			// session *and* whose turn it is.
			sessionScope: {
				sessionId: request.sessionId,
				currentCharacterId: request.currentCharacterId
			},
			// The row a verb re-drives, for the placeholder outlet to claim
			// (R-17). Null on a fresh turn, which inserts.
			messageId: request.messageId ?? null,
			// What the built-ins did since the last reply — see above.
			sessionChanges: pending.changes,
			// The mode's declared fields, supplied back (19 §1): session settings
			// wrote them to the row; this is where they enter the run, filtered
			// to the shape's declared keys — see genreFieldsFor.
			fields: await genreFieldsFor(request.db, request.sessionId)
		},
		seed: request.seed,
		runId,
		sink: request.sink,
		signal: request.signal,
		cancelSignal: request.cancelSignal,
		preview: request.preview,
		skipReceipt: request.skipReceipt,
		meta: request.meta,
		overrides: request.overrides,
		...(request.auto ? { auto: true } : {})
	})
	if (pending.ids.length && producedReply(receipt)) {
		const marked = await markSessionChangesConsumed(
			request.db,
			pending.ids,
			runId
		)
		if (marked < pending.ids.length)
			console.warn(
				`[runTurn] ${pending.ids.length - marked} session changes were already delivered to another run`,
				{ sessionId: request.sessionId, runId }
			)
	}
	return receipt
}

/**
 * Did this turn leave a reply behind — the condition for the session changes
 * it was handed to count as read (U5b review W1)?
 *
 * `ok` did. A `halt` did when the finishing write had already landed before
 * the halt (a later node stopping the run after `update-message` committed);
 * a halt before it — a reviewer's reject, an empty completion — left the row
 * failed and the changes unread. An error or a cancellation never did: a
 * stopped reply keeps its partial text, but the turn was taken from the
 * person, not finished, and the next one must still be told what moved.
 */
function producedReply(receipt: Receipt): boolean {
	if (receipt.outcome === "ok") return true
	if (receipt.outcome !== "halt") return false
	return receipt.nodes.some(
		(n) =>
			n.definitionId === "core:outlet/update-message@1" &&
			n.result === "ok" &&
			!n.dry
	)
}

/** The text a completed turn produced, or null if it did not produce one. */
export function generatedText(receipt: Receipt): string | null {
	const node = receipt.nodes.find(
		(n) => n.definitionId === "core:oracle/generate-text@1"
	)
	const text = (node?.output as { text?: unknown } | null | undefined)?.text
	return typeof text === "string" && text.length > 0 ? text : null
}

/**
 * Why a turn produced nothing, in a sentence a user could be shown.
 *
 * A halt is not a failure — an aborted generation and an empty completion both
 * halt — so this reads the receipt rather than assuming an error. Returns null
 * when the run finished normally.
 */
export function haltExplanation(receipt: Receipt): string | null {
	if (receipt.outcome === "ok") return null
	const at = receipt.haltNodeKey
	const why = receipt.haltReason ?? "the run stopped without saying why"
	return at ? `${why} (at '${at}')` : why
}
