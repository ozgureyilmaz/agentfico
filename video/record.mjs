#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const args = new Map(
  process.argv.slice(2).flatMap((item) => {
    const match = item.match(/^--([^=]+)=(.*)$/);
    return match ? [[match[1], match[2]]] : [];
  }),
);
const baseUrl = args.get("base-url") ?? "http://127.0.0.1:18791";
const output = resolve(args.get("out") ?? join(root, "video/out"));
const work = join(root, "video/work");
const transition = 0.35;
const videoWidth = 1920;
const videoHeight = 1080;
const base = new URL(baseUrl);
const localCapture =
  base.protocol === "http:" &&
  ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname);
const hostedCapture =
  base.origin === "https://agentfico-free-demo.onrender.com";
if ((!localCapture && !hostedCapture) || base.username || base.password) {
  throw new Error(
    "Use the local fixture demo or the AgentFICO public demo URL.",
  );
}

mkdirSync(output, { recursive: true });
mkdirSync(work, { recursive: true });

function findPlaywrightEntry() {
  const candidates = [];
  const localEntry = join(root, "node_modules/playwright/index.mjs");
  if (existsSync(localEntry)) candidates.push(localEntry);
  const npxRoot = join(homedir(), ".npm/_npx");
  if (existsSync(npxRoot)) {
    for (const cache of readdirSync(npxRoot)) {
      const entry = join(npxRoot, cache, "node_modules/playwright/index.mjs");
      if (existsSync(entry)) candidates.push(entry);
    }
  }
  const entry = process.env.AFC_PLAYWRIGHT_ENTRY ?? candidates.at(-1);
  if (!entry) {
    throw new Error(
      "Playwright is unavailable. Install it through the repository's browser workflow, then rerun this capture.",
    );
  }
  return entry;
}

const { chromium } = await import(pathToFileURL(findPlaywrightEntry()).href);
let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  const systemChrome =
    process.env.CHROME_EXECUTABLE ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (!existsSync(systemChrome)) throw error;
  browser = await chromium.launch({
    headless: true,
    executablePath: systemChrome,
  });
}
const blockedOrigins = new Set();
const consoleErrors = [];
const segments = [];
const markSvg = readFileSync(join(root, "assets/brand/logo-mark.svg"), "utf8");
const cardUrl = pathToFileURL(join(root, "video/title-card.html"));

