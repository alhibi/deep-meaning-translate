import type { WeatherSymbol } from "@/lib/weather/types";

/**
 * Weather symbols, drawn here as one consistent inline-SVG set.
 *
 * Why inline and not a library: the same condition must look the same on the compact strip,
 * the hourly rail and the daily list, and a missing provider code must never be a broken
 * image. Every glyph is stroke-only `currentColor` at a 24×24 grid, 1.5 stroke, round caps —
 * so it inherits the theme tokens and can never hardcode a palette. Glyphs are decorative:
 * every surface that shows one also shows the condition in words (`aria-hidden` here).
 */
type GlyphProps = {
  symbol: WeatherSymbol;
  /** Clear/partly-clock symbols follow the observation's day/night flag. */
  isDay?: boolean;
  className?: string;
};

const CLOUD = "M7.4 18h9.1a4 4 0 0 0 .6-7.8 5.4 5.4 0 0 0-10.3 1.2A3.3 3.3 0 0 0 7.4 18Z";
const CLOUD_SMALL =
  "M10.4 19.2h7.3a3.4 3.4 0 0 0 .5-6.7 4.7 4.7 0 0 0-8.9 1A2.9 2.9 0 0 0 10.4 19.2Z";

function sun(cx: number, cy: number, r: number) {
  return (
    <>
      <circle cx={cx} cy={cy} r={r} />
      <path
        d={`M${cx} ${cy - r - 2.2}v1.6M${cx} ${cy + r + 0.6}v1.6M${cx - r - 2.2} ${cy}h1.6M${cx + r + 0.6} ${cy}h1.6M${cx - r - 1.5} ${cy - r - 1.5}l1.1 1.1M${cx + r + 0.4} ${cy + r + 0.4}l1.1 1.1M${cx + r + 1.5} ${cy - r - 1.5}l-1.1 1.1M${cx - r - 0.4} ${cy + r + 0.4}l-1.1 1.1`}
      />
    </>
  );
}

function moon(cx = 12, cy = 12, scale = 1) {
  const d =
    scale === 1
      ? "M20 13.4A8.1 8.1 0 0 1 10.6 4a8.4 8.4 0 1 0 9.4 9.4Z"
      : `M${cx + 3.9} ${cy + 0.7}A3.9 3.9 0 0 1 ${cx - 0.7} ${cy - 4.5}a4.1 4.1 0 1 0 4.6 5.2Z`;
  return <path d={d} />;
}

function shapes(symbol: WeatherSymbol, isDay: boolean) {
  switch (symbol) {
    case "clear":
      return isDay ? sun(12, 12, 4.2) : moon();
    case "partly-cloudy":
      return (
        <>
          {isDay ? sun(7, 7, 2.7) : moon(6, 6, 0.62)}
          <path d={CLOUD_SMALL} />
        </>
      );
    case "cloudy":
      return <path d={CLOUD} />;
    case "fog":
      return (
        <>
          <path d={CLOUD} />
          <path d="M6.5 20.2h11M8.5 22.2h7" />
        </>
      );
    case "drizzle":
      return (
        <>
          <path d={CLOUD} />
          <path d="M9.4 19.6v1.6M14.6 19.6v1.6" />
        </>
      );
    case "rain":
      return (
        <>
          <path d={CLOUD} />
          <path d="M8.2 19.4l-.7 2.2M12 19.4l-.7 2.2M15.8 19.4l-.7 2.2" />
        </>
      );
    case "heavy-rain":
      return (
        <>
          <path d={CLOUD} />
          <path d="M7.6 19.2l-1 2.6M11 19.2l-1 2.6M14.4 19.2l-1 2.6M17.8 19.2l-1 2.6" />
        </>
      );
    case "sleet":
      return (
        <>
          <path d={CLOUD} />
          <path d="M8.6 19.6v2M14.8 20.8l-.5 1.4M11.7 20.2v1.8M10.8 21.1h1.8" />
        </>
      );
    case "snow":
      return (
        <>
          <path d={CLOUD} />
          <path d="M8.3 20v2M7.4 21h1.8M15 20v2M14.1 21h1.8M11.7 20.2v1.6M10.9 21h1.6" />
        </>
      );
    case "thunder":
      return (
        <>
          <path d={CLOUD} />
          <path d="M13.2 17.6l-2.3 4h2.8l-1.5 2.6" />
        </>
      );
    case "unknown":
      return (
        <>
          <circle cx="12" cy="12" r="7.4" />
          <path d="M8.6 12h6.8" />
        </>
      );
  }
}

export function WeatherGlyph({ symbol, isDay = true, className }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-weather-glyph={symbol}
      data-night={isDay ? undefined : "true"}
      className={className}
    >
      {shapes(symbol, isDay)}
    </svg>
  );
}
