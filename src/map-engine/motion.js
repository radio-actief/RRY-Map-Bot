// Reduced motion: when the visitor asks for it (prefers-reduced-motion), both map engines move the
// map without animation: no fly-to, no easing, no fades.

/** True while the browser asks for reduced motion (read each time: it can change). */
export function prefersReducedMotion(win = globalThis) {
  try {
    return Boolean(win.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  } catch {
    return false;
  }
}
