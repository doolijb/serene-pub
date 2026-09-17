// Global keyboard navigation handler for accessibility
/// <reference types="../../../app.d.ts" />

export interface KeyboardNavigationOptions {
	panelsCtx: PanelsCtx
	onFocusMain?: () => void
	/** Alt+[ — the rail, the strip of view buttons down the left edge. */
	onFocusRail?: () => void
	/** Alt+] — the sidebar, whichever view is showing in it. */
	onFocusSidebar?: () => void
}

export class KeyboardNavigationManager {
	private panelsCtx: PanelsCtx
	private onFocusMain?: () => void
	private onFocusRail?: () => void
	private onFocusSidebar?: () => void

	constructor(options: KeyboardNavigationOptions) {
		this.panelsCtx = options.panelsCtx
		this.onFocusMain = options.onFocusMain
		this.onFocusRail = options.onFocusRail
		this.onFocusSidebar = options.onFocusSidebar
	}

	handleGlobalKeyDown = (event: KeyboardEvent) => {
		// Somebody closer to the action already claimed this key. The session's
		// widget grid binds Alt+[ / Alt+] to "expand every group / send them
		// all to the rail" and calls preventDefault; the shell must not ALSO
		// yank focus to the rail on the one page where that binding is taken.
		// This works because the listener is on `window` rather than
		// `document`: keydown bubbles document -> window, so every page-level
		// handler has already had its say by the time we run.
		if (event.defaultPrevented) return

		// Only handle Alt key combinations for global navigation
		if (!event.altKey) return

		switch (event.key) {
			case "[":
				event.preventDefault()
				this.focusRail()
				break
			case "]":
				event.preventDefault()
				this.focusSidebar()
				break
			case "/":
				event.preventDefault()
				this.focusMainContent()
				break
			case ",":
				event.preventDefault()
				this.focusSiteNavigation()
				break
		}

		// Session-specific navigation (when in session)
		if (window.location.pathname.includes("/sessions/")) {
			switch (event.key) {
				case "j":
					event.preventDefault()
					this.navigateToNextMessage()
					break
				case "k":
					event.preventDefault()
					this.navigateToPreviousMessage()
					break
				case "Home":
					event.preventDefault()
					this.navigateToFirstMessage()
					break
				case "End":
					event.preventDefault()
					this.navigateToLastMessage()
					break
				case "g":
					if (event.shiftKey) {
						// Shift + G = Go to latest (last) message
						event.preventDefault()
						this.navigateToLatestMessage()
					}
					break
				case "r":
					if (event.ctrlKey || event.metaKey) {
						// Ctrl/Cmd + R = Refresh last response
						event.preventDefault()
						this.refreshLastResponse()
					}
					break
				case "ArrowLeft":
					if (event.ctrlKey || event.metaKey) {
						// Ctrl/Cmd + Left = Swipe left
						event.preventDefault()
						this.swipeCurrentMessageLeft()
					}
					break
				case "ArrowRight":
					if (event.ctrlKey || event.metaKey) {
						// Ctrl/Cmd + Right = Swipe right
						event.preventDefault()
						this.swipeCurrentMessageRight()
					}
					break
			}
		}
	}

	/**
	 * The rail is always there, so — unlike the sidebar below — there is no
	 * "nothing to focus" case to announce. The shell decides which item takes
	 * focus (the roving one), because the rail owns that cursor.
	 */
	private focusRail() {
		this.onFocusRail?.()
	}

	private focusSidebar() {
		// A collapsed sidebar has no first interactive element to land on, and
		// silently doing nothing reads as a broken shortcut.
		if (!this.panelsCtx.activeView) {
			KeyboardNavigationManager.announceToScreenReader(
				"No sidebar view is open"
			)
			return
		}

		this.onFocusSidebar?.()
	}

	private focusMainContent() {
		this.onFocusMain?.()

		// Close any open mobile menus to focus main content
		this.panelsCtx.isMobileMenuOpen = false
		this.panelsCtx.mobilePanel = null
	}

