<script lang="ts">
	/**
	 * The per-widget style controls (PLAN 25; ruled 2026-09-09).
	 *
	 * Styling used to be a list of rows in the editor's Style panel, one per
	 * widget, at the top of the page — a long way from the thing each row was
	 * about. The ruling moved it onto the widget: while the Style tab is open
	 * every widget wears this overlay, invisible until you hover it, and the
	 * controls fade in over the widget they change.
	 *
	 * ## Where this lives, and why
	 *
	 * Inside `WidgetHost`, which is the ONE place that knows a NATIVE widget is
	 * skinnable at all (it is what resolves and injects the skin). Its wrapper
	 * is `display: contents` and so has no box of its own, so the overlay is
	 * positioned against the panel card — `Panel`'s `<section>` — which is the
	 * box a person actually points at.
	 *
	 * A FRAME widget mounts it from `Panel`'s frame branch instead, against the
	 * same card (`mount="frame"`). That puts the controls OUTSIDE the iframe,
	 * which is what a frame skin needs: the CSS being edited lands inside the
	 * frame's document, so it cannot restyle — or hide — the buttons you would
	 * use to take it back off. Same reason the native mount is a sibling of the
	 * scope wrapper rather than a child of it.
	 *
	 * ## Hover, and why hover alone is not enough
	 *
	 * The picker's popup is portalled to `<body>` and the editor is a popover,
	 * so using either genuinely takes the pointer (and the focus) off the
	 * widget. Interacting therefore PINS the overlay open — `nextArmed` in the
	 * store — and only one widget may be pinned, which is what stops two style
	 * editors being open at once.
	 *
	 * ## Live apply
	 *
	 * Typing in the editor writes a draft into the store (debounced ~150ms) and
	 * `WidgetHost` renders THAT instead of the saved row, so the widget changes
	 * under the author's hands. It is not a second injection path: the draft
	 * goes through the same `scopeWidgetCss` the saved row does. Cancel drops
	 * the draft, and the saved row is simply what is left — nothing is undone.
	 *
	 * ## Save, and why it does not close straight away
	 *
	 * Save used to close the editor and drop the draft on the spot, while the
	 * persisted row only arrives a round trip later — so the widget repainted
	 * itself with the PRE-save CSS and then jumped to the new one. The store now
	 * HOLDS the draft until the widget actually resolves to the saved row
	 * (`nextSaveState`), and this editor stays open for as long as it does. A
	 * refused write ends the hold but not the draft: the editor stays open with
	 * the reason, because the text in it is the only copy there is.
	 */
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import {
		VAR_KEY_RE,
		canManageStyle,
		checkWidgetCss,
		createDebouncer,
		overlayVisible,
		resolveWidgetStyle,
		stylePickerOptions,
		widgetStylesStore
	} from "$lib/client/stores/widgetStyles.svelte"

	interface Props {
		/** The widget being styled — the `widget_styles.widgetSlug` too. */
		widgetId: string
		/** What to call it on screen (the panel's own title). */
		label: string
		/**
		 * Which kind of widget this overlay is on, which changes exactly one
		 * thing: what the editor tells the author their CSS can reach.
		 *
		 * A `native` widget's CSS is re-pointed at that widget's own box, so
		 * page-level selectors are rewritten away. A `frame` widget is a
		 * sandboxed document of its own, so its CSS is injected there UNSCOPED
		 * and `body { … }` means the frame's body. Same store, same sanitiser,
		 * same live-apply — only the sentence describing the boundary differs,
		 * and getting that sentence wrong is how an author writes a selector
		 * that silently does nothing.
		 */
		mount?: "native" | "frame"
	}

	let { widgetId, label, mount = "native" }: Props = $props()

	const styles = widgetStylesStore()
	const userCtx: UserCtx | undefined = getContext("userCtx")
	let me = $derived(
		userCtx?.user
			? { id: userCtx.user.id, isAdmin: !!userCtx.user.isAdmin }
			: null
	)

	let rootEl = $state<HTMLDivElement | null>(null)
	let hovered = $state(false)
	let focused = $state(false)
	let armed = $derived(styles.armed === widgetId)

	let visible = $derived(
		overlayVisible({
			styleMode: styles.styleMode,
			hovered,
			focused,
			armed
		})
	)

	let row = $derived(resolveWidgetStyle(widgetId))
	let manageable = $derived(row ? canManageStyle(row, me) : false)
	let options = $derived(stylePickerOptions(styles.rows, widgetId, me?.id))

	/**
	 * Hovering another widget releases a pin nobody is using any more — but
	 * never one with an editor open, or reaching across the screen for the CSS
	 * box would close the thing you were typing in.
	 */
	function onEnter() {
		hovered = true
		if (styles.armed && styles.armed !== widgetId && !styles.preview)
			styles.disarm(styles.armed)
	}

	/** Focus moving WITHIN the overlay is not focus leaving it. */
	function onFocusOut(e: FocusEvent) {
		const to = e.relatedTarget
		if (to instanceof Node && rootEl?.contains(to)) return
		focused = false
	}

	function pick(value: string) {
		armedDelete = null
		const chosen = styles.rows.find((r) => r.id === Number(value))
		styles.pin(
			widgetId,
			chosen ? { id: chosen.id, slug: chosen.slug } : null
		)
	}

	/* ── the editor ────────────────────────────────────────────────────── */

	interface VarRow {
		key: string
		value: string
	}
	interface Draft {
		mode: "new" | "edit"
		id?: number
		title: string
		css: string
		vars: VarRow[]
		visibility: "private" | "shared"
	}
	let draft = $state<Draft | null>(null)
	let formError = $state<string | null>(null)
	/** A save this editor is waiting on — the store is holding its preview. */
	let saving = $derived(styles.saving === widgetId)
	/** Set by Save, cleared by the verdict below — "a save of MINE is out". */
	let awaitingSave = $state(false)
	/** Delete is two clicks, not a modal — the overlay has no room for one. */
	let armedDelete = $state<number | null>(null)

	/**
	 * One debouncer per overlay, not per module: two widgets' editors would
	 * otherwise share a timer and the later keystroke would cancel the other
	 * widget's pending apply.
	 */
	const livePreview = createDebouncer(150)

	/** The draft's variables as the record `skinToRender` wants. */
	function varsOf(rows: VarRow[]): Record<string, string> {
		const out: Record<string, string> = {}
		for (const v of rows) {
			const key = normaliseVarKey(v.key)
			// A half-typed name is skipped rather than shown as an error while
			// the author is still typing it; `save` is where names are judged.
			if (VAR_KEY_RE.test(key)) out[key] = v.value
		}
		return out
	}

	function pushPreview() {
		if (!draft) return
		styles.setPreview({
			widgetId,
			css: draft.css,
			vars: varsOf(draft.vars)
		})
	}

	/** Called on every keystroke; only the last one in a burst gets applied. */
	function schedulePreview() {
		livePreview.schedule(pushPreview)
	}

	function openDraft(next: Draft) {
		formError = null
		armedDelete = null
		draft = next
		styles.arm(widgetId)
		// Seed the preview immediately (a no-op repaint for Edit, an empty one
		// for New) so an open editor always means "this widget is showing the
		// draft" — which is what tells the other overlays to leave it alone.
		pushPreview()
	}

	function startNew() {
		openDraft({
			mode: "new",
			title: `${label} style`,
			css: "",
			vars: [],
			visibility: "private"
		})
	}

	function startEdit() {
		if (!row) return
		openDraft({
			mode: "edit",
			id: row.id,
			title: row.title,
			css: row.css,
			vars: Object.entries(row.vars ?? {}).map(([key, value]) => ({
				key,
				value
			})),
			visibility: row.visibility === "shared" ? "shared" : "private"
		})
	}

	/** Close and revert: drop the pending apply, then drop the draft itself. */
	function closeEditor() {
		livePreview.cancel()
		draft = null
		formError = null
		awaitingSave = false
		// Cancelling mid-save releases the hold too, or the store would be left
		// waiting for a row on behalf of an editor that has gone.
		styles.cancelSave()
		styles.setPreview(null)
	}

	function cloneCurrent() {
		if (!row) return
		armedDelete = null
		styles.arm(widgetId)
		styles.clone(row.id, widgetId)
	}

	function deleteCurrent() {
		if (!row) return
		styles.arm(widgetId)
		if (armedDelete !== row.id) {
			armedDelete = row.id
			return
		}
		armedDelete = null
		// Drop the pin too: the row is going, and a pin left behind would
		// resolve to the default anyway — this just makes it honest on screen.
		styles.pin(widgetId, null)
		styles.remove(row.id)
		if (draft?.id === row.id) closeEditor()
	}

	/** `--accent`, not `accent` — the stored key IS the CSS property name. */
	function normaliseVarKey(key: string): string {
		const trimmed = key.trim().toLowerCase()
		if (!trimmed) return ""
		return trimmed.startsWith("--") ? trimmed : `--${trimmed}`
	}

	function save() {
		if (!draft) return
		const title = draft.title.trim()
		if (!title) {
			formError = "Give the style a name."
			return
		}
		const cssProblem = checkWidgetCss(draft.css)
		if (cssProblem) {
			formError = cssProblem
			return
		}
		const vars: Record<string, string> = {}
		for (const v of draft.vars) {
			const key = normaliseVarKey(v.key)
			if (!key && !v.value.trim()) continue
			if (!VAR_KEY_RE.test(key)) {
				formError = `'${v.key}' is not a CSS custom property — variable names look like '--accent'.`
				return
			}
			const valueProblem = checkWidgetCss(v.value)
			if (valueProblem) {
				formError = valueProblem
				return
			}
			vars[key] = v.value
		}
		formError = null
		// The draft keeps standing in for the row until the widget is actually
		// wearing it — the store holds it, and the effect below is what closes
		// this editor when that hold ends. Closing here instead, as this used
		// to, IS the flash: the saved row is still a round trip away.
		awaitingSave = true
		if (draft.mode === "new") {
			styles.create(
				{
					widgetSlug: widgetId,
					title,
					css: draft.css,
					vars,
					visibility: draft.visibility
				},
				widgetId
			)
		} else if (draft.id != null) {
			styles.update(
				{
					id: draft.id,
					title,
					css: draft.css,
					vars,
					visibility: draft.visibility
				},
				widgetId
			)
		}
	}

	/**
	 * The verdict on a save this editor was waiting for.
	 *
	 * The hold ending means one of two things, and they are told apart by the
	 * error the store just recorded: refused, so the editor stays open on the
	 * author's text with the reason; otherwise landed, and the widget is
	 * wearing the saved row now — the editor's job, and its draft's, is done.
	 */
	$effect(() => {
		if (!awaitingSave || saving) return
		awaitingSave = false
		if (styles.error) formError = styles.error
		else closeEditor()
	})
