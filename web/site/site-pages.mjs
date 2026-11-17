// Vite plugin for the tool pages. Vite bundles a page's module scripts and stylesheets by itself;
// this adds what those pages have besides:
//
// - Their classic scripts (<script src> without type="module": the language and theme in <head>,
//   the top bar and the stats page at the end of <body>). Each run of neighbouring ones becomes one
//   minified file named by its content. They stay classic scripts, in the same place and order,
//   and one that throws still doesn't stop the next, as when they were separate files.
// - Their messages: src/shared/i18n/shared.<lang>.json and <page>.<lang>.json become one file per
//   language named by its content; src/shared/i18n.js reads the list from data-i18n-files.
// - What src/map-engine/index.js preloads for a browser with WebGL (the MapLibre chunk and its
//   stylesheet): their built names, in <meta name="bemesh-engine-files">.
// - Their stylesheets as one file per page, in the page's order (Vite alone would share parts of
//   them between pages and lose that order), marked data-bemesh-styles so the map engines can put
//   their own stylesheet before it.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { minifySync, parseSync } from "vite";

const SCRIPT = /<script\b([^>]*)><\/script>/g;
const ATTR = /([\w:-]+)(?:="([^"]*)")?/g;
const STYLESHEET = /<link\b([^>]*)\/?>/g;
const I18N_DIR = "src/shared/i18n";
/** The made-up file that stands for a page's stylesheets: <root>/site-styles.<page>.css */
const STYLES = /\/site-styles\.([\w-]+)\.css$/;

const attrsOf = (text) => Object.fromEntries([...text.matchAll(ATTR)].map((m) => [m[1], m[2] ?? ""]));
const hashOf = (source) => createHash("sha256").update(source).digest("hex").slice(0, 10);

