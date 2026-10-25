/**
 * ⏳ **Retired genre tasks, read as registrations** (PLAN-layering D4, R5,
 * R37; 2026-10-20) — the pure half of the 0108 data upgrade for a session's
 * (or a preset's) stored `tasks` value (`TaskSettingsV1`, `{ v: 1, groups?,
 * tasks?: { [key]: { mode, every? } } }`). Each task lived on in one of three
 * places, and this writes it there:
 *
 * | task key | now |
 * |---|---|
 * | `attributes` `time` `conditions` `places-on-move` `timed-expiry` | the reckoning routine's duty (its `duties` step's params) and the routine's mode |
 * | `summary` `lore` `cast` `relationships` `world-state` `scenes` `goals` `goal-reached` | the sweep routine's duty, and its mode |
 * | `image-on-scene` | *Picture each new scene*'s mode |
 * | `memory` (Chat) | *Remember things*' mode |
 * | `lore-retrieval` `scene-reading` (Story) | the reply's `reading` step's params `lore`, `scene` |
 * | `lore-retrieval` (Chat) | the reply's lorebook lane's `settings.enabled` |
 * | `side-cast` `narrator-interjections` | the genre fields `sideCast`, `narratorInterjections` |
 *
 * A routine's mode is one for all its duties (R37): on duties at `review`
 * anywhere make it `review`, else `full`; every duty off makes it `off`.
 * Not carried, and said: a task's own `every` and a group's `every` /
 * `waitForRound` (a cadence's options are an administrator's, R36).
 */
import { sessionEvents, type EffectiveRegistration, type RegistrationDecl } from "@serene-pub/sdk"
import {
	ASSISTANT_MEMORY_SPEC_ID,
	STORY_ILLUSTRATE_NEW_SCENE_SPEC_ID,
	STORY_RECKONING_SPEC_ID,
	STORY_RESPOND_SPEC_ID,
	STORY_SWEEP_SPEC_ID
} from "@serene-pub/core-catalog"
import { rowOfChange, type RegistrationInsert, type RegistrationScope } from "$lib/server/pipelines/registrations/rows"

type Mode = "full" | "review" | "off"

/** The retired tasks' declared defaults (core-catalog `STORY_TASKS` / `CHAT_TASKS`, 2026-10-19). */
const OLD_DEFAULTS: Readonly<Record<string, Mode>> = {
	"lore-retrieval": "full",
	"scene-reading": "full",
	attributes: "full",
	time: "full",
	conditions: "full",
	summary: "full",
	lore: "full",
	cast: "full",
	relationships: "off",
	"world-state": "full",
	scenes: "off",
	goals: "off",
	"image-on-scene": "off",
	"places-on-move": "full",
	"timed-expiry": "full",
	"goal-reached": "off",
	"side-cast": "off",
	"narrator-interjections": "off",
	memory: "off"
}

/** A routine whose duties were tasks: its pipeline, its duties step, task key → duty param. */
const DUTY_ROUTINES: ReadonlyArray<{ pipeline: string; node: string; duties: Readonly<Record<string, string>> }> = [
	{
		pipeline: STORY_RECKONING_SPEC_ID,
		node: "duties",
		duties: {
			attributes: "attributes",
			time: "time",
			conditions: "conditions",
			"places-on-move": "placesOnMove",
			"timed-expiry": "timedExpiry"
		}
	},
	{
		pipeline: STORY_SWEEP_SPEC_ID,
		node: "duties",
		duties: {
			summary: "summary",
			lore: "lore",
			cast: "cast",
			relationships: "relationships",
			"world-state": "worldState",
			scenes: "scenes",
			goals: "goals",
			"goal-reached": "goalReached"
		}
	}
]

/** A routine whose own mode was one task. */
const MODE_ROUTINES: Readonly<Record<string, string>> = {
	"image-on-scene": STORY_ILLUSTRATE_NEW_SCENE_SPEC_ID,
	memory: ASSISTANT_MEMORY_SPEC_ID
}

/** The reply's reading switches. */
const REPLY = { pipeline: STORY_RESPOND_SPEC_ID, node: "reading", params: { "lore-retrieval": "lore", "scene-reading": "scene" } } as const

/** Chat's *Read the lorebook*: its reply's optional lorebook lane (`settings.enabled`). */
const CHAT_LORE = { node: "gather.worldLore.read", slot: "settings", path: "enabled" } as const

