<script lang="ts">
	/**
	 * ONE connection, as a card — the index's card mode (notes 42, owner
	 * 2026-10-03: the Connections view lists connections, with the defaults
	 * on top and the models inside each connection).
	 *
	 * Same facts as `ConnectionRow`, from the same `RowStatus`, with the room
	 * to say all three things the list is for without one slot standing in
	 * for another: what it IS (the service chip, under the same suppression
	 * rule — a default name already is its service), what state it is in (the
	 * five connection states, one colour each, only `broken` red), and how
	 * many models it holds. A row has to let its action take the metric's
	 * column; a card has a footer for the action, so the count always shows.
	 *
	 * The body is ONE button that opens the connection; the action, when
	 * there is one, is its own button under it — never a button inside a
	 * button. Selection is the card's ring (STYLE-GUIDE §2.4).
	 *
	 * The state wears the row's quiet vocabulary (★R2, 2026-10-24,
	 * `rowStatusClasses`): a 6px dot and 13px muted words, red with a 3px error
	 * edge only when a loadout runs on a broken connection (`status.blocked`).
	 */
	import * as Icons from "@lucide/svelte"
	import {
		rowActionClass,
		rowStatusClasses,
		type RowStatus
	} from "./connectionRowStatus"
	import type { EndpointKind } from "./modelManagement"
	import { connectionTypeIcon, kindIconComponent } from "./connectionTypeIcon"

	interface Props {
		/** What somebody called this connection. */
		title: string
		/** What it is: "KoboldCPP", "Ollama", "OpenRouter", "ONNX". */
		serviceLabel: string
		kind: EndpointKind
		/**
		 * The connection's type, for its brand mark (`connectionTypeIcon`):
		 * Ollama and KoboldCPP rows wear their own logo, the rest the kind's
		 * glyph.
		 */
		type?: string | null
		/** A runtime this pub runs, rather than a host it talks to. */
		managed: boolean
		status: RowStatus
		/** How many models it holds — what the host lists, or what is on disk. */
		modelCount: number
		/** Capability labels this connection's models are the default for. */
		defaultFor?: readonly string[]
		/** The connection open beside the list at desk width. */
		selected?: boolean
		onOpen: () => void
		onAction: (verb: NonNullable<RowStatus["action"]>["verb"]) => void
	}

	let {
		title,
		serviceLabel,
		kind,
		type = null,
		managed,
		status,
		modelCount,
		defaultFor = [],
		selected = false,
		onOpen,
		onAction
	}: Props = $props()

	/** The kind tile's glyph — `ConnectionRow`'s, so a row and a card agree. */
	const KindIcon = $derived(connectionTypeIcon(type, kindIconComponent(kind)))
	const ActionIcon = $derived(
		status.action
			? (((Icons as any)[status.action.icon] as any) ?? Icons.Play)
			: null
	)
	const marks = $derived(rowStatusClasses(status))

	const showChip = $derived(
		!!serviceLabel &&
			serviceLabel.trim().toLowerCase() !== title.trim().toLowerCase()
	)
	const countLabel = $derived(
		`${modelCount} ${modelCount === 1 ? "model" : "models"}`
	)
	/**
	 * Line three: where it is, or what went wrong — and the metric when it
	 * says something the count has not (`7.0 GB`, `idle 4 min`, `45%`).
	 */
	const detailLine = $derived(
		[
			status.detail,
			status.metric && status.metric !== countLabel ? status.metric : null
		]
			.filter(Boolean)
			.join(" · ")
	)
</script>

<div
	class="panel-card flex min-w-0 flex-1 flex-col !p-0 {selected
		? 'ring-primary-500 ring-2'
		: ''} {marks.edge}"
	data-connection-card
	data-row-blocked={status.blocked ? "" : undefined}
>
	<button
		type="button"
		class="focus-visible:ring-primary-500 flex min-w-0 flex-1 flex-col gap-2 rounded-container p-3 text-left focus-visible:ring-2 focus-visible:outline-none {selected
			? ''
			: 'hover:bg-surface-200-800'}"
		aria-current={selected ? "true" : undefined}
		onclick={onOpen}
	>
		<span class="flex min-w-0 items-center gap-2.5">
			<span
				class="preset-tonal-surface grid size-8 shrink-0 place-items-center rounded-lg"
				aria-hidden="true"
			>
				<KindIcon size={16} />
			</span>
			<span class="min-w-0 flex-1">
				<span class="block truncate text-lead font-medium">
					{title}
				</span>
				{#if showChip}
					<span
						class="mt-0.5 inline-block max-w-full truncate rounded-full px-1.5 py-0.5 align-middle text-meta {managed
							? 'preset-tonal-tertiary'
							: 'border-surface-300-700 text-surface-600-400 border'}"
					>
						{serviceLabel}
					</span>
				{/if}
			</span>
		</span>

		<span class="flex min-w-0 items-center gap-2">
			<span
				class="flex min-w-0 items-center gap-1.5 text-chip {marks.text}"
			>
				<span
					class="size-1.5 shrink-0 rounded-full {marks.dot}"
					aria-hidden="true"
				></span>
				<span class="truncate">{status.label}</span>
			</span>
			<span class="flex-1"></span>
			<!-- Muted, not quiet: the count is a fact the reader came for. -->
			<span
				class="text-surface-600-400 flex shrink-0 items-center gap-1 text-xs"
			>
				<Icons.Boxes size={12} aria-hidden="true" />
				{countLabel}
			</span>
		</span>

		{#if detailLine}
			<span
				class="text-surface-600-400 block truncate text-xs"
				title={detailLine}
			>
				{detailLine}
			</span>
		{/if}

		{#if defaultFor.length}
			<span class="flex min-w-0 flex-wrap items-center gap-1">
				{#each defaultFor as capability (capability)}
					<span
						class="preset-tonal-primary text-primary-ink flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-meta font-bold"
					>
						<Icons.Star
							size={8}
							fill="currentColor"
							aria-hidden="true"
						/>
						{capability}
					</span>
				{/each}
			</span>
		{/if}
	</button>

	{#if status.action && ActionIcon}
		<div class="flex px-3 pb-3">
			<button
				type="button"
				class="btn btn-sm text-xs {rowActionClass(status.action.emphasis)}"
				onclick={() => onAction(status.action!.verb)}
				aria-label={`${status.action.label} — ${title}`}
			>
				<ActionIcon size={14} aria-hidden="true" />
				{status.action.label}
			</button>
		</div>
	{/if}
</div>
