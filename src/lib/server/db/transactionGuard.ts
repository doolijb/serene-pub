/**
 * The one PGlite deadlock, made loud.
 *
 * PGlite is a single connection behind a transaction mutex: `db.transaction`
 * holds it until the callback settles, and every query issued on the OUTER
 * handle — `db.select()`, `db.query.x.findFirst()`, `db.execute()`, a second
 * `db.transaction()` — waits for it. A transaction callback that awaits one
 * of those therefore waits on itself, forever, silently: no error, no
 * timeout, and the mutex it holds stops every other query in the process
 * behind it. Drizzle's `tx` handle is the only one a transaction may use,
 * and that includes every helper it calls.
 *
 * This wraps the PGlite client once so the mistake is a thrown error at the
 * call site instead of a process-wide hang: the transaction callback runs
 * under an `AsyncLocalStorage` marker, and an outer-handle query issued from
 * inside that async context while the transaction is still open is refused
 * with a sentence naming both the query and where the transaction was
 * opened. The marker is scoped to the callback, so a query issued after the
 * transaction settled — the code after `await db.transaction(...)` — is not
 * inside it and runs as it always did.
 *
 * ⚠ **Do not spawn deferred outer-handle work from inside a transaction.**
 * The async context travels through `setTimeout`, `void promise` and
 * `queueMicrotask`, so a fire-and-forget query scheduled from a transaction
 * callback and running while the transaction is still open is refused too —
 * correctly, in that it would have queued behind the commit rather than
 * deadlocked, but it is refused. Schedule such work after the transaction
 * returns. No transaction body in the codebase does this today (audited
 * 2026-09-17), and a body that needs to is a body that should hand the
 * work to its caller.
 *
 * `mode` decides what a hit does: `throw` refuses the query (dev and test —
 * the run fails at once, with the stacks); `warn` logs the same sentence at
 * error level and lets the query proceed (production — the hang still names
 * its cause in the log, and nothing that would have worked is refused).
 */

import { AsyncLocalStorage } from "node:async_hooks"

/** The client surface this wraps: PGlite's public query doors and its transaction. */
export interface GuardableClient {
	query(...args: any[]): Promise<any>
	exec(...args: any[]): Promise<any>
	transaction(callback: (tx: any) => Promise<any>): Promise<any>
}

export type TransactionGuardMode = "throw" | "warn"

interface OpenTransaction {
	open: boolean
	/** Where `db.transaction` was called, for the sentence. */
	openedAt: string
}

const context = new AsyncLocalStorage<OpenTransaction>()

/** Clients already wrapped — wrapping twice would check twice for nothing. */
const guarded = new WeakSet<object>()

export class TransactionDeadlockError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "TransactionDeadlockError"
	}
}

/** A stack with this module's own frames cut off the top. */
function stackOf(skip = 2): string {
	const stack = new Error().stack ?? ""
	return stack.split("\n").slice(1 + skip).join("\n")
}

function sentence(what: string, opened: OpenTransaction): string {
	return (
		`${what} on the OUTER database handle while a transaction is open on it — ` +
		`on PGlite that waits on the transaction's own mutex forever. Use the ` +
		`transaction's \`tx\` handle for every query inside it (and pass \`tx\` to ` +
		`every helper it calls), or run this after the transaction returns.\n` +
		`The query was issued at:\n${stackOf()}\n` +
		`The transaction was opened at:\n${opened.openedAt}`
	)
}

/**
 * Wrap `client` so an outer-handle query inside its own transaction is a
 * loud failure. Idempotent per client; safe to call on every construction.
 */
export function guardTransactions(
	client: GuardableClient,
	mode: TransactionGuardMode
): void {
	if (guarded.has(client)) return
	guarded.add(client)

	const refuse = (what: string): void => {
		const opened = context.getStore()
		if (!opened?.open) return
		const message = sentence(what, opened)
		if (mode === "throw") throw new TransactionDeadlockError(message)
		console.error(`[db] ${message}`)
	}

	const originalTransaction = client.transaction.bind(client)
	const originalQuery = client.query.bind(client)
	const originalExec = client.exec.bind(client)

	client.transaction = async (callback) => {
		// A transaction opened on the outer handle inside another one is the
		// same wait on the same mutex. (A nested `tx.transaction` is a
		// savepoint on the transaction's own handle and never reaches here.)
		refuse("a transaction was opened")
		const marker: OpenTransaction = { open: true, openedAt: stackOf(2) }
		return await originalTransaction((tx) =>
			context.run(marker, async () => {
				try {
					return await callback(tx)
				} finally {
					// Settled — the commit or rollback that follows is PGlite's
					// own, and anything scheduled to run after it is not a
					// wait on this transaction.
					marker.open = false
				}
			})
		)
	}
	client.query = async (...args) => {
		refuse("a query was issued")
		return await originalQuery(...args)
	}
	client.exec = async (...args) => {
		refuse("a statement was executed")
		return await originalExec(...args)
	}
}
