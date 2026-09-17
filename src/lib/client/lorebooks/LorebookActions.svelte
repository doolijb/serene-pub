<script lang="ts">
	import { getContext } from "svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import type { SpecV3 } from "@lenml/char-card-reader"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { downloadBlob } from "$lib/client/utils/downloadBlob"
	import { attachLorebookToSession } from "$lib/client/utils/attachLorebookToSession"
	import FileDropzone from "$lib/client/components/FileDropzone.svelte"
	import NewLorebookDialog from "$lib/client/components/lorebookForms/NewLorebookDialog.svelte"
	import ImportConflictModal from "$lib/client/components/modals/ImportConflictModal.svelte"
	import LorebookExportOptionsModal from "$lib/client/components/modals/LorebookExportOptionsModal.svelte"
	import { copyName } from "./bookCopy"

	/**
	 * Everything that happens to a lorebook as a whole — create, import,
	 * export, delete — with its modals and the socket traffic they need. The
	 * workspace decides *when* one of these opens; what each one then does
	 * lives here, so the workspace is about navigation and nothing else.
	 */
	interface Props {
		creating: boolean
		importing: boolean
		exportingId: number | null
		deletingId: number | null
		/**
		 * The book being copied, and what it is called.
		 *
		 * The name travels with the id because the prompt is pre-filled with
		 * the copy's suggested name, and this component holds no list of books
		 * to look one up in.
		 */
		duplicating: { id: number; name: string } | null
		/** Hidden rather than disabled when the checkbox would do nothing. */
		canOfferAttachToSession: boolean
		/** So a book that is open can be left when it stops existing. */
		onDeleted?: (id: number) => void
		/** So the copy is what the workspace is looking at afterwards. */
		onDuplicated?: (id: number) => void
	}

	let {
		creating = $bindable(false),
		importing = $bindable(false),
		exportingId = $bindable(null),
		deletingId = $bindable(null),
		duplicating = $bindable(null),
		canOfferAttachToSession,
		onDeleted,
		onDuplicated
	}: Props = $props()

	const socket = useTypedSocket()
	const openSessionCtx: OpenSessionCtx = getContext("openSessionCtx")

	let importingBook: SpecV3.Lorebook | undefined = $state(undefined)
	let importConflict:
		| { existingLorebook: any; lorebookData: object }
		| undefined = $state(undefined)
	let showImportConflictModal: boolean = $state(false)

	/**
	 * Set when the user ticked "attach to this session" so the
	 * `lorebooks:create` broadcast can be matched back to this request.
	 * Correlating on the submitted name rather than a bare boolean — see the
	 * same reasoning in SummarizeLoreModal.handleLorebookCreate.
	 */
	let pendingAttachName: string | null = $state(null)

	/** What the copy will be called, as the reader may still edit it. */
	let duplicateName: string = $state("")
	/** A copy is a whole export and import, so the button says it is working. */
	let duplicatePending: boolean = $state(false)

	// The suggestion follows the book being copied and nothing else: a
	// keystroke in the box changes `duplicateName` alone, so what the reader
	// types is never overwritten by the name they started from.
	$effect(() => {
		const book = duplicating
		if (!book) return
		duplicateName = copyName(book.name)
		duplicatePending = false
	})

	function handleCreateConfirm(details: {
		name: string
		attachToSession: boolean
	}) {
		if (!details.name.trim()) return
		creating = false
		const trimmed = details.name.trim()
		// Only claim the create when the switch was both shown and on;
		// `attachToSession` is meaningless if the modal rendered no switch.
		pendingAttachName =
			details.attachToSession && canOfferAttachToSession ? trimmed : null
		const req: Sockets.Lorebooks.Create.Params = { name: trimmed }
		socket.emit("lorebooks:create", req)
	}

	function handleFileImport(details: FileAcceptDetails) {
		if (!details.files || details.files.length === 0) return
		const file = details.files[0]

		if (file.type !== "application/json") {
			toaster.error({
				title: "Invalid file type. Please upload a JSON file."
			})
			return
		}

		const reader = new FileReader()
		reader.onload = function (e) {
			try {
				const json: SpecV3.Lorebook = JSON.parse(
					e.target?.result as string
				)
				let entries = json.entries
				if (entries && !Array.isArray(entries)) {
					entries = Object.values(entries)
				}
				// Normalize both 'key' and 'keys' fields for every entry
				entries = (entries || []).map((entry) => {
					// @ts-ignore
					let keyArr = entry.key
					if (!Array.isArray(keyArr)) {
						keyArr =
							entry.keys && Array.isArray(entry.keys)
								? entry.keys
								: keyArr
									? [keyArr]
									: []
					}
					let keysArr = entry.keys
					if (!Array.isArray(keysArr)) {
						keysArr = keyArr
					}
					// @ts-ignore
					let keysecondaryArr = entry.keysecondary
					if (!Array.isArray(keysecondaryArr)) {
						keysecondaryArr = keysecondaryArr
							? [keysecondaryArr]
							: []
					}
					return {
						...entry,
						key: keyArr,
						keys: keysArr,
						keysecondary: keysecondaryArr
					}
				})
				importingBook = {
					...json,
					entries: entries,
					name: json.name || "",
					description: json.description || "",
					extensions: json.extensions || {}
				}
			} catch (err) {
				toaster.error({ title: "Invalid JSON file" })
			}
		}
		reader.readAsText(file)
	}

	function handleImportConfirm() {
		if (importingBook && importingBook.name?.trim()) {
			const req: Sockets.Lorebooks.Import.Params = {
				lorebookData: importingBook
			}
			socket.emit("lorebooks:import", req)
			importing = false
			importingBook = undefined
		}
	}

	function handleConfirmExportOptions(options: {
		includeCharacters: boolean
		includePersonas: boolean
		includeNarrativeGraph: boolean
	}) {
		if (exportingId === null) return
		socket.emit("lorebooks:export", { id: exportingId, ...options })
		exportingId = null
	}

	function handleOverwriteImportConflict() {
		if (!importConflict) return
		const req: Sockets.Lorebooks.ImportResolve.Params = {
			action: "overwrite",
			lorebookData: importConflict.lorebookData,
			existingId: importConflict.existingLorebook.id
		}
		socket.emit("lorebooks:importResolve", req)
		showImportConflictModal = false
		importConflict = undefined
	}

	function handleImportAsNewFromConflict() {
		if (!importConflict) return
		const req: Sockets.Lorebooks.ImportResolve.Params = {
			action: "createNew",
			lorebookData: importConflict.lorebookData,
			existingId: importConflict.existingLorebook.id
		}
		socket.emit("lorebooks:importResolve", req)
		showImportConflictModal = false
		importConflict = undefined
	}

	function handleDeleteConfirm() {
		if (deletingId === null) return
		const id = deletingId
		const req: Sockets.Lorebooks.Delete.Params = { id }
		socket.emit("lorebooks:delete", req)
		toaster.success({ title: "Lorebook Deleted" })
		deletingId = null
		onDeleted?.(id)
	}

	function handleDuplicateConfirm() {
		if (!duplicating || duplicatePending) return
		duplicatePending = true
		socket.emit("lorebooks:duplicate", {
			lorebookId: duplicating.id,
			name: duplicateName.trim() || copyName(duplicating.name)
		} satisfies Sockets.Lorebooks.Duplicate.Params)
	}

	/**
	 * The copy landed.
	 *
	 * ⚠ Only for a copy this component asked for. The channel is the user's
	 * rather than this prompt's, and opening a book somebody else's surface
	 * made would move the reader out of what they were doing. Closing the
	 * prompt does not cancel the ask: the copy is being made either way, so
	 * the answer still says so and still opens it.
	 */
	function handleLorebooksDuplicate(
		msg: Sockets.Lorebooks.Duplicate.Response
	) {
		if (!msg.lorebook || !duplicatePending) return
		duplicating = null
		duplicatePending = false
		toaster.success({
			title: "Lorebook Duplicated",
			description: `"${msg.lorebook.name}" is ready.`
		})
		onDuplicated?.(msg.lorebook.id)
	}

	/**
	 * The copy was refused.
	 *
	 * No toast of its own: `lorebooks:duplicate:error` is not in Layout's
	 * handled set, so the generic listener there already says what went wrong.
	 * This exists so the prompt stops claiming to be working and the reader
	 * can try again or close it.
	 */
	function handleLorebooksDuplicateError() {
		duplicatePending = false
	}

	function handleLorebooksCreate(msg: Sockets.Lorebooks.Create.Response) {
		if (!msg.lorebook) return
		toaster.success({
			title: "Lorebook Created",
			description: `"${msg.lorebook.name}" created successfully.`
		})
		// Server automatically emits updated list
		if (
			pendingAttachName !== null &&
			msg.lorebook.name === pendingAttachName &&
			openSessionCtx.sessionId !== null
		) {
			pendingAttachName = null
			attachLorebookToSession(
				socket,
				openSessionCtx.sessionId,
				msg.lorebook.id
			)
		}
	}

	function handleLorebooksImport(msg: Sockets.Lorebooks.Import.Response) {
		if (msg.status === "conflict" && msg.conflict) {
			importConflict = msg.conflict
			showImportConflictModal = true
			return
		}
		if (msg.status === "unchanged") {
			toaster.success({
				title: "Already Imported",
				description: `"${msg.lorebook?.name}" is unchanged. Using the existing lorebook.`
			})
			return
		}
		toaster.success({ title: "Lorebook Imported" })
	}

	function handleLorebooksImportError(msg: Sockets.ErrorResponse) {
		toaster.error({ title: msg.error || "Failed to import lorebook" })
	}

	function handleLorebooksImportResolve() {
		toaster.success({ title: "Lorebook Imported" })
	}

	function handleLorebooksImportResolveError(msg: Sockets.ErrorResponse) {
		toaster.error({
			title: msg.error || "Failed to resolve lorebook import"
		})
	}

	function handleLorebooksExport(msg: Sockets.Lorebooks.Export.Response) {
		downloadBlob(msg)
		toaster.success({
			title: "Lorebook Exported",
			description: `Lorebook exported as ${msg.filename}`
		})
	}

	function handleLorebooksExportError(msg: Sockets.ErrorResponse) {
		toaster.error({ title: msg.error || "Failed to export lorebook" })
	}

	function handleLorebooksDelete() {
		toaster.success({ title: "Lorebook Deleted" })
	}

	/**
	 * Every key here is BARE. These are the book-level actions — make, bring
	 * in, take out, copy, remove — and not one of their replies names a book
	 * in `SCOPED_EVENTS`, so a scoped key would match nothing at all. The bar
	 * is the same for the five `:error` events beside them: never gated (plan
	 * ruling 2 — an error is not an output to skip), but the registry is the
	 * only listener path.
	 */
	useInterest<"lorebooks:create">("lorebooks:create", handleLorebooksCreate)
	useInterest<"lorebooks:import">("lorebooks:import", handleLorebooksImport)
	useInterest<"lorebooks:import:error">(
		"lorebooks:import:error",
		handleLorebooksImportError
	)
	useInterest<"lorebooks:importResolve">(
		"lorebooks:importResolve",
		handleLorebooksImportResolve
	)
	useInterest<"lorebooks:importResolve:error">(
		"lorebooks:importResolve:error",
		handleLorebooksImportResolveError
	)
	useInterest<"lorebooks:export">("lorebooks:export", handleLorebooksExport)
	useInterest<"lorebooks:export:error">(
		"lorebooks:export:error",
		handleLorebooksExportError
	)
	useInterest<"lorebooks:delete">("lorebooks:delete", handleLorebooksDelete)
	useInterest<"lorebooks:duplicate">(
		"lorebooks:duplicate",
		handleLorebooksDuplicate
	)
	useInterest<"lorebooks:duplicate:error">(
		"lorebooks:duplicate:error",
		handleLorebooksDuplicateError
	)
