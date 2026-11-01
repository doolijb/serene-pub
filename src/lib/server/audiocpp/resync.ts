/**
 * 🚧 After anything that changes which packages audio.cpp, run by Serene Pub,
 * offers: make sure the managed connection row exists, then re-sync its
 * `connection_models` rows (lane C's `syncAudioCppManagedModels`). One
 * function so the four socket handlers and the download-settled hook all do
 * the same thing. Never throws: a failed sync is logged, the change that
 * caused it stands.
 *
 * Dynamic imports keep this module free of the supervisor and the model-sync
 * graph at import time (`packages.ts` imports it).
 */
export async function resyncManagedAudioCpp(db: Db): Promise<void> {
	try {
		const { ensureAudioCppSettings } = await import("./settings")
		const { audioCppBaseUrl } = await import("./process")
		const { ensureManagedAudioCppEndpoint } = await import("./managedEndpoint")
		const { syncAudioCppManagedModels } = await import(
			"$lib/server/connections/audioCppManagedModels"
		)
		const settings = await ensureAudioCppSettings(db)
		await ensureManagedAudioCppEndpoint(db, audioCppBaseUrl(settings))
		await syncAudioCppManagedModels(db)
	} catch (e) {
		console.warn("audio.cpp: model rows did not re-sync:", e)
	}
}
