import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { COPY } from "./copy";
import { CultureSection } from "./CultureSection";
import { createFakeAdapter } from "./testFixtures";

/**
 * The route's seam: the existing <CultureSection locale={locale} /> call must keep working,
 * and an injected adapter must be used instead of the production one (so tests and future
 * owners can supply another library).
 */
describe("CultureSection", () => {
  it("renders the library from an injected adapter in the interface language", async () => {
    const fake = createFakeAdapter({ loadFeatured: async () => null });
    render(<CultureSection locale="de" adapter={fake.adapter} />);
    expect(await screen.findByText("A feature on greetings")).toBeInTheDocument();
    expect(screen.getByText(COPY.de.sectionLabel)).toBeInTheDocument();
    expect(document.querySelector<HTMLElement>("[data-culture-section]")?.getAttribute("dir")).toBe(
      "ltr",
    );
  });

  it("keeps the Arabic interface right-to-left", async () => {
    const fake = createFakeAdapter({ loadFeatured: async () => null });
    render(<CultureSection locale="ar" adapter={fake.adapter} />);
    expect(await screen.findByText("A feature on greetings")).toBeInTheDocument();
    expect(document.querySelector<HTMLElement>("[data-culture-section]")?.getAttribute("dir")).toBe(
      "rtl",
    );
  });
});
