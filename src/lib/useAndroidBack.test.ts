import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAndroidBack } from "./useAndroidBack";

describe("useAndroidBack", () => {
  it("claims a cancelable native back event while the overlay is open", () => {
    const onBack = vi.fn();
    renderHook(() => useAndroidBack(true, onBack));
    const event = new CustomEvent("lingua:back", { cancelable: true });
    window.dispatchEvent(event);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("does nothing when the overlay is closed", () => {
    const onBack = vi.fn();
    renderHook(() => useAndroidBack(false, onBack));
    const event = new CustomEvent("lingua:back", { cancelable: true });
    window.dispatchEvent(event);
    expect(onBack).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("stops listening after unmount", () => {
    const onBack = vi.fn();
    const { unmount } = renderHook(() => useAndroidBack(true, onBack));
    unmount();
    window.dispatchEvent(new CustomEvent("lingua:back", { cancelable: true }));
    expect(onBack).not.toHaveBeenCalled();
  });
});
