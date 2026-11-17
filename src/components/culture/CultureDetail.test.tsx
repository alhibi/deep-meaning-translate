import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CultureDiscovery } from "./CultureDiscovery";
import { COPY } from "./copy";
import {
  makeAdapter,
  makeEntry,
  makeItem,
  makePage,
  richItem,
  type FakeAdapter,
} from "./testFixtures";

/**
 * The reading surface: provenance labels, the original title's direction, the source and
 * licence trail, related records, and the dialog contract (aria-modal, focus return, Escape,
 * scroll restoration).
 */

const card = makeEntry({ id: "relic-card", category: "objects" });

function openDetail(adapter: FakeAdapter) {
  render(<CultureDiscovery adapter={adapter} locale="en" pageSize={4} />);
  return waitFor(() => {
    const opener = document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
    if (!opener) throw new Error("card not ready");
    opener.focus();
    fireEvent.click(opener);
    return opener;
  });
}

beforeEach(() => {
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true, writable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reading surface", () => {
  it("shows the title in both languages, its place, provenance, why and the full source trail", async () => {
    const item = richItem(card.id);
    const related = makeEntry({
      id: "related-1",
      category: "crafts",
      title: { en: "Related record", ar: "سجل ذو صلة", de: "Verwandter Eintrag" },
    });
    const adapter = makeAdapter({
      pages: [makePage([card])],
      items: { [item.id]: item },
      related: [related],
    });
    await openDetail(adapter);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");

    await waitFor(() =>
      expect(within(dialog).getByRole("heading", { level: 2 })).toHaveTextContent(
        "The Cedar Chest",
      ),
    );
    const original = within(dialog).getByText("صندوق الأرز");
    expect(original).toHaveAttribute("dir", "rtl");
    expect(original).toHaveAttribute("lang", "ar");
    expect(within(dialog).getAllByText(/Atlas Mountains/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(COPY.en.provenanceInstitution)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/A painted chest from the Atlas Mountains/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Cedar panels joined without nails/)).toBeInTheDocument();
    expect(within(dialog).getByText(COPY.en.whyDistinctive)).toBeInTheDocument();
    expect(within(dialog).getByText(/The joinery needs no nails/)).toBeInTheDocument();

    const source = within(dialog).getByRole("link", { name: /The Example Museum/ });
    expect(source).toHaveAttribute("href", "https://example.org/record/" + card.id);
    expect(source).toHaveAttribute("target", "_blank");
    expect(source).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(dialog).getByRole("link", { name: /CC0 1.0/ })).toHaveAttribute(
      "href",
      "https://creativecommons.org/publicdomain/zero/1.0/",
    );
    expect(within(dialog).getByText("The Example Museum, CC0 1.0")).toBeInTheDocument();
    expect(within(dialog).getByText(/Image: The Example Museum/)).toBeInTheDocument();

    const relatedButton = within(dialog).getByRole("button", { name: /Related record/ });
    expect(relatedButton).toBeInTheDocument();
  });

  it("labels AI-assisted wording differently from an institutional description", async () => {
    const item = makeItem({
      id: card.id,
      provenance: "machine-translated",
      title: { en: "Hurma", ar: "حُرمة", de: "Hurma", original: "حُرمة", originalLanguage: "ar" },
    });
    const adapter = makeAdapter({ pages: [makePage([card])], items: { [item.id]: item } });
    await openDetail(adapter);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getByText(COPY.en.provenanceMachine)).toBeInTheDocument(),
    );
    expect(within(dialog).queryByText(COPY.en.provenanceInstitution)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(COPY.en.provenanceEditorial)).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus and the exact scroll position", async () => {
    Object.defineProperty(window, "scrollY", { value: 640, configurable: true, writable: true });
    const scrollTo = vi.spyOn(window, "scrollTo");
    const adapter = makeAdapter({
      pages: [makePage([card])],
      items: { [card.id]: richItem(card.id) },
    });
    const opener = await openDetail(adapter);
    const dialog = await screen.findByRole("dialog");
    expect(document.body.style.overflow).toBe("hidden");
    expect(dialog.contains(document.activeElement) || dialog === document.activeElement).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener);
    expect(scrollTo).toHaveBeenCalledWith(0, 640);
    expect(document.body.style.overflow).toBe("");
  });

  it("returns focus to the card when the close control is used", async () => {
    const adapter = makeAdapter({
      pages: [makePage([card])],
      items: { [card.id]: richItem(card.id) },
    });
    const opener = await openDetail(adapter);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: COPY.en.detailClose }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener);
  });

  it("closes on the browser's own back instead of leaving the translator", async () => {
    const adapter = makeAdapter({
      pages: [makePage([card])],
      items: { [card.id]: richItem(card.id) },
    });
    await openDetail(adapter);
    await screen.findByRole("dialog");
    fireEvent.popState(window);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("opens related records inside the same surface", async () => {
    const second = makeItem({
      id: "second",
      title: { en: "Second record", ar: "سجل ثانٍ", de: "Zweiter Eintrag" },
    });
    const item = richItem(card.id);
    const related = makeEntry({ id: second.id, category: "crafts", title: second.title });
    const adapter = makeAdapter({
      pages: [makePage([card])],
      items: { [item.id]: item, [second.id]: second },
      related: [related],
    });
    await openDetail(adapter);
    const dialog = await screen.findByRole("dialog");
    const relatedButton = await within(dialog).findByRole("button", { name: /Second record/ });
    fireEvent.click(relatedButton);
    await waitFor(() => {
      const current = screen.getByRole("dialog");
      expect(within(current).getByRole("heading", { level: 2 })).toHaveTextContent("Second record");
    });
    expect(adapter.calls.items).toEqual([item.id, second.id]);
  });

  it("explains a record that failed to load and retries", async () => {
    const adapter = makeAdapter({
      pages: [makePage([card])],
      items: { [card.id]: richItem(card.id) },
      itemError: true,
    });
    await openDetail(adapter);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText(COPY.en.detailError)).toBeInTheDocument());
    adapter.setItemError(false);
    fireEvent.click(within(dialog).getByRole("button", { name: COPY.en.retry }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("dialog")).getByRole("heading", { level: 2 }),
      ).toHaveTextContent("The Cedar Chest"),
    );
  });

  it("announces the record's area in an Arabic dialog", async () => {
    const item = richItem(card.id);
    const adapter = makeAdapter({ pages: [makePage([card])], items: { [item.id]: item } });
    render(<CultureDiscovery adapter={adapter} locale="ar" pageSize={4} />);
    await waitFor(() => {
      const opener = document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
      if (!opener) throw new Error("card not ready");
      fireEvent.click(opener);
    });
    const dialog = await screen.findByRole("dialog");
    expect(dialog.closest("[dir]")).toHaveAttribute("dir", "rtl");
    await waitFor(() =>
      expect(within(dialog).getByText(COPY.ar.provenanceInstitution)).toBeInTheDocument(),
    );
  });
});
