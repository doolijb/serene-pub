/**
 * The `components` startup task (C6, P3): bring every authored component's
 * artifact in line with THIS server's toolchain before anything is offered.
 *
 * A row is recompiled when its fingerprint is not the current toolchain's
 * (svelte, esbuild, the SDK packages or the compiler moved — or it was never
 * compiled), or when it names an artifact missing from the component cache.
 * A row whose last compile failed under the same toolchain is left alone:
 * the same source through the same compiler fails the same way. A failure
 * lands in `last_error`, so the widget is not offered rather than offered
 * broken. Afterwards the cache is tidied to exactly the artifacts rows name.
 *
 * No compiler (Android, a stripped install): nothing is touched — rows keep
 * whatever artifact and fingerprint they carry.
 */
import { pluginsEnabled } from "$lib/server/plugins/flag"
import { listAuthoredComponents } from "./store"
import { hasArtifact, pruneArtifacts } from "./cache"
import { compileAndRecord, componentCompilerAvailability, currentToolchainFingerprint } from "./compile"

export interface AuthoredBootReport {
	/** Why nothing was done, when nothing was. */
	skipped?: string
	recompiled: string[]
	failed: Array<{ id: string; error: string }>
	/** Cache entries removed (a deleted component's, a superseded artifact). */
	pruned: number
}

export async function bootAuthoredComponents(db: Db): Promise<AuthoredBootReport> {
	const report: AuthoredBootReport = { recompiled: [], failed: [], pruned: 0 }
	if (!pluginsEnabled()) return { ...report, skipped: "the extension subsystem is off (SP_PLUGINS_ENABLED)" }
	const availability = componentCompilerAvailability()
	if (!availability.available) return { ...report, skipped: availability.reason }
	const fingerprint = await currentToolchainFingerprint()

	for (const row of await listAuthoredComponents(db)) {
		const stale = row.fingerprint !== fingerprint
		const missing = !!row.artifactHash && !(await hasArtifact(row.id, row.artifactHash))
		if (!stale && !missing) continue
		const r = await compileAndRecord(db, row.id)
		if (!r.recorded) continue
		if (r.outcome.errors.length) report.failed.push({ id: row.id, error: r.outcome.errors.map((e) => e.text).join("; ") })
		else report.recompiled.push(row.id)
	}

	const keep = new Map((await listAuthoredComponents(db)).map((r) => [r.id, r.artifactHash] as const))
	report.pruned = await pruneArtifacts(keep)
	return report
}
