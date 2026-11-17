import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ nativeJson: vi.fn() }));

vi.mock("@/lib/native/transport", () => ({ nativeJson: transport.nativeJson }));

const { createPlaceClient, NATIVE_PLACE_ROUTE, PLACE_TIMEOUT_MS } = await import("./geocode");

const place = {
  id: "open-meteo:52.52:13.40",
  name: "Berlin",
  latitude: 52.52,
  longitude: 13.4,
  timeZone: "Europe/Berlin",
};

beforeEach(() => {
  Object.defineProperty(window, "Capacitor", {
    configurable: true,
    value: { isNativePlatform: () => true, getPlatform: () => "android" },
  });
});

afterEach(() => {
  transport.nativeJson.mockReset();
  Reflect.deleteProperty(window, "Capacitor");
});

describe("installed app place transport", () => {
  it("posts to the versioned native route with the shared timeout and signal", async () => {
    transport.nativeJson.mockResolvedValue({ ok: true, places: [place] });
    const client = createPlaceClient();
    const controller = new AbortController();
    const places = await client.search("Berlin", "de", controller.signal);
    expect(places).toHaveLength(1);
    expect(transport.nativeJson).toHaveBeenCalledWith(
      NATIVE_PLACE_ROUTE,
      { q: "Berlin", lang: "de" },
      PLACE_TIMEOUT_MS,
      controller.signal,
    );
  });

  it("keeps the route contract for reverse requests", async () => {
    transport.nativeJson.mockResolvedValue({ ok: true, places: [] });
    await createPlaceClient().reverse(52.5201234, 13.4049876, "ar");
    expect(transport.nativeJson).toHaveBeenCalledWith(
      NATIVE_PLACE_ROUTE,
      { latitude: 52.52, longitude: 13.4, lang: "ar" },
      PLACE_TIMEOUT_MS,
      undefined,
    );
  });

  it("maps native transport failure kinds onto the place error kinds", async () => {
    for (const kind of ["rate", "timeout", "network"] as const) {
      transport.nativeJson.mockRejectedValueOnce(Object.assign(new Error(kind), { kind }));
      await expect(createPlaceClient().search("Berlin")).rejects.toMatchObject({ kind });
    }
    transport.nativeJson.mockRejectedValueOnce(
      Object.assign(new Error("offline"), { kind: "offline" }),
    );
    await expect(createPlaceClient().search("Berlin")).rejects.toMatchObject({ kind: "network" });
    transport.nativeJson.mockRejectedValueOnce(
      Object.assign(new Error("provider"), { kind: "provider" }),
    );
    await expect(createPlaceClient().search("Berlin")).rejects.toMatchObject({ kind: "provider" });
  });
});
