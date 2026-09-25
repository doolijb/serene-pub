/**
 * Nothing reaches a socket except through the connection projection.
 *
 * > "Connections must be invisible, unmuteable and unchooseable to non-admins"
 *
 * `connections/visibility.ts` states that rule once and applies it at the points
 * a payload LEAVES the server, which is the right shape — a handler added next
 * release inherits it without knowing it exists. The shape's one weakness is
 * that it only covers the emits that go THROUGH those points, and a raw
 * `socket.emit` beside them is invisible to every type, every test and every
 * runtime check in this repo.
 *
 * Four such holes were found in the 0.6 audit. **All four were found by people
 * reading code.** Not one was found by a test, and not one would have been:
 *
 *   1. `pipelines:reviewRequested` — the review gate's push transport bypasses
 *      `emitToUser` by construction, because a review can park from any trigger
 *      and pushes by user rather than through whichever handler started the run.
 *   2. `generateResponse.ts` — a raw `io.to("user_" + id).emit(
 *      "personaMessageReceived", …)` carrying a whole message row. It turned out
 *      to be dead and was deleted; it was live code for as long as nobody looked.
 *   3. `sockets/activity.ts` — registered a raw `socket.emit` as the activity
 *      store's emitter, so the ENTIRE activity stream never ran the walk.
 *   4. `broadcastToSessionUsers` — session fan-out reaches OTHER people's rooms,
 *      where `socket.user` is the wrong subject to ask about. It became
 *      `emitRedacted`, which asks per recipient.
 *
 * A fifth was found by writing this file — `users.ts :: user`, the legacy
 * "push the current user row" helper, emitting through `socket.server`, the only
 * use of that handle the repo ever had. It sat in `UNREDACTED_EMITS` below as
 * latent rather than live: safe only because the `users` table no longer has a
 * connection column, and a leak again the day one is re-added. It was closed on
 * 2026-09-15 by the interest-gate work, which had its own reason to want that
 * helper going through `emitToUser` — so the entry is gone and this paragraph
 * is what is left of it.
 *
 * ## What this asserts
 *
 * Every `.emit()` on a socket handle in SERVER code is one of:
 *
 *   - **redacting in place** — the function it sits in calls a projection
 *     imported from `connections/visibility.ts`, and it is written down in
 *     `REDACTING_EMITTERS` with the subject whose adminness it consults; or
 *   - **written down in `UNREDACTED_EMITS`** with the reason it is safe without
 *     one.
 *
 * A raw emit that is neither fails, and that is the whole point: the fifth hole
 * costs its author a test failure instead of a reader.
 *
 * ## Why BOTH halves are allowlisted
 *
 * Because "it calls `redactConnections`" is not the invariant. `redactConnections
 * (data, socket.user)` is exactly right for the caller's own room and exactly
 * wrong for anybody else's — that is hole 4, and the code that had it was calling
 * the projection the whole time. So the structural test (does this function
 * project at all) decides which LIST a site belongs on, and the list is where a
 * human says whose adminness was consulted. A new emit that projects against the
 * wrong subject still has to be written down before it passes.
 *
 * Both lists are checked in both directions. An entry whose emit has been
 * deleted, or has moved from one list to the other, **fails** and names itself
 * for deletion — the same rule `wiring.test.ts` keeps, and for the same reason:
 * a stale excuse is believed by the next reader.
 *
 * ## Static, not runtime
 *
 * A runtime wrapper that threw on an unsanctioned emit would see the dynamic
 * spellings this cannot, and would have caught **none of the four holes above** —
 * every one of them was on a path no test exercises (a parked review, a dead
 * message push, an activity stream, a fan-out to a second user). A runtime guard
 * only fires on the lines a test already runs, which is the intersection of "code
 * that leaks" and "code that is tested", and the four holes prove that
 * intersection is empty here. Static analysis reads the line whether or not
 * anything runs it, cannot be turned off by a mock, and needs no fixture.
 *
 * It is also the convention: `wiring.test.ts` beside this file, `importBoundary`,
 * `defaults.seedIdSequence` and `manifest.conformance` all read the source text
 * for invariants that have no runtime form.
 *
 * ## Scope, stated rather than left as a silence
 *
 *   - **Client `socket.emit` is out of scope.** A client emit is an outbound
 *     REQUEST — the client asking the server for something — not server data
 *     escaping. It carries only what that browser already had. There are ~200 of
 *     them in `routes/` and `lib/client/`, and including them would bury eight
 *     real subjects under two hundred irrelevant ones. `lib/shared/` IS scanned,
 *     because a shared module is server code the moment the server imports it.
 *   - **`.svelte` files are not scanned.** No server module is a component; a
 *     `.svelte` file under `lib/server/` would be a category error worth its own
 *     failure, and there are none.
 *   - **`namesAConnection` is not a projection for this purpose.** It is the
 *     INBOUND check — it asks whether a form somebody submitted named a
 *     connection at all. A function that calls it has not redacted anything on
 *     the way out, so it must not sanction an emit. Neither does
 *     `connectionsVisibleTo`, which decides but does not project.
 *
 * ## Blind spots
 *
 *   - **A dynamically constructed emit.** `const e = socket.emit.bind(socket)`,
 *     `socket[name](…)`, a socket handle passed into a helper that emits through
 *     a parameter. None exists today (the enumeration below found four spellings
 *     and all four are literal), and none would be seen if it did. This is the
 *     price of static analysis, paid deliberately per the section above.
 *   - **`.send()` is matched only on a socket-shaped receiver.** socket.io's
 *     `send()` is `emit("message", …)` under another name, and matching every
 *     `.send(` in server code would drag in HTTP responses, streams and child
 *     processes. `getSocket().send(…)` through an oddly-named local is invisible.
 *   - **`emit` is matched by NAME, not by type.** A Node `EventEmitter` in server
 *     code would be reported here as an unredacted socket emit. There is none
 *     today; when one arrives, it fails loudly and gets an entry saying it is not
 *     a socket. That is the correct direction to fail in.
 *   - **Two byte-identical emits in one function collapse to one subject.**
 *     `taskQueue.ts` has exactly that (the connect snapshot and the `taskQueue:get`
 *     re-fetch), and one entry honestly covers both. Deleting one leaves the entry
 *     live for the other; deleting both makes it stale and fails.
 *   - **This says nothing about free text.** `"KoboldCPP API error at http://…"`
 *     names a connection as surely as a field does and no key-shaped rule sees it.
 *     `visibility.ts`'s docblock explains why that is answered by `ComposedError`
 *     and not by a second rule; it is not answered here either.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { describe, expect, test } from "vitest"
import ts from "typescript"

// ── The allowlist machinery ─────────────────────────────────────────────────
//
// Deliberately a copy of `wiring.test.ts`'s, not an import: importing a symbol
// out of a `.test.ts` would load and run that file's five describes a second
// time under this file's name. Thirty lines of duplication is the cheaper of the
// two, and lifting it into a third shared module is a change to a file this lane
// was not asked to touch. If a third conformance family appears, lift it then.

/** A raw emit that is knowingly not routed through a wrapper. */
interface Deliberate {
	/** The exact string the scan produces, so the two can be compared. */
	readonly subject: string
	/** Raw, deliberately, because… */
	readonly reason: string
}

