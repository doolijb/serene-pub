/**
 * The typed socket facade — every event name the client may emit or listen
 * for, with its params and its response.
 *
 * ## Listening: the interest registry, and only it
 *
 * `src/lib/client/sockets/interest.svelte.ts` is the one listener path. It
 * keeps ONE raw listener per event however many views want it, hands each
 * caller a release, and tells the server which events are actually wanted
 * (**interest sync**) so a reply helper can skip the query behind an event
 * nobody is listening to. This facade therefore has no `on`/`off`/`once`:
 * phase 4 of the socket-interest plan retires them now that the last consumer
 * has moved, and with them the `off(event)` footgun that removed every
 * listener for an event across the whole app. `emit` stays — a
 * fire-and-forget command has no listener to declare.
 *
 * The one thing that is NOT interest is a catch-all: `onAny` names no event,
 * so it can declare nothing, and Layout's global error/success toasts read the
 * raw socket (`socketInstance`) directly rather than going through here.
 *
 * ## Emitting: the interest sync goes first
 *
 * `emit` flushes any pending interest sync before the packet leaves (plan
 * ruling 3), so a view may declare interest and ask for the data in the same
 * flush without the request overtaking the key its own reply needs. No call
 * site has to remember the ordering.
 *
 * Dependency direction: this module imports a VALUE from the registry, and the
 * registry imports only a TYPE (`SocketEventMap`) back — erased at build, so
 * there is no runtime cycle. Keep it that way: nothing here may be imported
 * into `interest.svelte.ts` as a value.
 */
import { flushInterestSync } from "./interest.svelte"
import { getSocket } from "./socketInstance"
import type {
	ImageProfileSchemaParams,
	ImageProfileSchemaResponse,
	ImagesCancelParams,
	ImagesCancelResponse,
	ImagesGenerateParams,
	ImagesGenerateResponse
} from "$lib/shared/sockets/imageGen"
import type { RunProgress } from "$lib/shared/sockets/progress"
import type { InterestSyncParams } from "$lib/shared/sockets/interest"
import type {
	JumpSearchParams,
	JumpSearchResponse
} from "$lib/shared/sockets/jump"

