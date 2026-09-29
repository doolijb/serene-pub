/**
 * The CodeMirror setup the component editor and its core diff share (C6, P6):
 * one language per file kind, the host-element completions, and a theme drawn
 * from the app's colour roles rather than hex (STYLE-GUIDE §1), with the
 * highlight style following the app's light/dark switch (`data-mode`).
 *
 * The Svelte language is `@replit/codemirror-lang-svelte` — its peer ranges
 * are the `@codemirror/*` 6.x the app already has, and on core's own `.svelte`
 * sources it misparses less than `lang-html` (96 error nodes against 136
 * across the 14 files; `{#each}`/`{@const}` blocks read as markup, not text).
 * `lang-html` is installed as its peer and nothing else.
 */
import { Compartment, EditorState, type Extension } from "@codemirror/state"
import {
	EditorView,
	drawSelection,
	highlightActiveLine,
	highlightActiveLineGutter,
	keymap,
	lineNumbers
} from "@codemirror/view"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import {
	bracketMatching,
	defaultHighlightStyle,
	foldGutter,
	indentOnInput,
	syntaxHighlighting
} from "@codemirror/language"
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
import {
	autocompletion,
	closeBrackets,
	closeBracketsKeymap,
	completionKeymap,
	type CompletionContext,
	type CompletionResult
} from "@codemirror/autocomplete"
import { javascript } from "@codemirror/lang-javascript"
import { svelte } from "@replit/codemirror-lang-svelte"
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark"
import { hostCompletions } from "./spCompletions"
import { languageFor, type FileLanguage } from "./componentFiles"

export function languageExtension(lang: FileLanguage): Extension {
	if (lang === "svelte") return svelte()
	return javascript({ typescript: lang === "ts", jsx: false })
}

/** The host-element completion source for one file kind. */
export function hostCompletionSource(lang: FileLanguage) {
	return (ctx: CompletionContext): CompletionResult | null => {
		const from = Math.max(0, ctx.pos - 6000)
		const before = ctx.state.sliceDoc(from, ctx.pos)
		const r = hostCompletions(before, lang)
		if (!r) return null
		// An empty word is offered only when asked (Ctrl-Space) or right after `<`.
		if (r.from + from === ctx.pos && !ctx.explicit && !/[<\s"'`]$/.test(before)) return null
		return { from: r.from + from, options: r.options, validFor: /^[a-zA-Z0-9-]*$/ }
	}
}

const HOST_SOURCES: Record<FileLanguage, { autocomplete: ReturnType<typeof hostCompletionSource> }> = {
	svelte: { autocomplete: hostCompletionSource("svelte") },
	ts: { autocomplete: hostCompletionSource("ts") },
	js: { autocomplete: hostCompletionSource("js") }
}

/** Is the app in dark mode now? */
export const appIsDark = () =>
	typeof document !== "undefined" && document.documentElement.getAttribute("data-mode") !== "light"

export const highlightFor = (dark: boolean): Extension =>
	syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle, { fallback: true })

/** Colours by role: the page's ground, its ink and the gold focus. */
export const editorTheme = EditorView.theme({
	"&": {
		height: "100%",
		fontSize: "13px",
		backgroundColor: "var(--color-surface-50-950, var(--color-surface-950))",
		color: "var(--color-surface-950-50, var(--color-surface-50))"
	},
	"&.cm-focused": { outline: "2px solid var(--color-primary-500)", outlineOffset: "-2px" },
	".cm-scroller": {
		overflow: "auto",
		fontFamily: "'Fira Mono', 'Cascadia Code', 'JetBrains Mono', ui-monospace, monospace"
	},
	".cm-content": { padding: "8px 0", caretColor: "var(--color-primary-500)" },
	".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-primary-500)" },
	".cm-gutters": {
		backgroundColor: "transparent",
		color: "var(--color-surface-500)",
		borderRight: "1px solid var(--color-surface-200-800, var(--color-surface-800))"
	},
	".cm-activeLine, .cm-activeLineGutter": {
		backgroundColor: "color-mix(in oklab, var(--color-surface-500) 10%, transparent)"
	},
	"&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
		backgroundColor: "color-mix(in oklab, var(--color-primary-500) 28%, transparent)"
	},
	".cm-tooltip": {
		backgroundColor: "var(--color-surface-100-900, var(--color-surface-900))",
		border: "1px solid var(--color-surface-200-800, var(--color-surface-800))",
		borderRadius: "8px"
	},
	// The diff's folded stretches (`@codemirror/merge`), in the page's tones
	// rather than its light-only default.
	".cm-collapsedLines": {
		backgroundColor: "var(--color-surface-100-900, var(--color-surface-900))",
		backgroundImage: "none",
		color: "var(--color-surface-600-400, var(--color-surface-400))"
	},
	".cm-tooltip-autocomplete ul li[aria-selected]": {
		backgroundColor: "color-mix(in oklab, var(--color-primary-500) 22%, transparent)",
		color: "inherit"
	}
})

/** Everything but the language, the theme compartment and the per-file listener. */
export function baseExtensions(readOnly: boolean): Extension[] {
	return [
		lineNumbers(),
		highlightActiveLineGutter(),
		foldGutter(),
		drawSelection(),
		history(),
		indentOnInput(),
		bracketMatching(),
		closeBrackets(),
		highlightActiveLine(),
		highlightSelectionMatches(),
		autocompletion(),
		keymap.of([
			...closeBracketsKeymap,
			...defaultKeymap,
			...searchKeymap,
			...historyKeymap,
			...completionKeymap,
			indentWithTab
		]),
		EditorState.tabSize.of(4),
		EditorState.readOnly.of(readOnly),
		EditorView.editable.of(!readOnly),
		editorTheme
	]
}

/** One file's extensions: its language, its completions and the shared base. */
export function fileExtensions(path: string, readOnly: boolean, highlight: Compartment, dark: boolean): Extension[] {
	const lang = languageFor(path)
	return [
		...baseExtensions(readOnly),
		languageExtension(lang),
		// One source object per file kind: autocomplete matches a query's
		// answer to its source by identity, and a fresh function per lookup
		// leaves every query pending for ever.
		EditorState.languageData.of(() => [HOST_SOURCES[lang]]),
		highlight.of(highlightFor(dark))
	]
}
