// Läuft die ECHTE frontend/app.js gegen den Live-Server und prüft zuverlässig,
// dass Karten ins Grid gerendert werden (das Abnahmekriterium, das der Fehler
// zuvor brach). Kein CSS-Selector-Parser nötig – die Stubs decken genau die
// Aufrufe ab, die app.js verwendet.
import { readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3229";

/* ---------- Minimaler Element-Stub ---------- */
function makeEl(tag) {
  const el = {
    _tag: tag,
    _classes: [],
    _children: [],
    _text: "",
    dataset: {},
    attrs: {},
    _listeners: {},
    _innerHTML: "",
    style: { setProperty(k, v) { (el.style._v ||= {})[k] = v; } },
    classList: {
      add: (...c) => { c.forEach((x) => !el._classes.includes(x) && el._classes.push(x)); },
      remove: (...c) => { el._classes = el._classes.filter((x) => !c.includes(x)); },
      contains: (c) => el._classes.includes(c),
      toggle: (c, force) => {
        const has = el._classes.includes(c);
        const want = force === undefined ? !has : force;
        want ? !has && el._classes.push(c) : has && (el._classes = el._classes.filter((x) => x !== c));
      }
    },
    appendChild(child) { el._children.push(child); child.parentNode = el; return child; },
    append(...items) { items.forEach((i) => i && i.nodeType !== 3 && el.appendChild(i)); },
    remove() { const p = el.parentNode; if (p) { const i = p._children.indexOf(el); i >= 0 && p._children.splice(i, 1); } },
    addEventListener(t, cb) { (el._listeners[t] ||= []).push(cb); },
    // querySelectorAll: deckt die in app.js genutzten Selektoren ab
    querySelectorAll(sel) {
      if (sel === ".statuspunkt") return statusLeiste._children.filter((c) => c._classes.includes("statuspunkt"));
      if (sel === ".filterchip[data-quelle]") return filterLeiste._children.filter((c) => c._classes.includes("filterchip") && "data-quelle" in c.dataset);
      if (sel === ".filterchip") return filterLeiste._children.filter((c) => c._classes.includes("filterchip"));
      return [];
    },
    querySelector(sel) { return el.querySelectorAll(sel)[0] || null; }
  };
  Object.defineProperty(el, "className", {
    get: () => el._classes.join(" "),
    set: (v) => { el._classes = String(v).split(" ").filter(Boolean); }
  });
  Object.defineProperty(el, "children", { get: () => el._children });
  Object.defineProperty(el, "textContent", {
    get: () => el._text || el._children.map((c) => c.textContent ?? "").join(""),
    set: (v) => { el._text = String(v); el._innerHTML = ""; }
  });
  Object.defineProperty(el, "innerHTML", {
    get: () => el._innerHTML,
    set: (v) => { el._innerHTML = String(v); el._children = []; }
  });
  return el;
}

const statusLeiste = makeEl("ul");
statusLeiste._classes.push("statusleiste");
for (const q of ["theverge", "techcrunch", "arstechnica", "venturebeat", "mittr"]) {
  const li = makeEl("li");
  li._classes.push("statuspunkt", "status-laden");
  li.dataset["quelle"] = q;
  li._text = "Quelle";
  statusLeiste.appendChild(li);
}
const filterLeiste = makeEl("div");
filterLeiste._classes.push("filterleiste");
const alleChip = makeEl("button");
alleChip._classes.push("filterchip", "aktiv");
alleChip.dataset["quelle"] = "";
filterLeiste.appendChild(alleChip);

const grid = makeEl("section");
grid._classes.push("newsgrid");
const suchfeld = makeEl("input");
const zaehler = makeEl("p");
const byId = {
  newsgrid: grid,
  quellenfilter: filterLeiste,
  quellenstatus: statusLeiste,
  suchfeld,
  "zähler": zaehler
};

global.document = {
  getElementById: (id) => byId[id] || null,
  createElement: (tag) => makeEl(tag),
  createTextNode: (t) => ({ nodeType: 3, textContent: t }),
  createDocumentFragment: () => {
    const frag = { nodeType: 11, _children: [], appendChild(c) { frag._children.push(c); return c; }, get children() { return frag._children; } };
    return frag;
  }
};
global.window = global;

/* ---------- EventSource gegen Live-Server ---------- */
class FakeEventSource {
  constructor(url) {
    this._l = {};
    this.readyState = 0;
    this._run(url);
  }
  addEventListener(t, cb) { (this._l[t] ||= []).push(cb); }
  close() { this._closed = true; }
  async _run(url) {
    try {
      const res = await fetch(new URL(url, BASE).href);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", init = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) !== -1) {
          const roh = buf.slice(0, i); buf = buf.slice(i + 2);
          let t = "message"; const d = [];
          for (const ln of roh.split("\n")) {
            if (ln.startsWith("event: ")) t = ln.slice(7).trim();
            else if (ln.startsWith("data: ")) d.push(ln.slice(6));
          }
          if (d.length) {
            (this._l[t] || []).forEach((cb) => cb({ data: d.join("\n") }));
            if (t === "init") init = true;
          }
        }
        if (init) break;
      }
      await new Promise((r) => setTimeout(r, 400));
      this.close();
      try { reader.cancel(); } catch {}
      global.__sseDone = true;
    } catch (e) {
      global.__sseError = String(e);
    }
  }
}
global.EventSource = FakeEventSource;
global.fetch = (u, o) => fetch(new URL(u, BASE).href, o);