</script>

{#snippet editorBody()}
	{#if draft}
		<div class="ws-editor">
			<div class="ws-editor-head">
				<Icons.Palette size={13} />
				<span>
					{draft.mode === "new" ? "New style" : "Edit style"} — {label}
				</span>
				<span class="ws-spacer"></span>
				<div class="ws-seg" role="group" aria-label="Who can use it">
					<button
						class="ws-seg-btn"
						class:active={draft.visibility === "private"}
						title="Only you can use this style"
						onclick={() => draft && (draft.visibility = "private")}
					>
						Just me
					</button>
					<button
						class="ws-seg-btn"
						class:active={draft.visibility === "shared"}
						title="Everyone on this instance can use this style"
						onclick={() => draft && (draft.visibility = "shared")}
					>
						Everyone
					</button>
				</div>
			</div>

			<label class="ws-field">
				<span class="ws-field-label">Name</span>
				<input
					class="ws-input"
					type="text"
					bind:value={draft.title}
					maxlength="120"
					placeholder="Name this style…"
				/>
			</label>

			<label class="ws-field">
				<span class="ws-field-label">CSS</span>
				<textarea
					class="ws-input ws-css"
					bind:value={draft.css}
					oninput={schedulePreview}
					spellcheck="false"
					rows="6"
					placeholder={mount === "frame"
						? "body { background: #101018; }"
						: ".message-bubble { border-radius: 1.25rem; }"}
				></textarea>
			</label>
			<p class="ws-hint">
				Changes show on the widget as you type.
				{#if mount === "frame"}
					This widget is a sandboxed frame with a document of its own,
					so write it as a page —
					<code>body</code>
					 and
					<code>:root</code>
					 mean the frame's own, and nothing here can reach the rest of
					this page.
				{:else}
					Written against this widget only — every selector is
					re-pointed at the widget's own box, so nothing here can reach
					the rest of the page.
				{/if}
				<code>@import</code>
				and images from other websites are refused;
				<code>@font-face</code>
				,
				<code>@property</code>
				and
				<code>@counter-style</code>
				{#if mount === "frame"}
					 are stored but not applied — one sanitiser serves both kinds
					of widget, and it refuses the at-rules it cannot confine to a
					native one.
				{:else}
					 are stored but not applied, because they name things for the
					whole page rather than for one widget.
				{/if}
			</p>

			<div class="ws-field">
				<span class="ws-field-label">Variables</span>
				<div class="ws-vars">
					{#each draft.vars as v, i (i)}
						<div class="ws-var-row">
							<input
								class="ws-input"
								type="text"
								bind:value={draft.vars[i].key}
								oninput={schedulePreview}
								onblur={() =>
									draft &&
									(draft.vars[i].key = normaliseVarKey(
										draft.vars[i].key
									))}
								placeholder="--accent"
								aria-label="Variable name"
							/>
							<input
								class="ws-input"
								type="text"
								bind:value={draft.vars[i].value}
								oninput={schedulePreview}
								placeholder="value"
								aria-label="Variable value"
							/>
							<button
								class="ws-btn"
								title="Remove this variable"
								aria-label="Remove variable"
								onclick={() => {
									if (!draft) return
									draft.vars = draft.vars.filter(
										(_, n) => n !== i
									)
									schedulePreview()
								}}
							>
								<Icons.X size={12} />
							</button>
						</div>
					{/each}
					<button
						class="ws-btn"
						onclick={() =>
							draft &&
							(draft.vars = [
								...draft.vars,
								{ key: "", value: "" }
							])}
					>
						<Icons.Plus size={12} />
						<span>Add variable</span>
					</button>
				</div>
			</div>

			{#if formError}
				<p class="ws-form-error" role="alert">{formError}</p>
			{/if}

			<div class="ws-editor-actions">
				<button class="ws-btn primary" disabled={saving} onclick={save}>
					<Icons.Check size={13} />
					<span>{saving ? "Saving…" : "Save style"}</span>
				</button>
				<button class="ws-btn" onclick={closeEditor}>
					<span>Cancel</span>
				</button>
			</div>
		</div>
	{/if}
{/snippet}

{#snippet editorPopover(mode: "new" | "edit")}
	<Portal>
		<Popover.Positioner class="z-[1200]!">
			<Popover.Content
				class="card bg-surface-100-900 w-[min(92vw,26rem)] p-3 shadow-xl"
				aria-label="{mode === 'new' ? 'New' : 'Edit'} style for {label}"
			>
				<!-- Both popovers keep a Content in the DOM (zag only hides the
				     closed one), so the form is rendered ONLY for the mode this
				     one is showing — otherwise New and Edit each hold a copy,
				     two textareas bind to the same draft and the hidden one is
				     what a query finds first. -->
				{#if draft?.mode === mode}
					{@render editorBody()}
				{/if}
			</Popover.Content>
		</Popover.Positioner>
	</Portal>
{/snippet}

<!-- Nothing at all outside Style mode: no hidden overlay to swallow a
     widget's own hover affordances in the live view. -->
{#if styles.styleMode}
	<div
		bind:this={rootEl}
		class="ws-overlay"
		class:visible
		class:editing={!!draft}
		role="group"
		aria-label="Style {label}"
		onpointerenter={onEnter}
		onpointerleave={() => (hovered = false)}
		onpointerdown={() => styles.arm(widgetId)}
		onfocusin={() => (focused = true)}
		onfocusout={onFocusOut}
	>
		<div class="ws-card">
			<div class="ws-card-head">
				<Icons.Palette size={13} />
				<span class="ws-card-title">{label}</span>
			</div>
			<Select
				class="ws-select"
				label="Style for {label}"
				labelHidden
				{options}
				value={row ? String(row.id) : ""}
				placeholder={styles.loaded ? "No styles yet" : "Loading…"}
				emptyMessage="This widget ships no styles yet."
				onValueChange={pick}
			/>
			<div class="ws-actions">
				<Popover
					open={draft?.mode === "new"}
					onOpenChange={(e) => (e.open ? startNew() : closeEditor())}
					positioning={{
						placement: "right-start",
						gutter: 10,
						overflowPadding: 12
					}}
				>
					<Popover.Trigger
						class="ws-btn"
						title="Make a new style for {label}"
					>
						<Icons.Plus size={12} />
						<span>New</span>
					</Popover.Trigger>
					{@render editorPopover("new")}
				</Popover>

				<Popover
					open={draft?.mode === "edit"}
					onOpenChange={(e) => (e.open ? startEdit() : closeEditor())}
					positioning={{
						placement: "right-start",
						gutter: 10,
						overflowPadding: 12
					}}
				>
					<Popover.Trigger
						class="ws-btn"
						disabled={!manageable}
						title={manageable
							? `Edit "${row?.title}"`
							: "Built-in styles can't be edited — clone one to make your own"}
					>
						<Icons.Pencil size={12} />
						<span>Edit</span>
					</Popover.Trigger>
					{@render editorPopover("edit")}
				</Popover>

				<button
					class="ws-btn"
					title={row
						? `Make your own copy of "${row.title}"`
						: "Nothing to copy yet"}
					disabled={!row}
					onclick={cloneCurrent}
				>
					<Icons.Copy size={12} />
					<span>Clone</span>
				</button>
				<button
					class="ws-btn"
					class:danger={armedDelete === row?.id}
					title={manageable
						? `Delete "${row?.title}"`
						: "Built-in styles can't be deleted"}
					disabled={!manageable}
					onclick={deleteCurrent}
				>
					<Icons.Trash2 size={12} />
					<span>
						{armedDelete === row?.id ? "Really delete?" : "Delete"}
					</span>
				</button>
			</div>
			{#if styles.error}
				<p class="ws-form-error" role="alert">{styles.error}</p>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* Positioned against the panel card (Panel's `<section>` is `relative`),
	   because WidgetHost's own wrapper is `display: contents` and has no box.
	   Above the widget's content, below the editor toolbar and any portal. */
	.ws-overlay {
		position: absolute;
		inset: 0;
		z-index: 6;
		display: grid;
		place-items: center;
		padding: 0.4rem;
		border-radius: inherit;
		background: color-mix(
			in oklab,
			var(--color-surface-50) 70%,
			transparent
		);
		opacity: 0;
		transition: opacity 120ms ease;
	}
	:global([data-mode="dark"]) .ws-overlay {
		background: color-mix(
			in oklab,
			var(--color-surface-950) 70%,
			transparent
		);
	}
	.ws-overlay.visible {
		opacity: 1;
	}
	/* While the editor is open the scrim and the card get out of the way: the
	   whole point of live-apply is seeing the widget change, and a card sitting
	   on top of it would be the one thing you could not see. A ring is left
	   behind so it stays obvious WHICH widget is being styled. */
	.ws-overlay.editing {
		background: transparent;
		outline: 2px solid var(--color-primary-500);
		outline-offset: -2px;
	}
	/* `visibility`, NOT `display: none`: the Edit/New buttons in this card are
	   the popover's anchor, and an anchor with no box sends the editor to the
	   corner of the viewport instead of alongside the widget it belongs to.
	   Hidden this way it keeps its box, drops out of the tab order, and paints
	   nothing over the widget being styled. */
	.ws-overlay.editing .ws-card {
		visibility: hidden;
		pointer-events: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.ws-overlay {
			transition: none;
		}
	}

	.ws-card {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		max-inline-size: 100%;
		max-block-size: 100%;
		overflow: auto;
		padding: 0.45rem 0.55rem;
		border-radius: 0.6rem;
		border: 1px solid
			color-mix(in oklab, var(--color-surface-500) 30%, transparent);
		background: var(--color-surface-50);
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.16);
	}
	:global([data-mode="dark"]) .ws-card {
		background: var(--color-surface-900);
	}
	.ws-card-head {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.7rem;
		font-weight: 650;
		color: var(--color-surface-700);
	}
	:global([data-mode="dark"]) .ws-card-head {
		color: var(--color-surface-200);
	}
	.ws-card-title {
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ws-card :global(.ws-select) {
		inline-size: min(14rem, 100%);
	}
	.ws-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	/* Buttons and fields carry their own small sheet rather than borrowing the
	   editor toolbar's: Svelte scopes styles per component, and the tokens are
	   the same ones the toolbar uses, which is what keeps them looking alike.

	   `:global(.ws-btn)` under a wrapper that IS ours, because two of these
	   buttons are rendered by `Popover.Trigger` — a component, so Svelte's
	   scoping hash never lands on them and a plain `.ws-btn` would style the
	   four buttons in this row differently from each other. */
	.ws-card :global(.ws-btn),
	.ws-editor :global(.ws-btn) {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.24rem 0.5rem;
		border-radius: 0.45rem;
		font-size: 0.7rem;
		font-weight: 600;
		background: color-mix(
			in oklab,
			var(--color-surface-200) 80%,
			transparent
		);
		color: var(--color-surface-700);
	}
	:global([data-mode="dark"]) .ws-card :global(.ws-btn),
	:global([data-mode="dark"]) .ws-editor :global(.ws-btn) {
		background: color-mix(
			in oklab,
			var(--color-surface-800) 80%,
			transparent
		);
		color: var(--color-surface-300);
	}
	.ws-card :global(.ws-btn:hover:not(:disabled)),
	.ws-editor :global(.ws-btn:hover:not(:disabled)) {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 20%,
			transparent
		);
	}
	.ws-card :global(.ws-btn:disabled),
	.ws-editor :global(.ws-btn:disabled) {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.ws-editor :global(.ws-btn.primary) {
		background: var(--color-primary-500);
		color: var(--color-primary-contrast-500, white);
	}
	.ws-card :global(.ws-btn.danger) {
		background: var(--color-error-500);
		color: var(--color-error-contrast-500, white);
	}

	.ws-editor {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.ws-editor-head {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.72rem;
		font-weight: 650;
		color: var(--color-surface-700);
	}
	:global([data-mode="dark"]) .ws-editor-head {
		color: var(--color-surface-200);
	}
	.ws-spacer {
		flex: 1;
	}
	.ws-field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.ws-field-label {
		font-size: 0.66rem;
		font-weight: 650;
		color: var(--color-surface-600);
	}
	:global([data-mode="dark"]) .ws-field-label {
		color: var(--color-surface-300);
	}
	.ws-input {
		padding: 0.24rem 0.45rem;
		border-radius: 0.42rem;
		border: 1px solid
			color-mix(in oklab, var(--color-surface-500) 35%, transparent);
		font-size: 0.72rem;
		background: color-mix(
			in oklab,
			var(--color-surface-50) 80%,
			transparent
		);
		color: var(--color-surface-800);
	}
	:global([data-mode="dark"]) .ws-input {
		background: color-mix(
			in oklab,
			var(--color-surface-800) 70%,
			transparent
		);
		color: var(--color-surface-100);
	}
	.ws-css {
		inline-size: 100%;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.7rem;
		resize: vertical;
	}
	.ws-hint {
		font-size: 0.66rem;
		line-height: 1.45;
		color: var(--color-surface-500);
	}
	.ws-hint code {
		font-size: 0.64rem;
	}
	.ws-vars {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.25rem;
	}
	.ws-var-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	.ws-var-row .ws-input {
		inline-size: 9rem;
	}
	.ws-seg {
		display: inline-flex;
		gap: 0.15rem;
		padding: 0.12rem;
		border-radius: 0.5rem;
		background: color-mix(
			in oklab,
			var(--color-surface-500) 12%,
			transparent
		);
	}
	.ws-seg-btn {
		padding: 0.18rem 0.5rem;
		border-radius: 0.38rem;
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--color-surface-600);
	}
	:global([data-mode="dark"]) .ws-seg-btn {
		color: var(--color-surface-400);
	}
	.ws-seg-btn.active {
		background: var(--color-primary-500);
		color: var(--color-primary-contrast-500, white);
	}
	.ws-editor-actions {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.ws-form-error {
		padding: 0.3rem 0.5rem;
		border-radius: 0.45rem;
		font-size: 0.7rem;
		background: color-mix(
			in oklab,
			var(--color-error-500) 15%,
			transparent
		);
		color: var(--color-error-700, var(--color-error-500));
	}
	:global([data-mode="dark"]) .ws-form-error {
		color: var(--color-error-200, var(--color-error-400));
	}
</style>
