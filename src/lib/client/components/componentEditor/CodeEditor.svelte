<script lang="ts">
	/**
	 * The component editor's source pane (C6, P6): one CodeMirror view over
	 * an authored component's files, one tab per file.
	 *
	 * Each file keeps its own editor state (its undo history and cursor), so
	 * switching tabs is a `setState`, never a re-parse from text. An edit is
	 * reported with `onedit`; the parent owns the draft. When the parent's
	 * text for a file stops matching the state here — a reload after a
	 * conflict, a revert — that file's state is rebuilt from the parent's.
	 *
	 * Adding, renaming and deleting files is held to the compiler's path
	 * rules (`componentFiles.ts`) before anything is sent; the server checks
	 * again on save. The entry cannot be deleted.
	 */
	import { onDestroy, onMount, tick, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Compartment, EditorSelection, EditorState } from "@codemirror/state"
	import { EditorView } from "@codemirror/view"
	import { appIsDark, fileExtensions, highlightFor } from "./cmSetup"
	import {
		deleteFileProblem,
		fileOrder,
		filePathProblem,
		newFileText,
		renameFile,
		tabLabels
	} from "./componentFiles"

	interface Props {
		files: Record<string, string>
		entry: string
		/** The file shown. Bindable. */
		active: string
		readOnly?: boolean
		/** Names the tab list and the editor: "Stats files". */
		label: string
		onedit?: (path: string, text: string) => void
		/** A file was added, renamed or deleted: the new set and entry. */
		onfiles?: (files: Record<string, string>, entry: string, active: string) => void
	}

	let {
		files,
		entry,
		active = $bindable(),
		readOnly = false,
		label,
		onedit,
		onfiles
	}: Props = $props()

	let host = $state<HTMLDivElement | null>(null)
	let view: EditorView | null = null
	const states = new Map<string, EditorState>()
	const highlight = new Compartment()
	let dark = appIsDark()
	let shown: string | null = null

	let order = $derived(fileOrder(files, entry))
	let labels = $derived(tabLabels(order))

	function stateFor(path: string): EditorState {
		let s = states.get(path)
		if (!s) {
			s = EditorState.create({
				doc: files[path] ?? "",
				extensions: [
					...fileExtensions(path, readOnly, highlight, dark),
					EditorView.updateListener.of((u) => {
						if (u.docChanged) onedit?.(path, u.state.doc.toString())
					}),
					EditorView.contentAttributes.of({ "aria-label": `${path} source` })
				]
			})
			states.set(path, s)
		}
		return s
	}

	function show(path: string) {
		if (!view || !Object.hasOwn(files, path)) return
		if (shown && shown !== path && states.has(shown)) states.set(shown, view.state)
		if (shown === path) return
		view.setState(stateFor(path))
		shown = path
	}

	onMount(() => {
		if (!host) return
		const first = Object.hasOwn(files, active) ? active : order[0]
		if (!first) return
		view = new EditorView({ state: stateFor(first), parent: host })
		shown = first
		if (active !== first) active = first
		// The highlight follows the app's light/dark switch.
		const mo = new MutationObserver(() => {
			const next = appIsDark()
			if (next === dark || !view) return
			dark = next
			view.dispatch({ effects: highlight.reconfigure(highlightFor(dark)) })
			// Parked states pick it up when shown: rebuild them lazily.
			for (const [p] of states) if (p !== shown) states.delete(p)
		})
		mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode"] })
		return () => mo.disconnect()
	})

	onDestroy(() => {
		view?.destroy()
		view = null
	})

	// The tab picked → its state.
	$effect(() => {
		const path = active
		untrack(() => show(path))
	})

	// The parent's text moved without us (reload, revert): rebuild what differs.
	$effect(() => {
		const current = { ...files }
		untrack(() => {
			if (!view) return
			if (shown) states.set(shown, view.state)
			for (const [path, s] of [...states]) {
				if (!Object.hasOwn(current, path)) {
					states.delete(path)
					continue
				}
				if (s.doc.toString() !== current[path]) {
					states.delete(path)
					if (path === shown) {
						shown = null
						show(path)
					}
				}
			}
			if (!Object.hasOwn(current, active)) active = fileOrder(current, entry)[0] ?? ""
		})
	})

	/** Put the cursor at `offset` in `file`, scrolled into view and focused. */
	export async function jumpTo(file: string, offset: number) {
		if (!Object.hasOwn(files, file)) return
		active = file
		await tick()
		show(file)
		if (!view) return
		const at = Math.min(Math.max(0, offset), view.state.doc.length)
		view.dispatch({
			selection: EditorSelection.cursor(at),
			effects: EditorView.scrollIntoView(at, { y: "center" })
		})
		view.focus()
	}

	/* ── adding, renaming, deleting files ─────────────────────────────── */

	let naming = $state<null | { mode: "add" | "rename"; from?: string; value: string }>(null)
	let problem = $derived(
		naming ? filePathProblem(naming.value, files, naming.mode === "rename" ? naming.from : undefined) : null
	)
	let nameInput = $state<HTMLInputElement | null>(null)
	let deleteRefusal = $state<string | null>(null)

	async function startAdd() {
		deleteRefusal = null
		const dir = active.includes("/") ? active.slice(0, active.lastIndexOf("/") + 1) : ""
		naming = { mode: "add", value: `${dir}New.svelte` }
		await tick()
		nameInput?.focus()
		nameInput?.setSelectionRange(dir.length, dir.length + 3)
	}

	async function startRename() {
		deleteRefusal = null
		naming = { mode: "rename", from: active, value: active }
		await tick()
		nameInput?.focus()
		nameInput?.select()
	}

	function commitName(e?: Event) {
		e?.preventDefault()
		if (!naming || problem) return
		const path = naming.value
		if (naming.mode === "add") {
			const next = { ...files, [path]: newFileText(path) }
			naming = null
			onfiles?.(next, entry, path)
			return
		}
		const from = naming.from!
		naming = null
		if (from === path) return
		// A state knows its file's path (its language, its label, where its
		// edits are filed), so the renamed file starts a fresh one from the
		// same text; its undo history does not follow it.
		const text = view && shown === from ? view.state.doc.toString() : files[from]!
		states.delete(from)
		if (shown === from) shown = null
		const r = renameFile({ ...files, [from]: text }, entry, from, path)
		onfiles?.(r.files, r.entry, path)
	}

	function removeActive() {
		naming = null
		const path = active
		const why = deleteFileProblem(path, files, entry)
		if (why) {
			deleteRefusal = why
			return
		}
		deleteRefusal = null
		if (!confirm(`Delete ${path}? Its text is gone once you save.`)) return
		const next = { ...files }
		delete next[path]
		states.delete(path)
		if (shown === path) shown = null
		onfiles?.(next, entry, fileOrder(next, entry)[0] ?? "")
	}

	/* ── the tab list's keyboard ───────────────────────────────────────── */

	let tabRefs: Record<string, HTMLButtonElement | null> = $state({})

	function onTabKey(e: KeyboardEvent, i: number) {
		const n = order.length
		const to =
			e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1
		if (to < 0) return
		e.preventDefault()
		active = order[to]!
		tabRefs[order[to]!]?.focus()
	}
