import { Component, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";

/**
 * Crash boundary: one broken part shows a calm message (or nothing, when `silent`)
 * instead of taking the whole screen down.
 */
export class SafeArea extends Component<
  { children: ReactNode; silent?: boolean },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.error("[SafeArea]", error);
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.silent) return null;
    return <Fallback onRetry={() => this.setState({ failed: false })} />;
  }
}

function Fallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onRetry}
      className="press-soft block w-full px-5 py-6 text-start text-[14px] text-muted-foreground"
    >
      {t("crashed")}
    </button>
  );
}
