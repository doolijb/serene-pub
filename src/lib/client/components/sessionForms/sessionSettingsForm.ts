/**
 * 🚧 The plain half of the session's derived settings form (PLAN-layering
 * A9, A10, R1, R36, R37; lane 7, 2026-10-21): what a field's value reads as,
 * where it came from in words, and what a routine's status line says. The
 * components draw; this decides the words, so a test can read them without
 * mounting anything.
 *
 * Copy (STYLE-GUIDE §10): a member never reads "registration", "cadence" or
 * "cron" here. The layer words name what a person picked — _the preset_,
 * _the genre's defaults_ — and only an administrator is shown where a value
 * came from at all.
 */
type Field = Sockets.Sessions.SettingsForm.Field
type Routine = Sockets.Sessions.SettingsForm.Routine
type RoutineStatus = Sockets.Sessions.Routines.Routine

/** What a value reads as — its member's label, On/Off, the number, the list. */
export function valueText(field: Pick<Field, "control" | "members">, value: unknown): string {
	if (value === null || value === undefined || value === "") return "Not set"
	switch (field.control) {
		case "boolean":
			return value === true ? "On" : "Off"
		case "enum":
			return field.members?.find((m) => m.key === value)?.label ?? String(value)
		case "list": {
			const items = Array.isArray(value) ? value.map(String) : []
			if (!items.length) return "None"
			return items.map((k) => field.members?.find((m) => m.key === k)?.label ?? k).join(", ")
		}
		case "json":
			try {
				return JSON.stringify(value)
			} catch {
				return String(value)
			}
		default:
			return String(value)
	}
}

/**
 * Where the value came from, for an administrator (§6.17's provenance line):
 * _Set for this session_, _From the preset_, _From the genre's defaults_,
 * else the pipeline's or genre's own default. Null when there is nothing
 * worth saying.
 */
export function sourceWords(source: Field["source"]): string | null {
	switch (source) {
		case "session":
			return "Set for this session"
		case "preset":
			return "From the preset"
		case "genre":
			return "From the genre's defaults"
		case "author":
			return "The pipeline's default"
		case "declaration":
			return null
	}
	return null
}

/** A routine's mode field — the one control everybody with the settings has (R37). */
export const modeFieldOf = (r: Routine): Field | undefined =>
	r.fields.find((f) => f.address.kind === "routine" && f.address.field === "mode")

/**
 * 🚧 A routine's **When it runs** choice — after each turn or after each
 * round (R52): the one cadence choice an owner makes, on a routine its preset
 * runs on one of the two (Story's reckoning). Absent for every other routine.
 */
export const cadenceChoiceFieldOf = (r: Routine): Field | undefined =>
	r.fields.find((f) => f.address.kind === "routine" && f.address.field === "cadence")

/** A routine's other fields — its cadence's options, Allow stacking, the cron caps: an administrator's (R36). */
export const adminFieldsOf = (r: Routine): Field[] =>
	r.fields.filter((f) => !(f.address.kind === "routine" && (f.address.field === "mode" || f.address.field === "cadence")))

/**
 * What a routine is doing now, in one line — paused and why (R11, R21),
 * what it needs, waiting or running — or null when it is simply there.
 */
export function routineStatusLine(status: RoutineStatus | undefined): string | null {
	if (!status) return null
	if (status.needs) return status.needs
	if (status.paused) return status.paused
	if (status.running) return "Running now"
	if (status.waiting > 0) return status.waiting === 1 ? "Waiting to run" : `${status.waiting} runs waiting`
	return null
}

/** The modes, in the order the track draws them, each with what it means. */
export const ROUTINE_MODES: ReadonlyArray<{ key: "off" | "review" | "full"; label: string; hint: string }> = [
	{ key: "off", label: "Off", hint: "Does not run." },
	{ key: "review", label: "Review", hint: "Runs, and holds what it would change for you to accept." },
	{ key: "full", label: "Full", hint: "Runs, and applies what it changes." }
]

/** Fields folded under Advanced, and the rest. */
export function splitAdvanced(fields: readonly Field[]): { front: Field[]; advanced: Field[] } {
	return {
		front: fields.filter((f) => !f.advanced),
		advanced: fields.filter((f) => f.advanced)
	}
}

/** A stable DOM id for a field (its address id is JSON). */
export const fieldDomId = (field: Pick<Field, "id">, prefix = "setting"): string =>
	`${prefix}-${field.id.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`
