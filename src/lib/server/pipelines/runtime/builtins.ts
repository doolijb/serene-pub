/**
 * The built-in writes, run (R-15, ruled 2026-09-15, built 2026-09-16).
 *
 * *Anything that alters message state is a built-in*: core performs the
 * write and it always emits an event carrying what changed and what was
 * lost. This is how a venue's handler performs one: the request goes through
 * the executor as a one-node run of the built-in's own spec
 * (`core:spec/builtin-delete` — `core:inlet/built-in-request@1` straight
 * into `core:outlet/delete-message@1`), so the write is
 *
 *  · **receipted** — a `pipeline_runs` row pinning the spec's hash, with the
 *    event on `emitted` and the row on the artifacts;
 *  · **gated** — the outlet is `effects: 'write'`, so an admin may turn
 *    review on for a delete in the panel and the run parks like any other;
 *  · **emitting** — the host's commit writes the session change the next
 *    reply's inlet publishes as `sessionChanges`.
 *
 * What stays with the handler is what only the venue can decide: whether
 * THIS person may act on THIS message (`canActOnMessage` in
 * `messages/permissions.ts`, ownership — the `item` audience rule) and
 * whether the genre offers the verb at all (`verbRefusal`). By the time a
 * request reaches here the genre's answer is settled; the item rule is asked
 * AGAIN by the host's commit, against `actor` and the id the write is about
 * to use (U5b review C1), because a review gate may fold an edit into the
 * payload between the handler and the write. This runs it and hands back the
 * receipt and what the write published.
 *
 * Registered as an `action` run — a message's Stop reaches it only through a
 * row it is filling, which none of these fill.
 */

import { v4 as uuidv4 } from "uuid"
import { BUILTIN_SPEC_IDS, type BuiltInKind } from "@serene-pub/core-catalog"
import type { Receipt } from "@serene-pub/sdk"
import { runSpec } from "$lib/server/pipelines/runtime/runTurn"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import * as runRegistry from "$lib/server/pipelines/runtime/runRegistry"
import { broadcastSessionRow } from "$lib/server/sessions/rowPush"

export type { BuiltInKind }
export { BUILTIN_SPEC_IDS }

export interface BuiltInRequest {
	kind: BuiltInKind
	sessionId: number
	/** Who asked — the run's owner, and the write's author. */
	actor: number
	/** The request, as the inlet publishes it. Only the built-in's own fields are read. */
	payload: {
		/** The message the write is about. */
		target?: number
		/** An edit's new text; a swipe's alternative to record. */
		text?: string
		/** A hide's direction. */
		hidden?: boolean
		/** A swipe's alternative to select. */
		index?: number
		/** A branch's fork point. */
		fromMessage?: number
		/** A branch's name. */
		title?: string | null
	}
	/** Where the changed row is announced. Absent, nothing is broadcast. */
	io?: SessionIo
	runId?: string
}

export interface BuiltInOutcome {
	receipt: Receipt
	/** The run went to the end and the write landed. */
	ok: boolean
	/** Why it did not, in a sentence the handler may answer with. */
	error?: string
	/**
	 * What the outlet published: the write result's `ids` plus the built-in's
	 * own port — `lost` on a delete, `previous` on an edit, `swipeIndex` on a
	 * swipe, the new session's id on a branch. Absent when the write did not
	 * run (a halt at review, a refused reach).
	 */
	write?: Record<string, unknown>
}

/** Every built-in's spec ends in this node. */
const WRITE_NODE = "write"

export async function runBuiltIn(
	db: Db,
	request: BuiltInRequest
): Promise<BuiltInOutcome> {
	return runActionSpec(db, BUILTIN_SPEC_IDS[request.kind], request)
}

/**
 * A person's message action that is not a built-in but runs like one — the
 * same one-node shape, receipt, gate and row push. Today: a line's sprite
 * (`core:spec/show-sprite`, DESIGN-sprites §6), whose outlet the reply specs'
 * sprite step also places (`spriteShow`, `source: 'picker'`), which is exactly
 * why it cannot be a built-in (a built-in outlet may appear in its own spec
 * and nowhere else).
 */
export async function runSpriteAction(
	db: Db,
	request: Omit<BuiltInRequest, "kind" | "payload"> & {
		target: number
		sprite: { set: string; label: string } | null
	}
): Promise<BuiltInOutcome> {
	const { SHOW_SPRITE_SPEC_ID } = await import("@serene-pub/core-catalog")
	return runActionSpec(db, SHOW_SPRITE_SPEC_ID, {
		...request,
		payload: { target: request.target, sprite: request.sprite }
	})
}

async function runActionSpec(
	db: Db,
	specId: string,
	request: Omit<BuiltInRequest, "kind"> & {
		payload: BuiltInRequest["payload"] & { sprite?: unknown }
	}
): Promise<BuiltInOutcome> {
	const runId = request.runId ?? uuidv4()
	const handle = runRegistry.start({
		runId,
		userId: request.actor,
		sessionId: request.sessionId,
		specId,
		kind: "action"
	})
	try {
		const receipt = await runSpec({
			db,
			sessionId: request.sessionId,
			userId: request.actor,
			specId,
			runId,
			io: request.io,
			signal: handle.controller.signal,
			cancelSignal: () => runRegistry.cancellation(handle),
			input: {
				sessionId: request.sessionId,
				sessionScope: {
					sessionId: request.sessionId,
					currentCharacterId: null
				},
				...request.payload
			}
		})
		const write = receipt.nodes.find(
			(n) => n.nodeKey === WRITE_NODE && n.result === "ok"
		)?.output as Record<string, unknown> | undefined
		if (receipt.outcome !== "ok") {
			const { haltExplanation } = await import(
				"$lib/server/pipelines/runtime/runTurn"
			)
			return {
				receipt,
				ok: false,
				error: haltExplanation(receipt) ?? "The write did not land.",
				write
			}
		}
		return { receipt, ok: true, write }
	} finally {
		runRegistry.finish(runId)
		// Every built-in alters message state, which is exactly what a
		// session's list row quotes — so the sidebar, the detail panel and
		// the home cards are told here rather than in each venue's handler.
		// In the `finally` because a run that halted after its write node
		// committed still moved the row; the debounce
		// (`sessions/rowPush.ts`) makes a run that wrote nothing cost one
		// re-read at most, and the gate usually skips even that.
		broadcastSessionRow(request.io, request.sessionId)
	}
}

/** The row id a built-in's write result names, when it committed. */
export function writtenId(write: Record<string, unknown> | undefined): number | null {
	const ids = (write as { ids?: { id?: unknown } } | undefined)?.ids
	const id = ids?.id
	return typeof id === "number" ? id : null
}