/** Both directions of one list, in one place. See wiring.test.ts's copy. */
function expectExactlyExcused(
	found: readonly string[],
	allowed: readonly Deliberate[],
	{ list, unwired, fix }: { list: string; unwired: string; fix: string }
): void {
	const excused = new Set(allowed.map((a) => a.subject))
	const unexplained = found.filter((s) => !excused.has(s))
	expect(
		unexplained,
		unexplained.length
			? `${unexplained.length} ${unwired}:\n` +
					unexplained.map((s) => `  • ${s}`).join("\n") +
					`\n\n${fix} — or add it to ${list} with the reason it is ` +
					`written the way it is. Do not weaken the check.`
			: undefined
	).toEqual([])

	const seen = new Set(found)
	const stale = allowed.filter((a) => !seen.has(a.subject))
	expect(
		stale.map((a) => a.subject),
		stale.length
			? `${stale.length} entr${stale.length === 1 ? "y" : "ies"} in ` +
					`${list} no longer excuse${stale.length === 1 ? "s" : ""} ` +
					`anything:\n` +
					stale
						.map(
							(a) =>
								`  • ${a.subject}\n      claimed: ${a.reason}`
						)
						.join("\n") +
					`\n\nEither the emit is gone, or it changed sides — a site ` +
					`that started redacting moves to REDACTING_EMITTERS, and one ` +
					`that stopped moves to UNREDACTED_EMITS. Delete the entry; a ` +
					`stale excuse is how this test rots into decoration.`
			: undefined
	).toEqual([])
}

