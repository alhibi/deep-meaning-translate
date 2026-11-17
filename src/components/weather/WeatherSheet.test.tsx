import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WeatherSheet } from "./WeatherSheet";
import type { WeatherSheetProps } from "./state";
import { WeatherStrip } from "./WeatherStrip";
import { HOUR, MINUTE, makeForecast, makeLocation, makeProps, makeSnapshot } from "./testSupport";

function renderSheet(overrides: Partial<WeatherSheetProps> = {}) {
  const onClose = vi.fn();
  const onRefresh = vi.fn();
  const onUnitsChange = vi.fn();
  const onEnableLocation = vi.fn();
  const onChooseCity = vi.fn();
  const props: WeatherSheetProps = {
    open: true,
    onClose,
    locale: "en",
    forecast: makeForecast(),
    location: makeLocation(),
    units: "metric",
    onRefresh,
    onEnableLocation,
    onChooseCity,
    onUnitsChange,
    ...overrides,
  };
  const result = render(<WeatherSheet {...props} />);
  return { ...result, props, onClose, onRefresh, onUnitsChange, onEnableLocation, onChooseCity };
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: "Berlin · Deutschland" });
}

afterEach(() => {
  document.body.style.overflow = "";
});

describe("expanded weather forecast", () => {
  it("is a modal dialog that moves focus inside and names itself after the place", () => {
    renderSheet();
    const sheet = dialog();
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(sheet).toHaveAttribute("data-surface", "forecast");
    expect(sheet.getAttribute("aria-labelledby")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBe(document.activeElement);
    // Every glyph is decorative; the condition is always in words as well.
    for (const glyph of sheet.querySelectorAll("svg[data-weather-glyph]")) {
      expect(glyph).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("shows current details, provider update time, next 24h and the 5–7 day forecast", () => {
    renderSheet();
    const sheet = dialog();
    const view = within(sheet);
    // "Partly cloudy" also labels the hourly/daily sr-only conditions; scope to the current block.
    const current = within(sheet.querySelector("[data-current]") as HTMLElement);
    expect(current.getByText("Partly cloudy")).toBeInTheDocument();
    expect(view.getByText("12°C")).toBeInTheDocument();
    expect(view.getByText("Feels like 10°")).toBeInTheDocument();
    expect(view.getByText("Humidity 64%")).toBeInTheDocument();
    expect(view.getByText("Wind 14 km/h")).toBeInTheDocument();
    expect(view.getByText("Sunrise 7:42 AM")).toBeInTheDocument();
    expect(view.getByText("Sunset 4:35 PM")).toBeInTheDocument();
    // Labelled as the provider's time, not as "now".
    expect(view.getByText("Provider updated 11:00 AM")).toBeInTheDocument();
    expect(view.getByRole("heading", { name: "Next 24 hours" })).toBeInTheDocument();
    expect(view.getByRole("heading", { name: "Next 7 days" })).toBeInTheDocument();
    expect(sheet.querySelectorAll("[data-hour-card]")).toHaveLength(24);
    expect(sheet.querySelectorAll("[data-day-row]")).toHaveLength(7);
    expect(view.getByText("Tue, Nov 17")).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Update" })).toBeInTheDocument();
  });

  it("carries the required attribution link in the expanded details", () => {
    renderSheet();
    const link = within(dialog()).getByRole("link", { name: "Weather data by Open-Meteo.com" });
    expect(link).toHaveAttribute("href", "https://open-meteo.com/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows a place-name credit only when the provider supplied it", () => {
    const { unmount } = renderSheet();
    expect(document.querySelector("[data-place-credit]")).toBeNull();
    unmount();
    renderSheet({
      forecast: makeForecast({
        snapshot: makeSnapshot({
          place: {
            ...makeSnapshot().place,
            source: "geolocation",
            placeCredit: "Place name © OpenStreetMap contributors",
          },
        }),
      }),
    });
    expect(
      within(dialog()).getByText("Place name © OpenStreetMap contributors"),
    ).toBeInTheDocument();
  });

  it("omits sunrise and sunset when the provider did not supply them", () => {
    const days = makeSnapshot().daily.map((day) => {
      const { sunrise, sunset, ...rest } = day;
      void sunrise;
      void sunset;
      return rest;
    });
    renderSheet({ forecast: makeForecast({ snapshot: makeSnapshot({ daily: days }) }) });
    const text = dialog().textContent ?? "";
    expect(text).not.toContain("Sunrise");
    expect(text).not.toContain("Sunset");
  });

  it("toggles units through the controlled preference and converts every value", () => {
    const { onUnitsChange, props, rerender } = renderSheet();
    const view = within(dialog());
    const group = view.getByRole("group", { name: "Units" });
    expect(group).toBeInTheDocument();
    const celsius = view.getByRole("button", { name: "Celsius" });
    const fahrenheit = view.getByRole("button", { name: "Fahrenheit" });
    expect(celsius).toHaveAttribute("aria-pressed", "true");
    expect(fahrenheit).toHaveAttribute("aria-pressed", "false");
    expect(celsius).toHaveTextContent("°C");
    expect(fahrenheit).toHaveTextContent("°F");

    // Choosing the unit that is already active asks for no work.
    fireEvent.click(celsius);
    expect(onUnitsChange).not.toHaveBeenCalled();
    fireEvent.click(fahrenheit);
    expect(onUnitsChange).toHaveBeenCalledWith("imperial");

    rerender(<WeatherSheet {...props} units="imperial" />);
    const converted = within(dialog());
    expect(converted.getByText("54°F")).toBeInTheDocument();
    expect(converted.getByText("Wind 9 mph")).toBeInTheDocument();
    expect(converted.getByRole("button", { name: "Fahrenheit" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("never presents a stale or expired forecast as updated", () => {
    const { unmount } = renderSheet({
      forecast: makeForecast({
        freshness: { ageMs: 2 * HOUR, isStale: true, isExpired: false },
      }),
    });
    expect(within(dialog()).getByText("Saved 2 hr. ago")).toBeInTheDocument();
    expect(dialog()).not.toHaveTextContent(/Updated/);
    expect(
      within(dialog()).getByText("This forecast was saved 2 hr. ago and may be out of date."),
    ).toBeInTheDocument();
    unmount();

    renderSheet({
      forecast: makeForecast({
        freshness: { ageMs: 4 * HOUR, isStale: true, isExpired: true },
      }),
    });
    expect(within(dialog()).getByText("Outdated · 4 hr. ago")).toBeInTheDocument();
    expect(dialog()).toHaveTextContent(/may have changed/);
  });

  it("explains that a cached forecast is shown offline or after a failed update", () => {
    const { unmount } = renderSheet({ forecast: makeForecast({ offline: true }) });
    expect(within(dialog()).getByText("Offline · saved 5 min. ago")).toBeInTheDocument();
    expect(
      within(dialog()).getByText("You're offline. Showing the last saved forecast."),
    ).toBeInTheDocument();
    unmount();

    renderSheet({ forecast: makeForecast({ status: "error", error: "network" }) });
    expect(within(dialog()).getByText("Update failed · saved 5 min. ago")).toBeInTheDocument();
    expect(
      within(dialog()).getByText("The update failed. Showing the last saved forecast."),
    ).toBeInTheDocument();
  });

  it("shows the refresh control as updating and marks the dialog busy", () => {
    renderSheet({ forecast: makeForecast({ refreshing: true }) });
    const sheet = dialog();
    expect(sheet).toHaveAttribute("aria-busy", "true");
    const refresh = within(sheet).getByRole("button", { name: "Updating…" });
    expect(refresh).toBeDisabled();
    expect(sheet).toHaveTextContent(/Updating…/);
  });

  it("has a calm empty state instead of an empty dialog", () => {
    const { onRefresh } = renderSheet({
      forecast: makeForecast({ snapshot: null, status: "error", freshness: null }),
    });
    const empty = screen.getByRole("dialog", { name: "Weather" });
    expect(within(empty).getByText("No forecast is available yet.")).toBeInTheDocument();
    fireEvent.click(within(empty).getByRole("button", { name: "Try again" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("is localized and RTL-correct", () => {
    renderSheet({ locale: "ar" });
    const sheet = screen.getByRole("dialog", { name: "Berlin · Deutschland" });
    expect(sheet).toHaveAttribute("dir", "rtl");
    expect(within(sheet).getByRole("button", { name: "إغلاق" })).toBeInTheDocument();
    expect(within(sheet).getByRole("group", { name: "الوحدات" })).toBeInTheDocument();
    expect(
      within(sheet).getByRole("heading", { name: "الساعات الـ24 القادمة" }),
    ).toBeInTheDocument();
    expect(
      within(sheet.querySelector("[data-current]") as HTMLElement).getByText("غائم جزئياً"),
    ).toBeInTheDocument();
  });

  it("closes on Escape, on the close button and on the backdrop", () => {
    const { onClose } = renderSheet();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(document.querySelector("[data-sheet-scrim]") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("traps Tab inside the dialog and wraps to the first control", () => {
    renderSheet();
    const sheet = dialog();
    const refresh = within(sheet).getByRole("button", { name: "Update" });
    refresh.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(within(sheet).getByRole("button", { name: "Close" }));
  });

  it("locks the page scroll while open and preserves the translator behind it", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <textarea aria-label="draft" defaultValue="draft text" />
          <button type="button" onClick={() => setOpen(true)}>
            Opener
          </button>
          <WeatherSheet
            open={open}
            onClose={() => setOpen(false)}
            {...makeProps()}
            onRefresh={vi.fn()}
          />
        </div>
      );
    }
    render(<Harness />);
    const draft = screen.getByLabelText("draft");
    const opener = screen.getByRole("button", { name: "Opener" });
    if (typeof Element.prototype.scrollIntoView !== "function") {
      Object.defineProperty(Element.prototype, "scrollIntoView", {
        value: () => {},
        writable: true,
        configurable: true,
      });
    }
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(draft).toHaveValue("draft text");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(opener);
    expect(screen.getByLabelText("draft")).toBe(draft);
    scrollIntoView.mockRestore();
  });

  it("uses only semantic tokens: no hardcoded colours, no animation loops, no images", () => {
    renderSheet();
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(html).not.toMatch(/rgb\(/i);
    expect(html).not.toMatch(/animate-(breathe|pulse|spin|shimmer|progress)/);
    expect(document.querySelector("img")).toBeNull();
    // The only motion is one-shot entrance (reduced-motion is handled globally by styles.css).
    expect(html).toContain("animate-sheet-in");
  });

  it("can be opened from the compact strip and returns focus to it", () => {
    render(<WeatherStrip {...makeProps()} />);
    const opener = screen.getByRole("button", { name: /Open the forecast/ });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog", { name: "Berlin · Deutschland" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe("sheet accessibility labels", () => {
  it("names the unit choice and exposes pressed state", () => {
    renderSheet();
    const celsius = within(dialog()).getByRole("button", { name: "Celsius" });
    const fahrenheit = within(dialog()).getByRole("button", { name: "Fahrenheit" });
    expect(celsius).toHaveTextContent("°C");
    expect(fahrenheit).toHaveTextContent("°F");
    expect(celsius).toHaveAttribute("aria-pressed", "true");
  });
});
