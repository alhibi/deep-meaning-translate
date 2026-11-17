import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The translation guide became the "how a translation is made" section of /about.
 * The old URL is kept as a permanent redirect so links, bookmarks and search results
 * land on the same content instead of a 404.
 */
export const Route = createFileRoute("/arabic-german-translation")({
  staticData: { sitemap: false },
  beforeLoad: () => {
    throw redirect({ to: "/about", hash: "translation", statusCode: 301 });
  },
});
