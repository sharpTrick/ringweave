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
 * THREE CONDITIONS, all load-bearing:
 *  - there must have been a real previously-focused element. On a cold load nothing is focused
 *    and `<body>` is the honest answer; grabbing focus then would steal it from a user who has
 *    not interacted yet.
 *  - `document.activeElement === document.body` — focus is actually stranded right now.
 *  - **that element is no longer in the document** (`!node.isConnected`). This is the one that
 *    was missing, and it is the difference between asking the question and guessing at it.
 *
 * The guess it replaces, in the words of the comment that used to sit here: *"a click on the page
 * background also blurs to `<body>`, but that is the user's choice and no commit follows it, so
 * this effect does not run."* The premise is false exactly where it matters. A tap on a graph node
 * blurs to `<body>` — SVG nodes are not focusable — and a commit DOES follow it, because selecting
 * a person mounts the explorer panel. The rescue saw `<body>` plus a mutation, concluded the user's
 * footing had been removed, and dragged focus to the anchor. Reported from a phone, where the
 * anchor being a text input means every spurious firing opens the soft keyboard and scrolls the
 * viewport — so the most common interaction in the app fought the user.
 *
 * `Node.isConnected` is the exact question the hook was approximating: *was the thing the user was
 * standing on taken away?* It costs one property read and it needs no assumption about which
 * commits follow which gestures.
 */
export function useFocusRescue(anchor: () => HTMLElement | null | undefined): void {
  /**
   * The element focus was last on, held so the rescue can ask whether it survived.
   *
   * A strong reference to a possibly-removed node, deliberately: it is exactly one node, it is
   * replaced on the next `focusin`, and it is cleared as soon as it has answered the question
   * below — so the only thing it can pin is a single detached element between a removal and the
   * mutation callback that follows it microtasks later.
   */
  const lastFocused = useRef<HTMLElement | null>(null);
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
      const el = e.target;
      lastFocused.current = el instanceof HTMLElement && el !== document.body ? el : null;
    };
    const rescue = () => {
      const previous = lastFocused.current;
      if (!previous) return;
      if (document.activeElement !== document.body) return;
      // The whole question, asked instead of inferred. A deliberate blur leaves the element in
      // the document, so this returns and focus stays where the user put it — down.
      if (previous.isConnected) return;
      const target = latestAnchor.current();
      // NOT cleared here, and the first version of this fix did clear it — which stranded focus on
      // <body> for the whole session whenever the anchor happened to be unavailable at this exact
      // microtask. Finishing a generation is that case: the overlay's Cancel button is removed
      // while `#app` is still inert, so nothing is reachable yet, and disarming on that attempt
      // meant the commit that lifted `inert` a moment later had nothing left to rescue. Measured
      // in Chromium, not reasoned about — the phone checks in `scripts/e2e/drive.mjs` passed
      // against it, because focus stranded on <body> is not a text input either.
      //
      // Keeping the reference costs two property reads per later mutation and buys a retry.
      if (!target) return;
      // `preventScroll`, because the user did not ask to be taken anywhere. Focusing normally
      // scrolls the target into view, and on a phone that is a jump across the page on top of
      // whatever the rescue was for. Focus is a keyboard concern here; scrolling is not.
      //
      // NOT GUARDED BY A TEST, and said plainly rather than left to be assumed: jsdom does not
      // implement scrolling, and asserting "the viewport did not move" in the browser harness is
      // only meaningful if the anchor is far enough down the page to move it — which, now that the
      // anchor is `<main>`, it is not. The visible symptom this was added for is closed by the
      // anchor change; this keeps it closed for the two fallback anchors, on argument rather than
      // on evidence.
      target.focus({ preventScroll: true });
      // The browser fires `focusin` for that call, so `lastFocused` re-arms on the new element —
      // which is what keeps a chain of removals rescuable. An earlier version tracked only a
      // boolean and cleared it on success, disarming itself exactly when the rescued element was
      // removed by the next commit.
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