/** The runs of neighbouring classic scripts of this site in a page: [{ start, end, scripts: [{ file, attrs }] }]. */
export function classicGroups(html) {
  const groups = [];
  let last = null;
  for (const m of html.matchAll(SCRIPT)) {
    const attrs = attrsOf(m[1]);
    const local = /^\.?\/(?!\/)/.test(attrs.src ?? "");
    if (!local || attrs.type === "module") {
      last = null;
      continue;
    }
    const { src, ...rest } = attrs;
    const script = { file: src.replace(/^\.?\//, ""), attrs: rest };
    if (last && /^\s*$/.test(html.slice(last.end, m.index))) {
      last.scripts.push(script);
      last.end = m.index + m[0].length;
    } else {
      last = { start: m.index, end: m.index + m[0].length, scripts: [script] };
      groups.push(last);
    }
  }
  return groups;
}

/**
 * One classic script of several: each file in its own try, so one that throws is reported and the
 * next still runs. That needs files without declarations at the top (they would no longer be
 * global); the pages' scripts are all one call each, and anything else stops the build.
 */
export function joinClassic(files) {
  const parts = files.map(({ file, code }) => {
    const { program, errors } = parseSync(file, code, { sourceType: "script" });
    if (errors.length) throw new Error(`${file}: ${errors[0].message}`);
    const odd = program.body.find((node) => node.type !== "ExpressionStatement" && node.type !== "EmptyStatement");
    if (odd) throw new Error(`${file}: a ${odd.type} at the top of a classic script can't be bundled; wrap the file in a function`);
    return `try{\n${code}\n}catch(e){setTimeout(function(){throw e})}`;
  });
  // (target: the minifier adds no syntax newer than these files use, so they run where they ran)
  const out = minifySync("classic.js", parts.join("\n"), { module: false, compress: { target: "es2015" } });
  if (out.errors.length) throw new Error(out.errors[0].message);
  return out.code;
}

/** A page's messages per language, shared and its own in one object (no key may be in both). */
export function pageMessages(root, page) {
  const dir = join(root, I18N_DIR);
  const langs = readdirSync(dir).map((f) => /^shared\.(\w+)\.json$/.exec(f)?.[1]).filter(Boolean).sort();
  const read = (name, lang) => JSON.parse(readFileSync(join(dir, `${name}.${lang}.json`), "utf8"));
  return Object.fromEntries(langs.map((lang) => {
    const shared = read("shared", lang);
    const own = page === "shared" ? {} : read(page, lang);
    const both = Object.keys(own).filter((k) => k in shared);
    if (both.length) throw new Error(`${page}.${lang}.json repeats keys of shared.${lang}.json: ${both.join(", ")}`);
    return [lang, JSON.stringify({ ...shared, ...own })];
  }));
}

const escapeAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

export function sitePages({ root, pages }) {
  /** fileName -> source, for every file this plugin adds to the build */
  const emitted = new Map();
  const add = (name, ext, source) => {
    const fileName = `assets/${name}-${hashOf(source)}.${ext}`;
    emitted.set(fileName, source);
    return "/" + fileName;
  };

  /** The page with each run of classic scripts as one built file. */
  function bundleClassic(html) {
    let out = html;
    for (const group of classicGroups(html).reverse()) {
      const code = joinClassic(group.scripts.map(({ file }) => ({ file, code: readFileSync(join(root, file), "utf8") })));
      const attrs = Object.assign({}, ...group.scripts.map((s) => s.attrs));
      if (attrs["data-i18n-page"]) {
        const files = Object.entries(pageMessages(root, attrs["data-i18n-page"]))
          .map(([lang, json]) => [lang, add(`${attrs["data-i18n-page"]}.${lang}`, "json", json)]);
        attrs["data-i18n-files"] = JSON.stringify(Object.fromEntries(files));
      }
      const src = add(group.start < html.indexOf("</head>") ? "head" : "page", "js", code);
      const rest = Object.entries(attrs).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("");
      // (vite-ignore: Vite leaves a classic script alone, and removes the attribute)
      out = out.slice(0, group.start) + `<script src="${src}"${rest} vite-ignore></script>` + out.slice(group.end);
    }
    return out;
  }

  /** page name -> the stylesheets it links, in order */
  const styles = new Map();

  /** The page with its own stylesheets as one link, to a file that imports them in order. */
  function joinStyles(html, page) {
    const links = [...html.matchAll(STYLESHEET)]
      .map((m) => ({ m, attrs: attrsOf(m[1]) }))
      .filter(({ attrs }) => attrs.rel === "stylesheet" && /^\.?\/(?!\/)/.test(attrs.href ?? ""));
    if (!links.length) return html;
    styles.set(page, links.map(({ attrs }) => attrs.href.replace(/^\.?\//, "")));
    let out = html;
    links.reverse().forEach(({ m }, i) => {
      const first = i === links.length - 1;
      const end = m.index + m[0].length + (first ? 0 : /^\s*/.exec(out.slice(m.index + m[0].length))[0].length);
      out = out.slice(0, m.index) + (first ? `<link rel="stylesheet" href="./site-styles.${page}.css" />` : "") + out.slice(end);
    });
    return out;
  }

  /** What a WebGL browser preloads: the chunk with the MapLibre engine, what it imports, its stylesheet. */
  function engineFiles(bundle, entry) {
    const chunks = Object.values(bundle).filter((f) => f.type === "chunk");
    const engine = chunks.find((c) => c.moduleIds.some((id) => id.endsWith("/src/map-engine/maplibre-engine.js")));
    if (!engine || !entry) return null;
    const reach = (from, dynamic) => {
      const seen = new Set();
      const todo = [from];
      while (todo.length) {
        const chunk = bundle[todo.pop()];
        if (!chunk || chunk.type !== "chunk" || seen.has(chunk.fileName)) continue;
        seen.add(chunk.fileName);
        todo.push(...chunk.imports, ...(dynamic ? chunk.dynamicImports : []));
      }
      return seen;
    };
    if (!reach(entry.fileName, true).has(engine.fileName)) return null;
    const loaded = reach(entry.fileName, false);
    const files = [...reach(engine.fileName, false)].filter((f) => !loaded.has(f)).map((f) => ["modulepreload", "/" + f]);
    const css = Object.values(bundle).find((f) => f.type === "asset" && /^assets\/maplibre-gl-[\w-]+\.css$/.test(f.fileName));
    if (css) files.push(["preload", "/" + css.fileName, "style"]);
    return files;
  }

  return [
    {
      name: "bemesh:site-pages",
      transformIndexHtml: {
        order: "pre",
        handler(html, ctx) {
          const page = pages.find((p) => ctx.filename.endsWith("/" + p));
          return page ? bundleClassic(joinStyles(html, basename(page, ".html"))) : html;
        },
      },
      resolveId(id, importer) {
        if (STYLES.test(id) && importer) return join(root, basename(id));
      },
      load(id) {
        const page = STYLES.exec(id)?.[1];
        if (page && styles.has(page)) return styles.get(page).map((file) => `@import "./${file}";`).join("\n");
      },
      generateBundle() {
        for (const [fileName, source] of emitted) this.emitFile({ type: "asset", fileName, source });
      },
    },
    {
      // (its own plugin: one plugin has one transformIndexHtml)
      name: "bemesh:site-pages-built",
      transformIndexHtml: {
        order: "post",
        handler(html, ctx) {
          if (!ctx.bundle) return html;
          const out = html.replace(/<link rel="stylesheet"/g, '<link rel="stylesheet" data-bemesh-styles');
          const files = engineFiles(ctx.bundle, ctx.chunk);
          if (!files) return out;
          return {
            html: out,
            tags: [{ tag: "meta", attrs: { name: "bemesh-engine-files", content: JSON.stringify(files) }, injectTo: "head" }],
          };
        },
      },
    },
  ];
}
