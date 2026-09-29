/**
 * The `meta.json` database lock: who holds this data directory, and whether a
 * lock found in it is still real.
 *
 * Two live processes must never open one PGlite directory. The failure mode is
 * WAL corruption, which is not recoverable without `pg_resetwal` and has cost
 * this project a database before. So every case this module cannot decide
 * resolves to "keep waiting", never to "go ahead": ownership can only ever
 * shorten a wait, and the timestamp expiry that predates it is still what
 * ultimately releases a lock nobody can vouch for.
 *
 * **Plain JavaScript on purpose.** `scripts/check-db-lock.js` is run by
 * `npm run db:generate` with bare `node`, outside any build or TypeScript
 * pipeline, and it writes the same `meta.lock` that the app reads. Keeping the
 * protocol in one file both sides import is what stops them drifting — they had
 * already drifted, disagreeing about how long a lock lasts (10s in the app, 5s
 * in the script) while reading each other's writes.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { execFileSync } from "node:child_process"

/**
 * The owning process, recorded alongside the timestamp.
 *
 * @typedef {object} LockOwner
 * @property {number} pid Process id, `0` when it was not a usable integer.
 * @property {string | null} hostId Machine + PID-namespace identity; see
 *   `getHostId()`. `null` when this build could not establish one.
 * @property {string | null} hostname Display only. Never used to decide.
 * @property {string | null} instanceId Random per-run id of the holder.
 * @property {string | null} label Which program took it ("app", "db-cli").
 */

/**
 * @typedef {object} DbLock
 * @property {number} timestamp When the lock was last refreshed.
 * @property {number} lockLength How long that refresh is good for, in ms.
 * @property {LockOwner} [owner] Absent on locks written before ownership
 *   existed, which is exactly why `timestamp` is still load-bearing.
 */

/**
 * @typedef {object} LockIdentity
 * @property {string | null} hostId
 * @property {string | null} hostname
 * @property {number} pid
 * @property {string} instanceId
 */

/**
 * @typedef {"free" | "self" | "stale" | "held" | "unreadable"} LockState
 */

/**
 * @typedef {object} LockEvaluation
 * @property {LockState} state
 * @property {string} reason
 * @property {LockOwner | null} owner
 * @property {number | null} refreshedAt
 * @property {number | null} expiresAt
 */

/**
 * How long a written lock stays valid without a refresh.
 *
 * One spelling, imported by both writers. `scripts/check-db-lock.js` used to
 * declare its own 5000 while writing the same `meta.lock` this module reads, so
 * a lock taken by `db:generate` claimed half the life the app assumed it had.
 */
export const DEFAULT_LOCK_LENGTH = 10000

/** A holder refreshes its lock one second before it would expire. */
export const LOCK_HEARTBEAT_INTERVAL = DEFAULT_LOCK_LENGTH - 1000

/**
 * Longest a starting process will wait on a lock somebody else is holding.
 *
 * Only reached when the holder is genuinely alive and refreshing, because a
 * holder that exits either clears its lock or becomes provably gone — both of
 * which end the wait immediately. So this bounds the pathological case (a
 * second app really is running), where waiting longer would not have helped and
 * the right answer is a message naming the process to stop.
 */
export const DEFAULT_LOCK_WAIT_TIMEOUT = 2 * DEFAULT_LOCK_LENGTH

/** How often the wait re-reads the lock. */
export const DEFAULT_LOCK_POLL_INTERVAL = 250

/**
 * How long an unreadable `meta.json` is retried before it is believed.
 *
 * Our own writes are atomic, but an older build sharing this data directory
 * rewrites the file in place, and a read that catches one of those mid-write
 * parses as nothing at all — which is indistinguishable from "no lock", the one
 * misreading that lets two processes in. A tear resolves within microseconds; a
 * genuinely corrupt file does not.
 */
export const LOCK_UNREADABLE_GRACE = 500

