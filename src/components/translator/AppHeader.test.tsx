import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "./AppHeader";

/** The header needs `Link`, so it renders inside a minimal router (as in the real app). */
async function renderHeader(overrides: Partial<Parameters<typeof AppHeader>[0]> = {}) {
  const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const props = {
    tagline: false,
    onToggleTagline: vi.fn(),
    locale: "en" as const,
    onLocaleSelect: vi.fn(),
    localeOpen: false,
    onOpenLocale: vi.fn(),
    onCloseLocale: vi.fn(),
    canInstall: false,
    onInstall: vi.fn(),
    onOpenSaved: vi.fn(),
    savedLabel: "Saved phrases",
    ...overrides,
  };
  const rootRoute = createRootRoute({
    staticData: { sitemap: false },
    component: () => <AppHeader {...props} />,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    staticData: { sitemap: true },
  });
  const statsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/stats",
    staticData: { sitemap: true },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, statsRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return props;
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
});

describe("app header", () => {
  it("names every icon-only control and links to the statistics", async () => {
    await renderHeader();
    expect(screen.getByRole("button", { name: "Interface language" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saved phrases" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /theme/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /statistic/i })).toHaveAttribute("href", "/stats");
  });

  it("hides the install offer unless the browser actually offers one", async () => {
    await renderHeader();
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
  });

  it("offers installation when the browser does", async () => {
    await renderHeader({ canInstall: true });
    expect(screen.getByRole("button", { name: /install/i })).toBeInTheDocument();
  });

  it("routes the taps it owns and stays out of the ones the page owns", async () => {
    const props = await renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Interface language" }));
    expect(props.onOpenLocale).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Saved phrases" }));
    expect(props.onOpenSaved).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /say it naturally|today/i }));
    expect(props.onToggleTagline).toHaveBeenCalledOnce();
  });

  it("shows the interface language as a short mark, not a translated word", async () => {
    await renderHeader({ locale: "ar" });
    expect(screen.getByRole("button", { name: "Interface language" })).toHaveTextContent("ع");
  });
});
