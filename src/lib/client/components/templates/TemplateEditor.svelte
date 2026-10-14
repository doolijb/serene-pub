<script lang="ts">
	/**
	 * A template field that knows what is in scope.
	 *
	 * The text sits in a code field (`CodeField`, CodeMirror): line numbers,
	 * undo, search, bracket matching, and the valuable half of an IDE drawn from
	 * what the app already computes locally — completions that know the block
	 * context, hover that answers "what is this and who supplies it", lint drawn
	 * as a wave under the text it is about with a did-you-mean fix a click (or
	 * Ctrl+.) applies, and "Variables available here" — the scope as a tree.
	 * The language (Handlebars or Liquid) is highlighted by `templateLanguage`.
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
	import {
		filterShelvedTree,
		insertionFor,
		shelveScopeTree,
		usedScopeRoots
	} from "$lib/shared/utils/templateVariableShelves"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import DocPeek from "$lib/client/components/docs/DocPeek.svelte"
	import { docsHref } from "$lib/shared/utils/docsHref"
	import ScopeTree from "./ScopeTree.svelte"
	import CodeField from "$lib/client/components/codeField/CodeField.svelte"
	import { templateLanguageFor } from "$lib/client/components/codeField/templateLanguage"
	import {
		toCmDiagnostics,
		toCompletionResult,
		visibleDiagnostics
	} from "$lib/client/components/codeField/templateAssistBridge"
	import { keymap } from "@codemirror/view"
	import { Prec, type Extension } from "@codemirror/state"
	import { linter } from "@codemirror/lint"
	import { startCompletion, type CompletionContext } from "@codemirror/autocomplete"

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

	let field = $state<CodeField | null>(null)
	let caret = $state(0)
	let blurred = $state(true)
	let treeOpen = $state(true)

	const options = $derived({ engine, declarers })

	const hover = $derived(
		scope && assisted ? describeAt(value, caret, scope, options) : null
	)

	/** Every finding, before the mid-word rule. */
	const allDiagnostics = $derived.by<TemplateDiagnostic[]>(() => {
		if (!scope || readonly || !assisted) return []
		return templateDiagnostics(engine, value, scope, { untyped, lenient }).diagnostics
	})

	/**
	 * Lint, but not a parse error while the source is mid-word (see
	 * `visibleDiagnostics`). The same rule drives the wave in the field and
	 * the list under it, so the two never disagree.
	 */
	const diagnostics = $derived(visibleDiagnostics(allDiagnostics, !blurred))

	const errorCount = $derived(
		diagnostics.filter((d) => d.severity === "error").length
	)

	const treeNodes = $derived(
		scope && assisted ? scopeTreeNodes(scope, options) : []
	)
	const wantsTree = $derived(
		(showTree ?? true) && treeNodes.length > 0
	)

	/**
	 * The roots on their shelves, each marked when the template already uses
	 * it. Unused is unmarked, never a finding.
	 */
	let filter = $state("")
	let tree = $state<{ focusFirst: () => void } | null>(null)
	const usedRoots = $derived(
		usedScopeRoots(
			value,
			treeNodes.map((n) => n.label)
		)
	)
	const shelved = $derived(
		shelveScopeTree(treeNodes, { declarers, used: usedRoots, engine })
	)
	const filtered = $derived(filterShelvedTree(shelved, filter))

	/** The finding the caret sits in, with a fix — what Ctrl+. applies. */
	const fixAtCaret = $derived(
		diagnostics.find((d) => d.fix && caret >= d.start && caret <= d.end)
	)

	/**
	 * The field's language, completion and lint. Rebuilt only when what they
	 * read changes — the scope, the engine, read-only — never on a keystroke:
	 * the closures read the source from the view when CodeMirror asks.
	 */
	const extensions = $derived.by<Extension>(() => {
		const language = templateLanguageFor(engine)
		const out: Extension[] = []
		if (language) out.push(language)
		if (!scope || !assisted) return out
		const assist = { scope, options: { engine, declarers }, untyped, lenient, readonly }
		if (language && !readonly) {
			out.push(
				language.data.of({
					autocomplete: (ctx: CompletionContext) => {
						const items = completionsAt(
							ctx.state.doc.toString(),
							ctx.pos,
							assist.scope,
							assist.options
						).slice(0, 50)
						return toCompletionResult(items, {
							// A placeholder or a snippet's argument slot wants the list back.
							onslot: (view) => queueMicrotask(() => startCompletion(view))
						})
					}
				})
			)
		}
		out.push(
			linter(
				(view) => {
					const { diagnostics } = templateDiagnostics(
						assist.options.engine ?? CORE_TEMPLATE_ENGINE,
						view.state.doc.toString(),
						assist.scope,
						{ untyped: assist.untyped, lenient: assist.lenient }
					)
					return toCmDiagnostics(
						visibleDiagnostics(diagnostics, view.hasFocus),
						view.state.doc.length,
						assist.readonly
					)
				},
				{ delay: 250, needsRefresh: (u) => u.focusChanged }
			)
		)
		out.push(
			Prec.high(
				keymap.of([
					{
						key: "Mod-.",
						run: () => {
							const fix = fixAtCaret?.fix
							if (!fix) return false
							applyFix(fix)
							return true
						}
					}
				])
			)
		)
		return out
	})

	function applyFix(fix: TemplateQuickFix) {
		field?.replace(fix.start, fix.end, fix.text)
	}

	/** Put the caret on the issue, which is the only reason to list an offset. */
	function jumpTo(start: number) {
		field?.focusAt(start)
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
		if (readonly || !field) return
		const { from, to } = field.selection()
		if (insideTag(from)) return field.replace(from, to, node.path)
		const { text, caret: inside } = insertionFor(node, engine)
		field.replace(
			from,
			to,
			text,
			inside === undefined ? undefined : { start: inside, end: inside }
		)
	}
