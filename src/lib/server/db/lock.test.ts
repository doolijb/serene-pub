/**
 * The decision half of the database lock, pinned case by case.
 *
 * Every branch here is a place where getting it wrong lets two processes open
 * one PGlite directory, so each guard is mutated in both directions rather than
 * only in the direction that happens to be convenient: a live owner must block,
 * and an owner we cannot vouch for must block too.
 */
import { describe, expect, test } from "vitest"
import {
	DEFAULT_LOCK_LENGTH,
	ancestorPids,
	describeLockHolder,
	evaluateLock,
	isDelegatedHolder,
	lockFailureMessage,
	processLiveness
} from "./lock.js"

const NOW = 1_700_000_000_000

/** This process, as the lock module would describe it. */
interface Identity {
	hostId: string | null
	hostname: string
	pid: number
	instanceId: string
}

const ME: Identity = {
	hostId: "host-a",
	hostname: "workstation",
	pid: 4242,
	instanceId: "run-1"
}

const owner = (over: Partial<Identity & { label: string }> = {}) => ({
	pid: 999,
	hostId: "host-a",
	hostname: "workstation",
	instanceId: "run-other",
	label: "app",
	...over
})

const lock = (over: Record<string, unknown> = {}) => ({
	timestamp: NOW - 1000,
	lockLength: DEFAULT_LOCK_LENGTH,
	owner: owner(),
	...over
})

const dead = () => "dead" as const
const alive = () => "alive" as const

const check = (
	raw: unknown,
	liveness: (pid: number) => "alive" | "dead" | "unknown" = alive,
	identity: Identity = ME
) => evaluateLock(raw, { now: NOW, identity, liveness })

describe("evaluateLock — nothing to wait for", () => {
	test("no lock at all is free", () => {
		expect(check(undefined).state).toBe("free")
		expect(check(null).state).toBe("free")
		expect(check("nonsense").state).toBe("free")
	})
})

describe("evaluateLock — ownership", () => {
	test("an owner that is provably gone is stale immediately", () => {
		const result = check(lock(), dead)
		expect(result.state).toBe("stale")
		expect(result.reason).toBe("owner-gone")
	})

	test("an owner that is alive still blocks", () => {
		const result = check(lock(), alive)
		expect(result.state).toBe("held")
		expect(result.reason).toBe("owner-alive")
	})

	test("a lock written by this very process does not block it", () => {
		const result = check(lock({ owner: owner({ pid: ME.pid }) }), alive)
		expect(result.state).toBe("self")
		// Same pid, different run: the dev server re-evaluated the module in
		// place. Still us, so still not something to wait for.
		expect(result.reason).toBe("own-pid")
		expect(
			check(
				lock({
					owner: owner({
						pid: ME.pid,
						instanceId: ME.instanceId
					})
				}),
				alive
			).reason
		).toBe("own-lock")
	})

	test("liveness is ignored for a lock written on another host", () => {
		// The dangerous direction: pid 999 is not running *here*, but "here" is
		// not where the lock was written, so its absence proves nothing.
		const result = check(lock({ owner: owner({ hostId: "host-b" }) }), dead)
		expect(result.state).toBe("held")
		expect(result.reason).toBe("unexpired")
	})

	test("liveness is ignored when either side has no host identity", () => {
		expect(
			check(lock({ owner: owner({ hostId: null }) }), dead).state
		).toBe("held")
		expect(check(lock(), dead, { ...ME, hostId: null }).state).toBe("held")
		// ...and a lock whose owner is nothing but a pid is no evidence either.
		expect(check(lock({ owner: { pid: 999 } }), dead).state).toBe("held")
	})

	test("an unusable pid is never signalled and never trusted", () => {
		for (const pid of [0, -1, 1.5, "999", null]) {
			expect(
				check(lock({ owner: owner({ pid: pid as number }) }), dead)
					.state
			).toBe("held")
		}
	})
})

