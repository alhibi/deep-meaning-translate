import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BelowCanvas } from "./BelowCanvas";

/**
 * The product switch is off in this release: the translator stays one screen and neither
 * continued surface may mount, request weather/location, or load its chunk. Hiding is a
 * switch, not a deletion — the same composition must still work when it is turned on.
 */
vi.mock("./weather/WeatherSection", () => ({
  WeatherSection: ({ locale }: { locale: string }) => (
    <section data-weather-section data-locale={locale} />
  ),
}));
vi.mock("./culture/CultureSection", () => ({
  CultureSection: ({ locale }: { locale: string }) => (
    <section data-culture-section data-locale={locale} />
  ),
}));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("BelowCanvas", () => {
  it("mounts neither surface while the product switch is off", async () => {
    const { container } = render(<BelowCanvas locale="ar" paused={false} />);
    // DeferredMount would mount on the next tick in jsdom: give it that tick on purpose,
    // so an accidental composition cannot pass by timing.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container).toBeEmptyDOMElement();
    expect(document.querySelector("[data-weather-section]")).toBeNull();
    expect(document.querySelector("[data-culture-section]")).toBeNull();
  });

  it("still composes both surfaces when the switch is on", async () => {
    render(<BelowCanvas locale="de" paused={false} showWeather showCulture />);
    await waitFor(() => {
      expect(document.querySelector("[data-weather-section]")).not.toBeNull();
      expect(document.querySelector("[data-culture-section]")).not.toBeNull();
    });
  });

  it("can bring back one surface without the other", async () => {
    render(<BelowCanvas locale="en" paused={false} showWeather />);
    await waitFor(() => {
      expect(document.querySelector("[data-weather-section]")).not.toBeNull();
    });
    expect(document.querySelector("[data-culture-section]")).toBeNull();
  });
});
