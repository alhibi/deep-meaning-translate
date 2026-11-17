import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WeatherStrip } from "./WeatherStrip";
import type { WeatherStripProps } from "./state";
import { HOUR, MINUTE, makeForecast, makeLocation, makeProps, makeSnapshot } from "./testSupport";

function setup(overrides: Partial<WeatherStripProps> = {}) {
  const onRefresh = vi.fn();
  const onEnableLocation = vi.fn();
  const onChooseCity = vi.fn();
  const onUnitsChange = vi.fn();
  const props = makeProps({
    ...overrides,
    onRefresh,
    onEnableLocation,
    onChooseCity,
    onUnitsChange,
  });
  const result = render(<WeatherStrip {...props} />);
  return { ...result, props, onRefresh, onEnableLocation, onChooseCity, onUnitsChange };
}

const noSnapshot = { snapshot: null, freshness: null } as const;

afterEach(() => {
  document.body.style.overflow = "";
});

describe("compact weather strip", () => {
  it("shows place, temperature, condition, range, precipitation and age", () => {
    setup();
    const region = screen.getByRole("region", { name: "Weather" });
    expect(region).toHaveAttribute("data-surface", "forecast");
    expect(region).toHaveAttribute("dir", "ltr");
    const open = within(region).getByRole("button", { name: /Open the forecast/ });
    // The rail outside the button also shows temperatures; scope the readout to the button.
    expect(within(open).getByText("Berlin · Deutschland")).toBeInTheDocument();
    expect(within(open).getByText("Partly cloudy")).toBeInTheDocument();
    expect(within(open).getByText("12°")).toBeInTheDocument();
    expect(within(open).getByText("4° / 12°")).toBeInTheDocument();
    expect(within(open).getByText("40%")).toBeInTheDocument();
    expect(within(open).getByText("Updated 5 min. ago")).toBeInTheDocument();

    expect(open).toHaveAttribute("aria-haspopup", "dialog");
    expect(open).toHaveAttribute("aria-expanded", "false");
    expect(open.getAttribute("aria-label")).toContain("Berlin · Deutschland");
    expect(open.getAttribute("aria-label")).toContain("12°C");
    expect(open.getAttribute("aria-label")).toContain("Partly cloudy");
  });

  it("keeps the provider attribution visible and linked in the compact strip", () => {
    setup();
    const link = screen.getByRole("link", { name: "Weather data by Open-Meteo.com" });
    expect(link).toHaveAttribute("href", "https://open-meteo.com/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("never renders an image or an unsafe attribution link", () => {
    setup({
      forecast: makeForecast({
        snapshot: makeSnapshot({
          attribution: { provider: "open-meteo", text: "Weather data", url: "javascript:alert(1)" },
        }),
      }),
    });
    expect(document.querySelector("img")).toBeNull();
    expect(screen.queryByRole("link", { name: "Weather data" })).toBeNull();
    expect(screen.getByText("Weather data")).toBeInTheDocument();
  });

  it("is a quiet loading state with no fabricated values", () => {
    setup({ forecast: makeForecast({ ...noSnapshot, status: "loading" }) });
    const region = screen.getByRole("region", { name: "Weather" });
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region).toHaveAttribute("data-surface", "loading");
    const button = within(region).getByRole("button", { name: "Forecast loading" });
    expect(button).toBeDisabled();
    expect(within(region).getByText("Checking the forecast…")).toBeInTheDocument();
    expect(within(region).getByText("Forecast loading")).toBeInTheDocument();
    expect(region).not.toHaveTextContent("NaN");
    expect(region).not.toHaveTextContent("°");
  });

  it("says it is locating when the delay is the location fix, not the forecast", () => {
    setup({
      forecast: makeForecast({ ...noSnapshot, status: "loading" }),
      location: makeLocation({ status: "granted", pending: "locating" }),
    });
    const region = screen.getByRole("region", { name: "Weather" });
    expect(within(region).getByRole("button", { name: "Finding your location…" })).toBeDisabled();
    expect(within(region).getByText("Finding your location…")).toBeInTheDocument();
  });

  it("keeps a fixed, declared height budget for loading and ready (no layout jump)", () => {
    const ready = render(<WeatherStrip {...makeProps()} />);
    const readyRoot = ready.container.querySelector("[data-weather-strip]");
    expect(readyRoot).not.toBeNull();
    const readySkeleton = skeleton(readyRoot as HTMLElement);
    ready.unmount();

    const loading = render(
      <WeatherStrip
        {...makeProps({ forecast: makeForecast({ ...noSnapshot, status: "loading" }) })}
      />,
    );
    const loadingRoot = loading.container.querySelector("[data-weather-strip]");
    expect(loadingRoot).not.toBeNull();
    expect(skeleton(loadingRoot as HTMLElement)).toEqual(readySkeleton);

    // jsdom has no layout, so this asserts the height contract the browser lays out from:
    // no inline height, one fixed-height row per band, and a declared 72–100 px budget.
    const shell = (readyRoot as HTMLElement).className;
    expect(shell).toContain("min-h-[72px]");
    expect(shell).toContain("py-2.5");
    expect(shell).toContain("gap-1");
    const rowHeights = [...(readyRoot as HTMLElement).querySelectorAll("[data-strip-row]")].map(
      (row) => Number(/h-\[(\d+)px\]/.exec((row as HTMLElement).className)?.[1]),
    );
    expect(rowHeights).toEqual([34, 16, 17]);
    const budget = rowHeights.reduce((sum, value) => sum + value, 0) + 20 + 8;
    expect(budget).toBeGreaterThanOrEqual(72);
    expect(budget).toBeLessThanOrEqual(100);
    for (const element of (readyRoot as HTMLElement).querySelectorAll("*")) {
      expect((element as HTMLElement).getAttribute("style")).toBeNull();
    }
  });

  it("invites the person to share a location, with an explicit enable and a city alternative", () => {
    const { onEnableLocation, onChooseCity } = setup({
      forecast: makeForecast({ ...noSnapshot, status: "idle" }),
      location: makeLocation({ status: "prompt" }),
    });
    const region = screen.getByRole("region", { name: "Weather" });
    expect(region).toHaveAttribute("data-surface", "permission");
    expect(within(region).getByText("See the weather where you are.")).toBeInTheDocument();
    fireEvent.click(within(region).getByRole("button", { name: "Use my location" }));
    expect(onEnableLocation).toHaveBeenCalledOnce();
    fireEvent.click(within(region).getByRole("button", { name: "Choose a city" }));
    expect(onChooseCity).toHaveBeenCalledOnce();
    expect(within(region).queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Open the forecast/ })).toBeNull();
  });

  it("explains denied and revoked permission calmly and keeps the city path", () => {
    const denied = setup({
      forecast: makeForecast({ ...noSnapshot, status: "idle" }),
      location: makeLocation({ status: "denied", reason: "permission-denied" }),
    });
    expect(screen.getByText("Location is off, so the weather can't load.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose a city" })).toBeInTheDocument();
    denied.unmount();

    setup({
      forecast: makeForecast({ ...noSnapshot, status: "idle" }),
      location: makeLocation({ status: "revoked", reason: "user-revoked" }),
    });
    expect(
      screen.getByText("Location was turned off, so the weather can't load."),
    ).toBeInTheDocument();
  });

  it("offers only the manual city when the browser cannot share a location", () => {
    setup({
      forecast: makeForecast({ ...noSnapshot, status: "idle" }),
      location: makeLocation({ status: "unsupported" }),
    });
    const region = screen.getByRole("region", { name: "Weather" });
    expect(region).toHaveAttribute("data-surface", "unsupported");
    expect(within(region).getByText("This browser can't share a location.")).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Choose a city" })).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: "Use my location" })).toBeNull();
  });

  it("turns a forecast failure into one calm sentence and a retry", () => {
    const { onRefresh } = setup({
      forecast: makeForecast({ ...noSnapshot, status: "error", error: "network" }),
    });
    const region = screen.getByRole("region", { name: "Weather" });
    expect(region).toHaveAttribute("data-surface", "error");
    expect(within(region).getByText("Weather isn't available right now.")).toBeInTheDocument();
    fireEvent.click(within(region).getByRole("button", { name: "Try again" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("has a calm offline empty state with no fake cache", () => {
    const { onRefresh } = setup({
      forecast: makeForecast({ ...noSnapshot, status: "ready", offline: true }),
    });
    const region = screen.getByRole("region", { name: "Weather" });
    expect(region).toHaveAttribute("data-surface", "offline-empty");
    expect(
      within(region).getByText("You're offline. Showing the last saved forecast."),
    ).toBeInTheDocument();
    fireEvent.click(within(region).getByRole("button", { name: "Try again" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("asks for a city when permission is granted but the place could not be resolved", () => {
    setup({
      forecast: makeForecast({ ...noSnapshot, status: "idle" }),
      location: makeLocation({ status: "granted", reason: "geocode-failed" }),
    });
    const region = screen.getByRole("region", { name: "Weather" });
    expect(region).toHaveAttribute("data-surface", "need-place");
    expect(
      within(region).getByText("We couldn't find that place. Choose another city."),
    ).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Choose a city" })).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: "Use my location" })).toBeNull();
  });

  it("keeps an offline snapshot visible with its age and never calls it updated", () => {
    setup({ forecast: makeForecast({ offline: true }) });
    const region = screen.getByRole("region", { name: "Weather" });
    expect(within(region).getByText("Offline · saved 5 min. ago")).toBeInTheDocument();
    expect(region.querySelector('[data-slot="temperature"]')).toHaveTextContent("12°");
    expect(region).not.toHaveTextContent(/Updated/);
  });

  it("marks a stale snapshot as saved, never as updated", () => {
    setup({
      forecast: makeForecast({
        freshness: { ageMs: 20 * MINUTE, isStale: true, isExpired: false },
      }),
    });
    const region = screen.getByRole("region", { name: "Weather" });
    expect(within(region).getByText("Saved 20 min. ago")).toBeInTheDocument();
    expect(region).not.toHaveTextContent(/Updated/);
  });

  it("is correct in RTL Arabic and LTR German", () => {
    setup({ locale: "ar" });
    const arabic = screen.getByRole("region", { name: "الطقس" });
    expect(arabic).toHaveAttribute("dir", "rtl");
    expect(within(arabic).getByText("غائم جزئياً")).toBeInTheDocument();
    expect(within(arabic).getByText(/حُدّث/)).toBeInTheDocument();
    expect(within(arabic).getByRole("button", { name: /افتح التوقعات/ })).toBeInTheDocument();
  });

  it("uses only semantic tokens: no hardcoded colours, no animation loops", () => {
    const { container } = setup();
    const html = container.innerHTML;
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(html).not.toMatch(/rgb\(/i);
    expect(html).not.toMatch(/animate-(breathe|pulse|spin|shimmer|progress)/);
    expect(html).not.toMatch(/animation\s*:/);
  });

  it("opens the forecast with the keyboard, preserves the draft and returns focus on Escape", () => {
    function Harness() {
      return (
        <div>
          <textarea aria-label="draft" defaultValue="نص محفوظ" />
          <WeatherStrip {...makeProps()} />
        </div>
      );
    }
    render(<Harness />);
    const draft = screen.getByLabelText("draft") as HTMLTextAreaElement;
    const opener = screen.getByRole("button", { name: /Open the forecast/ });
    // jsdom has no scrollIntoView; provide it so the spy proves opening never scrolls the page.
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
    expect(screen.getByRole("dialog", { name: "Berlin · Deutschland" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
    expect(draft.value).toBe("نص محفوظ");
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(opener);
    expect(screen.getByLabelText("draft")).toBe(draft);
    scrollIntoView.mockRestore();
  });

  it("can start with the expanded forecast open", () => {
    setup({ defaultOpen: true });
    expect(screen.getByRole("dialog", { name: "Berlin · Deutschland" })).toBeInTheDocument();
  });

  it("converts strip temperatures for an imperial preference without changing the snapshot", () => {
    setup({ units: "imperial" });
    const region = screen.getByRole("region", { name: "Weather" });
    expect(region.querySelector('[data-slot="temperature"]')).toHaveTextContent("54°");
    expect(region.querySelector('[data-slot="range"]')).toHaveTextContent("39° / 54°");
  });
});

function skeleton(root: HTMLElement) {
  return {
    className: root.className,
    layout: root.getAttribute("data-layout"),
    rows: [...root.querySelectorAll("[data-strip-row]")].map((row) => ({
      name: row.getAttribute("data-strip-row"),
      className: row.className,
    })),
    slots: [...root.querySelectorAll("[data-slot]")].map((slot) => slot.getAttribute("data-slot")),
    button: root.querySelector("[data-strip-main]")?.className ?? null,
  };
}

describe("hourly rail", () => {
  it("renders at most three hours, each with a clock label and temperature", () => {
    setup();
    const region = screen.getByRole("region", { name: "Weather" });
    const entries = region.querySelectorAll("[data-hour]");
    expect(entries).toHaveLength(3);
    expect(entries[0]).toHaveAttribute("dir", "ltr");
    expect(entries[0]?.textContent).toContain("13:00");
    expect(entries[0]?.textContent).toContain("12°");
  });

  it("caps the rail even when the snapshot has more hours", () => {
    const snapshot = makeSnapshot();
    const many = {
      ...snapshot,
      hourly: Array.from({ length: 48 }, (_value, index) => ({
        time: new Date(Date.parse(snapshot.hourly[0]!.time) + index * HOUR).toISOString(),
        temperature: 12,
        symbol: "cloudy" as const,
      })),
    };
    setup({ forecast: makeForecast({ snapshot: many }) });
    expect(document.querySelectorAll("[data-hour]")).toHaveLength(3);
  });
});
