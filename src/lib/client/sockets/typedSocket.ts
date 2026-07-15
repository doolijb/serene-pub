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
	"users:update": {
		params: Sockets.Users.Update.Params
		response: Sockets.Users.Update.Response
	}
	"users:delete": {
		params: Sockets.Users.Delete.Params
		response: Sockets.Users.Delete.Response
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
	"characters:update": {
		params: Sockets.Characters.Update.Params
		response: Sockets.Characters.Update.Response
	}
	"characters:delete": {
		params: Sockets.Characters.Delete.Params
		response: Sockets.Characters.Delete.Response
	}
	"characters:importCard": {
		params: Sockets.Characters.ImportCard.Params
		response: Sockets.Characters.ImportCard.Response
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
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
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
	"connections:update": {
		params: Sockets.Connections.Update.Params
		response: Sockets.Connections.Update.Response
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
	"personas:update": {
		params: Sockets.Personas.Update.Params
		response: Sockets.Personas.Update.Response
	}
	"personas:delete": {
		params: Sockets.Personas.Delete.Params
		response: Sockets.Personas.Delete.Response
	}
	"personas:searchLibrary": {
		params: Sockets.Personas.SearchLibrary.Params
		response: Sockets.Personas.SearchLibrary.Response
	}
	"personas:searchLibrary:error": {
		params: Sockets.ErrorResponse
		response: Sockets.ErrorResponse
	}
	"personas:importCard": {
		params: Sockets.Personas.ImportCard.Params
		response: Sockets.Personas.ImportCard.Response
	}
	"personas:importCard:error": {
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
	"chats:createAssistant": {
		params: Sockets.Chats.CreateAssistant.Params
		response: Sockets.Chats.CreateAssistant.Response
	}
	"chats:update": {
		params: Sockets.Chats.Update.Params
		response: Sockets.Chats.Update.Response
	}
	"chats:setLorebook": {
		params: Sockets.Chats.SetLorebook.Params
		response: Sockets.Chats.SetLorebook.Response
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
	"chats:titleGenerated": {
		params: Sockets.Chats.TitleGenerated.Call
		response: Sockets.Chats.TitleGenerated.Call
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
	"chatMessages:sendAssistantMessage": {
		params: Sockets.Chats.SendAssistantMessage.Params
		response: Sockets.Chats.SendAssistantMessage.Response
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
		params: Sockets.KoboldCpp.SetBaseUrl.Params
		response: Sockets.KoboldCpp.SetBaseUrl.Response
	}
	"koboldcpp:setModelsDir": {
		params: Sockets.KoboldCpp.SetModelsDir.Params
		response: Sockets.KoboldCpp.SetModelsDir.Response
	}
	"koboldcpp:searchModels": {
		params: Sockets.KoboldCpp.SearchModels.Params
		response: Sockets.KoboldCpp.SearchModels.Response
	}
	"koboldcpp:downloadModel": {
		params: Sockets.KoboldCpp.DownloadModel.Params
		response: Sockets.KoboldCpp.DownloadModel.Response
	}
	"koboldcpp:cancelDownload": {
		params: Sockets.KoboldCpp.CancelDownload.Params
		response: Sockets.KoboldCpp.CancelDownload.Response
	}
	"koboldcpp:getDownloadProgress": {
		params: Sockets.KoboldCpp.GetDownloadProgress.Params
		response: Sockets.KoboldCpp.GetDownloadProgress.Response
	}
	"koboldcpp:clearDownloadHistory": {
		params: Sockets.KoboldCpp.ClearDownloadHistory.Params
		response: Sockets.KoboldCpp.ClearDownloadHistory.Response
	}
	"koboldcpp:version": {
		params: Sockets.KoboldCpp.Version.Params
		response: Sockets.KoboldCpp.Version.Response
	}
	"koboldcpp:isUpdateAvailable": {
		params: Sockets.KoboldCpp.IsUpdateAvailable.Params
		response: Sockets.KoboldCpp.IsUpdateAvailable.Response
	}
	"koboldcpp:listModels": {
		params: Sockets.KoboldCpp.ListModels.Params
		response: Sockets.KoboldCpp.ListModels.Response
	}
	"koboldcpp:loadModel": {
		params: Sockets.KoboldCpp.LoadModel.Params
		response: Sockets.KoboldCpp.LoadModel.Response
	}
	"koboldcpp:connectModel": {
		params: Sockets.KoboldCpp.ConnectModel.Params
		response: Sockets.KoboldCpp.ConnectModel.Response
	}
	"koboldcpp:perf": {
		params: Sockets.KoboldCpp.Perf.Params
		response: Sockets.KoboldCpp.Perf.Response
	}
	"koboldcpp:getLoadedConfig": {
		params: Sockets.KoboldCpp.GetLoadedConfig.Params
		response: Sockets.KoboldCpp.GetLoadedConfig.Response
	}
	// Managed mode events
	"koboldcpp:setManagedMode": {
		params: Sockets.KoboldCpp.SetManagedMode.Params
		response: Sockets.KoboldCpp.SetManagedMode.Response
	}
	"koboldcpp:setManagedPort": {
		params: Sockets.KoboldCpp.SetManagedPort.Params
		response: Sockets.KoboldCpp.SetManagedPort.Response
	}
	"koboldcpp:setManagedBinaryDir": {
		params: Sockets.KoboldCpp.SetManagedBinaryDir.Params
		response: Sockets.KoboldCpp.SetManagedBinaryDir.Response
	}
	"koboldcpp:setModelTtl": {
		params: Sockets.KoboldCpp.SetModelTtl.Params
		response: Sockets.KoboldCpp.SetModelTtl.Response
	}
	"koboldcpp:listBinaryVariants": {
		params: Sockets.KoboldCpp.ListBinaryVariants.Params
		response: Sockets.KoboldCpp.ListBinaryVariants.Response
	}
	"koboldcpp:downloadBinary": {
		params: Sockets.KoboldCpp.DownloadBinary.Params
		response: Sockets.KoboldCpp.DownloadBinary.Response
	}
	"koboldcpp:getBinaryDownloadProgress": {
		params: Sockets.KoboldCpp.GetBinaryDownloadProgress.Params
		response: Sockets.KoboldCpp.GetBinaryDownloadProgress.Response
	}
	"koboldcpp:cancelBinaryDownload": {
		params: Sockets.KoboldCpp.CancelBinaryDownload.Params
		response: Sockets.KoboldCpp.CancelBinaryDownload.Response
	}
	"koboldcpp:startSubprocess": {
		params: Sockets.KoboldCpp.StartSubprocess.Params
		response: Sockets.KoboldCpp.StartSubprocess.Response
	}
	"koboldcpp:stopSubprocess": {
		params: Sockets.KoboldCpp.StopSubprocess.Params
		response: Sockets.KoboldCpp.StopSubprocess.Response
	}
	"koboldcpp:getSubprocessStatus": {
		params: Sockets.KoboldCpp.GetSubprocessStatus.Params
		response: Sockets.KoboldCpp.GetSubprocessStatus.Response
	}
	"koboldcpp:unloadModel": {
		params: Sockets.KoboldCpp.UnloadModel.Params
		response: Sockets.KoboldCpp.UnloadModel.Response
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
	"ollama:connectModel": {
		params: Sockets.Ollama.ConnectModel.Params
		response: Sockets.Ollama.ConnectModel.Response
	}
	"ollama:pullModel": {
		params: Sockets.Ollama.PullModel.Params
		response: Sockets.Ollama.PullModel.Response
	}
	"ollama:version": {
		params: Sockets.Ollama.Version.Params
		response: Sockets.Ollama.Version.Response
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
	"systemSettings:updateOllamaManagerBaseUrl": {
		params: Sockets.SystemSettings.UpdateOllamaManagerBaseUrl.Params
		response: Sockets.SystemSettings.UpdateOllamaManagerBaseUrl.Response
	}
	"systemSettings:updateAccountsEnabled": {
		params: Sockets.SystemSettings.UpdateAccountsEnabled.Params
		response: Sockets.SystemSettings.UpdateAccountsEnabled.Response
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
	"lorebooks:createBinding": {
		params: Sockets.Lorebooks.CreateBinding.Params
		response: Sockets.Lorebooks.CreateBinding.Response
	}
	"lorebooks:updateBinding": {
		params: Sockets.Lorebooks.UpdateBinding.Params
		response: Sockets.Lorebooks.UpdateBinding.Response
	}
	"lorebooks:bindingList": {
		params: Sockets.Lorebooks.BindingList.Params
		response: Sockets.Lorebooks.BindingList.Response
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

	// Assistant events
	"assistant:completeV2": {
		params: never
		response: { chatId: number; messageId: number; toolsUsed: string[] }
	}
	"assistant:errorV2": {
		params: never
		response: { chatId: number; error: string }
	}
	"assistant:progress": {
		params: never
		response: {
			chatId: number
			type: "tool_execution" | "draft_generation"
			tool?: string
			status?: string
			field?: string
			currentField?: number
			totalFields?: number
			attempt?: number
		}
	}
	"assistant:unlinkSuccess": {
		params: never
		response: { chatId: number; taggedEntities: Record<string, any> }
	}
	"assistant:editDraftSuccess": {
		params: never
		response: {
			chatId: number
			operation: "create" | "edit"
			entityType: "characters" | "personas"
			entityIndex: number
			field: string
			value: any
			draft: any
			chat?: any
		}
	}
	"assistant:editDraftError": {
		params: never
		response: { error: string; field?: string; value?: any }
	}
	"assistant:metadataUpdated": {
		params: never
		response: { chatId: number; metadata: string | object }
	}
	"assistant:saveDraft": {
		params: { chatId: number }
		response: any
	}
	"assistant:editDraft": {
		params: {
			chatId: number
			operation: string
			entityType: string
			entityIndex: number
			field: string
			value: any
		}
		response: any
	}
	"assistant:sendMessageV2": {
		params: { chatId: number; content: string }
		response: any
	}
	"assistant:selectFunctionResults": {
		params: { chatId: number; selectedIds: number[]; type: string }
		response: any
	}
	"assistant:unlinkEntity": {
		params: { chatId: number; entityId: number; type: string }
		response: any
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
	"narrativeGraph:updateNode": {
		params: { node: Partial<Sockets.NarrativeGraph.NarrativeNode> & { id: number } }
		response: { node: Sockets.NarrativeGraph.NarrativeNode }
	}
	"narrativeGraph:deleteNode": {
		params: { id: number }
		response: { success: string }
	}
	"narrativeGraph:updateRelationship": {
		params: { relationship: Partial<Sockets.NarrativeGraph.NarrativeRelationship> & { id: number } }
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
	"narrativeGraph:linkBindingNode": {
		params: Sockets.NarrativeGraph.LinkBindingNode.Params
		response: Sockets.NarrativeGraph.LinkBindingNode.Response
	}
	"narrativeGraph:linkOrphanBinding": {
		params: Sockets.NarrativeGraph.LinkOrphanBinding.Params
		response: Sockets.NarrativeGraph.LinkOrphanBinding.Response
	}
	"narrativeGraph:mergeNode": {
		params: Sockets.NarrativeGraph.MergeNode.Params
		response: Sockets.NarrativeGraph.MergeNode.Response
	}
	"narrativeGraph:demergeNode": {
		params: Sockets.NarrativeGraph.DemergeNode.Params
		response: Sockets.NarrativeGraph.DemergeNode.Response
	}
	"bindingCheck:result": {
		params: never
		response: Sockets.BindingCheck.Result.Response
	}
	"bindingCheck:nodeResult": {
		params: never
		response: Sockets.BindingCheck.NodeResult.Response
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
			setup: { summarizationStepComplete: boolean; ragStepComplete: boolean } | null
		}
	}
	"setup:markComplete": {
		params: { step: "summarization" | "rag" }
		response: {
			setup: { summarizationStepComplete: boolean; ragStepComplete: boolean }
		}
	}

	// Task queue events (admin-only)
	"taskQueue:get": {
		params: Record<string, never>
		response: never
	}
	"taskQueue:update": {
		params: never
		response: { tasks: Array<{ id: string; taskType: string; connectionName: string; samplingName: string; startedAt: string; chatId?: number; lorebookId?: number; label?: string }> }
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

	// Wildcard error event listener
	on(
		event: "**:error",
		listener: (data: { error?: string; description?: string }) => void
	): void

	// Type-safe off method
	off<K extends keyof SocketEventMap>(
		event: K,
		listener?: (data: SocketEventMap[K]["response"]) => void
	): void

	// Wildcard error event off
	off(
		event: "**:error",
		listener?: (data: { error?: string; description?: string }) => void
	): void

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
			event: K | "**:error",
			listener:
				| ((data: SocketEventMap[K]["response"]) => void)
				| ((data: { error?: string; description?: string }) => void)
		) => {
			socket.on(event as string, listener)
		}) as any,

		off: (<K extends keyof SocketEventMap>(
			event: K | "**:error",
			listener?:
				| ((data: SocketEventMap[K]["response"]) => void)
				| ((data: { error?: string; description?: string }) => void)
		) => {
			if (socket.off) {
				socket.off(event as string, listener)
			}
		}) as any,

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
