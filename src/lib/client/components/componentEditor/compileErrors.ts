/**
 * Compile errors and runtime errors, as the editor's errors pane lists them
 * (C6, P6), and where a click on one takes the cursor.
 *
 * A server compile error names its place the esbuild way: `line` 1-based,
 * `column` 0-based, and `line: 0` when it has no place (a missing import, a
 * limit). A runtime error comes from the widget's box (`onRuntimeError`) and
 * has no place in the source — the artifact is bundled — so it is listed,
 * never jumped to.
 */

export interface CompileErrorLike {
	file: string
	line: number
	column: number
	text: string
}

/** Where a click lands: a file and a character offset into its text. */
export interface SourceLocation {
	file: string
	/** Offset into the file's text, clamped to it. */
	offset: number
	line: number
	column: number
}

/**
 * The offset of (1-based `line`, 0-based `column`) in `text`, both clamped:
 * a line past the end is the last line, a column past a line's end is its
 * end — the source may have been edited since the compile that reported it.
 */
export function offsetOf(text: string, line: number, column: number): number {
	const lines = text.split("\n")
	const l = Math.min(Math.max(1, Math.floor(line)), lines.length)
	let offset = 0
	for (let i = 0; i < l - 1; i++) offset += lines[i]!.length + 1
	const c = Math.min(Math.max(0, Math.floor(column)), lines[l - 1]!.length)
	return offset + c
}

/**
 * Where an error sits in the files the editor holds, or null when it has no
 * place (`line` 0) or names a file the editor does not have. A path with a
 * leading `./` names the same file.
 */
export function errorLocation(
	error: CompileErrorLike,
	files: Readonly<Record<string, string>>
): SourceLocation | null {
	if (!error || typeof error.line !== "number" || error.line < 1) return null
	const file = typeof error.file === "string" ? error.file.replace(/^\.\//, "") : ""
	if (!file || !Object.hasOwn(files, file)) return null
	const offset = offsetOf(files[file]!, error.line, error.column ?? 0)
	return { file, offset, line: error.line, column: error.column ?? 0 }
}

/** The place as a person reads it: `Stats.svelte:12:5` (the column 1-based), or the file alone. */
export function errorPlace(error: CompileErrorLike): string {
	if (!error.file) return ""
	if (!error.line || error.line < 1) return error.file
	return `${error.file}:${error.line}:${(error.column ?? 0) + 1}`
}

/** One line of the errors pane. */
export interface ErrorRow {
	kind: "compile" | "runtime"
	/** `Stats.svelte:12:5`, or empty for a runtime error. */
	place: string
	text: string
	/** Where a click takes the cursor; null when there is nowhere to go. */
	location: SourceLocation | null
	stack?: string
}

/** Every error the pane lists: compile errors first, in the compiler's order, then runtime errors. */
export function errorRows(
	compile: readonly CompileErrorLike[],
	runtime: readonly { message: string; stack?: string }[],
	files: Readonly<Record<string, string>>
): ErrorRow[] {
	return [
		...compile.map((e) => ({
			kind: "compile" as const,
			place: errorPlace(e),
			text: e.text,
			location: errorLocation(e, files)
		})),
		...runtime.map((e) => ({ kind: "runtime" as const, place: "", text: e.message, location: null, stack: e.stack }))
	]
}
