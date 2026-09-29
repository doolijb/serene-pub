<script lang="ts">
	/**
	 * A clone against core's component as it is today (C6, P6): which files
	 * differ, and one file at a time as a unified diff — core's lines struck
	 * above this component's, read-only — so an admin can see what core
	 * changed since the clone and carry it over by hand.
	 *
	 * "Core today" is `components:coreSource` (the catalog's
	 * `<slug>.source.json`); the clone's `basedOn.sourceHash` is what it was
	 * cloned from. The banner saying core moved is the page's (it shows
	 * whichever tab is open); this pane says it too, beside the list.
	 */
	import { onDestroy, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { EditorState } from "@codemirror/state"
	import { EditorView } from "@codemirror/view"
	import { unifiedMergeView } from "@codemirror/merge"
	import { appIsDark, baseExtensions, highlightFor, languageExtension } from "./cmSetup"
	import { languageFor } from "./componentFiles"
	import { fileDiffList, type CoreDrift } from "./editorState"

	interface Props {
		/** Core's source now; null while it loads or when it could not be read. */
		core: { slug: string; files: Record<string, string>; catalogVersion: string } | null
		files: Record<string, string>
		drift: CoreDrift
		/** Why core's source is missing, when it is. */
		error?: string | null
		/** What the struck side is called (the editor's Last save tab compares a draft with the saved version). */
		otherName?: string
		/** Replaces the sentence about core over the file list. */
		caption?: string
	}

	let { core, files, drift, error = null, otherName = "core", caption }: Props = $props()

	let list = $derived(core ? fileDiffList(core.files, files) : [])
	let picked = $state<string | null>(null)
	let path = $derived(picked && list.some((f) => f.path === picked) ? picked : (list[0]?.path ?? null))
	let host = $state<HTMLDivElement | null>(null)
	let view: EditorView | null = null

	$effect(() => {
		const el = host
		const p = path
		const original = p && core ? (core.files[p] ?? "") : ""
		// This component's text is read untracked: an edit is dispatched into
		// the view below, not a rebuild per keystroke.
		const mine = p ? untrack(() => files[p] ?? "") : ""
		view?.destroy()
		view = null
		if (!el || !p) return
		view = new EditorView({
			parent: el,
			state: EditorState.create({
				doc: mine,
				extensions: [
					...baseExtensions(true),
					languageExtension(languageFor(p)),
					highlightFor(appIsDark()),
					unifiedMergeView({
						original,
						mergeControls: false,
						gutter: true,
						collapseUnchanged: { margin: 3, minSize: 6 }
					}),
					EditorView.contentAttributes.of({ "aria-label": `${p}: ${otherName}'s version struck above this one` })
				]
			})
		})
	})

	$effect(() => {
		const mine = path ? (files[path] ?? "") : ""
		untrack(() => {
			if (!view) return
			const doc = view.state.doc.toString()
			if (doc !== mine) view.dispatch({ changes: { from: 0, to: doc.length, insert: mine } })
		})
	})

	onDestroy(() => view?.destroy())

	let statusText = $derived({ changed: "changed", added: "only here", removed: `only in ${otherName}`, same: "same" } as const)
</script>

<div class="flex h-full min-h-0 flex-col gap-3">
	{#if error}
		<p class="text-error-700-300 text-sm" role="alert">{error}</p>
	{:else if !core}
		<p class="text-surface-600-400 flex items-center gap-2 text-sm" role="status">
			<Icons.LoaderCircle size={14} class="animate-spin" /> Reading core's source…
		</p>
	{:else}
		<p class="text-surface-600-400 text-xs">
			{#if caption}
				{caption}
			{:else if drift === "changed"}
				Core's {core.slug} has changed since this was cloned. Struck lines are core's today; the rest is this component's.
			{:else if drift === "same"}
				Core's {core.slug} is as it was when this was cloned. Struck lines are what you changed from it.
			{:else}
				Compared with core's {core.slug} as it is now ({core.catalogVersion}).
			{/if}
		</p>
		<label class="flex flex-col gap-1 text-xs">
			<span class="text-surface-600-400">File</span>
			<select class="select text-sm" value={path} onchange={(e) => (picked = e.currentTarget.value)}>
				{#each list as f (f.path)}
					<option value={f.path}>{f.path} — {statusText[f.status]}</option>
				{/each}
			</select>
		</label>
		{#if path && list.find((f) => f.path === path)?.status === "same"}
			<p class="text-surface-600-400 text-xs">No difference in this file.</p>
		{/if}
		<div class="border-surface-200-800 min-h-64 flex-1 overflow-auto rounded-[10px] border" bind:this={host}></div>
	{/if}
</div>
