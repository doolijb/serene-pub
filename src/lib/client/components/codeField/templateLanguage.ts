/**
 * Syntax highlighting for core's two template engines — Handlebars and Liquid
 * — as a CodeMirror stream language.
 *
 * Highlighting only: completion, hover and lint come from `templateAssist` and
 * `templateDiagnostics`, which already read the source with the engine's own
 * rules. This parser's job is the smaller one of telling a tag from the prose
 * around it, so a template reads as code rather than a wall of braces. It is
 * tolerant by design — an unclosed tag colours to the end of the line and no
 * further — because a template being typed is usually not well formed.
 *
 * Token names are the stream parser's legacy style names (`keyword`, `string`,
 * `variableName`, …), each resolved to a highlight tag the app's two highlight
 * styles already colour.
 */
import { StreamLanguage, type StreamParser, type StringStream } from "@codemirror/language"
import {
	CORE_LIQUID_ENGINE,
	CORE_TEMPLATE_ENGINE
} from "$lib/shared/pipelines/templateEngines"

type Tag = "output" | "raw" | "tag" | null

interface State {
	/** The tag the position is inside, if any. */
	in: Tag
	/** Nothing but whitespace seen since the tag opened. */
	atStart: boolean
	/** Inside `{% comment %} … {% endcomment %}`. */
	liquidComment: boolean
}

const HB_KEYWORDS = new Set(["else", "this", "true", "false", "null", "undefined", "as"])
const LIQUID_KEYWORDS = new Set([
	"in",
	"and",
	"or",
	"contains",
	"with",
	"as",
	"else",
	"elsif",
	"when",
	"true",
	"false",
	"nil",
	"null",
	"empty",
	"blank",
	"reversed",
	"limit",
	"offset"
])

function plainText(stream: StringStream, opens: readonly string[]): null {
	// Eat up to the next opener, one character at a time only when an opener
	// starts here (so a lone `{` is prose).
	while (!stream.eol()) {
		if (opens.some((o) => stream.match(o, false))) break
		stream.next()
	}
	return null
}

function inside(stream: StringStream, state: State, liquid: boolean): string | null {
	if (stream.eatSpace()) return null
	const close =
		state.in === "raw" ? "}}}" : state.in === "tag" ? "%}" : "}}"
	if (stream.match(/^~?/) && stream.match(close)) {
		state.in = null
		return "bracket"
	}
	if (stream.match(/^"(?:[^"\\]|\\.)*"?/) || stream.match(/^'(?:[^'\\]|\\.)*'?/))
		return "string"
	if (stream.match(/^-?\d+(?:\.\d+)?/)) return "number"
	if (!liquid && stream.match(/^\[[^\]]*\]?/)) return "propertyName"
	if (liquid && stream.match(/^\[/)) return "bracket"
	if (liquid && stream.match(/^\]/)) return "bracket"
	if (stream.match(/^@[\w.]+/)) return "variableName.special"
	if (!liquid && state.atStart && stream.match(/^[#^/]\s*[\w.-]+/)) {
		state.atStart = false
		return "keyword"
	}
	if (liquid && state.in === "tag" && state.atStart && stream.match(/^[a-zA-Z_]\w*/)) {
		state.atStart = false
		if (stream.current() === "comment") state.liquidComment = true
		return "keyword"
	}
	if (stream.match(/^[A-Za-z_$][\w$-]*(?=\s*=)/)) return "attributeName"
	if (liquid && stream.match(/^\|\s*[a-zA-Z_]\w*/)) return "variableName.function"
	if (stream.match(/^[A-Za-z_$][\w$-]*/)) {
		const word = stream.current()
		const keywords = liquid ? LIQUID_KEYWORDS : HB_KEYWORDS
		if (keywords.has(word)) return "keyword"
		const first = state.atStart
		state.atStart = false
		// A Handlebars tag's first word followed by an argument is a helper.
		if (!liquid && first && stream.match(/^\s+(?=[^}\s])/, false)) return "variableName.function"
		return "variableName"
	}
	if (stream.match(/^[.=|:,]/) || stream.match(/^[=!<>]=|^[<>]/)) return "operator"
	stream.next()
	state.atStart = false
	return null
}

function parserFor(liquid: boolean): StreamParser<State> {
	const opens = liquid ? ["{{", "{%"] : ["{{"]
	return {
		name: liquid ? "liquid" : "handlebars",
		startState: () => ({ in: null, atStart: false, liquidComment: false }),
		copyState: (s) => ({ ...s }),
		token(stream, state) {
			// An unclosed tag does not run past its line.
			if (stream.sol()) state.in = null
			if (state.liquidComment) {
				if (stream.match(/^\{%-?\s*endcomment\s*-?%\}/)) {
					state.liquidComment = false
					return "comment"
				}
				stream.next()
				return "comment"
			}
			if (state.in) return inside(stream, state, liquid)
			if (!liquid && stream.match("{{!--")) {
				// A long comment runs until `--}}`; across lines it is left to
				// the next token call, so the state carries no flag for it:
				// the whole rest of this line is comment either way.
				const end = stream.string.indexOf("--}}", stream.pos)
				if (end === -1) stream.skipToEnd()
				else stream.pos = end + 4
				return "comment"
			}
			if (!liquid && stream.match("{{!")) {
				const end = stream.string.indexOf("}}", stream.pos)
				if (end === -1) stream.skipToEnd()
				else stream.pos = end + 2
				return "comment"
			}
			if (!liquid && stream.match("{{{")) {
				state.in = "raw"
				state.atStart = true
				stream.match(/^~/)
				return "bracket"
			}
			if (liquid && stream.match("{%")) {
				state.in = "tag"
				state.atStart = true
				stream.match(/^-/)
				return "bracket"
			}
			if (stream.match("{{")) {
				state.in = "output"
				state.atStart = true
				stream.match(liquid ? /^-/ : /^~/)
				return "bracket"
			}
			return plainText(stream, opens)
		},
		blankLine(state) {
			state.in = null
		},
		languageData: {
			commentTokens: liquid
				? { block: { open: "{% comment %}", close: "{% endcomment %}" } }
				: { block: { open: "{{!--", close: "--}}" } }
		}
	}
}

export const handlebarsLanguage = StreamLanguage.define(parserFor(false))
export const liquidLanguage = StreamLanguage.define(parserFor(true))

/** The language for an engine id; a plugin's engine gets plain text (`null`). */
export function templateLanguageFor(engine: string | undefined) {
	if (engine === CORE_LIQUID_ENGINE) return liquidLanguage
	if (engine === undefined || engine === CORE_TEMPLATE_ENGINE) return handlebarsLanguage
	return null
}
