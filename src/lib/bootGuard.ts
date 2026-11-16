/**
 * Last-resort boot guard.
 *
 * The platform gate is bounded in JavaScript, but if the bundle never executes (parse
 * error on an old WebView, a missing asset, a failed module load) React cannot show
 * anything and the WebView would stay blank. This inline script runs before the app
 * modules, waits long enough for a slow device, and replaces the silence with one calm,
 * localized sentence and a retry action. It never runs while the app is working: the boot
 * cover is removed on the first real frame.
 */
export const BOOT_GUARD_SCRIPT = `(function () {
  var shown = false;
  function message() {
    var lang = document.documentElement.lang || "en";
    if (lang === "ar") return ["تعذّر فتح today.", "إعادة المحاولة"];
    if (lang === "de") return ["today konnte nicht geöffnet werden.", "Erneut versuchen"];
    return ["today could not open.", "Try again"];
  }
  function fail() {
    if (shown) return;
    shown = true;
    var text = message();
    var host = document.querySelector("[data-boot-cover]");
    if (!host) {
      host = document.createElement("div");
      host.setAttribute("data-boot-cover", "native");
      document.body.appendChild(host);
    }
    host.textContent = "";
    host.style.cssText = "min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center;background:#12100F;color:#F5EFE6;font-family:system-ui,sans-serif";
    var line = document.createElement("p");
    line.textContent = text[0];
    line.style.cssText = "margin:0;font-size:16px;line-height:1.5";
    var retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = text[1];
    retry.style.cssText = "min-height:44px;padding:0 20px;border-radius:999px;border:1px solid #6B5B4E;background:transparent;color:inherit;font-size:15px";
    retry.addEventListener("click", function () { location.reload(); });
    host.appendChild(line);
    host.appendChild(retry);
  }
  window.addEventListener("error", function (event) {
    if (event && event.target && event.target.tagName === "SCRIPT") fail();
  }, true);
  setTimeout(function () {
    if (document.querySelector("[data-boot-cover]") || !document.body.innerText.trim()) fail();
  }, 9000);
})();`;
