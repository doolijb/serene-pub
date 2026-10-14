/**
 * Readiness — what each job (chat, images, embeddings, entities) is answered
 * by, and the one fix each one offers — read off the connections list and the
 * capability defaults.
 *
 * Extracted from `ConnectionIndexView` (plan 2026-10-11, lane L2) so the
 * Models view can carry the status strip and the jobs grid. Every part it
 * computes is pure and tested where it lives (`defaultsSummary`,
 * `readinessRows`, `chatFacts`, `buildJobTiles`); this file only wires them
 * to the live statuses (`useLiveStatus`) and owns the fix's emits.
 *
 * ⚠ Call during component initialisation (it reads the socket).
 */
import { useTypedSocket } from "$lib/client/sockets/typedSocket"
import { CONNECTION_SECTIONS } from "$lib/shared/constants/connectionSections"
import { defaultsSummary } from "./defaultsSummary"
import { readinessRows, type ReadinessRow } from "./readiness"
import { buildJobTiles, chatFacts } from "./jobTile"
import type { CapabilityDefaultRef } from "./modelSystemDefaults"
import type { LiveStatus } from "./liveStatus.svelte"

type Row = Sockets.Connections.List.Row & { id: number }

export interface ReadinessActions {
	/** The Set up chat stepper (U5): Runtime → Model → Done. */
	onSetUpChat: () => void
	/** The job sheet (job picker) for one job. */
	onPickJobModel: (job: string) => void
	/**
	 * A forced model listing for one connection. Absent, the fix emits
	 * `connections:syncModels` itself, as the index did.
	 */
	requestSync?: (connectionId: number, force: boolean) => void
}

const SECTION_ORDER = CONNECTION_SECTIONS.map((s) => s.starCapability)

export function useReadiness(
	getRows: () => Row[],
	getDefaults: () =>
		| Record<string, CapabilityDefaultRef | undefined>
		| undefined,
	live: Pick<LiveStatus, "factsFor">,
	actions: ReadinessActions
) {
	const socket = useTypedSocket()

	const rows = $derived(getRows())
	const summary = $derived(
		defaultsSummary(rows, getDefaults())
	)
	const readiness = $derived(readinessRows(summary.entries, live.factsFor))
	/** Chat for the status strip, and the rest as tiles. Both pure — `jobTile`. */
	const chat = $derived(chatFacts(summary.entries, readiness, rows))
	const jobTiles = $derived(
		buildJobTiles(summary.entries, readiness, SECTION_ORDER)
	)

	/**
	 * A readiness row's one fix.
	 *
	 * ⚠ None of these is a NEW write. Download and Refresh are the same emits
	 * the model rows and the ⋯ menu already made; Start is the manager's; and
	 * anything else opens the job picker, whose Use keeps the costed
	 * confirmation.
	 */
	function handleReadinessFix(row: ReadinessRow) {
		switch (row.action?.verb) {
			case "download":
				if (row.connectionId != null && row.modelId != null)
					socket.emit("connections:downloadModel", {
						id: row.connectionId,
						modelId: row.modelId
					})
				return
			case "start":
				socket.emit("koboldcpp:startSubprocess", {})
				return
			case "refresh":
				if (row.connectionId == null) return
				if (actions.requestSync)
					actions.requestSync(row.connectionId, true)
				else
					socket.emit("connections:syncModels", {
						id: row.connectionId,
						force: true
					})
				return
			default:
				// Chat with nothing able to serve it is the one case that gets
				// the guided flow: there is nothing for the job picker to
				// list, and "Set up" promised a setup, not an empty list.
				// ⚠ Only then — the flow installs KoboldCPP, and `chat.choose`
				// is the same decision the strip's label was drawn from.
				if (
					row.capability === "text->text" &&
					row.state === "unfinished" &&
					!chat.choose
				) {
					actions.onSetUpChat()
					return
				}
				actions.onPickJobModel(row.capability)
		}
	}

	/**
	 * The status strip's Set up / Fix press. Through the readiness fix, set
	 * or not: it alone decides whether the guided flow (which installs
	 * KoboldCPP) is the answer, so the strip can never install one over a
	 * service that already lists chat models (plan §A).
	 */
	function handleStripSetUp() {
		const row = readiness.find((r) => r.capability === "text->text")
		if (row) handleReadinessFix(row)
		else if (chat.choose) actions.onPickJobModel("text->text")
		else actions.onSetUpChat()
	}

	return {
		get summary() {
			return summary
		},
		get readiness() {
			return readiness
		},
		get chat() {
			return chat
		},
		get jobTiles() {
			return jobTiles
		},
		handleReadinessFix,
		handleStripSetUp
	}
}

export type Readiness = ReturnType<typeof useReadiness>
