import { INTRO_BOOT } from "@/lib/intro";
import { BOOT_GUARD_SCRIPT } from "@/lib/bootGuard";
import { THEME_BOOT, syncThemeColor } from "@/lib/theme";
import { LOCALE_BOOT } from "@/lib/i18n";
import { ErrorScreen, NotFoundScreen } from "@/components/FailureScreen";
import { UpdateNotice } from "@/components/UpdateNotice";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { finishPlatformChrome, hydratePlatform, platformReadySync } from "@/lib/platform";

import appCss from "../styles.css?url";
// The two faces used above the fold. Preloading them removes the late swap: without it
// the browser only discovers a font after parsing the stylesheet that references it.
import geistWoff2 from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";
import serifItalicWoff2 from "@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "google-site-verification", content: "a0rpGx7xxjdDQZQy4ysiOtOdZufWTlNoqNsu_mIe3kg" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
      },
      { name: "theme-color", content: "#12100F" },
      { name: "color-scheme", content: "light dark" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "format-detection", content: "telephone=no" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "today" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "today" },
      { name: "twitter:card", content: "summary_large_image" },
      // One generated card, in the product's own type and palette (scripts/make-og.mjs).
      { property: "og:image", content: "https://fluently.today/og.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:type", content: "image/png" },
      {
        property: "og:image:alt",
        content: "today — Say it as you mean it. Meaning-first Arabic–German translation.",
      },
      { name: "twitter:image", content: "https://fluently.today/og.png" },
      { name: "author", content: "today" },
    ],
    links: [
      {
        rel: "preload",
        href: geistWoff2,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        href: serifItalicWoff2,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundScreen,
  errorComponent: ErrorScreen,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <script dangerouslySetInnerHTML={{ __html: LOCALE_BOOT }} />
        <script dangerouslySetInnerHTML={{ __html: INTRO_BOOT }} />
        <script dangerouslySetInnerHTML={{ __html: BOOT_GUARD_SCRIPT }} />
        {/* A browser without JavaScript keeps the translator visible: the gate exists
            only to stop a flash, never to hide the app from someone it cannot open. */}
        <noscript>
          <style>{`html[data-intro="open"] .intro-screen{display:none}`}</style>
        </noscript>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/** True only in the Android asset build (Vite define in `vite.native.config.ts`). */
const NATIVE_SHELL = import.meta.env?.["VITE_NATIVE_SHELL"] === "1";

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  // In the Android app the durable snapshot is loaded behind the native splash screen,
  // so the first translator paint already has the saved theme, direction, draft and
  // recent archive. A browser tab is ready immediately and keeps its current behaviour.
  //
  // On native the server-prerendered HTML must be the boot cover, not the translator:
  // the client's first render cannot know the draft yet, so rendering the translator
  // would diverge from the server markup and React would discard it (error #418). The
  // build define makes both sides render the same cover, then the real screen mounts
  // after the bridge snapshot is applied — still behind the splash.
  const [ready, setReady] = useState(() => (NATIVE_SHELL ? false : platformReadySync()));
  useEffect(() => {
    // The palette is already correct before paint (THEME_BOOT); this also keeps the
    // browser chrome right on routes that mount no ThemeToggle, such as /stats.
    syncThemeColor();
    if (ready) {
      // React has committed the restored frame: only now hand the screen over.
      void finishPlatformChrome();
      return;
    }
    let alive = true;
    void hydratePlatform().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [ready]);

  if (!ready)
    return (
      <div
        aria-busy="true"
        aria-label="Loading"
        className="min-h-[100dvh] w-full bg-background"
        data-boot-cover="native"
      />
    );

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <UpdateNotice />
    </QueryClientProvider>
  );
}