</script>

<div class="@container/tpl flex flex-col gap-1">
	<div
		class="grid gap-2 {wantsTree && treeOpen
			? '@min-[40rem]/tpl:grid-cols-[minmax(0,1fr)_16rem]'
			: ''}"
	>
		<div class="relative min-w-0">
			<CodeField
				bind:this={field}
				{value}
				{readonly}
				{rows}
				{label}
				{extensions}
				describedBy={diagnostics.length ? `${uid}-issues` : undefined}
				invalid={errorCount > 0}
				oninput={(v) => oninput(v)}
				oncursor={(pos) => (caret = pos)}
				onfocuschange={(focused) => (blurred = !focused)}
			/>
		</div>

		{#if wantsTree}
			<section
				class="border-surface-200-800 flex min-w-0 flex-col gap-1 rounded border p-2"
				aria-labelledby="{uid}-tree-h"
			>
				<div class="flex items-center gap-1">
					<button
						type="button"
						id="{uid}-tree-h"
						class="flex flex-1 items-center gap-1 text-left text-xs font-medium"
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
					<DocPeek
						href={docsHref("context-templates", "finding-the-variables-a-template-can-use")}
						topic="Finding variables"
					/>
				</div>
				{#if treeOpen}
					<div id="{uid}-tree" class="flex min-h-0 flex-col gap-1">
						{#if scopeNote}
							<p class="text-surface-600-400 text-xs">{scopeNote}</p>
						{/if}
						<PanelFilterInput
							bind:value={filter}
							placeholder="variables"
							singular="variable"
							count={treeNodes.length}
							onkeydown={(e) => {
								if (e.key !== "ArrowDown") return
								e.preventDefault()
								tree?.focusFirst()
							}}
						/>
						<p class="sr-only" aria-live="polite">
							{#if filter.trim()}
								{filtered.matched === 1
									? "1 variable matches"
									: `${filtered.matched} variables match`}
							{/if}
						</p>
						{#if filtered.nodes.length}
							<div class="max-h-[28rem] overflow-auto">
								<ScopeTree
									bind:this={tree}
									nodes={filtered.nodes}
									reveal={filtered.reveal}
									insertable={!readonly}
									oninsert={insertNode}
								/>
							</div>
						{:else}
							<p class="text-surface-600-400 text-xs">
								Nothing here matches “{filter.trim()}”.
							</p>
						{/if}
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
