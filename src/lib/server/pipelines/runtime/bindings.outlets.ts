/**
 * Outlet bindings: the consumers that describe a write for the host to commit,
 * the scene queries beside them, the sprite steps and the built-in writes.
 * `coreBindings()` spreads this map.
 *
 * Imports helpers from `bindings.shared.ts`, never from `bindings.ts`.
 */

import { seatOf } from "$lib/server/sessions/seats"
import type { Bindings } from "@serene-pub/sdk"
import { ok, halt, reads, parseParticipantRef } from "@serene-pub/sdk"
import { pickSpriteBySimilarity } from "$lib/shared/sprites/pick"
import { speakerInCastQuery } from "./bindings.shared"
import type { SpriteChoicesV1 } from "$lib/server/sprites/choices"
/**
 * The node declarations themselves, as types.
 *
 * `import type`, so `verbatimModuleSyntax` erases it outright: importing
 * contracts for real would run `describeQueryDefinition`'s `register()` for every core
 * type as a side effect of loading the runtime, which is the boot sequence's job
 * and not this file's.
 */
import type * as C from "@serene-pub/contracts"
import type {
	OutletCtx,
	CoreQueryCtx,
	NodeInput,
	OracleCtx
} from "./bindingTypes"
import {
	knowledgeDropOf,
	knowledgeDropReceipt,
	type KnowledgeDrop
} from "$lib/server/lorebooks/entryKnowledge"
import { type RenderRun } from "$lib/server/pipelines/prompt/renderers"
import type { SpeakerInCastRead } from "$lib/server/sessions/speakerInCast"

/**
 * The card a line's speaker has, when it has one — `character:<id>`'s id, the
 * one participant reference a sprite can belong to. Anything else (a
 * narrator's line wires no speaker; an envoy, a person, a role) is null, and
 * so is a reference that does not parse.
 */
const speakingCharacterId = (speaker: unknown): number | null => {
	if (typeof speaker !== "string") return null
	try {
		const parsed = parseParticipantRef(speaker)
		if (parsed.kind !== "character") return null
		const id = Number(parsed.id)
		return Number.isInteger(id) && id > 0 ? id : null
	} catch {
		return null
	}
}

/**
 * 🚧 A commit that refused in words (`{ halt: '…' }` from the host — a library write under the person's Off mode,
 * a conversion nobody may make) halts the run with that sentence; anything else is the commit's ids, as before.
 * The convention the seat and composer outlets spell out by hand (M2c path B: the library outlets' Off sentence
 * reached no one because the binding wrapped it as ids).
 */
const committedOrHalt = (r: unknown) => {
	const { halt: halted, ...ids } = (r ?? {}) as Record<string, unknown> & { halt?: unknown }
	return typeof halted === "string" ? halt(halted) : ok(ids)
}

