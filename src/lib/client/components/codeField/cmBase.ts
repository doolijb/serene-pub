/**
 * The CodeMirror ground every code field in the app stands on: the keymap,
 * the gutters, search, history and a theme drawn from the app's colour roles
 * rather than hex (STYLE-GUIDE §2, §6.12), with the highlight style following
 * the light/dark switch (`data-mode`).
 *
 * Two editors share it — the component editor's source pane
 * (`componentEditor/cmSetup.ts`, one file per tab) and `CodeField.svelte`
 * (one value: a context template, a variable layout, a script's source). A
 * language, its completions and its lint are each editor's own; nothing here
 * knows what the text is.
 */
import { EditorState, type Extension } from "@codemirror/state"
import {
	EditorView,
	drawSelection,
	highlightActiveLine,
	highlightActiveLineGutter,
	keymap,
	lineNumbers
} from "@codemirror/view"
import {
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab
} from "@codemirror/commands"
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
	completionKeymap
} from "@codemirror/autocomplete"
import { lintKeymap } from "@codemirror/lint"
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark"

/** Is the app in dark mode now? */
export const appIsDark = () =>
	typeof document !== "undefined" &&
	document.documentElement.getAttribute("data-mode") !== "light"

export const highlightFor = (dark: boolean): Extension =>
	syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle, {
		fallback: true
	})

/** Colours by role: the page's ground, its ink and the gold focus. */
export const editorTheme = EditorView.theme({
	"&": {
		height: "100%",
		fontSize: "13px",
		backgroundColor: "var(--color-surface-50-950, var(--color-surface-950))",
		color: "var(--color-surface-950-50, var(--color-surface-50))"
	},
	"&.cm-focused": {
		outline: "2px solid var(--color-primary-500)",
		outlineOffset: "-2px"
	},
	".cm-scroller": {
		overflow: "auto",
		fontFamily:
			"'Fira Mono', 'Cascadia Code', 'JetBrains Mono', ui-monospace, monospace"
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
		borderRadius: "8px",
		color: "var(--color-surface-950-50, var(--color-surface-50))"
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
	},
	".cm-tooltip.cm-completionInfo": {
		padding: "6px 8px",
		maxWidth: "24rem",
		fontSize: "12px"
	},
	".cm-completionDetail": {
		color: "var(--color-surface-600-400, var(--color-surface-400))",
		fontStyle: "normal"
	},
	// Lint: a wave under the text, never a filled highlight (STYLE-GUIDE §6.12).
	".cm-lintRange": {
		backgroundImage: "none",
		backgroundSize: "auto",
		textDecoration: "underline wavy",
		textDecorationSkipInk: "none",
		textUnderlineOffset: "3px"
	},
	".cm-lintRange-error": { textDecorationColor: "var(--color-error-500)" },
	".cm-lintRange-warning": { textDecorationColor: "var(--color-warning-500)" },
	".cm-tooltip-lint": {
		padding: "4px 6px",
		fontSize: "12px"
	},
	".cm-diagnostic": {
		borderLeft: "none",
		padding: "2px 4px"
	},
	".cm-diagnostic-error": {
		borderLeft: "3px solid var(--color-error-500)"
	},
	".cm-diagnostic-warning": {
		borderLeft: "3px solid var(--color-warning-500)"
	},
	".cm-diagnosticAction": {
		backgroundColor: "color-mix(in oklab, var(--color-surface-500) 18%, transparent)",
		color: "inherit",
		borderRadius: "6px",
		padding: "1px 6px"
	},
	".cm-placeholder": {
		color: "var(--color-surface-600-400, var(--color-surface-400))",
		fontStyle: "italic"
	},
	".cm-panels": {
		backgroundColor: "var(--color-surface-100-900, var(--color-surface-900))",
		color: "inherit"
	},
	".cm-panels.cm-panels-bottom": {
		borderTop: "1px solid var(--color-surface-200-800, var(--color-surface-800))"
	},
	".cm-textfield": {
		backgroundColor: "var(--color-surface-50-950, var(--color-surface-950))",
		border: "1px solid var(--color-surface-200-800, var(--color-surface-800))",
		borderRadius: "6px",
		color: "inherit"
	},
	".cm-button": {
		backgroundImage: "none",
		backgroundColor: "color-mix(in oklab, var(--color-surface-500) 18%, transparent)",
		border: "none",
		borderRadius: "6px",
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
			...lintKeymap,
			indentWithTab
		]),
		EditorState.tabSize.of(4),
		EditorState.readOnly.of(readOnly),
		EditorView.editable.of(!readOnly),
		editorTheme
	]
}
