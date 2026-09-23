"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

interface TextStreamProps {
  items: string[];
  prefix?: string;
  activeIndex?: number;
  height?: CSSProperties["height"];
  fontSize?: CSSProperties["fontSize"];
  className?: string;
  align?: "start" | "end";
  dir?: "ltr" | "rtl";
}

export function TextStream({
  items,
  prefix,
  activeIndex = 0,
  height,
  fontSize,
  className = "",
  align = "start",
  dir,
}: TextStreamProps) {
  const selected = useMemo(() => {
    if (!items.length) return "";
    const safeIndex = Math.min(Math.max(activeIndex, 0), items.length - 1);
    return items[safeIndex] ?? "";
  }, [activeIndex, items]);
  const [current, setCurrent] = useState(selected);
  const [previous, setPrevious] = useState<string | null>(null);

  useEffect(() => {
    if (selected === current) return;
    setPrevious(current);
    setCurrent(selected);
    const timer = window.setTimeout(() => setPrevious(null), 520);
    return () => window.clearTimeout(timer);
  }, [current, selected]);

  return (
    <span
      className={`text-stream ${align === "end" ? "text-stream-end" : "text-stream-start"} ${className}`}
      style={{ height, fontSize }}
      dir={dir}
      aria-label={[prefix, selected].filter(Boolean).join(" ")}
    >
      {prefix ? <span className="text-stream-prefix">{prefix}</span> : null}
      <span className="text-stream-window" aria-hidden="true">
        {previous ? (
          <span key={`out-${previous}`} className="text-stream-item text-stream-item-out">
            {previous}
          </span>
        ) : null}
        <span key={`in-${current}`} className="text-stream-item text-stream-item-in">
          {current}
        </span>
      </span>
    </span>
  );
}