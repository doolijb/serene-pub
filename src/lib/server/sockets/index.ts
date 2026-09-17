/**
 * Socket Registration Hub
 *
 * This file registers all socket handlers for the application using modular registration functions.
 * Each handler module exports its own registration function to keep handlers grouped logically.
 *
 * MIGRATION STATUS:
 * ✅ All modules: Fully migrated to type-safe handlers with modular registration
 * ✅ Refactored: Individual imports replaced with registration functions per module
 *
 * ARCHITECTURE:
 * �️ MODULAR REGISTRATION: Each module exports a registration function
 * 🎯 TYPE SAFETY: All handlers use Handler<Params, Ack> interface
 * 🔧 MAINTAINABILITY: Clean separation of concerns, easy to add/modify handlers
 *
 * PROGRESS: 🎉 100% complete with modular architecture - Production ready!
 */

import type { Handler } from "$lib/shared/events"
import { registerConnectionHandlers } from "./connections"
import { registerLocalOnnxModelHandlers } from "./localOnnxModels"
import { registerConnectionDefaultsHandlers } from "./connectionDefaults"
import { registerImageHandlers } from "./images"
import { registerPluginHandlers } from "./plugins"
import { registerSamplingConfigHandlers } from "./samplingConfigs"
import { registerCompletionTemplateHandlers } from "./completionTemplates"
import { registerCharacterHandlers } from "./characters"
import { registerCharacterFolderHandlers } from "./characterFolders"
import { registerContextConfigHandlers } from "./contextConfigs"
import { registerSessionHandlers } from "./sessions"
import { registerPromptConfigHandlers } from "./promptConfigs"
import { registerNarratorPromptConfigHandlers } from "./narratorPromptConfigs"
import { registerGraphBuildConfigHandlers } from "./graphBuildConfigs"
import { registerUserHandlers } from "./users"
import { registerUserSettingsHandlers } from "./userSettings"
import { registerLanguageHandlers } from "./language"
import { registerLorebookHandlers } from "./lorebooks"
import { registerEntryHandlers } from "./entries"
import { registerBindingSuggestionHandlers } from "./bindingSuggestions"
import { registerMediaHandlers } from "./media"
import { registerTagHandlers } from "./tags"
import { registerSystemSettingsHandlers } from "./systemSettings"
import { registerOllamaHandlers } from "./ollama"
import { registerKoboldCppHandlers } from "./koboldcpp"
import { registerSummarizeHandlers } from "./summarize"
import { registerVectorizationHandlers } from "./vectorization"
import { registerNerHandlers } from "./ner"
import { registerSceneHandlers } from "./scenes"
import { registerNarrativeGraphHandlers } from "./narrativeGraph"
import { registerSummarizePromptConfigHandlers } from "./summarizePromptConfigs"
import { registerImportHandlers } from "./import"
import { registerSetupHandlers } from "./setup"
import { registerTaskQueueHandlers } from "./taskQueue"
import { registerActivityHandlers } from "./activity"
import { registerCustomThemeHandlers } from "./customThemes"
import { registerWidgetStyleHandlers } from "./widgetStyles"
import { registerStateHandlers } from "./state"
import { registerCardSourceHandlers } from "./cardSources"
import { registerPipelineHandlers } from "./pipelines"
import { registerSessionAdminHandlers } from "./sessionAdmin"
import { registerTunnelHandlers } from "./tunnels"
import { registerAllowedHostHandlers } from "./allowedHosts"
import { registerBackupHandlers } from "./backups"
import { registerTotpHandlers } from "./totp"
import { registerAccountHandlers } from "./account"
import { registerInviteHandlers } from "./invites"
import { registerJumpHandlers } from "./jump"
import { isBlockedDuringSetup } from "$lib/server/auth/setupGate"
import { archivedWrite } from "./legacyArchive"
import { redactConnections } from "$lib/server/connections/visibility"
import { isGatedEvent, scopeOfPayload } from "$lib/shared/sockets/interest"
import {
	interestedSockets,
	registerInterestHandlers,
	socketsInUserRoom,
	socketWantsAnyScope,
	type InterestIo,
	type InterestSocket
} from "./interest"