describe("evaluateLock — expiry stays authoritative", () => {
	test("an expired lock is stale whatever its owner says", () => {
		// Deliberate. A crash leaves a lock behind, the pid is later reissued to
		// something unrelated, and treating that as "alive" would produce a lock
		// no one can ever clear. Expiry is the escape hatch, so it outranks
		// liveness — which is why liveness may only ever shorten a wait.
		const expired = lock({ timestamp: NOW - DEFAULT_LOCK_LENGTH - 1 })
		expect(check(expired, alive).state).toBe("stale")
		expect(check(expired, alive).reason).toBe("expired")
	})

	test("an unexpired lock with no owner field blocks until it expires", () => {
		// Written by an older build, or by a writer that could not identify
		// itself. The timestamp is all there is, and it is enough.
		const legacy = {
			timestamp: NOW - 1000,
			lockLength: DEFAULT_LOCK_LENGTH
		}
		expect(check(legacy, dead).state).toBe("held")
		expect(check(legacy, dead).reason).toBe("unexpired")

		const legacyExpired = {
			timestamp: NOW - DEFAULT_LOCK_LENGTH - 1,
			lockLength: DEFAULT_LOCK_LENGTH
		}
		expect(check(legacyExpired, dead).state).toBe("stale")
		expect(check(legacyExpired, dead).reason).toBe("expired")
	})

	test("the boundary is inclusive: expiring now counts as expired", () => {
		expect(
			check(
				{
					timestamp: NOW - DEFAULT_LOCK_LENGTH,
					lockLength: DEFAULT_LOCK_LENGTH
				},
				dead
			).state
		).toBe("stale")
		expect(
			check(
				{
					timestamp: NOW - DEFAULT_LOCK_LENGTH + 1,
					lockLength: DEFAULT_LOCK_LENGTH
				},
				dead
			).state
		).toBe("held")
	})
})

describe("evaluateLock — malformed records", () => {
	test("a missing lockLength falls back to the default rather than NaN", () => {
		// `now < timestamp + NaN` is false, so the arithmetic the old code did
		// read a half-written lock as expired — the one misreading that cannot
		// be undone.
		for (const lockLength of [undefined, null, "10000", NaN, 0, -1]) {
			const result = check(
				{ timestamp: NOW - 1000, lockLength, owner: owner() },
				dead
			)
			expect(result.expiresAt).toBe(NOW - 1000 + DEFAULT_LOCK_LENGTH)
			// Owner is provably gone on this host, so this one is stale for the
			// right reason rather than by arithmetic accident.
			expect(result.reason).toBe("owner-gone")
		}
	})

	test("a lock with no usable timestamp still blocks while its owner lives", () => {
		const result = check(
			{ lockLength: DEFAULT_LOCK_LENGTH, owner: owner() },
			alive
		)
		expect(result.state).toBe("held")
		expect(result.reason).toBe("owner-alive")
	})

	test("a lock with neither a timestamp nor a verifiable owner claims nothing", () => {
		expect(check({ lockLength: 1 }, dead).state).toBe("stale")
		expect(check({ lockLength: 1 }, dead).reason).toBe("malformed")
	})
})

describe("processLiveness", () => {
	test("this process is alive", () => {
		expect(processLiveness(process.pid)).toBe("alive")
	})

	test("a pid we may not signal is alive, not dead", () => {
		// pid 1 exists on every platform we run on and is usually not ours to
		// signal, so this is the EPERM path. Reading EPERM as "dead" would hand
		// a live holder's database to a second process.
		expect(processLiveness(1)).toBe("alive")
	})

	test("pids that would signal a process group are refused", () => {
		expect(processLiveness(0)).toBe("unknown")
		expect(processLiveness(-1)).toBe("unknown")
		expect(processLiveness(1.5)).toBe("unknown")
	})
})

describe("the message a person actually reads", () => {
	const held = evaluateLock(lock(), {
		now: NOW,
		identity: ME,
		liveness: alive
	})

	test("names the holder", () => {
		const description = describeLockHolder(held, { now: NOW, identity: ME })
		expect(description).toContain("pid 999")
		expect(description).toContain('host "workstation"')
		expect(description).toContain("this machine")
	})

	test("distinguishes another machine from this one", () => {
		const elsewhere = evaluateLock(
			lock({ owner: owner({ hostId: "host-b", hostname: "nas" }) }),
			{ now: NOW, identity: ME, liveness: dead }
		)
		expect(
			describeLockHolder(elsewhere, { now: NOW, identity: ME })
		).toContain("a different machine or container")
	})

	test("says what to do about it", () => {
		const message = lockFailureMessage({
			evaluation: held,
			metaPath: "/data/meta.json",
			waitedMs: 20_000,
			identity: ME
		})
		expect(message).toContain("pid 999")
		expect(message).toContain("/data/meta.json")
		expect(message).toContain("Stop the other Serene Pub instance")
		expect(message).toContain("20.0s")
	})

	test("an ownerless lock is described as such rather than invented", () => {
		const legacy = evaluateLock(
			{ timestamp: NOW - 1000, lockLength: DEFAULT_LOCK_LENGTH },
			{ now: NOW, identity: ME, liveness: dead }
		)
		const message = lockFailureMessage({
			evaluation: legacy,
			metaPath: "/data/meta.json",
			waitedMs: 20_000,
			identity: ME
		})
		expect(message).toContain("an unidentified process")
		expect(message).toContain("older build")
	})
})

