import { Palette } from "lucide-react";
import { useTheme } from "@/lib/theme";

export function ThemeToggle({ label }: { label: string }) {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-theme-choice={theme}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        toggle(e.clientX || r.left + r.width / 2, e.clientY || r.top + r.height / 2);
      }}
      className="press relative grid size-11 place-items-center overflow-hidden rounded-full text-muted-foreground hover:text-foreground"
    >
      <Palette
        aria-hidden="true"
        className="size-[18px]"
        strokeWidth={1.75}
      />
    </button>
  );
}
