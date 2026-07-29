/**
 * End-to-end verification in the real app. The unit suite mocks the worker hook, so none of the
 * constrained generation path is exercised anywhere else. Drives the PRODUCTION BUILD, not the dev
 * server, so what is checked is what ships.
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://127.0.0.1:4173";

/**
 * Wait for a generation to FINISH, not merely for the results panel to exist. `#metrics` is not a
 * wait at all after the first generation — the panel is still mounted from the previous one, so it
 * returns instantly while the new run is still going and the next step lands on a control still
 * behind `inert`. The overlay detaching is the condition that was always meant.
 */
async function generationSettles(page) {
  await page.waitForSelector("#metrics", { timeout: 15000 });
  await page.waitForSelector(".busy", { state: "detached", timeout: 20000 });
  await page.waitForSelector("#app:not([inert])", { timeout: 20000 });
}

const EXEC = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/**
 * Every panel <main> renders, by the selector the stylesheet places it with. Wrappers are included
 * because a wrapper is what carries the offsets in the middle tier, and a container off-screen
 * takes its contents with it however the contents are styled.
 */
const PANELS = ["#rail", "#toggle", "#rightcol", "#sidecol", "#route", "#person", "#buddies",
  "#search", ".hint", "#metrics"];

/**
 * Where every rendered panel actually lands, in one pass, so a caller can assert against the
 * viewport rather than against the stylesheet's intent. `body` does not scroll (`overflow: hidden`)
 * so anything outside 0..innerWidth is unreachable at any scroll position; vertically the answer
 * depends on the scroll container, which is why each box is also measured after being scrolled to.
 */
async function panelBoxes(pg) {
  return pg.evaluate((sels) => {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    /**
     * The box the element PAINTS: its own, clipped by every ancestor that clips. A scroll
     * container's overflowing content is drawn nowhere outside that container, so an unclipped
     * rect reports a panel as covering things it cannot reach.
     */
    const painted = (el) => {
      let box = el.getBoundingClientRect();
      for (let a = el.parentElement; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
        const r = a.getBoundingClientRect();
        const x = Math.max(box.left, r.left), y = Math.max(box.top, r.top);
        box = new DOMRect(x, y, Math.min(box.right, r.right) - x, Math.min(box.bottom, r.bottom) - y);
      }
      return box;
    };

    const els = sels.map((sel) => [sel, document.querySelector(sel)]).filter(([, el]) => el);
    // Measured BEFORE anything scrolls, so every box shares one scroll state — interleaving the
    // two passes made a panel's box depend on where a previously-checked panel had scrolled to.
    const boxes = new Map(els.map(([sel, el]) => [sel, painted(el)]));

    const restore = [];
    for (const el of document.querySelectorAll("*")) {
      if (el.scrollTop || el.scrollLeft) restore.push([el, el.scrollTop, el.scrollLeft]);
    }
    // Containment covers EVERY panel, including ones currently clipped away: each is scrolled to
    // first, so "clipped at this scroll position" is not an answer to "can it be reached". Skipping
    // them left the phone tier — where <main> scrolls and most panels start below the fold —
    // measuring seven of ten, and the panel this check exists for could have been one of the three.
    const found = [];
    for (const [sel, el] of els) {
      const own = el.getBoundingClientRect();
      if (own.width < 1 || own.height < 1) continue; // renders nothing at all
      const flat = boxes.get(sel);
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      const s = el.getBoundingClientRect();
      found.push({
        sel, flat: { x: flat.x, y: flat.y, w: flat.width, h: flat.height },
        offX: s.left < -1 || s.right > vw + 1 ? `${Math.round(s.left)}..${Math.round(s.right)} of 0..${vw}` : null,
        // A panel taller than the viewport cannot fit in it, and scrolling is the only possible
        // answer for one — so height is only asked about when there was room to succeed.
        offY: s.height <= vh && (s.top < -1 || s.bottom > vh + 1)
          ? `${Math.round(s.top)}..${Math.round(s.bottom)} of 0..${vh}` : null,
      });
    }
    for (const [el, top, left] of restore) { el.scrollTop = top; el.scrollLeft = left; }

    // Ancestors are skipped against their own descendants; every other pair sharing painted area
    // means one panel is covering another, which is how the quality strip hid the hover hint.
    // Only what is on screen at this scroll position is compared — below the fold the layout is
    // pure flow, where boxes cannot overlap in the first place.
    const overlaps = [];
    for (let i = 0; i < found.length; i++) {
      for (let j = i + 1; j < found.length; j++) {
        const a = found[i], b = found[j];
        if (a.flat.w < 1 || a.flat.h < 1 || b.flat.w < 1 || b.flat.h < 1) continue; // paints nothing
        if (document.querySelector(a.sel).contains(document.querySelector(b.sel))) continue;
        const w = Math.min(a.flat.x + a.flat.w, b.flat.x + b.flat.w) - Math.max(a.flat.x, b.flat.x);
        const h = Math.min(a.flat.y + a.flat.h, b.flat.y + b.flat.h) - Math.max(a.flat.y, b.flat.y);
        if (w > 1 && h > 1) overlaps.push(`${a.sel}\u00d7${b.sel} share ${Math.round(w)}\u00d7${Math.round(h)}px`);
      }
    }
    return { found, overlaps };
  }, PANELS);
}

