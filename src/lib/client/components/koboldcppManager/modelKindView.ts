/**
 * View-side rules for the Manager's Text | Image split.
 *
 * These live out here rather than inside the .svelte files because every one of
 * them fails SILENTLY. A wrong list predicate hides a file the user can see
 * sitting in their models folder; a wrong status string tells them image
 * generation is live while the running process has never heard of the model
 * they picked; a wrong display name just looks like a different file. None of
 * it throws, nothing turns red, so a test is the only thing that would ever
 * notice.
 */

type ModelKind = Sockets.KoboldCPP.ModelKind
type ModelKindFilter = Sockets.KoboldCPP.ModelKindFilter

/**
 * Is a row with this `kind` shown while the Manager is listing `listing`?
 *
 * "unknown" is admitted into BOTH lists deliberately. The classifier gives up
 * on a truncated download, an unreadable file, or an architecture nobody has
 * added to the allowlists yet — and a file the user can see on disk but not in
 * the Manager reads as the scan being broken, not as the file being
 * unclassifiable. It appears in both, wearing an Unverified badge, with the
 * two-button override as the way out.
 *
 * There is deliberately no third "Unknown" segment in the toggle to put these
 * behind: a segment nobody visits is where unknowns would go to die.
 */
export function isListedUnder(
	kind: ModelKind,
	listing: ModelKindFilter
): boolean {
	return kind === listing || kind === "unknown"
}

/**
 * How many rows the TEXT list would show.
 *
 * Drives the first-run wizard's glow on the Available tab, whose whole job is
 * to say "the Models tab is a dead end, go download something" — so it has to
 * count exactly what that tab renders in text mode, or the cue and the screen
 * disagree. Counting every row instead (as it did before image models existed)
 * silently drops the cue for a user whose only model is an SD checkpoint, which
 * is precisely the user who has nothing usable.
 */
export function countTextModels(models: { kind: ModelKind }[]): number {
	return models.filter((m) => isListedUnder(m.kind, "text")).length
}

/**
 * What a connection's Model `<select>` may offer, and whether the value it
 * currently holds is an image model.
 *
 * Two failures, both silent, both fixed here rather than in the form:
 *
 * 1. An SD checkpoint offered as a connection's text model saves without
 *    complaint and only fails at generation time, with an error naming the
 *    connection rather than the model — a long way from the thing that has to
 *    change. So image-kind rows are filtered out.
 * 2. A model chosen before it was classified — or reclassified since — would
 *    then have no matching `<option>`, and a `<select>` whose bound value has
 *    no option renders BLANK. The next save writes that blank straight into
 *    the connection: the user loses their model by opening the form and
 *    closing it again. So the current selection is kept in the list no matter
 *    what it was classified as, and the caller warns about it instead.
 *
 * "unknown" rows stay offered: the classifier gives up on files it cannot
 * read, and refusing those would strand anyone whose only model is one.
 */
export function textModelOptions<T extends { name: string; kind: ModelKind }>(
	models: T[],
	selected: string | null | undefined
): { options: T[]; selectedIsImageModel: boolean } {
	const options = models.filter((m) => isListedUnder(m.kind, "text"))
	const selectedIsImageModel =
		!!selected &&
		models.some((m) => m.name === selected && m.kind === "image")
	if (!selectedIsImageModel) return { options, selectedIsImageModel }
	return {
		options: [...models.filter((m) => m.name === selected), ...options],
		selectedIsImageModel
	}
}

/**
 * Strip the extension for display.
 *
 * Both are real now: koboldcpp takes .gguf for text, and .gguf OR .safetensors
 * for images. A .gguf-only strip left half the image list showing a bare
 * ".safetensors" tail that no other row had — cosmetic, but it reads as two
 * different kinds of entry in one list.
 */
export function modelDisplayName(filename: string): string {
	return filename.replace(/\.(gguf|safetensors)$/i, "")
}

/**
 * koboldcpp reports the loaded model by a display name it derives itself, not
 * by the filename we handed it, so this stays a substring test rather than an
 * equality one.
 */
export function isCurrentlyLoaded(
	currentModel: string | null | undefined,
	filename: string
): boolean {
	if (!currentModel) return false
	return currentModel
		.toLowerCase()
		.includes(modelDisplayName(filename).toLowerCase())
}

export type ImageModelStatus = "off" | "pending" | "active"

/**
 * Three states, not two.
 *
 * A connection NAMES one model; what is RESIDENT in the koboldcpp process is
 * the model manager's decision, and today it keeps exactly one model in memory.
 * So connecting an image model does not load it — the load happens on demand at
 * render time, exactly as a text model is loaded at generation time. "Chosen,
 * but the process running right now is holding the chat model instead" is
 * therefore the ordinary resting state of a working setup, not a fault, and a
 * two-state control would report a problem every time the user has been
 * chatting.
 *
 * `resident` is the image entry of the loaded-config residency map. Absent
 * means no image model is loaded right now.
 */
export function imageModelStatus(
	chosen: string | null | undefined,
	resident: { file: string } | null | undefined
): ImageModelStatus {
	if (!chosen) return "off"
	if (!resident?.file) return "pending"
	return sameModelFile(chosen, resident.file) ? "active" : "pending"
}

/**
 * Which directory the Manager means while listing or downloading `kind`, or
 * null when it has none.
 *
 * The image directory is nullable and NULL means "the text one" — for reads and
 * writes both. That is the upgrade contract: an install with one flat directory
 * today keeps finding, downloading and deleting every model it already owns,
 * with nothing moved on disk. Resolving it wrong fails silently in the worst
 * way — the Image tab claims no directory is configured and hides files the
 * user can plainly see in their folder.
 *
 * modelsDirFor in src/lib/server/koboldcpp/modelsDir.ts is the authority; this
 * exists so a screen can NAME the directory a file will land in without a round
 * trip. An empty string counts as unset, because that is what a blank settings
 * field saves as.
 */
export function modelsDirForKind(
	kind: ModelKindFilter,
	settings:
		| {
				koboldCppManagerModelsDir?: string | null
				koboldCppImageModelsDir?: string | null
		  }
		| null
		| undefined
): string | null {
	const textDir = settings?.koboldCppManagerModelsDir || null
	if (kind === "text") return textDir
	return settings?.koboldCppImageModelsDir || textDir
}

/**
 * A connection stores a bare filename; the residency record echoes back what
 * went into the .kcpps, which can be that filename joined against a models
 * directory. Comparing the two as-is would report "pending" forever, so the
 * comparison is on the last path segment.
 */
function sameModelFile(a: string, b: string): boolean {
	return basename(a).toLowerCase() === basename(b).toLowerCase()
}

/**
 * Deliberately not node:path — this runs in the browser, and the path being
 * split came from whichever OS the server happens to run on, so both
 * separators have to be honoured regardless of the client's platform.
 */
function basename(p: string): string {
	const parts = p.split(/[\\/]/)
	return parts[parts.length - 1] || p
}
