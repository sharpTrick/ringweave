import { useEffect, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "input:not([disabled])", "select:not([disabled])",
  "textarea:not([disabled])", "summary", '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * A closed `<details>` keeps its contents in the DOM and out of the tab order, so counting them
 * puts the trap's "last element" somewhere Tab never reaches — and the wrap then never fires.
 */
function reachable(el: HTMLElement): boolean {
  if (el.closest("details:not([open])") !== null && el.closest("summary") === null) return false;
  for (let a: HTMLElement | null = el; a; a = a.parentElement) {
    const style = getComputedStyle(a);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

/**
 * Cycle Tab inside a modal dialog. `inert` on the rest of the page stops Tab walking INTO the
 * content behind, which is a different guarantee: with everything else inert or unmounted the
 * native tab order runs out at the dialog's last control and the next Tab lands in the browser's
 * own chrome, with no script-driven way back.
 */
export function useFocusTrap(container: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.defaultPrevented) return;
      const root = container.current;
      if (!root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(reachable);
      if (items.length === 0) return;
      const edge = e.shiftKey ? items[0] : items[items.length - 1];
      const wrapTo = e.shiftKey ? items[items.length - 1] : items[0];
      const active = document.activeElement;
      // Focus outside the dialog entirely is wrapped too: it is where a previous Tab already
      // escaped to, and declining leaves the user with no way back in.
      if (active === edge || !(active instanceof Node) || !root.contains(active)) {
        e.preventDefault();
        wrapTo.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [container]);
}
