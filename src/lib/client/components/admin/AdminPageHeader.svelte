<script lang="ts">
	/**
	 * The one header every admin section wears (STYLE-GUIDE §6.11): a 24px
	 * Display title, one sentence saying what the section decides, and at most
	 * one filled primary among its actions. The group name is never repeated
	 * in the title; the breadcrumb trail above it (`AdminBreadcrumbs`, Django's
	 * breadcrumbs) says where you are, on every admin page.
	 */
	import type { Snippet } from "svelte"
	import DocPeek from "$lib/client/components/docs/DocPeek.svelte"
	import AdminBreadcrumbs from "./AdminBreadcrumbs.svelte"
	import type { AdminCrumb } from "./breadcrumbs"

	interface Props {
		title: string
		/** One sentence, in the reader's words. */
		purpose?: string
		/** Buttons on the right; one filled primary at most. */
		actions?: Snippet
		/** Extra content under the purpose line (a status strip, chips). */
		children?: Snippet
		/** The guide for this section, as `docsHref(...)`: a "?" peek. */
		doc?: string
		/** Steps between the section and this page (an object, then "Delete"). */
		trail?: readonly AdminCrumb[]
		/** The last crumb, when it should not be the title ("Delete"). */
		crumb?: string
		/** With `crumb` on the section's own address: what its crumb does (back). */
		sectionOnclick?: () => void
	}

	let { title, purpose, actions, children, doc, trail, crumb, sectionOnclick }: Props = $props()
</script>

<AdminBreadcrumbs current={title} leaf={crumb} {trail} {sectionOnclick} />
<header class="mb-5 flex flex-col gap-3">
	<div class="flex flex-wrap items-end gap-3">
		<!-- Basis 16rem, not 0: in the 400px dock the actions wrap under the
		     title instead of squeezing the purpose to a word a line. -->
		<div class="min-w-0 flex-[1_1_16rem]">
			<div class="flex items-center gap-1.5">
				<h1
					class="text-surface-950-50 [font-family:var(--typo-heading--font-family)] text-2xl font-semibold tracking-[-0.01em]"
				>
					{title}
				</h1>
				{#if doc}
					<DocPeek href={doc} topic={title} />
				{/if}
			</div>
			{#if purpose}
				<p class="text-surface-600-400 mt-1 max-w-[72ch] text-sm">
					{purpose}
				</p>
			{/if}
		</div>
		{#if actions}
			<div class="flex shrink-0 flex-wrap items-center gap-2">
				{@render actions()}
			</div>
		{/if}
	</div>
	{@render children?.()}
</header>
