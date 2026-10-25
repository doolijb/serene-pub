/**
 * 🚧 The tools that **file** rather than read (PLAN-genre-restructure §1-2,
 * ★K; lane 2, 2026-10-19): Chat's `lorebook-write` and `image` tool kinds,
 * and its memory.
 *
 *  - `write_entry` — an entry in the session's lorebook (a fact, a person, a
 *    place, a note);
 *  - `remember` / `forget` — a note the Assistant keeps about the person, in
 *    the same book, and taking one back;
 *  - `generate_image` — a picture through the install's image generation,
 *    posted in the session as its own row.
 *
 * ## Not the write the rule forbids
 *
 * `tools/index.ts` says a tool may not write, because a tool is chosen at
 * run time and a write no document declared is a write nobody can review.
 * These four keep the rule's point: each goes through a door the host hands
 * the tool on its context (`fileLore`, `forgetLore`, `makeImage`) — the host's
 * own lore routing and its own `create-message` write, receipted on the run
 * — and the session decides how far it goes. A lorebook write obeys the
 * session's *Remember things* task (`memory`): **Full** files it where the
 * session writes (the book the person attached, when they may write it —
 * their living memory bank — else the session's own notes, made on first
 * use); **Review** files it in the session's own notes only, where the
 * person looks it over and carries it into their book (the lore write
 * mode's Review, PLAN-rulesets §26). A host with no door refuses by name.
 *
 * So the sentences say what happened, in the past tense when it did and
 * plainly when it is waiting — a model told "filed" when it was held would
 * go on as if the person had agreed.
 */
import { ToolError, strArg, type CoreTool, type ToolContext } from "./index"

/** Which entry type a `write_entry` kind names; absent is world lore. */
const ENTRY_TYPES: Readonly<Record<string, string>> = Object.freeze({
	lore: "core:entry/world-lore",
	fact: "core:entry/world-lore",
	note: "core:entry/world-lore",
	person: "core:entry/character-lore",
	character: "core:entry/character-lore",
	place: "core:entry/location",
	location: "core:entry/location",
	history: "core:entry/history"
})

const filedSentence = (what: string, filed: { held: boolean; where: string }) =>
	filed.held
		? `${what} is in this session's own notes, waiting for the person to look it over and add it to their lorebook.`
		: `${what} was filed in ${filed.where}.`

const fileThrough = async (ctx: ToolContext, entry: { name: string; content: string; entryType?: string }) => {
	if (!ctx.fileLore) throw new ToolError("nothing can be written to a lorebook on this step.")
	return await ctx.fileLore(entry)
}

export const writeEntry: CoreTool = {
	name: "write_entry",
	description:
		"File an entry in this session's lorebook: a fact worth keeping, a person, a place, or a note. Use it when the person asks you to write something down, or to keep a fact you established together. Check search_entries first so you do not file the same thing twice.",
	parameters: {
		type: "object",
		properties: {
			name: { type: "string", description: "The entry's title: a few words." },
			content: { type: "string", description: "What the entry says, in plain sentences." },
			kind: {
				type: "string",
				enum: ["lore", "person", "place", "note"],
				description: "What it is about. Defaults to lore."
			}
		},
		required: ["name", "content"],
		additionalProperties: false
	},
	async run(args, ctx) {
		const name = strArg(args, "name", "title")
		const content = strArg(args, "content", "text", "body")
		if (!name || !content) throw new ToolError("write_entry needs a name and what the entry says.")
		const kind = strArg(args, "kind", "type").toLowerCase()
		const filed = await fileThrough(ctx, { name, content, entryType: ENTRY_TYPES[kind] ?? ENTRY_TYPES.lore })
		return { ...filed, message: filedSentence(`The entry '${name}'`, filed) }
	}
}

export const remember: CoreTool = {
	name: "remember",
	description:
		"Keep a note about the person for next time: something they told you about themselves, what they prefer, what they are working on, or something they asked you to remember. One note per fact.",
	parameters: {
		type: "object",
		properties: {
			name: { type: "string", description: "A short title for the note." },
			content: { type: "string", description: "The note itself, in a sentence or two." }
		},
		required: ["content"],
		additionalProperties: false
	},
	async run(args, ctx) {
		const content = strArg(args, "content", "note", "text")
		if (!content) throw new ToolError("remember needs the note to keep.")
		const name = strArg(args, "name", "title") || content.split(/\s+/).slice(0, 6).join(" ")
		const filed = await fileThrough(ctx, { name, content, entryType: ENTRY_TYPES.note })
		return { ...filed, message: filedSentence(`The note '${name}'`, filed) }
	}
}

