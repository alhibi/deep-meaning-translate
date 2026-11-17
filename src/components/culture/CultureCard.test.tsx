import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { COPY } from "./copy";
import { CultureCard } from "./CultureCard";
import { compositionFor, type CultureComposition } from "./compositions";
import { ALLOWED_IMAGE_HOST, makeEntry, makeMedia } from "./testFixtures";
import type { CultureCategory } from "@/lib/culture/types";

function renderCard(
  overrides: Parameters<typeof makeEntry>[0],
  options: { saved?: boolean; locale?: "ar" | "de" | "en"; onOpen?: () => void } = {},
) {
  const entry = makeEntry(overrides);
  const onOpen = vi.fn();
  const onToggleSaved = vi.fn();
  const view = render(
    <CultureCard
      entry={entry}
      locale={options.locale ?? "en"}
      copy={COPY[options.locale ?? "en"]}
      saved={options.saved ?? false}
      onOpen={() => {
        onOpen();
        options.onOpen?.();
      }}
      onToggleSaved={onToggleSaved}
    />,
  );
  return { entry, onOpen, onToggleSaved, ...view };
}

describe("feed card compositions", () => {
  it("leads an object with its real image, credit and rights label", () => {
    renderCard({ id: "relic", category: "objects", media: makeMedia(), hasMedia: true });
    const image = screen.getByRole("img");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("decoding", "async");
    expect(image).toHaveAttribute("src", "https://" + ALLOWED_IMAGE_HOST + "/img/thumb.jpg");
    expect(image).toHaveAttribute("width", "1200");
    expect(image).toHaveAttribute("height", "800");
    expect(image.parentElement?.className).toContain("aspect-[4/3]");
    expect(screen.getByText("Image: The Example Museum")).toBeInTheDocument();
    expect(screen.getByText("Rights: CC0 1.0")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Title relic");
  });

  it("refuses an image host outside the runtime allowlist and shows the fallback", () => {
    renderCard({
      id: "foreign",
      category: "objects",
      hasMedia: true,
      media: makeMedia({
        url: "https://not-allowed.example/img/full.jpg",
        thumbnailUrl: "https://not-allowed.example/img/thumb.jpg",
      }),
    });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getAllByText("Objects").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Image:/)).not.toBeInTheDocument();
  });

  it("shows an image from an allow-listed host with its credit", () => {
    renderCard({ id: "trusted", category: "objects", hasMedia: true, media: makeMedia() });
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.getByText("Image: The Example Museum")).toBeInTheDocument();
  });

  it("replaces a broken image with the typographic panel instead of a broken frame", () => {
    renderCard({ id: "relic", category: "objects", media: makeMedia(), hasMedia: true });
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getAllByText("Objects").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Image:/)).not.toBeInTheDocument();
  });

  it("uses the typographic panel when the record has no image, never a stock photo", () => {
    renderCard({ id: "relic", category: "objects", hasMedia: false });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getAllByText("Objects").length).toBeGreaterThan(0);
  });

  it("keeps a practice typographic even when the record carries an image", () => {
    renderCard({ id: "song", category: "music", media: makeMedia(), hasMedia: true });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Title song");
  });

  it("reads a word in its own script and direction, with the interface title beneath", () => {
    renderCard({
      id: "hurma",
      category: "untranslatable",
      title: { en: "Hurma", ar: "حُرمة", de: "Hurma" },
      titleOriginal: "حُرمة",
      titleOriginalLanguage: "ar",
    });
    const original = screen.getByText("حُرمة");
    expect(original).toHaveAttribute("dir", "rtl");
    expect(original).toHaveAttribute("lang", "ar");
    expect(original.className).toContain("font-arabic");
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Hurma");
  });

  it("gives a place its wide landscape and a material record its square tile", () => {
    const place = renderCard({
      id: "bridge",
      category: "architecture",
      media: makeMedia(),
      hasMedia: true,
    });
    expect(place.container.querySelector(".aspect-\\[16\\/9\\]")).not.toBeNull();
    place.unmount();

    const material = renderCard({
      id: "cloth",
      category: "textiles",
      media: makeMedia(),
      hasMedia: true,
    });
    expect(material.container.querySelector(".aspect-square")).not.toBeNull();
    expect(screen.getByText("Image: The Example Museum")).toBeInTheDocument();
  });

  it("keeps every composition distinct so the feed is not one repeated tile", () => {
    const shapes: CultureComposition[] = [
      "artifact",
      "place",
      "practice",
      "word",
      "material",
      "food",
      "quiet",
    ];
    expect(new Set(shapes).size).toBe(shapes.length);
    const categories = new Map<CultureComposition, CultureCategory>();
    for (const category of [
      "objects",
      "architecture",
      "music",
      "language",
      "crafts",
      "food-culture",
      "everyday-life",
    ] as CultureCategory[]) {
      categories.set(compositionFor(category), category);
    }
    expect(categories.size).toBe(7);
  });

  it("shows the quiet variant as a bordered row without a photograph", () => {
    const { container } = renderCard({ id: "day", category: "everyday-life" });
    const article = container.querySelector("article");
    expect(article?.className).toContain("border");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows at most two tags and the card's own save control", () => {
    const { onToggleSaved, entry } = renderCard({
      id: "tagged",
      category: "crafts",
      tags: ["one", "two", "three"],
    });
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("two")).toBeInTheDocument();
    expect(screen.queryByText("three")).not.toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save discovery" });
    expect(save).toHaveAttribute("aria-pressed", "false");
    // 44 px touch target.
    expect(save.className).toContain("size-11");
    fireEvent.click(save);
    expect(onToggleSaved).toHaveBeenCalledWith(entry.id);
  });

  it("reports the saved state both visually and to a screen reader", () => {
    const { rerender } = render(
      <CultureCard
        entry={makeEntry({ id: "kept", category: "objects" })}
        locale="en"
        copy={COPY.en}
        saved={false}
        onOpen={() => undefined}
        onToggleSaved={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Save discovery" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    rerender(
      <CultureCard
        entry={makeEntry({ id: "kept", category: "objects" })}
        locale="en"
        copy={COPY.en}
        saved
        onOpen={() => undefined}
        onToggleSaved={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Remove from saved" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("opens the reading surface from the card body", () => {
    const { onOpen } = renderCard({ id: "relic", category: "objects" });
    const open = document.querySelector('button[aria-haspopup="dialog"]');
    if (!open) throw new Error("no open control");
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("uses Arabic copy and Arabic typography for the save control in an Arabic page", () => {
    renderCard(
      { id: "relic", category: "objects", media: makeMedia(), hasMedia: true },
      { locale: "ar" },
    );
    expect(screen.getByRole("button", { name: COPY.ar.saveLabel })).toBeInTheDocument();
    expect(screen.getByText(COPY.ar.rightsLabel + ": CC0 1.0")).toBeInTheDocument();
  });
});