const allScenes = [
  {
    name: "hook",
    kind: "card",
    mode: "intro",
    visibleSeconds: 5,
    caption: "Which agents do you trust with your money?",
  },
  {
    name: "problem",
    kind: "card",
    mode: "problem",
    visibleSeconds: 15,
    caption: "A record of behavior, open to inspection.",
  },
  {
    name: "leaderboard",
    kind: "ui",
    route: "/",
    visibleSeconds: 14,
    caption: "Five simulated histories. Scores grounded in observed behavior.",
    ready: async (page) => {
      await page.getByRole("heading", { name: "Agent leaderboard" }).waitFor();
      await page.locator(".agent-row").first().waitFor();
      const top = page.locator(".agent-row").first();
      await scrollTo(
        page,
        page.getByRole("heading", { name: "Agent leaderboard" }),
      );
      await smoothHover(page, top, 900);
      await page.waitForTimeout(900);
      const rows = await page.locator(".agent-row").allTextContents();
      return {
        leaderboard_rows: rows.length,
        first_row: rows[0]?.trim() ?? null,
      };
    },
  },
  {
    name: "agent-report",
    kind: "ui",
    route: "/agents/afc%3Asim%3Aatlas",
    visibleSeconds: 17,
    caption: "Reasons point to source events and independent evaluations.",
    ready: async (page) => {
      await page.getByRole("heading", { name: "Why this score" }).waitFor();
      const section = page.getByRole("heading", { name: "Why this score" });
      await scrollTo(page, section);
      const cards = page.locator(".reason-card");
      await cards.first().waitFor();

      await smoothHover(page, cards.first(), 700);
      const citation = cards.first().locator("a.citation-link").first();
      if (await citation.count()) {
        await scrollTo(page, citation);
        await smoothHover(page, citation, 650);
        await page.mouse.click(...(await centerOf(citation)));
        await page.getByRole("dialog", { name: "Evidence detail" }).waitFor();
        await page.waitForTimeout(2400);
        await page.getByRole("button", { name: "Close event detail" }).click();
      }
      await page.waitForTimeout(700);
      const score =
        (
          await page
            .locator(".gauge-reading strong")
            .first()
            .textContent()
            .catch(() => null)
        )?.trim() ?? null;
      return { reason_cards: await cards.count(), visible_score_text: score };
    },
  },
  {
    name: "phoenix-replay",
    kind: "ui",
    route: "/phoenix-replay",
    visibleSeconds: 17,
    caption:
      "Simulated history replay · recorded Reppo evidence stays separate.",
    ready: async (page) => {
      const slider = page.getByRole("slider");
      await slider.waitFor();
      await scrollTo(page, page.locator(".replay-card"));
      const current = page.locator(".replay-selected-score");
      await current.waitFor();
      await slider.press("Home");
      await slider.press("ArrowRight");
      await page.waitForTimeout(1800);
      const early = (await current.textContent())?.trim() ?? "";
      await smoothHover(page, slider, 900);
      await page.waitForTimeout(450);
      await slider.press("End");
      await page.waitForTimeout(900);
      const latest = (await current.textContent())?.trim() ?? "";
      return { phoenix_early_score: early, phoenix_latest_score: latest };
    },
  },
  {
    name: "nova-fraud-cap",
    kind: "ui",
    route: "/agents/afc%3Asim%3Anova-7",
    visibleSeconds: 15,
    caption: "Detector evidence supports the integrity cap.",
    ready: async (page) => {
      const fraud = page.getByRole("heading", { name: "Fraud review" });
      await fraud.waitFor();
      await scrollTo(page, fraud);
      const transitionText =
        (
          await page.locator(".fraud-review-summary").first().textContent()
        )?.trim() ?? "";
      await smoothHover(page, page.locator(".fraud-review-card"), 800);
      return { nova_transition: transitionText };
    },
  },
  {
    name: "kite-mainnet",
    kind: "ui",
    route: "/score",
    visibleSeconds: 15,
    caption: "Recorded mainnet data · partial explorer coverage.",
    ready: async (page) => {
      const address = "0xD9bee9d8d294b01f716c77B3C5953035A15Ed2d2";
      await page.getByLabel("Public address").fill(address);
      await smoothClick(
        page,
        page.getByRole("button", { name: "Score Kite address" }),
      );
      await page.getByText("MAINNET", { exact: true }).waitFor();
      await page.getByText("PARTIAL COVERAGE", { exact: true }).waitFor();
      const result = page.locator(".kite-result");
      await scrollTo(page, result);
      await smoothHover(page, result, 800);
      const text = (await result.textContent())?.trim() ?? "";
      return { kite_result_text: text.replace(/\s+/g, " ") };
    },
  },
  {
    name: "score-own-log",
    kind: "ui",
    route: "/score",
    visibleSeconds: 14,
    caption: "A provisional score from your own JSONL log.",
    ready: async (page) => {
      await page
        .locator("#event-log-file")
        .setInputFiles(join(root, "examples/assistant-log.jsonl"));
      await smoothClick(
        page,
        page.getByRole("button", { name: /Calculate provisional score/ }),
      );
      const result = page.locator(".upload-result");
      await result.waitFor();
      await scrollTo(page, result);
      await smoothHover(page, result, 750);
      const text = (await result.textContent())?.trim() ?? "";
      return { upload_result_text: text.replace(/\s+/g, " ") };
    },
  },
  {
    name: "serv-trace",
    kind: "ui",
    route: "/serv-trace",
    visibleSeconds: 15,
    caption: "Every SERV attempt leaves a trace with returned metadata.",
    ready: async (page) => {
      await page.getByRole("heading", { name: "SERV trace" }).waitFor();
      const calls = page.locator(".serv-call-list");
      await calls.waitFor();
      const articles = calls.locator("article");
      await articles.first().waitFor();
      const live = articles.filter({ has: page.locator(".status-live") });
      const first = (await live.count()) ? live.first() : articles.first();
      await scrollTo(page, first);
      await smoothHover(page, first, 750);
      const count = await calls.locator("article").count();
      const text = (await first.textContent())?.trim() ?? "";
      return {
        serv_call_count_visible: count,
        first_call_text: text.replace(/\s+/g, " "),
      };
    },
  },
  {
    name: "clickable-reppo-eval",
    kind: "ui",
    route: "/agents/afc%3Asim%3Aphoenix",
    visibleSeconds: 13,
    caption: "Open the cited Reppo result and inspect its stored critique.",
    ready: async (page) => {
      const evalEvidence = page.locator("#reppo-evidence");
      await evalEvidence.waitFor();
      const citation = page.locator(".reason-card a.eval-link").first();
      const disclosure = citation
        .locator("xpath=ancestor::details")
        .locator("summary");
      if (!(await citation.isVisible()) && (await disclosure.count()))
        await smoothClick(page, disclosure);
      await citation.waitFor();
      await scrollTo(page, citation);
      const href = await citation.getAttribute("href");
      await smoothHover(page, citation, 650);
      const idText = (await citation.textContent())?.trim() ?? "";
      await page.mouse.click(...(await centerOf(citation)));
      await page.waitForTimeout(700);
      if (new URL(page.url()).hash !== href)
        throw new Error("Reppo citation did not open its evidence");
      return {
        reppo_citation_text: idText,
        reppo_target: href,
        visible_eval_cards: await page.locator(".eval-card").count(),
      };
    },
  },
  {
    name: "architecture",
    kind: "card",
    mode: "architecture",
    visibleSeconds: 10,
    caption: "Inputs → validated history → deterministic score.",
  },
  {
    name: "why-it-matters",
    kind: "card",
    mode: "why",
    visibleSeconds: 6,
    caption: "Open evidence. A signal people can inspect and question.",
  },
  {
    name: "outro",
    kind: "card",
    mode: "outro",
    visibleSeconds: 8,
    caption: "Built on SERV Reasoning · Reppo track",
  },
];
const storyboard = process.argv.includes("--cards-only")
  ? allScenes.filter((scene) => scene.kind === "card")
  : allScenes;