/* ---------- Echte app.js laden und ausführen ---------- */
const code = readFileSync(new URL("../frontend/app.js", import.meta.url), "utf8");
await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));

// Warten bis init verarbeitet wurde.
for (let k = 0; k < 40 && !global.__sseDone && !global.__sseError; k++) {
  await new Promise((r) => setTimeout(r, 200));
}

/* ---------- Prüfung ---------- */
const karten = grid._children.filter((c) => c._classes.includes("karte"));
const placeholder = grid._children.find((c) => c._classes.includes("fehlerzustand") || c._classes.includes("leerzustand"));

console.log("SSE init empfangen:", global.__sseDone === true);
console.log("Renderte Karten:", karten.length);
console.log("Placeholder:", placeholder ? placeholder._classes.filter((c) => c !== "karte").join(" ") || "(none)" : "(keine)");
console.log("Zähler-Text:", JSON.stringify(zaehler.textContent));

// Erste Karte: Titel, Quelle, Zeit, Link prüfen
let ok = global.__sseDone === true && karten.length >= 1;
if (karten.length > 0) {
  const k = karten[0];
  const h3 = k.querySelector("h3");
  const link = h3 ? h3._children[0] : null;
  const titel = link?.textContent ?? "";
  const url = link?.attrs?.href ?? link?.href ?? "";
  const timeEl = k.querySelector ? null : null;
  // time-Element: in inhalt (kind of k) suchen
  const inhalt = k._children.find((c) => c._classes.includes("karte-inhalt"));
  const kopf = inhalt?.querySelector ? inhalt : null;
  const zeitEl = inhalt ? inhalt._children[0] : null; // kopf
  const time = zeitEl ? zeitEl._children.find((c) => c._tag === "time") : null;
  const zeit = time?.attrs?.dateTime ?? time?._text ?? "";
  const badge = zeitEl ? zeitEl._children.find((c) => c._classes.includes("karte-badge")) : null;
  const quelle = badge?.textContent ?? "";
  console.log("Titel:", titel);
  console.log("Quelle:", quelle, "| Zeit:", zeit, "| Link:", url);
  ok = ok && !!titel && !!quelle && !!zeit && /^https?:/.test(url);
  // Sortierung: zeiten absteigend
  const zeiten = karten.map((c) => {
    const i = c._children.find((x) => x._classes.includes("karte-inhalt"));
    const k2 = i ? i._children[0] : null;
    const t = k2 ? k2._children.find((x) => x._tag === "time") : null;
    return t ? t.attrs?.dateTime ?? "" : "";
  });
  let sortiert = true;
  for (let i = 1; i < zeiten.length; i++) if (zeiten[i - 1] < zeiten[i]) sortiert = false;
  console.log("Chronologisch absteigend:", sortiert);
  ok = ok && sortiert;
}

// Status-Anzeige: kein status-laden mehr bei ok-Quellen
const laden = statusLeiste._children.filter((c) => c.classList.contains("status-laden")).length;
const sOk = statusLeiste._children.filter((c) => c.classList.contains("status-ok")).length;
const sErr = statusLeiste._children.filter((c) => c.classList.contains("status-fehler")).length;
console.log(`Status: ok=${sOk} fehler=${sErr} laden=${laden}`);

// Filterchips: 1 (Alle) + 5 Quellen = 6
const chips = filterLeiste._children.filter((c) => c._classes.includes("filterchip")).length;
console.log("Filterchips:", chips);
ok = ok && chips === 6;

console.log(ok ? "\n=== DOM-PRÜFUNG OK: Karten werden gerendert ===" : "\n=== DOM-PRÜFUNG SCHOITIG ===");
process.exit(ok ? 0 : 1);
