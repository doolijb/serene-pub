/**
 * The `bindingSuggestions:*` namespace — *"this was named and it does not
 * exist; add it?"*, plus the log of what was said about that.
 *
 * ## Four verbs, and why there is no fifth
 *
 * `list` derives, reconciles and reads back in one call — there is deliberately
 * no separate `scan`, because the candidates are derived (plan §1) and a
 * derivation with its own trigger is an invalidation problem nobody asked for.
 * `ignore`/`unignore` write the decision and nothing else. `add` mints the
 * binding and records that it did.
 *
 * ## Every handler checks ownership itself
 *
 * Not once at the top, not by trusting the caller, and not by trusting the
 * previous handler in a chain: this codebase has shipped a real cross-tenant
 * read from a handler that skipped its own check, and a suggestion carries a
 * quoted line of a user's transcript, so a missing check here leaks prose.
 * `list` checks the book (`findOwnedBook`'s shape, on `lorebooks.userId`);
 * the three row-addressed handlers check through `findOwnedSuggestion`, which
 * joins to `lorebooks` and filters on `userId` in the same statement that
 * fetches the row — so a suggestion id belonging to someone else is "not
 * found", never "found but refused".
 */

import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq, ne, sql } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import {
	findOwnedSuggestion,
	isUnscanned,
	outstandingSources,
	refreshSuggestions,
	takenNames,
	OPEN_TIER_PREFIX
} from "$lib/server/bindingSuggestions"
import { enqueueLorebookAnnotation } from "$lib/server/annotations/queue"
import { insertBackgroundBinding, relistBindings } from "./lorebooks"
import { refusable as refusableHandler } from "./refusable"

/** The lorebook, if this user owns it. `entries.ts`' `findOwnedBook`, verbatim. */
async function findOwnedBook(lorebookId: number, userId: number) {
	return db.query.lorebooks.findFirst({
		where: (l, { and, eq }) =>
			and(eq(l.id, lorebookId), eq(l.userId, userId)),
		columns: { id: true, name: true, userId: true }
	})
}

/** Every refusal here reaches the person as its own sentence (see `refusable`). */
const refusable = <P, R>(
	event: string,
	body: (
		socket: any,
		params: P,
		emitToUser: (event: string, data: any) => void
	) => Promise<R>
) => refusableHandler(event, body, "Failed to update binding suggestions.")

/**
 * The list, freshly derived.
 *
 * Split out of the handler below so the three mutators can hand it to
 * `emitToUser` as a thunk: ONE source of truth for the payload, and the
 * derive-reconcile-read pass behind it is paid only when a socket declared
 * the key (socket-interest plan, ruling 4). The handler's own reply stays
 * eager — the caller asked for it.
 *
 * ⚠ No ownership check here, deliberately: every caller has already made
 * one — the handler through `findOwnedBook`, the mutators through
 * `findOwnedSuggestion`, which joins to `lorebooks` and filters on `userId`
 * in the same statement that fetches the row. A second, weaker check would
 * be one more thing to keep honest, not one more boundary.
 */
async function buildBindingSuggestionsList(
	lorebookId: number
): Promise<Sockets.BindingSuggestions.List.Response> {
	const { suggestions, coverage } = await refreshSuggestions(db, lorebookId)
	return {
		lorebookId,
		suggestions,
		scanned: !isUnscanned(coverage),
		outstanding: outstandingSources(coverage),
		coverage
	}
}

/**
 * The list, answered to whoever asked for it, with the two empty states told
 * apart.
 *
 * ⚠ `scanned` is what stops a silent lie. Annotation is a background lane, so an
 * empty `suggestions` on a book the lane has not reached means *"not looked
 * yet"* — and rendered as a bare empty list that reads as *"nothing to add"*,
 * confidently and wrongly (plan §1, caveat 2). `outstanding` carries the partial
 * case for the same reason: a book half-walked has a real but incomplete answer,
 * and the UI is entitled to say so.
 */
export const bindingSuggestionsListHandler = refusable<
	Sockets.BindingSuggestions.List.Params,
	Sockets.BindingSuggestions.List.Response