export function connectSockets(io: {
	on: (arg0: string, arg1: (socket: any) => void) => void
	to: (room: string) => any
	// Read only by the interest gate, which needs to know who is in a user's
	// room and what each of them declared. See `./interest.ts`.
	sockets: InterestIo["sockets"]
}) {
	io.on("connect", (socket) => {
		// authMiddleware (registered via io.use before connectSockets runs)
		// authenticates the connection and sets socket.user before "connect"
		// fires — it also disconnects unauthenticated sockets before this
		// point, so this should never actually be missing in practice.
		const userId = socket.user?.id
		if (!userId) {
			console.error(
				`Socket ${socket.id} connected with no authenticated user — disconnecting`
			)
			socket.disconnect()
			return
		}

		// Attach io to socket for use in handlers
		socket.io = io
		socket.join("user_" + userId)

		// The interest set appears in the same breath as the room membership,
		// because the gate walks the room to find it: a socket that is in
		// `user_<id>` and has no `interest` yet would make every walk answer
		// for `undefined`. Empty means "wants nothing gated", which is the
		// right answer for a client that has not synced yet — and phase 1 gates
		// no events at all, so nothing is lost while it is.
		socket.interest = new Set<string>()

		// Helper to emit to this socket's own user room
		//
		// Connections are redacted HERE rather than in each handler, for the
		// same reason as the setup gate and the archive check below: a handler
		// added later cannot forget a rule it never had to know about. The
		// review card is what forgetting looks like — every connection WRITE
		// was guarded, and a read-shaped surface handed a non-admin the blob
		// anyway (see `connections/visibility.ts`).
		//
		// The room is this socket's own user, so `socket.user` is the
		// recipient. Demotion force-disconnects that user's sockets
		// (`users.privilegeRevocation.int.test.ts`), so the flag cannot go
		// stale under a live connection.
		//
		// ## The interest gate, and the lazy form
		//
		// `data` may be a THUNK — `() => data | Promise<data>`. For a GATED
		// event it runs only when some socket in the room declared the key, so
		// the cascade's query is never paid for a reply nobody is listening
		// for; skipping the emit alone would save nothing, the query is the
		// cost. For everything else it behaves exactly as it always has: one
		// room emit, one redaction, no gate — which is what keeps the migration
		// free of a dark period, since `GATED_EVENTS` is empty until a family's
		// last consumer has moved to the client registry.
		//
		// ⚠ Plain data on an ungated event stays SYNCHRONOUS and returns void,
		// as every one of the ~874 existing call sites expects. Only a thunk
		// makes this return a promise, and a thunk that rejects is caught and
		// logged here rather than escaping as an unhandled rejection — the call
		// sites do not await this.
		function emitToUser(
			event: string,
			data: any | (() => any | Promise<any>)
		): void | Promise<void> {
			const room = "user_" + userId

			if (!isGatedEvent(event)) {
				if (typeof data !== "function") {
					io.to(room).emit(
						event,
						redactConnections(data, socket.user)
					)
					return
				}
				return evaluate(event, data).then((box) => {
					if (!box) return
					io.to(room).emit(
						event,
						redactConnections(box.value, socket.user)
					)
				})
			}

			// Gated: per-socket delivery (ruling 5). No interested socket means
			// no query and no emit at all.
			//
			// Redacted from the RECIPIENT's own `user` rather than from this
			// closure's, even though every socket in a user room carries the
			// same subject. The invariant the review card broke — a payload
			// leaves the server redacted for whoever receives it — is one that
			// should be readable at the emit, not inferred from the room's
			// name. `withoutConnectionIdentity` returns the very same object
			// when a payload names no connection, so the repeat costs one walk.
			const deliver = (wanted: InterestSocket[], value: any) => {
				for (const target of wanted)
					io.to(target.id).emit(
						event,
						redactConnections(value, target.user)
					)
			}

			// A scoped event is wanted per scope (`SCOPED_EVENTS`), and the
			// scope is in the payload — so plain data can be asked the exact
			// question straight away. An event with no entry there extracts
			// null, which is the bare key: unchanged for every event gated
			// before phase 3.
			if (typeof data !== "function") {
				const wanted = interestedSockets(
					io,
					userId,
					event,
					scopeOfPayload(event, data)
				)
				if (wanted.length === 0) return
				deliver(wanted, data)
				return
			}

			// A thunk's scope does not exist until the thunk has run, so the
			// gate asks the weaker question first — does anybody in the room
			// want ANY scope of this event — and skips the query when nobody
			// does. The exact scope is read off the payload afterwards, so a
			// socket watching another session is dropped at delivery rather
			// than being served somebody else's rows.
			if (
				!socketsInUserRoom(io, userId).some((s) =>
					socketWantsAnyScope(s, event)
				)
			)
				return
			return evaluate(event, data).then((box) => {
				if (!box) return
				// Walked again rather than snapshotted: the scope is only now
				// knowable, and a socket that arrived or left while the query
				// ran should be treated as it is now.
				const wanted = interestedSockets(
					io,
					userId,
					event,
					scopeOfPayload(event, box.value)
				)
				if (wanted.length) deliver(wanted, box.value)
			})
		}

		// Register all handlers by module
		//
		// Interest first: `interest:sync` is what every gated reply below
		// consults, and a client sends it before the request it wants answered.
		registerInterestHandlers(socket, emitToUser, register)
		registerUserHandlers(socket, emitToUser, register)
		registerUserSettingsHandlers(socket, emitToUser, register)
		registerLanguageHandlers(socket, emitToUser, register)
		registerSamplingConfigHandlers(socket, emitToUser, register)
		registerCompletionTemplateHandlers(socket, emitToUser, register)
		registerConnectionHandlers(socket, emitToUser, register)
		// The files behind the two local ONNX endpoints: download, cancel,
		// remove, add by Hub id. Its own module because every one of them is
		// about this machine's disk rather than about a connection row.
		registerLocalOnnxModelHandlers(socket, emitToUser, register)
		registerConnectionDefaultsHandlers(socket, emitToUser, register)
		registerImageHandlers(socket, emitToUser, register)
		registerPluginHandlers(socket, emitToUser, register)
		registerOllamaHandlers(socket, emitToUser, register)
		registerKoboldCppHandlers(socket, emitToUser, register)
		registerSystemSettingsHandlers(socket, emitToUser, register)
		registerCharacterHandlers(socket, emitToUser, register)
		registerCharacterFolderHandlers(socket, emitToUser, register)
		registerCardSourceHandlers(socket, emitToUser, register)
		registerContextConfigHandlers(socket, emitToUser, register)
		registerPromptConfigHandlers(socket, emitToUser, register)
		registerNarratorPromptConfigHandlers(socket, emitToUser, register)
		registerGraphBuildConfigHandlers(socket, emitToUser, register)
		registerSummarizePromptConfigHandlers(socket, emitToUser, register)
		registerSessionHandlers(socket, emitToUser, register)
		registerLorebookHandlers(socket, emitToUser, register)
		registerEntryHandlers(socket, emitToUser, register)
		registerBindingSuggestionHandlers(socket, emitToUser, register)
		registerTagHandlers(socket, emitToUser, register)
		registerMediaHandlers(socket, emitToUser, register)
		registerSummarizeHandlers(socket, emitToUser, register)
		registerVectorizationHandlers(socket, emitToUser, register)
		registerNerHandlers(socket, emitToUser, register)
		registerSceneHandlers(socket, emitToUser, register)
		registerNarrativeGraphHandlers(socket, emitToUser, register)
		registerImportHandlers(socket, emitToUser, register)
		registerSetupHandlers(socket, emitToUser, register)
		registerTaskQueueHandlers(socket, emitToUser, register)
		registerActivityHandlers(socket)
		registerCustomThemeHandlers(socket, emitToUser, register)
		registerWidgetStyleHandlers(socket, emitToUser, register)
		registerStateHandlers(socket, emitToUser, register)
		registerPipelineHandlers(socket, emitToUser, register)
		registerSessionAdminHandlers(socket, emitToUser, register)
		registerTunnelHandlers(socket, emitToUser, register)
		registerAllowedHostHandlers(socket, emitToUser, register)
		registerBackupHandlers(socket, emitToUser, register)
		registerTotpHandlers(socket, emitToUser, register)
		registerAccountHandlers(socket, emitToUser, register)
		registerInviteHandlers(socket, emitToUser, register)
		registerJumpHandlers(socket, emitToUser, register)
		console.log(`Socket connected: ${socket.id} for user ${userId}`)
	})
}

