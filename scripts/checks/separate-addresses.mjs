// The site's tools on their own addresses (SITE_TOOLS_JSON with full addresses): runs only when the
// server lists NodeBook on another origin, e.g.
//   SITE_TOOLS_JSON='[{"key":"nodebook","label":"NodeBook","url":"http://127.0.0.1:4791/"},
//                     {"key":"meshmate","label":"MeshMate","url":"http://127.0.0.1:4792/"}]'
// It serves a stand-in NodeBook on that address itself and checks: the settings hand-off both
// ways, the map popup's tool links and its NodeBook lookup with the visitor's cookies, and the
// device hub relaying between NodeBook's tab and the configurator, getLast/setLast, and that a page
// on an address that is not listed gets nothing from the hub.
import { createServer } from "node:http";
import { stub } from "./fixtures/configurator.mjs";
import { handoffBothWays, NODEBOOK_SCRIPT } from "./configurator-handoff.mjs";

const KEY = (i) => (i + 1).toString(16).padStart(2, "0").repeat(32);
const now = new Date().toISOString();
const NODES = [
  { city: "Gent", source: "app", params: {}, inserted_date: now, updated_date: now, last_advert: now, adv_name: "Companion one", public_key: KEY(0), type: 1, adv_lat: 51.05, adv_lon: 3.72 },
];
const HELD = { kind: "bemesh.device", v: 1, type: "held", tool: "nodebook", transport: "usb", role: "repeater", usbVendorId: 0x303a, usbProductId: 0x1001, name: "BE-GEN-Zoë", publicKey: null };

/** The stand-in page: NodeBook's hand-off script plus a hidden device hub frame from the map. */
const page = (map) => `<!doctype html><meta charset="utf-8"><title>Tool stand-in</title><script>
${NODEBOOK_SCRIPT}
const MAP = ${JSON.stringify(map)};
window.hubMessages = [];
const hub = document.createElement("iframe");
hub.hidden = true;
hub.src = MAP + "/device-hub.html";
addEventListener("message", (e) => {
  if (e.origin === MAP && e.source === hub.contentWindow) window.hubMessages.push(e.data);
});
window.toHub = (m) => hub.contentWindow.postMessage(m, MAP);
hub.addEventListener("load", () => (window.hubLoaded = true));
document.documentElement.appendChild(hub);
</script>`;

