<script lang="ts">
	/**
	 * A template field that knows what is in scope.
	 *
	 * The textarea is still a textarea — inline chips and hover cards want an
	 * editing surface this app does not have, and half-building one would leave
	 * the editor worse than the plain field it replaced. What the schema buys
	 * that *does* fit here is the valuable half: completions that know the
	 * block context, the type of whatever the caret is sitting on, and lint
	 * that names the field you probably meant.
	 *
	 * Everything is computed locally. The preview is still a round trip because
	 * rendering needs the server's helpers, but a completion list that arrives
	 * after a network hop is one nobody waits for.
	 */
	import {
		completionsAt,
		describeAt,
		type Completion
	} from "$lib/shared/utils/templateAssist"
	import {
		lintVariableTemplate,
		parseContextTemplate
	} from "$lib/shared/utils/contextConfigCards"
	import { validateTemplateContext } from "$lib/shared/utils/templateValidation"
	import { CORE_TEMPLATE_ENGINE } from "$lib/shared/pipelines/templateEngines"
	import type { TemplateScope } from "@serene-pub/sdk"

	interface Props {
		value: string
		/** What the template may reference. Omitted means no assistance. */
		scope?: TemplateScope
		/**
		 * The language the row is written in.
		 *
		 * The completion list, the hover card and the lint below all speak
		 * Handlebars — they read `{{#each}}` and `{{path}}` specifically — so
		 * for any other engine they are switched off rather than left to offer
		 * `{{#if}}` into a Liquid template. What survives for every engine core
		 * can parse is the part that is not syntax-specific: does this parse,
		 * and does it name anything nobody supplies.
		 */
		engine?: string
		readonly?: boolean
		rows?: number
		oninput: (value: string) => void
	}

	let {
		value,
		scope,
		engine = CORE_TEMPLATE_ENGINE,
		readonly = false,
		rows = 8,
		oninput
	}: Props = $props()

	const isHandlebars = $derived(engine === CORE_TEMPLATE_ENGINE)

	let el = $state<HTMLTextAreaElement | null>(null)
	let mirror = $state<HTMLDivElement | null>(null)
	let caret = $state(0)
	let dismissedAt = $state<number | null>(null)
	let selected = $state(0)
	let blurred = $state(true)
	let pos = $state({ top: 0, left: 0 })

	const items = $derived.by<Completion[]>(() => {
		if (!scope || readonly || !isHandlebars || dismissedAt === caret)
			return []
		return completionsAt(value, caret, scope).slice(0, 10)
	})

	const hover = $derived(
		scope && !readonly && isHandlebars
			? describeAt(value, caret, scope)
			: null
	)

	/** A 1-based line/column, as an offset into `value`, so a click can jump. */
	function offsetAt(line?: number, column?: number): number {
		if (!line) return 0
		let at = 0
		for (let i = 1; i < line; i++) {
			const next = value.indexOf("\n", at)
			if (next < 0) return at
			at = next + 1
		}
		return at + Math.max(0, (column ?? 1) - 1)
	}

	/**
	 * Lint, but not while the source is mid-word.
	 *
	 * A template being typed is usually not parseable, and reporting that as an
	 * error on every keystroke trains people to ignore the panel. The parse
	 * error is real and worth showing — once they have stopped typing.
	 */
	const issues = $derived.by(() => {
		if (!scope || readonly) return []
		if (!isHandlebars) {
			const result = validateTemplateContext(
				engine,
				value,
				Object.keys(scope)
			)
			// An engine core cannot parse says nothing rather than saying
			// "clean" — an empty list from an unchecked template is an
			// assurance nobody earned.
			if (!result.checked) return []
			if (result.error)
				return blurred
					? [
							{
								cardId: "syntax",
								start: offsetAt(
									result.error.line,
									result.error.column
								),
								end: 0,
								message: result.error.line
									? `Line ${result.error.line}: ${result.error.message}`
									: result.error.message
							}
						]
					: []
			return result.warnings.map((w) => ({
				cardId: `unsupplied:${w.name}:${w.line}:${w.column}`,
				start: offsetAt(w.line, w.column),
				end: 0,
				message: w.line ? `Line ${w.line}: ${w.message}` : w.message
			}))
		}
		const parsed = parseContextTemplate(value)
		if (parsed.parseError && !blurred) return []
		return lintVariableTemplate(value, scope)
	})

	const open = $derived(items.length > 0)

	$effect(() => {
		if (open) place()
	})

	/**
	 * Where the caret is, in pixels.
	 *
	 * Measured with a mirror element rather than guessed from character widths,
	 * because the field wraps and the font is not monospace everywhere it is
	 * used. The mirror copies the textarea's own computed style so the two
	 * agree about wrapping.
	 */
	function place() {
		if (!el || !mirror) return
		const cs = getComputedStyle(el)
		for (const prop of [
			"fontFamily",
			"fontSize",
			"fontWeight",
			"letterSpacing",
			"lineHeight",
			"paddingTop",
			"paddingRight",
			"paddingBottom",
			"paddingLeft",
			"borderTopWidth",
			"borderLeftWidth",
			"whiteSpace",
			"wordBreak",
			"overflowWrap"
		] as const)
			mirror.style[prop] = cs[prop]
		mirror.style.width = `${el.clientWidth}px`

		mirror.textContent = value.slice(0, caret)
		const marker = document.createElement("span")
		marker.textContent = "​"
		mirror.appendChild(marker)

		pos = {
			top:
				marker.offsetTop -
				el.scrollTop +
				parseFloat(cs.lineHeight || "16"),
			left: marker.offsetLeft
		}
	}

	function sync(e: Event) {
		const t = e.currentTarget as HTMLTextAreaElement
		caret = t.selectionStart ?? 0
	}

	function onInput(e: Event) {
		const t = e.currentTarget as HTMLTextAreaElement
		caret = t.selectionStart ?? 0
		dismissedAt = null
		selected = 0
		oninput(t.value)
	}

	function accept(c: Completion) {
		const next = value.slice(0, c.start) + c.insert + value.slice(c.end)
		const at = c.start + c.insert.length
		oninput(next)
		dismissedAt = at
		queueMicrotask(() => {
			if (!el) return
			el.focus()
			el.setSelectionRange(at, at)
			caret = at
		})
	}

	function onKeydown(e: KeyboardEvent) {
		if (!open) return
		if (e.key === "ArrowDown") {
			e.preventDefault()
			selected = (selected + 1) % items.length
		} else if (e.key === "ArrowUp") {
			e.preventDefault()
			selected = (selected - 1 + items.length) % items.length
		} else if (e.key === "Enter" || e.key === "Tab") {
			e.preventDefault()
			accept(items[Math.min(selected, items.length - 1)]!)
		} else if (e.key === "Escape") {
			e.preventDefault()
			dismissedAt = caret
		}
	}

	/** Put the caret on the issue, which is the only reason to list an offset. */
	function jumpTo(start: number) {
		if (!el) return
		el.focus()
		el.setSelectionRange(start, start)
		caret = start
	}
