/**
 * The 0151 planner (variable layouts): pure, so it is held to the invariant
 * directly — for every context and step, the layout a variable renders through
 * after the plan is the one it rendered through before.
 */
import { describe, expect, it } from "vitest"
import {
	applyToSnapshot,
	packageDefaultFor,
	planVariableLayoutUpgrade,
	resolutions,
	withoutPicks,
	type Context,
	type Holder,
	type LayoutRow,
	type PresetRow,
	type Snapshot,
	type Step
} from "./0151_shallow_marvel_zombies"

const CHARS = "core:var/characters@1"
const PERS = "core:var/personas@1"
const key = (v: string, variant: string) =>
	`pipeline-variable-template:${v}:${variant}`

const layout = (
	id: number,
	variableId: string,
	seed: string | null,
	extra: Partial<LayoutRow> = {}
): LayoutRow => ({
	id,
	variableId,
	seedKey: seed ? key(variableId, seed) : null,
	templateId: null,
	ownerPluginId: null,
	withdrawn: false,
	reference: null,
	pubDefault: false,
	...extra
})

// characters: 1 titled JSON (default), 2 JSON, 3 a person's own. personas: 4, 5, 6.
const LAYOUTS: LayoutRow[] = [
	layout(1, CHARS, "wrapped"),
	layout(2, CHARS, "content"),
	layout(3, CHARS, null),
	layout(4, PERS, "wrapped"),
	layout(5, PERS, "content"),
	layout(6, PERS, null)
]

const step = (
	spec: string,
	k: string,
	variableId: string,
	node = "assemble"
): Step => ({
	spec,
	node,
	slot: "variables",
	key: k,
	variableId
})

/** Two pipelines (respond, narrate), each rendering characters and personas. */
const STEPS: Step[] = [
	step("respond", "characters", CHARS),
	step("respond", "personas", PERS),
	step("narrate", "characters", CHARS),
	step("narrate", "personas", PERS)
]

const holder = (
	id: string,
	spec: string,
	picks: Record<string, number>,
	removable = true
): Holder => ({
	id,
	spec,
	removable,
	values: Object.keys(picks).length
		? { assemble: { variables: picks } }
		: null
})

const genreCtx = (
	spec: string,
	genreHolders: string[] = [],
	instanceHolder: string | null = null
): Context => ({
	id: `genre:g:${spec}`,
	kind: "genre",
	presetId: null,
	spec,
	presetHolder: null,
	genreHolders,
	instanceHolder
})

const presetCtx = (
	presetId: number,
	spec: string,
	presetHolder: string | null,
	genreHolders: string[] = []
): Context => ({
	id: `preset:${presetId}:${spec}`,
	kind: "preset",
	presetId,
	spec,
	presetHolder,
	genreHolders,
	instanceHolder: null
})

const snapshot = (over: Partial<Snapshot>): Snapshot => ({
	layouts: LAYOUTS,
	defaults: { [CHARS]: 1, [PERS]: 4 },
	steps: STEPS,
	holders: [],
	contexts: [],
	presets: [],
	locked: {},
	variableSlotNames: ["variables"],
	...over
})

const preset = (
	id: number,
	adminOwned = true,
	variableLayouts: Record<string, string> = {}
): PresetRow => ({
	id,
	adminOwned,
	variableLayouts
})

/** Plan, then check the invariant on the result and that planning again is a no-op. */
function upgrade(snap: Snapshot) {
	const plan = planVariableLayoutUpgrade(snap)
	const after = applyToSnapshot(snap, plan)
	expect(resolutions(after)).toEqual(resolutions(snap))
	expect(planVariableLayoutUpgrade(after).actions).toEqual([])
	return { plan, after }
}

