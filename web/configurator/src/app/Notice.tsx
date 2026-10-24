import type { ComponentChildren } from "preact";

export type NoticeKind = "ok" | "warn" | "error";

export function Notice({ kind, children }: { kind: NoticeKind; children?: ComponentChildren }) {
  return (
    <div class={`notice ${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}
