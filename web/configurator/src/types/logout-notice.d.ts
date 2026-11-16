/** The word after a log out, from src/shared/logout-notice.js (imported for its side effect). */
interface Window {
  BEmeshLogoutNotice: { run(): string | null; show(message: string): HTMLElement; SHOW_MS: number };
}