describe("0151 planner: the shapes the plan names", () => {
	it("a pub with one pick on one step renders every other step as before", () => {
		const snap = snapshot({
			holders: [holder("reg:1", "respond", { characters: 3 })],
			contexts: [genreCtx("respond", ["reg:1"]), genreCtx("narrate")]
		})
		const { plan, after } = upgrade(snap)
		expect(plan.actions.some((a) => a.kind === "setPubLayout")).toBe(false)
		// The pick matters (narrate would render the default), so it stays.
		expect(plan.actions.some((a) => a.kind === "removePick")).toBe(false)
		expect(after.holders[0]!.values).toEqual({
			assemble: { variables: { characters: 3 } }
		})
	})

	it("a preset whose steps all picked one core layout ends with a preset variable layout and no leftovers", () => {
		const snap = snapshot({
			holders: [
				holder("reg:10", "respond", { characters: 2 }),
				holder("reg:11", "narrate", { characters: 2 })
			],
			contexts: [
				genreCtx("respond"),
				genreCtx("narrate"),
				presetCtx(7, "respond", "reg:10"),
				presetCtx(7, "narrate", "reg:11")
			],
			presets: [preset(7)]
		})
		const { plan, after } = upgrade(snap)
		expect(plan.actions).toContainEqual({
			kind: "setPresetLayout",
			presetId: 7,
			variableId: CHARS,
			reference: "core/json@1"
		})
		expect(plan.actions.some((a) => a.kind === "setPubLayout")).toBe(false)
		expect(after.holders.every((h) => h.values === null)).toBe(true)
		expect(after.presets[0]!.variableLayouts).toEqual({
			[CHARS]: "core/json@1"
		})
	})

	it("a preset that picked one of the person's own layouts keeps its picks (no reference to give)", () => {
		const snap = snapshot({
			holders: [
				holder("reg:10", "respond", { characters: 3 }),
				holder("reg:11", "narrate", { characters: 3 })
			],
			contexts: [
				genreCtx("respond"),
				genreCtx("narrate"),
				presetCtx(7, "respond", "reg:10"),
				presetCtx(7, "narrate", "reg:11")
			],
			presets: [preset(7)]
		})
		const { plan } = upgrade(snap)
		expect(plan.actions).toEqual([])
	})

	it("a shipped preset is never given a variable layout, and its picks (a projection's rows) stay", () => {
		const snap = snapshot({
			holders: [holder("reg:10", "respond", { characters: 2 }, false)],
			contexts: [genreCtx("respond"), presetCtx(7, "respond", "reg:10")],
			presets: [preset(7, false)]
		})
		const { plan } = upgrade(snap)
		expect(plan.actions).toEqual([])
	})

	it("every genre step picked the same non-default row: it becomes the pub's layout and the picks go", () => {
		const snap = snapshot({
			holders: [
				holder("reg:1", "respond", { characters: 3 }),
				holder("reg:2", "narrate", { characters: 3 })
			],
			contexts: [
				genreCtx("respond", ["reg:1"]),
				genreCtx("narrate", ["reg:2"])
			]
		})
		const { plan, after } = upgrade(snap)
		expect(plan.actions).toContainEqual({
			kind: "setPubLayout",
			variableId: CHARS,
			layoutId: 3
		})
		expect(after.holders.every((h) => h.values === null)).toBe(true)
		expect(after.layouts.find((r) => r.id === 3)!.pubDefault).toBe(true)
	})

	it("promoting to the pub does not move a preset that picked otherwise", () => {
		const snap = snapshot({
			holders: [
				holder("reg:1", "respond", { characters: 3 }),
				holder("reg:2", "narrate", { characters: 3 }),
				holder("reg:10", "respond", { characters: 2 })
			],
			contexts: [
				genreCtx("respond", ["reg:1"]),
				genreCtx("narrate", ["reg:2"]),
				presetCtx(7, "respond", "reg:10", ["reg:1"]),
				presetCtx(7, "narrate", null, ["reg:2"])
			],
			presets: [preset(7)]
		})
		const { after } = upgrade(snap)
		// narrate resolves 3 for the preset, respond 2: no single row, so the preset's pick stays.
		expect(after.holders.find((h) => h.id === "reg:10")!.values).toEqual({
			assemble: { variables: { characters: 2 } }
		})
	})

	it("a pick equal to what resolves anyway is removed; one that matters is kept", () => {
		const snap = snapshot({
			holders: [
				// 1 is the default: redundant. 3 on personas' sibling? use two variables.
				holder("reg:1", "respond", { characters: 1, personas: 6 })
			],
			contexts: [genreCtx("respond", ["reg:1"]), genreCtx("narrate")]
		})
		const { after } = upgrade(snap)
		expect(after.holders[0]!.values).toEqual({
			assemble: { variables: { personas: 6 } }
		})
	})

	it("a genre pick outranks a preset's variable layout, so the preset keeps its own pick under it", () => {
		const snap = snapshot({
			holders: [
				holder("reg:1", "respond", { characters: 3 }), // genre: 3 on respond only
				holder("reg:10", "respond", { characters: 2 }), // preset: 2 on respond
				holder("reg:11", "narrate", { characters: 2 }) // preset: 2 on narrate
			],
			contexts: [
				genreCtx("respond", ["reg:1"]),
				genreCtx("narrate"),
				presetCtx(7, "respond", "reg:10", ["reg:1"]),
				presetCtx(7, "narrate", "reg:11")
			],
			presets: [preset(7)]
		})
		const { plan, after } = upgrade(snap)
		expect(plan.actions).toContainEqual({
			kind: "setPresetLayout",
			presetId: 7,
			variableId: CHARS,
			reference: "core/json@1"
		})
		// narrate's pick is redundant now; respond's must stay (genre's 3 sits above the layout).
		expect(after.holders.find((h) => h.id === "reg:11")!.values).toBeNull()
		expect(after.holders.find((h) => h.id === "reg:10")!.values).toEqual({
			assemble: { variables: { characters: 2 } }
		})
	})

	it("instance values participate: a pick there under a genre pick is dead weight", () => {
		const snap = snapshot({
			holders: [
				holder("reg:1", "respond", { characters: 3 }),
				{
					id: "inst:respond",
					spec: "respond",
					removable: true,
					values: { assemble: { variables: { characters: 2 } } }
				}
			],
			contexts: [
				genreCtx("respond", ["reg:1"], "inst:respond"),
				genreCtx("narrate")
			]
		})
		const { after } = upgrade(snap)
		expect(
			after.holders.find((h) => h.id === "inst:respond")!.values
		).toBeNull()
		expect(
			after.holders.find((h) => h.id === "reg:1")!.values
		).not.toBeNull()
	})

	it("a pipeline nothing registers blocks pub promotion (it would change)", () => {
		const snap = snapshot({
			holders: [holder("reg:1", "respond", { characters: 3 })],
			contexts: [
				genreCtx("respond", ["reg:1"]),
				{
					id: "unregistered:narrate",
					kind: "unregistered",
					presetId: null,
					spec: "narrate",
					presetHolder: null,
					genreHolders: [],
					instanceHolder: null
				}
			]
		})
		const { plan } = upgrade(snap)
		expect(plan.actions.some((a) => a.kind === "setPubLayout")).toBe(false)
	})

	it("leaves a variable alone when a pick is not a layout of it, a seed reference, or a decision", () => {
		for (const bad of [
			{ characters: { seedKey: "x" } },
			{ characters: { value: 2, lock: true } },
			{ characters: 4 },
			{ characters: "2" }
		]) {
			const snap = snapshot({
				holders: [
					{
						id: "reg:1",
						spec: "respond",
						removable: true,
						values: { assemble: { variables: bad } }
					},
					holder("reg:2", "narrate", { characters: 3 })
				],
				contexts: [
					genreCtx("respond", ["reg:1"]),
					genreCtx("narrate", ["reg:2"])
				]
			})
			const { plan } = upgrade(snap)
			expect(plan.actions).toEqual([])
			expect(plan.leftAlone.map((l) => l.variableId)).toContain(CHARS)
		}
	})

	it("leaves a variable alone when a numeric pick sits where no step reaches", () => {
		const snap = snapshot({
			holders: [
				{
					id: "reg:1",
					spec: "respond",
					removable: true,
					values: { assemble: { variables: { someBand: 3 } } }
				},
				holder("reg:2", "narrate", { characters: 3 })
			],
			contexts: [
				genreCtx("respond", ["reg:1"]),
				genreCtx("narrate", ["reg:2"])
			]
		})
		const { plan } = upgrade(snap)
		expect(plan.leftAlone.map((l) => l.variableId)).toContain(CHARS)
		expect(plan.actions).toEqual([])
	})

	it("leaves a variable alone when two rows of one registration state the same slot", () => {
		const snap = snapshot({
			holders: [
				holder("reg:1", "respond", { characters: 3 }),
				holder("reg:2", "respond", { personas: 6 })
			],
			contexts: [
				genreCtx("respond", ["reg:2", "reg:1"]),
				genreCtx("narrate")
			]
		})
		const { plan } = upgrade(snap)
		expect(plan.actions).toEqual([])
		expect(plan.leftAlone.length).toBe(2)
	})

	it("leaves a variable alone when its pipeline's author names a layout, or a band may carry it", () => {
		const snap = snapshot({
			locked: { [CHARS]: "its pipeline's author names a layout for it" },
			holders: [
				holder("reg:1", "respond", { characters: 3 }),
				holder("reg:2", "narrate", { characters: 3 })
			],
			contexts: [
				genreCtx("respond", ["reg:1"]),
				genreCtx("narrate", ["reg:2"])
			]
		})
		const { plan } = upgrade(snap)
		expect(plan.actions).toEqual([])
	})

	it("an existing pub's layout is kept, and picks equal to it go", () => {
		const snap = snapshot({
			layouts: LAYOUTS.map((r) =>
				r.id === 3 ? { ...r, pubDefault: true } : r
			),
			holders: [
				holder("reg:1", "respond", { characters: 3, personas: 6 })
			],
			contexts: [genreCtx("respond", ["reg:1"]), genreCtx("narrate")]
		})
		const { plan, after } = upgrade(snap)
		expect(plan.actions.some((a) => a.kind === "setPubLayout")).toBe(false)
		expect(after.holders[0]!.values).toEqual({
			assemble: { variables: { personas: 6 } }
		})
	})

	it("does not remove a pick on a projected row, nor one no context reads", () => {
		const snap = snapshot({
			holders: [
				holder("reg:1", "respond", { characters: 1 }, false),
				holder("reg:2", "respond", { characters: 1 })
			],
			contexts: [genreCtx("respond", ["reg:1"])]
		})
		const { after } = upgrade(snap)
		expect(after.holders.every((h) => h.values !== null)).toBe(true)
	})
})