/** The voices, genre fields now. */
const FIELDS: Readonly<Record<string, string>> = { "side-cast": "sideCast", "narrator-interjections": "narratorInterjections" }

const modeOf = (raw: unknown): Mode | null =>
	raw === "full" || raw === "review" || raw === "off" ? raw : null

/** What the stored tasks become: change rows, genre fields, and what was not carried. */
export function tasksAsRegistrations(
	stored: unknown,
	offered: ReadonlyArray<EffectiveRegistration | RegistrationDecl>,
	scope: RegistrationScope,
	origin: string
): { rows: RegistrationInsert[]; fields: Record<string, boolean>; notCarried: string[] } {
	const rows: RegistrationInsert[] = []
	const fields: Record<string, boolean> = {}
	const notCarried: string[] = []
	const s = (stored && typeof stored === "object" ? stored : {}) as {
		groups?: Record<string, { every?: unknown; waitForRound?: unknown }>
		tasks?: Record<string, { mode?: unknown; every?: unknown }>
	}
	const tasks = s.tasks && typeof s.tasks === "object" ? s.tasks : {}
	const chosen = (key: string): Mode | null => modeOf(tasks[key]?.mode)
	for (const [group, g] of Object.entries(s.groups ?? {}))
		if (g && (g.every !== undefined || g.waitForRound !== undefined)) notCarried.push(`groups.${group}`)
	for (const [key, t] of Object.entries(tasks)) if (t && t.every !== undefined) notCarried.push(`${key}.every`)
	const regFor = (pipeline: string) => offered.find((r) => r.pipeline === pipeline)

	for (const routine of DUTY_ROUTINES) {
		const keys = Object.keys(routine.duties).filter((k) => chosen(k) !== null)
		if (!keys.length) continue
		const reg = regFor(routine.pipeline)
		if (!reg) {
			notCarried.push(...keys)
			continue
		}
		const all = Object.keys(routine.duties).map((k) => chosen(k) ?? OLD_DEFAULTS[k] ?? "off")
		const on = all.filter((m) => m !== "off")
		const mode: Mode = !on.length ? "off" : on.includes("review") ? "review" : "full"
		const params: Record<string, boolean> = {}
		for (const k of keys) params[routine.duties[k]!] = chosen(k) !== "off"
		rows.push(rowOfChange({ key: reg.key, mode, values: { [routine.node]: { params } } }, scope, origin))
	}
	for (const [key, pipeline] of Object.entries(MODE_ROUTINES)) {
		const m = chosen(key)
		if (!m) continue
		const reg = regFor(pipeline)
		if (!reg) {
			notCarried.push(key)
			continue
		}
		rows.push(rowOfChange({ key: reg.key, mode: m }, scope, origin))
	}
	{
		const keys = Object.keys(REPLY.params).filter((k) => chosen(k) !== null)
		const reg = keys.length ? regFor(REPLY.pipeline) : undefined
		if (keys.length && reg) {
			const params: Record<string, boolean> = {}
			for (const k of keys) params[(REPLY.params as Record<string, string>)[k]!] = chosen(k) !== "off"
			rows.push(rowOfChange({ key: reg.key, values: { [REPLY.node]: { params } } }, scope, origin))
		} else if (keys.length && chosen("lore-retrieval") !== null && !regFor(REPLY.pipeline)) {
			// Chat's *Read the lorebook*: its reply's optional lorebook lane,
			// switched by the node's own `settings.enabled` (lane 3).
			const chatReply = offered.find(
				(r) => r.trigger.family === "event" && r.trigger.event === sessionEvents.messageRespond
			)
			if (chatReply)
				rows.push(
					rowOfChange(
						{
							key: chatReply.key,
							values: { [CHAT_LORE.node]: { [CHAT_LORE.slot]: { [CHAT_LORE.path]: chosen("lore-retrieval") !== "off" } } }
						},
						scope,
						origin
					)
				)
			else notCarried.push("lore-retrieval")
			notCarried.push(...keys.filter((k) => k !== "lore-retrieval"))
		} else notCarried.push(...keys)
	}
	for (const [key, field] of Object.entries(FIELDS)) {
		const m = chosen(key)
		if (m) fields[field] = m !== "off"
	}
	return { rows, fields, notCarried: [...new Set(notCarried)] }
}
