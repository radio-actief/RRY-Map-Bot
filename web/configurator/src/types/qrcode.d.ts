/** The QR encoder core of the qrcode package (the same library the map page uses), without its renderers. */
declare module "qrcode/lib/core/qrcode.js" {
  export function create(
    text: string,
    options?: { errorCorrectionLevel?: "L" | "M" | "Q" | "H" },
  ): { version: number; modules: { size: number; get(row: number, col: number): boolean | number } };
}
