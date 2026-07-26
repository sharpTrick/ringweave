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
 * So the rescue moves to where the removals actually happen. A `useEffect` with no
 * dependency array runs after every commit — which is precisely when React has finished
 * detaching nodes — and asks one question: is focus on `<body>` when it was not before? If
 * so, something the user was standing on has just been removed, whatever removed it.
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

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      hadFocus.current = e.target !== document.body;
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  // Deliberately no dependency array: this has to run after EVERY commit, because any
  // commit can be the one that unmounts the focused element.
  useEffect(() => {
    if (!hadFocus.current) return;
    if (document.activeElement !== document.body) return;
    const target = anchor();
    if (!target) return;
    target.focus();
    // Only if the focus actually took. An anchor inside an `inert` subtree silently
    // refuses focus, and leaving the flag set means the next commit tries again — which is
    // what should happen, since focus is still stranded.
    hadFocus.current = document.activeElement === document.body;
  });
}
