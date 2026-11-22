// A simulated repeater on Web Serial for the configurator checks: navigator.serial.requestPort()
// gives a port that answers like the MeshCore console (echo, then "  -> <reply>"), from the
// configurator's own read fixture, with the neighbour table of the SNR fixture.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const tests = join(dirname(fileURLToPath(import.meta.url)), "../../../web/configurator/tests/fixtures");
const json = (name) => JSON.parse(readFileSync(join(tests, name), "utf8"));

/** The replies of a read repeater near Ronse that hears seven others, from weak to good. */
export function repeaterReplies() {
  return { ...json("read-ronse.json"), neighbors: json("neighbors-snr.json").neighbors };
}

/** Nodes on the map whose keys start with some of the fixture's prefixes, so the list shows names. */
export const NEIGHBOUR_NODES = [
  ["A1B2C3D4", "BE-RON-Kluisberg", 50.76, 3.5],
  ["55667788", "BE-OUD-Muziekberg", 50.79, 3.74],
  ["5E6F7A8B", "BE-GER-Oudenberg", 50.77, 3.87],
  ["0C0D0E0F", "BE-AVE-Hotond", 50.75, 3.66],
].map(([prefix, adv_name, adv_lat, adv_lon]) => ({
  public_key: (prefix + "0".repeat(56)).toLowerCase(),
  type: 2,
  adv_name,
  adv_lat,
  adv_lon,
}));

/** Install the simulated repeater before the page loads (call before page.goto). */
export async function installFakeRepeater(page, replies = repeaterReplies()) {
  await page.addInitScript((replies) => {
    const RAW = new Set(["get acl"]);
    const unknown = (line) => {
      const [verb, key] = line.split(/\s+/);
      if (verb === "get" && key) return `??: ${key}`;
      if (verb === "set" && key) return "OK";
      return "OK";
    };
    class Port {
      constructor() {
        this.readable = null;
        this.writable = null;
        this.pending = "";
        this.received = [];
      }
      getInfo() {
        return { usbVendorId: 0x239a, usbProductId: 0x8029 };
      }
      async open() {
        const enc = new TextEncoder();
        this.readable = new ReadableStream({ start: (c) => (this.c = c) });
        this.writable = new WritableStream({ write: (chunk) => this.onWrite(new TextDecoder().decode(chunk)) });
        this.emit = (text) => setTimeout(() => this.c && this.c.enqueue(enc.encode(text)), 2);
        this.emit("\r\nMeshCore repeater ready\r\n");
      }
      async close() {
        this.readable = null;
        this.writable = null;
      }
      addEventListener() {}
      removeEventListener() {}
      onWrite(text) {
        this.pending += text;
        let at;
        while ((at = this.pending.indexOf("\r")) >= 0) {
          const line = this.pending.slice(0, at);
          this.pending = this.pending.slice(at + 1);
          this.received.push(line);
          const known = Object.prototype.hasOwnProperty.call(replies, line);
          const reply = known ? replies[line] : unknown(line);
          this.emit(`${line}\r\n` + (RAW.has(line) && known ? reply : `  -> ${reply}\r\n`));
        }
      }
    }
    const port = new Port();
    window.__fakeRepeater = port;
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: { requestPort: async () => port, getPorts: async () => [port], addEventListener() {}, removeEventListener() {} },
    });
  }, replies);
}