</script>

<div class="relative">
	<textarea
		bind:this={el}
		class="textarea w-full font-mono text-xs"
		{rows}
		{readonly}
		spellcheck="false"
		{value}
		oninput={onInput}
		onkeydown={onKeydown}
		onkeyup={sync}
		onclick={sync}
		onfocus={() => (blurred = false)}
		onblur={() => {
			blurred = true
			dismissedAt = caret
		}}
	></textarea>

	<!-- Measures the caret. Never shown, never read out. -->
	<div
		bind:this={mirror}
		aria-hidden="true"
		class="pointer-events-none invisible absolute top-0 left-0 -z-10"
	></div>

	{#if open}
		<ul
			class="border-surface-500/40 bg-surface-100-900 absolute z-50 max-h-56 w-64 overflow-auto rounded border shadow-lg"
			style="top:{pos.top}px; left:{pos.left}px"
		>
			{#each items as c, i (c.kind + c.label)}
				<li>
					<button
						type="button"
						class="flex w-full items-baseline gap-2 px-2 py-1 text-left text-xs {i ===
						selected
							? 'preset-filled-primary-500'
							: 'hover:preset-tonal-surface'}"
						onmousedown={(e) => {
							e.preventDefault()
							accept(c)
						}}
					>
						<span class="font-mono">{c.label}</span>
						{#if c.type}
							<span class="opacity-60">{c.type}</span>
						{/if}
						{#if c.optional}
							<span class="opacity-60" title="may be absent">
								?
							</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

{#if hover}
	<p class="text-xs opacity-70">
		<span class="font-mono">{hover.path}</span>
		{#if hover.problem}
			<!-- The full finding is already in the list below; repeating it here
			     is noise. What this line adds is the fix. -->
			<span class="text-error-500">
				{#if hover.suggestion}
					— did you mean <span class="font-mono">
						{hover.suggestion}
					</span>
					?
				{:else}
					— not available here
				{/if}
			</span>
		{:else}
			{#if hover.type}<span>— {hover.type}</span>{/if}
			{#if hover.optional}<span class="opacity-70">(optional)</span>{/if}
			{#if hover.description}<span>· {hover.description}</span>{/if}
		{/if}
	</p>
{/if}

{#if issues.length}
	<ul class="text-error-500 flex flex-col gap-0.5 text-xs">
		{#each issues as issue (issue.cardId + issue.start + issue.message)}
			<li>
				<button
					type="button"
					class="text-left underline-offset-2 hover:underline"
					onclick={() => jumpTo(issue.start)}
				>
					{issue.message}
				</button>
			</li>
		{/each}
	</ul>
{/if}
