import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";

export function ThemeToggle({ label }: { label: string }) {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <>
      {/* The transition snapshot passes through this displacement map. It has no
          paint of its own: only the pixels beneath the moving edge are bent. */}
      <svg aria-hidden="true" className="pointer-events-none absolute size-0 overflow-hidden">
        <filter id="theme-heat-refraction" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.008 0.055"
            numOctaves="2"
            seed="19"
            result="heatNoise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="heatNoise"
            scale="18"
            xChannelSelector="R"
            yChannelSelector="B"
          />
        </filter>
      </svg>
      <button
        type="button"
        data-testid="theme-toggle"
        aria-label={label}
        aria-pressed={!dark}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = e.clientX || r.left + r.width / 2;
          const y = e.clientY || r.top + r.height / 2;
          toggle(x, y);
        }}
        className="press relative grid size-11 place-items-center overflow-hidden rounded-full text-muted-foreground hover:text-foreground"
      >
        <Sun
          className="absolute size-[18px] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
          strokeWidth={1.75}
          style={{ transform: dark ? "rotate(-90deg) scale(0.4)" : "none", opacity: dark ? 0 : 1 }}
        />
        <Moon
          className="absolute size-[18px] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
          strokeWidth={1.75}
          style={{ transform: dark ? "none" : "rotate(90deg) scale(0.4)", opacity: dark ? 1 : 0 }}
        />
      </button>
    </>
  );
}