// Type mapping for socket events - this maps event names to their param/response types
export type SocketEventMap = {
	// Authentication events
	"auth:login": {
		params: Sockets.Auth.Login.Params
		response: Sockets.Auth.Login.Response
	}
	"auth:login:success": {
		params: Sockets.Auth.LoginSuccess.Params
		response: Sockets.Auth.LoginSuccess.Response
	}
	"auth:login:error": {
		params: Sockets.Auth.LoginError.Params
		response: Sockets.Auth.LoginError.Response
	}
	"auth:logout": {
		params: Sockets.Auth.Logout.Params
		response: Sockets.Auth.Logout.Response
	}
	"auth:logout:success": {
		params: Sockets.Auth.LogoutSuccess.Params
		response: Sockets.Auth.LogoutSuccess.Response
	}
	"auth:logout:error": {
		params: Sockets.Auth.LogoutError.Params
		response: Sockets.Auth.LogoutError.Response
	}

	// User events
	"users:get": {
		params: Sockets.Users.Get.Params
		response: Sockets.Users.Get.Response
	}
	"users:current": {
		params: Sockets.Users.Get.Params
		response: Sockets.Users.Get.Response
	}
	"users:setTheme": {
		params: Sockets.Users.SetTheme.Params
		response: Sockets.Users.SetTheme.Response
	}
	"users:current:setPassphrase": {
		params: Sockets.Users.SetPassphrase.Params
		response: Sockets.Users.SetPassphrase.Response
	}
	"users:current:hasPassphrase": {
		params: Sockets.Users.HasPassphrase.Params
		response: Sockets.Users.HasPassphrase.Response
	}
	"users:current:updateDisplayName": {
		params: Sockets.Users.UpdateDisplayName.Params
		response: Sockets.Users.UpdateDisplayName.Response
	}
	"users:current:changePassphrase": {
		params: Sockets.Users.ChangePassphrase.Params
		response: Sockets.Users.ChangePassphrase.Response
	}
	"users:current:logout": {
		params: Sockets.Users.Logout.Params
		response: Sockets.Users.Logout.Response
	}
	"users:current:updateDisplayName:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"users:current:changePassphrase:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"users:current:logout:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"users:list": {
		params: Sockets.Users.List.Params
		response: Sockets.Users.List.Response
	}
	"users:create": {
		params: Sockets.Users.Create.Params
		response: Sockets.Users.Create.Response
	}
	"users:create:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"users:update": {
		params: Sockets.Users.Update.Params
		response: Sockets.Users.Update.Response
	}
	"users:update:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"users:delete": {
		params: Sockets.Users.Delete.Params
		response: Sockets.Users.Delete.Response
	}
	"users:delete:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}

	// Character events
	"characters:list": {
		params: Sockets.Characters.List.Params
		response: Sockets.Characters.List.Response
	}
	"characters:list:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"characters:get": {
		params: Sockets.Characters.Get.Params
		response: Sockets.Characters.Get.Response
	}
	"characters:create": {
		params: Sockets.Characters.Create.Params
		response: Sockets.Characters.Create.Response
	}
	"characters:create:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"characters:update": {
		params: Sockets.Characters.Update.Params
		response: Sockets.Characters.Update.Response
	}
	"characters:update:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"characters:delete": {
		params: Sockets.Characters.Delete.Params
		response: Sockets.Characters.Delete.Response
	}
	"characters:delete:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"characters:importCard": {
		params: Sockets.Characters.ImportCard.Params
		response: Sockets.Characters.ImportCard.Response
	}
	"characters:importCard:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"characters:importResolve": {
		params: Sockets.Characters.ImportResolve.Params
		response: Sockets.Characters.ImportResolve.Response
	}
	"characters:importResolve:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"characters:exportCard": {
		params: Sockets.Characters.ExportCard.Params
		response: Sockets.Characters.ExportCard.Response
	}
	"characters:exportCard:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"characters:searchLibrary": {
		params: Sockets.Characters.SearchLibrary.Params
		response: Sockets.Characters.SearchLibrary.Response
	}
	"characters:searchLibrary:error": {
		params: Sockets.SearchLibraryErrorResponse
		response: Sockets.SearchLibraryErrorResponse
	}
	"characters:importFromLibrary": {
		params: Sockets.Characters.ImportFromLibrary.Params
		response: Sockets.Characters.ImportFromLibrary.Response
	}
	"characters:importFromLibrary:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"characters:listGallery": {
		params: Sockets.Characters.ListGallery.Params
		response: Sockets.Characters.ListGallery.Response
	}
	"characters:uploadGalleryImage": {
		params: Sockets.Characters.UploadGalleryImage.Params
		response: Sockets.Characters.UploadGalleryImage.Response
	}
	"characters:deleteGalleryImage": {
		params: Sockets.Characters.DeleteGalleryImage.Params
		response: Sockets.Characters.DeleteGalleryImage.Response
	}
	// Emitted by the gallery handlers' catch blocks; were missing from the map
	// (two consumers cast to any). Error events are never gated.
	"characters:listGallery:error": {
		params: Sockets.Characters.ListGallery.Params
		response: Sockets.ErrorResponse
	}
	"characters:uploadGalleryImage:error": {
		params: Sockets.Characters.UploadGalleryImage.Params
		response: Sockets.ErrorResponse
	}
	"characters:deleteGalleryImage:error": {
		params: Sockets.Characters.DeleteGalleryImage.Params
		response: Sockets.ErrorResponse
	}
	"characters:setAvatar": {
		params: Sockets.Characters.SetAvatar.Params
		response: Sockets.Characters.SetAvatar.Response
	}
	"characters:reorderGallery": {
		params: Sockets.Characters.ReorderGallery.Params
		response: Sockets.Characters.ReorderGallery.Response
	}
	"characters:setDefaultPersona": {
		params: Sockets.Characters.SetDefaultPersona.Params
		response: Sockets.Characters.SetDefaultPersona.Response
	}
	"characters:setDefaultPersona:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"characters:setFolder": {
		params: Sockets.Characters.SetFolder.Params
		response: Sockets.Characters.SetFolder.Response
	}
	"characters:setFolder:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}

	// Character folder events — the library's groupings
	"characterFolders:list": {
		params: Sockets.CharacterFolders.List.Params
		response: Sockets.CharacterFolders.List.Response
	}
	"characterFolders:list:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"characterFolders:create": {
		params: Sockets.CharacterFolders.Create.Params
		response: Sockets.CharacterFolders.Create.Response
	}
	"characterFolders:create:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"characterFolders:update": {
		params: Sockets.CharacterFolders.Update.Params
		response: Sockets.CharacterFolders.Update.Response
	}
	"characterFolders:update:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"characterFolders:delete": {
		params: Sockets.CharacterFolders.Delete.Params
		response: Sockets.CharacterFolders.Delete.Response
	}
	"characterFolders:delete:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}

	// Connection events
	"plugins:list": {
		params: Sockets.Plugins.List.Params
		response: Sockets.Plugins.List.Response
	}
	"plugins:install": {
		params: Sockets.Plugins.Install.Params
		response: Sockets.Plugins.Install.Response
	}
	"plugins:setEnabled": {
		params: Sockets.Plugins.SetEnabled.Params
		response: Sockets.Plugins.SetEnabled.Response
	}
	"plugins:setBackend": {
		params: Sockets.Plugins.SetBackend.Params
		response: Sockets.Plugins.SetBackend.Response
	}
	"plugins:setSequential": {
		params: Sockets.Plugins.SetSequential.Params
		response: Sockets.Plugins.SetSequential.Response
	}
	"plugins:uninstall": {
		params: Sockets.Plugins.Uninstall.Params
		response: Sockets.Plugins.Uninstall.Response
	}
	"plugins:active": {
		params: Sockets.Plugins.Active.Params
		response: Sockets.Plugins.Active.Response
	}
	"plugins:abort": {
		params: Sockets.Plugins.Abort.Params
		response: Sockets.Plugins.Abort.Response
	}
	"plugins:kill": {
		params: Sockets.Plugins.Kill.Params
		response: Sockets.Plugins.Kill.Response
	}
	"plugins:logs": {
		params: Sockets.Plugins.Logs.Params
		response: Sockets.Plugins.Logs.Response
	}
	"plugins:permissions": {
		params: Sockets.Plugins.Permissions.Params
		response: Sockets.Plugins.Permissions.Response
	}
	"plugins:setPermission": {
		params: Sockets.Plugins.SetPermission.Params
		response: Sockets.Plugins.SetPermission.Response
	}
	"plugins:reviewPermissions": {
		params: Sockets.Plugins.ReviewPermissions.Params
		response: Sockets.Plugins.ReviewPermissions.Response
	}
	"plugins:unload": {
		params: Sockets.Plugins.Unload.Params
		response: Sockets.Plugins.Unload.Response
	}
	"plugins:getSettings": {
		params: Sockets.Plugins.GetSettings.Params
		response: Sockets.Plugins.GetSettings.Response
	}
	"plugins:setSettings": {
		params: Sockets.Plugins.SetSettings.Params
		response: Sockets.Plugins.SetSettings.Response
	}
	"plugins:setSettings:error": {
		params: Sockets.Plugins.SetSettings.Params
		response: Sockets.Plugins.SetSettings.Response
	}
	"plugins:setStorageQuota": {
		params: Sockets.Plugins.SetStorageQuota.Params
		response: Sockets.Plugins.SetStorageQuota.Response
	}
	"connections:list": {
		params: Sockets.Connections.List.Params
		response: Sockets.Connections.List.Response
	}
	"connections:list:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"connections:get": {
		params: Sockets.Connections.Get.Params
		response: Sockets.Connections.Get.Response
	}
	"connections:create": {
		params: Sockets.Connections.Create.Params
		response: Sockets.Connections.Create.Response
	}
	"connections:create:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"connections:update": {
		params: Sockets.Connections.Update.Params
		response: Sockets.Connections.Update.Response
	}
	"connections:update:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"connections:delete": {
		params: Sockets.Connections.Delete.Params
		response: Sockets.Connections.Delete.Response
	}
	// Registers this connection as the default for ONE named capability.
	// Formerly `connections:setUserActive`: "active" implied a single starred
	// connection the app used for whatever it needed, and one KoboldCPP row
	// serves five capabilities — so the star never said which was meant.
	"connections:setDefault": {
		params: Sockets.Connections.SetDefault.Params
		response: Sockets.Connections.SetDefault.Response
	}
	// The admin Defaults screen. `list` is the capability list plus what is
	// registered; `set` writes one half of one capability's default.
	"connectionDefaults:list": {
		params: Sockets.ConnectionDefaults.List.Params
		response: Sockets.ConnectionDefaults.List.Response
	}
	"connectionDefaults:set": {
		params: Sockets.ConnectionDefaults.Set.Params
		response: Sockets.ConnectionDefaults.Set.Response
	}
	"connections:test": {
		params: Sockets.Connections.Test.Params
		response: Sockets.Connections.Test.Response
	}
	// Image generation (local image gen) — types live in shared/sockets/imageGen
	// rather than the Sockets namespace (mid-refactor), imported at top of file.
	"images:generate": {
		params: ImagesGenerateParams
		response: ImagesGenerateResponse
	}
	"images:cancel": {
		params: ImagesCancelParams
		response: ImagesCancelResponse
	}
	"images:profileSchema": {
		params: ImageProfileSchemaParams
		response: ImageProfileSchemaResponse
	}
	// A pipeline run a person can watch and stop. `runStarted` and `progress`
	// are server-pushed only; `cancelRun` is the one a client emits.
	"pipelines:runStarted": {
		params: RunProgress
		response: RunProgress
	}
	"pipelines:progress": {
		params: RunProgress
		response: RunProgress
	}
	"pipelines:cancelRun": {
		params: { runId: string }
		response: { ok: boolean; found: boolean; error?: string }
	}
	// Server-pushed only — no client ever emits it. `params` is the same shape
	// because the map insists on one, not because anything sends it.
	"images:progress": {
		params: RunProgress
		response: RunProgress
	}
	"connections:refreshModels": {
		params: Sockets.Connections.RefreshModels.Params
		response: Sockets.Connections.RefreshModels.Response
	}
	"connections:refreshModels:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"connections:scripts": {
		params: Sockets.Connections.Scripts.Params
		response: Sockets.Connections.Scripts.Response
	}
	"connections:scripts:error": {
		params: never
		response: { error?: string }
	}
	"connections:attachScript": {
		params: Sockets.Connections.ScriptWrite.Params
		response: Sockets.Connections.ScriptWrite.Response
	}
	"connections:attachScript:error": {
		params: never
		response: { error?: string }
	}
	"connections:detachScript": {
		params: Sockets.Connections.ScriptWrite.Params
		response: Sockets.Connections.ScriptWrite.Response
	}
	"connections:detachScript:error": {
		params: never
		response: { error?: string }
	}
	// The capability panel's own pair. Not fields on `connections:update` —
	// that handler strips `capabilities` off the payload precisely so a stale
	// client copy cannot overwrite a probe, and a toggle riding the update
	// payload would undo that. `setCapability` answers with the read's response
	// so one handler applies either, plus the broadcast to other open tabs.
	// Neither :error is in HANDLED_ERROR_EVENTS: a capability read or write that
	// fails is worth a toast, and Layout's onAny catch-all already gives it one.
	"connections:capabilities": {
		params: Sockets.Connections.Capabilities.Params
		response: Sockets.Connections.Capabilities.Response
	}
	"connections:capabilities:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"connections:setCapability": {
		params: Sockets.Connections.SetCapability.Params
		response: Sockets.Connections.SetCapability.Response
	}
	"connections:setCapability:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}

	// The MODELS on an endpoint (0114) — the second half of the pair.
	//
	// Six events sharing ONE response, the way the three script events do: a
	// write here changes more than the row it names (creating the first model
	// stars it, deleting the starred one promotes another, and both move the
	// endpoint's legacy mirror), so every handler answers with the whole
	// refreshed list and one client handler applies any of them.
	"connections:models": {
		params: Sockets.Connections.Models.Params
		response: Sockets.Connections.Models.Response
	}
	"connections:models:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"connections:createModel": {
		params: Sockets.Connections.CreateModel.Params
		response: Sockets.Connections.CreateModel.Response
	}
	"connections:createModel:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"connections:updateModel": {
		params: Sockets.Connections.UpdateModel.Params
		response: Sockets.Connections.UpdateModel.Response
	}
	"connections:updateModel:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"connections:deleteModel": {
		params: Sockets.Connections.DeleteModel.Params
		response: Sockets.Connections.DeleteModel.Response
	}
	"connections:deleteModel:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"connections:importModels": {
		params: Sockets.Connections.ImportModels.Params
		response: Sockets.Connections.ImportModels.Response
	}
	// Reconcile an endpoint's rows (or every endpoint's) against what the
	// service lists. The server also broadcasts `connections:models` per
	// synced endpoint and `connections:list` afterwards, so the views that
	// render those update on their own; this response is the summary.
	"connections:syncModels": {
		params: Sockets.Connections.SyncModels.Params
		response: Sockets.Connections.SyncModels.Response
	}
	"connections:syncModels:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"connections:importModels:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	// Local ONNX model files: warm, cancel, remove, add by Hub id. Admin;
	// refused on every other endpoint type. Progress is pushed per user.
	"connections:downloadModel": {
		params: Sockets.Connections.DownloadModel.Params
		response: Sockets.Connections.DownloadModel.Response
	}
	"connections:downloadModel:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"connections:cancelModelDownload": {
		params: Sockets.Connections.CancelModelDownload.Params
		response: Sockets.Connections.CancelModelDownload.Response
	}
	"connections:cancelModelDownload:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"connections:removeModelFiles": {
		params: Sockets.Connections.RemoveModelFiles.Params
		response: Sockets.Connections.RemoveModelFiles.Response
	}
	"connections:removeModelFiles:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"connections:addHubModel": {
		params: Sockets.Connections.AddHubModel.Params
		response: Sockets.Connections.AddHubModel.Response
	}
	"connections:addHubModel:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"connections:modelDownloadProgress": {
		params: Sockets.Connections.ModelDownloadProgress.Params
		response: Sockets.Connections.ModelDownloadProgress.Response
	}

	// Card source events
	"cardSources:capabilities": {
		params: Sockets.CardSources.Capabilities.Params
		response: Sockets.CardSources.Capabilities.Response
	}
	"cardSources:capabilities:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"cardSources:charaVault:connect": {
		params: Sockets.CardSources.CharaVaultConnect.Params
		response: Sockets.CardSources.CharaVaultConnect.Response
	}
	"cardSources:charaVault:connect:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"cardSources:charaVault:disconnect": {
		params: Sockets.CardSources.CharaVaultDisconnect.Params
		response: Sockets.CardSources.CharaVaultDisconnect.Response
	}
	"cardSources:charaVault:disconnect:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"cardSources:charaVault:status": {
		params: Sockets.CardSources.CharaVaultStatus.Params
		response: Sockets.CardSources.CharaVaultStatus.Response
	}
	"cardSources:charaVault:status:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"cardSources:cardDetail": {
		params: Sockets.CardSources.CardDetail.Params
		response: Sockets.CardSources.CardDetail.Response
	}
	"cardSources:cardDetail:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}

	// Session events
	"sessions:list": {
		params: Sockets.Sessions.List.Params
		response: Sockets.Sessions.List.Response
	}
	"sessions:typing": {
		params: Sockets.Sessions.Typing.Params
		response: Sockets.Sessions.Typing.Response
	}
	"sessions:userTyping": {
		params: Sockets.Sessions.UserTyping.Params
		response: Sockets.Sessions.UserTyping.Response
	}
	// Server-pushed only: a run's status changed, or ended (R-19).
	"sessions:runStatus": {
		params: Sockets.Sessions.RunStatus.Params
		response: Sockets.Sessions.RunStatus.Response
	}
	"sessions:get": {
		params: Sockets.Sessions.Get.Params
		response: Sockets.Sessions.Get.Response
	}
	"sessions:genres": {
		params: Sockets.Sessions.Genres.Params
		response: Sockets.Sessions.Genres.Response
	}
	"sessions:pipelines": {
		params: Sockets.Sessions.Pipelines.Params
		response: Sockets.Sessions.Pipelines.Response
	}
	"sessions:presetStatus": {
		params: Sockets.Sessions.PresetStatus.Params
		response: Sockets.Sessions.PresetStatus.Response
	}
	"sessions:view": {
		params: Sockets.Sessions.View.Params
		response: Sockets.Sessions.View.Response
	}
	"sessionGenres:list": {
		params: Sockets.SessionAdmin.Genres.Params
		response: Sockets.SessionAdmin.Genres.Response
	}
	"sessionGenres:update": {
		params: Sockets.SessionAdmin.UpdateGenre.Params
		response: Sockets.SessionAdmin.UpdateGenre.Response
	}
	"sessionGenres:detail": {
		params: Sockets.SessionAdmin.GenreDetail.Params
		response: Sockets.SessionAdmin.GenreDetail.Response
	}
	"sessionGenres:detail:error": {
		params: never
		response: Sockets.SessionAdmin.GenreDetail.Response
	}
	"pipelines:configsIndex": {
		params: Sockets.Pipelines.ConfigsIndex.Params
		response: Sockets.Pipelines.ConfigsIndex.Response
	}
	"sessionPresets:list": {
		params: Sockets.SessionAdmin.Presets.Params
		response: Sockets.SessionAdmin.Presets.Response
	}
	"sessionPresets:create": {
		params: Sockets.SessionAdmin.CreatePreset.Params
		response: Sockets.SessionAdmin.CreatePreset.Response
	}
	"sessionPresets:create:error": {
		params: Sockets.SessionAdmin.CreatePreset.Response
		response: Sockets.SessionAdmin.CreatePreset.Response
	}
	"sessionPresets:update": {
		params: Sockets.SessionAdmin.UpdatePreset.Params
		response: Sockets.SessionAdmin.UpdatePreset.Response
	}
	"sessionPresets:update:error": {
		params: Sockets.SessionAdmin.UpdatePreset.Response
		response: Sockets.SessionAdmin.UpdatePreset.Response
	}
	"sessionPresets:delete": {
		params: Sockets.SessionAdmin.DeletePreset.Params
		response: Sockets.SessionAdmin.DeletePreset.Response
	}
	"sessionPresets:delete:error": {
		params: Sockets.SessionAdmin.DeletePreset.Response
		response: Sockets.SessionAdmin.DeletePreset.Response
	}
	"sessions:adminList": {
		params: Sockets.SessionAdmin.SessionsList.Params
		response: Sockets.SessionAdmin.SessionsList.Response
	}
	"sessions:panelLayout:get": {
		params: Sockets.Sessions.PanelLayout.Get.Params
		response: Sockets.Sessions.PanelLayout.Get.Response
	}
	"sessions:surfaceIntent": {
		params: Sockets.Sessions.SurfaceIntent.Push
		response: Sockets.Sessions.SurfaceIntent.Push
	}
	"sessions:panelLayout:set": {
		params: Sockets.Sessions.PanelLayout.Set.Params
		response: Sockets.Sessions.PanelLayout.Set.Response
	}
	"sessions:layoutPreset:save": {
		params: Sockets.Sessions.PanelLayout.Save.Params
		response: Sockets.Sessions.PanelLayout.Save.Response
	}
	// Managing what you saved (PLAN 25 redesign). Genre-scoped rather than
	// session-scoped: a preset belongs to a genre and an author, so the reply
	// names the genre its refreshed `presets` list is for and a client on
	// another genre ignores the list. A refusal ("Built-in layouts can't be
	// renamed…") rides the MAIN channel with `ok: false` and a sentence — the
	// `:error` twins are only the generic throw path, and are deliberately not
	// in HANDLED_ERROR_EVENTS so Layout's catch-all toasts them.
	"sessions:layoutPreset:rename": {
		params: Sockets.Sessions.PanelLayout.Rename.Params
		response: Sockets.Sessions.PanelLayout.Rename.Response
	}
	"sessions:layoutPreset:rename:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"sessions:layoutPreset:delete": {
		params: Sockets.Sessions.PanelLayout.Delete.Params
		response: Sockets.Sessions.PanelLayout.Delete.Response
	}
	"sessions:layoutPreset:delete:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"sessions:layoutPreset:usage": {
		params: Sockets.Sessions.PanelLayout.Usage.Params
		response: Sockets.Sessions.PanelLayout.Usage.Response
	}
	"sessions:layoutPreset:usage:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"sessions:triggers": {
		params: Sockets.Sessions.Triggers.Params
		response: Sockets.Sessions.Triggers.Response
	}
	"sessions:actions": {
		params: Sockets.Sessions.Actions.Params
		response: Sockets.Sessions.Actions.Response
	}
	"sessions:actionsSeen": {
		params: Sockets.Sessions.ActionsSeen.Params
		response: Sockets.Sessions.ActionsSeen.Response
	}
	"sessions:triggerFunction": {
		params: Sockets.Sessions.TriggerFunction.Params
		response: Sockets.Sessions.TriggerFunction.Response
	}
	"sessions:presets": {
		params: Sockets.Sessions.PresetOptions.Params
		response: Sockets.Sessions.PresetOptions.Response
	}
	"sessions:choosePreset": {
		params: Sockets.Sessions.ChoosePreset.Params
		response: Sockets.Sessions.ChoosePreset.Response
	}
	"sessions:functions": {
		params: Sockets.Sessions.Functions.Params
		response: Sockets.Sessions.Functions.Response
	}
	"sessions:setFunction": {
		params: Sockets.Sessions.SetFunction.Params
		response: Sockets.Sessions.SetFunction.Response
	}
	"sessions:upgradeGenre": {
		params: Sockets.Sessions.UpgradeGenre.Params
		response: Sockets.Sessions.UpgradeGenre.Response
	}
	"sessions:functionCandidates": {
		params: Sockets.Sessions.Bindings.Candidates.Params
		response: Sockets.Sessions.Bindings.Candidates.Response
	}
	"sessions:bindFunction": {
		params: Sockets.Sessions.Bindings.BindFunction.Params
		response: Sockets.Sessions.Bindings.BindFunction.Response
	}
	"sessions:speakerStrategies": {
		params: Sockets.Sessions.Bindings.SpeakerStrategies.Params
		response: Sockets.Sessions.Bindings.SpeakerStrategies.Response
	}
	"sessions:setSpeakerStrategy": {
		params: Sockets.Sessions.Bindings.SetSpeakerStrategy.Params
		response: Sockets.Sessions.Bindings.SetSpeakerStrategy.Response
	}
	"sessions:accountVisibility": {
		params: Sockets.Sessions.AccountVisibility.Params
		response: Sockets.Sessions.AccountVisibility.Response
	}
	"sessions:saveDraft": {
		params: Sockets.Sessions.SaveDraft.Params
		response: Sockets.Sessions.SaveDraft.Response
	}
	"sessions:create": {
		params: Sockets.Sessions.Create.Params
		response: Sockets.Sessions.Create.Response
	}
	"sessions:update": {
		params: Sockets.Sessions.Update.Params
		response: Sockets.Sessions.Update.Response
	}
	"sessions:setLorebook": {
		params: Sockets.Sessions.SetLorebook.Params
		response: Sockets.Sessions.SetLorebook.Response
	}
	"sessions:summarize": {
		params: Sockets.Sessions.Summarize.Params
		response: Sockets.Sessions.Summarize.Response
	}
	"sessions:summarize:progress": {
		params: never
		response: Sockets.Sessions.Summarize.Progress
	}
	"sessions:summarize:complete": {
		params: never
		response: Sockets.Sessions.Summarize.Response
	}
	"sessions:summarize:error": {
		params: never
		response: Sockets.Sessions.Summarize.ErrorResponse
	}
	"sessions:summarize:trace": {
		params: never
		response: Sockets.Sessions.Summarize.TraceEntry
	}
	"sessions:delete": {
		params: Sockets.Sessions.Delete.Params
		response: Sockets.Sessions.Delete.Response
	}
	"sessions:toggleSessionCharacterActive": {
		params: Sockets.Sessions.ToggleSessionCharacterActive.Params
		response: Sockets.Sessions.ToggleSessionCharacterActive.Response
	}
	"sessions:setEnvoySeat": {
		params: Sockets.Sessions.SetEnvoySeat.Params
		response: Sockets.Sessions.SetEnvoySeat.Response
	}
	"sessions:updateSessionCharacterVisibility": {
		params: Sockets.Sessions.UpdateSessionCharacterVisibility.Params
		response: Sockets.Sessions.UpdateSessionCharacterVisibility.Response
	}
	"sessions:triggerNarratorResponse": {
		params: Sockets.Sessions.TriggerNarratorResponse.Params
		response: Sockets.Sessions.TriggerNarratorResponse.Response
	}
	"sessions:getNarratorName": {
		params: Sockets.Sessions.GetNarratorName.Params
		response: Sockets.Sessions.GetNarratorName.Response
	}
	"sessions:sideCharacterOptions": {
		params: Sockets.Sessions.SideCharacterOptions.Params
		response: Sockets.Sessions.SideCharacterOptions.Response
	}
	"sessions:list:error": {
		params: never
		response: Sockets.ErrorResponse
	}
	"sessions:delete:error": {
		params: never
		response: Sockets.ErrorResponse
	}
	"sessions:create:error": {
		params: never
		response: Sockets.ErrorResponse
	}
	"sessions:update:error": {
		params: never
		response: Sockets.ErrorResponse
	}
	"sessions:get:error": {
		params: never
		response: Sockets.ErrorResponse
	}
	"sessions:addPersona": {
		params: Sockets.Sessions.AddPersona.Params
		response: Sockets.Sessions.AddPersona.Response
	}
	"sessions:addPersona:error": {
		params: never
		response: Sockets.ErrorResponse
	}
	"sessions:addGuest": {
		params: Sockets.Sessions.AddGuest.Params
		response: Sockets.Sessions.AddGuest.Response
	}
	"sessions:addGuest:error": {
		params: never
		response: Sockets.ErrorResponse
	}
	"sessions:removeGuest": {
		params: Sockets.Sessions.RemoveGuest.Params
		response: Sockets.Sessions.RemoveGuest.Response
	}
	"sessions:removeGuest:error": {
		params: never
		response: Sockets.ErrorResponse
	}
	"sessions:getResponseOrder": {
		params: Sockets.Sessions.GetResponseOrder.Params
		response: Sockets.Sessions.GetResponseOrder.Response
	}
	"sessions:promptTokenCount": {
		params: Sockets.Sessions.PromptTokenCount.Params
		response: Sockets.Sessions.PromptTokenCount.Response
	}
	"sessions:triggerGenerateMessage": {
		params: Sockets.Sessions.TriggerGenerateMessage.Params
		response: Sockets.Sessions.TriggerGenerateMessage.Response
	}
	"sessions:branch": {
		params: Sockets.Sessions.Branch.Params
		response: Sockets.Sessions.Branch.Response
	}
	"sessions:branch:error": {
		params: never
		response: Sockets.ErrorResponse
	}
	"sessions:reassignRemovedParticipant": {
		params: Sockets.Sessions.ReassignRemovedParticipant.Params
		response: Sockets.Sessions.ReassignRemovedParticipant.Response
	}
	"sessions:reassignRemovedParticipant:error": {
		params: never
		response: Sockets.ErrorResponse
	}

	// Session Message events
	"sessionMessages:sendPersonaMessage": {
		params: Sockets.SessionMessages.SendPersonaMessage.Params
		response: Sockets.SessionMessages.SendPersonaMessage.Response
	}
	"sessionMessages:sendCharacterMessage": {
		params: Sockets.SessionMessages.SendCharacterMessage.Params
		response: Sockets.SessionMessages.SendCharacterMessage.Response
	}
	"sessionMessages:update": {
		params: Sockets.SessionMessages.Update.Params
		response: Sockets.SessionMessages.Update.Response
	}
	"sessionMessages:delete": {
		params: Sockets.SessionMessages.Delete.Params
		response: Sockets.SessionMessages.Delete.Response
	}
	"sessionMessages:regenerate": {
		params: Sockets.SessionMessages.Regenerate.Params
		response: Sockets.SessionMessages.Regenerate.Response
	}
	"sessionMessages:continue": {
		params: Sockets.SessionMessages.Continue.Params
		response: Sockets.SessionMessages.Continue.Response
	}
	"sessionMessages:swipeLeft": {
		params: Sockets.SessionMessages.SwipeLeft.Params
		response: Sockets.SessionMessages.SwipeLeft.Response
	}
	"sessionMessages:swipeRight": {
		params: Sockets.SessionMessages.SwipeRight.Params
		response: Sockets.SessionMessages.SwipeRight.Response
	}
	"sessionMessages:cancel": {
		params: Sockets.SessionMessages.Cancel.Params
		response: Sockets.SessionMessages.Cancel.Response
	}

	// Legacy events (should be migrated) - temporarily using any types
	sessionMessage: {
		params: Sockets.SessionMessage.Call
		response: Sockets.SessionMessage.Response
	}
	"sessionMessage:error": {
		params: never
		response: Sockets.SessionMessage.Response
	}
	lorebookBindingList: {
		params: any
		response: any
	}
	ollamaModelsList: {
		params: any
		response: any
	}
	ollamaListRunningModels: {
		params: any
		response: any
	}

	// Sampling Config events
	// Invites (plan 27 §3).
	"invites:list": {
		params: Sockets.Invites.List.Params
		response: Sockets.Invites.List.Response
	}
	"invites:list:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"invites:create": {
		params: Sockets.Invites.Create.Params
		response: Sockets.Invites.Create.Response
	}
	"invites:create:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"invites:revoke": {
		params: Sockets.Invites.Revoke.Params
		response: Sockets.Invites.Revoke.Response
	}
	"invites:revoke:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}

	"systemSettings:updateRequireTwoFactor": {
		params: Sockets.SystemSettings.UpdateRequireTwoFactor.Params
		response: Sockets.SystemSettings.UpdateRequireTwoFactor.Response
	}
	"systemSettings:updateRequireTwoFactor:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}

	// Account setup (plan 27 §1).
	"account:setupState": {
		params: Sockets.Account.SetupState.Params
		response: Sockets.Account.SetupState.Response
	}
	"account:setupState:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"account:setPassword": {
		params: Sockets.Account.SetPassword.Params
		response: Sockets.Account.SetPassword.Response
	}
	"account:setPassword:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}

	// Two-factor authentication (plan 26 §10).
	"totp:status": {
		params: Sockets.Totp.Status.Params
		response: Sockets.Totp.Status.Response
	}
	"totp:enroll:begin": {
		params: Sockets.Totp.EnrollBegin.Params
		response: Sockets.Totp.EnrollBegin.Response
	}
	"totp:enroll:confirm": {
		params: Sockets.Totp.EnrollConfirm.Params
		response: Sockets.Totp.EnrollConfirm.Response
	}
	"totp:verify": {
		params: Sockets.Totp.Verify.Params
		response: Sockets.Totp.Verify.Response
	}
	"totp:regenerateCodes": {
		params: Sockets.Totp.RegenerateCodes.Params
		response: Sockets.Totp.RegenerateCodes.Response
	}
	"totp:disable": {
		params: Sockets.Totp.Disable.Params
		response: Sockets.Totp.Disable.Response
	}
	"totp:adminClear": {
		params: Sockets.Totp.AdminClear.Params
		response: Sockets.Totp.AdminClear.Response
	}
	"totp:status:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"totp:enroll:begin:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"totp:enroll:confirm:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"totp:verify:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"totp:regenerateCodes:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"totp:disable:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"totp:adminClear:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}

	// Allowed hosts (plan 26 §9) — read-only surface.
	"allowedHosts:get": {
		params: Sockets.AllowedHosts.Get.Params
		response: Sockets.AllowedHosts.Get.Response
	}
	"allowedHosts:get:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}

	// Backups (PLAN-pglite-recovery P2) — admin only. No restore event: see
	// the Backups namespace in shared/sockets/types.ts.
	"backups:list": {
		params: Sockets.Backups.List.Params
		response: Sockets.Backups.List.Response
	}
	"backups:list:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"backups:create": {
		params: Sockets.Backups.Create.Params
		response: Sockets.Backups.Create.Response
	}
	"backups:create:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"backups:delete": {
		params: Sockets.Backups.Delete.Params
		response: Sockets.Backups.Delete.Response
	}
	"backups:delete:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}

	// Tunnels (plan 26) — its own namespace, never folded into Connections.
	"tunnels:get": {
		params: Sockets.Tunnels.Get.Params
		response: Sockets.Tunnels.Get.Response
	}
	"tunnels:updateConfig": {
		params: Sockets.Tunnels.UpdateConfig.Params
		response: Sockets.Tunnels.UpdateConfig.Response
	}
	"tunnels:enable": {
		params: Sockets.Tunnels.Enable.Params
		response: Sockets.Tunnels.Enable.Response
	}
	"tunnels:disable": {
		params: Sockets.Tunnels.Disable.Params
		response: Sockets.Tunnels.Disable.Response
	}
	"tunnels:get:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"tunnels:updateConfig:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"tunnels:enable:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"tunnels:disable:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}

	"samplingConfigs:list": {
		params: Sockets.SamplingConfigs.List.Params
		response: Sockets.SamplingConfigs.List.Response
	}
	"samplingConfigs:get": {
		params: Sockets.SamplingConfigs.Get.Params
		response: Sockets.SamplingConfigs.Get.Response
	}
	"samplingConfigs:create": {
		params: Sockets.SamplingConfigs.Create.Params
		response: Sockets.SamplingConfigs.Create.Response
	}
	// Both of these have been EMITTED by the server for a while (see
	// samplingConfigs.ts) with nothing able to listen: an interest key is keyed
	// on this map, so declaring `"samplingConfigs:create:error"` was a type
	// error and every one of these errors could only reach the generic toast.
	// Registered so the sidebar can render a name collision inline, where the
	// name that collided is. No new namespace: `ErrorResponse` is exactly what
	// both handlers emit. `:get:error` and `:delete:error` are emitted too and
	// deliberately left off — a toast is the right home for those.
	"samplingConfigs:create:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"samplingConfigs:update": {
		params: Sockets.SamplingConfigs.Update.Params
		response: Sockets.SamplingConfigs.Update.Response
	}
	"samplingConfigs:update:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"samplingConfigs:delete": {
		params: Sockets.SamplingConfigs.Delete.Params
		response: Sockets.SamplingConfigs.Delete.Response
	}
	"samplingConfigs:setUserActive": {
		params: Sockets.SamplingConfigs.SetUserActive.Params
		response: Sockets.SamplingConfigs.SetUserActive.Response
	}

	// Context Config events
	"contextConfigs:list": {
		params: Sockets.ContextConfigs.List.Params
		response: Sockets.ContextConfigs.List.Response
	}
	"contextConfigs:get": {
		params: Sockets.ContextConfigs.Get.Params
		response: Sockets.ContextConfigs.Get.Response
	}
	"contextConfigs:create": {
		params: Sockets.ContextConfigs.Create.Params
		response: Sockets.ContextConfigs.Create.Response
	}
	"contextConfigs:update": {
		params: Sockets.ContextConfigs.Update.Params
		response: Sockets.ContextConfigs.Update.Response
	}
	"contextConfigs:delete": {
		params: Sockets.ContextConfigs.Delete.Params
		response: Sockets.ContextConfigs.Delete.Response
	}
	"contextConfigs:setUserActive": {
		params: Sockets.ContextConfigs.SetUserActive.Params
		response: Sockets.ContextConfigs.SetUserActive.Response
	}
	"contextConfigs:preview": {
		params: Sockets.ContextConfigs.Preview.Params
		response: Sockets.ContextConfigs.Preview.Response
	}

	// Pipeline events — the pipeline view (05 §0a) and the management page.
	"pipelines:list": {
		params: Sockets.Pipelines.List.Params
		response: Sockets.Pipelines.List.Response
	}
	"pipelines:get": {
		params: Sockets.Pipelines.Get.Params
		response: Sockets.Pipelines.Get.Response
	}
	// Every mutation answers on "pipelines:get" with the whole resolved view.
	// One write can move more than one thing on screen — clearing an option
	// reveals whatever it was shadowing — so acknowledging just the field that
	// changed would leave the panel disagreeing with the database.
	"pipelines:setOption": {
		params: Sockets.Pipelines.SetOption.Params
		response: Sockets.Pipelines.SetOption.Response
	}
	"pipelines:setOption:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:clearOption": {
		params: Sockets.Pipelines.ClearOption.Params
		response: Sockets.Pipelines.ClearOption.Response
	}
	// "Reset all" — one delete of the configuration's rows rather than a loop
	// of clears over the ones the panel happened to have loaded. Answers on
	// `pipelines:get` like every other mutation.
	"pipelines:resetConfig": {
		params: Sockets.Pipelines.ResetConfig.Params
		response: Sockets.Pipelines.ResetConfig.Response
	}
	"pipelines:resetConfig:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:setOptions": {
		params: Sockets.Pipelines.SetOptions.Params
		response: Sockets.Pipelines.SetOptions.Response
	}
	"pipelines:setOptions:error": {
		params: Sockets.Pipelines.SetOptions.Response
		response: Sockets.Pipelines.SetOptions.Response
	}
	"pipelines:run": {
		params: Sockets.Pipelines.Run.Params
		response: Sockets.Pipelines.Run.Response
	}
	"pipelines:run:error": {
		params: Sockets.Pipelines.Run.Response
		response: Sockets.Pipelines.Run.Response
	}
	// Retrieval, explained (design §9). A projection OF the receipt rather
	// than a second read of it: `pipelines:run` already carries the raw blob,
	// and a panel that pulled decisions out of it client-side would be a
	// second copy of what a decision means. Owner-scoped exactly like the
	// receipt it explains.
	"pipelines:runExplain": {
		params: Sockets.Pipelines.RunExplain.Params
		response: Sockets.Pipelines.RunExplain.Response
	}
	"pipelines:runExplain:error": {
		params: never
		response: { error?: string }
	}
	// The same explanation, asked from the composer about a turn that has not
	// happened yet — a real preview run against the draft in the box. Answered
	// on a button rather than on a keystroke: a turn is a real run with a real
	// embedding call behind it (`EntryFireTest`'s rule).
	"pipelines:previewRetrieval": {
		params: Sockets.Pipelines.PreviewRetrieval.Params
		response: Sockets.Pipelines.PreviewRetrieval.Response
	}
	// The handler answers its own refusals on the channel above, with the
	// sentence saying which one it was; this is `register()`'s synthesised
	// fallback for a throw it did not expect, listened to so the panel stops
	// waiting rather than spinning forever.
	"pipelines:previewRetrieval:error": {
		params: never
		response: { error?: string }
	}
	// And the same explanation addressed the way a reader asks for it: by the
	// message, not by a run id they were never given. Gated on the session
	// (owner or guest), so a participant can read why a reply in their own
	// conversation said what it said.
	"pipelines:messageExplain": {
		params: Sockets.Pipelines.MessageExplain.Params
		response: Sockets.Pipelines.MessageExplain.Response
	}
	"pipelines:messageExplain:error": {
		params: never
		response: { error?: string }
	}
	// Which runs produced a given row, asked from the row rather than from the
	// workspace: the gallery is looking at an image and wants to know what made
	// it. Gated on the artifact — the media handlers' own owner check for a
	// file, the session for a message — never on who owns the run.
	"pipelines:artifactRuns": {
		params: Sockets.Pipelines.ArtifactRuns.Params
		response: Sockets.Pipelines.ArtifactRuns.Response
	}
	"pipelines:artifactRuns:error": {
		params: never
		response: Sockets.Pipelines.ArtifactRuns.Response
	}
	// Everything that has ever fired in one session — the aggregate the single
	// run's explanation cannot give, because a decision belongs to a turn.
	// Gated twice: the session must be reachable (owner or guest) and the runs
	// summed are the asker's own.
	"pipelines:sessionEntryUsage": {
		params: Sockets.Pipelines.SessionEntryUsage.Params
		response: Sockets.Pipelines.SessionEntryUsage.Response
	}
	"pipelines:sessionEntryUsage:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:clearOption:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:createConfig": {
		params: Sockets.Pipelines.CreateConfig.Params
		response: Sockets.Pipelines.CreateConfig.Response
	}
	"pipelines:createConfig:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:renameConfig": {
		params: Sockets.Pipelines.RenameConfig.Params
		response: Sockets.Pipelines.RenameConfig.Response
	}
	"pipelines:renameConfig:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:deleteConfig": {
		params: Sockets.Pipelines.DeleteConfig.Params
		response: Sockets.Pipelines.DeleteConfig.Response
	}
	"pipelines:deleteConfig:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:setPresetActions": {
		params: Sockets.Pipelines.SetPresetActions.Params
		response: Sockets.Pipelines.SetPresetActions.Response
	}
	"pipelines:setPresetActions:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:selectConfig": {
		params: Sockets.Pipelines.SelectConfig.Params
		response: Sockets.Pipelines.SelectConfig.Response
	}
	"pipelines:selectConfig:error": {
		params: never
		response: { error?: string }
	}
	// What publishing a new version did to a configuration. Read on its own
	// event rather than with the view: the view is re-emitted by every write,
	// and a banner that came back on each refresh could not be dismissed.
	// A dismissal answers here too, with what is left.
	"pipelines:configNotices": {
		params: Sockets.Pipelines.ConfigNotices.Params
		response: Sockets.Pipelines.ConfigNotices.Response
	}
	"pipelines:configNotices:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:acknowledgeConfigNotices": {
		params: Sockets.Pipelines.AcknowledgeConfigNotices.Params
		response: Sockets.Pipelines.AcknowledgeConfigNotices.Response
	}
	"pipelines:acknowledgeConfigNotices:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:createPrompt": {
		params: Sockets.Pipelines.CreatePrompt.Params
		response: Sockets.Pipelines.CreatePrompt.Response
	}
	"pipelines:createPrompt:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:clonePrompt": {
		params: Sockets.Pipelines.ClonePrompt.Params
		response: Sockets.Pipelines.ClonePrompt.Response
	}
	"pipelines:clonePrompt:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:updatePrompt": {
		params: Sockets.Pipelines.UpdatePrompt.Params
		response: Sockets.Pipelines.UpdatePrompt.Response
	}
	"pipelines:updatePrompt:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:deletePrompt": {
		params: Sockets.Pipelines.DeletePrompt.Params
		response: Sockets.Pipelines.DeletePrompt.Response
	}
	"pipelines:deletePrompt:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:library": {
		params: Sockets.Pipelines.Library.Params
		response: Sockets.Pipelines.Library.Response
	}
	"pipelines:library:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:libraryCreateTemplate": {
		params: Sockets.Pipelines.LibraryTemplateWrite.CreateParams
		response: Sockets.Pipelines.LibraryTemplateWrite.Response
	}
	"pipelines:libraryCreateTemplate:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:libraryCloneTemplate": {
		params: Sockets.Pipelines.LibraryTemplateWrite.CloneParams
		response: Sockets.Pipelines.LibraryTemplateWrite.Response
	}
	"pipelines:libraryCloneTemplate:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:libraryUpdateTemplate": {
		params: Sockets.Pipelines.LibraryTemplateWrite.UpdateParams
		response: Sockets.Pipelines.LibraryTemplateWrite.Response
	}
	"pipelines:libraryUpdateTemplate:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:libraryDeleteTemplate": {
		params: Sockets.Pipelines.LibraryTemplateWrite.DeleteParams
		response: Sockets.Pipelines.LibraryTemplateWrite.Response
	}
	"pipelines:libraryDeleteTemplate:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:libraryClonePrompt": {
		params: Sockets.Pipelines.LibraryPromptWrite.CloneParams
		response: Sockets.Pipelines.LibraryPromptWrite.Response
	}
	"pipelines:libraryClonePrompt:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:libraryUpdatePrompt": {
		params: Sockets.Pipelines.LibraryPromptWrite.UpdateParams
		response: Sockets.Pipelines.LibraryPromptWrite.Response
	}
	"pipelines:libraryUpdatePrompt:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:libraryDeletePrompt": {
		params: Sockets.Pipelines.LibraryPromptWrite.DeleteParams
		response: Sockets.Pipelines.LibraryPromptWrite.Response
	}
	"pipelines:libraryDeletePrompt:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:scripts": {
		params: Sockets.Pipelines.Scripts.Params
		response: Sockets.Pipelines.Scripts.Response
	}
	"pipelines:scripts:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:createScript": {
		params: Sockets.Pipelines.ScriptWrite.CreateParams
		response: Sockets.Pipelines.ScriptWrite.Response
	}
	"pipelines:createScript:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:cloneScript": {
		params: Sockets.Pipelines.ScriptWrite.CloneParams
		response: Sockets.Pipelines.ScriptWrite.Response
	}
	"pipelines:cloneScript:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:updateScript": {
		params: Sockets.Pipelines.ScriptWrite.UpdateParams
		response: Sockets.Pipelines.ScriptWrite.Response
	}
	"pipelines:updateScript:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:deleteScript": {
		params: Sockets.Pipelines.ScriptWrite.DeleteParams
		response: Sockets.Pipelines.ScriptWrite.Response
	}
	"pipelines:deleteScript:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:exportScripts": {
		params: Sockets.Pipelines.ScriptShare.ExportParams
		response: Sockets.Pipelines.ScriptShare.ExportResponse
	}
	"pipelines:exportScripts:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:importScripts": {
		params: Sockets.Pipelines.ScriptShare.ImportParams
		response: Sockets.Pipelines.ScriptShare.ImportResponse
	}
	"pipelines:importScripts:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:createContextTemplate": {
		params: Sockets.Pipelines.CreateContextTemplate.Params
		response: Sockets.Pipelines.CreateContextTemplate.Response
	}
	"pipelines:createContextTemplate:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:cloneContextTemplate": {
		params: Sockets.Pipelines.CloneContextTemplate.Params
		response: Sockets.Pipelines.CloneContextTemplate.Response
	}
	"pipelines:cloneContextTemplate:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:updateContextTemplate": {
		params: Sockets.Pipelines.UpdateContextTemplate.Params
		response: Sockets.Pipelines.UpdateContextTemplate.Response
	}
	"pipelines:updateContextTemplate:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:deleteContextTemplate": {
		params: Sockets.Pipelines.DeleteContextTemplate.Params
		response: Sockets.Pipelines.DeleteContextTemplate.Response
	}
	"pipelines:deleteContextTemplate:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:previewTemplate": {
		params: Sockets.Pipelines.PreviewTemplate.Params
		response: Sockets.Pipelines.PreviewTemplate.Response
	}
	"pipelines:previewTemplate:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:cloneVariableTemplate": {
		params: Sockets.Pipelines.CloneVariableTemplate.Params
		response: Sockets.Pipelines.CloneVariableTemplate.Response
	}
	"pipelines:cloneVariableTemplate:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:updateVariableTemplate": {
		params: Sockets.Pipelines.UpdateVariableTemplate.Params
		response: Sockets.Pipelines.UpdateVariableTemplate.Response
	}
	"pipelines:updateVariableTemplate:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:deleteVariableTemplate": {
		params: Sockets.Pipelines.DeleteVariableTemplate.Params
		response: Sockets.Pipelines.DeleteVariableTemplate.Response
	}
	"pipelines:deleteVariableTemplate:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:reviews": {
		params: Sockets.Pipelines.Reviews.Params
		response: Sockets.Pipelines.Reviews.Response
	}
	"pipelines:resolveReview": {
		params: Sockets.Pipelines.ResolveReview.Params
		response: Sockets.Pipelines.ResolveReview.Response
	}
	"pipelines:resolveReview:error": {
		params: never
		response: { error?: string; id?: string }
	}
	"pipelines:reviewRequested": {
		params: never
		response: Sockets.Pipelines.PendingReview
	}
	"pipelines:reviewClosed": {
		params: never
		response: { id: string }
	}
	"pipelines:detail": {
		params: Sockets.Pipelines.Detail.Params
		response: Sockets.Pipelines.Detail.Response
	}
	"pipelines:detail:error": {
		params: never
		response: { error?: string }
	}
	"pipelines:runs": {
		params: Sockets.Pipelines.Runs.Params
		response: Sockets.Pipelines.Runs.Response
	}

	// Prompt Config events
	"promptConfigs:list": {
		params: Sockets.PromptConfigs.List.Params
		response: Sockets.PromptConfigs.List.Response
	}
	"promptConfigs:get": {
		params: Sockets.PromptConfigs.Get.Params
		response: Sockets.PromptConfigs.Get.Response
	}
	"promptConfigs:create": {
		params: Sockets.PromptConfigs.Create.Params
		response: Sockets.PromptConfigs.Create.Response
	}
	"promptConfigs:update": {
		params: Sockets.PromptConfigs.Update.Params
		response: Sockets.PromptConfigs.Update.Response
	}
	"promptConfigs:delete": {
		params: Sockets.PromptConfigs.Delete.Params
		response: Sockets.PromptConfigs.Delete.Response
	}
	"promptConfigs:setUserActive": {
		params: Sockets.PromptConfigs.SetUserActive.Params
		response: Sockets.PromptConfigs.SetUserActive.Response
	}
	"promptConfigs:setUserActive:error": {
		params: never
		response: { error?: string }
	}

	// Completion template events (the delimiters a prompt is wrapped in)
	"completionTemplates:list": {
		params: Sockets.CompletionTemplates.List.Params
		response: Sockets.CompletionTemplates.List.Response
	}
	"completionTemplates:get": {
		params: Sockets.CompletionTemplates.Get.Params
		response: Sockets.CompletionTemplates.Get.Response
	}
	"completionTemplates:get:error": {
		params: never
		response: { error?: string }
	}
	"completionTemplates:create": {
		params: Sockets.CompletionTemplates.Create.Params
		response: Sockets.CompletionTemplates.Create.Response
	}
	"completionTemplates:create:error": {
		params: never
		response: { error?: string }
	}
	"completionTemplates:update": {
		params: Sockets.CompletionTemplates.Update.Params
		response: Sockets.CompletionTemplates.Update.Response
	}
	"completionTemplates:update:error": {
		params: never
		response: { error?: string }
	}
	"completionTemplates:delete": {
		params: Sockets.CompletionTemplates.Delete.Params
		response: Sockets.CompletionTemplates.Delete.Response
	}
	"completionTemplates:delete:error": {
		params: never
		response: { error?: string }
	}
	"completionTemplates:clone": {
		params: Sockets.CompletionTemplates.Clone.Params
		response: Sockets.CompletionTemplates.Clone.Response
	}
	"completionTemplates:clone:error": {
		params: never
		response: { error?: string }
	}
	"completionTemplates:options": {
		params: Sockets.CompletionTemplates.Options.Params
		response: Sockets.CompletionTemplates.Options.Response
	}

	// Narrator Prompt Config events ("Session Prompts: Narrator")
	"graphBuildConfigs:list": {
		params: Sockets.GraphBuildConfigs.List.Params
		response: Sockets.GraphBuildConfigs.List.Response
	}
	"graphBuildConfigs:get": {
		params: Sockets.GraphBuildConfigs.Get.Params
		response: Sockets.GraphBuildConfigs.Get.Response
	}
	"graphBuildConfigs:create": {
		params: Sockets.GraphBuildConfigs.Create.Params
		response: Sockets.GraphBuildConfigs.Create.Response
	}
	"graphBuildConfigs:update": {
		params: Sockets.GraphBuildConfigs.Update.Params
		response: Sockets.GraphBuildConfigs.Update.Response
	}
	"graphBuildConfigs:delete": {
		params: Sockets.GraphBuildConfigs.Delete.Params
		response: Sockets.GraphBuildConfigs.Delete.Response
	}
	"graphBuildConfigs:setDefault": {
		params: Sockets.GraphBuildConfigs.SetDefault.Params
		response: Sockets.GraphBuildConfigs.SetDefault.Response
	}
	"narratorPromptConfigs:list": {
		params: Sockets.NarratorPromptConfigs.List.Params
		response: Sockets.NarratorPromptConfigs.List.Response
	}
	"narratorPromptConfigs:get": {
		params: Sockets.NarratorPromptConfigs.Get.Params
		response: Sockets.NarratorPromptConfigs.Get.Response
	}
	"narratorPromptConfigs:create": {
		params: Sockets.NarratorPromptConfigs.Create.Params
		response: Sockets.NarratorPromptConfigs.Create.Response
	}
	"narratorPromptConfigs:update": {
		params: Sockets.NarratorPromptConfigs.Update.Params
		response: Sockets.NarratorPromptConfigs.Update.Response
	}
	"narratorPromptConfigs:delete": {
		params: Sockets.NarratorPromptConfigs.Delete.Params
		response: Sockets.NarratorPromptConfigs.Delete.Response
	}
	"narratorPromptConfigs:setUserActive": {
		params: Sockets.NarratorPromptConfigs.SetUserActive.Params
		response: Sockets.NarratorPromptConfigs.SetUserActive.Response
	}
	"narratorPromptConfigs:setUserActive:error": {
		params: never
		response: { error?: string }
	}

	// World Summarize Config events
	"worldSummarizeConfigs:list": {
		params: Sockets.WorldSummarizeConfigs.List.Params
		response: Sockets.WorldSummarizeConfigs.List.Response
	}
	"worldSummarizeConfigs:get": {
		params: Sockets.WorldSummarizeConfigs.Get.Params
		response: Sockets.WorldSummarizeConfigs.Get.Response
	}
	"worldSummarizeConfigs:create": {
		params: Sockets.WorldSummarizeConfigs.Create.Params
		response: Sockets.WorldSummarizeConfigs.Create.Response
	}
	"worldSummarizeConfigs:update": {
		params: Sockets.WorldSummarizeConfigs.Update.Params
		response: Sockets.WorldSummarizeConfigs.Update.Response
	}
	"worldSummarizeConfigs:delete": {
		params: Sockets.WorldSummarizeConfigs.Delete.Params
		response: Sockets.WorldSummarizeConfigs.Delete.Response
	}
	"worldSummarizeConfigs:setUserActive": {
		params: Sockets.WorldSummarizeConfigs.SetUserActive.Params
		response: Sockets.WorldSummarizeConfigs.SetUserActive.Response
	}

	// Character Summarize Config events
	"characterSummarizeConfigs:list": {
		params: Sockets.CharacterSummarizeConfigs.List.Params
		response: Sockets.CharacterSummarizeConfigs.List.Response
	}
	"characterSummarizeConfigs:get": {
		params: Sockets.CharacterSummarizeConfigs.Get.Params
		response: Sockets.CharacterSummarizeConfigs.Get.Response
	}
	"characterSummarizeConfigs:create": {
		params: Sockets.CharacterSummarizeConfigs.Create.Params
		response: Sockets.CharacterSummarizeConfigs.Create.Response
	}
	"characterSummarizeConfigs:update": {
		params: Sockets.CharacterSummarizeConfigs.Update.Params
		response: Sockets.CharacterSummarizeConfigs.Update.Response
	}
	"characterSummarizeConfigs:delete": {
		params: Sockets.CharacterSummarizeConfigs.Delete.Params
		response: Sockets.CharacterSummarizeConfigs.Delete.Response
	}
	"characterSummarizeConfigs:setUserActive": {
		params: Sockets.CharacterSummarizeConfigs.SetUserActive.Params
		response: Sockets.CharacterSummarizeConfigs.SetUserActive.Response
	}

	// Scene Summarize Config events
	"sceneSummarizeConfigs:list": {
		params: Sockets.SceneSummarizeConfigs.List.Params
		response: Sockets.SceneSummarizeConfigs.List.Response
	}
	"sceneSummarizeConfigs:get": {
		params: Sockets.SceneSummarizeConfigs.Get.Params
		response: Sockets.SceneSummarizeConfigs.Get.Response
	}
	"sceneSummarizeConfigs:create": {
		params: Sockets.SceneSummarizeConfigs.Create.Params
		response: Sockets.SceneSummarizeConfigs.Create.Response
	}
	"sceneSummarizeConfigs:update": {
		params: Sockets.SceneSummarizeConfigs.Update.Params
		response: Sockets.SceneSummarizeConfigs.Update.Response
	}
	"sceneSummarizeConfigs:delete": {
		params: Sockets.SceneSummarizeConfigs.Delete.Params
		response: Sockets.SceneSummarizeConfigs.Delete.Response
	}
	"sceneSummarizeConfigs:setUserActive": {
		params: Sockets.SceneSummarizeConfigs.SetUserActive.Params
		response: Sockets.SceneSummarizeConfigs.SetUserActive.Response
	}

	// KoboldCPP events
	"koboldcpp:setBaseUrl": {
		params: Sockets.KoboldCPP.SetBaseUrl.Params
		response: Sockets.KoboldCPP.SetBaseUrl.Response
	}
	"koboldcpp:setModelsDir": {
		params: Sockets.KoboldCPP.SetModelsDir.Params
		response: Sockets.KoboldCPP.SetModelsDir.Response
	}
	"koboldcpp:searchModels": {
		params: Sockets.KoboldCPP.SearchModels.Params
		response: Sockets.KoboldCPP.SearchModels.Response
	}
	"koboldcpp:downloadModel": {
		params: Sockets.KoboldCPP.DownloadModel.Params
		response: Sockets.KoboldCPP.DownloadModel.Response
	}
	"koboldcpp:cancelDownload": {
		params: Sockets.KoboldCPP.CancelDownload.Params
		response: Sockets.KoboldCPP.CancelDownload.Response
	}
	"koboldcpp:getDownloadProgress": {
		params: Sockets.KoboldCPP.GetDownloadProgress.Params
		response: Sockets.KoboldCPP.GetDownloadProgress.Response
	}
	"koboldcpp:clearDownloadHistory": {
		params: Sockets.KoboldCPP.ClearDownloadHistory.Params
		response: Sockets.KoboldCPP.ClearDownloadHistory.Response
	}
	"koboldcpp:version": {
		params: Sockets.KoboldCPP.Version.Params
		response: Sockets.KoboldCPP.Version.Response
	}
	"koboldcpp:isUpdateAvailable": {
		params: Sockets.KoboldCPP.IsUpdateAvailable.Params
		response: Sockets.KoboldCPP.IsUpdateAvailable.Response
	}
	"koboldcpp:listModels": {
		params: Sockets.KoboldCPP.ListModels.Params
		response: Sockets.KoboldCPP.ListModels.Response
	}
	"koboldcpp:loadModel": {
		params: Sockets.KoboldCPP.LoadModel.Params
		response: Sockets.KoboldCPP.LoadModel.Response
	}
	"koboldcpp:connectModel": {
		params: Sockets.KoboldCPP.ConnectModel.Params
		response: Sockets.KoboldCPP.ConnectModel.Response
	}
	// Its image counterpart: creates a koboldcpp_managed_image connection naming
	// this file and registers it as the text->image default. Separate from
	// connectModel because the two branches share a type predicate with nothing
	// else — not because the "make it default" writers differ. They no longer
	// do: both register a row in `connection_defaults`, text under `text->text`
	// and image under `text->image`. There is no starred column left to claim.
	"koboldcpp:connectImageModel": {
		params: Sockets.KoboldCPP.ConnectImageModel.Params
		response: Sockets.KoboldCPP.ConnectImageModel.Response
	}
	"koboldcpp:perf": {
		params: Sockets.KoboldCPP.Perf.Params
		response: Sockets.KoboldCPP.Perf.Response
	}
	"koboldcpp:getLoadedConfig": {
		params: Sockets.KoboldCPP.GetLoadedConfig.Params
		response: Sockets.KoboldCPP.GetLoadedConfig.Response
	}
	// Managed mode events
	"koboldcpp:setManagedMode": {
		params: Sockets.KoboldCPP.SetManagedMode.Params
		response: Sockets.KoboldCPP.SetManagedMode.Response
	}
	"koboldcpp:setManagedPort": {
		params: Sockets.KoboldCPP.SetManagedPort.Params
		response: Sockets.KoboldCPP.SetManagedPort.Response
	}
	"koboldcpp:setManagedBinaryDir": {
		params: Sockets.KoboldCPP.SetManagedBinaryDir.Params
		response: Sockets.KoboldCPP.SetManagedBinaryDir.Response
	}
	"koboldcpp:setManagedAdminPassword": {
		params: Sockets.KoboldCPP.SetManagedAdminPassword.Params
		response: Sockets.KoboldCPP.SetManagedAdminPassword.Response
	}
	"koboldcpp:setModelTtl": {
		params: Sockets.KoboldCPP.SetModelTtl.Params
		response: Sockets.KoboldCPP.SetModelTtl.Response
	}
	"koboldcpp:listBinaryVariants": {
		params: Sockets.KoboldCPP.ListBinaryVariants.Params
		response: Sockets.KoboldCPP.ListBinaryVariants.Response
	}
	"koboldcpp:downloadBinary": {
		params: Sockets.KoboldCPP.DownloadBinary.Params
		response: Sockets.KoboldCPP.DownloadBinary.Response
	}
	"koboldcpp:getBinaryDownloadProgress": {
		params: Sockets.KoboldCPP.GetBinaryDownloadProgress.Params
		response: Sockets.KoboldCPP.GetBinaryDownloadProgress.Response
	}
	"koboldcpp:cancelBinaryDownload": {
		params: Sockets.KoboldCPP.CancelBinaryDownload.Params
		response: Sockets.KoboldCPP.CancelBinaryDownload.Response
	}
	"koboldcpp:startSubprocess": {
		params: Sockets.KoboldCPP.StartSubprocess.Params
		response: Sockets.KoboldCPP.StartSubprocess.Response
	}
	"koboldcpp:stopSubprocess": {
		params: Sockets.KoboldCPP.StopSubprocess.Params
		response: Sockets.KoboldCPP.StopSubprocess.Response
	}
	"koboldcpp:getSubprocessStatus": {
		params: Sockets.KoboldCPP.GetSubprocessStatus.Params
		response: Sockets.KoboldCPP.GetSubprocessStatus.Response
	}
	"koboldcpp:unloadModel": {
		params: Sockets.KoboldCPP.UnloadModel.Params
		response: Sockets.KoboldCPP.UnloadModel.Response
	}
	"koboldcpp:deleteModel": {
		params: Sockets.KoboldCPP.DeleteModel.Params
		response: Sockets.KoboldCPP.DeleteModel.Response
	}
	"koboldcpp:deleteModel:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"koboldcpp:connectModel:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	// A dedicated :error because the failure is user-visible and specific — the
	// chosen file went missing, or is not a tracked complete image model — and
	// the Models tab has to say which, not just fail to change state.
	"koboldcpp:connectImageModel:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"koboldcpp:setBaseUrl:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"koboldcpp:version:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"koboldcpp:isUpdateAvailable:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"koboldcpp:perf:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"koboldcpp:searchModels:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"koboldcpp:downloadModel:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"koboldcpp:recommendedModels": {
		params: Sockets.KoboldCPP.RecommendedModels.Params
		response: Sockets.KoboldCPP.RecommendedModels.Response
	}
	"koboldcpp:recommendedModels:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	// The "It's a text model" / "It's an image model" override on an Unverified
	// row. Writes kind_source "user", which nothing automatic may then overwrite.
	"koboldcpp:setModelKind": {
		params: Sockets.KoboldCPP.SetModelKind.Params
		response: Sockets.KoboldCPP.SetModelKind.Response
	}
	"koboldcpp:downloadProgress": {
		params: never
		response: Sockets.KoboldCPP.DownloadProgress.Response
	}
	"koboldcpp:setSubprocessTimeout": {
		params: Sockets.KoboldCPP.SetSubprocessTimeout.Params
		response: Sockets.KoboldCPP.SetSubprocessTimeout.Response
	}
	"koboldcpp:listReleaseVersions": {
		params: Sockets.KoboldCPP.ListReleaseVersions.Params
		response: Sockets.KoboldCPP.ListReleaseVersions.Response
	}
	"koboldcpp:listReleaseVersions:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"koboldcpp:listBinaryVariants:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"koboldcpp:checkManagedBinaryUpdate": {
		params: Sockets.KoboldCPP.CheckManagedBinaryUpdate.Params
		response: Sockets.KoboldCPP.CheckManagedBinaryUpdate.Response
	}
	"koboldcpp:checkManagedBinaryUpdate:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"koboldcpp:binaryDownloadProgress": {
		params: never
		response: Sockets.KoboldCPP.BinaryDownloadProgress.Response
	}
	"koboldcpp:startSubprocess:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"koboldcpp:subprocessStatus": {
		params: never
		response: Sockets.KoboldCPP.SubprocessStatus.Response
	}
	"koboldcpp:setManagedMode:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}

	// Ollama events
	"ollama:setBaseUrl": {
		params: Sockets.Ollama.SetBaseUrl.Params
		response: Sockets.Ollama.SetBaseUrl.Response
	}
	"ollama:modelsList": {
		params: Sockets.Ollama.ModelsList.Params
		response: Sockets.Ollama.ModelsList.Response
	}
	"ollama:deleteModel": {
		params: Sockets.Ollama.DeleteModel.Params
		response: Sockets.Ollama.DeleteModel.Response
	}
	"ollama:deleteModel:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"ollama:connectModel": {
		params: Sockets.Ollama.ConnectModel.Params
		response: Sockets.Ollama.ConnectModel.Response
	}
	"ollama:connectModel:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"ollama:pullModel": {
		params: Sockets.Ollama.PullModel.Params
		response: Sockets.Ollama.PullModel.Response
	}
	"ollama:version": {
		params: Sockets.Ollama.Version.Params
		response: Sockets.Ollama.Version.Response
	}
	"ollama:version:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"ollama:setBaseUrl:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"ollama:pullModel:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"ollama:listRunningModels": {
		params: Sockets.Ollama.ListRunningModels.Params
		response: Sockets.Ollama.ListRunningModels.Response
	}
	"ollama:isUpdateAvailable": {
		params: Sockets.Ollama.IsUpdateAvailable.Params
		response: Sockets.Ollama.IsUpdateAvailable.Response
	}
	"ollama:isUpdateAvailable:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"ollama:searchAvailableModels": {
		params: Sockets.Ollama.SearchAvailableModels.Params
		response: Sockets.Ollama.SearchAvailableModels.Response
	}
	"ollama:searchAvailableModels:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"ollama:clearDownloadHistory": {
		params: Sockets.Ollama.ClearDownloadHistory.Params
		response: Sockets.Ollama.ClearDownloadHistory.Response
	}
	"ollama:cancelPull": {
		params: Sockets.Ollama.CancelPull.Params
		response: Sockets.Ollama.CancelPull.Response
	}
	"ollama:getDownloadProgress": {
		params: Sockets.Ollama.GetDownloadProgress.Params
		response: Sockets.Ollama.GetDownloadProgress.Response
	}
	"ollama:recommendedModels": {
		params: Sockets.Ollama.RecommendedModels.Params
		response: Sockets.Ollama.RecommendedModels.Response
	}
	// The pull's progress push — emitted from inside `ollama:pullModel`'s
	// stream loop (src/lib/server/sockets/ollama.ts), never requested on its
	// own. Spelled inside the family so the `ollama:` restricted interest
	// prefix covers it like every other admin-only push.
	"ollama:pullProgress": {
		params: never
		response: Sockets.Ollama.PullProgress.Response
	}

	// System Settings events
	"systemSettings:get": {
		params: Sockets.SystemSettings.Get.Params
		response: Sockets.SystemSettings.Get.Response
	}
	"systemSettings:updateOllamaManagerEnabled": {
		params: Sockets.SystemSettings.UpdateOllamaManagerEnabled.Params
		response: Sockets.SystemSettings.UpdateOllamaManagerEnabled.Response
	}
	"systemSettings:updateKoboldCppManagerEnabled": {
		params: Sockets.SystemSettings.UpdateKoboldCppManagerEnabled.Params
		response: Sockets.SystemSettings.UpdateKoboldCppManagerEnabled.Response
	}
	"systemSettings:updateAccountsEnabled": {
		params: Sockets.SystemSettings.UpdateAccountsEnabled.Params
		response: Sockets.SystemSettings.UpdateAccountsEnabled.Response
	}
	"systemSettings:updateAccountsEnabled:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"systemSettings:updateScriptsEnabled": {
		params: Sockets.SystemSettings.UpdateScriptsEnabled.Params
		response: Sockets.SystemSettings.UpdateScriptsEnabled.Response
	}
	"systemSettings:updateBackupSettings": {
		params: Sockets.SystemSettings.UpdateBackupSettings.Params
		response: Sockets.SystemSettings.UpdateBackupSettings.Response
	}
	"systemSettings:updateBackupSettings:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"systemSettings:updateLegacyConfigsVisible": {
		params: Sockets.SystemSettings.UpdateLegacyConfigsVisible.Params
		response: Sockets.SystemSettings.UpdateLegacyConfigsVisible.Response
	}
	"systemSettings:updateLegacyConfigsVisible:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"systemSettings:updateContextDebuggingEnabled": {
		params: Sockets.SystemSettings.UpdateContextDebuggingEnabled.Params
		response: Sockets.SystemSettings.UpdateContextDebuggingEnabled.Response
	}
	"systemSettings:updateDefaultLanguage": {
		params: Sockets.SystemSettings.UpdateDefaultLanguage.Params
		response: Sockets.SystemSettings.UpdateDefaultLanguage.Response
	}
	"systemSettings:updateDefaultLanguage:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"systemSettings:updateAutoTranslate": {
		params: Sockets.SystemSettings.UpdateAutoTranslate.Params
		response: Sockets.SystemSettings.UpdateAutoTranslate.Response
	}
	"systemSettings:updateAutoTranslate:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}

	// UI language events (R5)
	"language:catalog": {
		params: Sockets.Language.Catalog.Params
		response: Sockets.Language.Catalog.Response
	}

	// Vectorization events
	"ner:status": {
		params: Sockets.Ner.Status.Params
		response: Sockets.Ner.Status.Response
	}
	"ner:unloadModel": {
		params: Sockets.Ner.UnloadModel.Params
		response: Sockets.Ner.UnloadModel.Response
	}
	"vectorization:listModels": {
		params: Sockets.Vectorization.ListModels.Params
		response: Sockets.Vectorization.ListModels.Response
	}
	"vectorization:loadModel": {
		params: Sockets.Vectorization.LoadModel.Params
		response: Sockets.Vectorization.LoadModel.Response
	}
	"vectorization:reindexCost": {
		params: Sockets.Vectorization.ReindexCost.Params
		response: Sockets.Vectorization.ReindexCost.Response
	}
	"vectorization:startQueue": {
		params: Sockets.Vectorization.StartQueue.Params
		response: Sockets.Vectorization.StartQueue.Response
	}
	"vectorization:stopQueue": {
		params: Sockets.Vectorization.StopQueue.Params
		response: Sockets.Vectorization.StopQueue.Response
	}
	"vectorization:status": {
		params: Sockets.Vectorization.Status.Params
		response: Sockets.Vectorization.Status.Response
	}
	"vectorization:unloadModel": {
		params: Sockets.Vectorization.UnloadModel.Params
		response: Sockets.Vectorization.UnloadModel.Response
	}
	"vectorization:progress": {
		params: Sockets.Vectorization.Progress.Params
		response: Sockets.Vectorization.Progress.Response
	}
	"vectorization:itemUpdated": {
		params: Sockets.Vectorization.ItemUpdated.Params
		response: Sockets.Vectorization.ItemUpdated.Response
	}
	"vectorization:modelDownloadProgress": {
		params: Sockets.Vectorization.ModelDownloadProgress.Params
		response: Sockets.Vectorization.ModelDownloadProgress.Response
	}
	"vectorization:loadModel:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"vectorization:checkRagStatus": {
		params: Sockets.Vectorization.CheckRagStatus.Params
		response: Sockets.Vectorization.CheckRagStatus.Response
	}
	"vectorization:setSessionRagIgnored": {
		params: Sockets.Vectorization.SetSessionRagIgnored.Params
		response: Sockets.Vectorization.SetSessionRagIgnored.Response
	}
	"vectorization:getQueue": {
		params: Sockets.Vectorization.GetQueue.Params
		response: Sockets.Vectorization.GetQueue.Response
	}
	"vectorization:addToQueue": {
		params: Sockets.Vectorization.AddToQueue.Params
		response: Sockets.Vectorization.AddToQueue.Response
	}
	"vectorization:moveQueueGroup": {
		params: Sockets.Vectorization.MoveQueueGroup.Params
		response: Sockets.Vectorization.MoveQueueGroup.Response
	}
	"vectorization:removeFromQueue": {
		params: Sockets.Vectorization.RemoveFromQueue.Params
		response: Sockets.Vectorization.RemoveFromQueue.Response
	}

	// User Settings events
	"userSettings:get": {
		params: Sockets.UserSettings.Get.Params
		response: Sockets.UserSettings.Get.Response
	}
	"userSettings:listBackgrounds": {
		params: Sockets.UserSettings.ListBackgrounds.Params
		response: Sockets.UserSettings.ListBackgrounds.Response
	}
	"userSettings:uploadBackground": {
		params: Sockets.UserSettings.UploadBackground.Params
		response: Sockets.UserSettings.UploadBackground.Response
	}
	"userSettings:uploadBackground:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"userSettings:deleteBackground": {
		params: Sockets.UserSettings.DeleteBackground.Params
		response: Sockets.UserSettings.DeleteBackground.Response
	}
	"userSettings:updateBackground": {
		params: Sockets.UserSettings.UpdateBackground.Params
		response: Sockets.UserSettings.UpdateBackground.Response
	}
	"userSettings:updateShowHomePageBanner": {
		params: Sockets.UserSettings.UpdateShowHomePageBanner.Params
		response: Sockets.UserSettings.UpdateShowHomePageBanner.Response
	}
	"userSettings:updateCharaVaultIncludeNsfw": {
		params: Sockets.UserSettings.UpdateCharaVaultIncludeNsfw.Params
		response: Sockets.UserSettings.UpdateCharaVaultIncludeNsfw.Response
	}
	"userSettings:updateCharaVaultIncludeNsfw:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"userSettings:updateEasyCharacterCreation": {
		params: Sockets.UserSettings.UpdateEasyCharacterCreation.Params
		response: Sockets.UserSettings.UpdateEasyCharacterCreation.Response
	}
	"userSettings:updateShowAllCharacterFields": {
		params: Sockets.UserSettings.UpdateShowAllCharacterFields.Params
		response: Sockets.UserSettings.UpdateShowAllCharacterFields.Response
	}
	"userSettings:updateTheme": {
		params: Sockets.UserSettings.UpdateTheme.Params
		response: Sockets.UserSettings.UpdateTheme.Response
	}
	"userSettings:updateDarkMode": {
		params: Sockets.UserSettings.UpdateDarkMode.Params
		response: Sockets.UserSettings.UpdateDarkMode.Response
	}
	"userSettings:updateLanguage": {
		params: Sockets.UserSettings.UpdateLanguage.Params
		response: Sockets.UserSettings.UpdateLanguage.Response
	}
	"userSettings:updateLanguage:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}

	// Lorebook events
	"lorebooks:list": {
		params: Sockets.Lorebooks.List.Params
		response: Sockets.Lorebooks.List.Response
	}
	"lorebooks:list:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"lorebooks:get": {
		params: Sockets.Lorebooks.Get.Params
		response: Sockets.Lorebooks.Get.Response
	}
	"lorebooks:create": {
		params: Sockets.Lorebooks.Create.Params
		response: Sockets.Lorebooks.Create.Response
	}
	// Synthesised by `register()` on a throw — see `entries:update:error`.
	"lorebooks:create:error": {
		params: never
		response: { error?: string }
	}
	"lorebooks:update": {
		params: Sockets.Lorebooks.Update.Params
		response: Sockets.Lorebooks.Update.Response
	}
	"lorebooks:delete": {
		params: Sockets.Lorebooks.Delete.Params
		response: Sockets.Lorebooks.Delete.Response
	}
	"lorebooks:duplicate": {
		params: Sockets.Lorebooks.Duplicate.Params
		response: Sockets.Lorebooks.Duplicate.Response
	}
	"lorebooks:duplicate:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"lorebooks:import": {
		params: Sockets.Lorebooks.Import.Params
		response: Sockets.Lorebooks.Import.Response
	}
	"lorebooks:import:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"lorebooks:importResolve": {
		params: Sockets.Lorebooks.ImportResolve.Params
		response: Sockets.Lorebooks.ImportResolve.Response
	}
	"lorebooks:importResolve:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"lorebooks:export": {
		params: Sockets.Lorebooks.Export.Params
		response: Sockets.Lorebooks.Export.Response
	}
	"lorebooks:export:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"lorebooks:createBinding": {
		params: Sockets.Lorebooks.CreateBinding.Params
		response: Sockets.Lorebooks.CreateBinding.Response
	}
	"lorebooks:updateBinding": {
		params: Sockets.Lorebooks.UpdateBinding.Params
		response: Sockets.Lorebooks.UpdateBinding.Response
	}
	"lorebooks:resolveOrCreateBindingByName": {
		params: Sockets.Lorebooks.ResolveOrCreateBindingByName.Params
		response: Sockets.Lorebooks.ResolveOrCreateBindingByName.Response
	}
	"lorebooks:resolveOrCreateBindingByName:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"lorebooks:bindingList": {
		params: Sockets.Lorebooks.BindingList.Params
		response: Sockets.Lorebooks.BindingList.Response
	}
	"lorebooks:bindingsForCharacter": {
		params: Sockets.Lorebooks.BindingsForCharacter.Params
		response: Sockets.Lorebooks.BindingsForCharacter.Response
	}
	"lorebooks:bindingsForCharacter:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}

	// Binding suggestions — derived candidates, stored decisions
	"bindingSuggestions:list": {
		params: Sockets.BindingSuggestions.List.Params
		response: Sockets.BindingSuggestions.List.Response
	}
	"bindingSuggestions:ignore": {
		params: Sockets.BindingSuggestions.Ignore.Params
		response: Sockets.BindingSuggestions.Ignore.Response
	}
	"bindingSuggestions:unignore": {
		params: Sockets.BindingSuggestions.Unignore.Params
		response: Sockets.BindingSuggestions.Unignore.Response
	}
	"bindingSuggestions:add": {
		params: Sockets.BindingSuggestions.Add.Params
		response: Sockets.BindingSuggestions.Add.Response
	}
	// The handlers refuse by throwing, so `register()` synthesises these — the
	// only channel a refusal ("already added", "name already taken") reaches the
	// manager on. Listened to, or an accepted-then-refused row spins forever.
	"bindingSuggestions:list:error": {
		params: never
		response: { error?: string }
	}
	"bindingSuggestions:ignore:error": {
		params: never
		response: { error?: string }
	}
	"bindingSuggestions:unignore:error": {
		params: never
		response: { error?: string }
	}
	"bindingSuggestions:add:error": {
		params: never
		response: { error?: string }
	}

	// Lorebook entry events — one namespace, every declared type
	"entries:list": {
		params: Sockets.Entries.List.Params
		response: Sockets.Entries.List.Response
	}
	"entries:create": {
		params: Sockets.Entries.Create.Params
		response: Sockets.Entries.Create.Response
	}
	// Synthesised by `register()` on a throw — see `entries:update:error`.
	"entries:create:error": {
		params: never
		response: { error?: string }
	}
	"entries:update": {
		params: Sockets.Entries.Update.Params
		response: Sockets.Entries.Update.Response
	}
	// Synthesised by `register()` on a throw — the entry handlers refuse by
	// throwing rather than by returning an error field, so a caller that is
	// not the manager itself (the retrieval explanation's levers) has nowhere
	// else to learn the write was refused.
	"entries:update:error": {
		params: never
		response: { error?: string }
	}
	"entries:delete": {
		params: Sockets.Entries.Delete.Params
		response: Sockets.Entries.Delete.Response
	}
	"entries:updatePositions": {
		params: Sockets.Entries.UpdatePositions.Params
		response: Sockets.Entries.UpdatePositions.Response
	}
	"entries:iterateNext": {
		params: Sockets.Entries.IterateNext.Params
		response: Sockets.Entries.IterateNext.Response
	}
	// The two reads the lorebook workspace's frame asks for: the navigation
	// column's figures, and the retrieval markers on its rows.
	"entries:counts": {
		params: Sockets.Entries.Counts.Params
		response: Sockets.Entries.Counts.Response
	}
	"entries:recentDecisions": {
		params: Sockets.Entries.RecentDecisions.Params
		response: Sockets.Entries.RecentDecisions.Response
	}
	"entries:testRetrieval": {
		params: Sockets.Entries.TestRetrieval.Params
		response: Sockets.Entries.TestRetrieval.Response
	}
	// The handler answers its own refusals on the channel above, with the
	// sentence that says which one it was. This is `register()`'s synthesised
	// fallback for a throw it did not expect — listened to so the editor stops
	// waiting rather than spinning forever on a generic failure.
	"entries:testRetrieval:error": {
		params: never
		response: { error?: string }
	}

	// Scenes events
	"scenes:list": {
		params: Sockets.Scenes.List.Params
		response: Sockets.Scenes.List.Response
	}
	"scenes:list:error": {
		params: never
		response: Sockets.ErrorResponse
	}
	"scenes:scenedMessageIds": {
		params: Sockets.Scenes.SenedMessageIds.Params
		response: Sockets.Scenes.SenedMessageIds.Response
	}
	"scenes:scenedMessageIds:error": {
		params: never
		response: Sockets.ErrorResponse
	}
	"scenes:listByLorebook": {
		params: Sockets.Scenes.ListByLorebook.Params
		response: Sockets.Scenes.ListByLorebook.Response
	}
	"scenes:create": {
		params: Sockets.Scenes.Create.Params
		response: Sockets.Scenes.Create.Response
	}
	// Synthesised by `register()` on a throw — see `entries:update:error`.
	"scenes:create:error": {
		params: never
		response: { error?: string }
	}
	"scenes:update": {
		params: Sockets.Scenes.Update.Params
		response: Sockets.Scenes.Update.Response
	}
	"scenes:delete": {
		params: Sockets.Scenes.Delete.Params
		response: Sockets.Scenes.Delete.Response
	}
	"scenes:process": {
		params: Sockets.Scenes.Process.Params
		response: Sockets.Scenes.Process.Response
	}
	"scenes:process:progress": {
		params: never
		response: Sockets.Scenes.Process.Progress
	}
	"scenes:process:complete": {
		params: never
		response: Sockets.Scenes.Process.Response
	}
	"scenes:process:error": {
		params: never
		response: Sockets.Scenes.Process.ErrorResponse
	}
	"scenes:process:trace": {
		params: never
		response: Sockets.Scenes.Process.TraceEntry
	}
	"scenes:compile": {
		params: Sockets.Scenes.Compile.Params
		response: Sockets.Scenes.Compile.Response
	}
	"scenes:compile:progress": {
		params: never
		response: Sockets.Scenes.Compile.Progress
	}
	"scenes:compile:complete": {
		params: never
		response: Sockets.Scenes.Compile.Response
	}
	"scenes:compile:error": {
		params: never
		response: Sockets.Scenes.Compile.ErrorResponse
	}

	// Media events (28)
	"media:list": {
		params: Sockets.Media.List.Params
		response: Sockets.Media.List.Response
	}
	"media:list:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"media:regenerateThumbnail": {
		params: Sockets.Media.RegenerateThumbnail.Params
		response: Sockets.Media.RegenerateThumbnail.Response
	}
	"media:regenerateThumbnail:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"media:setFrame": {
		params: Sockets.Media.SetFrame.Params
		response: Sockets.Media.SetFrame.Response
	}
	"media:setFrame:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"media:setVisibility": {
		params: Sockets.Media.SetVisibility.Params
		response: Sockets.Media.SetVisibility.Response
	}
	"media:setVisibility:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"media:delete": {
		params: Sockets.Media.Delete.Params
		response: Sockets.Media.Delete.Response
	}
	"media:delete:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	// Storage cleanup (0182). Preview is priced separately from the two cull
	// actions on purpose: an admin sees a count and a size before anything is
	// destroyed, and culling originals is its own louder event rather than a
	// flag on the safe one.
	"media:cleanupPreview": {
		params: Sockets.Media.CleanupPreview.Params
		response: Sockets.Media.CleanupPreview.Response
	}
	"media:cleanupPreview:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"media:cullDerived": {
		params: Sockets.Media.CullDerived.Params
		response: Sockets.Media.CullDerived.Response
	}
	"media:cullDerived:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"media:cullOriginals": {
		params: Sockets.Media.CullOriginals.Params
		response: Sockets.Media.CullOriginals.Response
	}
	"media:cullOriginals:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"media:setCachePolicy": {
		params: Sockets.Media.SetCachePolicy.Params
		response: Sockets.Media.SetCachePolicy.Response
	}
	"media:setCachePolicy:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"media:changed": {
		params: Sockets.Media.Changed.Params
		response: Sockets.Media.Changed.Response
	}

	// Tag events
	"tags:list": {
		params: Sockets.Tags.List.Params
		response: Sockets.Tags.List.Response
	}
	"tags:list:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"tags:create": {
		params: Sockets.Tags.Create.Params
		response: Sockets.Tags.Create.Response
	}
	"tags:update": {
		params: Sockets.Tags.Update.Params
		response: Sockets.Tags.Update.Response
	}
	"tags:delete": {
		params: Sockets.Tags.Delete.Params
		response: Sockets.Tags.Delete.Response
	}
	"tags:create:error": {
		params: Sockets.Tags.Create.Params
		response: Sockets.ErrorResponse
	}
	"tags:update:error": {
		params: Sockets.Tags.Update.Params
		response: Sockets.ErrorResponse
	}
	"tags:delete:error": {
		params: Sockets.Tags.Delete.Params
		response: Sockets.ErrorResponse
	}
	"tags:getRelatedData": {
		params: Sockets.Tags.GetRelatedData.Params
		response: Sockets.Tags.GetRelatedData.Response
	}

	// Narrative Graph events
	"narrativeGraph:list": {
		params: Sockets.NarrativeGraph.List.Params
		response: Sockets.NarrativeGraph.List.Response
	}
	"narrativeGraph:build": {
		params: Sockets.NarrativeGraph.Build.Params
		response: Sockets.NarrativeGraph.Build.Response
	}
	"narrativeGraph:build:progress": {
		params: Sockets.NarrativeGraph.Build.Progress
		response: Sockets.NarrativeGraph.Build.Progress
	}
	"narrativeGraph:build:complete": {
		params: Sockets.NarrativeGraph.Build.Response
		response: Sockets.NarrativeGraph.Build.Response
	}
	"narrativeGraph:build:error": {
		params: Sockets.NarrativeGraph.Build.ErrorResponse
		response: Sockets.NarrativeGraph.Build.ErrorResponse
	}
	"narrativeGraph:buildLog": {
		params: Sockets.NarrativeGraph.BuildLogEntry
		response: Sockets.NarrativeGraph.BuildLogEntry
	}
	"narrativeGraph:applyProposal": {
		params: Sockets.NarrativeGraph.ApplyProposal.Params
		response: Sockets.NarrativeGraph.ApplyProposal.Response
	}
	// Deliberately absent from Layout's HANDLED_ERROR_EVENTS: the modal's
	// listener only un-sticks the Apply button, and the catch-all supplies the
	// toast with the server's real message.
	"narrativeGraph:applyProposal:error": {
		params: Sockets.NarrativeGraph.ApplyProposal.ErrorResponse
		response: Sockets.NarrativeGraph.ApplyProposal.ErrorResponse
	}
	"narrativeGraph:updateNode": {
		params: {
			node: Partial<Sockets.NarrativeGraph.NarrativeNode> & { id: number }
		}
		response: { node: Sockets.NarrativeGraph.NarrativeNode }
	}
	"narrativeGraph:deleteNode": {
		params: { id: number }
		response: { success: string }
	}
	"narrativeGraph:checkNodeMergeReferences": {
		params: Sockets.NarrativeGraph.CheckNodeMergeReferences.Params
		response: Sockets.NarrativeGraph.CheckNodeMergeReferences.Response
	}
	"narrativeGraph:updateRelationship": {
		params: {
			relationship: Partial<Sockets.NarrativeGraph.NarrativeRelationship> & {
				id: number
			}
		}
		response: { relationship: Sockets.NarrativeGraph.NarrativeRelationship }
	}
	"narrativeGraph:deleteRelationship": {
		params: { id: number }
		response: { success: string }
	}
	"narrativeGraph:createRelationship": {
		params: Sockets.NarrativeGraph.CreateRelationship.Params
		response: Sockets.NarrativeGraph.CreateRelationship.Response
	}
	"narrativeGraph:createNode": {
		params: Sockets.NarrativeGraph.CreateNode.Params
		response: Sockets.NarrativeGraph.CreateNode.Response
	}
	"narrativeGraph:queryContext": {
		params: Sockets.NarrativeGraph.QueryContext.Params
		response: Sockets.NarrativeGraph.QueryContext.Response
	}
	"narrativeGraph:linkOrphanBinding": {
		params: Sockets.NarrativeGraph.LinkOrphanBinding.Params
		response: Sockets.NarrativeGraph.LinkOrphanBinding.Response
	}
	"narrativeGraph:mergeNode": {
		params: Sockets.NarrativeGraph.MergeNode.Params
		response: Sockets.NarrativeGraph.MergeNode.Response
	}
	"narrativeGraph:mergeNode:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"narrativeGraph:undoMerge": {
		params: Sockets.NarrativeGraph.UndoMerge.Params
		response: Sockets.NarrativeGraph.UndoMerge.Response
	}
	"narrativeGraph:listMergeLogs": {
		params: Sockets.NarrativeGraph.ListMergeLogs.Params
		response: Sockets.NarrativeGraph.ListMergeLogs.Response
	}
	"narrativeGraph:duplicateCandidates": {
		params: Sockets.NarrativeGraph.DuplicateCandidates.Params
		response: Sockets.NarrativeGraph.DuplicateCandidates.Response
	}
	"narrativeGraph:dismissDuplicate": {
		params: Sockets.NarrativeGraph.DismissDuplicate.Params
		response: Sockets.NarrativeGraph.DismissDuplicate.Response
	}
	"bindingCheck:result": {
		params: never
		response: Sockets.BindingCheck.Result.Response
	}

	// Import events
	"import:sillytavern:startSession": {
		params: Sockets.Import.SillyTavern.StartSession.Params
		response: Sockets.Import.SillyTavern.StartSession.Response
	}
	"import:sillytavern:stageFiles": {
		params: Sockets.Import.SillyTavern.StageFiles.Params
		response: Sockets.Import.SillyTavern.StageFiles.Response
	}
	"import:sillytavern:scan": {
		params: Sockets.Import.SillyTavern.Scan.Params
		response: Sockets.Import.SillyTavern.Scan.Response
	}
	"import:sillytavern:execute": {
		params: Sockets.Import.SillyTavern.Execute.Params
		response: Sockets.Import.SillyTavern.Execute.Response
	}

	"setup:get": {
		params: Record<string, never>
		response: {
			setup: {
				ragStepComplete: boolean
			} | null
		}
	}
	"setup:markComplete": {
		params: { step: "rag" }
		response: {
			setup: {
				ragStepComplete: boolean
			}
		}
	}

	// Task queue events (admin-only)
	"taskQueue:get": {
		params: Record<string, never>
		response: never
	}
	"taskQueue:update": {
		params: never
		response: {
			tasks: Array<{
				id: string
				taskType: string
				connectionName: string
				samplingName: string
				startedAt: string
				sessionId?: number
				lorebookId?: number
				label?: string
			}>
		}
	}

	// Activity events
	"activity:get": {
		params: Record<string, never>
		response: never
	}
	"activity:dismiss": {
		params: Sockets.Activity.Dismiss.Request
		response: never
	}
	"activity:cancel": {
		params: Sockets.Activity.Cancel.Request
		response: never
	}
	"activity:update": {
		params: never
		response: Sockets.Activity.Update.Response
	}

	// Custom Theme events
	"customThemes:list": {
		params: Sockets.CustomThemes.List.Params
		response: Sockets.CustomThemes.List.Response
	}
	"customThemes:list:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"customThemes:getCss": {
		params: Sockets.CustomThemes.GetCss.Params
		response: Sockets.CustomThemes.GetCss.Response
	}
	"customThemes:save": {
		params: Sockets.CustomThemes.Save.Params
		response: Sockets.CustomThemes.Save.Response
	}
	"customThemes:save:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"customThemes:delete": {
		params: Sockets.CustomThemes.Delete.Params
		response: Sockets.CustomThemes.Delete.Response
	}
	"customThemes:delete:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"customThemes:setInstanceTheme": {
		params: Sockets.CustomThemes.SetInstanceTheme.Params
		response: Sockets.CustomThemes.SetInstanceTheme.Response
	}
	"customThemes:setInstanceTheme:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}

	// Widget styles (PLAN 25) — the skins a session widget wears. Every
	// mutation is answered by an unfiltered `widgetStyles:list` push to the
	// actor, so the client never has to patch a row off a mutation reply.
	"widgetStyles:list": {
		params: Sockets.WidgetStyles.List.Params
		response: Sockets.WidgetStyles.List.Response
	}
	"widgetStyles:list:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"widgetStyles:create": {
		params: Sockets.WidgetStyles.Create.Params
		response: Sockets.WidgetStyles.Create.Response
	}
	"widgetStyles:create:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"widgetStyles:update": {
		params: Sockets.WidgetStyles.Update.Params
		response: Sockets.WidgetStyles.Update.Response
	}
	"widgetStyles:update:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"widgetStyles:delete": {
		params: Sockets.WidgetStyles.Delete.Params
		response: Sockets.WidgetStyles.Delete.Response
	}
	"widgetStyles:delete:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"widgetStyles:clone": {
		params: Sockets.WidgetStyles.Clone.Params
		response: Sockets.WidgetStyles.Clone.Response
	}
	"widgetStyles:clone:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}

	// Stats and states — the resolved session state, the three possession
	// verbs, and the review gate the model's proposals wait at. Every mutation
	// answers with the whole resolved state and broadcasts `state:changed` to
	// the session, because one edit can move several reads and a client
	// patching a row would be a second resolver.
	"state:get": {
		params: Sockets.State.Get.Params
		response: Sockets.State.Get.Response
	}
	"state:get:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"state:set": {
		params: Sockets.State.Set.Params
		response: Sockets.State.Set.Response
	}
	"state:set:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"state:give": {
		params: Sockets.State.Give.Params
		response: Sockets.State.Give.Response
	}
	"state:give:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"state:take": {
		params: Sockets.State.Take.Params
		response: Sockets.State.Take.Response
	}
	"state:take:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"state:transfer": {
		params: Sockets.State.Transfer.Params
		response: Sockets.State.Transfer.Response
	}
	"state:transfer:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"state:configure": {
		params: Sockets.State.Configure.Params
		response: Sockets.State.Configure.Response
	}
	"state:configure:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"state:ledger": {
		params: Sockets.State.Ledger.Params
		response: Sockets.State.Ledger.Response
	}
	"state:ledger:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"state:proposals": {
		params: Sockets.State.Proposals.Params
		response: Sockets.State.Proposals.Response
	}
	"state:proposals:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"state:decide": {
		params: Sockets.State.Decide.Params
		response: Sockets.State.Decide.Response
	}
	"state:decide:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	/** Broadcast only — no handler answers it; a surface re-reads on it. */
	"state:changed": {
		params: Sockets.State.Changed.Params
		response: Sockets.State.Changed.Response
	}

	// Jump — the shell's universal search overlay. Request and reply share the
	// event name, the app's request/reply convention; the reply echoes its
	// `query` so a client can recognise the answer to its own last keystroke.
	// Types live in shared/sockets/jump rather than the Sockets namespace
	// (mid-refactor), imported at the top of the file, like images: above.
	"jump:search": {
		params: JumpSearchParams
		response: JumpSearchResponse
	}
	"jump:search:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}

	/**
	 * The client's full interest key list, replacing the server's per-socket
	 * interest set. Sent by the interest registry only — eagerly on change,
	 * every 30s, and on every connect. Nothing answers it, hence `never`.
	 */
	"interest:sync": {
		params: InterestSyncParams
		response: never
	}

	// Global error/success events
	error: {
		params: never
		response: Sockets.Error.Response
	}
	success: {
		params: never
		response: Sockets.Success.Response
	}
}

