import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CultureCard } from "./CultureCompositions";
import { COPY } from "./copy";
import { makeEntry, makeTypedEntries } from "./testFixtures";

const noop = () => undefined;

function renderCard(entry: ReturnType<typeof makeEntry>, locale: "ar" | "de" | "en" = "en") {
  const onOpen = vi.fn();
  const onToggleSaved = vi.fn();
  const view = render(
    <CultureCard
      entry={entry}
      locale={locale}
      saved={false}
      onOpen={onOpen}
      onToggleSaved={onToggleSaved}
    />,
  );
  return { ...view, onOpen, onToggleSaved };
}

describe("the six written compositions", () => {
  it("renders one distinct composition per contentType, never a generic card", () => {
    const entries = makeTypedEntries();
    const { container } = render(
      <div>
        {entries.map((entry) => (
          <CultureCard
            key={entry.id}
            entry={entry}
            locale="en"
            saved={false}
            onOpen={noop}
            onToggleSaved={noop}
          />
        ))}
      </div>,
    );
    const cards = [...container.querySelectorAll<HTMLElement>("[data-culture-card]")];
    expect(cards).toHaveLength(6);
    const compositions = cards.map((card) => card.dataset["composition"]);
    expect(compositions).toEqual(["feature", "note", "language", "scene", "contrast", "detail"]);
    // Every card has a title control and a save control: the family shares its grammar.
    for (const card of cards) {
      expect(card.querySelector("[data-culture-open]")).toBeTruthy();
      expect(card.querySelector("[data-culture-save]")).toBeTruthy();
    }
  });

  it("renders type, headline, teaser and reading time for a feature", () => {
    renderCard(makeEntry({ id: "f1", contentType: "feature", readingMinutes: 7 }));
    expect(screen.getByRole("heading", { level: 3 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "A quiet habit" })).toBeInTheDocument();
    expect(screen.getByText(/short written discovery/)).toBeInTheDocument();
    expect(screen.getByText(/7 min read/)).toBeInTheDocument();
    expect(screen.getByText("Feature")).toBeInTheDocument();
  });

  it("opens a piece from its title and saves it from its own control", async () => {
    const entry = makeEntry({ id: "n1" });
    const { onOpen, onToggleSaved } = renderCard(entry);
    fireEvent.click(screen.getByRole("button", { name: "A quiet habit" }));
    expect(onOpen).toHaveBeenCalledWith(entry);
    fireEvent.click(screen.getByRole("button", { name: /save A quiet habit/i }));
    expect(onToggleSaved).toHaveBeenCalledWith("n1");
  });

  it("sets the interface direction on every composition", () => {
    const { container, unmount } = render(
      <div>
        <CultureCard
          entry={makeEntry({ id: "a1" })}
          locale="ar"
          saved={false}
          onOpen={noop}
          onToggleSaved={noop}
        />
      </div>,
    );
    const card = container.querySelector<HTMLElement>("[data-culture-card]");
    expect(card?.getAttribute("dir")).toBe("rtl");
    unmount();
    const ltr = render(
      <CultureCard
        entry={makeEntry({ id: "a2" })}
        locale="de"
        saved={false}
        onOpen={noop}
        onToggleSaved={noop}
      />,
    );
    expect(
      ltr.container.querySelector<HTMLElement>("[data-culture-card]")?.getAttribute("dir"),
    ).toBe("ltr");
  });

  it("keeps the native script direction when a title is written in it", () => {
    const entry = makeEntry({
      id: "lang1",
      contentType: "language",
      hasExpression: true,
      title: { ar: "يا سلام", de: "يا سلام", en: "يا سلام" },
    });
    const { container } = render(
      <CultureCard entry={entry} locale="de" saved={false} onOpen={noop} onToggleSaved={noop} />,
    );
    const button = container.querySelector<HTMLElement>("[data-culture-open]");
    expect(button?.getAttribute("dir")).toBe("rtl");
    expect(screen.getByText(COPY.de.expressionLabel)).toBeInTheDocument();
  });

  it("compares two real contexts in the contrast composition and warns against homogenising", () => {
    const entry = makeEntry({
      id: "c1",
      contentType: "contrast",
      countries: ["DE", "AT"],
      continent: "europe",
    });
    renderCard(entry);
    expect(screen.getByText("Germany")).toBeInTheDocument();
    expect(screen.getByText("Austria")).toBeInTheDocument();
    expect(screen.getByText(COPY.en.cautionContrast)).toBeInTheDocument();
  });

  it("contains no images, pictures or video anywhere", () => {
    const { container } = render(
      <div>
        {makeTypedEntries().map((entry) => (
          <CultureCard
            key={entry.id}
            entry={entry}
            locale="en"
            saved={false}
            onOpen={noop}
            onToggleSaved={noop}
          />
        ))}
      </div>,
    );
    expect(container.querySelectorAll("img, picture, video, iframe, svg image")).toHaveLength(0);
    expect(container.querySelector('[style*="url("]')).toBeNull();
  });
});
