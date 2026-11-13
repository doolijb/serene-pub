/**
 * 🚧 The one door the audio.cpp adapters use into the process Serene Pub runs
 * and its package list (PLAN-audiocpp-managed S5/S6, lane C).
 *
 * Both halves belong to the service (lane B): `server/audiocpp/process.ts`
 * starts, configures and health-checks the process; `server/audiocpp/packages.ts`
 * knows which packages are downloaded and enabled, and each one's task and
 * family (data from the list, never read from a file name — plan D3). This
 * module holds the dynamic imports, so the speech and transcription adapters
 * (and their tests, which mock THIS module) depend on one file that always
 * exists, and importing an adapter never loads the supervisor.
 */

/** What a model row needs from one enabled package. */
export type EnabledAudioCppPackage = Pick<
	Sockets.AudioCpp.PackageRow,
	"id" | "name" | "task" | "family" | "variant" | "sizeBytes"
>

/**
 * Make the process ready to answer — binary present, `server.json` current,
 * process running and healthy — and say where it listens. Starts it when it
 * is down; the speech and transcription calls go through this, discovery and
 * listing never do.
 */
export async function ensureAudioCppReadyUrl(
	opts: { signal?: AbortSignal } = {}
): Promise<{ baseUrl: string }> {
	const { ensureAudioCppReady } = await import("$lib/server/audiocpp/process")
	return ensureAudioCppReady(opts)
}

/**
 * The packages that are on disk AND listed in `server.json` — each becomes one
 * model row on the managed connection. Reads files and data only; never asks
 * the process.
 */
export async function listEnabledAudioCppPackages(
	db: Db
): Promise<EnabledAudioCppPackage[]> {
	const [packages, { getAudioLists }] = await Promise.all([
		import("$lib/server/audiocpp/packages"),
		import("$lib/server/audio/audioList")
	])
	// One read of the lists for both walks (memoised after the first fetch).
	// (`audioList.ts` types its handle as the app's own; any `Db` serves.)
	const lists = (await getAudioLists(db as never)) as unknown as Parameters<
		typeof packages.enabledPackagesForConfig
	>[1] & {}
	// Exactly the set `server.json` is written from — a row for a package the
	// process was never told about would be a model nothing can serve.
	const enabled = await packages.enabledPackagesForConfig(db, lists)
	if (!enabled.length) return []
	// The display names and sizes live on the package listing, not the config
	// entries; the size becomes the row's model facts (Models list totals).
	const listing = new Map(
		(await packages.listAudioCppPackages(db, { lists, backend: null })).map(
			(p) => [p.id, p] as const
		)
	)
	return enabled.map((p) => {
		const listed = listing.get(p.id)
		return {
			id: p.id,
			name: listed?.name ?? p.id,
			task: p.task,
			family: p.family,
			...(p.variant ? { variant: p.variant } : {}),
			...(listed?.sizeBytes ? { sizeBytes: listed.sizeBytes } : {})
		}
	})
}
