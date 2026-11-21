// Someone who isn't in the Discord server: a sign-in ends on the not-member page with the server's
// invite, and a Claim that the server refuses for that reason offers to open the invite. Only a
// Discord invite is ever opened: a link put in the address, or any other link, is ignored.
const opened = (page) => page.evaluate(() => window.__opened || []);
const KEY = "ab".repeat(32);
const now = new Date().toISOString();
const NODES = [
  { adv_name: "Invite check", adv_lat: 51.05, adv_lon: 3.72, city: "Gent", public_key: KEY, type: 2, source: "app", params: {}, inserted_date: now, updated_date: now, last_advert: now },
];

/** The map with dialogs answered "yes" and window.open recorded; `claim` is the server's answer to Claim. */
async function visit(ctx, path, claim) {
  const page = await ctx.open(path, {
    setup: async (p) => {
      p.dialogs = [];
      p.on("dialog", async (d) => {
        p.dialogs.push(d.message());
        await d.accept();
      });
      await p.addInitScript(() => {
        window.__opened = [];
        window.open = (url) => {
          window.__opened.push(String(url));
          return null;
        };
      });
      await p.route("**/api/v1/belgian-nodes", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(NODES) }));
      if (claim) {
        await p.route("**/auth/me", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: true, user: { id: "1", username: "tester" } }) }));
        await p.route("**/api/v1/my-node-roles", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ roles: {} }) }));
        await p.route(`**/api/v1/nodes/${KEY}/claim`, (r) => r.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify(claim) }));
      }
    },
  });
  await page.waitForTimeout(500);
  return page;
}

/** Presses Claim the way the popup does and waits for the dialogs to settle. */
async function claim(page) {
  await page.waitForFunction(() => typeof window.claimNode === "function", null, { timeout: 10000 });
  await page.evaluate((k) => window.claimNode(k), KEY);
  await page.waitForTimeout(500);
}

const BAD = ["https://evil.example/login", "javascript:alert(1)", "//evil.example", "https://discord.gg.evil.example/x"];

export default async function (ctx) {
  // The address offers nothing, not even a real invite.
  for (const url of ["https://discord.gg/kvybAgqnhD", ...BAD]) {
    const page = await visit(ctx, `/?error=not_guild_member&invite_url=${encodeURIComponent(url)}`);
    ctx.check(`map invite: an invite in the address (${url}) is not offered or opened`, page.dialogs.length === 0 && (await opened(page)).length === 0, JSON.stringify({ dialogs: page.dialogs, opened: await opened(page) }));
    await page.close();
  }

  // The not-member page after a sign-in: the server's own invite, in a new tab.
  const failed = await ctx.open("/auth/failed?reason=not_member");
  const join = await failed.locator('a.btn.primary[target="_blank"]').getAttribute("href").catch(() => null);
  ctx.check("map invite: the not-member sign-in page links the Discord invite", /^https:\/\/discord\.gg\//.test(join || ""), String(join));
  await failed.close();

  // Claim refused for membership: a Discord invite is offered and opened.
  const good = await visit(ctx, "/", { error: "not_guild_member", discord_invite_url: "https://discord.gg/kvybAgqnhD" });
  await claim(good);
  const goodOpened = await opened(good);
  ctx.check("map invite: Claim offers the Discord invite and opens it", good.dialogs.length === 2 && goodOpened.length === 1 && goodOpened[0].startsWith("https://discord.gg/"), JSON.stringify({ dialogs: good.dialogs.length, opened: goodOpened }));
  await good.close();

  for (const bad of BAD) {
    const page = await visit(ctx, "/", { error: "not_guild_member", discord_invite_url: bad });
    await claim(page);
    const got = await opened(page);
    ctx.check(`map invite: Claim with ${bad} opens nothing`, got.length === 0 && !page.dialogs.some((d) => d.includes("invite")), JSON.stringify({ dialogs: page.dialogs, opened: got }));
    await page.close();
  }
}
