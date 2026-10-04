/**
 * Turning a manager ON is one press, and the press is in the Add menu.
 *
 * Before the 2026-09-17 concept ruling (R2) the KoboldCPP and Ollama managers
 * were doors of their own: a rail item each, a panel each, and a switch each
 * buried in Settings → System that had to be found FIRST or the door opened
 * onto a disabled screen. The managers fold into their connection now, so
 * there is exactly one place either of them is switched on — "Add → KoboldCPP,
 * run by Serene Pub" — and that place does both halves at once: the system
 * flag, and the connection row the flag is about.
 *
 * ⚠ The DB flags stay. Only the UI for them goes; the server still reads
 * `koboldCppManagerEnabled` / `ollamaManagerEnabled` to decide whether it may
 * spawn or reach a process at all.
 *
 * ## Why the plan is separated from the emit
 *
 * `managerPlan` is a pure decision — which flag, which row, and what to create
 * when there is no row — so the idempotence can be tested without a socket.
 * `enableManager` is that decision plus two emits and nothing else.
 */
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { uniqueName } from "$lib/shared/connections/connectionName"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"

export type ManagerKind = "koboldcpp" | "ollama"

/** The fields of a list row this decision reads. */
export interface ManagerRow {
	id?: number
	name?: string | null
	type?: string | null
}

export interface ManagerPlan {
	kind: ManagerKind
	/** What a person calls it, for the toast and the accessible name. */
	label: string
	/** The system-settings event that sets this manager's flag. */
	settingsEvent:
		| "systemSettings:updateKoboldCppManagerEnabled"
		| "systemSettings:updateOllamaManagerEnabled"
	/** The row that already IS this manager's connection, if there is one. */
	existingConnectionId: number | null
	/** What to create when there is none. Absent when there is one. */
	create?: Record<string, unknown>
}

const MANAGERS: Record<
	ManagerKind,
	{
		label: string
		type: string
		defaultName: string
		settingsEvent: ManagerPlan["settingsEvent"]
	}
> = {
	koboldcpp: {
		label: "KoboldCPP",
		// The TEXT row. The image row is the same install's second connection
		// (one connection names one model) and is folded into this one's view.
		type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
		defaultName: "KoboldCPP",
		settingsEvent: "systemSettings:updateKoboldCppManagerEnabled"
	},
	ollama: {
		label: "Ollama",
		type: CONNECTION_TYPE.OLLAMA,
		defaultName: "Ollama",
		settingsEvent: "systemSettings:updateOllamaManagerEnabled"
	}
}

/**
 * A name nothing else in the list has taken.
 *
 * The server refuses a duplicate connection name, and "KoboldCPP" is exactly
 * the name somebody who already added one by hand is likely to have used — so
 * the one press that is supposed to just work would fail with a toast about a
 * name the person never typed. Numbered from 2, the way a person would; the
 * rule is shared with the 0.5.3 upgrade, which names connections the same way.
 */
export { uniqueName }

export function managerPlan(
	kind: ManagerKind,
	rows: readonly ManagerRow[]
): ManagerPlan {
	const manager = MANAGERS[kind]
	const existing = rows.find((c) => c.type === manager.type && c.id != null)
	if (existing)
		return {
			kind,
			label: manager.label,
			settingsEvent: manager.settingsEvent,
			existingConnectionId: existing.id as number
		}
	return {
		kind,
		label: manager.label,
		settingsEvent: manager.settingsEvent,
		existingConnectionId: null,
		create: {
			// The type's own defaults FIRST: they carry a `type` of their own,
			// and a spread after these lines would quietly overwrite the one
			// this plan just decided.
			...(CONNECTION_DEFAULTS[manager.type] ?? {}),
			name: uniqueName(
				manager.defaultName,
				rows.map((c) => c.name ?? "")
			),
			type: manager.type,
			enabled: true
		}
	}
}

/**
 * Switch the manager on and make sure it has a connection.
 *
 * Idempotent: a second press re-asserts the flag (the server is happy to be
 * told what it already knows) and returns the row that is already there
 * rather than creating a second one.
 *
 * ⚠ `connectionId` is `null` when a row had to be created, because a create
 * is answered on `connections:create` and this function does not wait. The
 * sidebar's own handler for that event is what opens the new connection, so
 * the caller opens the id only when it gets one.
 */
export function enableManager(
	kind: ManagerKind,
	socket: TypedSocket,
	rows: readonly ManagerRow[]
): { connectionId: number | null; plan: ManagerPlan } {
	const plan = managerPlan(kind, rows)
	socket.emit(plan.settingsEvent, { enabled: true })
	if (plan.existingConnectionId == null && plan.create)
		socket.emit("connections:create", { connection: plan.create as any })
	return { connectionId: plan.existingConnectionId, plan }
}
