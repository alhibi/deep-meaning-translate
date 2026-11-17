import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CultureArticle, CultureIndexEntry } from "@/lib/culture/types";
import { CultureDiscovery } from "./CultureDiscovery";
import { COPY } from "./copy";
import { createFakeAdapter, makeArticle, makeEntry, text } from "./testFixtures";

function articleMap(articles: readonly CultureArticle[]): Map<string, CultureArticle> {
  return new Map(articles.map((article) => [article.id, article]));
}

function renderSection(options: {
  entries: CultureIndexEntry[];
  articles: CultureArticle[];
  related?: CultureIndexEntry[];
}) {
  const byId = articleMap(options.articles);
  const fake = createFakeAdapter({
    entries: options.entries,
    loadItem: async (id: string) => byId.get(id) ?? null,
    loadRelated: async () => options.related ?? [],
  });
  const view = render(<CultureDiscovery adapter={fake.adapter} locale="en" />);
  return { ...view, fake };
}

async function openFirst(locale: "ar" | "de" | "en" = "en") {
  const entry = makeEntry({ id: "a1", contentType: "feature" });
  const article = makeArticle({
    id: "a1",
    contentType: "feature",
    related: ["rel1"],
    sources: [
      {
        organization: "Example Ethnographic Institute",
        title: text("Everyday greetings in the German-speaking world"),
        url: "https://example.org/greetings",
        accessed: "2026-11-01",
        supports: text("Describes the greeting at the door."),
      },
    ],
  });
  const relatedEntry = makeEntry({
    id: "rel1",
    contentType: "note",
    title: text("A related note"),
  });
  const relatedArticle = makeArticle({
    id: "rel1",
    contentType: "note",
    title: text("A related note"),
  });
  const byId = articleMap([article, relatedArticle]);
  const fake = createFakeAdapter({
    entries: [entry, relatedEntry],
    loadItem: async (id: string) => byId.get(id) ?? null,
    loadRelated: async () => [relatedEntry],
  });
  render(<CultureDiscovery adapter={fake.adapter} locale={locale} />);
  const opener = await screen.findByRole("button", { name: "A quiet habit" });
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByRole("dialog");
  return { fake, opener, dialog };
}

afterEach(() => {
  document.body.style.overflow = "";
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true, writable: true });
});

describe("the reading dialog", () => {
  it("opens on the written piece, traps focus, locks the page and closes with Escape", async () => {
    const { dialog } = await openFirst();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("data-culture-reading");
    expect(document.body.style.overflow).toBe("hidden");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.getByText("Example Ethnographic Institute")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.style.overflow).toBe("");
  });

  it("closes on the Android back gesture", async () => {
    await openFirst();
    fireEvent(window, new Event("lingua:back"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("restores the scroll position and the focus to the card that opened it", async () => {
    Object.defineProperty(window, "scrollY", { value: 420, configurable: true, writable: true });
    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const { opener } = await openFirst();
    const close = screen.getByRole("button", { name: COPY.en.close });
    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(scrollSpy).toHaveBeenCalledWith(0, 420);
    expect(document.activeElement).toBe(opener);
    scrollSpy.mockRestore();
  });

  it("shows headline, deck, teaser and the written sections", async () => {
    await openFirst();
    expect(screen.getByRole("heading", { level: 2, name: /A quiet habit/ })).toBeInTheDocument();
    expect(screen.getByText(/small daily act carries/)).toBeInTheDocument();
    expect(screen.getByText("What happens")).toBeInTheDocument();
    expect(screen.getByText(/first paragraph of the piece/)).toBeInTheDocument();
  });

  it("renders the native expression in its own script, with transliteration, gloss and usage", async () => {
    const article = makeArticle({
      id: "lang1",
      contentType: "language",
      title: text("The greeting that arrives before the door"),
      expression: {
        original: "يا سلام",
        transliteration: "ya salām",
        language: "ar",
        gloss: text("What a lovely thing — said on arrival."),
        usage: text("Said when a guest has just arrived."),
      },
    });
    const entry = makeEntry({
      id: "lang1",
      contentType: "language",
      hasExpression: true,
      title: text("The greeting that arrives before the door"),
    });
    renderSection({ entries: [entry], articles: [article] });
    const opener = await screen.findByRole("button", {
      name: "The greeting that arrives before the door",
    });
    fireEvent.click(opener);
    const block = await waitFor(() => {
      const found = document.querySelector<HTMLElement>("[data-culture-expression]");
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    expect(block.getAttribute("data-expression-lang")).toBe("ar");
    const original = screen.getByText("يا سلام");
    expect(original.getAttribute("dir")).toBe("rtl");
    expect(original.getAttribute("lang")).toBe("ar");
    expect(original.className).toContain("font-arabic");
    expect(screen.getByText("ya salām")).toBeInTheDocument();
    expect(screen.getByText(COPY.en.glossLabel)).toBeInTheDocument();
    expect(screen.getByText(COPY.en.usageLabel)).toBeInTheDocument();
  });

  it("keeps references restrained and only opens them in a new, safe tab", async () => {
    await openFirst();
    const link = screen.getByRole("link", { name: /Everyday greetings/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("href")).toBe("https://example.org/greetings");
  });

  it("moves to a related piece without leaving the dialog", async () => {
    const { fake, dialog } = await openFirst();
    const related = await within(dialog).findByRole("button", { name: /A related note/ });
    fireEvent.click(related);
    await waitFor(() => expect(fake.loadItem).toHaveBeenCalledWith("rel1"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await within(screen.getByRole("dialog")).findByText("A related note");
  });

  it("saves the open piece from the reading header", async () => {
    const { fake, dialog } = await openFirst();
    const save = within(dialog).getByRole("button", {
      name: COPY.en.saveAria.replace("{title}", "A quiet habit"),
    });
    fireEvent.click(save);
    expect(fake.savedToggle).toHaveBeenCalledWith("a1");
  });

  it("never renders an image or a remote media element", async () => {
    await openFirst();
    expect(document.querySelectorAll("img, picture, video, iframe")).toHaveLength(0);
  });

  it("uses the reduced-motion class contract on its animated surfaces", async () => {
    await openFirst();
    const scrim = document.querySelector("[data-culture-reading-scrim]");
    expect(scrim?.className).toContain("motion-reduce:animate-none");
  });

  it("renders a calm missing state when the piece is not in the library", async () => {
    const entry = makeEntry({ id: "gone", contentType: "feature" });
    const fake = createFakeAdapter({
      entries: [entry],
      loadItem: async () => null,
    });
    render(<CultureDiscovery adapter={fake.adapter} locale="en" />);
    fireEvent.click(await screen.findByRole("button", { name: "A quiet habit" }));
    await screen.findByText(COPY.en.articleMissingTitle);
    expect(screen.getByRole("button", { name: COPY.en.back })).toBeInTheDocument();
  });
});