/**
 * MODULAR ARCHITECTURE COMPLETE! 🎉
 *
 * All socket functions have been successfully migrated to type-safe handlers using modular
 * registration functions. Each module now manages its own handler registration.
 *
 * ✅ BENEFITS ACHIEVED:
 * - Type safety for all socket parameters and responses
 * - Consistent error handling with {event}:error pattern
 * - Standardized Handler<Params, Ack> interface across all modules
 * - Modular registration functions per module for better organization
 * - Reduced coupling between modules and central registration
 * - Easy to add/modify handlers within each module
 *
 * ✅ ARCHITECTURE:
 * - Each module exports a register{Module}Handlers() function
 * - Central index.ts imports only registration functions, not individual handlers
 * - Clean separation of concerns with logical grouping
 * - Consistent patterns across all modules
 *
 * 📊 FINAL STATISTICS:
 * - 54+ handlers migrated to type-safe pattern
 * - 12 modules with modular registration functions
 * - 100% migration and refactoring complete
 *
 * The register() function handles all type-safe handlers that implement:
 * - Handler<Params, Ack> interface from $lib/shared/events
 * - Consistent error handling with {event}:error pattern
 * - Type safety for parameters and responses via Socket namespace types
 */

/**
 * Run a lazy payload, boxed.
 *
 * Boxed rather than returned bare so a thunk that legitimately produces
 * `undefined` or `null` is still emitted — `null` is a payload, a failure is
 * not. A rejection is logged and swallowed: `emitToUser`'s call sites do not
 * await it, so a throw here would surface as an unhandled rejection rather than
 * as the missing emit it actually is.
 */