async function newContext() {
  return browser.newContext({
    viewport: { width: videoWidth, height: videoHeight },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: work,
      size: { width: videoWidth, height: videoHeight },
    },
  });
}

async function setVisualOverlays(page, caption) {
  await page.addStyleTag({
    content: `
      #afc-demo-caption { position:fixed; z-index:2147483646; left:24px; bottom:23px; max-width:min(980px,70vw); padding:10px 17px 9px; color:var(--ink,#0a0d12); background:rgba(244,246,250,.88); border-top:1px solid var(--line,#c8cfe4); font:400 18px/1.25 var(--font-serif,"Iowan Old Style",Georgia,serif); letter-spacing:.002em; box-shadow:0 1px 0 rgba(10,13,18,.03); pointer-events:none; }
      #afc-demo-pointer { position:fixed; z-index:2147483647; top:0; left:0; width:12px; height:12px; border:1.4px solid rgba(10,13,18,.82); border-radius:50%; background:rgba(244,246,250,.74); box-shadow:0 0 0 4px rgba(101,138,195,.16); transform:translate(-50%,-50%); pointer-events:none; transition:transform 35ms linear; }
      #afc-demo-pointer::after { content:""; position:absolute; top:50%; left:50%; width:2px; height:2px; border-radius:50%; background:var(--deep,#304991); transform:translate(-50%,-50%); }
      @media (prefers-reduced-motion:reduce) { #afc-demo-pointer { transition:none; } }
    `,
  });
  await page.evaluate((text) => {
    const caption = document.createElement("div");
    caption.id = "afc-demo-caption";
    caption.textContent = text;
    document.body.append(caption);
    const pointer = document.createElement("div");
    pointer.id = "afc-demo-pointer";
    document.body.append(pointer);
    document.addEventListener(
      "mousemove",
      (event) => {
        pointer.style.left = `${event.clientX}px`;
        pointer.style.top = `${event.clientY}px`;
      },
      { passive: true },
    );
    window.__afcDemoPointer = { x: innerWidth * 0.63, y: innerHeight * 0.4 };
  }, caption);
}

async function smoothMove(page, x, y, durationMs = 800) {
  const from = await page.evaluate(
    () => window.__afcDemoPointer ?? { x: 960, y: 450 },
  );
  const frames = Math.max(1, Math.round(durationMs / 40));
  for (let index = 1; index <= frames; index += 1) {
    const progress = index / frames;
    const eased = 1 - (1 - progress) ** 3;
    const nextX = from.x + (x - from.x) * eased;
    const nextY = from.y + (y - from.y) * eased;
    await page.mouse.move(nextX, nextY);
    await page.evaluate(
      (point) => {
        window.__afcDemoPointer = point;
      },
      { x: nextX, y: nextY },
    );
    await page.waitForTimeout(1000 / 25);
  }
}

async function scrollTo(page, locator) {
  await locator.waitFor();
  await locator.evaluate((element) => {
    const top = window.scrollY + element.getBoundingClientRect().top;
    window.scrollTo({ top: Math.max(0, top - 110), behavior: "smooth" });
  });
  await page.waitForTimeout(900);
}

