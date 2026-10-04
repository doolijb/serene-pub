<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onMount, onDestroy, getContext, untrack } from "svelte"
	import { v4 as uuid } from "uuid"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { EditorState } from "@codemirror/state"
	import {
		EditorView,
		keymap,
		lineNumbers,
		highlightActiveLine,
		highlightActiveLineGutter
	} from "@codemirror/view"
	import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
	import { css } from "@codemirror/lang-css"
	import { oneDark } from "@codemirror/theme-one-dark"
	import {
		syntaxHighlighting,
		defaultHighlightStyle,
		bracketMatching,
		foldGutter,
		indentOnInput
	} from "@codemirror/language"
	import { searchKeymap, highlightSelectionMatches } from "@codemirror/search"
	import {
		closeBrackets,
		closeBracketsKeymap
	} from "@codemirror/autocomplete"

	interface Props {
		theme?: Sockets.CustomThemes.ThemeMeta | null
		onSaved?: (theme: Sockets.CustomThemes.ThemeMeta) => void
		onDeleted?: (id: number) => void
		onCancel?: () => void
	}

	let { theme = null, onSaved, onDeleted, onCancel }: Props = $props()

	const socket = useTypedSocket()
	const userCtx: { user: SelectUser } = getContext("userCtx")
	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	let isAccountsEnabled = $derived(
		systemSettingsCtx?.settings?.isAccountsEnabled ?? false
	)
	let isAdmin = $derived(userCtx?.user?.isAdmin ?? false)

	// Editor state
	let editorContainer: HTMLElement
	let editorView: EditorView | null = null
	let isSaving = $state(false)
	let isDeleting = $state(false)
	let isLoadingCss = $state(false)
	let confirmDelete = $state(false)

	// Form fields
	let labelField = $state(untrack(() => theme?.label ?? ""))
	// For new themes, generate a stable random ID upfront so file import can use it immediately.
	// Uses uuid's v4() rather than crypto.randomUUID() — the latter only exists in secure
	// contexts (HTTPS or localhost), which breaks self-hosted setups reached over a plain
	// http://<lan-ip> URL, a common Docker/NAS deployment pattern.
	const themeName = untrack(() => theme?.name ?? uuid())
	let cssContent = $state("")

	// Stats
	let lineCount = $state(0)
	let charCount = $state(0)

	function updateStats(content: string) {
		lineCount = content.split("\n").length
		charCount = content.length
	}

	function initEditor(initialContent = "") {
		if (editorView) editorView.destroy()

		const updateListener = EditorView.updateListener.of((update) => {
			if (update.docChanged) {
				cssContent = update.state.doc.toString()
				updateStats(cssContent)
			}
		})

		const state = EditorState.create({
			doc: initialContent,
			extensions: [
				lineNumbers(),
				highlightActiveLineGutter(),
				history(),
				foldGutter(),
				indentOnInput(),
				bracketMatching(),
				closeBrackets(),
				highlightActiveLine(),
				highlightSelectionMatches(),
				css(),
				oneDark,
				keymap.of([
					...closeBracketsKeymap,
					...defaultKeymap,
					...historyKeymap,
					...searchKeymap
				]),
				updateListener,
				EditorView.theme({
					"&": { height: "100%", fontSize: "13px" },
					".cm-scroller": {
						overflow: "auto",
						fontFamily:
							"'Fira Mono', 'Cascadia Code', 'JetBrains Mono', monospace"
					},
					".cm-content": { padding: "8px 0" },
					// The gutter's rule is the app's panel edge, not a
					// colour of its own (STYLE-GUIDE §2: tokens, never hex).
					".cm-gutters": {
						borderRight: "1px solid var(--color-surface-800)"
					}
				})
			]
		})

		editorView = new EditorView({ state, parent: editorContainer })
		cssContent = initialContent
		updateStats(initialContent)
	}

	function handleFileImport(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0]
		if (!file) return
		const reader = new FileReader()
		reader.onload = (ev) => {
			const content = (ev.target?.result as string) ?? ""
			// Strip any outer wrapper — server re-wraps with the rotating cssKey
			let stripped = content.replace(
				/^\s*\[data-theme=[^\]]*\]\s*\{([\s\S]*)\}\s*$/,
				(_, inner) => inner.trim()
			)
			if (stripped === content)
				stripped = content.replace(
					/^\s*\{([\s\S]*)\}\s*$/,
					(_, inner) => inner.trim()
				)
			editorView?.dispatch({
				changes: {
					from: 0,
					to: editorView.state.doc.length,
					insert: stripped
				}
			})
			if (!labelField) {
				labelField = file.name
					.replace(/\.(css|json)$/i, "")
					.replace(/[_-]/g, " ")
					.replace(/\b\w/g, (c) => c.toUpperCase())
			}
		}
		reader.readAsText(file)
		;(e.target as HTMLInputElement).value = ""
	}

	function save() {
		const content = editorView?.state.doc.toString() ?? ""
		if (!labelField.trim() || !content.trim()) {
			toaster.error({ title: "Label and CSS are required" })
			return
		}
		isSaving = true
		socket.emit("customThemes:save", {
			id: theme?.id,
			name: themeName,
			label: labelField,
			css: content
		})
	}

	function deleteTheme() {
		if (!theme?.id) return
		isDeleting = true
		socket.emit("customThemes:delete", { id: theme.id })
	}

	function togglePubTheme(enabled: boolean) {
		if (!theme?.id) return
		socket.emit("customThemes:setPubTheme", { id: theme.id, enabled })
	}

	// Declared through the interest registry below, which counts subscribers
	// per key: the theme manager and Layout want the same events at the same
	// time and neither teardown can silence another's. The hazard that
	// replaces is a bare `socket.off("customThemes:save")`, which removes
	// EVERY listener for that event across the whole app.
	function onGetCss(msg: Sockets.CustomThemes.GetCss.Response) {
		if (msg.name !== (theme?.name ?? themeName)) return
		isLoadingCss = false
		editorView?.dispatch({
			changes: {
				from: 0,
				to: editorView.state.doc.length,
				insert: msg.css
			}
		})
	}

	function onSave(msg: Sockets.CustomThemes.Save.Response) {
		isSaving = false
		toaster.success({ title: "Theme saved" })
		onSaved?.(msg.theme)
	}

	function onSaveError(msg: Sockets.ErrorResponse) {
		isSaving = false
		toaster.error({
			title: "Failed to save theme",
			description: msg?.error
		})
	}

	function onDelete() {
		isDeleting = false
		toaster.success({ title: "Theme deleted" })
		if (theme?.id) onDeleted?.(theme.id)
	}

	function onDeleteError(msg: Sockets.ErrorResponse) {
		isDeleting = false
		toaster.error({
			title: "Failed to delete theme",
			description: msg?.error
		})
	}

	function onSetPubTheme() {
		toaster.success({ title: "Pub theme setting updated" })
	}

	function onSetPubThemeError(msg: Sockets.ErrorResponse) {
		toaster.error({
			title: "Failed to update",
			description: msg?.error
		})
	}

	/**
	 * All seven BARE and STANDING. Bare because no `customThemes:` event is in
	 * `SCOPED_EVENTS` — `onGetCss` filters by name itself, in the handler,
	 * exactly as it did before, because CSS for every open theme arrives on
	 * this one event. Standing because this editor stays open across save,
	 * delete and pub-theme presses, each of which answers on its own key.
	 */
	useInterest<"customThemes:getCss">("customThemes:getCss", onGetCss)
	useInterest<"customThemes:save">("customThemes:save", onSave)
	useInterest<"customThemes:save:error">(
		"customThemes:save:error",
		onSaveError
	)
	useInterest<"customThemes:delete">("customThemes:delete", onDelete)
	useInterest<"customThemes:delete:error">(
		"customThemes:delete:error",
		onDeleteError
	)
	useInterest<"customThemes:setPubTheme">(
		"customThemes:setPubTheme",
		onSetPubTheme
	)
	useInterest<"customThemes:setPubTheme:error">(
		"customThemes:setPubTheme:error",
		onSetPubThemeError
	)

	onMount(() => {
		initEditor()

		// Load existing CSS if editing
		if (theme) {
			isLoadingCss = true
			socket.emit("customThemes:getCss", { name: theme.name })
		}
	})

	onDestroy(() => {
		editorView?.destroy()
	})
