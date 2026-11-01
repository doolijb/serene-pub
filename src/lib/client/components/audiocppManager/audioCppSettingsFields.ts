/**
 * Pure helpers for the audio.cpp Settings tab: the idle-unload field is shown
 * in seconds but stored in milliseconds, and a save sends only what changed.
 */

/** Milliseconds as the seconds a person edits; null stays null. */
export function msToSeconds(ms: number | null | undefined): number | null {
	return ms == null ? null : ms / 1000
}

/** Seconds as typed back to milliseconds; empty or not a number is null (audio.cpp's default). */
export function secondsToMs(s: number | null | undefined): number | null {
	if (s == null || typeof s !== "number" || !Number.isFinite(s)) return null
	return Math.max(0, Math.round(s * 1000))
}

/** An empty text box is null (the default), never an empty string. */
export function textOrNull(s: string | null | undefined): string | null {
	const t = (s ?? "").trim()
	return t ? t : null
}

/** A number box yields null when empty; anything non-finite is null too. */
export function numberOrNull(n: number | null | undefined): number | null {
	return typeof n === "number" && Number.isFinite(n) ? n : null
}

export interface SettingsDrafts {
	port: number | null
	modelsDir: string
	idleSeconds: number | null
	maxLoadedModels: number | null
	subprocessTimeoutMinutes: number | null
}

type Saved = Pick<
	Sockets.AudioCpp.SettingsView,
	| "port"
	| "modelsDir"
	| "idleUnloadMs"
	| "maxLoadedModels"
	| "subprocessTimeoutMinutes"
>

/** The drafts a settings view seeds. */
export function draftsFrom(s: Saved): SettingsDrafts {
	return {
		port: s.port,
		modelsDir: s.modelsDir ?? "",
		idleSeconds: msToSeconds(s.idleUnloadMs),
		maxLoadedModels: s.maxLoadedModels,
		subprocessTimeoutMinutes: s.subprocessTimeoutMinutes
	}
}

/**
 * Only the fields whose draft differs from what is saved, as an
 * `audiocpp:updateSettings` payload. A port or timeout box left empty is not a
 * change (both are required values), so it is skipped.
 */
export function diffSettings(
	saved: Saved,
	d: SettingsDrafts
): Partial<Sockets.AudioCpp.EditableSettings> {
	const out: Partial<Sockets.AudioCpp.EditableSettings> = {}
	if (d.port != null && d.port !== saved.port) out.port = d.port
	const dir = textOrNull(d.modelsDir)
	if (dir !== saved.modelsDir) out.modelsDir = dir
	const ms = secondsToMs(d.idleSeconds)
	if (ms !== saved.idleUnloadMs) out.idleUnloadMs = ms
	const max = numberOrNull(d.maxLoadedModels)
	if (max !== saved.maxLoadedModels) out.maxLoadedModels = max
	if (
		d.subprocessTimeoutMinutes != null &&
		d.subprocessTimeoutMinutes !== saved.subprocessTimeoutMinutes
	)
		out.subprocessTimeoutMinutes = d.subprocessTimeoutMinutes
	return out
}

/** "Runs on: CUDA · device 0 · 8 threads — chosen in Admin › Hardware." */
export function runsOnLine(s: {
	backendLabel: string | null
	deviceIndex: number | null
	threads: number | null
}): string {
	return `Runs on: ${s.backendLabel ?? "not installed yet"} · ${
		s.deviceIndex == null ? "default device" : `device ${s.deviceIndex}`
	} · ${s.threads == null ? "automatic threads" : `${s.threads} threads`} — chosen in Admin › Hardware.`
}
