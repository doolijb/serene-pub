<script lang="ts">
	/**
	 * ONE connection, as one row in the index.
	 *
	 * ## Slots, not a sentence
	 *
	 * A `·`-joined status line truncates from the right in a 400px column —
	 * where the fact is (`9 models · api.anthropic.com · checked 2 min…`).
	 * So the row is a grid of four fixed slots, filled by
	 * `connectionRowStatus` and composed by nobody:
	 *
	 *     ▣  Anthropic          ● Ready
	 *        api.anthropic.com    9 models
	 *
	 * Name and `detail` on the left, state chip and `metric` right-aligned in a
	 * fixed-width column. The eye runs down the state column instead of reading
	 * four sentences, and the widths are the reason nothing is cut.
	 *
	 * ## The service chip appears only when it says something
	 *
	 * Ruling R5 (2026-09-17) put the title and a service chip on every
	 * connection surface, on the grounds that a title alone never answers "what
	 * is it". True — except that a connection's DEFAULT name *is* its service
	 * label, which every one created through the New connection dialog carries.
	 * The shipped index read `Anthropic (Claude)` beside a chip saying
	 * `Anthropic (Claude)`, `Ollama` beside `Ollama`, `OpenRouter` beside
	 * `OpenRouter` — four rows, four self-repetitions, in the narrowest column
	 * in the app. Amended 2026-09-23: the chip is shown when it differs from the
	 * title and suppressed when it would only repeat it. Rename a connection to
	 * "Local" and the chip comes back, which is the case R5 was defending.
	 *
	 * ## The state chip carries the colour; the tile does not
	 *
	 * The kind tile says WHERE the compute is and is tinted by kind, not by
	 * health — a tile that changed colour with status made every row a traffic
	 * light and left nowhere calm for the eye to rest.
	 *
	 * ## The DOT carries the colour; the words stay muted (★R2, 2026-10-24)
	 *
	 * A state is a 6px dot and 13px muted words (`rowStatusClasses`): "Stopped ·
	 * 1 on disk", "Not reachable · 127.0.0.1:11434". Red words, a red dot and a
	 * 3px error bar mean one thing — a loadout runs on this broken connection
	 * (`status.blocked`, the Admin Needs you case). Fix is tonal surface but on
	 * that row; Start is filled on the row that can start (`rowActionClass`).
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
		/**
		 * Capability labels this connection's models serve as the instance
		 * default — "Chat", "Images". The gold mark, so the index answers "which
		 * one is actually being used" without opening anything.
		 */
		defaultFor?: readonly string[]
		/** The list-beside-detail selection at desk width. */
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
		defaultFor = [],
		selected = false,
		onOpen,
		onAction
	}: Props = $props()

	/**
	 * The mark for where the compute is — Ollama's and KoboldCPP's own logos
	 * for their connections (2026-10-03), the kind's glyph for the rest. The
	 * two local ONNX kinds keep the glyph their MODALITY already owns
	 * (NOMENCLATURE §22: embeddings `Zap`, entities `ScanText`) — those two
	 * rows are the only ones in the list whose whole identity is the modality.
	 */
	const KindIcon = $derived(connectionTypeIcon(type, kindIconComponent(kind)))
	const ActionIcon = $derived(
		status.action
			? (((Icons as any)[status.action.icon] as any) ?? Icons.Play)
			: null
	)

	const marks = $derived(rowStatusClasses(status))

	/**
	 * What the second line says after the state and the marks.
	 *
	 * With an action the METRIC wins it: "2 on disk" is the fact, and "Starts
	 * on first use" is already implied by a Start button that is quiet rather
	 * than urgent. Without an action the metric has a column of its own and
	 * this is the detail — the host, or what went wrong.
	 */
	const secondary = $derived(
		(status.action ? status.metric : null) ?? status.detail
	)
	/** With an action, the state and its one fact as one line. */
	const stateLine = $derived(
		secondary ? `${status.label} · ${secondary}` : status.label
	)

	/**
	 * Shown only where it adds a word the title has not already said. See the
	 * header: a default-named connection repeating itself is what this removes.
	 */
	const showChip = $derived(
		!!serviceLabel &&
			serviceLabel.trim().toLowerCase() !== title.trim().toLowerCase()
	)