/** One containment/overlap verdict per viewport, named so a failure says which one broke. */
async function checkLayout(pg, label) {
  const { found, overlaps } = await panelBoxes(pg);
  const off = found.filter((f) => f.offX || f.offY)
    .map((f) => `${f.sel} ${f.offX ? `x ${f.offX}` : ""}${f.offY ? ` y ${f.offY}` : ""}`.trim());
  // Non-vacuity: with no panels found, "none are off-screen" is true and means nothing. Nine
  // rather than ten because `#rightcol` generates no box at the widest tier (`display: contents`),
  // where its two children place themselves.
  check(`${label}: every panel is measured`, found.length >= 9, `${found.length} panels`);
  check(`${label}: no panel is placed outside the viewport`, off.length === 0, off.join(" | "));
  check(`${label}: no panel covers another`, overlaps.length === 0, overlaps.join(" | "));
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

const ROSTER = [
  "Alice Nguyen", "Ben Carter", "Chloe Diaz", "Dev Patel",
  "Eve Larsen", "Fran Osei", "Gus Meyer", "Hana Sato",
  "John Smith", "Jo Sanders", "Kai Reyes", "Lena Ford",
];

const browser = await chromium.launch({ executablePath: EXEC });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(BASE, { waitUntil: "networkidle" });

// `inert` cascades with no way for a descendant to opt back in, and the setup dialog opens on load
// — so an inert ancestor makes the whole first paint unreachable while rendering perfectly. jsdom
// does not implement `inert`, so only a real browser can be asked this.
{
  const dialogInert = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return "no dialog";
    for (const el of document.querySelectorAll("[inert]")) if (el.contains(dialog)) return "inert ancestor";
    return "ok";
  });
  check("the setup dialog is not inside an inert ancestor", dialogInert === "ok", dialogInert);

  // Asserted BEFORE anything touches focus: focusing the field first and then checking would prove
  // the field is focusABLE, not that the app ever focuses it. The two checks are not the same
  // claim, and only the first one is about the app.
  const landed = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  check("focus lands in the setup dialog on cold load", landed === "Roster names", landed ?? "(none)");
  const roster = page.getByLabel("Roster names");
  await roster.focus();
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  check("the roster field can actually take focus", focused === "Roster names", focused ?? "(none)");
}

await page.getByLabel("Roster names").fill(ROSTER.join("\n"));
await page.locator(".rules-block > summary").click();
await page.getByText("+ Add a buddy rule").click();
await page.getByLabel("Rule 1, first person").fill("Alice Nguyen");
await page.getByLabel("Rule 1, second person").fill("Lena Ford");
await page.getByText("+ Add a buddy rule").click();
await page.getByLabel("Rule 2, first person").fill("Ben Carter");
await page.getByLabel("Rule 2, second person").fill("Chloe Diaz");
await page.getByLabel("Rule 2, kind").selectOption("prohibited");

