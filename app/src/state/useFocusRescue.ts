import { useEffect, useRef } from "react";

/**
 * Move focus to `anchor()` when the element that had it is removed from the document.
 *
 * Removing the focused node sends focus to `<body>`, so the next Tab restarts at the top of the
 * document. Watches the DOM rather than React commits, so that a removal caused by any
 * component's own state is caught — a state update renders from the fiber that owns it, not the
 * root.
 */
export function useFocusRescue(anchor: () => HTMLElement | null | undefined): void {
  const lastFocused = useRef<HTMLElement | null>(null);
  const latestAnchor = useRef(anchor);
  useEffect(() => {
    latestAnchor.current = anchor;
  });

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      lastFocused.current = el instanceof HTMLElement && el !== document.body ? el : null;
    };
    const rescue = () => {
      const previous = lastFocused.current;
      if (!previous) return;
      if (document.activeElement !== document.body) return;
      if (previous.isConnected) return;
      const target = latestAnchor.current();
      // Left armed when nothing is reachable yet, so that a rescue attempted while `#app` is
      // still `inert` retries on the commit that lifts it rather than stranding focus for good.
      if (!target) return;
      // A rescue is not a navigation: focusing without this scrolls the anchor into view.
      target.focus({ preventScroll: true });
    };
    // `childList` only, so that the canvas rewriting attributes every animation frame does not
    // wake this.
    const observer = new MutationObserver(rescue);
    document.addEventListener("focusin", onFocusIn);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      observer.disconnect();
    };
  }, []);
}
