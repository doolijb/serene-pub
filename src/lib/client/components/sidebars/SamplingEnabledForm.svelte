<script lang="ts">
	/**
	 * Which parameters this config is in charge of — the enable/disable screen.
	 *
	 * This panel had one of these before the schema-driven rewrite and lost it
	 * when the switches moved inline beside every field. Inline is where the
	 * information belongs least: the values screen is read while tuning a
	 * number, and a checkbox in front of every label turns it into a checklist
	 * to scroll past. So the two screens are back, on the CURRENT storage —
	 * `enabled` is one array of keys, not a `<key>Enabled` boolean column per
	 * sampler, and this screen is the only writer of it.
	 *
	 * ⚠ NO type filter. The old screen listed number and boolean fields only,
	 * which left image `sampler`/`scheduler` — and every string[] or JSON field
	 * — permanently unreachable: switched off with no way to switch them on.
	 * That is the regression the inline toggles were built to fix, and it must
	 * not come back with them. Everything the shape declares is listed.
	 *
	 * Driven by the ROW's shape, so it works for text, image, TTS and anything a
	 * plugin declares next.
	 */

	import type { SettingsSchema, FieldDecl } from "@serene-pub/sdk"
	import {
		defaultOnEnable,
		groupSamplingFields,
		nextEnabled
	} from "./samplingFields"

	interface Props {
		schema: SettingsSchema
		/**
		 * The row's `values`. Bound because switching a key ON materialises its
		 * default here — see `defaultOnEnable`.
		 */
		values: Record<string, unknown>
		/** The row's `enabled`. Bound: this screen is what edits it. */
		enabled: string[]
		/** Immutable rows are readable but not editable. */
		disabled?: boolean
	}

	let {
		schema,
		values = $bindable(),
		enabled = $bindable(),
		disabled = false
	}: Props = $props()

	const label = (decl: FieldDecl, key: string): string => {
		const l = decl.label ?? decl.i18n
		return typeof l === "string" ? l : (l?.en ?? key)
	}
	const describe = (decl: FieldDecl): string => {
		const d = decl.description
		return typeof d === "string" ? d : (d?.en ?? "")
	}

	/**
	 * Grouped, unlike the old ungrouped wall of checkboxes — that screen listed
	 * nine hand-picked samplers and this one lists everything the shape
	 * declares, which is ~25 keys across seven groups for text alone.
	 */
	const groups = $derived(groupSamplingFields(schema))

	function toggle(key: string, on: boolean) {
		if (disabled) return
		// REASSIGNED, never mutated: `enabled` is a plain array on a `$state`
		// object, and an in-place push/splice would not re-run the `$derived`
		// the values screen filters with — the switch would tick here and the
		// field would never appear over there.
		enabled = nextEnabled(enabled, key, on)
		if (on) {
			// Materialise the default on switch-on so the slider has something
			// to show. Resolution would supply it anyway; writing it means the
			// form and the eventual request agree about what the value is.
			const seed = defaultOnEnable(schema, values, key)
			if (seed !== undefined) values[key] = seed
		}
	}
</script>

<div class="flex flex-col gap-4">
	{#if !groups.length}
		<p class="text-muted-foreground py-6 text-center text-sm">
			This configuration’s shape declares no parameters.
		</p>
	{/if}

	{#each groups as g (g.group)}
		<section class="flex flex-col gap-2">
			<p
				class="text-muted-foreground border-surface-500/20 border-b pb-1 text-xs font-semibold tracking-wide uppercase"
			>
				{g.group}
			</p>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				{#each g.fields as { key, decl } (key)}
					<!-- The description is VISIBLE text with `aria-describedby`,
					     not a `title`. A `title` on a label is not mapped to the
					     wrapped input's accessible description and needs a mouse
					     hover to read at all — and this is the one screen whose
					     entire job is deciding whether a parameter is worth
					     switching on. A parameter left off is not drawn on the
					     values screen either, so a hover-only tooltip made this
					     the only place the explanation lived and then hid it from
					     keyboard, touch and screen-reader users. -->
					<label
						class="hover:bg-muted flex items-start gap-2 rounded p-2 transition"
						for="se-{key}"
					>
						<input
							id="se-{key}"
							type="checkbox"
							class="accent-primary mt-0.5 shrink-0"
							checked={enabled.includes(key)}
							{disabled}
							aria-describedby={describe(decl)
								? `se-${key}-desc`
								: undefined}
							onchange={(e) =>
								toggle(key, e.currentTarget.checked)}
						/>
						<span class="flex min-w-0 flex-col">
							<span class="font-medium">
								{label(decl, key)}
							</span>
							{#if describe(decl)}
								<span
									id="se-{key}-desc"
									class="text-muted-foreground text-xs"
								>
									{describe(decl)}
								</span>
							{/if}
						</span>
					</label>
				{/each}
			</div>
		</section>
	{/each}
</div>
