import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { t } from "../i18n/t";

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  actions: ComponentChildren;
  children?: ComponentChildren;
};

/** Modal built on the native <dialog>; replaces alert and confirm. */
export function Dialog({ open, title, onClose, actions, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    } else if (!open && d.open) {
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      class="dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header class="dialog-head">
        <h2>{title}</h2>
        <button type="button" class="icon" aria-label={t("dialog.close")} onClick={onClose}>
          ✕
        </button>
      </header>
      <div class="dialog-body">{children}</div>
      <footer class="dialog-actions">{actions}</footer>
    </dialog>
  );
}
