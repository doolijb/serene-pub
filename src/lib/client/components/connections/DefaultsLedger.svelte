<script lang="ts">
	/**
	 * Every capability default on this instance, set or not — the index's
	 * `defaults` filter.
	 *
	 * ## Why the whole table and not the matching rows
	 *
	 * The other filters narrow a list of endpoints. This one answers a
	 * different question — "what does this install know how to do" — and the
	 * useful half of that answer is the transforms with NOTHING registered. A
	 * filter that showed only the models a default points at would hide exactly
	 * the rows a person came here to find, so `defaults` replaces the groups
	 * with this ledger rather than filtering them.
	 *
	 * Grouped by OUTPUT KIND, the same headings Admin → Defaults uses, off the
	 * same shared table — a person moving between the two screens is reading
	 * the same seven words.
	 *
	 * ⚠ It states, and sends elsewhere to change. Registering a default is a
	 * costed act for two of these (switching embeddings re-embeds everything),
	 * and a list of ten dropdowns is ten chances to do it by accident. A set row
	 * opens its model; an unset one points at Admin → Defaults.
	 *
	 * ⚠ No sampling on the group header. Admin → Defaults carries one there
	 * because it holds the sampling configs; this view is given the capability
	 * defaults and nothing else, and a sampling line built from an id with no
	 * name to put on it would be a fabrication.
	 */
	import * as Icons from "@lucide/svelte"
	import {
		defaultsSummary,
		groupDefaultsByOutputKind,
		type DefaultState
	} from "./defaultsSummary"
	import type { CapabilityDefaultRef } from "./modelSystemDefaults"

	type Row = Sockets.Connections.List.Row & { id: number }
	type ModelOf = Row["models"][number]

	interface Props {
		rows: Row[]
		capabilityDefaults?: Record<string, CapabilityDefaultRef | undefined>
		onOpenModel: (connection: Row, model: ModelOf) => void
	}
	let { rows, capabilityDefaults = {}, onOpenModel }: Props = $props()

	const summary = $derived(defaultsSummary(rows, capabilityDefaults))
	const groups = $derived(groupDefaultsByOutputKind(summary.entries))

	/**
	 * The one transform a session cannot run without.
	 *
	 * Called out rather than left to look like the other nine: an install with
	 * no `text->text` default has a reply button that fails, and the sentence
	 * for that belongs where a person is already looking at the blank.
	 */
	const CHAT_CAPABILITY = "text->text"

	const DOT_CLASS: Record<DefaultState, string> = {
		ok: "bg-success-500",
		pending: "bg-surface-400-600",
		warning: "bg-warning-500",
		unset: "bg-surface-400-600"
	}
</script>

<div class="flex flex-col gap-4">
	{#each groups as group (group.kind)}
		{@const GroupIcon = (Icons as any)[group.icon] ?? Icons.Boxes}
		<section aria-label={group.label}>
			<header
				class="border-surface-200-700 mb-1.5 flex items-center gap-2 border-b pb-1"
			>
				<GroupIcon size={14} class="shrink-0" aria-hidden="true" />
				<h3 class="min-w-0 flex-1 truncate text-xs font-semibold">
					{group.label}
				</h3>
				<span class="text-muted shrink-0 text-[11px]">
					{group.setCount} of {group.total}
				</span>
			</header>

			<div class="flex flex-col">
				{#each group.entries as entry (entry.capability)}
					{@const unsetChat =
						!entry.set && entry.capability === CHAT_CAPABILITY}
					{#snippet body()}
						<span
							class="preset-tonal-surface mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg"
						>
							<GroupIcon size={14} aria-hidden="true" />
						</span>
						<span class="min-w-0 flex-1">
							<span class="flex items-baseline gap-1.5">
								<span class="truncate text-sm font-medium">
									{entry.label}
								</span>
								<span
									class="text-muted shrink-0 font-mono text-[10px]"
								>
									{entry.capability}
								</span>
							</span>
							{#if entry.set && entry.model}
								<span
									class="text-muted flex items-center gap-1.5 text-[11px]"
								>
									<span
										class="size-1.5 shrink-0 rounded-full {DOT_CLASS[
											entry.state
										]}"
										aria-hidden="true"
									></span>
									<span class="min-w-0 truncate">
										{entry.model.name} · {entry.connection
											?.name ?? "Unknown endpoint"} · {entry.stateWord}
									</span>
								</span>
							{:else if unsetChat}
								<span
									class="text-warning-500 flex items-center gap-1.5 text-[11px]"
								>
									<Icons.TriangleAlert
										size={11}
										class="shrink-0"
										aria-hidden="true"
									/>
									Not set — sessions cannot reply until it is
								</span>
							{:else}
								<span class="text-muted text-[11px]">
									Not set · pick in
									<a
										class="anchor"
										href="/admin/defaults"
										onclick={(e) => e.stopPropagation()}
									>
										Admin → Defaults
									</a>
								</span>
							{/if}
						</span>
					{/snippet}

					{#if entry.set && entry.connection && entry.model}
						<button
							type="button"
							class="hover:preset-tonal-primary focus-visible:ring-primary-500 flex items-start gap-2 rounded-lg px-1.5 py-1.5 text-left focus-visible:ring-2 focus-visible:outline-none"
							onclick={() =>
								onOpenModel(
									entry.connection as Row,
									entry.model as ModelOf
								)}
							aria-label={`Open ${entry.model.name}, the default for ${entry.label}`}
						>
							{@render body()}
							<Icons.ChevronRight
								size={14}
								class="text-muted mt-1.5 shrink-0"
								aria-hidden="true"
							/>
						</button>
					{:else}
						<div
							class="flex items-start gap-2 rounded-lg px-1.5 py-1.5"
						>
							{@render body()}
						</div>
					{/if}
				{/each}
			</div>
		</section>
	{/each}

	<p class="text-muted px-0.5 text-[11px] leading-relaxed">
		A default is an endpoint and a model together, one per transform. Change
		them in <a class="anchor" href="/admin/defaults">Admin → Defaults</a>
		, or from any model's
		<strong class="font-medium">Set as default…</strong>
		. For embeddings and entities that is what
		<strong class="font-medium">Make active</strong>
		does.
	</p>
</div>