/** Basename of the host-identity nonce, kept in the OS temp directory. */
const HOST_ID_FILE = "serene-pub-host-id"

/** @type {string | null | undefined} */
let cachedHostId

/** @type {string} */
let cachedInstanceId = ""

/**
 * A random identifier for this machine, persisted in the OS temp directory.
 *
 * `os.hostname()` is not enough on its own: a data directory can be shared over
 * a network mount, and two machines may answer to the same name. A nonce in
 * `os.tmpdir()` cannot be shared that way — /tmp is machine-local on every
 * platform we run on, and a container gets its own — so two processes agreeing
 * on this value really are looking at the same process table.
 *
 * Returns `null` if it can neither read nor write one (a read-only temp
 * directory, say). That is safe by construction: a null host id never matches,
 * so ownership is simply never trusted and the timestamp decides, exactly as it
 * did before this file existed.
 *
 * @returns {string | null}
 */
function readHostNonce() {
	const file = path.join(os.tmpdir(), HOST_ID_FILE)
	try {
		const existing = fs.readFileSync(file, "utf-8").trim()
		if (existing) return existing
	} catch {
		// Not there yet, or not readable. Fall through and try to write one.
	}
	const nonce = crypto.randomUUID()
	try {
		// "wx" so two processes racing to create it cannot each win: the loser
		// gets EEXIST and re-reads the winner's value below.
		fs.writeFileSync(file, `${nonce}\n`, { flag: "wx" })
		return nonce
	} catch {
		try {
			const existing = fs.readFileSync(file, "utf-8").trim()
			if (existing) return existing
		} catch {
			// Nothing to be done. Ownership goes untrusted; see above.
		}
		return null
	}
}

/**
 * The PID namespace this process lives in, when the OS exposes one.
 *
 * Two containers on one kernel can share a hostname, share a bind-mounted data
 * directory, and still have completely unrelated process tables — in which case
 * asking whether "pid 41" is alive answers a question about the wrong machine.
 * Linux names that boundary and hands it to us as an inode; where there is no
 * such concept there is also no such hazard, and the empty string is correct.
 *
 * @returns {string}
 */
function readPidNamespaceTag() {
	try {
		return `|${fs.readlinkSync("/proc/self/ns/pid")}`
	} catch {
		return ""
	}
}

/**
 * Identity of the machine *and process table* this process belongs to.
 *
 * Liveness is trusted only when a lock carries this exact value, which is what
 * makes `process.kill(pid, 0)` a question about the process that wrote it
 * rather than about whatever happens to hold that number here.
 *
 * @returns {string | null}
 */
export function getHostId() {
	if (cachedHostId !== undefined) return cachedHostId
	const nonce = readHostNonce()
	cachedHostId = nonce === null ? null : `${nonce}${readPidNamespaceTag()}`
	return cachedHostId
}

/**
 * Random id for this run, so a holder can recognise the lock it wrote.
 *
 * @returns {string}
 */
export function getInstanceId() {
	if (!cachedInstanceId) cachedInstanceId = crypto.randomUUID()
	return cachedInstanceId
}

/**
 * @returns {LockIdentity}
 */
export function getIdentity() {
	return {
		hostId: getHostId(),
		hostname: os.hostname(),
		pid: process.pid,
		instanceId: getInstanceId()
	}
}

/**
 * Whether a pid is running, erring towards "yes" in every ambiguous case.
 *
 * Only `ESRCH` — no such process — is proof of death. `EPERM` means the process
 * exists and belongs to another user, which is emphatically alive; reading it
 * as dead would hand a live holder's database to a second process. Anything
 * else is unclassified and treated the same way.
 *
 * Meaningful only for a pid on this host. Callers must establish that first.
 *
 * @param {number} pid
 * @returns {"alive" | "dead" | "unknown"}
 */
