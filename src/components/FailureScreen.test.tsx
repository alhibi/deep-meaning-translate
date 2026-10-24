import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ErrorScreen, NotFoundScreen } from "./FailureScreen";
import type { ErrorComponentProps } from "@tanstack/react-router";

/** Render helpers: the screens use `Link`/`useRouter`, which need a minimal router. */
async function renderScreen(ui: React.ReactElement) {
  const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const rootRoute = createRootRoute({ staticData: { sitemap: false }, component: () => ui });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    staticData: { sitemap: true },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/missing-page"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

afterEach(() => {
  localStorage.clear();
});

describe("failure screens", () => {
  it("the 404 speaks the user's interface language and offers the way back", async () => {
    await renderScreen(<NotFoundScreen />);
    expect(await screen.findByTestId("not-found")).toBeInTheDocument();
    expect(screen.getByText("404")).toBeInTheDocument();
    // English is the default interface language.
    expect(screen.getByRole("heading", { name: "This page doesn't exist" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the translator" })).toHaveAttribute("href", "/");
  });

  it("the error screen stays calm, keeps the text safe and offers retry plus reload", async () => {
    const props = { error: new Error("boom"), reset: () => {} } as unknown as ErrorComponentProps;
    await renderScreen(<ErrorScreen {...props} />);
    const screenEl = await screen.findByTestId("error-boundary");
    expect(screenEl).toHaveTextContent("Nothing you wrote is lost.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });
});
