import { useEffect, useRef } from "react";

/**
 * Put focus back somewhere usable whenever a render destroys the focused element.
 *
 * Removing the focused node moves focus to `<body>` per spec, so the next Tab restarts at
 * the top of the document — a keyboard user who dismisses anything is thrown back to the
 * header. This is the THIRD attempt at that problem and the first one that is not a list
 * of call sites.
 *
 * The first two rescued focus at the panels' close buttons, then at the two overlays. Both
 * were correct and both were incomplete, and review found the next batch of call sites each
 * time: the toast's dismiss button, choosing a search result, and the effect that reopens
 * the modal after a failed generation. Every one of them was a place someone had to REMEMBER
 * to call a helper, which is the same shape as the ~79%-compliance instructions this
 * project's own protocol says to replace with mechanisms.
 *
 * So the rescue moves to where the removals actually happen: the DOM. It asks one question —
 * is focus on `<body>` when it was not before? If so, something the user was standing on has
 * just been removed, whatever removed it.
 *
 * IT WATCHES THE DOM, NOT REACT'S COMMITS, and that distinction is the fourth attempt. The
 * third asked the question from a no-dependency `useEffect`, which runs after every commit of
 * the component that declares it — and a React state update starts rendering at the fiber that
 * OWNS the state, not at the root. So a descendant that removes its own focused element from
 * its own local state never re-renders `App`, and the rescue never ran at all. Review found it
 * where it was always going to be: `RosterModal`'s own `rules` state, whose "Remove rule 1"
 * button deletes the very button the user is standing on, with a perfectly good, non-inert
 * anchor sitting unfocused beside it. A `MutationObserver` over `document.body` sees the
 * removal regardless of which component's state caused it — the same move as before (stop
 * asking a caller to remember) applied to the layer that was still guessing: this hook knew
 * which commits to inspect only because it assumed they all passed through `App`.
 *
 * TWO CONDITIONS, both load-bearing:
 *  - `hadFocus` — focus must have been somewhere real beforehand. On a cold load nothing is
 *    focused and `<body>` is the honest answer; grabbing focus then would steal it from a
 *    user who has not interacted yet.
 *  - `document.activeElement === document.body` — a click on the page background also blurs
 *    to `<body>`, but that is the user's choice and no commit follows it, so this effect
 *    does not run. Checking the state rather than listening for blur is what keeps
 *    deliberate blurs and destructive ones apart without guessing.
 */
export function useFocusRescue(anchor: () => HTMLElement | null | undefined): void {
  const hadFocus = useRef(false);
  // The anchor closes over the caller's state, so it is refreshed every render rather than
  // captured once by the mount effect below. This effect's scope limit is harmless where the
  // rescue's was not: it only refreshes a closure over `App`'s state, and `App`'s state cannot
  // change without `App` re-rendering.
  const latestAnchor = useRef(anchor);
  useEffect(() => {
    latestAnchor.current = anchor;
  });

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      hadFocus.current = e.target !== document.body;
    };
    const rescue = () => {
      if (!hadFocus.current) return;
      if (document.activeElement !== document.body) return;
      const target = latestAnchor.current();
      if (!target) return;
      target.focus();
      // The flag stays TRUE once focus has been somewhere real, and is never cleared here. It was
      // being set to `activeElement === document.body`, i.e. cleared whenever the rescue SUCCEEDED
      // — so if the very element the rescue had just focused was removed by the next commit, the
      // rescue had disarmed itself and focus was stranded after all. The flag's only job is "has
      // focus ever been somewhere real", which a successful rescue makes MORE true, not less.
    };
    // `childList` + `subtree` only: a removal is a childList mutation, and the canvas animates by
    // rewriting ATTRIBUTES every frame, which this therefore never wakes for. The callback is two
    // identity checks on the common path, and it is delivered as a microtask after the whole batch
    // — so React's own remove-then-insert sequences are seen settled, not mid-flight.
    const observer = new MutationObserver(rescue);
    document.addEventListener("focusin", onFocusIn);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      observer.disconnect();
    };
  }, []);
}