// ── The server corpus ───────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "../../../..")
const SRC = join(ROOT, "src")

const rel = (p: string) => relative(ROOT, p).split("\\").join("/")

/**
 * Server code, by the four ways this project spells it.
 *
 * `lib/shared/` is in because a shared module runs wherever it is imported, and
 * the server imports most of it — an emit there is a server emit half the time,
 * which is enough to want it written down. Nothing in `lib/client/` or `routes/`
 * outside `+server.ts` is: see the scope note in the docblock.
 */
const isServerModule = (abs: string): boolean => {
	const r = relative(SRC, abs).split("\\").join("/")
	return (
		r.startsWith("lib/server/") ||
		r.startsWith("lib/shared/") ||
		r === "hooks.server.ts" ||
		/(?:^|\/)\+server\.ts$/.test(r) ||
		/\.server\.ts$/.test(r)
	)
}

const isTestFile = (p: string) => /\.(?:test|spec)\.ts$/.test(p)

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name)
		if (entry.isDirectory()) {
			if (entry.name !== "node_modules") walk(p, out)
		} else if (entry.name.endsWith(".ts") && !isTestFile(p)) {
			out.push(p)
		}
	}
	return out
}

const SERVER_SOURCES = walk(SRC).filter(isServerModule).sort()

// ── What counts as an emit, and what counts as a projection ─────────────────

/**
 * The emit spellings, enumerated from this codebase rather than assumed.
 *
 * A scan of every property-access call whose name contains "emit", across every
 * server module, returns exactly four shapes today — and all four are the same
 * verb reached through a different handle:
 *
 *   `socket.emit(…)`                    activity.ts, taskQueue.ts
 *   `io.to(room).emit(…)`               index.ts, broadcastHelpers.ts
 *   `socket.io.to(room).emit(…)`        index.ts, pipelines.ts, sessions.ts
 *   `socket.server.to(room).emit(…)`    users.ts — the only `socket.server` in
 *                                       the entire repo, and gone since
 *                                       2026-09-15; the shape stays matched
 *                                       because nothing stops the next one
 *
 * The receiver is therefore not worth matching on: this matches the NAME, and
 * `emitWithAck` / `serverSideEmit` are here because socket.io offers them and a
 * future emit may reach for one. `send` is socket.io's alias for
 * `emit("message", …)` and is narrowed by receiver, because every HTTP response
 * and child process in server code also has one.
 */
const EMIT_NAMES: ReadonlySet<string> = new Set([
	"emit",
	"emitWithAck",
	"serverSideEmit"
])

/** `send` counts only when the thing it is called on reads like a socket. */
const SOCKET_HANDLE = /\b(?:socket|io|server|nsp|namespace)\b/i

/**
 * The projections from `connections/visibility.ts` that make an emit safe.
 *
 * Both are the OUTBOUND walk. `namesAConnection` and `connectionsVisibleTo` are
 * deliberately absent — see the docblock. Asserted against the module's actual
 * exports below, so renaming one fails here rather than silently un-sanctioning
 * every emitter that calls it.
 */
const REDACTORS: ReadonlySet<string> = new Set([
	"redactConnections",
	"withoutConnectionIdentity"
])

const VISIBILITY = join(SRC, "lib/server/connections/visibility.ts")

// ── The scan ────────────────────────────────────────────────────────────────

/**
 * One line, and no space around a `.` — a receiver written across four lines
 * (`socket.io\n\t.to(room)\n\t.emit(…)`) must produce the same subject as the
 * same call written on one, or reformatting the file invalidates an entry below.
 */
