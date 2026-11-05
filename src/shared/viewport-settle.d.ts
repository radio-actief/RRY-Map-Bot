/** Re-measure on every visual viewport change; scroll back to the top once the keyboard has closed. */
export function settleAfterKeyboard(onResize: () => void): () => void;
