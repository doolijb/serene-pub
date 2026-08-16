// Connection timeout management service
// Handles socket connection timeouts and reconnection state

interface ConnectionState {
	isConnected: boolean
	lastActivity: number
	timeoutId: NodeJS.Timeout | null
	isTimedOut: boolean
	canReconnect: boolean
	reconnectAvailableAt: number
}

interface ConnectionStateWithCalculated extends ConnectionState {
	timeUntilTimeout: number
	timeUntilReconnect: number
}

class ConnectionTimeoutService {
	private state: ConnectionState = {
		isConnected: false,
		lastActivity: Date.now(),
		timeoutId: null,
		isTimedOut: false,
		canReconnect: false,
		reconnectAvailableAt: 0
	}

	private readonly TIMEOUT_MS = 60 * 60 * 1000 // 1 hour
	private readonly RECONNECT_DELAY_MS = 30 * 1000 // 30 seconds
	private callbacks: {
		onTimeout: (() => void) | null
		onReconnectAvailable: (() => void) | null
	} = {
		onTimeout: null,
		onReconnectAvailable: null
	}

	/**
	 * Initialize connection timeout tracking
	 */
	startTimeout(
		onTimeout?: () => void,
		onReconnectAvailable?: () => void
	): void {
		this.callbacks.onTimeout = onTimeout || null
		this.callbacks.onReconnectAvailable = onReconnectAvailable || null

		this.state.isConnected = true
		this.state.isTimedOut = false
		this.state.canReconnect = false
		this.updateActivity()
	}

	/**
	 * Update activity timestamp and reset timeout
	 */
	updateActivity(): void {
		this.state.lastActivity = Date.now()

		// Clear existing timeout
		if (this.state.timeoutId) {
			clearTimeout(this.state.timeoutId)
		}

		// Set new timeout
		this.state.timeoutId = setTimeout(() => {
			this.handleTimeout()
		}, this.TIMEOUT_MS)
	}

	/**
	 * Handle connection timeout
	 */
	private handleTimeout(): void {
		console.log("Connection timed out after 1 hour of inactivity")

		this.state.isTimedOut = true
		this.state.isConnected = false
		this.state.canReconnect = false
		this.state.reconnectAvailableAt = Date.now() + this.RECONNECT_DELAY_MS

		// Notify callback
		if (this.callbacks.onTimeout) {
			this.callbacks.onTimeout()
		}

		// Schedule reconnect availability
		setTimeout(() => {
			this.state.canReconnect = true
			if (this.callbacks.onReconnectAvailable) {
				this.callbacks.onReconnectAvailable()
			}
		}, this.RECONNECT_DELAY_MS)
	}

	/**
	 * Stop timeout tracking
	 */
	stopTimeout(): void {
		if (this.state.timeoutId) {
			clearTimeout(this.state.timeoutId)
			this.state.timeoutId = null
		}
		this.state.isConnected = false
	}

	/**
	 * Reset timeout state for reconnection
	 */
	reset(): void {
		this.stopTimeout()
		this.state.isTimedOut = false
		this.state.canReconnect = false
		this.state.reconnectAvailableAt = 0
	}

	/**
	 * Get current connection state
	 */
	getState(): ConnectionStateWithCalculated {
		return {
			...this.state,
			// Calculate time remaining until timeout
			timeUntilTimeout:
				this.state.isConnected && this.state.timeoutId
					? Math.max(
							0,
							this.TIMEOUT_MS -
								(Date.now() - this.state.lastActivity)
						)
					: 0,
			// Calculate time remaining until reconnect available
			timeUntilReconnect:
				this.state.isTimedOut && !this.state.canReconnect
					? Math.max(0, this.state.reconnectAvailableAt - Date.now())
					: 0
		}
	}

	/**
	 * Check if connection is timed out
	 */
	isTimedOut(): boolean {
		return this.state.isTimedOut
	}

	/**
	 * Check if reconnection is available
	 */
	canReconnectNow(): boolean {
		return this.state.isTimedOut && this.state.canReconnect
	}

	/**
	 * Get time remaining until reconnect is available (in seconds)
	 */
	getReconnectCountdown(): number {
		if (!this.state.isTimedOut || this.state.canReconnect) {
			return 0
		}
		return Math.ceil((this.state.reconnectAvailableAt - Date.now()) / 1000)
	}

	/**
	 * Get formatted time remaining until timeout
	 */
	getTimeoutCountdown(): string {
		if (!this.state.isConnected || !this.state.timeoutId) {
			return "Not connected"
		}

		const timeRemaining =
			this.TIMEOUT_MS - (Date.now() - this.state.lastActivity)
		if (timeRemaining <= 0) {
			return "Timed out"
		}

		const minutes = Math.floor(timeRemaining / (1000 * 60))
		const hours = Math.floor(minutes / 60)
		const remainingMinutes = minutes % 60

		if (hours > 0) {
			return `${hours}h ${remainingMinutes}m`
		} else {
			return `${remainingMinutes}m`
		}
	}
}

// Export for use in components
export { ConnectionTimeoutService }

// Create default instance for convenience
export const connectionTimeout = new ConnectionTimeoutService()