const collapse = (s: string) =>
	s
		.replace(/\s+/g, " ")
		.replace(/\s*\.\s*/g, ".")
		.trim()

/** `to("user_" + userId)` → `to(…)`, so a subject survives an edit to the room. */
function elideArgs(text: string): string {
	let out = text
	for (;;) {
		const next = out.replace(/\(([^()]*)\)/g, (_m, inner: string) =>
			inner.trim() ? "(…)" : "()"
		)
		if (next === out) return out
		out = next
	}
}

const isFunctionLike = (n: ts.Node): boolean =>
	ts.isArrowFunction(n) ||
	ts.isFunctionExpression(n) ||
	ts.isFunctionDeclaration(n) ||
	ts.isMethodDeclaration(n) ||
	ts.isConstructorDeclaration(n) ||
	ts.isGetAccessorDeclaration(n) ||
	ts.isSetAccessorDeclaration(n)

/** The nearest function-like ancestor — the scope a redaction has to be in. */
function enclosingFunction(node: ts.Node): ts.Node | undefined {
	for (let n: ts.Node | undefined = node.parent; n; n = n.parent)
		if (isFunctionLike(n)) return n
	return undefined
}

const nameOf = (n: ts.Node): string | undefined => {
	const named = n as { name?: ts.Node }
	if (
		named.name &&
		(ts.isIdentifier(named.name) || ts.isStringLiteral(named.name))
	)
		return named.name.text
	return undefined
}

/**
 * Where a site is, as the innermost two names above it — `sessionsRemoveGuest.
 * handler`, `registerActivityHandlers.send`.
 *
 * Names rather than line numbers, so an entry below survives every edit that
 * does not move the emit into a different function. Anonymous the whole way up
 * (an arrow handed straight to a call) reads `<anonymous>`, which is why the
 * subject also carries the call text.
 */
function whereIs(node: ts.Node): string {
	const parts: string[] = []
	for (let n: ts.Node | undefined = node; n; n = n.parent) {
		if (
			ts.isFunctionDeclaration(n) ||
			ts.isMethodDeclaration(n) ||
			ts.isVariableDeclaration(n) ||
			ts.isPropertyAssignment(n) ||
			ts.isPropertyDeclaration(n)
		) {
			const name = nameOf(n)
			if (name) parts.unshift(name)
		}
	}
	return parts.slice(-2).join(".") || "<anonymous>"
}

/** The event, when the source says which one. */
function eventText(arg: ts.Expression | undefined, sf: ts.SourceFile): string {
	if (!arg) return "<none>"
	if (ts.isStringLiteral(arg)) return JSON.stringify(arg.text)
	if (ts.isNoSubstitutionTemplateLiteral(arg) || ts.isTemplateExpression(arg))
		return collapse(arg.getText(sf))
	return "<computed>"
}

/** Local names in this file that resolve to a projection in `visibility.ts`. */
function redactorLocals(sf: ts.SourceFile): Set<string> {
	const locals = new Set<string>()
	for (const stmt of sf.statements) {
		if (
			!ts.isImportDeclaration(stmt) ||
			!ts.isStringLiteral(stmt.moduleSpecifier) ||
			!/connections\/visibility$/.test(stmt.moduleSpecifier.text)
		)
			continue
		const bindings = stmt.importClause?.namedBindings
		if (!bindings || !ts.isNamedImports(bindings)) continue
		for (const el of bindings.elements)
			if (REDACTORS.has((el.propertyName ?? el.name).text))
				locals.add(el.name.text)
	}
	return locals
}

/** Does anything in this scope call one of them? */
function callsRedactor(scope: ts.Node, locals: ReadonlySet<string>): boolean {
	if (!locals.size) return false
	let found = false
	const visit = (n: ts.Node) => {
		if (found) return
		if (
			ts.isCallExpression(n) &&
			ts.isIdentifier(n.expression) &&
			locals.has(n.expression.text)
		) {
			found = true
			return
		}
		ts.forEachChild(n, visit)
	}
	visit(scope)
	return found
}