async function evaluate(
	event: string,
	thunk: () => any | Promise<any>
): Promise<{ value: any } | null> {
	try {
		return { value: await thunk() }
	} catch (error) {
		console.error(`Error building the payload for ${event}:`, error)
		return null
	}
}

function register(
	socket: any,
	handler: Handler<any, any>,
	emitToUser: (event: string, data: any) => void
) {
	socket.on(handler.event, async (message: any) => {
		// A session that still owes setup — a password to choose, a second
		// factor to enrol (27 §1) — may only use what it needs to finish.
		// Enforced
		// here rather than per-handler for the same reason as the archived
		// check below — a handler added later cannot forget a gate it never
		// had to know about.
		//
		// The flag is computed once at handshake. A tab that verifies elsewhere
		// keeps a stale `true` until it reconnects, which fails closed (it sees
		// refusals, never unauthorized access) and is what the post-verification
		// reload resolves.
		if (
			socket.pendingSetup?.length &&
			isBlockedDuringSetup(handler.event)
		) {
			emitToUser(`${handler.event}:error`, {
				error:
					socket.pendingSetup[0] === "password"
						? "Set a new password to continue."
						: "Two-factor authentication is required to continue."
			})
			return
		}

		// The 0.5 config tables are readable and nothing else. Checked here
		// rather than in each of their handlers so a handler added to one of
		// those namespaces later cannot forget — see `legacyArchive.ts`.
		const archived = archivedWrite(handler.event)
		if (archived) {
			emitToUser(archived.event, { error: archived.message })
			return
		}

		// Many handlers catch their own errors, emit a specific
		// `{event}:error` with a useful message via emitToUser, then
		// re-throw so this wrapper's catch below also runs (eg. for
		// logging). Wrapping emitToUser here to notice that emit means the
		// generic fallback below can skip re-emitting the same event with a
		// generic, less useful message — without needing every handler to
		// coordinate this explicitly.
		let specificErrorEmitted = false
		const trackedEmitToUser = (event: string, data: any) => {
			if (event === `${handler.event}:error`) specificErrorEmitted = true
			// Forwarded, not discarded: a handler that passes a thunk gets back
			// the promise it may want to await before it returns.
			return emitToUser(event, data)
		}
		try {
			await handler.handler(socket, message, trackedEmitToUser)
		} catch (error) {
			console.error(`Error handling event ${handler.event}:`, error)
			if (specificErrorEmitted) return
			const userId = socket.user?.id
			if (userId) {
				// ⚠ Deliberately the raw room emit rather than `emitToUser`, so
				// the interest gate can never reach it (plan ruling 2: gate
				// outputs, never failures). A client that declared interest in
				// an event declared interest in being TOLD IT FAILED; a gate
				// here would turn a request the client is waiting on into
				// silence, which is the one failure mode a fire-and-forget
				// command cannot recover from. The sentence is a constant and
				// names nothing, so it needs no redaction either.
				socket.io.to("user_" + userId).emit(`${handler.event}:error`, {
					error: "An error occurred while processing your request."
				})
			}
		}
	})
}
