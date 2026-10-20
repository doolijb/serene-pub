<script lang="ts">
	/**
	 * One widget's settings, inside its settings modal (PLAN 25; ruled
	 * 2026-09-10).
	 *
	 * Exposure is declaration-driven. Core's own `title` and `lane` come
	 * first; a widget's declared fields appear only because the widget
	 * declared them — its ungrouped ones under no heading, then one headed
	 * section per declared `group`, the group string verbatim, in order of
	 * first appearance (D5 of `PLAN-session-panels-2026-10-14`). Nothing folds
	 * away. A widget that declares nothing shows the core fields and nothing
	 * else, so the panel never lists a control with nothing behind it.
	 *
	 * `SchemaForm` renders the fields — the same renderer node params and plugin
	 * settings use, so a control fixed there is fixed here.
	 *
	 * Values are written on commit rather than per keystroke: the form is
	 * bound to a local copy, `SchemaForm` reports each commit (`oncommit` — a
	 * box's `change`, a choice list's pick, which fires no DOM `change` event
	 * at all), and every field that
	 * differs from what is stored is written through the store (which coerces,
	 * prunes to deviations, and persists). Writes are not optimistic, so the
	 * copy is re-seeded when — and only when — the persisted answer actually
	 * changes.
	 */
	import * as Icons from "@lucide/svelte"
	import SchemaForm from "$lib/client/components/pipelines/SchemaForm.svelte"
	import ListGroupLabel from "$lib/client/components/panels/ListGroupLabel.svelte"
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
			: { basic: [], declared: [], groups: [] }
	)
	let effective = $derived(
		decl
			? effectiveWidgetSettings({
					decl,
					stored: widgetSettingValues(widgetId)
				})
			: {}
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

	/** Ties each section to its heading (`aria-labelledby`). */
	const uid = $props.id()

	/**
	 * A section's fields as the schema `SchemaForm` wants — `group` left
	 * off, since the section's own heading already says it (SchemaForm would
	 * draw it a second time).
	 */
	function schemaOf(fields: SettingsField[]): Record<string, any> {
		const out: Record<string, any> = {}
		for (const f of fields) {
			const { group: _group, ...decl } = f.decl
			out[f.key] = decl
		}
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
	<div class="wsx">
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

		<SchemaForm
			schema={schemaOf(sections.basic)}
			bind:values
			oncommit={commit}
		/>

		{#if sections.declared.length}
			<SchemaForm
				schema={schemaOf(sections.declared)}
				bind:values
				oncommit={commit}
			/>
		{/if}

		{#each sections.groups as g, gi (g.heading)}
			<section
				class="wsx-section"
				data-settings-group={g.heading}
				aria-labelledby="{uid}-g{gi}"
			>
				<ListGroupLabel
					id="{uid}-g{gi}"
					label={g.heading}
					headingLevel={3}
					class="wsx-section-label"
				/>
				<SchemaForm
					schema={schemaOf(g.fields)}
					bind:values
					oncommit={commit}
				/>
			</section>
		{/each}
	</div>
{/if}

<style>
	.wsx {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		font-size: 14px;
	}
	.wsx-head {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.wsx-head-label {
		font-size: 12px;
		font-weight: 400;
		opacity: 0.72;
	}
	.wsx-reset {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		margin-inline-start: auto;
		padding: 0.1rem 0.3rem;
		border-radius: 0.25rem;
		font-size: 12px;
		opacity: 0.72;
	}
	.wsx-reset:hover,
	.wsx-reset:focus-visible {
		background: color-mix(in oklab, currentColor 12%, transparent);
		opacity: 1;
	}
	.wsx-section {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	/* The house group label (STYLE-GUIDE §6.4), flush with the fields under
	   it rather than inset like a sidebar list's. */
	.wsx-section :global(.wsx-section-label) {
		padding-inline: 0;
		padding-block: 0.5rem 0;
	}
</style>
