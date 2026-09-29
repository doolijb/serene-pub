<script lang="ts" module>
	/**
	 * One choice in the list — the value that gets stored, the text the user
	 * reads, and an optional heading to file it under.
	 */
	export interface SelectOption {
		value: string
		label: string
		/**
		 * Options sharing a group render together under one heading, headings
		 * appearing in the order their first option does. Leave it off and the
		 * list renders flat — which is what every caller so far wants.
		 */
		group?: string
		/**
		 * Listed but not pickable — the old `<option disabled>`. Keys skip it
		 * and a click does nothing; pair it with `hint` so the reason is on
		 * the row, which is the whole point of listing it at all.
		 */
		disabled?: boolean
		/** One short line under the label: why it is disabled, or a detail. */
		hint?: string
	}
</script>

<script lang="ts">
	import { collection } from "@zag-js/combobox"
	import { Combobox, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { humanizeValue } from "$lib/shared/i18n/enumOptions"

	/**
	 * A drop-in replacement for the `<select>` shape this codebase uses over and
	 * over: a label, `{ value, label }` options, and a bindable value.
	 *
	 * ## Why a Combobox and not a Listbox
	 *
	 * Skeleton 5.0.1 ships `listbox`, but zag's listbox machine has exactly one
	 * state — `idle`. It is an always-open, inline list with no trigger and no
	 * popup, meant to be embedded in something that opens. There is no `select`
	 * machine in the dependency tree at all. So Combobox is the only compound in
	 * this version that produces a `<select>`-shaped dropdown, and it lands on
	 * the right ARIA anyway: `role="combobox"` over a `role="listbox"` popup of
	 * `role="option"` rows carrying `aria-selected` — the same tree a native
	 * `<select>` exposes, and not the `menu`/`menuitem` command tree.
	 *
	 * ## What this is NOT
	 *
	 * It is not a native form control. The visible control IS a real `<input>`,
	 * so `required` is a real required attribute and a surrounding `<form>` will
	 * block submit on an empty one — but the input's *text* is the option's
	 * label, not its value, so nothing here submits a usable value by itself.
	 * Every form in this app already handles its own submit in JS and reads the
	 * bound value, so that costs nothing today. A caller that genuinely needs a
	 * native POST must add a hidden input carrying `value`; deliberately not
	 * done here, because an untested `name` prop that silently submits the label
	 * instead of the value is worse than no `name` prop.
	 */
	interface Props {
		/** Rendered as a real `<label for>` tied to the input. Always required —
		 *  pass `labelHidden` when the design has no room for it. */
		label: string
		options: SelectOption[]
		value: string | null | undefined
		/** Shown when nothing is selected, in place of the old
		 *  `<option value="">-- Select … --</option>`. */
		placeholder?: string
		/** Visually hides the label without hiding it from assistive tech, for
		 *  inline controls whose visible label belongs to a sibling field. */
		labelHidden?: boolean
		disabled?: boolean
		required?: boolean
		/** Paints the invalid ring. Pair it with `describedBy` pointing at the
		 *  message so the reason is announced, not just the colour. */
		invalid?: boolean
		/** Adds a clear button once something is selected, which writes `""`
		 *  back — what picking the old empty `<option>` used to do. */
		clearable?: boolean
		/** id(s) for the input's `aria-describedby`: hint text, error text. */
		describedBy?: string
		/** Shown in the popup when the list is empty or nothing matches. */
		emptyMessage?: string
		/** Extra classes for the outer wrapper — width, margins. */
		class?: string
		/** Fires only on an actual selection (including a clear), never while
		 *  typing, so it stands in for the old `<select>`'s `oninput`. */
		onValueChange?: (value: string) => void
	}

	let {
		label,
		options,
		value = $bindable(),
		placeholder,
		labelHidden = false,
		disabled = false,
		required = false,
		invalid = false,
		clearable = false,
		describedBy,
		emptyMessage = "No matches.",
		class: className = "",
		onValueChange
	}: Props = $props()

	// What the user has typed since the popup opened, or null when they have not
	// typed — the box then shows text derived from `value`.
	//
	// Deriving it is not a nicety. zag only re-syncs the input's text when the
	// text itself changes, never when the selected value changes underneath it,
	// and both happen here: the model lists arrive over a socket long after
	// first paint, and clicking another connection in the sidebar swaps the
	// whole object into the same component instance. An uncontrolled input would
	// sit there showing the previous connection's model.
	let query = $state<string | null>(null)

	// An option with no label reads as its value humanised ("oldest-first" →
	// "Oldest first"), never as a blank row. A caller that passes the value
	// itself as the label keeps it: a model id is a name, not a stored token.
	let choices = $derived(
		options.map((o) =>
			o.label?.trim() ? o : { ...o, label: humanizeValue(o.value) }
		)
	)

	let selected = $derived(choices.find((o) => o.value === value))

	// Falls back to the stored value when no option matches it, so a model the
	// endpoint has stopped listing still reads as what is saved rather than
	// looking cleared — including during the gap before the list loads.
	let inputValue = $derived(query ?? selected?.label ?? value ?? "")

	interface RenderGroup {
		key: string
		label: string | undefined
		items: SelectOption[]
	}

	// Grouping only reorders; every option still appears exactly once. The
	// collection below is then built from this *rendered* order, because zag
	// walks the collection for arrow keys — a collection ordered differently
	// from the list makes Down jump around the popup.
	let renderGroups: RenderGroup[] = $derived.by(() => {
		const needle = query?.trim().toLowerCase()
		let matches = needle
			? choices.filter((o) => o.label.toLowerCase().includes(needle))
			: choices
		// The current value always gets a row. zag highlights the selected row
		// when the popup opens and never checks that the row exists, so naming
		// a value the list does not contain leaves `aria-activedescendant`
		// pointing at an id that is not in the document — an axe
		// `aria-valid-attr-value` failure, and a highlight no screen reader can
		// announce. Two everyday situations do exactly that: a saved model
		// before the socket answers with the list, and a filter that excludes
		// the current pick. A native `<select>` also always shows what is
		// selected, so guaranteeing the row costs nothing in fidelity.
		//
		// Appended, never prepended, so `autohighlight` still lands on the
		// first *typed* match and Enter picks that rather than the old value.
		if (value && !matches.some((o) => o.value === value)) {
			const known = choices.find((o) => o.value === value)
			matches = [...matches, known ?? { value, label: value }]
		}
		if (!matches.some((o) => o.group)) {
			return [{ key: "", label: undefined, items: matches }]
		}
		// A plain Map, not SvelteMap: it is rebuilt from scratch inside the
		// derived rather than mutated, so nothing depends on .set() being
		// reactive. Insertion order gives first-seen heading order for free.
		const byGroup = new Map<string, SelectOption[]>()
		for (const option of matches) {
			const key = option.group ?? ""
			const bucket = byGroup.get(key)
			if (bucket) bucket.push(option)
			else byGroup.set(key, [option])
		}
		return [...byGroup].map(([key, items]) => ({
			key,
			label: key || undefined,
			items
		}))
	})

	let visibleOptions = $derived(renderGroups.flatMap((g) => g.items))

	let selectCollection = $derived(
		collection({
			items: visibleOptions,
			itemToValue: (o: SelectOption) => o.value,
			itemToString: (o: SelectOption) => o.label,
			isItemDisabled: (o: SelectOption) => !!o.disabled
		})
	)
</script>

{#snippet optionRow(option: SelectOption)}
	<!-- `data-[highlighted]` and not just `hover:` — zag sets that attribute for
	     the arrow-key cursor as well as for pointer-over, and styling only
	     `hover:` (as the older pickers do) leaves keyboard navigation with
	     nothing moving on screen, which a native `<select>` never does.

	     The CHECKED option was `preset-filled-primary-500` — the app's button
	     treatment, which puts option text on primary at 3.62:1. Tonal primary
	     measures 11.57:1 and still reads as chosen. It matches the highlighted
	     option deliberately: an option is not a list row, it has no leading
	     edge to mark, and `ItemIndicator`'s check is what separates "the one
	     you picked" from "the one under the cursor". -->
	<Combobox.Item
		item={option}
		class="data-[highlighted]:preset-tonal-primary data-[state=checked]:preset-tonal-primary flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-sm data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60"
	>
		<!-- Wraps rather than truncates: model ids run long, and the popup is
		     the one place the whole name is worth reading. -->
		<span class="flex min-w-0 flex-col">
			<Combobox.ItemText class="min-w-0 break-words">
				{option.label}
			</Combobox.ItemText>
			{#if option.hint}
				<span class="text-surface-600-400 text-xs">{option.hint}</span>
			{/if}
		</span>
		<Combobox.ItemIndicator>
			<Icons.Check size={14} />
		</Combobox.ItemIndicator>
	</Combobox.Item>
{/snippet}

<Combobox
	collection={selectCollection}
	value={value ? [value] : []}
	{inputValue}
	{disabled}
	{required}
	{invalid}
	{placeholder}
	openOnClick
	inputBehavior="autohighlight"
	positioning={{ sameWidth: true, gutter: 4 }}
	class="flex flex-col gap-1 {className}"
	onValueChange={(details) => {
		// Empty on a clear, which is exactly what picking the old
		// `<option value="">` wrote.
		const next = details.value[0] ?? ""
		query = null
		value = next
		onValueChange?.(next)
	}}
	onInputValueChange={(details) => {
		// Only typing is the user's own text. Every other reason — selecting,
		// clearing, Escape, clicking away — is zag putting the selection's text
		// back, and letting the derived value do that keeps one source of truth.
		query = details.reason === "input-change" ? details.inputValue : null
	}}
	onOpenChange={(details) => {
		// Reset on close only. Typing opens the popup, so resetting on open
		// would wipe the very keystroke that opened it.
		if (!details.open) query = null
	}}
>
	<Combobox.Label class={labelHidden ? "sr-only" : "font-semibold"}>
		{label}
	</Combobox.Label>
	<Combobox.Control class="relative">
		<!-- The invalid ring is forced so it also wins over `.input`'s focus
		     ring — a field stays visibly wrong while you are fixing it. -->
		<Combobox.Input
			class="input data-[invalid]:ring-error-500! w-full {clearable
				? 'pr-16'
				: 'pr-8'}"
			aria-describedby={describedBy}
		/>
		<!-- Both buttons: `top-1/2` + `-translate-y-1/2`, never `inset-y-0`.
		     Skeleton ships base styles for these parts
		     (@skeletonlabs/skeleton-common/src/components/combobox.css),
		     imported `layer(base)` — so a Tailwind utility beats them on any
		     property the utility sets, and leaves every property it does not
		     set standing. The trigger's base rule is `position:absolute;
		     inset-inline-end:6px; top:50%; transform:translateY(-50%)` plus
		     `btn-icon btn-icon-xs preset-tonal`, so `inset-y-0` replaced
		     `top:50%` with `top:0` while the base's translateY(-50%) survived
		     intact: the chevron rendered 17px high, its centre landing exactly
		     on the input's top edge.
		     `transform-none` is load-bearing, not tidying. Tailwind v4's
		     `-translate-y-1/2` sets the independent `translate` property, which
		     COMPOSES with `transform` rather than replacing it — so on its own
		     it stacked with the base's translateY(-50%) and shifted the button
		     up by half its height twice, leaving it 11.8px high even with
		     `top:50%` restored. Zeroing `transform` first means exactly one
		     centring shift applies and it is ours.
		     What is left is the height-independent centring idiom: correct for
		     whatever box size the base gives these buttons (23.6px today), and
		     still correct if that ever changes — it derives from the element's
		     own height rather than cancelling a specific value the base ships.
		     `end-*` rather than `right-*` so it overrides the base's own
		     `inset-inline-end` outright instead of depending on how a physical
		     and a logical inset resolve against one another.
		     Size and colour are left to the base's `btn-icon btn-icon-xs
		     preset-tonal`; the clear button only gets a box matching the
		     chevron. Both are tabindex=-1 by zag's design, so the input stays
		     the single tab stop and neither wants a focus ring. -->
		{#if clearable}
			<Combobox.ClearTrigger
				class="absolute end-8 top-1/2 h-6 w-6 -translate-y-1/2 transform-none cursor-pointer p-0"
				aria-label="Clear {label}"
			>
				<Icons.X size={14} />
			</Combobox.ClearTrigger>
		{/if}
		<Combobox.Trigger
			class="absolute end-1.5 top-1/2 -translate-y-1/2 transform-none cursor-pointer"
			aria-label="Show {label} options"
		>
			<Icons.ChevronDown size={16} />
		</Combobox.Trigger>
	</Combobox.Control>
	<Portal>
		<Combobox.Positioner class="z-[1000]!">
			<Combobox.Content
				class="card bg-surface-100-900 max-h-72 w-full overflow-y-auto p-1 shadow-xl"
			>
				{#if visibleOptions.length === 0}
					<!-- A disabled option, not a presentational `li`. The
					     content element is a listbox, and axe's
					     aria-required-children fails a listbox holding a
					     `role="presentation"` child while it passes one holding
					     a disabled option (an entirely empty listbox is merely
					     "incomplete"). zag never highlights it — it is not in
					     the collection — so keys skip straight past it. -->
					<li
						role="option"
						aria-disabled="true"
						aria-selected="false"
						class="text-surface-700-300 p-2 text-sm"
					>
						{emptyMessage}
					</li>
				{/if}
				{#each renderGroups as group (group.key)}
					{#if group.label}
						<Combobox.ItemGroup>
							<Combobox.ItemGroupLabel
								class="text-surface-600-400 px-2 pt-2 pb-1 text-xs"
							>
								{group.label}
							</Combobox.ItemGroupLabel>
							{#each group.items as option}
								{@render optionRow(option)}
							{/each}
						</Combobox.ItemGroup>
					{:else}
						<!-- Deliberately unkeyed. Option values come from
						     whatever a remote endpoint listed, and some
						     OpenAI-compatible proxies do report the same model
						     id twice; a keyed each would throw
						     `each_key_duplicate` and take the whole popup down
						     over a duplicate row. Diffing precision is worth
						     nothing here by comparison. -->
						{#each group.items as option}
							{@render optionRow(option)}
						{/each}
					{/if}
				{/each}
			</Combobox.Content>
		</Combobox.Positioner>
	</Portal>
</Combobox>