	private focusSiteNavigation() {
		// Focus the main site navigation/header area
		const siteNav =
			(document.querySelector('nav[role="navigation"]') as HTMLElement) ||
			(document.querySelector("header nav") as HTMLElement) ||
			(document.querySelector(
				'[aria-label*="navigation"]'
			) as HTMLElement) ||
			(document.querySelector(
				'[aria-label*="Navigation"]'
			) as HTMLElement) ||
			(document.querySelector(".site-nav") as HTMLElement) ||
			(document.querySelector("header") as HTMLElement)

		if (siteNav) {
			// Try to focus the first interactive element in the navigation
			const firstInteractive = siteNav.querySelector(
				'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
			) as HTMLElement

			if (firstInteractive) {
				firstInteractive.focus()
				KeyboardNavigationManager.announceToScreenReader(
					"Site navigation focused"
				)
			} else {
				// If no interactive elements, focus the nav itself
				siteNav.focus()
				KeyboardNavigationManager.announceToScreenReader(
					"Site navigation area focused"
				)
			}
		} else {
			// Fallback: focus the document body or first main element
			const main =
				(document.querySelector("main") as HTMLElement) ||
				(document.querySelector('[role="main"]') as HTMLElement) ||
				document.body

			if (main) {
				KeyboardNavigationManager.focusFirstInteractive(main)
				KeyboardNavigationManager.announceToScreenReader(
					"Main navigation area focused"
				)
			}
		}
	}

	// Add listener for global keyboard events.
	//
	// `window`, not `document`, and deliberately: keydown bubbles the focused
	// element -> document -> window, so this is the LAST handler to see the
	// event. That is what lets the `defaultPrevented` check above defer to a
	// page that has already bound the same chord (see handleGlobalKeyDown).
	addGlobalListener() {
		window.addEventListener("keydown", this.handleGlobalKeyDown)
	}

	// Remove listener when component is destroyed
	removeGlobalListener() {
		window.removeEventListener("keydown", this.handleGlobalKeyDown)
	}

	// Session message navigation methods
	private navigateToNextMessage() {
		const messages = document.querySelectorAll('[id^="message-"]')
		const focused = document.activeElement

		if (!messages.length) return

		if (!focused || !focused.id?.startsWith("message-")) {
			// Focus first message if none focused
			;(messages[0] as HTMLElement)?.focus()
			return
		}

		const currentIndex = Array.from(messages).indexOf(focused as Element)
		if (currentIndex !== -1 && currentIndex < messages.length - 1) {
			;(messages[currentIndex + 1] as HTMLElement)?.focus()
		}
	}

	private navigateToPreviousMessage() {
		const messages = document.querySelectorAll('[id^="message-"]')
		const focused = document.activeElement

		if (!messages.length) return

		if (!focused || !focused.id?.startsWith("message-")) {
			// Focus last message if none focused
			;(messages[messages.length - 1] as HTMLElement)?.focus()
			return
		}

		const currentIndex = Array.from(messages).indexOf(focused as Element)
		if (currentIndex > 0) {
			;(messages[currentIndex - 1] as HTMLElement)?.focus()
		}
	}

	private navigateToFirstMessage() {
		const messages = document.querySelectorAll('[id^="message-"]')
		if (messages.length > 0) {
			;(messages[0] as HTMLElement)?.focus()
			KeyboardNavigationManager.announceToScreenReader(
				"Navigated to first message"
			)
		}
	}

	private navigateToLastMessage() {
		const messages = document.querySelectorAll('[id^="message-"]')
		if (messages.length > 0) {
			;(messages[messages.length - 1] as HTMLElement)?.focus()
			KeyboardNavigationManager.announceToScreenReader(
				"Navigated to last message"
			)
		}
	}

	private navigateToLatestMessage() {
		// Alias for navigateToLastMessage but with different announcement
		const messages = document.querySelectorAll('[id^="message-"]')
		if (messages.length > 0) {
			const lastMessage = messages[messages.length - 1] as HTMLElement
			lastMessage?.focus()
			// Scroll to ensure the message is visible
			lastMessage?.scrollIntoView({
				behavior: "smooth",
				block: "nearest"
			})
			KeyboardNavigationManager.announceToScreenReader(
				"Navigated to latest message"
			)
		}
	}

	private refreshLastResponse() {
		// Find the last message that has a regenerate button
		const messages = document.querySelectorAll('[id^="message-"]')
		for (let i = messages.length - 1; i >= 0; i--) {
			const message = messages[i] as HTMLElement
			const regenerateBtn = message.querySelector(
				'button[title*="Regenerate"]'
			) as HTMLButtonElement
			if (regenerateBtn && !regenerateBtn.disabled) {
				regenerateBtn.click()
				KeyboardNavigationManager.announceToScreenReader(
					"Regenerating last response"
				)
				return
			}
		}
		KeyboardNavigationManager.announceToScreenReader(
			"No response available to regenerate"
		)
	}