export function processLiveness(pid) {
	// `process.kill(0, ...)` signals the whole process group and a negative pid
	// signals a group by id, so a malformed pid is refused rather than sent.
	if (!Number.isInteger(pid) || pid <= 0) return "unknown"
	try {
		process.kill(pid, 0)
		return "alive"
	} catch (error) {
		const code = /** @type {NodeJS.ErrnoException} */ (error).code
		return code === "ESRCH" ? "dead" : "alive"
	}
}

/**
 * The environment variable a lock holder sets on the command it runs, naming
 * itself (its pid) as the holder that command may work under.
 *
 * `scripts/check-db-lock.js` takes the lock and then runs a command — and some
 * of those commands (`plugin:install`) import the app's database module, which
 * takes the lock again at module scope. Without this, that child found a live
 * `db-cli` lock that was not its own pid and refused it: the wrapper was
 * refusing itself, twenty seconds later.
 */
export const LOCK_DELEGATE_ENV = "SERENE_PUB_DB_LOCK_HOLDER"

/**
 * The parent of `pid`, or `null` when this platform cannot say.
 *
 * Linux reads `/proc/<pid>/stat` (field 4, after the parenthesised command
 * name, which may itself contain spaces and parentheses). Other POSIX systems
 * ask `ps`. Windows has no cheap answer and returns `null`.
 *
 * @param {number} pid
 * @returns {number | null}
 */
export function parentPid(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return null
	if (process.platform === "linux") {
		try {
			const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8")
			const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
			const ppid = Number(rest[1])
			return Number.isInteger(ppid) && ppid > 0 ? ppid : null
		} catch {
			return null
		}
	}
	if (process.platform === "win32") return null
	try {
		const out = execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"]
		})
		const ppid = Number(out.trim())
		return Number.isInteger(ppid) && ppid > 0 ? ppid : null
	} catch {
		return null
	}
}

/**
 * Every ancestor of `pid`, nearest first — or `null` when the chain cannot be
 * walked at all on this platform (so "not an ancestor" is never guessed).
 *
 * @param {number} [pid]
 * @param {{ getParent?: (pid: number) => number | null, max?: number }} [options]
 * @returns {number[] | null}
 */
export function ancestorPids(pid = process.pid, options = {}) {
	const getParent = options.getParent ?? parentPid
	const max = options.max ?? 64
	/** @type {number[]} */
	const chain = []
	let current = pid
	for (let i = 0; i < max; i++) {
		const parent = getParent(current)
		if (parent === null) {
			// Not even our own parent could be read: the platform cannot walk
			// the chain, which is different from "no ancestor matches".
			if (i === 0) return null
			break
		}
		if (parent === current || chain.includes(parent)) break
		chain.push(parent)
		current = parent
	}
	return chain
}

/**
 * Whether a lock's owner is the holder this process was launched to work
 * under, rather than somebody else.
 *
 * Both halves are required where both can be checked:
 *
 * - **The holder named us.** `delegate` is the pid the wrapper put in
 *   {@link LOCK_DELEGATE_ENV} for the command it ran. An environment variable
 *   is inherited only by descendants, so a dev server started from another
 *   terminal never carries it.
 * - **The holder is our ancestor.** Guards the leftovers: a stray variable in
 *   a shell profile, or a descendant that outlived the wrapper and whose
 *   wrapper's pid was reused. Where the chain cannot be walked (`ancestors` is
 *   `null`, e.g. Windows) the inherited variable alone is the evidence.
 *
 * Pure, so the decision is testable without real processes.
 *
 * @param {LockOwner | null} owner
 * @param {{ delegate: string | undefined | null, ancestors: () => number[] | null }} params
 * @returns {boolean}
 */
export function isDelegatedHolder(owner, params) {
	if (!owner || !(owner.pid > 0)) return false
	const delegate = Number(params.delegate)
	if (!Number.isInteger(delegate) || delegate <= 0) return false
	if (delegate !== owner.pid) return false
	const ancestors = params.ancestors()
	return ancestors === null || ancestors.includes(owner.pid)
}

