<script lang="ts">
	/**
	 * ONE connection, as one row in the index.
	 *
	 * It replaces `ConnectionCard`, which was a card per endpoint with its
	 * models listed inside it. Models left the index with the 2026-09-17
	 * concept ruling (R1), and what is left of a connection is small enough to
	 * be a row: where the compute is, what it is doing right now, and the one
	 * thing to press about it.
	 *
	 * ## Title and service chip travel together
	 *
	 * Ruling R5: every connection surface shows both. The title is what
	 * somebody called it, which may be anything at all; the chip is what it
	 * actually IS — teal for a runtime this pub manages, outlined for a host it
	 * merely talks to. A title alone answers "which one is this" and never
	 * "what is it", and two rows called "Local" are then indistinguishable.
	 *
	 * ## One dot, one line, at most one button
	 *
	 * The sentence and the button both come from `connectionRowStatus`, which
	 * is where the five status slots the card used to have were collapsed into
	 * one line per kind. The ROW opens the connection; the button is a separate
	 * target beside it, never nested inside it.
	 */
	import * as Icons from "@lucide/svelte"
	import type { RowStatus } from "./connectionRowStatus"
	import type { EndpointKind } from "./modelManagement"

	interface Props {
		/** What somebody called this connection. */
		title: string
		/** What it is: "KoboldCPP", "Ollama", "OpenRouter", "ONNX". */
		serviceLabel: string
		kind: EndpointKind
		/** A runtime this pub runs, rather than a host it talks to. */
		managed: boolean
		status: RowStatus
		/** The list-beside-detail selection at desk width. */
		selected?: boolean
		onOpen: () => void
		onAction: (verb: NonNullable<RowStatus["action"]>["verb"]) => void
	}
	let {
		title,
		serviceLabel,
		kind,
		managed,
		status,
		selected = false,
		onOpen,
		onAction
	}: Props = $props()

	/**
	 * The mark for where the compute is.
	 *
	 * The two local ONNX kinds keep the glyph their MODALITY already owns
	 * (NOMENCLATURE §22: embeddings `Zap`, entities `ScanText`) rather than a
	 * generic "on this machine" one — those two rows are the only ones in the
	 * list whose whole identity is the modality.
	 */
	const KIND_ICON: Record<EndpointKind, string> = {
		"koboldcpp-managed": "Cpu",
		ollama: "Server",
		"onnx-embeddings": "Zap",
		"onnx-entities": "ScanText",
		api: "Cloud"
	}
	const KindIcon = $derived(
		((Icons as any)[KIND_ICON[kind]] as any) ?? Icons.Cable
	)
	const ActionIcon = $derived(
		status.action
			? (((Icons as any)[status.action.icon] as any) ?? Icons.Play)
			: null
	)

	const DOT: Record<RowStatus["dot"], string> = {
		ok: "bg-success-500",
		pending: "bg-warning-500 animate-pulse",
		warning: "bg-warning-500",
		error: "bg-error-500",
		quiet: "bg-surface-400-600"
	}
	const TILE: Record<RowStatus["dot"], string> = {
		ok: "preset-tonal-success",
		pending: "preset-tonal-warning",
		warning: "preset-tonal-warning",
		error: "preset-tonal-error",
		quiet: "preset-tonal-surface"
	}
</script>

<div
	class="flex min-h-11 items-center gap-2 rounded-[10px] {selected
		? 'sidebar-row-active'
		: ''}"
>
	<button
		type="button"
		class="focus-visible:ring-primary-500 flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left focus-visible:ring-2 focus-visible:outline-none {selected
			? ''
			: 'hover:preset-tonal-primary'}"
		aria-current={selected ? "true" : undefined}
		onclick={onOpen}
	>
		<span
			class="grid size-8 shrink-0 place-items-center rounded-lg {TILE[
				status.dot
			]}"
			aria-hidden="true"
		>
			<KindIcon size={16} />
		</span>
		<span class="min-w-0 flex-1">
			<span class="flex min-w-0 items-center gap-1.5">
				<span class="min-w-0 truncate text-[15px] font-medium">
					{title}
				</span>
				<!-- Teal for a runtime this pub manages, outlined for a host it
				     talks to. Never one without the other (R5). -->
				<span
					class="shrink-0 rounded-full px-1.5 py-0.5 text-[11px] {managed
						? 'preset-tonal-tertiary'
						: 'border-surface-300-700 text-surface-600-400 border'}"
				>
					{serviceLabel}
				</span>
			</span>
			<span
				class="text-surface-600-400 flex min-w-0 items-center gap-1.5 text-xs"
			>
				<span
					class="size-1.5 shrink-0 rounded-full {DOT[status.dot]}"
					aria-hidden="true"
				></span>
				<span class="min-w-0 truncate">{status.sentence}</span>
			</span>
		</span>
		{#if !status.action}
			<Icons.ChevronRight
				size={16}
				class="text-surface-500 shrink-0"
				aria-hidden="true"
			/>
		{/if}
	</button>
	{#if status.action && ActionIcon}
		<button
			type="button"
			class="btn btn-sm mr-1 shrink-0 text-xs {status.action.emphasis ===
			'tonal'
				? 'preset-tonal-surface'
				: 'hover:preset-tonal-surface text-surface-600-400'}"
			onclick={() => onAction(status.action!.verb)}
			aria-label={`${status.action.label} — ${title}`}
		>
			<ActionIcon size={14} aria-hidden="true" />
			{status.action.label}
		</button>
	{/if}
</div>
