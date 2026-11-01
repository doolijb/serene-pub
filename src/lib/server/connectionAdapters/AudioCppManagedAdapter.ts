/**
 * 🚧 audio.cpp, run by Serene Pub — the connection-facing half of the speech
 * and transcription adapters (PLAN-audiocpp-managed D8, S5–S6).
 *
 * What: lists the enabled packages as model rows, tests the connection without
 * starting anything, and answers "is the process up right now" for discovery.
 * Why: a cold managed service is the normal state, so listing, Test and
 * discovery read settings and files only; starting the process belongs to the
 * speech and transcription calls (via `ensureAudioCppReadyUrl`).
 *
 * Module load is free of the database: `db` is imported inside the functions.
 */
import { modelServerFetch } from "./modelServerFetch"
import {
	listEnabledAudioCppPackages,
	type EnabledAudioCppPackage
} from "./audioCppReady"
import { ensureAudioCppSettings } from "$lib/server/audiocpp/settings"

type Settings = Awaited<ReturnType<typeof ensureAudioCppSettings>>

export type AudioCppModelRow = {
	id: string
	name: string
	modality: "tts" | "asr"
	reads?: string[]
	writes?: string[]
	family: string
}

async function getDb(): Promise<Db> {
	return (await import("$lib/server/db")).db as unknown as Db
}

/** Where the process listens, from the settings row. */
export function audioCppSettingsBaseUrl(settings: Pick<Settings, "port">): string {
	return `http://127.0.0.1:${settings.port}`
}

/**
 * The settings base URL when `GET /health` answers OK in time, else `null`.
 * Never starts anything.
 */
export async function audioCppUpBaseUrl(
	opts: { timeoutMs?: number } = {}
): Promise<string | null> {
	try {
		const settings = await ensureAudioCppSettings(await getDb())
		const base = audioCppSettingsBaseUrl(settings)
		const res = await modelServerFetch(`${base}/health`, {
			method: "GET",
			signal: AbortSignal.timeout(opts.timeoutMs ?? 2000)
		})
		return res.ok ? base : null
	} catch {
		return null
	}
}

/** One model row per enabled package (pure). */
export function modelsFromPackages(
	pkgs: EnabledAudioCppPackage[]
): AudioCppModelRow[] {
	return pkgs.map((p) =>
		p.task === "asr"
			? {
					id: p.id,
					name: p.name,
					modality: "asr",
					reads: ["audio"],
					writes: ["text"],
					family: p.family
				}
			: { id: p.id, name: p.name, modality: "tts", family: p.family }
	)
}

export async function listModels(
	_connection: SelectConnection
): Promise<{ models: AudioCppModelRow[]; error?: string }> {
	try {
		const pkgs = await listEnabledAudioCppPackages(await getDb())
		return { models: modelsFromPackages(pkgs) }
	} catch (err) {
		return {
			models: [],
			error: err instanceof Error ? err.message : String(err)
		}
	}
}

export async function testConnection(_connection: SelectConnection): Promise<{
	ok: boolean
	error?: string
	extra?: Record<string, unknown>
}> {
	try {
		const settings = await ensureAudioCppSettings(await getDb())
		if (!settings.enabled)
			return {
				ok: false,
				error: "audio.cpp, run by Serene Pub, is switched off. Switch it on in its Settings."
			}
		const { audioCppBinaryPath } = await import("$lib/server/audiocpp/binary")
		if (!(await audioCppBinaryPath(settings)))
			return {
				ok: false,
				error: "audio.cpp is not downloaded yet. Choose Download audio.cpp on this connection to set it up."
			}
		if (!settings.enabledPackageIds?.length)
			return {
				ok: false,
				error: "No package is enabled yet. Enable a speech or transcription package on this connection's Models tab."
			}
		const base = audioCppSettingsBaseUrl(settings)
		let res: Response
		try {
			res = await modelServerFetch(`${base}/health`, {
				method: "GET",
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(2000)
			})
		} catch {
			return {
				ok: true,
				extra: {
					running: false,
					note: "audio.cpp starts when one of its models is first used."
				}
			}
		}
		if (!res.ok)
			return {
				ok: false,
				error: `audio.cpp answered HTTP ${res.status} to /health. Restart it from this connection's page, then test again.`
			}
		const j: any = await res.json().catch(() => ({}))
		return {
			ok: true,
			extra: {
				running: true,
				backend: j?.backend,
				version: j?.version,
				models: j?.models
			}
		}
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) }
	}
}