/**
 * `check-db-lock.js` takes the lock and runs a command under it; a command that
 * opens the database through the app's module (`plugin:install`) re-checks the
 * lock at import. It must accept the wrapper that launched it — and nobody else.
 */
describe("evaluateLock — delegated holder (check-db-lock's own command)", () => {
	const WRAPPER = 999 // owner() pid
	const chain = [4000, 3000, WRAPPER, 1] // sh, npx, wrapper, init
	const delegated = (
		delegate: string | undefined,
		ancestors: number[] | null = chain
	) =>
		evaluateLock(lock({ owner: owner({ label: "db-cli" }) }), {
			now: NOW,
			identity: ME,
			liveness: alive,
			delegation: { delegate, ancestors: () => ancestors }
		})

	test("the wrapper that named us and is our ancestor is ours to use", () => {
		const result = delegated(String(WRAPPER))
		expect(result.state).toBe("self")
		expect(result.reason).toBe("delegated")
	})

	test("the same live lock without the delegation still blocks", () => {
		expect(delegated(undefined).state).toBe("held")
		expect(delegated("").state).toBe("held")
	})

	test("a delegation naming a different pid still blocks (a dev server holds it)", () => {
		expect(delegated("12345").state).toBe("held")
	})

	test("a delegation naming a pid that is not our ancestor still blocks", () => {
		expect(delegated(String(WRAPPER), [4000, 3000, 1]).state).toBe("held")
	})

	test("where the chain cannot be walked, the inherited variable alone decides", () => {
		expect(delegated(String(WRAPPER), null).state).toBe("self")
	})

	test("another host's lock is never delegated", () => {
		const result = evaluateLock(
			lock({ owner: owner({ hostId: "host-b" }) }),
			{
				now: NOW,
				identity: ME,
				liveness: alive,
				delegation: {
					delegate: String(WRAPPER),
					ancestors: () => chain
				}
			}
		)
		expect(result.state).toBe("held")
	})

	test("an expired delegated lock is stale, not self — expiry still comes first", () => {
		const result = evaluateLock(
			lock({ timestamp: NOW - 2 * DEFAULT_LOCK_LENGTH }),
			{
				now: NOW,
				identity: ME,
				liveness: alive,
				delegation: {
					delegate: String(WRAPPER),
					ancestors: () => chain
				}
			}
		)
		expect(result.state).toBe("stale")
	})

	test("own pid is still self regardless of delegation", () => {
		const result = evaluateLock(lock({ owner: owner({ pid: ME.pid }) }), {
			now: NOW,
			identity: ME,
			liveness: alive,
			delegation: { delegate: undefined, ancestors: () => null }
		})
		expect(result.state).toBe("self")
	})
})

describe("isDelegatedHolder", () => {
	const o = owner({ pid: 77 })
	test("needs a matching, positive, integer delegate", () => {
		expect(isDelegatedHolder(o, { delegate: "77", ancestors: () => [77] })).toBe(true)
		expect(isDelegatedHolder(o, { delegate: "78", ancestors: () => [77] })).toBe(false)
		expect(isDelegatedHolder(o, { delegate: "0", ancestors: () => [0] })).toBe(false)
		expect(isDelegatedHolder(o, { delegate: "7x", ancestors: () => [77] })).toBe(false)
		expect(isDelegatedHolder(null, { delegate: "77", ancestors: () => [77] })).toBe(false)
	})
	test("does not walk the chain unless the delegate matches", () => {
		let walked = false
		isDelegatedHolder(o, {
			delegate: "5",
			ancestors: () => ((walked = true), [5])
		})
		expect(walked).toBe(false)
	})
})

describe("ancestorPids", () => {
	const parents: Record<number, number | null> = { 10: 9, 9: 8, 8: 1, 1: null }
	test("walks to the root, nearest first", () => {
		expect(ancestorPids(10, { getParent: (p) => parents[p] ?? null })).toEqual([9, 8, 1])
	})
	test("null when not even the first parent can be read", () => {
		expect(ancestorPids(10, { getParent: () => null })).toBeNull()
	})
	test("stops on a cycle", () => {
		expect(ancestorPids(10, { getParent: (p) => (p === 10 ? 9 : 10) })).toEqual([9, 10])
	})
	test("the real chain of this process includes its parent", () => {
		const real = ancestorPids()
		if (real !== null) expect(real[0]).toBe(process.ppid)
	})
})
