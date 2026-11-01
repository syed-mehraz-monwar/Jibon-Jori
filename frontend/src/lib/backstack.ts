/**
 * Stack of "intercept the Android back button" handlers.
 *
 * Overlays (drawers, modals, unsaved-changes prompts) push a handler while they
 * are open. The app shell's single Capacitor `backButton` listener asks this
 * stack first, so back closes the topmost overlay instead of leaving the screen —
 * and no component ever registers a second native listener.
 */

type BackHandler = () => boolean;

const handlers: BackHandler[] = [];

/** Registers a handler; returns the function that removes it again. */
export function pushBackHandler(handler: BackHandler): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}

/**
 * Runs the handlers from the top of the stack down.
 * Returns true when one of them consumed the event.
 */
export function runBackHandlers(): boolean {
  for (let index = handlers.length - 1; index >= 0; index -= 1) {
    try {
      if (handlers[index]()) return true;
    } catch {
      // A broken overlay must not wedge back navigation.
    }
  }
  return false;
}

/** Test helper: drops every registered handler. */
export function resetBackHandlers(): void {
  handlers.length = 0;
}
