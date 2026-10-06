/**
 * A view of Adventure's turn as the server shapes it (`panel/groups.ts`), cut
 * down to what the panel's DOM tests read: four headed groups, one per model
 * call, then the whole pipeline. Written by hand in the payload's own shape so
 * the tests need no database; `panel/groups.int.test.ts` pins the real one.
 */

type Option = Sockets.Pipelines.Option
type Group = Sockets.Pipelines.SettingsGroup

let seq = 0
export function option(over: Partial<Option> & Pick<Option, "label" | "control">): Option {
	seq += 1
	return {
		id: over.id ?? `o${seq.toString(16).padStart(4, "0")}`,
		value: null,
		source: "author",
		writable: true,
		overriddenHere: false,
		changed: false,
		step: { key: "k0", heading: "Step" },
		...over
	} as Option
}

const connections = [
	{
		id: 1,
		label: "KoboldCpp",
		models: [
			{ id: 11, name: "Nemo 12B", model: "nemo-12b", enabled: true, missingSince: null },
			{ id: 12, name: "Qwen 7B", model: "qwen-7b", enabled: true, missingSince: null }
		]
	},
	{
		id: 2,
		label: "OpenRouter",
		disabled: true,
		reason: "Can't do text output.",
		models: [{ id: 21, name: "Claude", model: "claude", enabled: true, missingSince: null }]
	}
]
const samplingChoices = [
	{ id: 1, label: "Default" },
	{ id: 2, label: "Background" },
	{ id: 3, label: "Creative" }
]

function callGroup(
	key: string,
	heading: string,
	purpose: string,
	step: string,
	opts: { enabled?: boolean; samplingSetHere?: boolean } = {}
): Group {
	const own = { key: `${key}-call`, heading: step }
	const context = { key: `${key}-context`, heading: "Build context" }
	return {
		key,
		kind: "model-call",
		heading,
		purpose,
		...(opts.enabled
			? {
					enabled: option({
						label: "Enabled",
						control: "boolean",
						decl: { boolean: { default: true } },
						value: true,
						step: own
					})
				}
			: {}),
		front: [
			option({
				label: "Prompts",
				control: "prompts-ref",
				choices: [{ id: 5, label: `${heading} prompt` }],
				promptFields: ["system"],
				step: context
			}),
			option({
				label: "Connection",
				control: "connection-ref",
				choices: connections,
				inherits: { from: "pub", label: "Pub default — KoboldCpp · Nemo 12B" },
				provenance: { source: "pub", label: "Pub default" },
				valueLabel: "KoboldCpp · Nemo 12B",
				step: own
			}),
			option({
				label: "Sampling",
				control: "sampling-ref",
				choices: samplingChoices,
				...(opts.samplingSetHere
					? {
							value: 2,
							source: "config",
							overriddenHere: true,
							changed: true,
							provenance: { source: "config", label: "Set in this configuration" },
							valueLabel: "Background"
						}
					: {
							provenance: { source: "pub", label: "Pub default" },
							valueLabel: "Default"
						}),
				inherits: { from: "pub", label: "Pub default — Default" },
				step: own
			})
		],
		advanced: [
			{
				key: own.key,
				heading: step,
				options: [
					option({ label: "Stop sequences", control: "string[]", step: own }),
					option({
						label: "Generate JSON",
						control: "boolean",
						decl: { boolean: { default: false } },
						value: true,
						source: "config",
						overriddenHere: true,
						changed: true,
						step: own
					})
				]
			},
			{
				key: context.key,
				heading: "Build context",
				options: [option({ label: "Template", control: "template", step: context })]
			}
		],
		changedInAdvanced: 1
	}
}

