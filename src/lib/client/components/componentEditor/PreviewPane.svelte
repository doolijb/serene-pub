<script lang="ts">
	/**
	 * The editor's preview (C6, P6): the draft, compiled by the server
	 * (`components:preview` → a ten-minute `/component-preview/<token>` URL),
	 * mounted the way a session page mounts a widget — `ComponentMount`, in a
	 * UI worker of its own — but fed fixtures (`previewFixtures.ts`) instead
	 * of a session.
	 *
	 * It runs under the component's own authored owner id, never `core`, so
	 * the invoke gate applies and its element ids are prefixed exactly as they
	 * will be in a session. Only the scoped sections it declares are posted,
	 * as the host would. Requests are answered from fixtures or stubbed, and
	 * actions go nowhere: pressing things in a preview changes nothing.
	 *
	 * A new URL remounts it (`{#key}`) in the same worker.
	 */
	import { setContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import {
		WIDGET_SCOPED_SECTIONS,
		type WidgetBaseSection,
		type WidgetScopedSectionValues,
		type WidgetSectionScope
	} from "@serene-pub/sdk"
	import ComponentMount from "$lib/client/components/host/ComponentMount.svelte"
	import { UNPLACED, WIDGET_REQUESTS_KEY } from "$lib/shared/widgets/context"
	import {
		PREVIEW_MESSAGES,
		PREVIEW_SCOPED,
		PREVIEW_SESSION,
		previewRequestHandler,
		type PreviewRequestNote
	} from "./previewFixtures"

	interface Props {
		/** The compiled draft's URL; null before the first preview or after a failed compile. */
		url: string | null
		/** The authored owner id it runs under (`authored.<id>`). */
		owner: string
		title: string
		/** The scopes it declares, bare. */
		scopes: readonly string[]
		/** The base sections it reads; empty reads all. */
		reads: readonly string[]
		settings?: Record<string, unknown>
		onRuntimeError?: (e: { message: string; stack?: string }) => void
	}

	let { url, owner, title, scopes, reads, settings = {}, onRuntimeError }: Props = $props()

	let notes = $state<PreviewRequestNote[]>([])
	const note = (n: PreviewRequestNote) => {
		notes = [n, ...notes].slice(0, 20)
	}
	setContext(WIDGET_REQUESTS_KEY, previewRequestHandler(note))

	const known = (s: string): s is WidgetSectionScope => Object.hasOwn(WIDGET_SCOPED_SECTIONS, s)
	let grants = $derived(scopes.filter(known))
	let scoped = $derived.by(() => {
		const out: Record<string, unknown> = {}
		for (const scope of grants) {
			const section = WIDGET_SCOPED_SECTIONS[scope]
			const value = (PREVIEW_SCOPED as Record<string, unknown>)[section]
			if (value !== undefined) out[section] = value
		}
		return out as Partial<WidgetScopedSectionValues>
	})
	let baseReads = $derived(reads.length ? (reads as readonly WidgetBaseSection[]) : undefined)

	function onAction(fn: string) {
		note({ kind: `action ${fn}`, answered: "stub", at: Date.now() })
	}
</script>

<div class="flex h-full min-h-0 flex-col gap-2">
	<div class="preview-stage border-surface-200-800 relative min-h-0 flex-1 overflow-hidden rounded-[12px] border">
		{#if url}
			{#key url}
				<ComponentMount
					{owner}
					src={url}
					{title}
					session={PREVIEW_SESSION}
					messages={PREVIEW_MESSAGES}
					{settings}
					{scoped}
					{grants}
					reads={baseReads}
					placement={UNPLACED}
					{onAction}
					{onRuntimeError}
				/>
			{/key}
		{:else}
			<div class="text-surface-600-400 flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm">
				<Icons.Eye size={20} aria-hidden="true" />
				<p>Preview your edits to see them here, fed a made-up session.</p>
			</div>
		{/if}
	</div>
	<p class="text-surface-600-400 text-xs">
		Fixtures: a four-line log, two cast members with stats, three lore entries. Requests and actions are stubbed — nothing is sent.
	</p>
	{#if notes.length}
		<details class="text-xs">
			<summary class="text-surface-600-400 cursor-pointer">{notes.length} request{notes.length === 1 ? "" : "s"} answered here</summary>
			<ul class="mt-1 space-y-0.5 font-mono">
				{#each notes as n}
					<li>{n.kind} — {n.answered === "fixture" ? "from fixtures" : "stubbed"}</li>
				{/each}
			</ul>
		</details>
	{/if}
</div>

<style>
	.preview-stage {
		min-height: 320px;
		background: var(--color-surface-100-900);
	}
</style>
