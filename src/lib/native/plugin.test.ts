import { describe, expect, it } from "vitest";
import { asNonThenable } from "./plugin";

/**
 * Regression for the on-device bridge failure: Capacitor registers each plugin as a
 * Proxy whose unknown-property path builds a method, including `then`. Returning that
 * proxy from an async function makes the promise machinery call `then()`, which the
 * bridge rejects ("LinguaStore.then()" is not implemented on android) and every storage
 * call fails. The wrapper must hide only `then` and keep the real methods callable.
 */
function capacitorStyleProxy() {
  let thenCalls = 0;
  const proxy = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "boot") return async () => ({ historyTotal: 0 });
        if (property === "then") {
          return () => {
            thenCalls++;
            throw new Error('"LinguaStore.then()" is not implemented on android');
          };
        }
        return undefined;
      },
    },
  );
  return { proxy, thenCalls: () => thenCalls };
}

describe("asNonThenable", () => {
  it("resolves as an ordinary value instead of assimilating the plugin proxy", async () => {
    const fake = capacitorStyleProxy();
    const safe = asNonThenable(fake.proxy);

    await expect(Promise.resolve(safe)).resolves.toBe(safe);
    expect(fake.thenCalls()).toBe(0);
  });

  it("still forwards the plugin's real methods", async () => {
    const fake = capacitorStyleProxy();
    const safe = asNonThenable(fake.proxy) as { boot: () => Promise<{ historyTotal: number }> };
    await expect(safe.boot()).resolves.toEqual({ historyTotal: 0 });
  });
});