/** A stand-in tool server on `port` (0: any free port); `seen` records NodeBook lookups and their cookies. */
function standIn(port, map, seen) {
  const server = createServer((req, res) => {
    const m = /^\/api\/nodes\/([0-9a-f]{64})$/.exec(req.url || "");
    if (m) {
      seen.push({ key: m[1], cookie: req.headers.cookie || "" });
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": map, "Access-Control-Allow-Credentials": "true", Vary: "Origin" });
      res.end(JSON.stringify({ public_key: m[1], fleets: m[1] === KEY(0) ? [{ id: 1, name: "Home" }] : [] }));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page(map));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

const wait = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 10000 }).catch(() => null);

export default async function (ctx) {
  const map = new URL(ctx.base).origin;
  const tools = await fetch(ctx.base + "/api/v1/site-tools").then((r) => r.json()).catch(() => []);
  const nbTool = tools.find((x) => x.key === "nodebook" && /^https?:\/\//.test(x.url) && new URL(x.url).origin !== map);
  const mmTool = tools.find((x) => x.key === "meshmate");
  if (!nbTool) {
    ctx.check("separate addresses: skipped, the server lists no NodeBook on another address", true);
    return;
  }
  const nbUrl = new URL(nbTool.url);
  const seen = [];
  const servers = [];
  const context = await ctx.browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  try {
    servers.push(await standIn(Number(nbUrl.port), map, seen));
    const other = await standIn(0, map, []);
    servers.push(other);
    const otherOrigin = `http://127.0.0.1:${other.address().port}`;

    const errors = [];
    const refused = [];
    context.on("page", (p) => {
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("console", (m) => {
        if (m.type() !== "error" || /ERR_NETWORK_CHANGED/.test(m.text())) return;
        // The page that is not listed must be refused the hub frame: expected there, an error anywhere else.
        if (p.url().startsWith(otherOrigin) && /frame-ancestors/.test(m.text())) refused.push(m.text());
        else errors.push(`${p.url()}: ${m.text()}`);
      });
    });

    // The settings hand-off, both ways across addresses.
    const nb = await context.newPage();
    await nb.goto(nbTool.url);
    await handoffBothWays(ctx, context, { name: "separate addresses handoff", nb, confUrl: ctx.base + "/configurator", errors });
    for (const p of context.pages()) if (p !== nb) await p.close();

    // The device hub: NodeBook's tab and the configurator share the channel and the last device.
    await wait(nb, () => window.hubLoaded === true);
    const asked = Date.now();
    await nb.evaluate(() => window.toHub({ kind: "bemesh.device.getLast", v: 1 }));
    await wait(nb, () => window.hubMessages.some((m) => m.kind === "bemesh.device.last"));
    ctx.check("separate addresses hub: getLast answers within 2 s", Date.now() - asked < 2000, `${Date.now() - asked} ms`);
    const first = await nb.evaluate(() => window.hubMessages.find((m) => m.kind === "bemesh.device.last") ?? null);
    ctx.check("separate addresses hub: getLast answers, nothing remembered yet", first?.v === 1 && first.last === null, JSON.stringify(first));

    const conf = await context.newPage();
    await stub(conf);
    await conf.goto(ctx.base + "/configurator", { waitUntil: "networkidle" });
    await wait(nb, () => window.hubMessages.some((m) => m.kind === "bemesh.device" && m.tool === "configurator" && m.type === "who"));
    const who = await nb.evaluate(() => window.hubMessages.find((m) => m.kind === "bemesh.device" && m.tool === "configurator") ?? null);
    ctx.check("separate addresses hub: the configurator's who reaches NodeBook's tab", who?.type === "who", JSON.stringify(who));

    await conf.evaluate(() => {
      window.channelGot = [];
      const ch = new BroadcastChannel("bemesh-device");
      ch.onmessage = (e) => window.channelGot.push(e.data);
    });
    await nb.evaluate((m) => window.toHub(m), HELD);
    await wait(conf, () => window.channelGot.length > 0);
    const relayed = await conf.evaluate(() => window.channelGot[0] ?? null);
    ctx.check("separate addresses hub: NodeBook's held reaches the configurator's channel", JSON.stringify(relayed) === JSON.stringify(HELD), JSON.stringify(relayed));

    const heldLast = await conf.evaluate(() => JSON.parse(localStorage.getItem("bemesh.device.last") || "null"));
    ctx.check("separate addresses hub: a relayed held device becomes the last device", heldLast?.transport === "usb" && heldLast.name === "BE-GEN-Zoë" && heldLast.usbVendorId === 0x303a && typeof heldLast.at === "number", JSON.stringify(heldLast));

    await nb.evaluate(() => window.toHub({ kind: "bemesh.device.setLast", v: 1, last: { usbVendorId: 0x303a, usbProductId: 0x1001, role: "repeater", name: "BE-GEN-Set", publicKey: null } }));
    await wait(conf, () => (localStorage.getItem("bemesh.device.last") || "").includes("BE-GEN-Set"));
    const stored = await conf.evaluate(() => JSON.parse(localStorage.getItem("bemesh.device.last") || "null"));
    ctx.check("separate addresses hub: setLast is what the configurator reads", stored?.transport === "usb" && stored.name === "BE-GEN-Set" && typeof stored.at === "number", JSON.stringify(stored));

    await conf.evaluate(() => localStorage.setItem("bemesh.device.last", JSON.stringify({ transport: "usb", usbVendorId: 1, usbProductId: 2, role: null, name: "From the configurator", publicKey: null, at: Date.now() })));
    await nb.evaluate(() => {
      window.hubMessages = [];
      window.toHub({ kind: "bemesh.device.getLast", v: 1 });
    });
    await wait(nb, () => window.hubMessages.some((m) => m.kind === "bemesh.device.last"));
    const again = await nb.evaluate(() => window.hubMessages.find((m) => m.kind === "bemesh.device.last") ?? null);
    ctx.check("separate addresses hub: getLast gives the configurator's device", again?.last?.name === "From the configurator", JSON.stringify(again));

    // A page on an address that is not listed: the hub is not framed there and answers nothing.
    const stranger = await context.newPage();
    await stranger.goto(otherOrigin + "/");
    await stranger.waitForTimeout(800);
    await stranger.evaluate(() => {
      try {
        window.toHub({ kind: "bemesh.device.getLast", v: 1 });
      } catch {
        /* no frame to post to */
      }
    });
    await conf.evaluate(() => (window.channelGot = []));
    await stranger.evaluate((m) => {
      try {
        window.toHub(m);
      } catch {
        /* no frame */
      }
    }, { ...HELD, tool: "stranger" });
    await stranger.waitForTimeout(800);
    const strangerGot = await stranger.evaluate(() => window.hubMessages.length);
    const confGot = await conf.evaluate(() => window.channelGot.length);
    ctx.check("separate addresses hub: a page that is not listed gets no answer and reaches no one", strangerGot === 0 && confGot === 0, `${strangerGot} answers, ${confGot} relayed`);
    ctx.check("separate addresses hub: the hub refuses to be framed there", refused.length > 0, "no frame-ancestors refusal");
    await stranger.close();

    // The map popup: links on the tools' own addresses, and the NodeBook lookup with cookies.
    await context.addCookies([{ name: "nbcheck", value: "1", url: nbTool.url }]);
    const mapPage = await context.newPage();
    await mapPage.route("**/api/v1/belgian-nodes", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(NODES) }));
    await mapPage.route("**/auth/me", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: true, user: { id: "1", username: "tester" } }) }));
    await mapPage.goto(`${ctx.base}/?node=${KEY(0)}`, { waitUntil: "networkidle" });
    await mapPage.waitForSelector(".node-popup__tools a >> nth=1", { timeout: 10000 }).catch(() => {});
    const links = await mapPage.locator(".node-popup__tools a").evaluateAll((as) => as.map((a) => `${a.textContent}=${a.getAttribute("href")}`));
    const want = [`In your NodeBook=${nbTool.url}node/${KEY(0)}`, ...(mmTool ? [`Connect live=${mmTool.url}#node=${KEY(0)}`] : [])];
    ctx.check("separate addresses popup: links go to the tools' own addresses", links.join(" | ") === want.join(" | "), links.join(" | "));
    const lookup = seen.find((x) => x.key === KEY(0));
    ctx.check("separate addresses popup: NodeBook is asked with the visitor's cookies", !!lookup && /nbcheck=1/.test(lookup.cookie), JSON.stringify(lookup));
    await mapPage.close();

    ctx.check("separate addresses: no page errors", !errors.length, errors.join("; "));
  } finally {
    await context.close();
    for (const s of servers) await new Promise((r) => s.close(r));
  }
}
