import * as skio from "sveltekit-io"

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
	"characters:setAvatar": {
		params: Sockets.Characters.SetAvatar.Params
		response: Sockets.Characters.SetAvatar.Response
	}
	"characters:reorderGallery": {
		params: Sockets.Characters.ReorderGallery.Params
		response: Sockets.Characters.ReorderGallery.Response
	}

	// Connection events
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
	"connections:setUserActive": {
		params: Sockets.Connections.SetUserActive.Params
		response: Sockets.Connections.SetUserActive.Response
	}
	"connections:test": {
		params: Sockets.Connections.Test.Params
		response: Sockets.Connections.Test.Response
	}
	"connections:refreshModels": {
		params: Sockets.Connections.RefreshModels.Params
		response: Sockets.Connections.RefreshModels.Response
	}
	"connections:refreshModels:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}

	// Persona events
	"personas:list": {
		params: Sockets.Personas.List.Params
		response: Sockets.Personas.List.Response
	}
	"personas:list:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"personas:get": {
		params: Sockets.Personas.Get.Params
		response: Sockets.Personas.Get.Response
	}
	"personas:create": {
		params: Sockets.Personas.Create.Params
		response: Sockets.Personas.Create.Response
	}
	"personas:create:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"personas:update": {
		params: Sockets.Personas.Update.Params
		response: Sockets.Personas.Update.Response
	}
	"personas:update:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"personas:delete": {
		params: Sockets.Personas.Delete.Params
		response: Sockets.Personas.Delete.Response
	}
	"personas:delete:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"personas:searchLibrary": {
		params: Sockets.Personas.SearchLibrary.Params
		response: Sockets.Personas.SearchLibrary.Response
	}
	"personas:searchLibrary:error": {
		params: Sockets.SearchLibraryErrorResponse
		response: Sockets.SearchLibraryErrorResponse
	}
	"personas:importCard": {
		params: Sockets.Personas.ImportCard.Params
		response: Sockets.Personas.ImportCard.Response
	}
	"personas:importCard:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"personas:importResolve": {
		params: Sockets.Personas.ImportResolve.Params
		response: Sockets.Personas.ImportResolve.Response
	}
	"personas:importResolve:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"personas:exportCard": {
		params: Sockets.Personas.ExportCard.Params
		response: Sockets.Personas.ExportCard.Response
	}
	"personas:exportCard:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"personas:importFromLibrary": {
		params: Sockets.Personas.ImportFromLibrary.Params
		response: Sockets.Personas.ImportFromLibrary.Response
	}
	"personas:importFromLibrary:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"personas:listGallery": {
		params: Sockets.Personas.ListGallery.Params
		response: Sockets.Personas.ListGallery.Response
	}
	"personas:uploadGalleryImage": {
		params: Sockets.Personas.UploadGalleryImage.Params
		response: Sockets.Personas.UploadGalleryImage.Response
	}
	"personas:deleteGalleryImage": {
		params: Sockets.Personas.DeleteGalleryImage.Params
		response: Sockets.Personas.DeleteGalleryImage.Response
	}
	"personas:setAvatar": {
		params: Sockets.Personas.SetAvatar.Params
		response: Sockets.Personas.SetAvatar.Response
	}
	"personas:reorderGallery": {
		params: Sockets.Personas.ReorderGallery.Params
		response: Sockets.Personas.ReorderGallery.Response
	}
	"personas:setDefault": {
		params: Sockets.Personas.SetDefault.Params
		response: Sockets.Personas.SetDefault.Response
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

	// Chat events
	"chats:list": {
		params: Sockets.Chats.List.Params
		response: Sockets.Chats.List.Response
	}
	"chats:typing": {
		params: Sockets.Chats.Typing.Params
		response: Sockets.Chats.Typing.Response
	}
	"chats:userTyping": {
		params: Sockets.Chats.UserTyping.Params
		response: Sockets.Chats.UserTyping.Response
	}
	"chats:get": {
		params: Sockets.Chats.Get.Params
		response: Sockets.Chats.Get.Response
	}
	"chats:saveDraft": {
		params: Sockets.Chats.SaveDraft.Params
		response: Sockets.Chats.SaveDraft.Response
	}
	"chats:create": {
		params: Sockets.Chats.Create.Params
		response: Sockets.Chats.Create.Response
	}
	"chats:update": {
		params: Sockets.Chats.Update.Params
		response: Sockets.Chats.Update.Response
	}
	"chats:setLorebook": {
		params: Sockets.Chats.SetLorebook.Params
		response: Sockets.Chats.SetLorebook.Response
	}
	"chats:summarize": {
		params: Sockets.Chats.Summarize.Params
		response: Sockets.Chats.Summarize.Response
	}
	"chats:summarize:progress": {
		params: never
		response: Sockets.Chats.Summarize.Progress
	}
	"chats:summarize:complete": {
		params: never
		response: Sockets.Chats.Summarize.Response
	}
	"chats:summarize:error": {
		params: never
		response: Sockets.Chats.Summarize.ErrorResponse
	}
	"chats:summarize:trace": {
		params: never
		response: Sockets.Chats.Summarize.TraceEntry
	}
	"chats:delete": {
		params: Sockets.Chats.Delete.Params
		response: Sockets.Chats.Delete.Response
	}
	"chats:toggleChatCharacterActive": {
		params: Sockets.Chats.ToggleChatCharacterActive.Params
		response: Sockets.Chats.ToggleChatCharacterActive.Response
	}
	"chats:updateChatCharacterVisibility": {
		params: Sockets.Chats.UpdateChatCharacterVisibility.Params
		response: Sockets.Chats.UpdateChatCharacterVisibility.Response
	}
	"chats:triggerNarratorResponse": {
		params: Sockets.Chats.TriggerNarratorResponse.Params
		response: Sockets.Chats.TriggerNarratorResponse.Response
	}
	"chats:getNarratorName": {
		params: Sockets.Chats.GetNarratorName.Params
		response: Sockets.Chats.GetNarratorName.Response
	}
	"chats:list:error": {
		params: never
		response: Sockets.ErrorResponse
	}
	"chats:delete:error": {
		params: never
		response: Sockets.ErrorResponse
	}
	"chats:create:error": {
		params: never
		response: Sockets.ErrorResponse
	}
	"chats:update:error": {
		params: never
		response: Sockets.ErrorResponse
	}
	"chats:get:error": {
		params: never
		response: Sockets.ErrorResponse
	}
	"chats:addPersona": {
		params: Sockets.Chats.AddPersona.Params
		response: Sockets.Chats.AddPersona.Response
	}
	"chats:addPersona:error": {
		params: never
		response: Sockets.ErrorResponse
	}
	"chats:addGuest": {
		params: Sockets.Chats.AddGuest.Params
		response: Sockets.Chats.AddGuest.Response
	}
	"chats:addGuest:error": {
		params: never
		response: Sockets.ErrorResponse
	}
	"chats:removeGuest": {
		params: Sockets.Chats.RemoveGuest.Params
		response: Sockets.Chats.RemoveGuest.Response
	}
	"chats:removeGuest:error": {
		params: never
		response: Sockets.ErrorResponse
	}
	"chats:getResponseOrder": {
		params: Sockets.Chats.GetResponseOrder.Params
		response: Sockets.Chats.GetResponseOrder.Response
	}
	"chats:promptTokenCount": {
		params: Sockets.Chats.PromptTokenCount.Params
		response: Sockets.Chats.PromptTokenCount.Response
	}
	"chats:triggerGenerateMessage": {
		params: Sockets.Chats.TriggerGenerateMessage.Params
		response: Sockets.Chats.TriggerGenerateMessage.Response
	}
	"chats:branch": {
		params: Sockets.Chats.Branch.Params
		response: Sockets.Chats.Branch.Response
	}
	"chats:branch:error": {
		params: never
		response: Sockets.ErrorResponse
	}
	"chats:reassignRemovedParticipant": {
		params: Sockets.Chats.ReassignRemovedParticipant.Params
		response: Sockets.Chats.ReassignRemovedParticipant.Response
	}
	"chats:reassignRemovedParticipant:error": {
		params: never
		response: Sockets.ErrorResponse
	}

	// Chat Message events
	"chatMessages:sendPersonaMessage": {
		params: Sockets.ChatMessages.SendPersonaMessage.Params
		response: Sockets.ChatMessages.SendPersonaMessage.Response
	}
	"chatMessages:sendCharacterMessage": {
		params: Sockets.ChatMessages.SendCharacterMessage.Params
		response: Sockets.ChatMessages.SendCharacterMessage.Response
	}
	"chatMessages:update": {
		params: Sockets.ChatMessages.Update.Params
		response: Sockets.ChatMessages.Update.Response
	}
	"chatMessages:delete": {
		params: Sockets.ChatMessages.Delete.Params
		response: Sockets.ChatMessages.Delete.Response
	}
	"chatMessages:regenerate": {
		params: Sockets.ChatMessages.Regenerate.Params
		response: Sockets.ChatMessages.Regenerate.Response
	}
	"chatMessages:continue": {
		params: Sockets.ChatMessages.Continue.Params
		response: Sockets.ChatMessages.Continue.Response
	}
	"chatMessages:swipeLeft": {
		params: Sockets.ChatMessages.SwipeLeft.Params
		response: Sockets.ChatMessages.SwipeLeft.Response
	}
	"chatMessages:swipeRight": {
		params: Sockets.ChatMessages.SwipeRight.Params
		response: Sockets.ChatMessages.SwipeRight.Response
	}
	"chatMessages:cancel": {
		params: Sockets.ChatMessages.Cancel.Params
		response: Sockets.ChatMessages.Cancel.Response
	}

	// Legacy events (should be migrated) - temporarily using any types
	chatMessage: {
		params: Sockets.ChatMessage.Call
		response: Sockets.ChatMessage.Response
	}
	"chatMessage:error": {
		params: never
		response: Sockets.ChatMessage.Response
	}
	lorebookBindingList: {
		params: any
		response: any
	}
	historyEntryList: {
		params: any
		response: any
	}
	worldLoreEntryList: {
		params: any
		response: any
	}
	characterLoreEntryList: {
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
	"samplingConfigs:update": {
		params: Sockets.SamplingConfigs.Update.Params
		response: Sockets.SamplingConfigs.Update.Response
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
	"pipelines:clearOption:error": {
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
		response: { error?: string }
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

	// Narrator Prompt Config events ("Chat Prompts: Narrator")
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
	// Raw legacy progress event (no colon-namespacing) - emitted directly via
	// emitToUser("ollamaPullProgress", ...) in src/lib/server/sockets/ollama.ts
	// rather than through the Handler/register pattern, so it never got a
	// "ollama:" prefix like the rest of this namespace.
	ollamaPullProgress: {
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
	"systemSettings:updateSummarizationEnabled": {
		params: Sockets.SystemSettings.UpdateSummarizationEnabled.Params
		response: Sockets.SystemSettings.UpdateSummarizationEnabled.Response
	}
	"systemSettings:updateContextDebuggingEnabled": {
		params: Sockets.SystemSettings.UpdateContextDebuggingEnabled.Params
		response: Sockets.SystemSettings.UpdateContextDebuggingEnabled.Response
	}

	// Vectorization events
	"vectorizationConfig:get": {
		params: Sockets.VectorizationConfig.Get.Params
		response: Sockets.VectorizationConfig.Get.Response
	}
	"vectorizationConfig:update": {
		params: Sockets.VectorizationConfig.Update.Params
		response: Sockets.VectorizationConfig.Update.Response
	}
	"vectorization:listModels": {
		params: Sockets.Vectorization.ListModels.Params
		response: Sockets.Vectorization.ListModels.Response
	}
	"vectorization:enable": {
		params: Sockets.Vectorization.EnableVectorization.Params
		response: Sockets.Vectorization.EnableVectorization.Response
	}
	"vectorization:disable": {
		params: Sockets.Vectorization.DisableVectorization.Params
		response: Sockets.Vectorization.DisableVectorization.Response
	}
	"vectorization:setModel": {
		params: Sockets.Vectorization.SetModel.Params
		response: Sockets.Vectorization.SetModel.Response
	}
	"vectorization:setApiConfig": {
		params: Sockets.Vectorization.SetApiConfig.Params
		response: Sockets.Vectorization.SetApiConfig.Response
	}
	"vectorization:startQueue": {
		params: Sockets.Vectorization.StartQueue.Params
		response: Sockets.Vectorization.StartQueue.Response
	}
	"vectorization:stopQueue": {
		params: Sockets.Vectorization.StopQueue.Params
		response: Sockets.Vectorization.StopQueue.Response
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
	"vectorization:enable:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"vectorization:setModel:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"vectorization:checkRagStatus": {
		params: Sockets.Vectorization.CheckRagStatus.Params
		response: Sockets.Vectorization.CheckRagStatus.Response
	}
	"vectorization:setChatRagIgnored": {
		params: Sockets.Vectorization.SetChatRagIgnored.Params
		response: Sockets.Vectorization.SetChatRagIgnored.Response
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
	"userSettings:updateEasyPersonaCreation": {
		params: Sockets.UserSettings.UpdateEasyPersonaCreation.Params
		response: Sockets.UserSettings.UpdateEasyPersonaCreation.Response
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
	"lorebooks:update": {
		params: Sockets.Lorebooks.Update.Params
		response: Sockets.Lorebooks.Update.Response
	}
	"lorebooks:delete": {
		params: Sockets.Lorebooks.Delete.Params
		response: Sockets.Lorebooks.Delete.Response
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

	// History Entries events
	"historyEntries:list": {
		params: Sockets.HistoryEntries.List.Params
		response: Sockets.HistoryEntries.List.Response
	}
	"historyEntries:create": {
		params: Sockets.HistoryEntries.Create.Params
		response: Sockets.HistoryEntries.Create.Response
	}
	"historyEntries:update": {
		params: Sockets.HistoryEntries.Update.Params
		response: Sockets.HistoryEntries.Update.Response
	}
	"historyEntries:delete": {
		params: Sockets.HistoryEntries.Delete.Params
		response: Sockets.HistoryEntries.Delete.Response
	}
	"historyEntries:iterateNext": {
		params: Sockets.HistoryEntries.IterateNext.Params
		response: Sockets.HistoryEntries.IterateNext.Response
	}

	// World Lore Entries events
	"worldLoreEntries:list": {
		params: Sockets.WorldLoreEntries.List.Params
		response: Sockets.WorldLoreEntries.List.Response
	}
	"worldLoreEntries:create": {
		params: Sockets.WorldLoreEntries.Create.Params
		response: Sockets.WorldLoreEntries.Create.Response
	}
	"worldLoreEntries:update": {
		params: Sockets.WorldLoreEntries.Update.Params
		response: Sockets.WorldLoreEntries.Update.Response
	}
	"worldLoreEntries:delete": {
		params: Sockets.WorldLoreEntries.Delete.Params
		response: Sockets.WorldLoreEntries.Delete.Response
	}
	"worldLoreEntries:updatePositions": {
		params: Sockets.WorldLoreEntries.UpdatePositions.Params
		response: Sockets.WorldLoreEntries.UpdatePositions.Response
	}

	// Character Lore Entries events
	"characterLoreEntries:list": {
		params: Sockets.CharacterLoreEntries.List.Params
		response: Sockets.CharacterLoreEntries.List.Response
	}
	"characterLoreEntries:create": {
		params: Sockets.CharacterLoreEntries.Create.Params
		response: Sockets.CharacterLoreEntries.Create.Response
	}
	"characterLoreEntries:update": {
		params: Sockets.CharacterLoreEntries.Update.Params
		response: Sockets.CharacterLoreEntries.Update.Response
	}
	"characterLoreEntries:delete": {
		params: Sockets.CharacterLoreEntries.Delete.Params
		response: Sockets.CharacterLoreEntries.Delete.Response
	}
	"characterLoreEntries:updatePositions": {
		params: Sockets.CharacterLoreEntries.UpdatePositions.Params
		response: Sockets.CharacterLoreEntries.UpdatePositions.Response
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
		params: Sockets.NarrativeGraph.TraceEntry
		response: Sockets.NarrativeGraph.TraceEntry
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
				summarizationStepComplete: boolean
				ragStepComplete: boolean
			} | null
		}
	}
	"setup:markComplete": {
		params: { step: "summarization" | "rag" }
		response: {
			setup: {
				summarizationStepComplete: boolean
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
				chatId?: number
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

	// Type-safe on method for listeners
	on<K extends keyof SocketEventMap>(
		event: K,
		listener: (data: SocketEventMap[K]["response"]) => void
	): void

	// Type-safe off method
	off<K extends keyof SocketEventMap>(
		event: K,
		listener?: (data: SocketEventMap[K]["response"]) => void
	): void

	// Type-safe once method - listener fires at most once, then auto-removes
	once<K extends keyof SocketEventMap>(
		event: K,
		listener: (data: SocketEventMap[K]["response"]) => void
	): void

	// Generic catch-all listener - Socket.IO does NOT support glob/wildcard
	// event names (eg. "**:error") without a plugin, so this is the only real
	// mechanism for observing every event (used eg. to toast on any unhandled
	// "*:error" event). Fires for every event this socket receives.
	onAny(listener: (event: string, ...args: any[]) => void): void
	offAny(listener?: (event: string, ...args: any[]) => void): void

	// Original socket methods for backward compatibility
	id: string
	connected: boolean
	join(room: string): void
	leave(room: string): void
	disconnect(): void
}

// Create a typed socket wrapper
export function createTypedSocket(): TypedSocket {
	const socket = skio.get() as any

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
			socket.emit(event as string, params)
		},

		on: (<K extends keyof SocketEventMap>(
			event: K,
			listener: (data: SocketEventMap[K]["response"]) => void
		) => {
			socket.on(event as string, listener)
		}) as any,

		off: (<K extends keyof SocketEventMap>(
			event: K,
			listener?: (data: SocketEventMap[K]["response"]) => void
		) => {
			if (socket.off) {
				socket.off(event as string, listener)
			}
		}) as any,

		once: (<K extends keyof SocketEventMap>(
			event: K,
			listener: (data: SocketEventMap[K]["response"]) => void
		) => {
			socket.once(event as string, listener)
		}) as any,

		onAny: (listener: (event: string, ...args: any[]) => void) => {
			if (socket.onAny) socket.onAny(listener)
		},

		offAny: (listener?: (event: string, ...args: any[]) => void) => {
			if (socket.offAny) socket.offAny(listener)
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