async function smoothClick(page, locator) {
  await locator.waitFor();
  const box = await locator.boundingBox();
  if (box && (box.y < 90 || box.y + box.height > videoHeight)) {
    await scrollTo(page, locator);
  }
  await smoothMove(page, ...(await centerOf(locator)));
  await locator.click();
}

async function smoothHover(page, locator, durationMs = 800) {
  const box = await locator.boundingBox();
  if (!box) return;
  await smoothMove(
    page,
    box.x + Math.min(box.width * 0.72, 620),
    box.y + Math.min(box.height * 0.52, 32),
    durationMs,
  );
}

async function centerOf(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Cannot click an element outside the viewport");
  return [box.x + box.width / 2, box.y + box.height / 2];
}

async function prepareCard(page, mode) {
  await page.goto(`${cardUrl.href}?mode=${encodeURIComponent(mode)}`, {
    waitUntil: "load",
  });
  if (mode === "intro" || mode === "outro") {
    await page.evaluate((svg) => {
      const slot = document.getElementById("mark-slot");
      if (slot) slot.innerHTML = svg;
    }, markSvg);
  }
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

async function prepareUi(page, scene) {
  const captureOrigin = base.origin;
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      requestUrl.protocol === "data:" ||
      requestUrl.origin === captureOrigin
    ) {
      await route.continue();
    } else {
      blockedOrigins.add(requestUrl.origin);
      await route.abort();
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error")
      consoleErrors.push(`${scene.name}: ${message.text()}`);
  });
  page.on("pageerror", (error) =>
    consoleErrors.push(`${scene.name}: ${error.message}`),
  );
  await page.goto(new URL(scene.route, base).href, {
    waitUntil: "domcontentloaded",
  });
  await setVisualOverlays(page, scene.caption);
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.waitForTimeout(700);
  return scene.ready ? await scene.ready(page) : {};
}

async function saveSegment(scene, metadata) {
  const sourceDuration =
    scene.visibleSeconds + (scene.name === "outro" ? 0 : transition);
  const context = await newContext();
  context.setDefaultTimeout(8000);
  const page = await context.newPage();
  const video = page.video();
  const started = performance.now();
  try {
    if (scene.kind === "card") {
      await page.route("**/*", async (route) => {
        const requestUrl = new URL(route.request().url());
        if (
          requestUrl.protocol === "file:" ||
          requestUrl.protocol === "data:"
        ) {
          await route.continue();
        } else {
          blockedOrigins.add(requestUrl.origin);
          await route.abort();
        }
      });
      page.on("console", (message) => {
        if (message.type() === "error")
          consoleErrors.push(`${scene.name}: ${message.text()}`);
      });
      page.on("pageerror", (error) =>
        consoleErrors.push(`${scene.name}: ${error.message}`),
      );
      await prepareCard(page, scene.mode);
      await page.waitForTimeout(250);
    } else {
      metadata = { ...metadata, ...(await prepareUi(page, scene)) };
    }
    const remaining = Math.max(
      0,
      sourceDuration * 1000 - (performance.now() - started),
    );
    await page.waitForTimeout(remaining);
  } finally {
    await page.close();
    if (video) await video.saveAs(join(work, `${scene.name}.webm`));
    await context.close();
  }
  const record = {
    name: scene.name,
    file: join(work, `${scene.name}.webm`),
    visible_seconds: scene.visibleSeconds,
    source_seconds: sourceDuration,
    caption: scene.caption,
    ...metadata,
  };
  segments.push(record);
  console.log(JSON.stringify({ captured: scene.name, ...record }));
  return record;
}

for (let index = 0; index < storyboard.length; index += 1) {
  const scene = storyboard[index];
  await saveSegment(scene, {});
}

await browser.close();

const manifest = {
  base_url: base.origin,
  viewport: { width: videoWidth, height: videoHeight },
  fps: 30,
  transition_seconds: transition,
  duration_seconds: segments.reduce(
    (sum, segment) => sum + segment.visible_seconds,
    0,
  ),
  blocked_external_origins: [...blockedOrigins],
  console_errors: consoleErrors,
  segments,
};
const manifestPath = join(output, "capture-manifest.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
if (blockedOrigins.size) {
  throw new Error(
    `Unexpected external requests were blocked: ${[...blockedOrigins].join(", ")}`,
  );
}
if (consoleErrors.length) {
  throw new Error(`Browser console errors: ${consoleErrors.join(" | ")}`);
}
