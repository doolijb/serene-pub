/**
 * An authored component's files, as the editor's tabs hold them (C6, P6).
 *
 * The server is the boundary — `authoredComponentFindings` refuses a bad path
 * on every save and preview — so this is the editor saying so first, in the
 * tab, before a round trip. The grammar is the SDK's `isSafeComponentPath`
 * (`@serene-pub/cli/component-source`), mirrored here because that module
 * imports `node:crypto` and cannot reach the browser; `componentFiles.test.ts`
 * holds the two to the same answers.
 */

/** The app's UI-path grammar (frameHost.ts / component-source), mirrored. */
const SAFE_PATH = /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*(\/[a-zA-Z0-9._-]+)*$/
const AUTHORED_EXT = /\.(svelte|ts|js)$/
const hasDotSegment = (path: string) => path.split("/").some((seg) => seg === "." || seg === "..")

/** What the compiler takes: `.svelte`, `.svelte.ts`/`.svelte.js`, `.ts`, `.js`, no `.`/`..` segment. */
export function isSafeComponentPath(path: string): boolean {
	return SAFE_PATH.test(path) && !hasDotSegment(path) && AUTHORED_EXT.test(path)
}

/** The most files one component may hold (`COMPONENT_COMPILE_LIMITS.files`). */
export const COMPONENT_FILE_LIMIT = 64

/**
 * Why `path` cannot be a new file (or `from`'s new name), in words; null when
 * it can. Checks the grammar, the limit and collisions — renaming a file to
 * its own name is no change, not a collision.
 */
export function filePathProblem(
	path: string,
	files: Readonly<Record<string, string>>,
	from?: string
): string | null {
	const p = path.trim()
	if (!p) return "Name the file."
	if (p !== path) return "A file name has no spaces at either end."
	if (!isSafeComponentPath(p))
		return "Use letters, digits, '.', '_', '-' and '/' only, with no '.' or '..' folder, ending in .svelte, .ts or .js."
	if (from !== undefined && p === from) return null
	if (Object.hasOwn(files, p)) return `There is already a file called ${p}.`
	if (from === undefined && Object.keys(files).length >= COMPONENT_FILE_LIMIT)
		return `A component holds at most ${COMPONENT_FILE_LIMIT} files.`
	return null
}

/** Why `path` cannot be deleted; null when it can. The entry stays, and so does the last file. */
export function deleteFileProblem(path: string, files: Readonly<Record<string, string>>, entry: string): string | null {
	if (!Object.hasOwn(files, path)) return `There is no file called ${path}.`
	if (path === entry) return `${path} is the entry — the file the component starts from — so it stays.`
	if (Object.keys(files).length <= 1) return "A component needs at least one file."
	return null
}

/** `files` with `from` renamed to `to`, in the same order; the entry follows its file. */
export function renameFile(
	files: Readonly<Record<string, string>>,
	entry: string,
	from: string,
	to: string
): { files: Record<string, string>; entry: string } {
	const out: Record<string, string> = {}
	for (const [p, text] of Object.entries(files)) out[p === from ? to : p] = text
	return { files: out, entry: entry === from ? to : entry }
}

/** Which language the editor highlights a file in. */
export type FileLanguage = "svelte" | "ts" | "js"

export function languageFor(path: string): FileLanguage {
	if (path.endsWith(".svelte")) return "svelte"
	if (path.endsWith(".ts")) return "ts"
	return "js"
}

/** The files in the order the tabs show them: the entry first, then by path. */
export function fileOrder(files: Readonly<Record<string, string>>, entry: string): string[] {
	return Object.keys(files).sort((a, b) => (a === entry ? -1 : b === entry ? 1 : a.localeCompare(b)))
}

/** A new file's starting text: a Svelte file gets its script block, a module nothing. */
export function newFileText(path: string): string {
	return languageFor(path) === "svelte" ? '<script lang="ts">\n</script>\n\n<div></div>\n' : ""
}

/**
 * What each tab shows: the file's own name, or as many trailing folders as it
 * takes to tell it from another file of the same name. The full path is the
 * tab's title.
 */
export function tabLabels(paths: readonly string[]): Record<string, string> {
	const out: Record<string, string> = {}
	for (const p of paths) {
		const segs = p.split("/")
		let n = 1
		const tail = (path: string, k: number) => path.split("/").slice(-k).join("/")
		while (n < segs.length && paths.some((o) => o !== p && tail(o, n) === tail(p, n))) n++
		out[p] = tail(p, n)
	}
	return out
}