/**
 * @param {unknown} raw
 * @returns {LockOwner | null}
 */
function normaliseOwner(raw) {
	if (!raw || typeof raw !== "object") return null
	const owner = /** @type {Record<string, unknown>} */ (raw)
	const pid = owner.pid
	return {
		pid:
			typeof pid === "number" && Number.isInteger(pid) && pid > 0
				? pid
				: 0,
		hostId:
			typeof owner.hostId === "string" && owner.hostId
				? owner.hostId
				: null,
		hostname: typeof owner.hostname === "string" ? owner.hostname : null,
		instanceId:
			typeof owner.instanceId === "string" ? owner.instanceId : null,
		label: typeof owner.label === "string" ? owner.label : null
	}
}

/**
 * Decide what a lock record means, right now, to this process.
 *
 * The order of the checks is the safety argument, so it is worth stating:
 *
 * 1. A lock this process itself wrote cannot block this process.
 * 2. **Expiry stays authoritative.** An expired lock is stale whatever its
 *    owner field says. This is what stops a recycled pid — a crash leaves a
 *    lock behind, the number is later reissued to some unrelated daemon — from
 *    becoming a lock nobody can ever clear.
 * 3. Only then does ownership speak — first to recognise the holder that
 *    launched this process to work under its lock (see `isDelegatedHolder`),
 *    about everyone else, and only about a lock that has *not* yet
 *    expired: an owner provably gone makes it stale immediately (the whole
 *    point — a restart no longer waits at all), an owner alive keeps us out.
 * 4. Anything unverifiable falls back to the timestamp, which is how a lock
 *    from an older build, from the other side of a network mount, or from
 *    another container is handled.
 *
 * The consequence worth naming: pid reuse can only ever make us *wait* (until
 * the timestamp expires, which is what would have happened before), never make
 * us declare a live holder's lock stale.
 *
 * @param {unknown} rawLock
 * @param {{ now?: number, identity?: LockIdentity, liveness?: (pid: number) => ("alive" | "dead" | "unknown"), delegation?: { delegate: string | undefined | null, ancestors: () => number[] | null } }} [options]
 * @returns {LockEvaluation}
 */
