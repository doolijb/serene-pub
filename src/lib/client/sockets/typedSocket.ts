import * as skio from "sveltekit-io"

// Type mapping for socket events - this maps event names to their param/response types
type SocketEventMap = {
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

	// Character events
	"characters:list": {
		params: Sockets.Characters.List.Params
		response: Sockets.Characters.List.Response
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

	// Connection events
	"connections:list": {
		params: Sockets.Connections.List.Params
		response: Sockets.Connections.List.Response
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

	// Persona events
	"personas:list": {
		params: Sockets.Personas.List.Params
		response: Sockets.Personas.List.Response
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

	// Chat events
	"chats:list": {
		params: Sockets.Chats.List.Params
		response: Sockets.Chats.List.Response
	}
	"chats:get": {
		params: Sockets.Chats.Get.Params
		response: Sockets.Chats.Get.Response
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
	"systemSettings:updateOllamaManagerBaseUrl": {
		params: Sockets.SystemSettings.UpdateOllamaManagerBaseUrl.Params
		response: Sockets.SystemSettings.UpdateOllamaManagerBaseUrl.Response
	}
	"systemSettings:updateAccountsEnabled": {
		params: Sockets.SystemSettings.UpdateAccountsEnabled.Params
		response: Sockets.SystemSettings.UpdateAccountsEnabled.Response
	}

	// User Settings events
	"userSettings:get": {
		params: Sockets.UserSettings.Get.Params
		response: Sockets.UserSettings.Get.Response
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

	// Tag events
	"tags:list": {
		params: Sockets.Tags.List.Params
		response: Sockets.Tags.List.Response
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
