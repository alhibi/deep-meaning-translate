import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pwa", () => ({
  appUpdateAvailable: () => true,
  subscribeAppUpdate: () => () => undefined,
}));

const { UpdateNotice } = await import("./UpdateNotice");

describe("UpdateNotice", () => {
  it("offers reload and a dismiss control when a new worker takes over", () => {
    render(<UpdateNotice />);
    expect(screen.getByText("A new version is ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Later" })).toBeInTheDocument();
  });
});
