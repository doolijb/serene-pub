<script lang="ts">
	/**
	 * A code field: one CodeMirror view over one value — a context template,
	 * a variable layout, a script's source (STYLE-GUIDE §6.12).
	 *
	 * The field knows nothing about what the text is. Its caller passes the
	 * language, completion and lint as `extensions` and owns the value: an
	 * edit is reported with `oninput`, and when the caller's `value` stops
	 * matching the document (a reload, a revert, a fix applied from outside)
	 * the document is replaced in place, keeping the undo history.
	 *
	 * The caret and focus are reported too (`oncursor`, `onfocuschange`), so
	 * a caller can draw its own help — a hover line, an issue list — under the
	 * field without reaching into the view. What a caller may do to the view
	 * is the exported handful below: replace a range, put the caret somewhere,
	 * read the selection, re-run the lint.
	 */
	import { onDestroy, onMount, untrack } from "svelte"
	import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state"
	import { EditorView, placeholder as cmPlaceholder } from "@codemirror/view"
	import { forceLinting } from "@codemirror/lint"
	import { appIsDark, baseExtensions, highlightFor } from "./cmBase"

	interface Props {
		value: string
		oninput?: (value: string) => void
		readonly?: boolean
		/** The field's starting height, in lines; it grows with the text. */
		rows?: number
		/** The accessible name, when no wrapping `<label>` provides one. */
		label?: string
		/** The content element's id, so a form's `<label for>` reaches it. */
		id?: string
		/** Shown over an empty document. */
		placeholder?: string
		/** The language, its completions, its lint — everything beyond the base. */
		extensions?: Extension
		/** Ids of the elements that describe the field (an issue list). */
		describedBy?: string
		invalid?: boolean
		oncursor?: (pos: number) => void
		onfocuschange?: (focused: boolean) => void
	}

	let {
		value,
		oninput,
		readonly = false,
		rows = 8,
		label,
		id,
		placeholder,
		extensions,
		describedBy,
		invalid = false,
		oncursor,
		onfocuschange
	}: Props = $props()

	let host = $state<HTMLDivElement | null>(null)
	let view: EditorView | null = null
	const highlight = new Compartment()
	const extra = new Compartment()
	const access = new Compartment()
	let dark = appIsDark()

	/** The attributes the content element carries: its name and its state. */
	function accessAttrs(): Record<string, string> {
		const attrs: Record<string, string> = {}
		if (id) attrs.id = id
		if (label) attrs["aria-label"] = label
		if (describedBy) attrs["aria-describedby"] = describedBy
		if (invalid) attrs["aria-invalid"] = "true"
		return attrs
	}

	function extraExtensions(): Extension[] {
		const out: Extension[] = [...baseExtensions(readonly)]
		if (extensions) out.push(extensions)
		if (placeholder) out.push(cmPlaceholder(placeholder))
		return out
	}

	onMount(() => {
		if (!host) return
		view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: value,
				extensions: [
					extra.of(extraExtensions()),
					access.of(EditorView.contentAttributes.of(accessAttrs())),
					highlight.of(highlightFor(dark)),
					EditorView.updateListener.of((u) => {
						if (u.docChanged) oninput?.(u.state.doc.toString())
						if (u.selectionSet || u.docChanged) oncursor?.(u.state.selection.main.head)
						if (u.focusChanged) onfocuschange?.(u.view.hasFocus)
					})
				]
			})
		})
		// The highlight follows the app's light/dark switch.
		const mo = new MutationObserver(() => {
			const next = appIsDark()
			if (next === dark || !view) return
			dark = next
			view.dispatch({ effects: highlight.reconfigure(highlightFor(dark)) })
		})
		mo.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-mode"]
		})
		return () => mo.disconnect()
	})

	onDestroy(() => {
		view?.destroy()
		view = null
	})

	// The caller's value moved without us: replace the document, keep history.
	$effect(() => {
		const next = value
		untrack(() => {
			if (!view) return
			const current = view.state.doc.toString()
			if (current === next) return
			const head = Math.min(view.state.selection.main.head, next.length)
			view.dispatch({
				changes: { from: 0, to: current.length, insert: next },
				selection: EditorSelection.cursor(head)
			})
		})
	})

	// Language, lint, read-only or placeholder changed: reconfigure in place.
	$effect(() => {
		void extensions
		void readonly
		void placeholder
		untrack(() => {
			if (!view) return
			view.dispatch({ effects: extra.reconfigure(extraExtensions()) })
		})
	})

	$effect(() => {
		void label
		void id
		void describedBy
		void invalid
		untrack(() => {
			if (!view) return
			view.dispatch({
				effects: access.reconfigure(EditorView.contentAttributes.of(accessAttrs()))
			})
		})
	})

	/* ── what a caller may do to the view ─────────────────────────────── */

	/** Replace `[from, to)` and leave the caret (or a selection) after. */
	export function replace(
		from: number,
		to: number,
		insert: string,
		select?: { start: number; end: number }
	) {
		if (!view) return
		const len = view.state.doc.length
		const a = Math.min(from, len)
		const b = Math.min(Math.max(to, a), len)
		const anchor = a + (select ? select.start : insert.length)
		const head = a + (select ? select.end : insert.length)
		view.dispatch({
			changes: { from: a, to: b, insert },
			selection: { anchor, head },
			scrollIntoView: true
		})
		view.focus()
	}

	/** Put the caret at `pos`, scrolled into view and focused. */
	export function focusAt(pos: number) {
		if (!view) return
		const at = Math.min(Math.max(0, pos), view.state.doc.length)
		view.dispatch({
			selection: EditorSelection.cursor(at),
			effects: EditorView.scrollIntoView(at, { y: "center" })
		})
		view.focus()
	}

	/** The main selection, as offsets. */
	export function selection(): { from: number; to: number } {
		if (!view) return { from: 0, to: 0 }
		const { from, to } = view.state.selection.main
		return { from, to }
	}

	/** Run the lint now rather than after its delay. */
	export function relint() {
		if (view) forceLinting(view)
	}

	/** The view itself, for a test or a keymap that needs it. */
	export function editor(): EditorView | null {
		return view
	}
</script>

<div
	bind:this={host}
	class="code-field border-surface-200-800 bg-surface-50-950 min-w-0 overflow-hidden rounded-base border"
	style="--code-field-rows: {rows}"
></div>

<style>
	/* The field starts at `rows` lines and grows with the text, scrolling
	   inside once it would outgrow the page. Written as CSS rather than in the
	   shared theme because the component editor's pane fills its box instead. */
	.code-field :global(.cm-editor) {
		height: auto;
		min-height: calc(var(--code-field-rows) * 1.5em + 16px);
		max-height: 70vh;
	}
	.code-field :global(.cm-scroller) {
		min-height: calc(var(--code-field-rows) * 1.5em + 16px);
		max-height: 70vh;
	}
	.code-field :global(.cm-editor.cm-focused) {
		outline: none;
	}
	.code-field:has(:global(.cm-editor.cm-focused)) {
		outline: 2px solid var(--color-primary-500);
		outline-offset: -1px;
	}
</style>
