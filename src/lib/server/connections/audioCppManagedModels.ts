/**
 * 🚧 audio.cpp, run by Serene Pub — its managed connection's model rows follow
 * its enabled packages (PLAN-audiocpp-managed S6).
 *
 * What: re-lists the managed connection through the ordinary model sync (a
 * package that is gone gets `missing_since`, one that is back is restored),
 * then writes speech facts for the rows that speak. Catalogue facts are always
 * written; discovered voices are merged only when the process is already up —
 * this never starts it.
 * Why: the way KoboldCPP's managed rows follow its files. The service calls it
 * after a package is enabled, disabled, removed, confirmed or downloaded.
 * Best-effort per connection: a failed speech refresh is logged, never thrown.
 */
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { syncManyConnectionModels, type ModelSyncResult } from "./modelSync"

export interface AudioCppManagedModelsResult {
	sync: ModelSyncResult[]
	speech: {
		connectionId: number
		results: Array<{ model: string; connectionModelId: number; error?: string }>
		error?: string
	}[]
}

export async function syncAudioCppManagedModels(
	db: Db,
	opts: { now?: Date } = {}
): Promise<AudioCppManagedModelsResult> {
	const sync = await syncManyConnectionModels(db, {
		types: [CONNECTION_TYPE.AUDIOCPP_MANAGED],
		force: true,
		now: opts.now
	})
	const speech: AudioCppManagedModelsResult["speech"] = []
	for (const r of sync) {
		if (r.error) continue
		try {
			const { refreshSpeechFacts } = await import(
				"$lib/server/connectionAdapters/speech/speechFactsStore"
			)
			speech.push({
				connectionId: r.connectionId,
				results: await refreshSpeechFacts(db, r.connectionId)
			})
		} catch (e: any) {
			console.error("[audiocpp] speech facts after model sync:", e)
			speech.push({
				connectionId: r.connectionId,
				results: [],
				error: e?.message ?? String(e)
			})
		}
	}
	return { sync, speech }
}
