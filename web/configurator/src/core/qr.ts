/** QR codes for the channel links, drawn as one SVG path (no canvas, no innerHTML). */
import { create } from "qrcode/lib/core/qrcode.js";

export type QrCode = { size: number; dark(row: number, col: number): boolean };

/** The modules of a QR code for the text, error correction M (as phones scan a screen well). */
export function qrCode(text: string): QrCode {
  const { modules } = create(text, { errorCorrectionLevel: "M" });
  return { size: modules.size, dark: (r, c) => !!modules.get(r, c) };
}

/** An SVG path with a unit square for every dark module; draw it in a viewBox of size + 2 × margin. */
export function qrPath(qr: QrCode, margin = 0): string {
  let d = "";
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) if (qr.dark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  }
  return d;
}
