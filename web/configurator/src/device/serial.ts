/**
 * Web Serial link to a MeshCore repeater / room server console.
 * Plain text lines ended with CR; the device echoes the line (`line\r`, then `\n` on a repeater)
 * and answers on a line starting "->" ended with CRLF.
 */

export interface PortLike {
  open(o: { baudRate: number }): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  close(): Promise<void>;
  addEventListener?(t: "disconnect", f: () => void): void;
  removeEventListener?(t: "disconnect", f: () => void): void;
}

export const MAX_LINE_LEN = 151;

const encoder = new TextEncoder();
export const DEFAULT_BAUD = 115200;
const INTER_COMMAND_DELAY_MS = 150;
const BOOT_DRAIN_MS = 500;
const DISCONNECT_SETTLE_MS = 250;

export type LinkTiming = {
  interCommandDelayMs: number;
  bootDrainMs: number;
  disconnectSettleMs: number;
  /** Replaces the per-command reply timeouts (tests use a short one). */
  replyTimeoutMs?: number;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Commands that reboot, wipe or switch mode, so the USB link drops. */
export function expectsDeviceDisconnect(line: string): boolean {
  const cmd = line.trim().toLowerCase();
  return ["reboot", "erase", "start ota", "poweroff", "shutdown", "clkreboot"].includes(cmd);
}

/**
 * A failed command: "Err ..." / "Error ...", "(ERR: ...)" (e.g. "clock cannot go backwards"), or the
 * firmware's "Unknown command", "unknown config: <key>", "??: <key>".
 */
export function isErrorReply(reply: string): boolean {
  return /^\(?Err\b/i.test(reply) || /^Error/i.test(reply) || /^Unknown command/i.test(reply) || /^unknown config:/i.test(reply) || /^\?\?:/.test(reply);
}

export function commandTimeout(line: string): number {
  if (line.startsWith("advert")) return 6000;
  if (line.startsWith("region save")) return 8000;
  if (line.startsWith("region ")) return 5000;
  return 4000;
}

export function hasWebSerial(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

type SerialApi = { requestPort(o: { filters: unknown[] }): Promise<PortLike> };

export async function requestUsbPort(): Promise<PortLike> {
  if (!hasWebSerial()) throw new Error("Web Serial is not supported in this browser.");
  return (navigator as unknown as { serial: SerialApi }).serial.requestPort({ filters: [] });
}

export class SerialLink {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private buffer = "";
  private queue: Promise<unknown> = Promise.resolve();
  private listeners: Array<() => void> = [];
  private taps: Array<(cmd: string, reply: string | null, error?: string) => void> = [];
  private waiter: (() => void) | null = null;
  private lost = false;
  private opened = false;
  private readonly onPortDisconnect = () => void this.connectionLost();
  private readonly timing: LinkTiming;

  constructor(private readonly port: PortLike, timing: Partial<LinkTiming> = {}) {
    this.timing = {
      interCommandDelayMs: INTER_COMMAND_DELAY_MS,
      bootDrainMs: BOOT_DRAIN_MS,
      disconnectSettleMs: DISCONNECT_SETTLE_MS,
      ...timing,
    };
  }

  get connected(): boolean {
    return this.opened && !this.lost && !!this.port.readable && !!this.port.writable;
  }

  onDisconnect(f: () => void): void {
    this.listeners.push(f);
  }

  /** Every command sent through the link with its reply, or null and the error (the command log). */
  onCommand(f: (cmd: string, reply: string | null, error?: string) => void): void {
    this.taps.push(f);
  }

  async open(): Promise<void> {
    await this.port.open({ baudRate: DEFAULT_BAUD });
    this.opened = true;
    this.lost = false;
    this.buffer = "";
    this.port.addEventListener?.("disconnect", this.onPortDisconnect);
    void this.readLoop();
    await sleep(this.timing.bootDrainMs);
    this.buffer = "";
  }

  /** Close on purpose: no disconnect notification. */
  async close(): Promise<void> {
    this.opened = false;
    this.port.removeEventListener?.("disconnect", this.onPortDisconnect);
    this.notify();
    await this.teardown();
  }

  /** Send one line and return the reply ("" on timeout). Throws if the link is lost. */
  command(cmd: string, timeoutMs?: number): Promise<string> {
    const run = this.queue.then(() => this.send(cmd, timeoutMs));
    this.queue = run.catch(() => undefined);
    const line = cmd.trim();
    if (line && this.taps.length) {
      const tell = (reply: string | null, error?: string) => {
        for (const f of this.taps) {
          try {
            f(line, reply, error);
          } catch {
            /* ignore UI errors */
          }
        }
      };
      run.then(
        (reply) => tell(reply),
        (err) => tell(null, err instanceof Error ? err.message : String(err)),
      );
    }
    return run;
  }

  private async send(cmd: string, timeoutMs?: number): Promise<string> {
    const line = cmd.trim();
    if (!line) return "";
    if (!this.connected) throw new Error("Serial port is not connected.");
    if (line.length > MAX_LINE_LEN) {
      throw new Error(`Line too long (${line.length} > ${MAX_LINE_LEN}): ${line.slice(0, 48)}…`);
    }
    const leaving = expectsDeviceDisconnect(line);
    this.buffer = "";
    await this.write(line + "\r");
    if (leaving) {
      await sleep(this.timing.disconnectSettleMs);
      await this.connectionLost();
      return "";
    }
    const reply = await this.waitForReply(line, timeoutMs || this.timing.replyTimeoutMs || commandTimeout(line));
    if (!this.connected) throw new Error("Serial connection lost while waiting for reply.");
    await sleep(this.timing.interCommandDelayMs);
    return reply;
  }

  private async write(text: string): Promise<void> {
    let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
    try {
      writer = this.port.writable!.getWriter();
      await writer.write(encoder.encode(text));
    } catch (err) {
      await this.connectionLost();
      throw new Error("Serial connection lost" + (err instanceof Error && err.message ? ": " + err.message : "."));
    } finally {
      try {
        writer?.releaseLock();
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * The reply to `line`: the first "->" line after the line's own echo, so output that belongs to
   * an earlier (timed-out) command is never taken. The reply counts once its line ending arrived
   * (a long reply spans several USB packets); `final` (the timeout) takes a started line as it is.
   */
  private extractReply(line: string, final: boolean): string | null {
    const echo = this.buffer.indexOf(line + "\r");
    if (echo < 0) return null;
    const after = this.buffer.slice(echo + line.length + 1);
    const m = /(?:^|\n)[ \t]*->[ \t]*([^\r\n]*)(\r?\n|\r?$)/.exec(after);
    if (!m || (!final && !m[2].endsWith("\n"))) return null;
    this.buffer = after.slice(m.index + m[0].length);
    return m[1].trim();
  }

  /** Resolves with the reply to `line`, or "" on timeout or when the link is lost. One waiter at a time. */
  private waitForReply(line: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (reply: string) => {
        if (timer) clearTimeout(timer);
        if (this.waiter === check) this.waiter = null;
        resolve(reply);
      };
      const check = () => {
        if (!this.connected) return finish("");
        const reply = this.extractReply(line, false);
        if (reply !== null) return finish(reply);
      };
      this.waiter = check;
      timer = setTimeout(() => finish(this.extractReply(line, true) ?? ""), timeoutMs);
      check();
    });
  }

  private notify(): void {
    this.waiter?.();
  }

  private async readLoop(): Promise<void> {
    if (!this.port.readable) return;
    const reader = this.port.readable.getReader();
    this.reader = reader;
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        this.buffer += decoder.decode(chunk.value, { stream: true });
        this.notify();
      }
    } catch {
      /* stream errored: unplug or reboot */
    }
    if (this.opened && !this.lost) await this.connectionLost();
  }

  private async teardown(): Promise<void> {
    const reader = this.reader;
    this.reader = null;
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
    try {
      await this.port.close();
    } catch {
      /* ignore */
    }
    this.buffer = "";
  }

  private async connectionLost(): Promise<void> {
    if (this.lost) return;
    this.lost = true;
    this.opened = false;
    this.port.removeEventListener?.("disconnect", this.onPortDisconnect);
    this.notify();
    await this.teardown();
    for (const f of this.listeners) {
      try {
        f();
      } catch {
        /* ignore UI errors */
      }
    }
  }
}
