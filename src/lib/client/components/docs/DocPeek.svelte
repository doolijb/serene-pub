<script lang="ts">
	/**
	 * A "?" beside a heading that shows what the documentation says about
	 * the thing in front of you, in place — the section's heading and its
	 * opening prose — with a link to the full guide in Help.
	 *
	 * The in-app half of contextual help. The pages themselves carry only
	 * ordinary `/docs/...` links, which serenepub.com serves as pages and the
	 * app opens in the Help view (`shell/viewLinks.ts`), so nothing here has
	 * to exist on the website.
	 *
	 * `href` comes from a `docsHref` call at the call site, where
	 * `docsHref.test.ts` checks it against the compiled manifest.
	 */
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import {
		getDocMeta,
		loadSearchIndex,
		type DocSection
	} from "$lib/shared/utils/docsIndex"

	interface Props {
		href: string
		/** What the "?" is about, for its accessible name ("About defaults"). */
		topic: string
	}

	let { href, topic }: Props = $props()

	let open = $state(false)
	let section = $state<DocSection | null | undefined>(undefined)

	let target = $derived.by(() => {
		const [path, anchor = ""] = href.split("#")
		return { slug: path.replace(/^\/docs\/?/, ""), anchor }
	})
	let pageTitle = $derived(getDocMeta(target.slug)?.title ?? "Documentation")

	// The index is fetched the first time a peek opens, never before.
	$effect(() => {
		if (!open || section !== undefined) return
		const { slug, anchor } = target
		void loadSearchIndex().then((all) => {
			section =
				all.find(
					(s) =>
						s.slug === slug &&
						(anchor ? s.anchor === anchor : s.depth === 1)
				) ?? null
		})
	})
</script>

<Popover open={open} onOpenChange={(e) => (open = e.open)}>
	<Popover.Trigger
		class="text-surface-600-400 hover:text-surface-950-50 focus-visible:outline-primary-500 grid size-7 shrink-0 place-items-center rounded-full focus-visible:outline-2"
		aria-label={`About ${topic}`}
		title={`About ${topic}`}
	>
		<Icons.CircleHelp size={17} aria-hidden="true" />
	</Popover.Trigger>
	<Portal>
		<Popover.Positioner class="z-[1000]!">
			<Popover.Content
				class="card bg-surface-50-950 border-surface-200-800 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 border p-4 shadow-xl"
			>
				<Popover.Title class="text-surface-600-400 text-xs font-medium">
					{pageTitle}
				</Popover.Title>
				{#if section === undefined}
					<div class="text-surface-600-400 flex justify-center py-4">
						<Icons.Loader2 class="animate-spin" size={18} />
					</div>
				{:else if section}
					<p class="text-surface-950-50 text-sm font-semibold">
						{section.title}
					</p>
					<Popover.Description
						class="text-surface-700-300 line-clamp-6 text-sm leading-relaxed"
					>
						{section.text || section.preview}
					</Popover.Description>
				{:else}
					<Popover.Description class="text-surface-700-300 text-sm">
						The guide for this is in the documentation.
					</Popover.Description>
				{/if}
				<a
					{href}
					class="anchor mt-1 inline-flex items-center gap-1 self-start text-sm"
					onclick={() => (open = false)}
				>
					Read the full guide
					<Icons.ArrowRight size={14} aria-hidden="true" />
				</a>
			</Popover.Content>
		</Popover.Positioner>
	</Portal>
</Popover>
