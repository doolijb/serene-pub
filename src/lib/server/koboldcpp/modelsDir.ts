/**
 * The two models directories, and the single rule that makes a second one safe.
 *
 * Text GGUFs and Stable-Diffusion models used to share one flat folder. They no
 * longer do — `koboldcpp_models_dir` holds the LLMs, `koboldcpp_image_models_dir`
 * the image models — and every path this app builds now has to say which of the
 * two it means.
 *
 * ## The invariant: containment is a property of the (dir, filename) PAIR
 *
 * The guard everywhere else in this codebase is "resolve the join, then require
 * the result to sit under the directory". With two candidate directories the
 * tempting shortcut is to widen that into "…under EITHER directory" — and that
 * is a hole, not a generalisation: `../image/x` resolved against the text
 * directory lands squarely inside the image one and passes. So a second
 * candidate directory means running the whole PAIR again, never relaxing the
 * first check.
 *
 * {@link assertBareFilename} closes it ahead of that anyway. A name is required
 * to be its own basename BEFORE any directory is joined to it, so traversal is
 * impossible by the time containment is consulted at all and the `startsWith`
 * tests below are defence in depth rather than the only line.
 *
 * ## NULL means "use the text directory"
 *
 * `koboldcpp_image_models_dir` is nullable and existing installs are deliberately
 * never backfilled (see `db/defaults.ts`). NULL is a contract, not a missing
 * value: an install that has one flat folder today keeps finding every model it
 * already owns, in place, with nothing moved. Nothing here ever relocates a file
 * — a migration shuffling multi-gigabyte models would be unrecoverable if it were
 * interrupted, and the read-side retry below makes it unnecessary.
 *
 * ## Reads may retry; writes never do
 *
 * A read (load, delete, size) tries the kind's own directory and then the other
 * one, because a legacy flat install has image models sitting in the LLM folder
 * and they must stay loadable. A write (download) targets the kind's directory
 * and only that one, because falling back would scatter new files into whichever
 * folder happened to answer first.
 */

import * as path from "path"
import * as fsPromises from "fs/promises"

/** Only the two columns this module reads, so a caller can hand it a settings
 * row, a patch, or a test fixture without dragging the whole table along. */
export interface ModelsDirSettings {
	koboldCppManagerModelsDir: string | null
	koboldCppImageModelsDir?: string | null
}

type ModelKindFilter = Sockets.KoboldCPP.ModelKindFilter

const OTHER_KIND: Record<ModelKindFilter, ModelKindFilter> = {
	text: "image",
	image: "text"
}

/**
 * The directory a model of this kind belongs in, or null if none is configured.
 *
 * Image falls back to the text directory rather than to a derived sibling: a
 * sibling would be a folder the user never chose and has nothing in.
 */
export function modelsDirFor(
	kind: ModelKindFilter,
	settings: ModelsDirSettings
): string | null {
	if (kind === "text") return settings.koboldCppManagerModelsDir || null
	return (
		settings.koboldCppImageModelsDir ||
		settings.koboldCppManagerModelsDir ||
		null
	)
}

/**
 * Reject anything that is not a bare filename, before it is joined to anything.
 *
 * Both separators, not `path.sep` — a Windows-shaped name is still a
 * subdirectory reference when it arrives from a Hugging Face repo listing, and
 * `path.basename` on POSIX would hand `..\\evil` straight back unchanged.
 */
export function assertBareFilename(name: string): void {
	if (
		!name ||
		name === "." ||
		name === ".." ||
		name.includes("/") ||
		name.includes("\\") ||
		name.includes("\0") ||
		path.basename(name) !== name
	) {
		throw new Error(`Invalid model filename: ${JSON.stringify(name)}`)
	}
}

/** One (dir, filename) pair, resolved and contained. Never call this with a
 * name that hasn't been through {@link assertBareFilename}. */
function containedPath(dir: string, filename: string): string {
	const resolvedDir = path.resolve(dir)
	const full = path.resolve(path.join(resolvedDir, filename))
	// Trailing separator matters: without it a sibling directory like
	// "models-evil" would pass a bare startsWith(resolvedDir) check.
	if (full !== resolvedDir && !full.startsWith(resolvedDir + path.sep)) {
		throw new Error(`Invalid model filename: ${JSON.stringify(filename)}`)
	}
	return full
}

async function fileExists(full: string): Promise<boolean> {
	try {
		await fsPromises.access(full)
		return true
	} catch {
		return false
	}
}

/**
 * The absolute path of a model file.
 *
 * `mustExist` is required and picks the whole behaviour, because the existence
 * check and the fallback are the same decision: only a read can afford to look
 * in the other directory, and only a read can tell whether it needs to.
 *
 *   - `mustExist: true` — a READ. Tries the kind's directory, then, as a fresh
 *     (dir, filename) pair, the other one. Throws naming the file if neither has
 *     it. This retry is the whole of what keeps a legacy flat install's image
 *     models loadable and deletable with nothing migrated on disk.
 *   - `mustExist: false` — a WRITE. The kind's directory only, no stat, no
 *     fallback.
 */
export async function resolveModelPath(
	kind: ModelKindFilter,
	filename: string,
	settings: ModelsDirSettings,
	opts: { mustExist: boolean }
): Promise<string> {
	assertBareFilename(filename)
	const primary = modelsDirFor(kind, settings)
	if (!primary) {
		throw new Error(
			`No ${kind === "text" ? "" : "image "}models directory is configured — set one in the KoboldCPP Manager's Settings tab.`
		)
	}
	const primaryPath = containedPath(primary, filename)
	if (!opts.mustExist) return primaryPath
	if (await fileExists(primaryPath)) return primaryPath

	const other = modelsDirFor(OTHER_KIND[kind], settings)
	if (other && path.resolve(other) !== path.resolve(primary)) {
		const otherPath = containedPath(other, filename)
		if (await fileExists(otherPath)) return otherPath
	}

	throw new Error(
		`Model file "${filename}" is not in ${primary}. It may have been moved or deleted outside the app — re-download it, or pick another model in the KoboldCPP Manager.`
	)
}

/**
 * Every directory a listing scan has to read, deduplicated, with the kind whose
 * folder it is.
 *
 * Text comes first, so an install where the two resolve to the same string
 * produces exactly one entry labelled `text` — which is precisely today's
 * behaviour on a flat install, and the reason nothing about it changes.
 *
 * ⚠ The union across ALL of these has to be built before `listModels` runs its
 * stale sweep. That sweep deletes every `koboldcpp_models` row whose filename
 * the scan did not see, so sweeping after scanning one directory would wipe the
 * other's rows — silently, on the first listing after a second directory is set,
 * looking exactly like every model vanishing at once.
 */
export function modelsDirsToScan(
	settings: ModelsDirSettings
): { kind: ModelKindFilter; dir: string }[] {
	const out: { kind: ModelKindFilter; dir: string }[] = []
	const seen = new Set<string>()
	for (const kind of ["text", "image"] as const) {
		const dir = modelsDirFor(kind, settings)
		if (!dir) continue
		const key = path.resolve(dir)
		if (seen.has(key)) continue
		seen.add(key)
		out.push({ kind, dir })
	}
	return out
}
