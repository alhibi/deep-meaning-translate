const INTRO_KEY = "lingua.intro.seen.v1";

export function shouldShowIntro(): boolean {
  try {
    return window.localStorage.getItem(INTRO_KEY) !== "1";
  } catch {
    return false;
  }
}

export function markIntroSeen(): void {
  try {
    window.localStorage.setItem(INTRO_KEY, "1");
  } catch {
    /* Storage is optional; the translator must remain usable without it. */
  }
}