export function adventureGroups(): Group[] {
	const lore = { key: "lore", heading: "World lore" }
	const budget = { key: "budget", heading: "Context budget" }
	return [
		callGroup("g0", "Planner", "Decides what happens next and who speaks.", "Plan the turn", {
			enabled: true,
			samplingSetHere: true
		}),
		callGroup("g1", "Narrator", "Writes the scene from the plan.", "Narrate the scene"),
		callGroup("g2", "Voices", "Each cast member speaks their own line.", "Voice a line"),
		callGroup("g3", "State keeper", "Keeps the record of what changed.", "Keep the record", {
			enabled: true
		}),
		{
			key: "g4",
			kind: "pipeline",
			heading: "Whole pipeline",
			front: [
				option({
					label: "World lore",
					control: "boolean",
					decl: { boolean: { default: true } },
					value: true,
					step: lore
				})
			],
			advanced: [
				{
					key: budget.key,
					heading: "Context budget",
					options: [
						option({
							label: "Safety margin",
							control: "number",
							decl: { number: { default: 64 } },
							step: budget
						})
					]
				}
			],
			changedInAdvanced: 0
		}
	]
}

export function adventureView(
	over: Partial<Sockets.Pipelines.NamespaceDetail> = {}
): Sockets.Pipelines.NamespaceDetail {
	return {
		slug: "core:spec/adventure-respond",
		name: "Reply",
		version: "1.0.0",
		event: null,
		enabled: true,
		taxonomy: null,
		configs: [
			{ id: 3, name: "Adventure", isDefault: true, readOnly: false, enabled: true, includedActions: null }
		],
		modeActions: [],
		selectedConfig: { id: 3, name: "Adventure", source: "shipped" },
		canSelectConfig: true,
		groups: adventureGroups(),
		scope: { kind: "config" },
		...over
	}
}

/** The same view as a session sees it: the model is shown, never chosen. */
export function adventureSessionView(sessionId: number): Sockets.Pipelines.NamespaceDetail {
	const groups = adventureGroups().map((g) => ({
		...g,
		front: g.front.map((o) =>
			o.control === "connection-ref"
				? {
						...o,
						writable: false,
						choices: undefined,
						provenance: { source: "config" as const, label: "From the “Adventure” configuration" }
					}
				: o
		)
	}))
	return adventureView({ groups, scope: { kind: "session", sessionId } })
}

/**
 * The same session view as the server sends it to someone who is not an
 * administrator (owner ruling 2026-09-30): only rows their role edits — the
 * prompts — so no switch, no Model, no Sampling, no Advanced, and no group
 * left with nothing in it.
 */
export function nonAdminSessionView(sessionId: number): Sockets.Pipelines.NamespaceDetail {
	const groups = adventureGroups()
		.map(({ enabled: _enabled, ...g }) => ({
			...g,
			front: g.front.filter((o) => o.control === "prompts-ref"),
			advanced: [],
			changedInAdvanced: 0
		}))
		.filter((g) => g.front.length)
	return adventureView({ groups, canSelectConfig: true, scope: { kind: "session", sessionId } })
}

/** A pipeline with nothing a session draws — Answer, Nudge, Whisper. */
export function emptySessionView(sessionId: number): Sockets.Pipelines.NamespaceDetail {
	return adventureView({
		slug: "core:spec/adventure-answer",
		name: "Adventure answer",
		groups: [
			{
				key: "g0",
				kind: "pipeline",
				front: [],
				advanced: [
					{
						key: "x",
						heading: "Gather",
						options: [option({ label: "Run", control: "enum", step: { key: "x", heading: "Gather" } })]
					}
				],
				changedInAdvanced: 0
			}
		],
		scope: { kind: "session", sessionId }
	})
}

/**
 * A session's creation pipeline as the session sees it (owner ruling
 * 2026-09-30): its own values, editable while creating; once created the
 * server marks the scope read-only, with the sentence why, and no row
 * writable.
 */
export function creationSessionView(
	sessionId: number,
	readOnlyBecause?: string
): Sockets.Pipelines.NamespaceDetail {
	const view = adventureSessionView(sessionId)
	const groups = readOnlyBecause
		? view.groups.map((g) => ({
				...g,
				front: g.front.map((o) => ({ ...o, writable: false })),
				advanced: g.advanced.map((st) => ({
					...st,
					options: st.options.map((o) => ({ ...o, writable: false }))
				}))
			}))
		: view.groups
	return {
		...view,
		slug: "core:spec/adventure-create",
		name: "Create session",
		canSelectConfig: !readOnlyBecause,
		groups,
		scope: { kind: "session", sessionId, ...(readOnlyBecause ? { readOnlyBecause } : {}) }
	}
}
