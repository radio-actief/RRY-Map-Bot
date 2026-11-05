// After a sign-in by someone who isn't in the Discord server, the map offers to open the server's
// invite. It only ever opens a Discord invite: a link put in the address by someone else is ignored.
const opened = (page) => page.evaluate(() => window.__opened || []);

async function visit(ctx, inviteUrl) {
  const page = await ctx.open(`/?error=not_guild_member&invite_url=${encodeURIComponent(inviteUrl)}`, {
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
    },
  });
  await page.waitForTimeout(500);
  return page;
}

export default async function (ctx) {
  const good = await visit(ctx, "https://discord.gg/kvybAgqnhD?redirect_uri=https://meshmap.radio-actief.be/auth/callback");
  ctx.check("map invite: a Discord invite is offered and opened", good.dialogs.length === 1 && (await opened(good))[0]?.startsWith("https://discord.gg/"), JSON.stringify(await opened(good)));
  await good.close();

  for (const bad of ["https://evil.example/login", "javascript:alert(1)", "//evil.example", "https://discord.gg.evil.example/x"]) {
    const page = await visit(ctx, bad);
    ctx.check(`map invite: ${bad} is not offered or opened`, page.dialogs.length === 0 && (await opened(page)).length === 0, JSON.stringify({ dialogs: page.dialogs, opened: await opened(page) }));
    await page.close();
  }
}
