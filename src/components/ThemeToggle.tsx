import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";

export function ThemeToggle({ label }: { label: string }) {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={!dark}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        toggle(e.clientX || r.left + r.width / 2, e.clientY || r.top + r.height / 2);
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
  );
}