export function outletBindings(run: RenderRun = {}): Bindings {
	return {
		// ── Consumers ───────────────────────────────────────────────────────
		// The binding describes the write; the host performs it. Returning the
		// payload unchanged is the correct implementation, not a stub.
		//
		// What an outlet READS is what its commit case in `host.ts` takes off
		// the payload it is handed whole — so the declaration below is the
		// host's, written at the binding because the binding is what is bound.
		// A port declared here that the commit case never looks at is the same
		// dead control as anywhere else, one file along.
		/**
		 * The turn-order write (PLAN-turn-order §4.4, §4.2) — through the
		 * host's commit, like every other write outlet. The binding declares
		 * the node; the host owns the rows, the drops it makes before
		 * writing (a ref the pool did not admit, a channel this session does
		 * not have) and `writeTurnOrder`'s staleness rule. The emission of
		 * `turn-order-changed` is the executor's, off `causesEvent`.
		 */
		"core:outlet/set-turn-order@1": reads<typeof C.setTurnOrder>(
			async (input: NodeInput<typeof C.setTurnOrder>, ctx: OutletCtx) =>
				ok(await ctx.commit(input)),
			{ ports: ["order", "candidates", "basedOnAt", "event", "cause"] }
		),
		/**
		 * The annex write (§4.3), likewise: the host merges the owner's
		 * document under the annex's advisory lock. `owner` defaults to the
		 * running spec's own namespace, and naming another one needs
		 * `sharedAnnex` — the host refuses otherwise, with a receipt note.
		 */
		"core:outlet/set-session-annex@1": reads<typeof C.setSessionAnnex>(
			async (input: NodeInput<typeof C.setSessionAnnex>, ctx: OutletCtx) =>
				ok(await ctx.commit(input)),
			{ ports: ["value", "base"], params: ["owner", "merge", "sharedAnnex"] }
		),
		/**
		 * An annex field's write (2026-09-26): the host reads the field's
		 * declaration off the payload's identity, checks the value against
		 * its shape and writes it through the annex write above.
		 */
		"core:outlet/set-annex-field@1": reads<typeof C.setAnnexField>(
			async (input: NodeInput<typeof C.setAnnexField>, ctx: OutletCtx) =>
				ok(await ctx.commit(input)),
			{ ports: ["payload"] }
		),
		/** 🚧 The lorebook annex's two writes (M0, SHAPES L9): the host's commit routes them. */
		"core:outlet/set-lorebook-annex@1": reads<typeof C.setLorebookAnnex>(
			async (input: NodeInput<typeof C.setLorebookAnnex>, ctx: OutletCtx) =>
				ok(await ctx.commit(input)),
			{ ports: ["value", "base"] }
		),
		"core:outlet/set-lorebook-annex-field@1": reads<typeof C.setLorebookAnnexField>(
			async (input: NodeInput<typeof C.setLorebookAnnexField>, ctx: OutletCtx) =>
				ok(await ctx.commit(input)),
			{ ports: ["payload"] }
		),
		/**
		 * 🚧 A player seat named by a pipeline (Dungeon Crawler's interview,
		 * 2026-10-15): the host's commit is the seat-name door
		 * (`sessions/seatName.ts`); the seat it named is lifted beside the
		 * write result, as one reference and as a one-item list for
		 * `resolve-state-changes`' `owners`.
		 */
		"core:outlet/set-seat-name@1": reads<typeof C.setSeatName>(
			async (input: NodeInput<typeof C.setSeatName>, ctx: OutletCtx) => {
				const { seat, halt: halted, ...ids } = (await ctx.commit(input)) as {
					seat?: unknown
					halt?: unknown
				}
				if (typeof halted === "string") return halt(halted)
				const ref = typeof seat === "string" ? seat : null
				return ok({
					status: "committed",
					ids,
					seat: ref,
					seats: ref ? [ref] : []
				})
			},
			{ ports: ["user", "name", "retire"] }
		),
		/**
		 * 🚧 A seat benched or brought back by a genre's pipeline (owner
		 * 2026-11-10): the host's commit is `setSeatBench`, behind
		 * `writes.seats`; the seat it changed is lifted beside the write
		 * result as one reference and a one-item list.
		 */
		"core:outlet/set-seat-bench@1": reads<typeof C.setSeatBench>(
			async (input: NodeInput<typeof C.setSeatBench>, ctx: OutletCtx) => {
				const { seat, halt: halted, ...ids } = (await ctx.commit(input)) as {
					seat?: unknown
					halt?: unknown
				}
				if (typeof halted === "string") return halt(halted)
				const ref = typeof seat === "string" ? seat : null
				return ok({
					status: "committed",
					ids,
					seat: ref,
					seats: ref ? [ref] : []
				})
			},
			{ ports: ["seat", "benched"] }
		),
		/**
		 * 🚧 A composer opened or closed by the genre (owner ruling
		 * 2026-10-15): the host's commit is `writeComposerState`
		 * (`sessions/composerStates.ts`); a refusal halts with its sentence.
		 * `states` is the session's whole document after the write.
		 */
		"core:outlet/set-composer-state@1": reads<typeof C.setComposerState>(
			async (input: NodeInput<typeof C.setComposerState>, ctx: OutletCtx) => {
				const { states, halt: halted, ...ids } = (await ctx.commit(input)) as {
					states?: unknown
					halt?: unknown
				}
				if (typeof halted === "string") return halt(halted)
				return ok({ status: "committed", ids, states: states ?? {} })
			},
			{ ports: ["channel", "open", "reason", "person"] }
		),
		/**
		 * 🚧 The judged scene check's answer (sprint 2, pass 7, R-i): the host's
		 * commit is `offerJudgedSceneCue` (`scenes/boundaryWatcher.ts`), which
		 * re-checks the check's conditions and leaves a `judged` scene cue — the
		 * chip, or under Automatic the placed boundary. A malformed value halts
		 * with its sentence; a cue the conditions do not allow now is `skipped`,
		 * never a halt. `cue` is a `ProposedSceneCue`.
		 */
		"core:outlet/propose-scene-cue@1": reads<typeof C.proposeSceneCue>(
			async (input: NodeInput<typeof C.proposeSceneCue>, ctx: OutletCtx) => {
				const { cue, halt: halted, ...ids } = (await ctx.commit(input)) as {
					cue?: unknown
					halt?: unknown
				}
				if (typeof halted === "string") return halt(halted)
				return ok({ status: "committed", ids, cue: cue ?? null })
			},
			{ ports: ["at", "channel", "reason", "trigger"], params: ["ask"] }
		),
		/**
		 * 🚧 The scene summaries routine's look: the host reads
		 * `sceneSummaryDueOf` (`scenes/sceneSummaryDue.ts`), read-only. `main` is the
		 * oldest finished scene due a summary as its id, or `null`.
		 */
		"core:query/scene-summary-due@1": reads<typeof C.sceneSummaryDue>(
			async (input: NodeInput<typeof C.sceneSummaryDue>) => {
				const sessionId = input?.scope?.sessionId
				if (sessionId === undefined)
					return halt(
						"there is no session to look for a scene due a summary in — the run is not scoped to a session"
					)
				const raw = input?.params?.depth
				const depth = typeof raw === "number" && Number.isInteger(raw) && raw >= 1 ? raw : 6
				const db = (await import("$lib/server/db")).db as never
				const { sceneSummaryDueOf } = await import("$lib/server/scenes/sceneSummaryDue")
				const result = await sceneSummaryDueOf(db, sessionId, { depth })
				return ok({ main: result.sceneId })
			},
			{ ports: ["scope"], params: ["depth"] }
		),
		/**
		 * 🚧 *Earlier in the story*: the session's closed main-channel scenes with a
		 * usable summary (`earlierScenesOf`; compiled ones too while the timeline is off), read-only, with
		 * the block's share of the budget: `maxTokens = floor(share × budget.total)`,
		 * `null` with no usable budget. Which of them show is Assemble's call, once
		 * it knows which lines it keeps. Writes nothing.
		 */
		"core:query/earlier-scenes@1": reads<typeof C.earlierScenes>(
			async (input: NodeInput<typeof C.earlierScenes>, ctx: CoreQueryCtx) => {
				const sessionId = input?.scope?.sessionId
				if (sessionId === undefined)
					return halt(
						"there is no session to read earlier scenes from — the run is not scoped to a session"
					)
				const raw = input?.params?.share
				const share = typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.15
				const total = (input?.budget as { total?: unknown } | undefined)?.total
				const maxTokens =
					typeof total === "number" && Number.isFinite(total) && total > 0
						? Math.floor(share * total)
						: null
				const db = (await import("$lib/server/db")).db as never
				const { earlierScenesOf } = await import("$lib/server/scenes/earlierScenes")
				let scenes = await earlierScenesOf(db, sessionId)
				// 🚧 What the speaking character was there for: invoked only when the
				// `firsthandFor` port is wired (key present, even when null: a
				// narrator turn reads everything). Unwired: today's scenes, no
				// receipt line. A card-less seat's turn is named by the scope's
				// `currentCastMemberId`. The decision is `sessions/firsthandFilter.ts`.
				if (input !== undefined && input !== null && "firsthandFor" in input) {
					const by =
						typeof input.firsthandBy === "string" && input.firsthandBy.trim()
							? input.firsthandBy.trim()
							: null
					const { loadFirsthandView, keptSceneIds, scenesReceipt, readsAllReceipt } =
						await import("$lib/server/sessions/firsthandFilter")
					const read = await loadFirsthandView(db, {
						sessionId,
						characterId: input.firsthandFor,
						castMemberId: input?.scope?.currentCastMemberId,
						slotId: by,
						sceneIds: scenes.map((s) => s.sceneId)
					})
					if (read.kind === "reads-all") ctx.log("info", readsAllReceipt())
					else {
						const { keptIds, leftOut } = keptSceneIds(
							read.view,
							scenes.map((s) => s.sceneId)
						)
						const kept = new Set(keptIds)
						scenes = scenes.filter((s) => kept.has(s.sceneId))
						ctx.log("info", scenesReceipt(read.view, leftOut))
					}
				}
				// 🚧 Only scenes the speaker was in: on unless a pipeline says `false`
				// (the param's default is `true`). It runs after firsthand, on what is
				// left; no scenes, nothing to judge (no read, no receipt). The host
				// answers (`speaker_in_cast`), from the per-run load the lore read
				// shares. The decision is `sessions/speakerInCast.ts`.
				if (scenes.length && input?.params?.speakerInCast !== false) {
					const { keptScenesInCast, inCastScenesReceipt } = await import(
						"$lib/server/sessions/speakerInCast"
					)
					const { readsAllReceipt } = await import("$lib/server/sessions/firsthandFilter")
					const read = (await ctx.read("speaker_in_cast", {
						sessionId,
						currentCharacterId: input?.scope?.currentCharacterId ?? null,
						...(input?.scope?.currentCastMemberId != null
							? { currentCastMemberId: input.scope.currentCastMemberId }
							: {})
					})) as SpeakerInCastRead
					if (read.kind === "reads-all") ctx.log("info", readsAllReceipt())
					else {
						const { keptIds, leftOut } = keptScenesInCast(
							read.view,
							scenes.map((s) => s.sceneId)
						)
						const kept = new Set(keptIds)
						scenes = scenes.filter((s) => kept.has(s.sceneId))
						ctx.log("info", inCastScenesReceipt(read.view.name, leftOut))
					}
				}
				return ok({ main: { maxTokens, scenes } })
			},
			{
				ports: ["scope", "budget", "firsthandFor", "firsthandBy"],
				params: ["share", "speakerInCast"]
			}
		),
		/**
		 * 🚧 The entries the lines name: the own book's, then the attached
		 * lorebook's, whose name or key appears in one message row, as the session
		 * reads them (`entriesNamedIn`), within `floor(share × budget.total)`
		 * tokens. `ids` is what a write passes as `shown`. Writes nothing.
		 */
		"core:query/entries-named@1": reads<typeof C.entriesNamed>(
			async (input: NodeInput<typeof C.entriesNamed>, ctx?: CoreQueryCtx) => {
				const sessionId = input?.scope?.sessionId
				if (sessionId === undefined)
					return halt(
						"there is no session to read entries from — the run is not scoped to a session"
					)
				const listed = input?.params?.entryTypes
				const typeIds = (Array.isArray(listed) ? listed : []).filter(
					(t): t is string => typeof t === "string" && t.trim() !== ""
				)
				const rawMax = input?.params?.maxEntries
				const maxEntries =
					typeof rawMax === "number" && Number.isFinite(rawMax) ? Math.max(0, Math.floor(rawMax)) : 12
				const rawShare = input?.params?.share
				const share =
					typeof rawShare === "number" && Number.isFinite(rawShare) && rawShare >= 0 && rawShare <= 1
						? rawShare
						: 0.2
				const total = (input?.budget as { total?: unknown } | undefined)?.total
				const maxTokens =
					typeof total === "number" && Number.isFinite(total) && total > 0
						? Math.floor(share * total)
						: null
				const db = (await import("$lib/server/db")).db as never
				const { entriesNamedIn } = await import("$lib/server/pipelines/runtime/loreMatch")
				const { WORLD_LORE_TYPE_ID } = await import("$lib/shared/entries/types")
				const entryTypes = typeIds.length ? typeIds : [WORLD_LORE_TYPE_ID]
				// On unless a pipeline says `false` (the param's default is `true`).
				const knownToSpeaker = input?.params?.knownToSpeaker !== false
				// The speaker's judgement comes through the host read, so it is the same
				// per-run load every lore read shares; this read is for the judgement
				// alone (`limit: 1`), its row is not used. A run that speaks as nobody
				// reads everything: no read to make.
				const scopeSpeaks =
					input?.scope?.currentCharacterId != null ||
					input?.scope?.currentCastMemberId != null
				const judgement: KnowledgeDrop | undefined = !knownToSpeaker
					? undefined
					: !scopeSpeaks
						? { kind: "reads-all" }
						: typeof ctx?.read === "function"
						? knowledgeDropOf(
								await ctx.read("lorebook_entries", {
									knownToSpeaker: true,
									...speakerInCastQuery(input?.params),
									sessionId,
									currentCharacterId: input?.scope?.currentCharacterId ?? null,
									...(input?.scope?.currentCastMemberId != null
										? { currentCastMemberId: input.scope.currentCastMemberId }
										: {}),
									entryTypes,
									limit: 1
								})
							)
						: undefined
				const judged = judgement?.kind === "judged" ? judgement : undefined
				let skipped: number[] = []
				let historyLeft = 0
				const rows = await entriesNamedIn(db, sessionId, {
					typeIds: entryTypes,
					messages: input?.messages,
					maxEntries,
					maxTokens,
					countTokens: typeof ctx?.countTokens === "function" ? (t) => ctx.countTokens!(t) : undefined,
					...(judged ? { leaveOut: new Set(judged.leftOut.map((l) => l.entryId)) } : {}),
					onLeftOut: (ids) => (skipped = ids),
					onHistoryLeftOut: (n) => (historyLeft = n)
				})
				if (historyLeft > 0) {
					const { noteHistoryLeftOut, historyLeftOutReceipt } = await import(
						"$lib/server/pipelines/runtime/host.read.lorebookEntries"
					)
					noteHistoryLeftOut(rows, historyLeft)
					ctx?.log?.("info", historyLeftOutReceipt(rows) as string)
				}
				if (judgement) {
					const causeOf = new Map(judged?.leftOut.map((l) => [l.entryId, l.cause]))
					const own = skipped.map((entryId) => causeOf.get(entryId))
					ctx?.log?.(
						"info",
						knowledgeDropReceipt(
							judged
								? {
										kind: "judged",
										name: judged.name,
										notKnown: own.filter((c) => c === "not-known").length,
										keptFrom: own.filter((c) => c === "kept-from").length,
										leftOut: judged.leftOut
									}
								: judgement
						)
					)
				}
				const ids = rows.map((r) => r.entryId)
				if (run.runId && ids.length)
					(await import("$lib/server/pipelines/runtime/runRegistry")).earmark(
						run.runId,
						"entry",
						ids
					)
				return ok({ main: rows, ids })
			},
			{ ports: ["scope", "messages", "budget"], params: ["entryTypes", "maxEntries", "share", "knownToSpeaker", "speakerInCast"] }
		),
		/**
		 * 🚧 Summarize a finished scene: the host's commit starts the genre's own
		 * summarizer in the background (`startRoutineSceneSummary`,
		 * `sockets/scenes.ts`) and returns at once. `main` is
		 * `{ status: "committed", ids }`.
		 */
		"core:outlet/summarize-finished-scene@1": reads<typeof C.summarizeFinishedScene>(
			async (input: NodeInput<typeof C.summarizeFinishedScene>, ctx: OutletCtx) => {
				const { halt: halted, ...ids } = (await ctx.commit(input)) as Record<string, unknown> & {
					halt?: unknown
				}
				if (typeof halted === "string") return halt(halted)
				return ok({ status: "committed", ids })
			},
			{ ports: ["scene", "routine"] }
		),
		/**
		 * 🚧 A note in a scene (★S4, owner 2026-11-10): the host's commit is
		 * `appendSceneNote` (`scenes/liveScenes.ts`); a refusal throws with its
		 * sentence. `main` is `{ status: "committed", ids }` with the scene's id.
		 */
		"core:outlet/note-scene@1": reads<typeof C.noteScene>(
			async (input: NodeInput<typeof C.noteScene>, ctx: OutletCtx) => {
				const { halt: halted, ...ids } = (await ctx.commit(input)) as Record<string, unknown> & {
					halt?: unknown
				}
				if (typeof halted === "string") return halt(halted)
				return ok({ status: "committed", ids })
			},
			{ ports: ["text", "scene", "sources"] }
		),
		/**
		 * 🚧 A stat configured by a pipeline (owner ruling 2026-10-15): the
		 * host's commit is `setStatConfig` (`state/write.ts`), the writer a
		 * person's `state:configure` takes; a refusal halts with its sentence.
		 * `main` is `{ configId, owner, slot, before, config }`.
		 */
		"core:outlet/set-stat-config@1": reads<typeof C.setStatConfig>(
			async (input: NodeInput<typeof C.setStatConfig>, ctx: OutletCtx) => {
				const { halt: halted, ...main } = (await ctx.commit(input)) as Record<string, unknown> & {
					halt?: unknown
				}
				if (typeof halted === "string") return halt(halted)
				return ok({ main })
			},
			{ ports: ["owner", "slot", "config", "worldRow"] }
		),
		/** A declared event, recorded (E1b): the host checks scope, writes the ledger row, dispatches. */
		"core:outlet/record-event@1": reads<typeof C.recordEvent>(
			async (input: NodeInput<typeof C.recordEvent>, ctx: OutletCtx) =>
				ok(await ctx.commit(input)),
			{ ports: ["event", "payload"] }
		),
		"core:outlet/create-message@1": reads<typeof C.createMessage>(
			async (
				input: NodeInput<typeof C.createMessage>,
				ctx: OutletCtx
			) => ok(await ctx.commit(input)),
			{
				ports: [
					"text",
					"media",
					"characterId",
					"sideCharacter",
					"speaker",
					"generating",
					"narration",
					"instructions",
					"row",
					"channel",
					"blocks",
					"sections",
					"turnPlan",
					"role",
					"trayItems",
					"tableLine",
					"kind"
				]
			}
		),
		"core:outlet/seed-greetings@1": reads<typeof C.seedGreetings>(
			async (
				input: NodeInput<typeof C.seedGreetings>,
				ctx: OutletCtx
			) => ok(await ctx.commit(input)),
			{ ports: ["greetings", "channel"] }
		),
		"core:outlet/update-message@1": reads<typeof C.updateMessage>(
			async (
				input: NodeInput<typeof C.updateMessage>,
				ctx: OutletCtx
			) => ok(await ctx.commit(input)),
			{ ports: ["target", "text", "reasoning", "blocks", "sections", "parts"] }
		),
		/**
		 * Bound 2026-09-17 (plans/29 R-2): the host's commit for both — bytes
		 * into the session's asset store, a typed part onto the row — existed,
		 * and no binding reached it. The commit reads the row off `target`
		 * (the port `update-message` takes), or off the media reference's own
		 * `messageId` where a caller outside the graph set one.
		 */
		"core:outlet/attach-image@1": reads<typeof C.attachImage>(
			async (
				input: NodeInput<typeof C.attachImage>,
				ctx: OutletCtx
			) => ok(await ctx.commit(input)),
			{ ports: ["target", "image"] }
		),
		/**
		 * The audio twin of attach-image. 🚧 Speech (S3/S6): `meta` is the
		 * `SpokenMeta` the speak step published — the host records it per swipe
		 * beside the part — and `replace` swaps the line's earlier spoken audio for
		 * this one. No `audio` (nothing was spoken, or speaking failed and said so
		 * with null) writes nothing and never throws: the host answers
		 * `written: false`, so no `message-updated` is caused.
		 */
		"core:outlet/attach-audio@1": reads<typeof C.attachAudio>(
			async (
				input: NodeInput<typeof C.attachAudio>,
				ctx: OutletCtx
			) => {
				// `written` is the executor's (no write, no event), not a row id.
				const { written: _, ...ids } = (await ctx.commit(input)) as Record<
					string,
					unknown
				>
				return ok(ids)
			},
			{ ports: ["target", "audio", "meta"], params: ["replace"] }
		),
		/**
		 * The form's answer, committed as a click (U5d). The commit fires the
		 * block's action and reports what it fired; `answer` is lifted beside
		 * the write result the way a built-in's extra port is.
		 */
		/**
		 * The form's answer, committed as a click's fire (R-15; U5d review
		 * W1/W2). The commit checks the answer, asks the caps and collects
		 * the fire for the host to dispatch after this run's receipt; what it
		 * publishes names the action fired and the child run's id. A commit
		 * that could not make the fire — the oracle missed the form, the form
		 * is gone, a cap refused — says so as a **halt**: a legible end of
		 * this run, never an exception.
		 */
		"core:outlet/answer-form@1": reads<typeof C.answerForm>(
			async (
				input: NodeInput<typeof C.answerForm>,
				ctx: OutletCtx
			) => {
				const { answer, firedAction, firedRunId, halt: halted, ...ids } =
					(await ctx.commit(input)) as {
						id: unknown
						sessionId?: unknown
						answer?: unknown
						firedAction?: unknown
						firedRunId?: unknown
						halt?: unknown
					}
				if (typeof halted === "string") return halt(halted)
				return ok({
					status: "committed",
					ids,
					answer: answer ?? null,
					firedAction: firedAction ?? null,
					firedRunId: firedRunId ?? null
				})
			},
			{ ports: ["form", "answer", "messageId", "blockId", "addressee"] }
		),
		// ── Sprites (DESIGN-sprites §5; in-pipeline 2026-10-05) ──────────────
		//
		// The reply specs' sprite step, written into each spec after `save`:
		// the picker chooses a face for the line it is handed, and the outlet
		// records it. The host owns every effect — the read and the embed
		// behind the picker's `ctx.call`, and the write (`show-sprite`, whose
		// `source` the spec states).
		/**
		 * The sprite picker, all in one (owner, 2026-10-05): what the speaker
		 * can show, the line and the labels embedded, and the closest label
		 * picked by `pickSpriteBySimilarity` — stickiness, the recency penalty
		 * and the floor.
		 *
		 * Everything it works from is wired: the line's `text` (the reply
		 * string itself — the host never re-reads the row), whose line it is
		 * (`speaker`), the session (`scope`), and an optional `set`.
		 *
		 * **Picks nothing — null, and no call — when "Choose sprites" is off
		 * or the speaker is not a character** (a narrator's line, an envoy).
		 * So an off picker costs nothing: the embed is behind the call.
		 *
		 * ⚠ **Any failure is null, never an error.** The step runs after the
		 * reply is saved, and a face that could not be chosen must not turn a
		 * delivered reply into a failed turn: an unavailable mechanism
		 * subtracts a signal. The reason goes to the run's log.
		 */
		"core:oracle/pick-sprite@1": reads<typeof C.pickSprite>(
			async (input: NodeInput<typeof C.pickSprite>, ctx: OracleCtx) => {
				const none = ok({ main: null, pick: null, choices: null })
				if (input?.params?.enabled === false) return none
				let characterId = speakingCharacterId(input?.speaker)
				// 🚧 A card-less seat's speaker, as a member id — never in
				// `characterId` (a card id; the two share one id range).
				let castMemberId: number | null = null
				// 🚧 A `seated-member:<id>` speaker (seat-cast S2: refs in
				// accept it) picks for the card its seat holds; a card-less
				// character seat picks from its member's own sets (S4).
				// Resolved here, where the run's session is in hand.
				const sessionId = input?.scope?.sessionId
				if (
					characterId === null &&
					typeof input?.speaker === "string" &&
					input.speaker.trim().startsWith("seated-member:") &&
					typeof sessionId === "number"
				) {
					const { db } = await import("$lib/server/db")
					// The seat's card, by `seatOf` — the stored form is member
					// form once `state/memberForm.ts` is on, which names no card.
					// A sprite is picked only for a character's line, so the
					// speaker's seat is found among character seats, departed
					// ones included.
					const seat = await seatOf(db as never, sessionId, input.speaker, {
						kind: "character"
					})
					characterId = seat?.cardId ?? null
					if (characterId === null && seat?.kind === "character")
						castMemberId = seat.castMemberId ?? null
				}
				if (characterId === null && castMemberId === null) return none

				let found: {
					choices?: SpriteChoicesV1 | null
					lineVector?: unknown
					labelVectors?: unknown
				} | null
				try {
					found = (await ctx.call({
						sessionId: input?.scope?.sessionId,
						...(characterId !== null ? { characterId } : { castMemberId }),
						text: typeof input?.text === "string" ? input.text : "",
						set: input?.set ?? null
					})) as typeof found
				} catch (e) {
					ctx.log(
						"warn",
						`no sprite chosen: ${e instanceof Error ? e.message : String(e)}`
					)
					return none
				}
				const choices = found?.choices ?? null
				if (!choices) return none
				const pick = pickSpriteBySimilarity(
					{
						set: choices.set,
						labels: choices.labels,
						last: choices.last,
						recent: choices.recent
					},
					found?.lineVector,
					found?.labelVectors,
					{
						margin: input?.params?.margin,
						floor: input?.params?.floor
					}
				)
				return ok({ main: pick, pick, choices })
			},
			{
				ports: ["text", "speaker", "scope", "set"],
				params: ["enabled", "margin", "floor"]
			}
		),
		/**
		 * Advance story clock (DESIGN-story-time P3): the host moves
		 * the session's story clock through its book's calendar and refuses what
		 * does not land.
		 */
		"core:outlet/advance-story-clock@1": reads<typeof C.advanceStoryClock>(
			async (input: NodeInput<typeof C.advanceStoryClock>, ctx: OutletCtx) => {
				// 🚧 `skipped` (live scenes §15 G7): the sentence a skipped
				// move left in the ledger — on the receipt with the result.
				const { clock, label, skipped, moved, ...ids } = (await ctx.commit(input)) as {
					id: unknown
					sessionId?: unknown
					clock?: unknown
					label?: unknown
					skipped?: unknown
					moved?: unknown
				}
				return ok({
					status: "committed",
					ids,
					clock: clock ?? null,
					label: label ?? "",
					skipped: typeof skipped === "string" ? skipped : "",
					...(typeof moved === "number" ? { moved } : {})
				})
			},
			{ ports: ["by", "unit", "to", "cause", "onRefusal"], params: ["by", "unit"] }
		),
		"core:outlet/show-sprite@1": reads<typeof C.showSprite>(
			async (input: NodeInput<typeof C.showSprite>, ctx: OutletCtx) => {
				// `written` is the executor's (no write, no event), not a row id.
				const { sprite, kept, written: _, ...ids } = (await ctx.commit(
					input
				)) as {
					id: unknown
					sessionId?: unknown
					sprite?: unknown
					kept?: unknown
					written?: unknown
				}
				return ok({
					status: "committed",
					ids,
					sprite: sprite ?? null,
					kept: kept === true
				})
			},
			{ ports: ["target", "pick", "source"] }
		),
		/**
		 * 🚧 The session's backdrop (DESIGN-image-generation §6.4): the host
		 * points `sessions.backdropMediaId` at the first image of `media` —
		 * checked as `create-message`'s media is — and publishes the file id
		 * on `mediaId` (null when it wrote nothing).
		 */
		"core:outlet/set-backdrop@1": reads<typeof C.setBackdrop>(
			async (input: NodeInput<typeof C.setBackdrop>, ctx: OutletCtx) => {
				// `written` is the executor's (no write, no event), not a row id.
				const { mediaId, written: _, notes: __, ...ids } = (await ctx.commit(
					input
				)) as {
					id?: unknown
					sessionId?: unknown
					mediaId?: unknown
					written?: unknown
					notes?: unknown
				}
				return ok({
					status: "committed",
					ids,
					mediaId: typeof mediaId === "number" ? mediaId : null
				})
			},
			{ ports: ["media"] }
		),
		/**
		 * 🚧 A card's sprites from a run's pictures (DESIGN-image-generation
		 * §6.3; I5): the host files each keyed picture under its sprite label
		 * (`sprites/attach.ts`) and publishes what it wrote on `attached`
		 * and the labels that came back empty on `missing`.
		 */
		"core:outlet/attach-sprite@1": reads<typeof C.attachSprite>(
			async (input: NodeInput<typeof C.attachSprite>, ctx: OutletCtx) => {
				// `written` is the executor's (no write, no event), not a row id.
				const {
					attached,
					missing,
					written: _,
					...ids
				} = (await ctx.commit(input)) as {
					id?: unknown
					attached?: unknown
					missing?: unknown
					written?: unknown
				}
				return ok({
					status: "committed",
					ids,
					attached: Array.isArray(attached) ? attached : [],
					missing: Array.isArray(missing) ? missing : []
				})
			},
			{ ports: ["media", "characterId", "setName", "series"] }
		),

		// ── The built-in writes (R-15, 2026-09-16) ──────────────────────────
		// Each publishes the write result AND what the commit reported was
		// lost or replaced, on its own port: the executor wraps a bare `{id}`
		// as `{status, ids}` and copies it onto every `write-result@1` port,
		// but a `json` port beside them is the binding's to fill — so the
		// commit's extra field is lifted out of `ids` here rather than left
		// nested where no edge could name it.
		"core:outlet/delete-message@1": reads<typeof C.deleteMessage>(
			async (
				input: NodeInput<typeof C.deleteMessage>,
				ctx: OutletCtx
			) => {
				const { lost, taken, ...ids } = (await ctx.commit(input)) as {
					id: unknown
					sessionId?: unknown
					lost?: unknown
					taken?: unknown
				}
				return ok({ status: "committed", ids, lost: lost ?? null, taken: taken ?? null })
			},
			{ ports: ["target", "asked"] }
		),
		"core:outlet/hide-message@1": reads<typeof C.hideMessage>(
			async (
				input: NodeInput<typeof C.hideMessage>,
				ctx: OutletCtx
			) => {
				const { hidden, ...ids } = (await ctx.commit(input)) as {
					id: unknown
					sessionId?: unknown
					hidden?: unknown
				}
				return ok({
					status: "committed",
					ids,
					hidden: hidden ?? input?.hidden === true
				})
			},
			{ ports: ["target", "hidden"] }
		),
		"core:outlet/edit-message@1": reads<typeof C.editMessage>(
			async (
				input: NodeInput<typeof C.editMessage>,
				ctx: OutletCtx
			) => {
				const { previous, ...ids } = (await ctx.commit(input)) as {
					id: unknown
					sessionId?: unknown
					previous?: unknown
				}
				return ok({ status: "committed", ids, previous: previous ?? null })
			},
			{ ports: ["target", "text"] }
		),
		"core:outlet/swipe-message@1": reads<typeof C.swipeMessage>(
			async (
				input: NodeInput<typeof C.swipeMessage>,
				ctx: OutletCtx
			) => {
				const { swipeIndex, previous, ...ids } = (await ctx.commit(
					input
				)) as {
					id: unknown
					sessionId?: unknown
					swipeIndex?: unknown
					previous?: unknown
				}
				return ok({
					status: "committed",
					ids,
					swipeIndex: swipeIndex ?? null,
					previous: previous ?? null
				})
			},
			{ ports: ["target", "index", "text"] }
		),
		"core:outlet/branch-session@1": reads<typeof C.branchSession>(
			async (
				input: NodeInput<typeof C.branchSession>,
				ctx: OutletCtx
			) => ok(await ctx.commit(input)),
			{ ports: ["fromMessage", "title"] }
		),
		"core:outlet/convert-ruleset@1": reads<typeof C.convertRuleset>(
			async (
				input: NodeInput<typeof C.convertRuleset>,
				ctx: OutletCtx
			) => committedOrHalt(await ctx.commit(input)),
			{ ports: ["to"] }
		),
		/**
		 * The finished entry, and — since L2/L3 (2026-09-17) — its kind and
		 * its links.
		 *
		 * `entryType` is a param because the kind of thing a pipeline writes is
		 * a fact about the pipeline, not about the turn; `links` is a port
		 * because a room's exits are this run's. Both are the commit's to
		 * judge: an unknown type id and a link naming no entry are refused
		 * there, inside the transaction, so a room whose exits do not resolve
		 * fails WITH the room rather than leaving half of one behind.
		 *
		 * The links are here as well as on `core:outlet/link-lore-entries@1`
		 * so an entry and its links commit in one transaction, or not at all.
		 */
		"core:outlet/create-lore-entry@1": reads<typeof C.createLoreEntry>(
			async (
				input: NodeInput<typeof C.createLoreEntry>,
				ctx: OutletCtx
			) => ok(await ctx.commit(input)),
			// 🚧 `fields` (Lair rewrite D2): the entry type's typed fields,
			// checked against the type at the review gate and the commit.
			// 🚧 pr-6 C1: `sources` (and create's `match`, `bind`) are read by the
			// commit (host.ts, `checkLoreSources` / `resolveBind`).
			{
				ports: ["name", "content", "links", "fields", "sources", "match", "shown", "bind"],
				// `defaultBeginning` and `defaultDecayRate` are read by the commit
				// (host.ts, `checkStepDefaults`).
				params: ["entryType", "defaultBeginning", "defaultDecayRate"]
			}
		),
		/**
		 * 🚧 Change an entry of this session's lorebook (Lair rewrite D2,
		 * 2026-10-21): its name, its content, its typed fields — `fields` a
		 * patch, checked against the entry's own type. `entry` names it as
		 * `link-lore-entries@1`'s `to` does (an id, a write result, a name);
		 * the commit resolves it inside the session's book.
		 */
		"core:outlet/update-lore-entry@1": reads<typeof C.updateLoreEntry>(
			async (
				input: NodeInput<typeof C.updateLoreEntry>,
				ctx: OutletCtx
			) => ok(await ctx.commit(input)),
			// 🚧 pr-6 C1: `sources` is read by the commit (`checkLoreSources`).
			{ ports: ["entry", "name", "content", "fields", "sources"] }
		),
		/**
		 * 🚧 Change a cast member of this session (plan §32 §10): profile
		 * fields, or `{ follow: true }` to follow the card again; gated by
		 * `writes.lore` and the lore write mode, taken back with its turn.
		 */
		"core:outlet/update-cast-member@1": reads<typeof C.updateCastMember>(
			async (
				input: NodeInput<typeof C.updateCastMember>,
				ctx: OutletCtx
			) => ok(await ctx.commit(input)),
			{ ports: ["member", "changes"] }
		),
		/**
		 * One link between two entries of this session's lorebook.
		 *
		 * `to` takes a **name** as well as an id, and that is the half that
		 * makes the write law survivable: a second run can link what a first
		 * one created without holding an id across the two. A name nothing
		 * answers to, and a name TWO entries answer to, are both refused at
		 * the commit — picking one would link the wrong room silently.
		 *
		 * The relationship's descriptor rides through whole (places plan B2):
		 * `name` and `description` (the port that was `label`) as ports,
		 * `linkType` and `reverseLinkType` as params. The commit is
		 * idempotent — a link the book already has answers with its id.
		 */
		"core:outlet/link-lore-entries@1": reads<typeof C.linkLoreEntries>(
			async (
				input: NodeInput<typeof C.linkLoreEntries>,
				ctx: OutletCtx
			) => ok(await ctx.commit(input)),
			{
				// 🚧 pr-6 C1: `sources` is read by the commit (`checkLoreSources`).
				ports: ["from", "to", "name", "description", "sources"],
				params: ["linkType", "reverseLinkType"]
			}
		),
		/**
		 * 🚧 One cast member came to know one entry in play (kn-4b), or no
		 * longer does: a knowledge tie of play's own kinds, written by the
		 * commit. No shipped pipeline places it.
		 */
		"core:outlet/note-entry-knowledge@1": reads<typeof C.noteEntryKnowledge>(
			async (
				input: NodeInput<typeof C.noteEntryKnowledge>,
				ctx: OutletCtx
			) => ok(await ctx.commit(input)),
			{ ports: ["member", "entry"], params: ["knowledgeKind", "end"] }
		),
		/**
		 * 🚧 The library outlets (M2c path B, plan §8): a card or a book in,
		 * a row out — or a proposal, or a refusal — as the acting person under
		 * their library write mode. Everything is the commit's to judge
		 * (host.ts `libraryOutlet`): the genre's `writes.library`, the person's
		 * rights (`personMay`), the mode.
		 */
		"core:outlet/create-character@1": reads<typeof C.createCharacter>(
			async (input: NodeInput<typeof C.createCharacter>, ctx: OutletCtx) => committedOrHalt(await ctx.commit(input)),
			{ ports: ["card"] }
		),
		"core:outlet/update-character@1": reads<typeof C.updateCharacter>(
			async (input: NodeInput<typeof C.updateCharacter>, ctx: OutletCtx) => committedOrHalt(await ctx.commit(input)),
			{ ports: ["characterId", "changes"] }
		),
		"core:outlet/create-lorebook@1": reads<typeof C.createLorebook>(
			async (input: NodeInput<typeof C.createLorebook>, ctx: OutletCtx) => committedOrHalt(await ctx.commit(input)),
			{ ports: ["lorebook"] }
		),
		// Gate-eligible, and that is the mechanism behind "a graph build stops at
		// the review screen": what comes back is a proposal, not rows.
		"core:outlet/graph-proposal@1": reads<typeof C.graphProposal>(
			async (
				input: NodeInput<typeof C.graphProposal>,
				ctx: OutletCtx
			) => ok(await ctx.commit(input)),
			// 🚧 pr-6 C1: `sources` is read by the commit (`checkLoreSources`).
			{ ports: ["proposal", "sources"] }
		)
	}
}
