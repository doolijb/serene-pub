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
	type FormAddressedPayload,
	type FormBlock,
	type NodeEvent,
	type ParticipantRef,
	type Receipt,
	type StatusText
} from "@serene-pub/sdk"
import {
	childLineage,
	releaseRoot,
	type RunLineage
} from "$lib/server/pipelines/runtime/lineage"
import { createReviewer } from "$lib/server/pipelines/runtime/reviewGate"
import { createHost, type HostScope } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { pluginNodeBindings } from "$lib/server/pipelines/runtime/pluginBindings"
import {
	loadPublished,
	RESPOND_SPEC_ID
} from "$lib/server/pipelines/boot/bootstrap"
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
import { createStatusRelay } from "$lib/server/pipelines/runtime/runStatus"
import { narratingProvider } from "$lib/server/pipelines/runtime/specShape"
import {
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
import type { PluginHookDispatch } from "$lib/server/pipelines/scripts/pluginDispatch"
import { v4 as uuidv4 } from "uuid"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

export class PipelineUnavailableError extends Error {}

// db is the global Db — see db/types.d.ts

export interface TurnRequest {
	db: Db
	sessionId: number
	userId: number
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
	 * Text an in-progress reply has already produced — a **continue** (ruling
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
	 * The reply row this turn re-drives — a regenerate, swipe or continue of a
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
	meta?: Record<string, unknown>
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
	 * `continue` — when one is (R-15, 2026-09-16). Reaches the host scope,
	 * where `update-message`'s finishing write puts it on the
	 * `message-updated` it records for the next reply's inlet: a rewrite is
	 * a change to history a pipeline has seen, and which verb made it is
	 * the fact worth carrying. Absent on a fresh turn and on every run that
	 * is not a reply.
	 */
	verb?: "regenerate" | "swipe" | "continue"
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
	 */
	meta?: Record<string, unknown>
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
	const doc = await applyNodeRebinds(request.db, loaded, {
		specSlug: specId,
		sessionId: request.sessionId
	})

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
	 * The run's live row — core's half of the pipeline owning its row. Which
	 * oracle streams is read off the document once (`narratingProvider`): a
	 * multi-stage spec's planner and keeper must not write JSON into the row
	 * the narrator is filling. The executor says WHICH row; this says what
	 * happens to it.
	 */
	const live = createLiveRow({
		db: request.db,
		io: request.io,
		sessionId: request.sessionId,
		runId,
		streamingNode: narratingProvider(doc)
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
					onStatus: request.onStatus
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
		previous: request.previous,
		// Which document this is, so the built-in writes can refuse to
		// perform under any but their own (U5b review W8).
		specId,
		// What this document contributes and how it was entered (U5d): the
		// message writes stamp a block's action from the former and refuse a
		// function the document declares no action for; `answer-form` refuses
		// to perform under any inlet but `form-addressed@1` by the latter.
		contributes: doc.contributes,
		inletDefinitionId: doc.input
			? `${doc.input.definitionId}@${doc.input.definitionVersion}`
			: undefined,
		lineage: request.lineage,
		addressed,
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
				user
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

	const receipt = await run(doc, {
		world,
		input: request.input,
		runId,
		seed,
		triggerSource: request.preview ? "ui" : "event",
		preview: request.preview,
		// Pinned on the receipt at construction — before node 1 runs.
		portrayals,
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
							speaker: request.sideCharacter ?? null
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
		onNode: request.onNode,
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
			signal: request.signal
		})
	})

	/**
	 * How the run was reached, stamped on the receipt before it is stored or
	 * returned.
	 *
	 * On the receipt rather than in a column beside it: a substitution is
	 * something the reader of *this run* needs, and the receipt is the one
	 * thing every explain surface already loads. Merged rather than assigned,
	 * so a second dispatch fact later does not have to displace this one.
	 */
	if (request.meta && Object.keys(request.meta).length) {
		const carrier = receipt as Receipt & { meta?: Record<string, unknown> }
		carrier.meta = { ...(carrier.meta ?? {}), ...request.meta }
	}

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
			artifacts
		})

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
	// A root that has finished takes its descendant count with it.
	if (!request.lineage) releaseRoot(runId)

	return receipt
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
	for (const { payload, form } of addressed) {
		const parsed = parseParticipantRef(payload.addressee)
		try {
			await dispatchSessionEvent(request.db, {
				sessionId: request.sessionId,
				userId: request.userId,
				genreId,
				event: "core:event/form-addressed@1",
				lineage,
				io: request.io,
				signal: request.signal,
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
		previous: request.previous,
		io: request.io,
		onNode: request.onNode,
		onStatus: request.onStatus,
		input: {
			text: request.text,
			/**
			 * The continue verb's one value (ruling 2026-09-08, D-2). Empty on
			 * every other turn — the port resolves, the seed line renders
			 * empty, and the model starts the reply as it always did. Specs
			 * whose input type declares no such port never resolve it.
			 */
			continuationPrefill: request.continuationPrefill ?? "",
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
		overrides: request.overrides
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
