/**
 * B2-3: the scene's notes reach the transcript preamble (`sceneOf` keeps them;
 * the template line renders them).
 */
import { describe, expect, it } from "vitest"
import Handlebars from "handlebars"
import { renderTranscript, sceneOf } from "./transcript"

/** The SDK's preamble line for notes (`DEFAULT_TRANSCRIPT_TEMPLATE`), as shipped. */
const TEMPLATE = [
	'{{#*inline "preamble"}}',
	'{{#if scene.name}}Scene: {{{scene.name}}}\n{{/if}}',
	'{{#if scene.notes}}Noted in this scene:{{#each scene.notes}}\n- {{{this}}}{{/each}}\n{{/if}}',
	"{{/inline}}",
	'{{#*inline "line"}}{{{name}}}: {{{text}}}{{/inline}}',
	'{{#*inline "aside"}}{{{text}}}{{/inline}}'
].join("\n")

describe("sceneOf notes", () => {
	it("keeps the notes' text as strings, blanks dropped", () => {
		const out = sceneOf({
			scene: { name: "Gate", notes: [{ text: " The king died. " }, "A treaty.", { text: "  " }, 4] }
		})
		expect(out).toEqual({ name: "Gate", notes: ["The king died.", "A treaty."] })
	})
	it("no notes, no key", () => {
		expect(sceneOf({ scene: { name: "Gate", notes: [] } })).toEqual({ name: "Gate" })
	})
})

describe("the preamble with notes", () => {
	it("lists each note on its own line", async () => {
		const render = async (src: string, vars: Record<string, unknown>) =>
			Handlebars.compile(src)(vars)
		const out = await renderTranscript(
			{
				messages: [],
				scene: { name: "Gate", notes: [{ text: "The king died." }, { text: "A treaty." }] }
			},
			TEMPLATE,
			render as any,
			(t) => t.length
		)
		expect(out.preamble).toBe("Scene: Gate\nNoted in this scene:\n- The king died.\n- A treaty.")
	})
})
