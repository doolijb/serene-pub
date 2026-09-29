<script lang="ts">
	/**
	 * A widget's style, as one section of its settings modal (PLAN 25; moved
	 * into the modal by the owner ruling of 2026-09-27).
	 *
	 * The section shows the widget's current style, a picker, and New, Edit,
	 * Clone and Delete. New and Edit swap the section for the style editor in
	 * place — the modal is already the room the editor needs, so it is no
	 * longer a popover of its own — and `editing` tells the modal to step
	 * aside (no scrim, docked to one edge) so the widget stays in view.
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
	 * The persisted row arrives a round trip after Save, so closing the editor
	 * and dropping the draft on the spot would repaint the widget with the
	 * PRE-save CSS and then jump to the new one. The store HOLDS the draft until the widget actually resolves to the saved row
	 * (`nextSaveState`), and this editor stays open for as long as it does. A
	 * refused write ends the hold but not the draft: the editor stays open with
	 * the reason, because the text in it is the only copy there is.
	 */
	import { getContext, onDestroy } from "svelte"
	import * as Icons from "@lucide/svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { widgetOfInstance } from "$lib/shared/widgets/instanceId"
	import {
		VAR_KEY_RE,
		canManageStyle,
		checkWidgetCss,
		createDebouncer,
		resolveWidgetStyle,
		stylePickerOptions,
		widgetStylesStore
	} from "$lib/client/stores/widgetStyles.svelte"

	interface Props {
		/** The widget being styled — the `widget_styles.widgetSlug` too. */
		widgetId: string
		/** What to call it on screen (the widget's own title). */
		label: string
		/**
		 * Which kind of widget this is, which changes exactly one thing: what
		 * the editor tells the author their CSS can reach. A `remote` widget's
		 * CSS is re-pointed at that widget's own box; a `frame` widget is a
		 * sandboxed document of its own, so `body { … }` means the frame's body.
		 */
		mount?: "remote" | "frame"
		/** Is the style editor open? Bound by the modal, which steps aside. */
		editing?: boolean
	}

	let {
		widgetId,
		label,
		mount = "remote",
		editing = $bindable(false)
	}: Props = $props()

	const styles = widgetStylesStore()
	const userCtx: UserCtx | undefined = getContext("userCtx")
	let me = $derived(
		userCtx?.user
			? { id: userCtx.user.id, isAdmin: !!userCtx.user.isAdmin }
			: null
	)

	let row = $derived(resolveWidgetStyle(widgetId))
	let manageable = $derived(row ? canManageStyle(row, me) : false)
	// The WIDGET's rows (S1): a copy (`messages#sanctum`) picks among its
	// widget's styles and pins under its own id.
	let options = $derived(
		stylePickerOptions(styles.rows, widgetOfInstance(widgetId), me?.id)
	)

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
	/** Delete is two clicks, not a confirm dialog on top of this one. */
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
					widgetSlug: widgetOfInstance(widgetId),
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

	$effect(() => {
		editing = !!draft
	})

	/**
	 * Close the editor if it is open, putting the saved style back. The modal
	 * calls this on Escape, so the key backs out of the editor before it
	 * closes the modal. Returns whether there was an editor to close.
	 */
	export function cancelEditor(): boolean {
		if (!draft) return false
		closeEditor()
		return true
	}

	// A keystroke's pending apply must not land after the modal has gone: it
	// would repaint the widget with a draft nobody can see or cancel.
	onDestroy(() => livePreview.cancel())
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
					rows="18"
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
					re-pointed at the widget's own box, so nothing here can
					reach the rest of the page.
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
					of widget, and it refuses the at-rules it cannot confine to
					a remote one.
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

{#if draft}
	{@render editorBody()}
{:else}
	<section class="ws-card" aria-labelledby="ws-style-{widgetId}">
		<h3 class="ws-section" id="ws-style-{widgetId}">
			<Icons.Palette size={12} />
			<span>Style</span>
		</h3>
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
			<button
				class="ws-btn"
				title="Make a new style for {label}"
				onclick={startNew}
			>
				<Icons.Plus size={12} />
				<span>New</span>
			</button>
			<button
				class="ws-btn"
				disabled={!manageable}
				title={manageable
					? `Edit "${row?.title}"`
					: "Built-in styles can't be edited — clone one to make your own"}
				onclick={startEdit}
			>
				<Icons.Pencil size={12} />
				<span>Edit</span>
			</button>
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
	</section>
{/if}

<style>
	/* A section heading on the same terms the settings panel labels its own,
	   so Style reads as one section of the modal. */
	.ws-section {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin: 0;
		font-size: 12px;
		font-weight: 400;
		opacity: 0.72;
	}
	/* A section of the modal, not a floating card: no border or shadow of its
	   own, a rule above it to part it from the settings over it. */
	.ws-card {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding-block-start: 0.75rem;
		border-block-start: 1px solid
			color-mix(in oklab, var(--color-surface-500) 25%, transparent);
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

	   `:global(.ws-btn)` under a wrapper that IS ours, so a button a child
	   component renders still takes the same sheet. */
	.ws-card :global(.ws-btn),
	.ws-editor :global(.ws-btn) {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.3rem 0.6rem;
		border-radius: 0.45rem;
		font-size: 13px;
		font-weight: 500;
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
		font-size: 14px;
		font-weight: 500;
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
		font-size: 12px;
		font-weight: 400;
		color: var(--color-surface-600);
	}
	:global([data-mode="dark"]) .ws-field-label {
		color: var(--color-surface-300);
	}
	.ws-input {
		padding: 0.3rem 0.5rem;
		border-radius: 0.42rem;
		border: 1px solid
			color-mix(in oklab, var(--color-surface-500) 35%, transparent);
		font-size: 14px;
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
	/* A stylesheet is written here, not glanced at: 18 lines to start from,
	   `resize` to take more, and a mono face at the same 13px the rest of the
	   editor's secondary text uses. `lh` rather than `rows`, so the floor
	   follows the line height rather than the browser's idea of a row. */
	.ws-css {
		inline-size: 100%;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 13px;
		line-height: 1.5;
		min-block-size: 18lh;
		resize: vertical;
	}
	.ws-hint {
		font-size: 12px;
		line-height: 1.45;
		color: var(--color-surface-500);
	}
	.ws-hint code {
		font-size: 12px;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
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
		padding: 0.22rem 0.55rem;
		border-radius: 0.38rem;
		font-size: 13px;
		font-weight: 500;
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
		font-size: 13px;
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
