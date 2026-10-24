import type { PortLike } from "../../src/device/serial";

/**
 * A fake MeshCore console: echoes each CR-ended line, then answers "  -> <reply>" as the real
 * firmware does. `disconnectAfter: n` drops the USB link during the n-th command (it is lost
 * unanswered; the first n-1 are answered). Unknown commands get an "Err" reply.
 */
export class FakePort implements PortLike {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  readonly received: string[] = [];
  private listeners: Array<() => void> = [];
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private pending = "";

  constructor(
    private readonly replies: Record<string, string>,
    private readonly opts: { disconnectAfter?: number } = {},
  ) {}

  async open(): Promise<void> {
    this.readable = new ReadableStream<Uint8Array>({ start: (c) => void (this.controller = c) });
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => this.onWrite(new TextDecoder().decode(chunk)),
    });
    this.emit("\r\nMeshCore repeater ready\r\n");
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

  private emit(text: string): void {
    this.controller?.enqueue(new TextEncoder().encode(text));
  }

  private onWrite(text: string): void {
    this.pending += text;
    let at: number;
    while ((at = this.pending.indexOf("\r")) >= 0) {
      const line = this.pending.slice(0, at);
      this.pending = this.pending.slice(at + 1);
      this.received.push(line);
      if (this.opts.disconnectAfter === this.received.length) return this.drop();
      const reply = Object.prototype.hasOwnProperty.call(this.replies, line) ? this.replies[line] : "Err - unknown command";
      this.emit(`${line}\r\n  -> ${reply}\r\n`);
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