await page.getByText("Generate buddy graph").click();
await generationSettles(page);

// `.rules-line` is the class the quality panel uses for EVERY disclosure line, so the locator has
// to name which one; "the first" would silently follow whichever disclosure renders first.
const rulesLine = await page.locator(".rules-line", { hasText: /buddy rule/ }).textContent();
check("constrained generation reports its rules", /all 2 buddy rules satisfied/.test(rulesLine ?? ""), rulesLine ?? "(none)");

const edges = await page.$$eval("line.edge", (ls) => ls.length);
check("a graph was drawn", edges > 0, `${edges} edges`);

await page.getByText("Edit people").click();
await page.locator(".rules-block > summary").click();
for (let i = 3; i <= 7; i++) {
  await page.getByText("+ Add a buddy rule").click();
  await page.getByLabel(`Rule ${i}, first person`).fill("Alice Nguyen");
  await page.getByLabel(`Rule ${i}, second person`).fill(ROSTER[i]);
}
const blocking = await page.locator(".note.blocking").first().textContent();
check("infeasibility names a person, not an index",
  /Alice Nguyen/.test(blocking ?? "") && !/person \d/.test(blocking ?? ""), blocking ?? "(none)");
const disabled = await page.getByText("Generate buddy graph").isDisabled();
check("generate is blocked while infeasible", disabled);

for (let i = 7; i >= 3; i--) await page.getByLabel(`Remove rule ${i}`).click();
await page.getByText("Generate buddy graph").click();
await generationSettles(page);

await page.getByLabel("Find a person").fill("jsmi");
const firstOption = await page.locator('[role="option"]').first().textContent();
check('"jsmi" finds "John Smith"', firstOption === "John Smith", firstOption ?? "(none)");
await page.keyboard.press("Enter");
await page.waitForSelector("#person");
const who = await page.locator("#person h2").textContent();
check("selecting a result opens that person", who === "John Smith", who ?? "(none)");

const firstChip = page.locator("#person .pp-chips .personchip").first();
const chipName = await firstChip.textContent();
await firstChip.click();
const nowWho = await page.locator("#person h2").textContent();
check("every name in the panel is clickable", nowWho === chipName, `${who} -> ${nowWho}`);
await page.getByText("← Back").click();
const backWho = await page.locator("#person h2").textContent();
check("the back stack works", backWho === "John Smith", backWho ?? "(none)");

await page.getByText("Find a path from here").click();
await page.getByLabel("Find a person").fill("lena");
await page.keyboard.press("Enter");
await page.waitForSelector("#route .rt-chain");
const chain = (await page.locator("#route .rt-chain").textContent()) ?? "";
const steps = (await page.locator("#route .rt-steps").textContent()) ?? "";
check("a route is drawn and written out", chain.includes("John Smith") && chain.includes("Lena Ford"), `${chain} (${steps})`);
const routeEdges = await page.$$eval("line.edge.route", (ls) => ls.length);
const hops = Number((steps.match(/(\d+) step/) ?? [])[1]);
check("the lit chain has exactly one edge per step", routeEdges === hops, `${routeEdges} lit vs ${hops} steps`);

// The path widget re-renders the whole graph, so it has to be reachable from the control that
// armed it. It used to sit in the opposite corner of the viewport, which read as nothing having
// happened. Only a browser can answer "is it above" — DOM order alone does not settle it.
{
  const boxes = await page.evaluate(() => {
    const r = document.querySelector("#route")?.getBoundingClientRect();
    const pp = document.querySelector("#person")?.getBoundingClientRect();
    return r && pp ? { routeTop: r.top, personTop: pp.top, dx: Math.abs(r.left - pp.left) } : null;
  });
  check("the path widget renders above the person card", 
    boxes !== null && boxes.routeTop < boxes.personTop && boxes.dx < 2,
    boxes ? `route ${Math.round(boxes.routeTop)} vs person ${Math.round(boxes.personTop)}` : "(missing)");
}