>("bindingSuggestions:list", async (socket, params, emitToUser) => {
	const userId = socket.user!.id
	const book = await findOwnedBook(params.lorebookId, userId)
	if (!book) throw new Error("Lorebook not found.")

	const res = await buildBindingSuggestionsList(params.lorebookId)

	/**
	 * A query promotes — `annotations/queue.ts`' own doctrine, applied here.
	 *
	 * ⚠ Without this, "not scanned yet" is a state the user cannot leave. The
	 * lane's periodic sweep is **fifteen minutes** apart, and nothing else on
	 * this panel touches content, so opening it on a book written before the
	 * lane last ran would show that notice and then keep showing it, with no
	 * action available that would change the answer. The write path already
	 * enqueues the same group with the same de-duplication predicate
	 * (`entries.ts`' `afterWrite`), so this is that call from the read side, not
	 * a second scheduling mechanism.
	 *
	 * ⚠ **The entry half only.** This is the group shape `enqueueLorebookAnnotation`
	 * defines; the transcript half is enqueued per session by the reply path,
	 * which is the lane's business and not this handler's to re-decide. So a
	 * book with unannotated *messages* still reports them outstanding until a
	 * turn or the sweep reaches them — accurately, which is the point.
	 *
	 * Conditional, so an already-covered book does not wake the lane every time
	 * somebody opens the Bindings tab.
	 */
	if (res.outstanding > 0)
		enqueueLorebookAnnotation(params.lorebookId, book.name)

	emitToUser("bindingSuggestions:list", res)
	return res
})

/**
 * Dismiss one — the decision that must suppress without hiding.
 *
 * The row is not deleted and the key is not blocklisted anywhere: the scan keeps
 * deriving this candidate on every pass (nothing about ignoring it changes the
 * transcript), `reconcileSuggestions` keeps refreshing its evidence, and the
 * *status* is what moves it out of the pending list and into the log. That is
 * what makes it reversible — `unignore` has something to reverse.
 */
export const bindingSuggestionsIgnoreHandler = refusable<
	Sockets.BindingSuggestions.Ignore.Params,
	void
>("bindingSuggestions:ignore", async (socket, params, emitToUser) => {
	const userId = socket.user!.id
	const row = await findOwnedSuggestion(db, params.id, userId)
	if (!row) throw new Error("Suggestion not found.")
	if (row.status === "added")
		throw new Error("That suggestion has already been added as a binding.")

	await db
		.update(schema.bindingSuggestions)
		.set({ status: "ignored", decidedAt: new Date() })
		.where(eq(schema.bindingSuggestions.id, row.id))

	return relist(emitToUser, row.lorebookId, { ignoredId: row.id })
})

/**
 * Undo a dismissal.
 *
 * Strictly the inverse of `ignore`, and deliberately narrow: it restores
 * `pending` from `ignored`, is a no-op on a row already pending (a double click
 * is not an error), and refuses on `added`. Un-adding is a different act — it
 * would have to say something about the binding that was created, which this
 * handler has no mandate to delete.
 */
export const bindingSuggestionsUnignoreHandler = refusable<
	Sockets.BindingSuggestions.Unignore.Params,
	void
>("bindingSuggestions:unignore", async (socket, params, emitToUser) => {
	const userId = socket.user!.id
	const row = await findOwnedSuggestion(db, params.id, userId)
	if (!row) throw new Error("Suggestion not found.")
	if (row.status === "added")
		throw new Error(
			"That suggestion was added as a binding. Delete the binding to undo it."
		)

	if (row.status !== "pending")
		await db
			.update(schema.bindingSuggestions)
			.set({ status: "pending", decidedAt: null })
			.where(eq(schema.bindingSuggestions.id, row.id))

	return relist(emitToUser, row.lorebookId, { restoredId: row.id })
})

/**
 * Accept one — mint the binding, then record that this suggestion is why.
 *
 * ## What gets created, and why that shape
 *
 * A **background binding**: `lorebook_bindings` with a name and no
 * character/persona. That is the row the Bindings tab's own "Add background
 * character" button makes, and it is the only shape the evidence supports — the
 * open tier says a name was used, not that a full character sheet exists behind
 * it. Anything richer would be inventing what the user has not said.
 *
 * The insert goes through `insertBackgroundBinding`, the same helper
 * `lorebooks:createBinding`'s background path uses, so the server-side
 * `binding` token (never client-supplied, never reused after a delete) has one
 * spelling. It runs inside this handler's own transaction rather than through
 * that handler, because the claim, the taken-name check and the insert have to
 * commit together under the book's lock — see the body.
 *
 * ## Why `added` has to be its own suppressor
 *
 * ⚠ An unbound binding contributes **nothing** to the gazetteer —
 * `annotations/loadVocabulary` says so in as many words, because `EntityRef`
 * names a character, a persona or an entry and a background row is none of
 * those. So the name keeps coming back out of the open tier on every scan for as
 * long as the transcript says it. `status = 'added'` is the only thing between
 * the user and being asked to add what they just added.
 */
