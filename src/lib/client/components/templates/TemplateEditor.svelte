<script lang="ts">
	/**
	 * A template field that knows what is in scope.
	 *
	 * The textarea is still a textarea — a code-editor dependency would be a
	 * second editing surface with its own keyboard and a11y story, and the
	 * valuable half of one fits here: completions that know the block context,
	 * hover that answers "what is this and who supplies it", lint drawn under
	 * the text it is about, with a did-you-mean fix a click (or Ctrl+.)
	 * applies, and "Variables available here" — the scope as a tree.
	 *
	 * Typed templates P7: opened from a spec step, `scope` is that step's typed
	 * scope (SDK `templateScopeAt`, carried on the panel option) and
	 * `declarers` says who supplies each root. The library has no step in
	 * view: it passes the definition's static scope with `lenient`, so a name
	 * it cannot see is a warning, and says so in `scopeNote`.
	 *
	 * Everything is computed locally. The preview is still a round trip because
	 * rendering needs the server's helpers, but a completion list that arrives
	 * after a network hop is one nobody waits for.
	 */
	import * as Icons from "@lucide/svelte"
	import {
		completionsAt,
		describeAt,
		scopeTreeNodes,
		type Completion,
		type ScopeDeclarer,
		type ScopeTreeNode
	} from "$lib/shared/utils/templateAssist"
	import {
		templateDiagnostics,
		type TemplateDiagnostic,
		type TemplateQuickFix
	} from "$lib/shared/utils/templateDiagnostics"
	import {
		CORE_LIQUID_ENGINE,
		CORE_TEMPLATE_ENGINE
	} from "$lib/shared/pipelines/templateEngines"
	import type { TemplateScope } from "@serene-pub/sdk"
	import ScopeTree from "./ScopeTree.svelte"

	interface Props {
		value: string
		/** What the template may reference. Omitted means no assistance. */
		scope?: TemplateScope
		/** Who supplies each root of `scope` — hover, tree and completion. */
		declarers?: Readonly<Record<string, ScopeDeclarer>>
		/**
		 * Producers feeding the template untyped (labels): an unknown name may
		 * still arrive from one, so the lint warns instead of refusing.
		 */
		untyped?: readonly string[]
		/** No step in view — scope findings are warnings (the library). */
		lenient?: boolean
		/** One sentence above the tree saying what the scope is checked against. */
		scopeNote?: string
		/** Show "Variables available here". Default: when there is a scope. */
		showTree?: boolean
		/**
		 * The language the row is written in.
		 *
		 * Core's two engines — Handlebars and Liquid — get completion, hover,
		 * lint and the tree. A plugin's engine gets none of it: its syntax is
		 * not ours to guess, and an empty lint from an unchecked template is an
		 * assurance nobody earned.
		 */
		engine?: string
		readonly?: boolean
		rows?: number
		/** The accessible name, when no wrapping `<label>` provides one. */
		label?: string
		oninput: (value: string) => void
	}

	let {
		value,
		scope,
		declarers,
		untyped,
		lenient = false,
		scopeNote,
		showTree,
		engine = CORE_TEMPLATE_ENGINE,
		readonly = false,
		rows = 8,
		label,
		oninput
	}: Props = $props()

	const isLiquid = $derived(engine === CORE_LIQUID_ENGINE)
	const assisted = $derived(engine === CORE_TEMPLATE_ENGINE || isLiquid)

	const uid = `tpl-${Math.random().toString(36).slice(2, 8)}`

	let el = $state<HTMLTextAreaElement | null>(null)
	let mirror = $state<HTMLDivElement | null>(null)
	let overlay = $state<HTMLDivElement | null>(null)
	let caret = $state(0)
	let scrollTop = $state(0)
	let dismissedAt = $state<number | null>(null)
	let selected = $state(0)
	let blurred = $state(true)
	let pos = $state({ top: 0, left: 0 })
	let treeOpen = $state(true)

	const options = $derived({ engine, declarers })

	const items = $derived.by<Completion[]>(() => {
		if (!scope || readonly || !assisted || dismissedAt === caret) return []
		return completionsAt(value, caret, scope, options).slice(0, 50)
	})

	const hover = $derived(
		scope && assisted ? describeAt(value, caret, scope, options) : null
	)

	/**
	 * Lint, but not a parse error while the source is mid-word.
	 *
	 * A template being typed is usually not parseable, and reporting that as an
	 * error on every keystroke trains people to ignore the panel. The parse
	 * error is real and worth showing — once they have stopped typing.
	 */
	const diagnostics = $derived.by<TemplateDiagnostic[]>(() => {
		if (!scope || readonly || !assisted) return []
		const { diagnostics } = templateDiagnostics(engine, value, scope, {
			untyped,
			lenient
		})
		return blurred
			? diagnostics
			: diagnostics.filter((d) => d.kind !== "syntax")
	})

	const errorCount = $derived(
		diagnostics.filter((d) => d.severity === "error").length
	)

	const treeNodes = $derived(
		scope && assisted ? scopeTreeNodes(scope, options) : []
	)
	const wantsTree = $derived(
		(showTree ?? true) && treeNodes.length > 0
	)

	const open = $derived(items.length > 0)
	const active = $derived(items[Math.min(selected, items.length - 1)])

	$effect(() => {
		if (open) place()
	})

	/** The overlay tracks the field's box, font and scroll. */
	$effect(() => {
		void diagnostics
		void value
		if (!el || !overlay) return
		copyStyle(el, overlay)
		overlay.style.width = `${el.clientWidth + parseFloat(getComputedStyle(el).borderLeftWidth || "0")}px`
		// A few pixels past the field's bottom, so the last line's squiggle is
		// not clipped by the overlay's own edge.
		overlay.style.height = `${el.clientHeight + parseFloat(getComputedStyle(el).borderTopWidth || "0") + 4}px`
	})

	const STYLE_PROPS = [
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
		"overflowWrap",
		"tabSize"
	] as const

	function copyStyle(from: HTMLElement, to: HTMLElement) {
		const cs = getComputedStyle(from)
		for (const prop of STYLE_PROPS) to.style[prop] = cs[prop]
	}

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
		copyStyle(el, mirror)
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
			left: Math.min(marker.offsetLeft, Math.max(0, el.clientWidth - 288))
		}
	}

	/** The source cut into plain runs and the runs a finding covers. */
	const runs = $derived.by(() => {
		const out: { text: string; severity?: "error" | "warning" }[] = []
		const marks = [...diagnostics]
			.filter((d) => d.end > d.start)
			.sort((a, b) => a.start - b.start)
		let at = 0
		for (const d of marks) {
			const start = Math.max(d.start, at)
			const end = Math.min(d.end, value.length)
			if (end <= start) continue
			if (start > at) out.push({ text: value.slice(at, start) })
			out.push({ text: value.slice(start, end), severity: d.severity })
			at = end
		}
		out.push({ text: value.slice(at) + "\n" })
		return out
	})

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

	/** Replace `[start, end)` and put the caret (or a selection) after. */
	function replace(
		start: number,
		end: number,
		insert: string,
		select?: { start: number; end: number }
	) {
		const next = value.slice(0, start) + insert + value.slice(end)
		const a = start + (select ? select.start : insert.length)
		const b = start + (select ? select.end : insert.length)
		oninput(next)
		dismissedAt = b
		queueMicrotask(() => {
			if (!el) return
			el.focus()
			el.setSelectionRange(a, b)
			caret = b
		})
	}

	function accept(c: Completion) {
		replace(c.start, c.end, c.insert, c.select)
		// A placeholder or a snippet's argument slot wants the list back.
		if (c.select) dismissedAt = null
	}

	function applyFix(fix: TemplateQuickFix) {
		replace(fix.start, fix.end, fix.text)
	}

	/** The finding the caret sits in, with a fix — what Ctrl+. applies. */
	const fixAtCaret = $derived(
		diagnostics.find((d) => d.fix && caret >= d.start && caret <= d.end)
	)

	function onKeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key === "." && fixAtCaret?.fix) {
			e.preventDefault()
			applyFix(fixAtCaret.fix)
			return
		}
		if ((e.ctrlKey || e.metaKey) && e.key === " ") {
			e.preventDefault()
			dismissedAt = null
			return
		}
		if (!open) return
		if (e.key === "ArrowDown") {
			e.preventDefault()
			selected = (selected + 1) % items.length
		} else if (e.key === "ArrowUp") {
			e.preventDefault()
			selected = (selected - 1 + items.length) % items.length
		} else if (e.key === "Enter" || e.key === "Tab") {
			e.preventDefault()
			accept(active!)
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

	/** Is the caret inside an open tag (so a bare path is right)? */
	function insideTag(at: number): boolean {
		const before = value.slice(0, at)
		const opens = isLiquid ? ["{{", "{%"] : ["{{"]
		const closes = isLiquid ? ["}}", "%}"] : ["}}"]
		const open = Math.max(...opens.map((o) => before.lastIndexOf(o)))
		if (open === -1) return false
		return !closes.some((c) => before.indexOf(c, open) !== -1)
	}

	/**
	 * Insert a tree row's path at the caret: bare inside a tag, wrapped in
	 * one outside — a list as its loop, anything else as its output.
	 */
	function insertNode(node: ScopeTreeNode) {
		if (readonly) return
		const at = el?.selectionStart ?? caret
		const to = el?.selectionEnd ?? at
		if (insideTag(at)) return replace(at, to, node.path)
		if (node.type === "list") {
			const snippet = isLiquid
				? `{% for item in ${node.path} %}\n\n{% endfor %}`
				: `{{#each ${node.path}}}\n\n{{/each}}`
			const body = snippet.indexOf("\n") + 1
			return replace(at, to, snippet, { start: body, end: body })
		}
		replace(at, to, isLiquid ? `{{ ${node.path} }}` : `{{{${node.path}}}}`)
	}
</script>

<div class="@container/tpl flex flex-col gap-1">
	<div
		class="grid gap-2 {wantsTree && treeOpen
			? '@min-[40rem]/tpl:grid-cols-[minmax(0,1fr)_16rem]'
			: ''}"
	>
		<div class="relative min-w-0">
			<textarea
				bind:this={el}
				id="{uid}-field"
				class="textarea w-full font-mono text-xs"
				{rows}
				{readonly}
				spellcheck="false"
				aria-label={label}
				aria-autocomplete={scope && assisted ? "list" : undefined}
				aria-controls={open ? `${uid}-list` : undefined}
				aria-activedescendant={open ? `${uid}-opt-${selected}` : undefined}
				aria-describedby={diagnostics.length ? `${uid}-issues` : undefined}
				aria-invalid={errorCount > 0 ? true : undefined}
				{value}
				oninput={onInput}
				onkeydown={onKeydown}
				onkeyup={sync}
				onclick={sync}
				onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
				onfocus={() => (blurred = false)}
				onblur={() => {
					blurred = true
					dismissedAt = caret
				}}
			></textarea>

			<!-- The squiggles: the same text, transparent, over the field, with
			     the finding's range underlined. Never read out — the issue list
			     below is the accessible surface. -->
			{#if diagnostics.length}
				<div
					bind:this={overlay}
					aria-hidden="true"
					class="pointer-events-none absolute top-0 left-0 overflow-hidden border-transparent"
					style="border-style: solid; border-right-width: 0; border-bottom-width: 0; box-sizing: border-box;"
				>
					<div
						class="break-words whitespace-pre-wrap text-transparent"
						style="transform: translateY(-{scrollTop}px)"
					>{#each runs as run, i (i)}{#if run.severity}<span
								class="underline decoration-wavy underline-offset-2 {run.severity ===
								'error'
									? 'decoration-error-500'
									: 'decoration-warning-500'}">{run.text}</span
							>{:else}{run.text}{/if}{/each}</div>
				</div>
			{/if}

			<!-- Measures the caret. Never shown, never read out. -->
			<div
				bind:this={mirror}
				aria-hidden="true"
				class="pointer-events-none invisible absolute top-0 left-0 -z-10"
			></div>

			{#if open}
				<div
					class="border-surface-200-800 bg-surface-50-950 absolute z-50 w-72 rounded border shadow-lg"
					style="top:{pos.top}px; left:{pos.left}px"
				>
					<ul
						id="{uid}-list"
						role="listbox"
						aria-label="Completions"
						class="max-h-56 overflow-auto py-0.5"
					>
						{#each items as c, i (c.kind + c.label + i)}
							<li
								id="{uid}-opt-{i}"
								role="option"
								tabindex="-1"
								aria-selected={i === selected}
								class="flex w-full cursor-pointer items-baseline gap-2 px-2 py-1 text-left text-xs {i ===
								selected
									? 'sidebar-row-active'
									: 'hover:bg-surface-200-800'}"
								onmousedown={(e) => {
									e.preventDefault()
									accept(c)
								}}
							>
								<span class="font-mono">{c.label}</span>
								{#if c.detail}
									<span class="text-surface-600-400 truncate font-mono">
										{c.detail}
									</span>
								{:else if c.type}
									<span class="text-surface-600-400">
										{c.type}{c.optional ? "?" : ""}
									</span>
								{/if}
							</li>
						{/each}
					</ul>
					{#if active && (active.description || active.declarer)}
						<p
							class="border-surface-200-800 text-surface-600-400 border-t px-2 py-1 text-xs"
						>
							{#if active.description}{active.description}{/if}
							{#if active.declarer}
								<span class="block">From {active.declarer}</span>
							{/if}
						</p>
					{/if}
				</div>
			{/if}
		</div>

		{#if wantsTree}
			<section
				class="border-surface-200-800 flex min-w-0 flex-col gap-1 rounded border p-2 {treeOpen
					? '@min-[40rem]/tpl:max-h-[32rem] @min-[40rem]/tpl:overflow-auto'
					: ''}"
				aria-labelledby="{uid}-tree-h"
			>
				<button
					type="button"
					id="{uid}-tree-h"
					class="flex items-center gap-1 text-left text-xs font-medium"
					aria-expanded={treeOpen}
					aria-controls="{uid}-tree"
					onclick={() => (treeOpen = !treeOpen)}
				>
					<Icons.ChevronRight
						size={12}
						class="transition-transform {treeOpen ? 'rotate-90' : ''}"
						aria-hidden="true"
					/>
					Variables available here
				</button>
				{#if treeOpen}
					<div id="{uid}-tree" class="flex flex-col gap-1">
						{#if scopeNote}
							<p class="text-surface-600-400 text-xs">{scopeNote}</p>
						{/if}
						<ScopeTree
							nodes={treeNodes}
							insertable={!readonly}
							oninsert={insertNode}
						/>
					</div>
				{/if}
			</section>
		{/if}
	</div>

	{#if hover}
		<p class="text-xs" aria-live="polite">
			<span class="font-mono">{hover.path}</span>
			{#if hover.problem}
				<!-- The full finding is already in the list below; what this
				     line adds is the fix. -->
				<span class="text-error-600-400">
					{#if hover.suggestion}
						— did you mean <span class="font-mono">{hover.suggestion}</span>?
					{:else}
						— not available here
					{/if}
				</span>
			{:else}
				<span class="text-surface-600-400">
					{#if hover.type}— {hover.type}{/if}
					{#if hover.optional}(optional){/if}
					{#if hover.description}· {hover.description}{/if}
					{#if hover.declarer}· from {hover.declarer}{/if}
				</span>
			{/if}
		</p>
	{/if}

	{#if diagnostics.length}
		<ul id="{uid}-issues" class="flex flex-col gap-0.5 text-xs">
			{#each diagnostics as d (d.start + d.message)}
				<li
					class="flex flex-wrap items-baseline gap-x-2 {d.severity === 'error'
						? 'text-error-600-400'
						: 'text-warning-700-300'}"
				>
					{#if d.severity === "error"}
						<Icons.CircleX size={12} class="shrink-0 self-center" aria-hidden="true" />
					{:else}
						<Icons.TriangleAlert
							size={12}
							class="shrink-0 self-center"
							aria-hidden="true"
						/>
					{/if}
					<button
						type="button"
						class="min-w-0 flex-1 text-left underline-offset-2 hover:underline"
						onclick={() => jumpTo(d.start)}
					>
						<span class="font-medium">
							{d.severity === "error" ? "Error" : "Warning"}{d.line
								? `, line ${d.line}`
								: ""}:
						</span>
						{d.message}
					</button>
					{#if d.fix && !readonly}
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface h-6 px-2 text-xs"
							title="Apply the fix (Ctrl+.)"
							onclick={() => applyFix(d.fix!)}
						>
							{d.fix.label}
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