</script>

<div class="code-editor flex h-full min-h-0 flex-col gap-2">
	<div class="flex flex-wrap items-center gap-1">
		<div role="tablist" aria-label={label} class="flex min-w-0 flex-1 flex-wrap gap-1">
			{#each order as path, i (path)}
				<button
					bind:this={tabRefs[path]}
					type="button"
					role="tab"
					id="component-file-{i}-tab"
					aria-selected={active === path}
					aria-controls="component-file-panel"
					tabindex={active === path ? 0 : -1}
					class="file-tab"
					class:file-tab-active={active === path}
					onclick={() => (active = path)}
					onkeydown={(e) => onTabKey(e, i)}
					title={path === entry ? `${path} — the entry` : path}
				>
					{#if path === entry}<Icons.Play size={12} aria-hidden="true" />{/if}
					<span class="truncate font-mono">{labels[path] ?? path}</span>
				</button>
			{/each}
		</div>
		{#if !readOnly}
			<button type="button" class="btn btn-sm preset-tonal-surface" onclick={startAdd}>
				<Icons.FilePlus size={14} /> New file
			</button>
			<button type="button" class="btn-icon btn-icon-sm preset-tonal-surface" aria-label="Rename {active}" title="Rename {active}" onclick={startRename}>
				<Icons.PencilLine size={14} />
			</button>
			<button type="button" class="btn-icon btn-icon-sm preset-tonal-surface" aria-label="Delete {active}" title="Delete {active}" onclick={removeActive}>
				<Icons.Trash2 size={14} />
			</button>
		{/if}
	</div>

	{#if naming}
		<form class="flex flex-wrap items-start gap-2" onsubmit={commitName}>
			<label class="flex min-w-56 flex-1 flex-col gap-1 text-xs">
				<span class="text-surface-600-400">{naming.mode === "add" ? "New file's path" : `Rename ${naming.from} to`}</span>
				<input
					bind:this={nameInput}
					class="input font-mono text-sm"
					bind:value={naming.value}
					aria-invalid={!!problem}
					aria-describedby="component-file-name-problem"
					spellcheck="false"
					onkeydown={(e) => {
						if (e.key === "Escape") naming = null
					}}
				/>
				<span id="component-file-name-problem" class="text-error-700-300 min-h-4" aria-live="polite">{problem ?? ""}</span>
			</label>
			<div class="flex gap-2 pt-5">
				<button type="submit" class="btn btn-sm preset-filled-primary-500" disabled={!!problem}>
					{naming.mode === "add" ? "Add" : "Rename"}
				</button>
				<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => (naming = null)}>Cancel</button>
			</div>
		</form>
	{/if}
	{#if deleteRefusal}
		<p class="text-warning-700-300 text-xs" role="status">{deleteRefusal}</p>
	{/if}

	<div
		id="component-file-panel"
		role="tabpanel"
		aria-labelledby="component-file-{order.indexOf(active)}-tab"
		class="border-surface-200-800 min-h-0 flex-1 overflow-hidden rounded-[10px] border"
		bind:this={host}
	></div>
</div>

<style>
	.file-tab {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		max-width: 16rem;
		min-height: 32px;
		padding: 0 10px;
		border-radius: 8px;
		font-size: 13px;
		color: var(--color-surface-700-300);
	}
	.file-tab:hover {
		background: color-mix(in oklab, var(--color-surface-500) 12%, transparent);
	}
	.file-tab:focus-visible {
		outline: 2px solid var(--color-primary-500);
		outline-offset: 2px;
	}
	/* Selection is tonal plus a bar (STYLE-GUIDE §1.5). */
	.file-tab-active {
		background: color-mix(in oklab, var(--color-primary-500) 14%, transparent);
		box-shadow: inset 0 -2px 0 var(--color-primary-500);
		color: var(--color-surface-950-50);
	}
	@media (pointer: coarse) {
		.file-tab {
			min-height: 44px;
		}
	}
</style>