export const bindingSuggestionsAddHandler = refusable<
	Sockets.BindingSuggestions.Add.Params,
	void
>("bindingSuggestions:add", async (socket, params, emitToUser) => {
	const userId = socket.user!.id
	const row = await findOwnedSuggestion(db, params.id, userId)
	if (!row) throw new Error("Suggestion not found.")
	if (row.status === "added")
		throw new Error("That suggestion has already been added as a binding.")

	/**
	 * The name, from the client only as an override of the surface form.
	 *
	 * A person renaming "the ashguard riders" to "Ashguard Riders" before
	 * accepting is the ordinary case, so the field exists — but it is
	 * trimmed, length-capped and never allowed to be empty, and everything
	 * else about the row is server-derived. The suggestion's own surface is
	 * the default.
	 */
	const name = (
		typeof params.name === "string" && params.name.trim()
			? params.name
			: row.surface || row.entityKey.slice(OPEN_TIER_PREFIX.length)
	)
		.trim()
		.slice(0, 200)
	if (!name) throw new Error("A binding needs a name.")

	// One transaction under the book's lock (the same key every cast writer
	// takes), so neither a double accept of this suggestion nor two different
	// suggestions accepted under the same name can make two rows for one
	// identity:
	//  1. CLAIM the suggestion — only a row not yet `added` flips, so the
	//     second of two concurrent accepts finds nothing to claim and refuses;
	//  2. refuse a name the book already answers to (the duplicate the
	//     Bindings tab has a whole review surface for);
	//  3. mint the background binding and record that this suggestion is why.
	// A refusal at 2 throws, which rolls the claim back to what it was.
	const lorebookBinding = await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(${row.lorebookId})`)
		const [claimed] = await tx
			.update(schema.bindingSuggestions)
			.set({ status: "added", decidedAt: new Date() })
			.where(
				and(
					eq(schema.bindingSuggestions.id, row.id),
					ne(schema.bindingSuggestions.status, "added")
				)
			)
			.returning({ id: schema.bindingSuggestions.id })
		if (!claimed)
			throw new Error(
				"That suggestion has already been added as a binding."
			)

		const taken = await takenNames(tx, row.lorebookId)
		if (taken.has(name.toLowerCase().replace(/\s+/g, " ").trim()))
			throw new Error(`This lorebook already has a binding for "${name}".`)

		const inserted = await insertBackgroundBinding(tx, row.lorebookId, {
			name
		})
		await tx
			.update(schema.bindingSuggestions)
			.set({ resolvedBindingId: inserted.id, surface: name })
			.where(eq(schema.bindingSuggestions.id, row.id))
		return inserted
	})

	// What `lorebooks:createBinding` would have pushed: the open Bindings tab
	// listens for both.
	await relistBindings(socket, row.lorebookId, emitToUser)
	emitToUser("lorebooks:createBinding", { lorebookBinding, existing: false })

	return relist(emitToUser, row.lorebookId, {
		addedId: row.id,
		lorebookBinding
	})
})

/**
 * Re-derive and re-emit after a write.
 *
 * Every mutating handler answers with the whole list rather than the one row it
 * touched, for the reason `afterWrite` in `entries.ts` does: the pending list
 * and the dismissal log are two views of one table, and a client patching a
 * single row into both would have to reimplement the partition. It also picks up
 * whatever the annotation lane wrote in the meantime, so accepting one
 * suggestion does not leave the rest of the list stale.
 */
function relist(
	emitToUser: ((event: string, data: any) => void) | undefined,
	lorebookId: number,
	extra: Record<string, unknown>
) {
	return emitToUser?.("bindingSuggestions:list", async () => ({
		...(await buildBindingSuggestionsList(lorebookId)),
		...extra
	}))
}

export function registerBindingSuggestionHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, bindingSuggestionsListHandler, emitToUser)
	register(socket, bindingSuggestionsIgnoreHandler, emitToUser)
	register(socket, bindingSuggestionsUnignoreHandler, emitToUser)
	register(socket, bindingSuggestionsAddHandler, emitToUser)
}
