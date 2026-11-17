import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MAX_DRAFT_LENGTH } from "@/lib/composer";
import { ComposerField } from "./ComposerField";

function setup(state: { dictating?: boolean; dictationStarting?: boolean } = {}, initial = "") {
  const change = vi.fn();
  const submit = vi.fn();
  const paste = vi.fn();
  const composition = vi.fn();
  const inputRef = createRef<HTMLTextAreaElement>();
  function Field() {
    const [value, setValue] = useState(initial);
    return (
      <ComposerField
        inputRef={inputRef}
        value={value}
        onValueChange={(next) => {
          change(next);
          setValue(next);
        }}
        onSubmit={submit}
        onPaste={paste}
        onComposingChange={composition}
        rtl={false}
        {...state}
      />
    );
  }
  const view = render(<Field />);
  const field = screen.getByRole("textbox") as HTMLTextAreaElement;
  return { ...view, field, change, submit, paste, composition };
}

describe("ComposerField editing contract", () => {
  it("mirrors exact text once, leaving selection and multiline editing to the browser", async () => {
    const { field, change } = setup();
    const value = "  Guten  Morgen\n\nمرحباً 🙂  ";
    fireEvent.input(field, { target: { value } });
    await act(async () => {
      await Promise.resolve();
    });
    expect(field.value).toBe(value);
    expect(change).toHaveBeenCalledExactlyOnceWith(value);
    expect(field.maxLength).toBe(MAX_DRAFT_LENGTH);
    expect(field.getAttribute("aria-describedby")).toBe("composer-help composer-limit");
  });

  it("submits Enter, but preserves Shift/Alt+Enter and ignores key repeat", () => {
    const { field, submit } = setup();
    fireEvent.change(field, { target: { value: "Hallo\nWelt" } });
    expect(fireEvent.keyDown(field, { key: "Enter", shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(field, { key: "Enter", altKey: true })).toBe(true);
    expect(submit).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(field, { key: "Enter" })).toBe(false);
    fireEvent.keyDown(field, { key: "Enter", repeat: true });
    expect(submit).toHaveBeenCalledExactlyOnceWith("Hallo\nWelt");
  });

  it("never submits Enter while an IME candidate is being confirmed, including Safari 229", () => {
    const { field, submit, composition } = setup();
    fireEvent.compositionStart(field);
    fireEvent.change(field, { target: { value: "にほん" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(field, { target: { value: "日本語" } });
    expect(composition.mock.calls.map(([active]) => active)).toEqual([true, false]);
    expect(field.value).toBe("日本語");
    fireEvent.keyDown(field, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(field, { key: "Enter", isComposing: true });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(submit).toHaveBeenCalledExactlyOnceWith("日本語");
  });

  it("does not truncate a composition buffer, but bounds the committed value safely", () => {
    const { field } = setup();
    fireEvent.compositionStart(field);
    const raw = "a".repeat(MAX_DRAFT_LENGTH - 1) + "🙂candidate";
    fireEvent.change(field, { target: { value: raw } });
    expect(field.value).toBe(raw);
    fireEvent.compositionEnd(field);
    expect(field.value).toBe("a".repeat(MAX_DRAFT_LENGTH - 1));
  });

  it("recovers a WebView input that React's value tracker did not deliver", async () => {
    const { field, change } = setup();
    // Using the controlled element's setter updates React's tracker. Its synthetic
    // onChange sees no difference; the single native fallback must recover the draft.
    field.value = "مرحباً من لوحة المفاتيح";
    fireEvent.input(field);
    await act(async () => {
      await Promise.resolve();
    });
    expect(change).toHaveBeenCalledExactlyOnceWith("مرحباً من لوحة المفاتيح");
  });

  it("reconciles a final value on blur and ignores a queued native event after unmount", async () => {
    const { field, change, unmount } = setup();
    field.value = "آخر تعديل";
    fireEvent.blur(field);
    expect(change).toHaveBeenCalledExactlyOnceWith("آخر تعديل");
    change.mockClear();
    field.value = "disposed";
    fireEvent.input(field);
    unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(change).not.toHaveBeenCalled();
  });

  it("keeps the draft visible while microphone permission/connection is pending, without allowing submission", () => {
    const { field, submit } = setup({ dictationStarting: true }, "Keep this paragraph.\n\nمرحباً");
    expect(field.readOnly).toBe(true);
    expect(field).not.toHaveClass("text-transparent");
    expect(field.value).toBe("Keep this paragraph.\n\nمرحباً");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("marks only a nonempty plain-text paste as a deliberate submission", () => {
    const { field, paste } = setup();
    fireEvent.paste(field, { clipboardData: { getData: () => "" } });
    expect(paste).not.toHaveBeenCalled();
    expect(fireEvent.paste(field, { clipboardData: { getData: () => "  Hallo\nWelt" } })).toBe(
      true,
    );
    expect(paste).toHaveBeenCalledTimes(1);
  });
});
