<!--
	🚧 The ruleset fit **audit** (PLAN-genre-restructure §11, ruled 2026-10-19):
	the admin's popout behind a choice's rating — every use the genre names,
	whether the ruleset meets it by its rules, in words, or not at all, which
	uses are optional (never counted), and what the ruleset brings that this
	genre leaves unused. Skeleton Dialog in a Portal (STYLE-GUIDE §6).
-->
<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import type { RulesChoice } from "$lib/shared/rulesets/rulesOffer"

	interface Props {
		open: boolean
		onOpenChange: (e: { open: boolean }) => void
		choice: RulesChoice | null
		genreName: string
	}
	let { open = $bindable(), onOpenChange, choice, genreName }: Props = $props()

	const RATING: Record<string, string> = {
		incompatible: "Incompatible",
		poor: "Poor",
		ok: "Ok",
		good: "Good",
		great: "Great",
		perfect: "Perfect"
	}
	const MET: Record<string, string> = { native: "by its rules", words: "in words", missing: "not at all" }
	const KIND: Record<string, string> = {
		verb: "verb",
		slot: "sheet slot",
		piece: "pieces",
		conditions: "conditions",
		casting: "casting",
		dice: "dice"
	}
	const required = $derived((choice?.fit?.rows ?? []).filter((r) => r.required))
	const optional = $derived((choice?.fit?.rows ?? []).filter((r) => !r.required))
</script>

<Dialog {open} {onOpenChange}>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 max-h-[85vh] w-full max-w-lg space-y-4 overflow-y-auto p-6 shadow-xl" data-testid="rules-fit-audit">
				<header class="flex items-baseline justify-between gap-3">
					<Dialog.Title class="h2">{choice?.name ?? "Ruleset"} with {genreName}</Dialog.Title>
					{#if choice?.fit}
						<span class="text-sm font-medium">{RATING[choice.fit.rating]}</span>
					{/if}
				</header>
				<article class="space-y-4 text-sm">
					{#if choice?.fit}
						<Dialog.Description class="opacity-70">{choice.fit.reason}.</Dialog.Description>
						<section>
							<h3 class="mb-1 text-xs font-semibold uppercase tracking-wide opacity-60">What {genreName} needs</h3>
							{#if required.length}
								<table class="w-full text-left text-chip">
									<tbody>
										{#each required as r (r.kind + r.key)}
											<tr class="border-surface-200-800 border-t">
												<td class="py-1 pr-2">{r.key}</td>
												<td class="py-1 pr-2 opacity-60">{KIND[r.kind] ?? r.kind}</td>
												<td class="py-1" class:text-error-600-400={r.met === "missing"}>{MET[r.met]}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							{:else}
								<p class="opacity-60">Nothing in particular: any ruleset fits.</p>
							{/if}
						</section>
						{#if optional.length}
							<section>
								<h3 class="mb-1 text-xs font-semibold uppercase tracking-wide opacity-60">Optional (never counted)</h3>
								<table class="w-full text-left text-chip">
									<tbody>
										{#each optional as r (r.kind + r.key)}
											<tr class="border-surface-200-800 border-t">
												<td class="py-1 pr-2">{r.key}</td>
												<td class="py-1 pr-2 opacity-60">{KIND[r.kind] ?? r.kind}</td>
												<td class="py-1">{MET[r.met]}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</section>
						{/if}
						{#if choice.fit.unused.length}
							<section>
								<h3 class="mb-1 text-xs font-semibold uppercase tracking-wide opacity-60">Also in the ruleset, unused here</h3>
								<p>{choice.fit.unused.join(", ")}</p>
							</section>
						{/if}
					{:else}
						<Dialog.Description class="opacity-70">This genre says nothing about what it uses, so every ruleset fits as it is.</Dialog.Description>
					{/if}
				</article>
				<footer class="flex justify-end">
					<button type="button" class="btn preset-tonal-surface" onclick={() => onOpenChange({ open: false })}>Close</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
