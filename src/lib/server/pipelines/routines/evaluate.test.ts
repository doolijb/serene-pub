/**
 * 🚧 Cadence evaluation at session moments (PLAN-layering D2, R9, R15–R21;
 * lane 6) — every path the host takes, driven by a fake clock: core's
 * cadences natively, a plugin's by its script (and never with scripts off),
 * Off routines never asked, the system clock waiting for an interaction
 * after a restart (R21) and for a cap's pause (R11), the Timeline Cron's
 * jump ceiling said in the inspector (R19), and no routine waking itself.
 * The queue and the stored state are stand-ins; no database.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
	afterEachRound,
	definePluginCadence,
	everyNTurns,
	onEvent,
	schedule,
	sessionEvents,
	simulateCadence,
	systemCron,
	timelineCron,
	turnMoments,
	whenValue,
	type CadenceRef,
	type EffectiveRegistration
} from "@serene-pub/sdk"

const fired = vi.hoisted(() => [] as Array<Record<string, any>>)
const lines = vi.hoisted(() => [] as Array<Record<string, any>>)
const stored = vi.hoisted(() => new Map<string, Record<string, unknown>>())
const scripts = vi.hoisted(() => ({ on: true }))

vi.mock("$lib/server/pipelines/routines/run", () => ({
	routineQueue: {
		fire: async (f: Record<string, any>) => {
			fired.push(f)
			return { queued: true }
		}
	},
	routineLine: async (_db: unknown, opts: Record<string, any>) => {
		lines.push(opts)
	}
}))
vi.mock("$lib/server/pipelines/routines/state", () => ({
	cadenceStateOf: async (_db: unknown, sessionId: number, key: string) => stored.get(`${sessionId}:${key}`) ?? {},
	saveCadenceState: async (_db: unknown, sessionId: number, key: string, state: Record<string, unknown>) => {
		stored.set(`${sessionId}:${key}`, state)
	}
}))
vi.mock("$lib/server/pipelines/scripts/chains", () => ({ scriptsEnabledFor: async () => scripts.on }))

const fakeDb = {
	update: () => ({ set: () => ({ where: async () => undefined }) }),
	// The archive read: no row = not archived.
	select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) })
} as unknown as Db

let evaluateMoments: typeof import("./evaluate").evaluateMoments
let interaction: typeof import("./interaction")
let runs: typeof import("./runs")

beforeAll(async () => {
	;({ evaluateMoments } = await import("./evaluate"))
	interaction = await import("./interaction")
	runs = await import("./runs")
})
beforeEach(() => {
	fired.length = 0
	lines.length = 0
	stored.clear()
	scripts.on = true
	runs.setRoutinesEnabled(true)
	interaction._resetInteractions()
})
afterEach(() => runs.setRoutinesEnabled(false))

const routine = (cadence: CadenceRef, pipeline: string, extra: Partial<EffectiveRegistration> = {}): EffectiveRegistration =>
	({
		key: `${cadence.id.replace(/^core:cadence\//, "").replace(/@\d+$/, "")}→${pipeline}`,
		trigger: { family: "routine", cadence },
		pipeline,
		origin: "genre",
		...extra
	}) as EffectiveRegistration

const resolvedOf = (...effective: EffectiveRegistration[]) =>
	({ effective, rows: { genre: [], preset: [], session: [] } }) as never

const SESSION = 7

describe("turn and round moments", () => {
	it("every few turns fires on each multiple, carrying the turn's line and speaker (R9)", async () => {
		const sweep = routine(everyNTurns({ n: 2 }), "core:spec/story-sweep")
		for (const m of turnMoments(1, 6)) {
			const turn = (m as { turn: number }).turn
			await evaluateMoments(
				fakeDb,
				SESSION,
				[{ moment: m, event: sessionEvents.turnEnded, payload: { messageId: 100 + turn, speaker: "character:3", turn } }],
				{ at: 1, firedAt: { turn } },
				resolvedOf(sweep)
			)
		}
		expect(fired.map((f) => f.firedAt.turn)).toEqual([2, 4, 6])
		expect(fired[0]).toMatchObject({
			registrationKey: sweep.key,
			pipeline: "core:spec/story-sweep",
			depth: 0,
			cause: { moment: "turn-ended", messageId: 102, speaker: "character:3", event: sessionEvents.turnEnded }
		})
		// The same answers the SDK's simulator gives an author.
		expect(simulateCadence(everyNTurns({ n: 2 }), turnMoments(1, 6)).fired).toEqual([1, 3, 5])
	})

	it("a routine that is Off is never asked (R37)", async () => {
		const off = routine(afterEachRound(), "core:spec/story-reckoning", { mode: "off" })
		await evaluateMoments(fakeDb, SESSION, [{ moment: { kind: "round-ended", round: 1 } }], { at: 1 }, resolvedOf(off))
		expect(fired).toEqual([])
	})

	it("routines are not recursive (R19): never their own moment, and a routine's routine wakes nothing", async () => {
		const reckoning = routine(afterEachRound(), "core:spec/story-reckoning")
		const other = routine(afterEachRound(), "acme:spec/other")
		const moment = [{ moment: { kind: "round-ended", round: 1 } as const }]
		await evaluateMoments(fakeDb, SESSION, moment, { at: 1, fromRoutine: { sessionId: SESSION, registrationKey: reckoning.key, depth: 0 } }, resolvedOf(reckoning, other))
		expect(fired.map((f) => [f.registrationKey, f.depth])).toEqual([[other.key, 1]])
		fired.length = 0
		await evaluateMoments(fakeDb, SESSION, moment, { at: 1, fromRoutine: { sessionId: SESSION, registrationKey: other.key, depth: 1 } }, resolvedOf(reckoning, other))
		expect(fired).toEqual([])
	})

	it("on an event, narrowed by its own fields", async () => {
		const r = routine(onEvent(sessionEvents.castChanged, { where: { on: "change", equals: "enabled" } }), "acme:spec/greet")
		const at = (change: string) =>
			evaluateMoments(
				fakeDb,
				SESSION,
				[{ moment: { kind: "event", event: sessionEvents.castChanged, payload: { change, ref: "character:4" } }, event: sessionEvents.castChanged, payload: { change, ref: "character:4" } }],
				{ at: 1 },
				resolvedOf(r)
			)
		await at("position")
		await at("enabled")
		expect(fired).toHaveLength(1)
		expect(fired[0]!.cause).toMatchObject({ moment: "event", castMember: "character:4" })
	})

	it("when a value says so — once as it becomes true, not on every change while it stays true", async () => {
		const r = routine(whenValue({ when: { on: "state.world.weather", equals: "storm" } }), "acme:spec/shelter")
		const at = (weather: string) =>
			evaluateMoments(fakeDb, SESSION, [{ moment: { kind: "value-changed", values: { state: { world: { weather } } } } }], { at: 1 }, resolvedOf(r))
		await at("clear")
		await at("storm")
		await at("storm")
		await at("clear")
		await at("storm")
		expect(fired).toHaveLength(2)
	})
})

describe("the system clock (R15, R21, R11)", () => {
	const MIN = 60_000
	const cron = () => routine(systemCron({ every: 15, unit: "minutes" }), "acme:spec/tick")
	const tick = (at: number) =>
		evaluateMoments(fakeDb, SESSION, [{ moment: { kind: "system-tick", at, lastInteractionAt: null } }], { at }, resolvedOf(cron()))

	it("after a restart nothing runs until someone interacts with the session (R21)", async () => {
		for (let t = 0; t <= 60; t += 5) await tick(t * MIN)
		expect(fired).toEqual([])
		expect(stored.size).toBe(0)
	})

	it("from the first interaction it counts from then, and fires once per interval — never catching up", async () => {
		await interaction.noteInteraction(fakeDb, SESSION, "line")
		for (let t = 0; t <= 30; t += 5) await tick(t * MIN)
		expect(fired.map((f) => f.cause.scheduledFor / MIN)).toEqual([15, 30])
		// The app was "down" for two hours: one firing, the next counted from it.
		fired.length = 0
		await tick(150 * MIN)
		await tick(155 * MIN)
		expect(fired.map((f) => f.cause.scheduledFor / MIN)).toEqual([150])
	})

	it("a cap's pause holds it until the next interaction (R11)", async () => {
		await interaction.noteInteraction(fakeDb, SESSION, "line")
		interaction.pause(SESSION, cron().key, "Paused after 12 runs in a row")
		for (let t = 0; t <= 30; t += 5) await tick(t * MIN)
		expect(fired).toEqual([])
		await interaction.noteInteraction(fakeDb, SESSION, "action")
		expect(interaction.pauseOf(SESSION, cron().key)).toBeUndefined()
	})

	it("a Schedule fires at its time in the owner's time zone, on the 5-minute grid (R20)", async () => {
		await interaction.noteInteraction(fakeDb, SESSION, "setting")
		const daily = routine(schedule({ clock: "system", at: { daily: "09:00" } }), "acme:spec/morning")
		const at = (iso: string) => {
			const ms = Date.parse(iso)
			return evaluateMoments(fakeDb, SESSION, [{ moment: { kind: "system-tick", at: ms, timeZone: "UTC" } }], { at: ms }, resolvedOf(daily))
		}
		await at("2026-10-21T08:50:00Z")
		await at("2026-10-21T08:55:00Z")
		expect(fired).toEqual([])
		await at("2026-10-21T09:00:00Z")
		await at("2026-10-21T09:05:00Z")
		expect(fired).toHaveLength(1)
	})
})

describe("the story clock (R17, R19)", () => {
	const at = (from: object, to: object, r: EffectiveRegistration) =>
		evaluateMoments(
			fakeDb,
			SESSION,
			[{ moment: { kind: "story-clock-moved", from: from as never, to: to as never, calendar: null } }],
			{ at: 1 },
			resolvedOf(r)
		)

	it("a jump fires every cron due within it, once each — and a cron not yet due waits", async () => {
		const daily = routine(timelineCron({ every: 1, unit: "days" }), "acme:spec/daily")
		const fiveDays = routine(timelineCron({ every: 5, unit: "days" }), "acme:spec/weekly")
		await at({ year: 412, month: 3, day: 1, hour: 8, minute: 0 }, { year: 412, month: 3, day: 4, hour: 8, minute: 0 }, daily)
		await at({ year: 412, month: 3, day: 1, hour: 8, minute: 0 }, { year: 412, month: 3, day: 4, hour: 8, minute: 0 }, fiveDays)
		expect(fired.map((f) => f.pipeline)).toEqual(["acme:spec/daily"])
		expect(fired[0]!.cause.clock).toEqual({ from: expect.objectContaining({ day: 1 }), to: expect.objectContaining({ day: 4 }) })
	})

	it("a jump past the ceiling fires nothing and says so in the inspector", async () => {
		const r = routine(timelineCron({ every: 30, unit: "minutes", maxJump: { every: 12, unit: "hours" } }), "acme:spec/watch")
		await at({ year: 412, month: 3, day: 1, hour: 8, minute: 0 }, { year: 412, month: 3, day: 4, hour: 8, minute: 0 }, r)
		expect(fired).toEqual([])
		expect(lines).toEqual([
			expect.objectContaining({ kind: "skipped", reason: expect.stringMatching(/^Skipped: the clock jumped more than 12 hours \(from .+ to .+\)$/) })
		])
		await at({ year: 412, month: 3, day: 4, hour: 8, minute: 0 }, { year: 412, month: 3, day: 4, hour: 9, minute: 0 }, r)
		expect(fired).toHaveLength(1)
	})
})

describe("a plugin's cadence, by its script (core:script:cadence/due@1)", () => {
	const plugin = definePluginCadence("acme.dice", {
		id: "acme.dice:cadence/odd-turns@1",
		i18n: { name: { en: "On odd turns" } },
		options: {},
		wakesOn: ["turn-ended"],
		carries: ["session"],
		evaluate: { script: "return { due: moment.turn % 2 === 1, state: { seen: (state.seen || 0) + 1 } }" }
	})
	const r = () => routine({ id: plugin.id, options: {} }, "acme.dice:spec/roll")

	it("the script's verdict decides, and its state is kept", async () => {
		for (const m of turnMoments(1, 4)) await evaluateMoments(fakeDb, SESSION, [{ moment: m }], { at: 1 }, resolvedOf(r()))
		expect(fired).toHaveLength(2)
		expect(stored.get(`${SESSION}:${r().key}`)).toEqual({ seen: 4 })
	}, 30_000)

	it("never due while scripts are switched off on the pub", async () => {
		scripts.on = false
		for (const m of turnMoments(1, 3)) await evaluateMoments(fakeDb, SESSION, [{ moment: m }], { at: 1 }, resolvedOf(r()))
		expect(fired).toEqual([])
	})
})

describe("state across a restart (R21)", () => {
	it("system-clock state a previous process wrote reads as empty; story-clock state is kept", async () => {
		const { cadenceStateFromStored } = await vi.importActual<typeof import("./state")>("./state")
		const started = 1_000_000
		expect(cadenceStateFromStored({ cadence: { nextAt: 5 }, at: started - 1 }, systemCron({ every: 1, unit: "hours" }), started)).toEqual({})
		expect(cadenceStateFromStored({ cadence: { nextAt: 5 }, at: started + 1 }, systemCron({ every: 1, unit: "hours" }), started)).toEqual({ nextAt: 5 })
		expect(
			cadenceStateFromStored({ cadence: { nextAt: "412-03-05" }, at: started - 1 }, timelineCron({ every: 1, unit: "days" }), started)
		).toEqual({ nextAt: "412-03-05" })
	})
})
