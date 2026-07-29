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
  /** Set when the UA took focus away because an ancestor turned inert, rather than the user. */
  const forcedOut = useRef(false);
  const latestAnchor = useRef(anchor);
  useEffect(() => {
    latestAnchor.current = anchor;
  });

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      lastFocused.current = el instanceof HTMLElement && el !== document.body ? el : null;
      forcedOut.current = false;
    };
    // The blur is the ONLY moment this is knowable. Traced in Chromium during a reroll: the
    // mutation that applies `inert` is delivered while focus is still on the button, the UA blurs
    // it afterwards, and by the next mutation `inert` has already been lifted — so no observer
    // callback ever sees both. What is unambiguous at blur time is that the element being blurred
    // had an inert ancestor, which a user clicking the background never does.
    const onFocusOut = (e: FocusEvent) => {
      const el = e.target;
      if (el instanceof HTMLElement && el.closest("[inert]") !== null) forcedOut.current = true;
    };
    const rescue = () => {
      const previous = lastFocused.current;
      if (!previous) return;
      if (document.activeElement !== document.body) return;
      // Removed, or made unreachable while focused — `inert` strands focus just as thoroughly as
      // a removal, and a reroll inerts `#app` around the very button that was pressed.
      if (previous.isConnected && !forcedOut.current) return;
      const target = latestAnchor.current();
      // Left armed when nothing is reachable yet, so that a rescue attempted while `#app` is
      // still `inert` retries on the commit that lifts it rather than stranding focus for good.
      if (!target) return;
      // A rescue is not a navigation: focusing without this scrolls the anchor into view.
      target.focus({ preventScroll: true });
    };
    // `childList` plus `inert` ONLY. A bare `attributes: true` would wake this on every canvas
    // animation frame; naming the one attribute that can strand focus keeps that property while
    // still seeing the case a removal-only watch cannot.
    const observer = new MutationObserver(rescue);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut, true);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["inert"],
    });
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut, true);
      observer.disconnect();
    };
  }, []);
}
