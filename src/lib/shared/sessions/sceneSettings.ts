/**
 * 🚧 A session's **scene settings** (PROPOSAL-live-scenes §4–§5, lane D,
 * 2026-10-13): how its scene boundaries are placed while it is played
 * (**Scenes**: Manual · Suggested · Automatic, and the boundary triggers) and
 * when a scene's summary runs (**Summaries**: On close · On request · Never).
 *
 * Declared on the genre (`SessionShape.scenes`, SDK) and overridable per
 * session. The override is stored on the session row's `metadata` under
 * `scenes` — the settings document's existing store for core keys, beside
 * `playerLabel` and the turn order, so no column and no second setting
 * system. Every reader resolves through the SDK's `resolveSceneSettings`, so
 * the watcher, the Chronicle and the settings form cannot come to disagree.
 *
 * Also the words a **scene cue**'s chip says for each boundary trigger.
 */
import {
	resolveSceneSettings,
	sceneSettingsFindings,
	type SceneSettings,
	type SceneSettingsDecl
} from "@serene-pub/sdk"

/** Where a session's override lives on `sessions.metadata`. */
export const SCENE_SETTINGS_METADATA_KEY = "scenes"

/**
 * The session's stored override, as stored; null when there is none or it
 * does not read. A switch for one of the genre's **declared boundary
 * triggers** (★9, `triggers[key]`, a boolean) reads here without the spec
 * that declares it — the write checked it against that spec, and a reader
 * that dropped the whole override over it would lose the person's settings.
 */
export function storedSceneSettings(metadata: unknown): SceneSettingsDecl | null {
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
		return null
	const v = (metadata as Record<string, unknown>)[SCENE_SETTINGS_METADATA_KEY]
	if (!v || typeof v !== "object" || Array.isArray(v)) return null
	return sceneSettingsFindings(v, "scenes", {
		layer: "session",
		declaredTriggers: "any"
	}).length
		? null
		: (v as SceneSettingsDecl)
}

/**
 * The cascade for one session: its override (`metadata.scenes`), else its
 * genre's `shape.scenes`, else the defaults (Suggested; day crossed, time
 * action and place changed on; summaries on request).
 */
export function sessionSceneSettings(
	genreShape: unknown,
	metadata: unknown
): SceneSettings {
	return resolveSceneSettings(genreShape, storedSceneSettings(metadata))
}

/** Two resolved settings say the same. */
export function sameSceneSettings(a: SceneSettings, b: SceneSettings): boolean {
	return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * What a scene cue's chip says for each boundary trigger — "New scene? — the
 * day changed". A genre's own **declared** trigger (★9) says its declared
 * label (`sceneCueReason`'s `labels`), else its key.
 */
export const SCENE_CUE_REASONS: Readonly<Record<string, string>> = Object.freeze({
	// 🚧 Not a setting: a person's *End scene here* (lane E).
	endedHere: "the last scene ended",
	dayCrossed: "the day changed",
	timeAction: "time passed",
	placeChanged: "the place changed",
	narration: "a narrator line",
	length: "the scene is long",
	pause: "a long pause"
})

/**
 * The chip's reason for the triggers that fired at one line, joined. `labels`
 * are the session's declared triggers' words, by key (★9).
 */
export function sceneCueReason(
	triggers: readonly string[],
	labels?: Readonly<Record<string, string>>
): string {
	return triggers
		.map((t) => SCENE_CUE_REASONS[t] ?? labels?.[t] ?? t)
		.join(" · ")
}

/** The UI words for each scene mode and summary mode (settings form, Chronicle). */
export const SCENE_MODE_LABELS = Object.freeze({
	manual: "Manual",
	suggested: "Suggested",
	automatic: "Automatic"
} as const)
export const SCENE_SUMMARY_LABELS = Object.freeze({
	onClose: "On close",
	onRequest: "On request",
	never: "Never"
} as const)