describe("0151 helpers", () => {
	it("withoutPicks drops emptied objects and returns null when nothing is left", () => {
		expect(
			withoutPicks({ a: { variables: { x: 1, y: 2 } } }, [
				{ node: "a", slot: "variables", key: "x" }
			])
		).toEqual({
			a: { variables: { y: 2 } }
		})
		expect(
			withoutPicks({ a: { variables: { x: 1 }, other: 5 } }, [
				{ node: "a", slot: "variables", key: "x" }
			])
		).toEqual({ a: { other: 5 } })
		expect(
			withoutPicks({ a: { variables: { x: 1 } } }, [
				{ node: "a", slot: "variables", key: "x" }
			])
		).toBeNull()
	})

	it("packageDefaultFor follows defaultVariableTemplateFor", () => {
		const layouts = [
			layout(9, "acme:var/x@1", null, {
				ownerPluginId: 3,
				templateId: "other:template/a@1"
			}),
			layout(8, "acme:var/x@1", null, {
				ownerPluginId: 3,
				templateId: "acme:template/b@1",
				withdrawn: true
			}),
			layout(10, "acme:var/x@1", null, {
				ownerPluginId: 3,
				templateId: "acme:template/c@1"
			})
		]
		// Not the foreign package's, not the withdrawn one: the first own, enabled row.
		expect(packageDefaultFor("acme:var/x@1", layouts, {})).toBe(10)
		expect(
			packageDefaultFor(CHARS, LAYOUTS, {
				defaultSeedKey: key(CHARS, "wrapped")
			})
		).toBe(1)
		expect(
			packageDefaultFor(CHARS, LAYOUTS, {
				speechSeedKey: key(CHARS, "content"),
				defaultSeedKey: key(CHARS, "wrapped")
			})
		).toBe(2)
		expect(packageDefaultFor("none:var/y@1", LAYOUTS, {})).toBeNull()
	})
})