export function evaluateLock(rawLock, options = {}) {
	const now = options.now ?? Date.now()
	const identity = options.identity ?? getIdentity()
	const liveness = options.liveness ?? processLiveness
	const delegation = options.delegation ?? {
		delegate: process.env[LOCK_DELEGATE_ENV],
		// Walked only when a delegate is named and matches, so the app's
		// ordinary poll never spawns `ps`.
		ancestors: () => ancestorPids(identity.pid)
	}

	if (!rawLock || typeof rawLock !== "object") {
		return {
			state: "free",
			reason: "no-lock",
			owner: null,
			refreshedAt: null,
			expiresAt: null
		}
	}

	const lock = /** @type {Record<string, unknown>} */ (rawLock)
	const owner = normaliseOwner(lock.owner)
	const refreshedAt =
		typeof lock.timestamp === "number" && Number.isFinite(lock.timestamp)
			? lock.timestamp
			: null
	// A missing or nonsensical length is read as the default rather than as
	// NaN. `now < timestamp + NaN` is false, so the old code treated a
	// half-written length as "expired, go ahead" — the one direction that
	// cannot be undone.
	const lockLength =
		typeof lock.lockLength === "number" &&
		Number.isFinite(lock.lockLength) &&
		lock.lockLength > 0
			? lock.lockLength
			: DEFAULT_LOCK_LENGTH
	const expiresAt = refreshedAt === null ? null : refreshedAt + lockLength

	const sameHost =
		!!owner &&
		owner.hostId !== null &&
		identity.hostId !== null &&
		owner.hostId === identity.hostId

	// 1. Ours. Either this very run wrote it, or a predecessor that held this
	// pid did — and a predecessor holding our pid has necessarily exited, since
	// a pid identifies at most one live process at a time.
	if (sameHost && owner && owner.pid === identity.pid) {
		return {
			state: "self",
			reason:
				owner.instanceId === identity.instanceId
					? "own-lock"
					: "own-pid",
			owner,
			refreshedAt,
			expiresAt
		}
	}

	// 2. Expiry, before ownership. See the ordering note above.
	if (expiresAt !== null && now >= expiresAt) {
		return {
			state: "stale",
			reason: "expired",
			owner,
			refreshedAt,
			expiresAt
		}
	}

	// 3a. The holder that launched us to work under its lock — the
	// `check-db-lock.js` wrapper around `plugin:install`. Its lock is ours to
	// use, not a reason to refuse: waiting for it would wait for ourselves.
	// Only a live, unexpired, same-host lock gets here, and the `delegated`
	// reason keeps a delegate from ever *releasing* it (see `stop()` below).
	if (
		sameHost &&
		owner &&
		isDelegatedHolder(owner, {
			delegate: delegation.delegate,
			ancestors: delegation.ancestors
		})
	) {
		return {
			state: "self",
			reason: "delegated",
			owner,
			refreshedAt,
			expiresAt
		}
	}

	// 3. A live holder on this host keeps its lock; a dead one loses it now.
	// `pid > 0` because a pid that was missing, fractional or not a number at
	// all normalises to 0 — and 0 is not "no process", it is "every process in
	// my group". Asking about it would answer a different question.
	if (sameHost && owner && owner.pid > 0) {
		const state = liveness(owner.pid)
		if (state === "dead") {
			return {
				state: "stale",
				reason: "owner-gone",
				owner,
				refreshedAt,
				expiresAt
			}
		}
		if (state === "alive") {
			return {
				state: "held",
				reason: "owner-alive",
				owner,
				refreshedAt,
				expiresAt
			}
		}
	}

	// 4. Nothing verifiable. A record with no usable timestamp *and* no owner we
	// can vouch for carries no claim at all; anything else waits it out.
	if (expiresAt === null) {
		return {
			state: "stale",
			reason: "malformed",
			owner,
			refreshedAt,
			expiresAt
		}
	}
	return { state: "held", reason: "unexpired", owner, refreshedAt, expiresAt }
}

/**
 * @param {number} ms
 * @returns {string}
 */
