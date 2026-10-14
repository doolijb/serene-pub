/**
 * The CodeMirror setup the component editor and its core diff share (C6, P6):
 * one language per file kind and the host-element completions, over the
 * theme and keymap every code field shares (`codeField/cmBase.ts`).
 *
 * The Svelte language is `@replit/codemirror-lang-svelte` — its peer ranges
 * are the `@codemirror/*` 6.x the app already has, and on core's own `.svelte`
 * sources it misparses less than `lang-html` (96 error nodes against 136
 * across the 14 files; `{#each}`/`{@const}` blocks read as markup, not text).
 * `lang-html` is installed as its peer and nothing else.
 */
import { Compartment, EditorState, type Extension } from "@codemirror/state"
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete"
import { javascript } from "@codemirror/lang-javascript"
import { svelte } from "@replit/codemirror-lang-svelte"
import { hostCompletions } from "./spCompletions"
import { languageFor, type FileLanguage } from "./componentFiles"
// The ground both editors share lives in `codeField/cmBase.ts`; re-exported so
// the source pane keeps its imports.
import { appIsDark, baseExtensions, editorTheme, highlightFor } from "../codeField/cmBase"

export { appIsDark, baseExtensions, editorTheme, highlightFor }

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