export const forget: CoreTool = {
	name: "forget",
	description:
		"Take back a note you kept with remember, by its title — when the person asks you to forget something, or a note is no longer true. Only notes you kept can be forgotten; the person's own entries are never touched.",
	parameters: {
		type: "object",
		properties: { name: { type: "string", description: "The note's title, as remember filed it." } },
		required: ["name"],
		additionalProperties: false
	},
	async run(args, ctx) {
		const name = strArg(args, "name", "title", "note")
		if (!name) throw new ToolError("forget needs the title of the note to take back.")
		if (!ctx.forgetLore) throw new ToolError("nothing can be taken out of a lorebook on this step.")
		const out = await ctx.forgetLore(name)
		if (!out.archived.length)
			throw new ToolError(`there is no note called '${name}' that you kept. Use search_entries to find its title.`)
		return { ...out, message: `The note '${name}' was taken back.` }
	}
}

export const generateImage: CoreTool = {
	name: "generate_image",
	description:
		"Make a picture with the image generator and post it in this conversation. Describe what it should show in plain words: the subject, the setting, the style. It takes a while; use it only when the person wants a picture.",
	parameters: {
		type: "object",
		properties: { prompt: { type: "string", description: "What the picture should show." } },
		required: ["prompt"],
		additionalProperties: false
	},
	async run(args, ctx) {
		const prompt = strArg(args, "prompt", "description", "text")
		if (!prompt) throw new ToolError("generate_image needs a description of the picture.")
		if (!ctx.makeImage) throw new ToolError("pictures cannot be made on this step.")
		const made = await ctx.makeImage(prompt)
		return { ...made, message: "The picture was made and posted in the conversation." }
	}
}

/** The four, in the order an advertisement lists them. */
export const WRITE_TOOLS: CoreTool[] = [writeEntry, remember, forget, generateImage]

/** The tool names that keep notes — offered whenever the session's memory task is on (★K). */
export const MEMORY_TOOL_NAMES: ReadonlySet<string> = new Set(["remember", "forget"])

/** Every tool that files through a host door — never offered by default. */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set(WRITE_TOOLS.map((t) => t.name))

/**
 * 🚧 Which of the filing tools this session may call (lane 2): the ones its
 * `tools` field switched on by kind (`lorebook-write`, `image`), and
 * `remember` / `forget` whenever its *Remember things* routine is not Off (★K). An
 * install-wide "everything" never includes them: a spec that wires no kinds
 * (the Guide's loop) is offered none. The advertisement and the dispatch
 * both ask this, so they cannot disagree.
 */
export async function writeToolsAllowed(db: Db, sessionId: number | null | undefined): Promise<Set<string>> {
	const out = new Set<string>()
	if (typeof sessionId !== "number") return out
	const { genreFieldsFor } = await import("$lib/server/pipelines/entities/sessionGenres")
	const { sessionRoutineMode } = await import("$lib/server/pipelines/routines/sessionRoutines")
	const { ASSISTANT_MEMORY_SPEC_ID } = await import("@serene-pub/core-catalog")
	const { TOOL_KINDS } = await import("./assistantTools")
	// 🚧 *Remember things* is a routine (lane 6, R37): its mode, not a task.
	const [fields, memory] = await Promise.all([
		genreFieldsFor(db, sessionId),
		sessionRoutineMode(db, sessionId, ASSISTANT_MEMORY_SPEC_ID)
	])
	const kinds = Array.isArray(fields.tools) ? fields.tools : []
	for (const kind of kinds)
		for (const name of TOOL_KINDS[String(kind)] ?? []) if (WRITE_TOOL_NAMES.has(name)) out.add(name)
	if (memory && memory !== "off") for (const name of MEMORY_TOOL_NAMES) out.add(name)
	return out
}
