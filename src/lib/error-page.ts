/**
 * The last-resort page: served when rendering the app itself failed, so it cannot rely
 * on React, the router, the stylesheet, a font or a single network request. It carries
 * the product's own surface, palette and calm wording inline, and offers the only two
 * actions that can help.
 */
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex" />
    <meta name="theme-color" content="#12100F" />
    <title>today — this page didn't load</title>
    <style>
      :root {
        color-scheme: dark light;
        --bg: #12100f;
        --fg: #f3efe8;
        --muted: #a7a19a;
        --signal: #c97a5a;
        --edge: rgb(243 239 232 / 14%);
      }
      @media (prefers-color-scheme: light) {
        :root {
          --bg: #f7f3ec;
          --fg: #1c1815;
          --muted: #5c554e;
          --signal: #b0603c;
          --edge: rgb(28 24 21 / 16%);
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100dvh;
        display: grid;
        place-items: center;
        padding: 2rem 1.5rem max(2rem, env(safe-area-inset-bottom));
        background: var(--bg);
        color: var(--fg);
        font: 400 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        text-align: center;
      }
      main { max-width: 26rem; }
      .mark { width: 10px; height: 10px; margin: 0 auto 1.75rem; background: var(--signal); transform: rotate(45deg); border-radius: 1.5px; }
      h1 { font-size: 1.25rem; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 0.6rem; }
      p { color: var(--muted); margin: 0 0 1.75rem; font-size: 0.95rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button {
        font: inherit;
        font-size: 0.9rem;
        font-weight: 500;
        padding: 0.65rem 1.25rem;
        border-radius: 999px;
        cursor: pointer;
        text-decoration: none;
        border: 1px solid transparent;
        transition: transform 120ms ease;
      }
      a:active, button:active { transform: scale(0.97); }
      :focus-visible { outline: 2px solid var(--signal); outline-offset: 3px; }
      .primary { background: var(--signal); color: #1a110b; }
      .secondary { background: transparent; color: var(--fg); border-color: var(--edge); }
    </style>
  </head>
  <body>
    <main>
      <div class="mark" aria-hidden="true"></div>
      <h1>This page didn't load</h1>
      <p>Something interrupted the app on its way to you. Nothing you wrote is lost.</p>
      <div class="actions">
        <button class="primary" type="button" onclick="location.reload()">Try again</button>
        <a class="secondary" href="/">Open the translator</a>
      </div>
    </main>
  </body>
</html>`;
}