</script>

<div
	class="flex min-h-11 items-center gap-1 rounded-base {selected
		? 'sidebar-row-active'
		: marks.edge}"
	data-row-blocked={status.blocked ? "" : undefined}
>
	<button
		type="button"
		class="focus-visible:ring-primary-500 flex min-w-0 flex-1 items-center gap-2.5 rounded-base px-2 py-1.5 text-left focus-visible:ring-2 focus-visible:outline-none {selected
			? ''
			: 'hover:bg-surface-200-800'}"
		aria-current={selected ? "true" : undefined}
		onclick={onOpen}
	>
		<span
			class="preset-tonal-surface grid size-8 shrink-0 place-items-center rounded-lg"
			aria-hidden="true"
		>
			<KindIcon size={16} />
		</span>

		<span class="min-w-0 flex-1">
			<span class="flex min-w-0 items-center gap-1.5">
				<span class="min-w-0 truncate text-lead font-medium">
					{title}
				</span>
				{#if showChip}
					<span
						class="shrink-0 rounded-full px-1.5 py-0.5 text-meta {managed
							? 'preset-tonal-tertiary'
							: 'border-surface-300-700 text-surface-600-400 border'}"
					>
						{serviceLabel}
					</span>
				{/if}
			</span>
			<!--
				The gold marks ride on the SECOND line, beside the host.

				Beside the name they competed with it and won: an Anthropic row
				is the default for chat, vision and document reading the moment
				it is created, and with a state chip and a Set up button also on
				the row the title rendered as "A…". A mark that costs you the
				name of the thing it is marking is not worth having. Here it is
				just as gold and nothing it sits next to is essential.
			-->
			<span class="mt-0.5 flex min-w-0 items-center gap-1.5">
				{#if status.action}
					<!-- "Stopped · 1 on disk": the state and its one fact as one
					     muted line, the label first so a long reason truncates
					     after it, never before. -->
					<span
						class="flex min-w-0 items-center gap-1.5 text-chip {marks.text}"
						title={stateLine}
					>
						<span
							class="size-1.5 shrink-0 rounded-full {marks.dot}"
							aria-hidden="true"
						></span>
						<span class="min-w-0 truncate">{stateLine}</span>
					</span>
				{/if}
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
				{#if secondary && !status.action}
					<span
						class="text-surface-600-400 min-w-0 truncate text-chip"
						title={secondary}
					>
						{secondary}
					</span>
				{/if}
			</span>
		</span>

		<!--
			The right-hand column. A fixed basis so every row's state chip and
			metric line up down the list; `text-right` so they read as a column
			rather than as the tail of a sentence.

			⚠ Dropped entirely when the row has an ACTION. "Needs a key" in the
			column and **Set up** on the button say the same thing twice, and
			the two of them together took 156px out of a 340px row — which is
			how "Anthropic (Claude)" came to render as "Anthro…". With an action
			present the button IS the state, and the label joins the detail line
			where it costs nothing.
		-->
		{#if !status.action}
			<span class="shrink-0 basis-[86px] text-right">
				<span
					class="flex items-center justify-end gap-1.5 text-chip {marks.text}"
				>
					<span
						class="size-1.5 shrink-0 rounded-full {marks.dot}"
						aria-hidden="true"
					></span>
					<span class="truncate">{status.label}</span>
				</span>
				{#if status.metric}
					<!-- Muted, not quiet: "9 models" is a fact the reader came
					     for. §2.5 — quiet text is never body copy. -->
					<span
						class="text-surface-600-400 mt-0.5 block truncate text-xs"
					>
						{status.metric}
					</span>
				{/if}
			</span>
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
			class="btn btn-sm mr-1 shrink-0 text-xs {rowActionClass(
				status.action.emphasis
			)}"
			onclick={() => onAction(status.action!.verb)}
			aria-label={`${status.action.label} — ${title}`}
		>
			<ActionIcon size={14} aria-hidden="true" />
			{status.action.label}
		</button>
	{/if}
</div>