// ── property: random small snapshots keep every resolution ───────────────

/** mulberry32 — a small deterministic generator. */
function rng(seed: number) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

function randomSnapshot(seed: number): Snapshot {
	const r = rng(seed)
	const chance = (p: number) => r() < p
	const pickFrom = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]!
	const validFor = (v: string) => (v === CHARS ? [1, 2, 3] : [4, 5, 6])
	const specs = ["s1", "s2", "s3"]
	const steps: Step[] = specs.flatMap((s) => [
		...(s === "s3" && chance(0.5) ? [] : [step(s, "characters", CHARS)]),
		...(chance(0.7) ? [step(s, "personas", PERS)] : [])
	])
	const holders: Holder[] = []
	let nextId = 100
	const maybeHolder = (
		spec: string,
		p: number,
		removable = true
	): string | null => {
		if (!chance(p)) return null
		const picks: Record<string, number> = {}
		for (const s of steps.filter((x) => x.spec === spec))
			if (chance(0.6)) picks[s.key] = pickFrom(validFor(s.variableId))
		// now and then a pick that is not valid for its step
		if (chance(0.03)) picks.characters = pickFrom([4, 5, 99])
		const id = `reg:${nextId++}`
		holders.push({
			id,
			spec,
			removable: removable && chance(0.9),
			values: Object.keys(picks).length
				? { assemble: { variables: picks } }
				: null
		})
		return id
	}
	const contexts: Context[] = []
	const presetsN = Math.floor(r() * 3)
	const presets: PresetRow[] = []
	for (let p = 1; p <= presetsN; p++)
		presets.push(
			preset(
				p,
				chance(0.8),
				chance(0.15)
					? {
							[CHARS]: pickFrom([
								"core/json@1",
								"core/titled-json@1",
								"core/nope@1"
							])
						}
					: {}
			)
		)
	const instance = new Map<string, string | null>()
	for (const s of specs) {
		const id = chance(0.3) ? `inst:${s}` : null
		if (id)
			holders.push({
				id,
				spec: s,
				removable: true,
				values: {
					assemble: {
						variables: Object.fromEntries(
							steps
								.filter((x) => x.spec === s && chance(0.5))
								.map((x) => [
									x.key,
									pickFrom(validFor(x.variableId))
								])
						)
					}
				}
			})
		instance.set(s, id)
	}
	for (const s of specs) {
		const genreHolders = [
			maybeHolder(s, 0.6, chance(0.8)),
			maybeHolder(s, 0.15)
		].filter((x): x is string => !!x)
		contexts.push({
			id: `genre:${s}`,
			kind: "genre",
			presetId: null,
			spec: s,
			presetHolder: null,
			genreHolders,
			instanceHolder: instance.get(s) ?? null
		})
		for (const p of presets)
			contexts.push({
				id: `preset:${p.id}:${s}`,
				kind: "preset",
				presetId: p.id,
				spec: s,
				presetHolder: maybeHolder(s, 0.6),
				genreHolders,
				instanceHolder: instance.get(s) ?? null
			})
	}
	if (chance(0.2))
		contexts.push({
			id: "unregistered:s4",
			kind: "unregistered",
			presetId: null,
			spec: "s1",
			presetHolder: null,
			genreHolders: [],
			instanceHolder: null
		})
	const layouts = LAYOUTS.map((l) =>
		chance(0.05) ? { ...l, pubDefault: l.id === 3 } : l
	)
	return {
		layouts:
			layouts.filter((l) => l.pubDefault).length > 1 ? LAYOUTS : layouts,
		defaults: { [CHARS]: 1, [PERS]: 4 },
		steps,
		holders: holders.filter((h) => h.values !== null),
		contexts,
		presets,
		locked: chance(0.1) ? { [PERS]: "locked" } : {},
		variableSlotNames: ["variables"]
	}
}

describe("0151 planner: property", () => {
	it("for random small snapshots, every resolution before equals after, and a second run changes nothing", () => {
		let promoted = 0
		let presetLayouts = 0
		let removed = 0
		for (let seed = 1; seed <= 600; seed++) {
			const snap = randomSnapshot(seed)
			const plan = planVariableLayoutUpgrade(snap)
			const after = applyToSnapshot(snap, plan)
			expect(resolutions(after), `seed ${seed}`).toEqual(
				resolutions(snap)
			)
			expect(
				planVariableLayoutUpgrade(after).actions,
				`seed ${seed} again`
			).toEqual([])
			promoted += plan.actions.filter(
				(a) => a.kind === "setPubLayout"
			).length
			presetLayouts += plan.actions.filter(
				(a) => a.kind === "setPresetLayout"
			).length
			removed += plan.actions.filter(
				(a) => a.kind === "removePick"
			).length
		}
		// The generator reaches every kind of action, so the property is not vacuous.
		expect(promoted).toBeGreaterThan(0)
		expect(presetLayouts).toBeGreaterThan(0)
		expect(removed).toBeGreaterThan(0)
	})
})