interface EmitSite {
	readonly subject: string
	/** The enclosing function projects, so this site is redacting in place. */
	readonly redacting: boolean
}

function emitSites(): EmitSite[] {
	const bySubject = new Map<string, EmitSite>()

	for (const path of SERVER_SOURCES) {
		const text = readFileSync(path, "utf8")
		// Cheap gate: the AST parse is the expensive half and most of
		// `lib/server` has no emit in it at all.
		if (
			!/\.(?:emit|emitWithAck|serverSideEmit|send)\b|\[["']emit/.test(
				text
			)
		)
			continue
		const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
		const locals = redactorLocals(sf)

		const visit = (n: ts.Node) => {
			ts.forEachChild(n, visit)
			if (!ts.isCallExpression(n)) return

			const callee = n.expression
			let method: string | undefined
			let receiver: ts.Expression | undefined

			if (ts.isPropertyAccessExpression(callee)) {
				method = callee.name.text
				receiver = callee.expression
			} else if (
				ts.isElementAccessExpression(callee) &&
				callee.argumentExpression &&
				ts.isStringLiteral(callee.argumentExpression)
			) {
				// `socket["emit"](…)` — the same call wearing a hat.
				method = callee.argumentExpression.text
				receiver = callee.expression
			}
			if (!method || !receiver) return

			const receiverText = elideArgs(collapse(receiver.getText(sf)))
			const isEmit =
				EMIT_NAMES.has(method) ||
				(method === "send" && SOCKET_HANDLE.test(receiverText))
			if (!isEmit) return

			const scope = enclosingFunction(n)
			const subject =
				`${rel(path)} :: ${whereIs(n)} → ` +
				`${receiverText}.${method}(${eventText(n.arguments[0], sf)})`
			if (!bySubject.has(subject))
				bySubject.set(subject, {
					subject,
					redacting: !!scope && callsRedactor(scope, locals)
				})
		}
		visit(sf)
	}

	return [...bySubject.values()].sort((a, b) =>
		a.subject.localeCompare(b.subject)
	)
}

const SITES = emitSites()
const REDACTING = SITES.filter((s) => s.redacting).map((s) => s.subject)
const BARE = SITES.filter((s) => !s.redacting).map((s) => s.subject)

// ── §1 The emitters that project ────────────────────────────────────────────

/**
 * The raw emits that ARE the boundary, each naming whose adminness it consults.
 *
 * That last part is the content of this list. Every entry here calls a
 * projection, so "does it redact" is already settled by the scan — what a reader
 * cannot settle from the code in one glance is whether the SUBJECT it redacts
 * against is the recipient. `broadcastToSessionUsers` passed that test for
 * months while asking about `socket.user` and delivering to somebody else.
 */
const REDACTING_EMITTERS: Deliberate[] = [
	{
		subject:
			"src/lib/server/sockets/activity.ts :: registerActivityHandlers.send → socket.emit(<computed>)",
		reason:
			"Hole 3, closed. The activity store's emitter — registered with " +
			"`activityStore.registerEmitter`, so the store calls it and " +
			"`emitToUser` never sees it. Subject is `socket.user` and the room " +
			"is `socket` itself, so the recipient IS the subject. What it " +
			"removes is the `connection` bag `activityError` puts on a " +
			"terminalised record; `errorMessage` beside it is free text no " +
			"key-shaped rule can reach, which is `activityError`'s job."
	},
	{
		subject:
			"src/lib/server/sockets/index.ts :: connectSockets.emitToUser → io.to(…).emit(<computed>)",
		reason:
			"THE wrapper. Every handler in the app is handed this and emits " +
			"through it. The room is `user_<this socket's own user>` and the " +
			"subject is that socket's `socket.user`, so recipient and subject " +
			"are the same person by construction — and demotion force-" +
			"disconnects a user's sockets, so the flag cannot go stale under a " +
			"live connection."
	},
	{
		subject:
			"src/lib/server/sockets/index.ts :: emitToUser.deliver → io.to(…).emit(<computed>)",
		reason:
			"THE wrapper's other half — the per-socket delivery a GATED event " +
			"takes (socket-interest plan, ruling 5). One emit per socket in " +
			"the room that declared the key, so the subject is that socket's " +
			"own `target.user` rather than the emitting socket's: the same " +
			"person as the recipient, named at the recipient rather than " +
			"inferred from the room. Same staleness argument as the entry " +
			"above — demotion force-disconnects a user's sockets."
	},
	{
		subject:
			"src/lib/server/sockets/pipelines.ts :: registerPipelineHandlers.push → socket.io.to(…).emit(<computed>)",
		reason:
			"Hole 1, closed. The review gate's push transport — shared with " +
			"the cap pause (E1c), which parks the same way — bound once per " +
			"process — a review can park from any trigger, so it pushes by user " +
			"rather than through the handler that started the run, and the " +
			"socket it was installed from belongs to whoever connected last. " +
			"The subject is therefore a fresh `users.isAdmin` read for the " +
			"RECIPIENT, not `socket.user`. Affordable because a review and a " +
			"cap pause are human-paced: one push per gated node or parked run, " +
			"per person."
	},
	{
		subject:
			"src/lib/server/sockets/utils/broadcastHelpers.ts :: emitRedacted → io.to(…).emit(<computed>)",
		reason:
			"Hole 4, closed. Session fan-out reaches guests as well as the " +
			"owner, so there is no single `socket.user` to ask about: this " +
			"projects ONCE, reads the admin roster for the recipients in one " +
			"query, and hands each of them the copy their own adminness earns. " +
			"The roster is only read when the payload actually carried identity, " +
			"which `withoutConnectionIdentity` answers by returning the same " +
			"object when it found nothing."
	}
]

describe("§1 socket egress — every in-place projection is written down", () => {
	test("an emit that redacts names the subject it redacts against", () => {
		expectExactlyExcused(REDACTING, REDACTING_EMITTERS, {
			list: "REDACTING_EMITTERS",
			unwired:
				"raw emit(s) that call a projection and say nothing about WHOSE " +
				"adminness they consult — which is the half `broadcastTo" +
				"SessionUsers` got wrong while calling the projection correctly",
			fix: "Emit through `emitToUser` or `emitRedacted` instead"
		})
	})
})

// ── §2 The emits that do not project ────────────────────────────────────────

/**
 * Raw emits that run no projection, and the reason each is safe without one.
 *
 * ⚠ It was five. `users.ts :: user` — the fifth hole this file was written to
 * find — is not here any more because the emit is not there any more: it goes
 * through `emitToUser` since 2026-09-15. A list that shrinks by a fix rather
 * than by an edit is the only kind of shrinking worth having.
 *
 * Four entries against four sanctioned emitters is a thin-looking margin, and it
 * is stated rather than hidden: this file's value is not the ratio, it is that
 * the population is CLOSED. Every site accounted for, and the next one fails on
 * the day it is written.
 */
const UNREDACTED_EMITS: Deliberate[] = [
	{
		subject:
			"src/lib/server/sockets/index.ts :: register → socket.io.to(…).emit(`${handler.event}:error`)",
		reason:
			"The generic catch-all in `register`, and its payload is one frozen " +
			'sentence written on the line above it — `{ error: "An error ' +
			'occurred while processing your request." }`. Nothing from the ' +
			"handler, the params or the thrown error reaches it, which is the " +
			"whole design: the specific, useful message was already emitted " +
			"through `emitToUser` by whichever handler caught its own failure. " +
			"⚠ `emitToUser` is a parameter of `register` and is in scope on " +
			"this very line, so this raw emit buys nothing; routing it through " +
			"the wrapper would delete this entry. Left alone deliberately — " +
			"this lane guards, it does not fix."
	},
	{
		subject:
			'src/lib/server/sockets/sessions.ts :: sessionsRemoveGuestHandler.handler → socket.io.to(…).emit("sessions:removedAsGuest")',
		reason:
			"The payload is `{ sessionId }` — one integer the recipient owned a " +
			"moment ago, since they were a guest on it. No row, no error, no " +
			"free text, so there is nothing for the walk to find. Notable for " +
			"where it sits: a dozen lines below `emitToUserRedacted` and " +
			"`broadcastToSessionUsers` calls in the same handler, which is what " +
			"a raw emit looks like when the wrapper was right there."
	},
	{
		subject:
			"src/lib/server/sockets/taskQueue.ts :: registerTaskQueueHandlers.send → socket.emit(<computed>)",
		reason:
			"⚠ Redacted by a ROLE GATE, not by the rule, and the payload is one " +
			"the rule would act on: `QueuedTask.connectionName` is a member of " +
			"`CONNECTION_IDENTITY_KEYS`, once per queued task. It is safe " +
			"because `registerTaskQueueHandlers` returns immediately unless " +
			"`socket.user?.isAdmin`, so a non-admin socket never gets these " +
			"listeners at all — and demotion force-disconnects, so the gate " +
			"cannot go stale. The gate is the only thing holding it: relax that " +
			"early return, or register the emitter from anywhere else, and " +
			"`connectionName` ships. ONE subject where there were two: the " +
			"connect snapshot, the `taskQueue:get` re-fetch and the function " +
			"handed to `taskQueue.registerEmitter` (which the store calls on " +
			"every queue change) all go through this one closure now, because " +
			"the **interest gate** has to be applied at each of them and a rule " +
			"spelled three times is a rule two of them can drift from. Same " +
			"shape as hole 3, where a store-registered emitter was how the " +
			"activity stream escaped the walk entirely."
	}
]

describe("§2 socket egress — every raw emit is written down", () => {
	test("no server emit skips the projection unexplained", () => {
		expectExactlyExcused(BARE, UNREDACTED_EMITS, {
			list: "UNREDACTED_EMITS",
			unwired:
				"raw socket emit(s) in server code that run no connection " +
				"projection — the shape of all four holes the 0.6 audit found " +
				"by reading code, because no test could see them",
			fix:
				"Emit through `emitToUser` (own room), `emitToUserRedacted` " +
				"(somebody else's), or `broadcastToSessionUsers` (a session)"
		})
	})
})

// ── §3 The floor ────────────────────────────────────────────────────────────

/**
 * What makes the two sections above mean anything.
 *
 * A scan that silently read nothing — a corpus filter that stopped matching, a
 * parse that threw into an empty array — would make every assertion here
 * vacuously pass, and the file would keep passing forever while guarding
 * nothing. That is the exact failure mode `wiring.test.ts` calls "decoration".
 */
describe("§3 socket egress — the scan is reading something", () => {
	test("the server corpus and the emit scan are both non-empty", () => {
		expect(SERVER_SOURCES.length).toBeGreaterThan(100)
		expect(SITES.length).toBeGreaterThanOrEqual(8)
		expect(REDACTING.length).toBeGreaterThan(0)
	})

	test("the four known egress points are all still found", () => {
		// Named files rather than a count: these are the places the rule is
		// applied, and one of them vanishing from the scan means the scan
		// stopped seeing that spelling, not that the emit became safe.
		for (const file of [
			"src/lib/server/sockets/index.ts",
			"src/lib/server/sockets/activity.ts",
			"src/lib/server/sockets/pipelines.ts",
			"src/lib/server/sockets/utils/broadcastHelpers.ts"
		])
			expect(
				REDACTING.some((s) => s.startsWith(`${file} ::`)),
				`${file} no longer contains an emit that this scan can see as ` +
					`redacting. Either the emit moved, or the projection left ` +
					`the function it sits in — both are worth stopping for.`
			).toBe(true)
	})

	test("every projection this file sanctions is one visibility.ts exports", () => {
		// A rename in `visibility.ts` would otherwise un-sanction every emitter
		// that calls it, and they would all fail at once with a message about
		// the wrong thing.
		const source = readFileSync(VISIBILITY, "utf8")
		for (const name of REDACTORS)
			expect(
				new RegExp(
					`export\\s+(?:const|function|async function)\\s+${name}\\b`
				).test(source),
				`REDACTORS names \`${name}\`, which connections/visibility.ts ` +
					`no longer exports. Update REDACTORS to the new name — do ` +
					`not delete it, or every emitter that calls it silently ` +
					`stops counting as redacting.`
			).toBe(true)
	})
})