// A MODE, not a two-click gesture: while the toggle is on, picking someone else moves the far end
// of the chain rather than navigating away from it.
{
  await page.getByLabel("Find a person").fill("ben");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#route .rt-chain");
  const retargeted = (await page.locator("#route .rt-chain").textContent()) ?? "";
  check("a later pick re-targets the route instead of leaving the mode",
    retargeted.includes("John Smith") && retargeted.includes("Ben Carter"), retargeted);
  const pressed = await page.getAttribute("#person button[aria-pressed]", "aria-pressed");
  check("the path button reads as pressed while the mode is on", pressed === "true", String(pressed));
  await page.click("#person button[aria-pressed]");
  check("pressing the toggle again leaves the mode", (await page.locator("#route").count()) === 0);
  // Back into the mode for the Escape checks below, which are about clearing a live route.
  await page.click("#person button[aria-pressed]");
  await page.getByLabel("Find a person").fill("lena");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#route .rt-chain");
}

// Run with a route AND a person card open, which is the widest the layout ever gets — and the
// state the reported defect appeared in. A panel placed by an offset measured across a sibling
// (`#sidecol` was `right: 314px`, i.e. the buddy panel's width plus two gaps) goes off the far
// edge the moment the viewport is narrower than the sum, which one viewport can never reveal.
// jsdom computes no layout at all, so this is the only place the question can be asked.
for (const [w, h, label] of [[1400, 900, "desktop"], [1180, 800, "small laptop"],
  [1024, 768, "tablet landscape"], [768, 1024, "tablet portrait"], [390, 844, "phone"]]) {
  await page.setViewportSize({ width: w, height: h });
  await checkLayout(page, `${label} ${w}x${h}`);
}
await page.setViewportSize({ width: 1400, height: 900 });

await page.locator("g.node").first().hover();
const afterHover = await page.$$eval("line.edge.route", (ls) => ls.length);
check("hovering does not destroy the route", afterHover === routeEdges);

await page.keyboard.press("Escape");
check("Escape clears the route", (await page.locator("#route").count()) === 0);
await page.keyboard.press("Escape");
check("a second Escape clears the selection", (await page.locator("#person").count()) === 0);

const download = page.waitForEvent("download");
await page.getByText("Export ↓").click();
const file = await download;
const stream = await file.createReadStream();
let text = "";
for await (const chunk of stream) text += chunk;
const parsed = JSON.parse(text);
check("export carries the rules",
  parsed.constraints.required.length === 1 && parsed.constraints.prohibited.length === 1,
  JSON.stringify(parsed.constraints));

// Removing the focused element moves focus to <body> per spec, so the next Tab restarts at the top
// of the document.
{
  await page.locator(".brow").first().click();
  await page.waitForSelector("#person");
  await page.getByLabel("Close person details").focus();
  await page.getByLabel("Close person details").click();
  const landed = await page.evaluate(() => {
    const a = document.activeElement;
    return a === document.body || !a ? "body" : (a.getAttribute("aria-label") ?? a.tagName);
  });
  check("closing the person panel keeps focus somewhere usable", landed !== "body", landed);
}

// A reroll inerts `#app` around the very button that was pressed, and the UA blurs it. Only a
// browser can settle this: jsdom does not implement inert's focus effects, and the mutation that
// applies `inert` is delivered while focus is still ON the button — the UA blurs it afterwards and
// `inert` is gone by the next mutation, so no observer callback ever sees both.
{
  const reroll = page.getByText("Different arrangement");
  await reroll.focus();
  await reroll.click();
  await generationSettles(page);
  const landed = await page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return "body";
    return a.closest("#app") ? "" : a.tagName;
  });
  check("a reroll leaves focus reachable, not on <body>", landed === "", landed);
}

