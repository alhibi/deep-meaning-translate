import { Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { reportLovableError } from "@/lib/lovable-error-reporting";

/**
 * Failure screens.
 *
 * Both are part of the product, not browser default pages: same surface, same type,
 * same three languages, same calm tone as the in-place errors of a failed translation.
 * They live here (not in the root route) so they can be tested like any component.
 */

function CenteredPage({
  children,
  rtl,
  testId,
}: {
  children: ReactNode;
  rtl: boolean;
  testId: string;
}) {
  return (
    <main
      data-testid={testId}
      dir={rtl ? "rtl" : "ltr"}
      className="grid min-h-[100dvh] place-items-center bg-background px-7 pad-safe-top pad-safe-bottom"
    >
      <div className="w-full max-w-sm text-center">{children}</div>
    </main>
  );
}

export function NotFoundScreen() {
  const { t, rtl } = useI18n();
  return (
    <CenteredPage rtl={rtl} testId="not-found">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">404</p>
      <h1 className="mt-3 text-[22px] font-semibold leading-tight text-foreground">
        {t("notFoundTitle")}
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{t("notFoundBody")}</p>
      <Link
        to="/"
        className="press mt-6 inline-flex items-center gap-2 rounded-full bg-signal px-5 py-2.5 text-[13px] font-medium text-signal-foreground"
      >
        {t("goHome")}
      </Link>
    </CenteredPage>
  );
}

export function ErrorScreen({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const { t, rtl } = useI18n();
  useEffect(() => {
    // Server logs keep the detail; the person in front of the screen gets a calm sentence.
    console.error(error);
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <CenteredPage rtl={rtl} testId="error-boundary">
      <span aria-hidden className="mx-auto block size-1.5 rotate-45 rounded-[1.5px] bg-signal" />
      <h1 className="mt-4 text-[22px] font-semibold leading-tight text-foreground">
        {t("errorTitle")}
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{t("errorBody")}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="press inline-flex items-center gap-2 rounded-full bg-signal px-5 py-2.5 text-[13px] font-medium text-signal-foreground"
        >
          {t("tryAgain")}
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="press-soft inline-flex items-center rounded-full border border-border-strong px-5 py-2.5 text-[13px] font-medium text-foreground"
        >
          {t("reload")}
        </button>
      </div>
    </CenteredPage>
  );
}