</script>

<NewLorebookDialog
	bind:open={creating}
	onOpenChange={(details) => (creating = details.open)}
	onConfirm={handleCreateConfirm}
	onCancel={() => (creating = false)}
	onImportInstead={() => {
		creating = false
		importing = true
	}}
	{canOfferAttachToSession}
	sessionName={openSessionCtx.sessionName}
/>

{#if importConflict}
	<ImportConflictModal
		open={showImportConflictModal}
		onOpenChange={(e) => {
			showImportConflictModal = e.open
			if (!e.open) importConflict = undefined
		}}
		entityLabel="Lorebook"
		existingName={importConflict.existingLorebook.name}
		onOverwrite={handleOverwriteImportConflict}
		onImportAsNew={handleImportAsNewFromConflict}
		onCancel={() => {
			showImportConflictModal = false
			importConflict = undefined
		}}
	/>
{/if}

{#if exportingId !== null}
	<LorebookExportOptionsModal
		open={exportingId !== null}
		onOpenChange={(e) => {
			if (!e.open) exportingId = null
		}}
		onConfirm={handleConfirmExportOptions}
		onCancel={() => (exportingId = null)}
	/>
{/if}

{#if importing}
	<Dialog
		open={importing}
		onOpenChange={(e) => {
			importing = e.open
			if (!e.open) importingBook = undefined
		}}
	>
		<Portal>
			<Dialog.Backdrop
				class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
			/>
			<Dialog.Positioner
				class="fixed inset-0 z-50 flex items-center justify-center p-4"
			>
				<Dialog.Content
					class="card bg-surface-100-900 border-surface-300-700 max-w-[95vw] space-y-4 border p-4 shadow-xl"
				>
					<div class="p-6">
						<h2 class="mb-2 text-lg font-bold">Import Lorebook</h2>
						{#if !importingBook}
							<label class="mb-2" for="file-upload">
								Select a file.
							</label>
							<FileDropzone
								name="file-upload"
								accept=".json"
								onFileAccept={handleFileImport}
							/>
						{:else}
							<label class="mb-2" for="name">Name</label>
							<input
								id="name"
								type="text"
								bind:value={importingBook.name}
								placeholder="Lorebook Name"
								class="input"
							/>
						{/if}
						<div class="mt-4 flex items-end gap-2">
							<button
								class="btn preset-filled-surface-500"
								onclick={() => {
									importing = false
									importingBook = undefined
								}}
							>
								Cancel
							</button>
							{#if importingBook}
								<button
									class="btn preset-filled-primary-500"
									disabled={!importingBook?.name?.trim()}
									onclick={handleImportConfirm}
								>
									Import
								</button>
							{/if}
						</div>
					</div>
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>
{/if}

{#if duplicating}
	<Dialog
		open={duplicating !== null}
		onOpenChange={(e) => {
			if (!e.open) duplicating = null
		}}
	>
		<Portal>
			<Dialog.Backdrop
				class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
			/>
			<Dialog.Positioner
				class="fixed inset-0 z-50 flex items-center justify-center p-4"
			>
				<Dialog.Content
					class="card bg-surface-100-900 border-surface-300-700 max-w-[95vw] space-y-4 border p-4 shadow-xl"
				>
					<div class="p-6">
						<h2 class="mb-2 text-lg font-bold">
							Duplicate lorebook
						</h2>
						<p class="text-surface-700-300 mb-4 text-sm">
							The copy holds everything the book holds: entries
							and where they are filed, the cast, the
							relationships, the scenes. Nothing is read into a
							session until you say so.
						</p>
						<label class="mb-2 block" for="duplicate-name">
							Name
						</label>
						<input
							id="duplicate-name"
							type="text"
							class="input"
							bind:value={duplicateName}
							placeholder={copyName(duplicating.name)}
							disabled={duplicatePending}
						/>
						<div class="mt-4 flex items-end gap-2">
							<button
								class="btn preset-filled-surface-500"
								type="button"
								onclick={() => (duplicating = null)}
							>
								Cancel
							</button>
							<button
								class="btn preset-filled-primary-500"
								type="button"
								disabled={duplicatePending}
								onclick={handleDuplicateConfirm}
							>
								{duplicatePending ? "Copying…" : "Duplicate"}
							</button>
						</div>
					</div>
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>
{/if}

{#if deletingId !== null}
	<Dialog
		open={deletingId !== null}
		onOpenChange={(e) => {
			if (!e.open) deletingId = null
		}}
	>
		<Portal>
			<Dialog.Backdrop
				class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
			/>
			<Dialog.Positioner
				class="fixed inset-0 z-50 flex items-center justify-center p-4"
			>
				<Dialog.Content
					class="card bg-surface-100-900 border-surface-300-700 max-w-[95vw] space-y-4 border p-4 shadow-xl"
				>
					<div class="p-6">
						<h2 class="text-error-500 mb-2 text-lg font-bold">
							Delete Lorebook?
						</h2>
						<p class="mb-4">
							Are you sure you want to delete this lorebook? This
							action cannot be undone.
						</p>
						<div class="mt-4 flex items-end gap-2">
							<button
								class="btn preset-filled-surface-500"
								onclick={() => (deletingId = null)}
							>
								Cancel
							</button>
							<button
								class="btn preset-filled-error-500"
								onclick={handleDeleteConfirm}
							>
								Delete
							</button>
						</div>
					</div>
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>
{/if}