	private swipeCurrentMessageLeft() {
		const focused = document.activeElement
		if (!focused || !focused.id?.startsWith("message-")) {
			KeyboardNavigationManager.announceToScreenReader(
				"No message focused for swiping"
			)
			return
		}

		// Look for swipe left button in the focused message
		const swipeLeftBtn = focused.querySelector(
			'button[title*="Swipe Left"], button[title*="ChevronLeft"]'
		) as HTMLButtonElement
		if (swipeLeftBtn && !swipeLeftBtn.disabled) {
			swipeLeftBtn.click()
			KeyboardNavigationManager.announceToScreenReader(
				"Swiped message left"
			)
		} else {
			KeyboardNavigationManager.announceToScreenReader(
				"Cannot swipe left - no previous variations available"
			)
		}
	}

	private swipeCurrentMessageRight() {
		const focused = document.activeElement
		if (!focused || !focused.id?.startsWith("message-")) {
			KeyboardNavigationManager.announceToScreenReader(
				"No message focused for swiping"
			)
			return
		}

		// Look for swipe right button in the focused message
		const swipeRightBtn = focused.querySelector(
			'button[title*="Swipe Right"], button[title*="ChevronRight"]'
		) as HTMLButtonElement
		if (swipeRightBtn && !swipeRightBtn.disabled) {
			swipeRightBtn.click()
			KeyboardNavigationManager.announceToScreenReader(
				"Swiped message right"
			)
		} else {
			KeyboardNavigationManager.announceToScreenReader(
				"Cannot swipe right - generating new variation or none available"
			)
		}
	}

	// Focus management utilities
	static focusElement(selector: string, context?: HTMLElement): boolean {
		const element = (context || document).querySelector(
			selector
		) as HTMLElement
		if (element) {
			element.focus()
			return true
		}
		return false
	}

	static focusFirstInteractive(container: HTMLElement): boolean {
		const focusableElements = container.querySelectorAll<HTMLElement>(
			'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
		)
		// Skip anything that is not actually rendered. The shell keeps every
		// open sidebar view mounted and hides the ones you are not looking at
		// (and hides one of its two headers by breakpoint), so the first
		// element in document order is routinely a `display: none` one —
		// calling .focus() on which silently does nothing and leaves focus
		// wherever it was, i.e. the shortcut appears dead.
		for (const element of focusableElements) {
			if (element.getClientRects().length === 0) continue
			element.focus()
			return true
		}
		return false
	}

	static announceToScreenReader(message: string) {
		// Create a temporary element for screen reader announcements
		const announcement = document.createElement("div")
		announcement.setAttribute("aria-live", "polite")
		announcement.setAttribute("aria-atomic", "true")
		announcement.style.position = "absolute"
		announcement.style.left = "-10000px"
		announcement.style.width = "1px"
		announcement.style.height = "1px"
		announcement.style.overflow = "hidden"

		document.body.appendChild(announcement)
		announcement.textContent = message

		// Clean up after announcement
		setTimeout(() => {
			document.body.removeChild(announcement)
		}, 1000)
	}
}

// Context navigation helpers for specific use cases
export const NavigationHelpers = {
	// Navigate between session messages
	navigateMessage: (
		direction: "next" | "previous",
		currentIndex?: number
	) => {
		const messages = document.querySelectorAll("[data-message-index]")
		if (!messages.length) return

		let targetIndex = 0
		if (currentIndex !== undefined) {
			targetIndex =
				direction === "next"
					? Math.min(currentIndex + 1, messages.length - 1)
					: Math.max(currentIndex - 1, 0)
		}

		const targetMessage = messages[targetIndex] as HTMLElement
		if (targetMessage) {
			targetMessage.focus()
			KeyboardNavigationManager.announceToScreenReader(
				`Session message ${targetIndex + 1} of ${messages.length}`
			)
		}
	},

	// Navigate list items with proper announcements
	navigateListItem: (
		direction: "next" | "previous",
		listSelector: string,
		currentIndex?: number,
		itemType?: string
	) => {
		const items = document.querySelectorAll(
			`${listSelector} [role="listitem"]`
		)
		if (!items.length) return

		let targetIndex = 0
		if (currentIndex !== undefined) {
			targetIndex =
				direction === "next"
					? Math.min(currentIndex + 1, items.length - 1)
					: Math.max(currentIndex - 1, 0)
		}

		const targetItem = items[targetIndex] as HTMLElement
		if (targetItem) {
			targetItem.focus()
			const itemName =
				targetItem.getAttribute("aria-label") ||
				targetItem.textContent?.trim() ||
				"Unknown item"

			KeyboardNavigationManager.announceToScreenReader(
				`${itemType || "Item"} ${targetIndex + 1} of ${items.length}: ${itemName}`
			)
		}
	}
}
