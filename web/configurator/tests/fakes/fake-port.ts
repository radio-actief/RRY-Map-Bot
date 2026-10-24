import type { PortLike } from "../../src/device/serial";

function unknownReply(line: string): string {
  const [verb, key] = line.split(/\s+/);
  if (verb === "get" && key) return `??: ${key}`;
  if (verb === "set" && key) return `unknown config: ${key}`;
  return "Unknown command";
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type FakePortOptions = {
  /** Drop the USB link during the n-th command (it is lost unanswered; the first n-1 are answered). */
  disconnectAfter?: number;
  /** Send all output in chunks of this many bytes, with a timer tick between chunks (USB packets). */
  chunkSize?: number;
  /**
   * The device is busy this long (ms) before it handles the command: its echo and reply come
   * late, and the commands after it wait their turn, as on the single-threaded firmware.
   */
  delayMs?: Record<string, number>;
  /** The exact output for a command, instead of its echo and "->" reply. */
  raw?: Record<string, string>;
  /** What getInfo() reports: the USB vendor and product id. */
  info?: { usbVendorId?: number; usbProductId?: number };
};

/**
 * A fake MeshCore console: echoes each CR-ended line, then answers "  -> <reply>" as the real
 * firmware does. Unknown input gets the firmware's own texts; an empty reply sends no "->" line,
 * so the caller times out. See FakePortOptions for unplugging, chunked output and a busy device.
 */
export class FakePort implements PortLike {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  readonly received: string[] = [];
  private listeners: Array<() => void> = [];
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private pending = "";
  private output: Promise<void> = Promise.resolve();

  constructor(
    private readonly replies: Record<string, string>,
    private readonly opts: FakePortOptions = {},
  ) {}

  async open(): Promise<void> {
    this.readable = new ReadableStream<Uint8Array>({ start: (c) => void (this.controller = c) });
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => this.onWrite(new TextDecoder().decode(chunk)),
    });
    this.emit("\r\nMeshCore repeater ready\r\n");
  }

  getInfo(): { usbVendorId?: number; usbProductId?: number } {
    return this.opts.info ?? {};
  }

  async close(): Promise<void> {
    this.readable = null;
    this.writable = null;
  }

  addEventListener(_t: "disconnect", f: () => void): void {
    this.listeners.push(f);
  }

  removeEventListener(_t: "disconnect", f: () => void): void {
    this.listeners = this.listeners.filter((x) => x !== f);
  }

  private enqueue(bytes: Uint8Array): void {
    if (!this.readable) return;
    try {
      this.controller?.enqueue(bytes);
    } catch {
      /* stream already closed */
    }
  }

  /** Output in order: at once, or (chunked / after a busy delay) behind the output before it. */
  private emit(text: string, delayMs = 0): void {
    const bytes = new TextEncoder().encode(text);
    const { chunkSize, delayMs: delays } = this.opts;
    if (!chunkSize && !delays) return this.enqueue(bytes);
    const size = chunkSize || bytes.length || 1;
    this.output = this.output.then(async () => {
      if (delayMs) await sleep(delayMs);
      for (let i = 0; i < bytes.length; i += size) {
        this.enqueue(bytes.slice(i, i + size));
        await sleep(0);
      }
    });
  }

  private onWrite(text: string): void {
    this.pending += text;
    let at: number;
    while ((at = this.pending.indexOf("\r")) >= 0) {
      const line = this.pending.slice(0, at);
      this.pending = this.pending.slice(at + 1);
      this.received.push(line);
      if (this.opts.disconnectAfter === this.received.length) return this.drop();
      const delay = this.opts.delayMs?.[line] ?? 0;
      if (this.opts.raw && Object.prototype.hasOwnProperty.call(this.opts.raw, line)) {
        this.emit(this.opts.raw[line], delay);
        continue;
      }
      const known = Object.prototype.hasOwnProperty.call(this.replies, line);
      const reply = known ? this.replies[line] : unknownReply(line);
      // the firmware prints nothing at all for an empty reply
      this.emit(`${line}\r\n` + (reply === "" ? "" : `  -> ${reply}\r\n`), delay);
    }
  }

  /** The cable is pulled. */
  private drop(): void {
    this.readable = null;
    this.writable = null;
    this.controller?.error(new Error("device lost"));
    this.listeners.forEach((f) => f());
  }
}