// A focus rescue that lands in a text field raises the soft keyboard and scrolls the viewport to it
// — invisible on a desktop viewport, hence the touch-enabled context. The oracle is a PROPERTY of
// the focused element, "does it accept typing": jsdom can say where focus went, not that a keyboard
// came up, and no element identity answers it either.
{
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  });
  const mob = await phone.newPage();
  const mobErrors = [];
  mob.on("pageerror", (e) => mobErrors.push(String(e)));
  await mob.goto(BASE, { waitUntil: "networkidle" });

  const typable = () => mob.evaluate(() => {
    const a = document.activeElement;
    if (!a) return "(none)";
    const tag = a.tagName;
    if (tag === "TEXTAREA") return "TEXTAREA";
    if (tag === "INPUT" && /^(text|search|)$/.test(a.type ?? "")) return `INPUT[${a.type}]`;
    return a.isContentEditable ? "contenteditable" : "";
  });

  await mob.getByLabel("Roster names").fill(ROSTER.join("\n"));
  await mob.getByRole("button", { name: /generate/i }).click();
  await generationSettles(mob);
  const afterGenerate = await typable();
  check("phone: creating the graph does not raise the keyboard", afterGenerate === "", afterGenerate);
  // The check above is vacuous alone: focus stranded on <body> is not a text input either, so it
  // passes on a completely broken rescue. This is what makes it mean something.
  const rescued = await mob.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return "body";
    return a.closest("#app") ? "" : a.tagName;
  });
  check("phone: creating the graph leaves focus reachable, not on <body>", rescued === "", rescued);

  // The buddy-list row is the touch-reachable equivalent of tapping a node.
  await mob.locator(".brow").first().tap();
  await mob.waitForSelector("#person");
  const afterSelect = await typable();
  check("phone: selecting a person does not raise the keyboard", afterSelect === "", afterSelect);

  // The canvas is SVG and so not focusable — the gesture that blurs to <body> and makes the rescue
  // think the user's footing was removed.
  await mob.locator("#stage svg").tap({ position: { x: 5, y: 5 } });
  const afterCanvas = await typable();
  check("phone: tapping the canvas does not raise the keyboard", afterCanvas === "", afterCanvas);

  check("phone: no page errors", mobErrors.length === 0, mobErrors.slice(0, 2).join(" | "));
  await phone.close();
}

// Back walks a TRAIL. Jumping to someone the current card does not list has no relation to the
// card behind it, so the trail restarts rather than offering to return to a stranger.
//
// Runs on a REGENERATED k=2 roster, and that is not incidental: at k=4 every one of these twelve
// people is a chip on every card, so there is no stranger to jump to and the check would pass by
// never exercising the rule. A 12-cycle puts seven people out of reach of any card.
{
  await page.getByText("Edit people").click();
  const fewer = page.getByLabel(/^fewer buddies/);
  while (Number(await page.locator(".stepper .val").textContent()) > 2) await fewer.click();
  await page.getByText("Generate buddy graph").click();
  await generationSettles(page);

  await page.getByLabel("Find a person").fill("jsmi");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#person");
  await page.locator("#person .pp-chips .personchip").first().click();
  check("Back is offered after a step along the card", await page.getByText("← Back").isVisible());

  const shown = await page.$$eval("#person .pp-chips .personchip", (bs) => bs.map((b) => b.textContent));
  const here = await page.locator("#person h2").textContent();
  const stranger = ROSTER.find((n) => n !== here && !shown.includes(n));
  if (stranger === undefined) {
    check("a jump off the card starts a new trail", false, "every person is a chip — no stranger exists");
  } else {
    await page.getByLabel("Find a person").fill(stranger);
    await page.keyboard.press("Enter");
    const jumped = await page.locator("#person h2").textContent();
    const stillOffered = await page.getByText("← Back").count();
    check("a jump off the card starts a new trail",
      jumped === stranger && stillOffered === 0, `${jumped}, back x${stillOffered}`);
  }
}

check("no page errors or console errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
