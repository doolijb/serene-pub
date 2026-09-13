<script lang="ts">
	/**
	 * One widget's settings, inside its overlay card (PLAN 25; ruled
	 * 2026-09-10).
	 *
	 * Exposure is progressive and declaration-driven. Core's own `title` and
	 * `lane` are shown by default; a widget's declared fields appear only
	 * because the widget declared them; anything it put in the `behaviour` group
	 * sits behind a disclosure. A widget that declares nothing shows the two
	 * core fields and nothing else, so the panel never lists a control with
	 * nothing behind it.
	 *
	 * `SchemaForm` renders the fields — the same renderer node params and plugin
	 * settings use, so a control fixed there is fixed here.
	 *
	 * Values are written on `change` rather than per keystroke: the form is
	 * bound to a local copy, the wrapper hears the commit, and every field that
	 * differs from what is stored is written through the store (which coerces,
	 * prunes to deviations, and persists). Writes are not optimistic, so the
	 * copy is re-seeded when — and only when — the persisted answer actually
	 * changes.
	 */
	import * as Icons from "@lucide/svelte"
	import SchemaForm from "$lib/client/components/pipelines/SchemaForm.svelte"
	import {
		hasWidgetSettings,
		patchWidgetSettings,
		resetWidgetSettings,
		widgetSettingDecl,
		widgetSettingValues
	} from "$lib/client/stores/widgetSettings.svelte"
	import {
		effectiveWidgetSettings,
		settingsSections,
		type SettingsField
	} from "$lib/shared/widgets/settings"

	interface Props {
		/** The widget being configured — its `WidgetDecl` id. */
		widgetId: string
	}

	let { widgetId }: Props = $props()

	let decl = $derived(widgetSettingDecl(widgetId))
	let sections = $derived(
		decl
			? settingsSections(decl)
			: { basic: [], declared: [], behaviour: [] }
	)
	let effective = $derived(
		decl ? effectiveWidgetSettings(decl, widgetSettingValues(widgetId)) : {}
	)
	let overridden = $derived(hasWidgetSettings(widgetId))

	/** The bound copy the form edits, re-seeded from what is actually stored. */
	let values = $state<Record<string, unknown>>({})
	let seeded = ""
	$effect(() => {
		const key = JSON.stringify(effective)
		if (key === seeded) return
		seeded = key
		values = { ...effective }
	})

	/** A section's fields as the schema `SchemaForm` wants. */
	function schemaOf(fields: SettingsField[]): Record<string, any> {
		const out: Record<string, any> = {}
		for (const f of fields) out[f.key] = f.decl
		return out
	}

	/**
	 * Write whatever the commit changed. Every field is compared against the
	 * stored answer rather than tracked individually, so one handler serves
	 * every control the renderer draws, and the changes go out as one patch.
	 */
	function commit() {
		const patch: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(values))
			if (JSON.stringify(value) !== JSON.stringify(effective[key]))
				patch[key] = value
		if (Object.keys(patch).length) patchWidgetSettings(widgetId, patch)
	}
</script>

{#if decl}
	<div class="wsx" onchange={commit}>
		<div class="wsx-head">
			<span class="wsx-head-label">Settings</span>
			{#if overridden}
				<button
					class="wsx-reset"
					title="Drop your changes and use what this widget ships"
					onclick={() => resetWidgetSettings(widgetId)}
				>
					<Icons.RotateCcw size={11} />
					<span>Reset</span>
				</button>
			{/if}
		</div>

		<SchemaForm schema={schemaOf(sections.basic)} bind:values />

		{#if sections.declared.length}
			<SchemaForm schema={schemaOf(sections.declared)} bind:values />
		{/if}

		{#if sections.behaviour.length}
			<details class="wsx-more">
				<summary class="wsx-summary">
					<Icons.ChevronRight size={12} class="wsx-chev" />
					<span>Behaviour</span>
				</summary>
				<div class="wsx-more-body">
					<SchemaForm
						schema={schemaOf(sections.behaviour)}
						bind:values
					/>
				</div>
			</details>
		{/if}
	</div>
{/if}

<style>
	.wsx {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		font-size: 0.72rem;
	}
	.wsx-head {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.wsx-head-label {
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		opacity: 0.62;
	}
	.wsx-reset {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		margin-inline-start: auto;
		padding: 0.1rem 0.3rem;
		border-radius: 0.25rem;
		font-size: 0.62rem;
		opacity: 0.72;
	}
	.wsx-reset:hover,
	.wsx-reset:focus-visible {
		background: color-mix(in oklab, currentColor 12%, transparent);
		opacity: 1;
	}
	.wsx-summary {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.15rem 0;
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		cursor: pointer;
		opacity: 0.62;
		list-style: none;
	}
	.wsx-summary::-webkit-details-marker {
		display: none;
	}
	.wsx-summary:hover,
	.wsx-more:focus-within > .wsx-summary {
		opacity: 1;
	}
	/* The chevron turns with the disclosure — the only thing that says which
	   way it is without reading the fields under it. */
	.wsx-more[open] :global(.wsx-chev) {
		transform: rotate(90deg);
	}
	:global(.wsx-chev) {
		transition: transform 120ms ease;
	}
	.wsx-more-body {
		padding-block-start: 0.3rem;
	}
</style>