// Type-safe socket interface
export interface TypedSocket {
	// Type-safe emit method
	emit<K extends keyof SocketEventMap>(
		event: K,
		params: SocketEventMap[K]["params"]
	): void

	// There is no on/off/once here, and no catch-all: listening is the interest
	// registry's job (see the header). A view that wants an event declares it;
	// a one-shot request uses `requestWithInterest`.

	// Original socket methods for backward compatibility
	id: string
	connected: boolean
	join(room: string): void
	leave(room: string): void
	disconnect(): void
}

// Create a typed socket wrapper
export function createTypedSocket(): TypedSocket {
	const socket = getSocket() as any

	if (!socket) {
		throw new Error(
			"Socket not available - ensure socket client is loaded first"
		)
	}

	return {
		emit: <K extends keyof SocketEventMap>(
			event: K,
			params: SocketEventMap[K]["params"]
		) => {
			// Ruling 3, guaranteed here rather than at ~570 call sites: a pending
			// interest sync goes out on this same socket FIRST, so the handler that
			// answers this request already holds the reply's key. A no-op — one
			// boolean read — when nothing is pending.
			flushInterestSync()
			socket.emit(event as string, params)
		},

		// Pass through original socket properties with safe access
		get id() {
			return socket?.id || ""
		},
		get connected() {
			return socket?.connected || false
		},
		join: (room: string) => {
			if (socket?.join) socket.join(room)
		},
		leave: (room: string) => {
			if (socket?.leave) socket.leave(room)
		},
		disconnect: () => {
			if (socket?.disconnect) socket.disconnect()
		}
	}
}

// Convenience hook for getting a typed socket
export function useTypedSocket(): TypedSocket {
	return createTypedSocket()
}

/**
 * The typed socket if one exists yet, else `null`.
 *
 * `createTypedSocket` throws when the socket is not up — the right answer for a
 * component that cannot run without one, and the wrong one for a module-scoped
 * store that may be read during SSR or in the tick before the socket connects.
 * A store answering that for itself has to import `socketInstance`, the raw
 * socket, into a file whose listeners belong to the interest registry. One
 * helper here, where reading the live socket is this directory's job, keeps the
 * instance module unimported outside `sockets/`.
 */
export function typedSocketOrNull(): TypedSocket | null {
	return getSocket() ? createTypedSocket() : null
}
