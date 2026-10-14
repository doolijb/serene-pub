/**
 * 🚧 The **sheet sentence** (DESIGN-image-generation §4.8 step 4): a
 * workflow's drawing sheet said as plain words, on the saved row and in the
 * fitting form —
 *
 * *This workflow takes a prompt, a negative, a seed, a size and 1 reference
 * image. It makes 1 picture per run. No transparent output: the cut-out step
 * will run for sprites.*
 *
 * The same facts the sampling form greys by and the bind guard reads, so the
 * sentence can never promise what the run then refuses. Pure, shared.
 *
 * ⚠ Not a receipt: it says what the workflow CAN take, never what one run
 * applied (that is `applied` / `ignored`).
 */
import type { DrawingSheet } from "./types"

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function list(words: readonly string[]): string {
	if (words.length <= 1) return words.join("")
	return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
}

export function sheetSentence(sheet: DrawingSheet, subject = "This workflow"): string {
	const takes = ["a prompt"]
	if (sheet.negative) takes.push("a negative")
	if (sheet.seed) takes.push("a seed")
	if (sheet.steps) takes.push("a step count")
	if (sheet.cfg) takes.push("a CFG")
	if (sheet.sampler) takes.push("a sampler")
	if (sheet.size.kind === "free") takes.push("a size")
	if (sheet.references?.max)
		takes.push(plural(sheet.references.max, "reference image", "reference images"))
	if (sheet.init) takes.push("a starting picture")
	if (sheet.mask) takes.push("a mask")

	const parts = [`${subject} takes ${list(takes)}.`]
	if (sheet.size.kind === "enum" && sheet.size.sizes.length === 1)
		parts.push(`It always draws at ${sheet.size.sizes[0]!.replace("x", "×")}.`)
	parts.push(
		`It makes ${plural(sheet.outputs.perRun, "picture", "pictures")} per run.`
	)
	parts.push(
		sheet.transparent === "native"
			? "Transparent output: sprites come back already cut out."
			: "No transparent output: the cut-out step will run for sprites."
	)
	return parts.join(" ")
}