</script>

<!-- The chrome is the app's own (panel-edge rules, surface grounds,
     muted text) so it follows the theme being edited; only the code area is
     CodeMirror's dark editor. -->
<div
	class="panel-edge bg-surface-50-950 flex h-full flex-col overflow-hidden rounded-xl border"
>
	<!-- Editor toolbar -->
	<div
		class="panel-edge bg-surface-100-900 flex items-center gap-2 border-b px-4 py-2"
	>
		<div class="flex flex-1 items-center gap-3">
			<!-- Dot accent -->
			<span
				class="bg-primary-500 h-2.5 w-2.5 rounded-full"
				aria-hidden="true"
			></span>
			<span class="text-surface-600-400 text-xs">Custom theme</span>
		</div>
		<div class="flex items-center gap-1">
			<!-- Import file -->
			<label
				class="btn btn-sm preset-tonal-surface cursor-pointer text-xs"
				title="Import CSS/JSON file"
			>
				<Icons.Upload size={13} />
				<span>Import</span>
				<input
					type="file"
					accept=".css,.json"
					class="hidden"
					onchange={handleFileImport}
				/>
			</label>
		</div>
	</div>

	<!-- Fields row -->
	<div class="panel-edge bg-surface-100-900 border-b px-4 py-3">
		<label
			for="theme-label-input"
			class="text-surface-600-400 mb-1 block text-xs font-medium"
		>
			Display name
		</label>
		<input
			id="theme-label-input"
			type="text"
			class="input w-full text-sm"
			bind:value={labelField}
			placeholder="My Night Theme"
		/>
	</div>

	<!-- Loading overlay for CSS -->
	{#if isLoadingCss}
		<div class="bg-surface-50-950 flex flex-1 items-center justify-center">
			<Icons.Loader2 size={24} class="text-primary-500 animate-spin" />
		</div>
	{/if}

	<!-- CodeMirror editor -->
	<div
		bind:this={editorContainer}
		class="flex-1 overflow-hidden"
		class:hidden={isLoadingCss}
	></div>

	<!-- Status bar -->
	<div
		class="panel-edge bg-surface-100-900 flex items-center justify-between border-t px-4 py-1.5"
	>
		<div class="text-surface-600-400 flex items-center gap-4 text-xs">
			<span>{lineCount} lines</span>
			<span>{charCount.toLocaleString()} chars</span>
			<span aria-hidden="true">•</span>
			<span>CSS</span>
		</div>
		<div class="flex items-center gap-2">
			<!-- Admin: pub theme toggle -->
			{#if isAdmin && theme && isAccountsEnabled}
				<!-- On is tonal primary, the app's "this is on" (§2.4). -->
				<button
					class="btn btn-sm text-xs {theme.isPubTheme
						? 'preset-tonal-primary'
						: 'preset-tonal-surface'}"
					aria-pressed={theme.isPubTheme}
					onclick={() => togglePubTheme(!theme!.isPubTheme)}
					title={theme.isPubTheme
						? "Disable for all users"
						: "Enable for all users"}
				>
					<Icons.Globe size={11} />
					{theme.isPubTheme
						? "Pub theme"
						: "Make pub theme"}
				</button>
			{/if}

			<!-- Admin: uploader info -->
			{#if isAdmin && theme?.uploaderName && isAccountsEnabled}
				<span class="text-surface-600-400 text-xs">
					by {theme.uploaderName}
				</span>
			{/if}

			<!-- Delete -->
			{#if theme?.id}
				{#if confirmDelete}
					<button
						class="btn btn-sm preset-filled-error-500 text-xs"
						onclick={deleteTheme}
						disabled={isDeleting}
					>
						{#if isDeleting}<Icons.Loader2
								size={11}
								class="animate-spin"
							/>{:else}<Icons.Trash2 size={11} />{/if}
						Confirm delete
					</button>
					<button
						class="btn btn-sm preset-tonal-surface text-xs"
						onclick={() => (confirmDelete = false)}
					>
						Cancel
					</button>
				{:else}
					<button
						class="btn btn-sm preset-tonal-surface text-xs"
						onclick={() => (confirmDelete = true)}
						aria-label="Delete theme"
						title="Delete theme"
					>
						<Icons.Trash2 size={11} />
					</button>
				{/if}
			{/if}

			{#if onCancel}
				<button
					class="btn btn-sm preset-tonal-surface text-xs"
					onclick={onCancel}
				>
					Cancel
				</button>
			{/if}

			<button
				class="btn btn-sm preset-filled-primary-500 text-xs font-semibold"
				onclick={save}
				disabled={isSaving}
			>
				{#if isSaving}
					<Icons.Loader2 size={11} class="animate-spin" />
				{:else}
					<Icons.Save size={11} />
				{/if}
				{theme ? "Update" : "Create"}
			</button>
		</div>
	</div>
</div>
