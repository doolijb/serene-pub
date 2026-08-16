// Rate limiting service for socket authentication attempts
// Implements in-memory rate limiting with automatic cleanup

interface RateLimit {
	attempts: number
	firstAttempt: number
	lastAttempt: number
}

class LoginRateLimitService {
	private attempts = new Map<string, RateLimit>()
	private maxAttempts = 5
	private windowMs = 60 * 1000 // 1 minute
	private cleanupInterval: NodeJS.Timeout | null = null

	constructor() {
		// Start cleanup process - runs every 2 minutes to clean old entries
		this.startCleanup()
	}

	/**
	 * Check if IP is rate limited
	 */
	isRateLimited(ip: string): boolean {
		const rateLimit = this.attempts.get(ip)
		if (!rateLimit) return false

		const now = Date.now()

		// If window has passed, reset attempts
		if (now - rateLimit.firstAttempt >= this.windowMs) {
			this.attempts.delete(ip)
			return false
		}

		return rateLimit.attempts >= this.maxAttempts
	}

	/**
	 * Record a failed login attempt
	 */
	recordFailedAttempt(ip: string): void {
		const now = Date.now()
		const existing = this.attempts.get(ip)

		if (!existing) {
			// First attempt
			this.attempts.set(ip, {
				attempts: 1,
				firstAttempt: now,
				lastAttempt: now
			})
		} else {
			// Check if we're still within the window
			if (now - existing.firstAttempt < this.windowMs) {
				// Within window, increment attempts
				existing.attempts++
				existing.lastAttempt = now
			} else {
				// Window expired, reset
				this.attempts.set(ip, {
					attempts: 1,
					firstAttempt: now,
					lastAttempt: now
				})
			}
		}
	}

	/**
	 * Clear rate limit for IP (called on successful login)
	 */
	clearRateLimit(ip: string): void {
		this.attempts.delete(ip)
	}

	/**
	 * Get remaining attempts for IP
	 */
	getRemainingAttempts(ip: string): number {
		const rateLimit = this.attempts.get(ip)
		if (!rateLimit) return this.maxAttempts

		const now = Date.now()

		// If window has passed, return max attempts
		if (now - rateLimit.firstAttempt >= this.windowMs) {
			return this.maxAttempts
		}

		return Math.max(0, this.maxAttempts - rateLimit.attempts)
	}

	/**
	 * Get time until rate limit resets (in seconds)
	 */
	getTimeUntilReset(ip: string): number {
		const rateLimit = this.attempts.get(ip)
		if (!rateLimit) return 0

		const now = Date.now()
		const windowEnd = rateLimit.firstAttempt + this.windowMs

		return Math.max(0, Math.ceil((windowEnd - now) / 1000))
	}

	/**
	 * Start cleanup process to remove expired entries
	 */
	private startCleanup(): void {
		this.cleanupInterval = setInterval(
			() => {
				const now = Date.now()

				for (const [ip, rateLimit] of this.attempts.entries()) {
					// Remove entries older than window
					if (now - rateLimit.firstAttempt >= this.windowMs) {
						this.attempts.delete(ip)
					}
				}
			},
			2 * 60 * 1000
		) // Clean up every 2 minutes
	}

	/**
	 * Stop cleanup process (for graceful shutdown)
	 */
	destroy(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval)
			this.cleanupInterval = null
		}
		this.attempts.clear()
	}

	/**
	 * Get current stats (for monitoring)
	 */
	getStats(): { totalTrackedIPs: number; totalAttempts: number } {
		let totalAttempts = 0
		for (const rateLimit of this.attempts.values()) {
			totalAttempts += rateLimit.attempts
		}

		return {
			totalTrackedIPs: this.attempts.size,
			totalAttempts
		}
	}
}

// Export singleton instance
export const loginRateLimit = new LoginRateLimitService()
