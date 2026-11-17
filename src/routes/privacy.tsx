import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The privacy page became a section of /about. The URL stays alive so an external link
 * or an old search result still reaches the content: a permanent redirect (301) sends
 * both the reader and the ranking signal to the unified page and its section anchor.
 */
export const Route = createFileRoute("/privacy")({
  staticData: { sitemap: false },
  beforeLoad: () => {
    throw redirect({ to: "/about", hash: "privacy", statusCode: 301 });
  },
});