function seconds(ms) {
	return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Who holds this lock, in a form a person can act on.
 *
 * @param {LockEvaluation} evaluation
 * @param {{ now?: number, identity?: LockIdentity }} [options]
 * @returns {string}
 */
export function describeLockHolder(evaluation, options = {}) {
	const now = options.now ?? Date.now()
	const identity = options.identity ?? getIdentity()
	const owner = evaluation.owner
	// Who it is reads as one phrase; when it was last seen reads as clauses
	// after it.
	const who = []
	const parts = []

	if (owner && owner.pid > 0) {
		who.push(`pid ${owner.pid}`)
	} else {
		who.push("an unidentified process")
	}
	if (owner && owner.hostname) who.push(`on host "${owner.hostname}"`)
	if (owner && owner.hostId !== null) {
		who.push(
			owner.hostId === identity.hostId
				? "(this machine)"
				: "(a different machine or container)"
		)
	} else if (owner === null) {
		who.push("(lock records no owner — written by an older build)")
	}
	if (owner && owner.label) who.push(`[${owner.label}]`)
	parts.push(who.join(" "))
	if (evaluation.refreshedAt !== null) {
		parts.push(`refreshed ${seconds(now - evaluation.refreshedAt)} ago`)
	}
	if (evaluation.expiresAt !== null) {
		const remaining = evaluation.expiresAt - now
		parts.push(
			remaining > 0
				? `expires in ${seconds(remaining)}`
				: `expired ${seconds(-remaining)} ago`
		)
	}
	return parts.join(", ")
}

/**
 * The message printed when a wait gives up. Says who, and says what to do.
 *
 * @param {{ evaluation: LockEvaluation, metaPath: string, waitedMs: number, identity?: LockIdentity }} params
 * @returns {string}
 */
export function lockFailureMessage(params) {
	const { evaluation, metaPath, waitedMs } = params
	const identity = params.identity ?? getIdentity()
	const owner = evaluation.owner
	const onThisMachine =
		!!owner && owner.hostId !== null && owner.hostId === identity.hostId
	// Reads for both callers: the app waits before giving up, the `db:generate`
	// CLI refuses immediately, and neither should describe the other's timing.
	const waited =
		waitedMs >= 1000
			? ` and did not release it after ${seconds(waitedMs)}`
			: ""
	const lines = [
		`Database is locked by another process${waited}.`,
		`  Held by: ${describeLockHolder(evaluation, { identity })}`,
		`  Lock file: ${metaPath}`,
		"What to do:"
	]
	if (onThisMachine && owner && owner.pid > 0) {
		lines.push(
			`  • Stop the other Serene Pub instance — it is pid ${owner.pid} on this machine.`
		)
	} else {
		lines.push(
			"  • Stop the other Serene Pub instance that has this data directory open."
		)
	}
	lines.push(
		`  • If you are certain nothing is running, remove the "lock" entry from ${metaPath} and start again.`,
		"Exiting rather than opening the database twice: two processes on one PGlite directory corrupts it."
	)
	return lines.join("\n")
}

/**
 * @typedef {{ ok: true, meta: Record<string, unknown> } | { ok: false, missing: boolean, error: unknown }} MetaRead
 */

/**
 * Read `meta.json`. Never writes, never repairs — a lock check that repairs the
 * file it is reading is a lock check that can erase somebody else's lock (and,
 * as it happens, the crypto secret key alongside it).
 *
 * @param {string} metaPath
 * @returns {MetaRead}
 */
export function readMetaFile(metaPath) {
	try {
		const parsed = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
		if (!parsed || typeof parsed !== "object") {
			return {
				ok: false,
				missing: false,
				error: new Error("meta.json is not an object")
			}
		}
		return { ok: true, meta: parsed }
	} catch (error) {
		const code = /** @type {NodeJS.ErrnoException} */ (error).code
		return { ok: false, missing: code === "ENOENT", error }
	}
}

/**
 * Write `meta.json` so a reader can never see half of it.
 *
 * The wait polls this file several times a second while its holder rewrites it
 * on a timer, and a torn read is indistinguishable from "no lock" — which is
 * the one misreading that lets two processes in. Writing to a sibling temp file
 * and renaming makes the swap atomic on every platform we ship to, so that read
 * cannot happen at all.
 *
 * @param {string} metaPath
 * @param {unknown} meta
 * @returns {void}
 */
export function writeMetaFile(metaPath, meta) {
	const body = JSON.stringify(meta, null, 2)
	const tmp = path.join(
		path.dirname(metaPath),
		`.${path.basename(metaPath)}.${process.pid}.tmp`
	)
	try {
		fs.writeFileSync(tmp, body)
		fs.renameSync(tmp, metaPath)
	} catch (error) {
		try {
			fs.unlinkSync(tmp)
		} catch {
			// Never written, or already gone.
		}
		// A filesystem that cannot rename still deserves a lock.
		fs.writeFileSync(metaPath, body)
	}
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * @typedef {object} LockCheckResult
 * @property {boolean} ok Whether it is safe to open the database.
 * @property {LockEvaluation} evaluation
 * @property {number} waitedMs
 * @property {number} polls How many times the lock was re-read.
 * @property {string} [message] Present only when `ok` is false.
 */

/**
 * Wait, if waiting is needed, until this process may open the database.
 *
 * Polls rather than sleeping once. The single recheck this replaces was the
 * reported bug: it slept for the expiry of the lock it first saw, and by then
 * the outgoing process had refreshed that lock at least once, so the one recheck
 * always found a fresh lock and exited — "waited the right amount of time, still
 * says locked". Re-reading on an interval means a holder that goes away during
 * the wait releases us immediately, while one that keeps heartbeating keeps us
 * out for as long as it is really there.
 *
 * @param {{ metaPath: string, waitTimeout?: number, pollInterval?: number, identity?: LockIdentity, log?: Pick<Console, "log" | "warn">, liveness?: (pid: number) => ("alive" | "dead" | "unknown") }} options
 * @returns {Promise<LockCheckResult>}
 */
export async function checkDatabaseLock(options) {
	const {
		metaPath,
		waitTimeout = DEFAULT_LOCK_WAIT_TIMEOUT,
		pollInterval = DEFAULT_LOCK_POLL_INTERVAL,
		log = console,
		liveness
	} = options
	const identity = options.identity ?? getIdentity()
	const started = Date.now()
	const deadline = started + Math.max(0, waitTimeout)

	const graceUntil = started + LOCK_UNREADABLE_GRACE
	let polls = 0
	let announced = false
	/** Whether a lock has ever been read successfully from this file. */
	let sawLock = false
	/** @type {LockEvaluation} */
	let last = {
		state: "held",
		reason: "unknown",
		owner: null,
		refreshedAt: null,
		expiresAt: null
	}

	for (;;) {
		const read = readMetaFile(metaPath)
		polls += 1

		if (read.ok) {
			const evaluation = evaluateLock(read.meta.lock, {
				now: Date.now(),
				identity,
				liveness
			})
			if (evaluation.state !== "held") {
				return {
					ok: true,
					evaluation,
					waitedMs: Date.now() - started,
					polls
				}
			}
			last = evaluation
			sawLock = true
			if (!announced) {
				announced = true
				log.log(
					`Database locked by ${describeLockHolder(evaluation, { identity })}. ` +
						`Waiting up to ${seconds(deadline - started)} for it to be released...`
				)
			}
		} else if (read.missing) {
			// No meta.json at all, so no lock. A fresh data directory.
			return {
				ok: true,
				evaluation: {
					state: "free",
					reason: "no-meta-file",
					owner: null,
					refreshedAt: null,
					expiresAt: null
				},
				waitedMs: Date.now() - started,
				polls
			}
		} else if (!sawLock && Date.now() >= Math.min(graceUntil, deadline)) {
			// Unreadable, never having seen a lock here, and it has stayed that
			// way past the grace above — so this is a damaged file rather than
			// a torn read. Reported rather than guessed at: the app warns and
			// carries on (its own meta.json recovery has already run by this
			// point), the CLI refuses.
			return {
				ok: true,
				evaluation: {
					state: "unreadable",
					reason: String(
						/** @type {Error} */ (read.error)?.message ?? read.error
					),
					owner: null,
					refreshedAt: null,
					expiresAt: null
				},
				waitedMs: Date.now() - started,
				polls
			}
		}
		// Otherwise unreadable and still worth another look — either inside the
		// grace, or during a wait where we have already seen a lock and somebody
		// is mid-write. Deliberately never read as "free".

		const remaining = deadline - Date.now()
		if (remaining <= 0) break
		await sleep(Math.min(pollInterval, remaining))
	}

	const waitedMs = Date.now() - started
	return {
		ok: false,
		evaluation: last,
		waitedMs,
		polls,
		message: lockFailureMessage({
			evaluation: last,
			metaPath,
			waitedMs,
			identity
		})
	}
}

/**
 * @typedef {object} LockHeartbeat
 * @property {() => void} start Take the lock and keep refreshing it.
 * @property {() => void} stop Drop the timer and release the lock, if it is ours.
 * @property {() => boolean} isHolding
 */

/**
 * A held lock, refreshed on a timer until it is released.
 *
 * @param {{ metaPath: string, dataDir?: string, label?: string, lockLength?: number, interval?: number, log?: Pick<Console, "log" | "warn" | "error"> }} options
 * @returns {LockHeartbeat}
 */
export function createLockHeartbeat(options) {
	const {
		metaPath,
		dataDir,
		label = "app",
		lockLength = DEFAULT_LOCK_LENGTH,
		interval = LOCK_HEARTBEAT_INTERVAL,
		log = console
	} = options

	/** @type {LockIdentity | null} */
	let cached = null
	/**
	 * Resolved on first use rather than at construction. This factory is called
	 * at module scope — including during a build, which must touch nothing —
	 * and establishing a host identity reads and writes a file.
	 *
	 * @returns {LockIdentity}
	 */
	const identity = () => (cached ??= getIdentity())

	/** @type {ReturnType<typeof setInterval> | null} */
	let timer = null
	let holding = false

	/**
	 * Whether the data directory is still there.
	 *
	 * The heartbeat writes `meta.json` on a timer, and a write recreates a file
	 * whose directory is mid-teardown. That is wrong in production — a server
	 * whose data directory has been deleted out from under it should stop
	 * writing, not resurrect a lone lock file — and in the test suite it was an
	 * intermittent failure: a temp data directory being torn down would have
	 * `meta.json` written back into it mid-walk, so the final `rmdir` hit
	 * `ENOTEMPTY`. Different file each run, roughly one run in three.
	 *
	 * @returns {boolean}
	 */
	function dataDirPresent() {
		return dataDir === undefined || fs.existsSync(dataDir)
	}

	function write() {
		try {
			const read = readMetaFile(metaPath)
			/** @type {Record<string, unknown>} */
			let meta
			if (read.ok) {
				meta = read.meta
			} else if (read.missing) {
				// Nothing there yet: the CLI can be first to the directory.
				meta = { version: "0.0.0" }
			} else {
				// Unreadable but present. Rewriting it from scratch here is how
				// the crypto secret key would get silently replaced, so skip
				// this beat instead; the file's owner repairs it, not us.
				log.warn(
					`Warning: could not read ${metaPath} to refresh the database lock; skipping this refresh.`
				)
				return
			}
			const me = identity()
			meta.lock = {
				timestamp: Date.now(),
				lockLength,
				owner: {
					pid: me.pid,
					hostId: me.hostId,
					hostname: me.hostname,
					instanceId: me.instanceId,
					label
				}
			}
			writeMetaFile(metaPath, meta)
			holding = true
		} catch (error) {
			log.error("Failed to update database lock:", error)
		}
	}

	function stop() {
		if (timer) {
			clearInterval(timer)
			timer = null
		}
		// Never took one, so there is nothing of ours to release — and nothing
		// to justify writing to a file we may not own.
		if (!holding) return
		holding = false
		if (!dataDirPresent()) return

		try {
			const read = readMetaFile(metaPath)
			if (!read.ok) return
			const evaluation = evaluateLock(read.meta.lock, {
				identity: identity()
			})
			// Only ever clear our own. A process that loses the race used to
			// clear the *winner's* lock on its way out through the `exit`
			// handler, leaving the live holder's database advertised as free.
			// Nor a lock we were only *delegated*: the wrapper that took it
			// is still running and releases it itself.
			if (evaluation.state !== "self" || evaluation.reason === "delegated")
				return
			delete read.meta.lock
			writeMetaFile(metaPath, read.meta)
		} catch (error) {
			log.error("Failed to clear database lock:", error)
		}
	}

	function start() {
		if (timer) return
		write()
		timer = setInterval(() => {
			if (!dataDirPresent()) {
				stop()
				return
			}
			write()
		}, interval)
	}

	return {
		isHolding: () => holding,
		start,
		stop
	}
}
