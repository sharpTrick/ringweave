// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNotice } from "../src/state/useNotice";

describe("useNotice", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("flash shows a message then auto-clears it", () => {
    const { result } = renderHook(() => useNotice());
    act(() => result.current.flash("hi"));
    expect(result.current.notice).toBe("hi");
    act(() => vi.advanceTimersByTime(4000));
    expect(result.current.notice).toBeNull();
  });

  it("a newer flash is not cleared by an older flash's timer", () => {
    const { result } = renderHook(() => useNotice());
    act(() => result.current.flash("first"));
    act(() => vi.advanceTimersByTime(2000));
    act(() => result.current.flash("second"));
    act(() => vi.advanceTimersByTime(2001)); // the first message's 4s would fire here
    expect(result.current.notice).toBe("second"); // ...but its timer was superseded
    act(() => vi.advanceTimersByTime(2000)); // the second message's full window
    expect(result.current.notice).toBeNull();
  });

  it("gives a long message longer to be read than a short one", () => {
    // One constant for every producer means the delay is right for the shortest of them. `flash`
    // carries import errors that interpolate a file's own message, and the toast is the only copy
    // — unmounting it at 4 s takes the message with it.
    const { result } = renderHook(() => useNotice());
    const long = "Couldn't import that file: ".padEnd(160, "x");
    act(() => result.current.flash(long));
    act(() => vi.advanceTimersByTime(4000));
    expect(result.current.notice, "gone at the short-message delay").toBe(long);
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.notice, "never clears at all").toBeNull();
    // Non-vacuity: the short case must still clear at the floor, or this passes on a hook that
    // simply waits longer for everything.
    act(() => result.current.flash("hi"));
    act(() => vi.advanceTimersByTime(4000));
    expect(result.current.notice).toBeNull();
  });

  it("show/clear are manual (no auto-clear)", () => {
    const { result } = renderHook(() => useNotice());
    act(() => result.current.show("err"));
    act(() => vi.advanceTimersByTime(10000));
    expect(result.current.notice).toBe("err"); // show does not auto-clear
    act(() => result.current.clear());
    expect(result.current.notice).toBeNull();
  });
});
