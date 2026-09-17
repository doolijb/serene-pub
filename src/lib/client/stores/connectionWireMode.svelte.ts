import { declareInterest } from "$lib/client/sockets/interest.svelte"
import {
	wireModeFor,
	type WireMode
} from "$lib/shared/connectionAdapters/wireMode"

/**
 * Which METHOD a connection is called by, for the controls that depend on it.
 *
 * ## Why a store rather than a read off the form's own row
 *
 * The saved row's `capabilities.resolved` IS the answer, and every form already
 * holds it — so the gate could be one expression per form and nothing else. The
 * missing half is a hand toggle: `ConnectionCapabilities` sits directly under
 * these forms, owns the wire-mode switches, and deliberately never writes into
 * `connection` (see its header — doing so would make the editor's
 * unsaved-changes baseline permanently dirty). Without this the format picker
 * would appear or vanish only after the connection was closed and reopened,
 * which reads as a bug in the very control the toggle was meant to govern.
 *
 * So this listens to the ONE event that panel already emits, holds the answer
 * beside the row rather than in it, and leaves both the baseline and the panel's
 * isolation intact.
 *
 * ## Module-scoped, one declared interest
 *
 * Six forms need this and only one is mounted at a time, but the sidebar's own
 * note about nine pasted copies applies: one declaration per form is six
 * handlers racing over one event. Same shape as `completionTemplateOptions`
 * next door — the first caller starts it, everyone shares it.
 *
 * A module cannot call `useInterest` (there is no component to scope the effect
 * to), so this declares the key directly and keeps its release. Nothing calls
 * that release — the store is as long-lived as the tab — but holding it is what
 * makes ending the interest possible at all, which an anonymous `socket.on` is
 * not.
 */

/** Capabilities seen since load, by connection id. Reassigned, never mutated. */
let live = $state<Record<number, unknown>>({})
let started = false
/** The one declaration's release, held rather than thrown away. */
let release: (() => void) | null = null

function start() {
	release = declareInterest<"connections:setCapability">(
		"connections:setCapability",
		(res) => {
			if (!res?.connectionId || res.error) return
			live = { ...live, [res.connectionId]: res.capabilities }
		}
	)
}

/** What the row carries, unless a toggle in this session said otherwise. */
const capabilitiesOf = (connection: {
	id?: number | null
	capabilities?: unknown
}): { resolved?: any } =>
	((connection?.id != null ? live[connection.id] : undefined) ??
		connection?.capabilities ??
		{}) as { resolved?: any }

/**
 * The wire mode of a connection, live. Call from a component.
 *
 * Returns a getter object rather than a value so a `$derived` in the caller
 * re-runs when a toggle lands, exactly as `completionTemplateOptions` does.
 */
export function connectionWireMode() {
	if (!started) {
		started = true
		start()
	}
	return {
		of(
			connection:
				| {
						id?: number | null
						type?: string | null
						capabilities?: unknown
				  }
				| null
				| undefined
		): WireMode {
			return wireModeFor(
				connection?.type,
				capabilitiesOf(connection ?? {}).resolved
			)
		}
	}
}
