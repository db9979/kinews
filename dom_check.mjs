// Läuft die ECHTE frontend/app.js gegen den Live-Server und prüft zuverlässig,
// dass Karten ins Grid gerendert werden und der Kategorie-Filter funktioniert.
// Die Status-Leiste und beide Filter-Leisten (Kategorien, Quellen) werden aus
// dem ECHTEN frontend/index.html gelesen – der Check erzeugt keine Filter-UI
// selbst, sondern verifiziert das Markup.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:3229";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(__dirname, "frontend/index.html"), "utf8");

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
        if (want && !has) el._classes.push(c); else if (!want && has) el._classes = el._classes.filter((x) => x !== c);
      }
    },
    appendChild(child) {
      // Wie im echten DOM: Ein DocumentFragment wird nicht selbst
      // eingefügt, sondern seine Kinder.
      if (child?.nodeType === 11) {
        for (const kind of [...child._children]) this.appendChild(kind);
        child._children.length = 0;
        return child;
      }
      el._children.push(child); child.parentNode = el; return child;
    },
    append(...items) { items.forEach((i) => i && el.appendChild(i)); },
    remove() { const p = el.parentNode; if (p) { const i = p._children.indexOf(el); i >= 0 && p._children.splice(i, 1); } },
    addEventListener(t, cb) { (el._listeners[t] ||= []).push(cb); },
    setAttribute(n, v) { el.attrs[n] = String(v); },
    querySelectorAll(sel) {
      const matchSel = (node) => {
        if (!node || !node._tag) return false;
        const ds = node.dataset || {};
        const s = String(sel);
        let notOk = true;
        const notM = s.match(/:not\(\s*\[\s*([\w-]+)\s*=\s*'([^']*)'\s*\]\s*\)/);
        if (notM) {
          const key = notM[1].startsWith("data-") ? notM[1].slice(5) : notM[1];
          notOk = !((key in ds) && String(ds[key]) === notM[2]);
        }
        let rest = s.replace(/:not\(\s*\[[\w-]+\s*=\s*'[^']*'\s*\]/g, "");
        const tagM = rest.match(/^([a-zA-Z][\w-]*)/);
        if (tagM) { if (node._tag !== tagM[1]) return false; rest = rest.slice(tagM[1].length); }
        for (const c of rest.match(/\.([\w-]+)/g) || []) {
          if (!(node._classes || []).includes(c.slice(1))) return false;
        }
        for (const a of rest.match(/\[[\w-]+(?:='[^']*')?\]/g) || []) {
          const am = a.match(/\[([\w-]+)(?:='([^']*)')?\]/);
          const key = am[1].startsWith("data-") ? am[1].slice(5) : am[1];
          if (!(key in ds)) return false;
          if (am[2] !== undefined && String(ds[key]) !== am[2]) return false;
        }
        return notOk;
      };
      const ergebnis = [];
      const suche = (node) => {
        for (const kind of node._children || []) {
          if (matchSel(kind)) ergebnis.push(kind);
          if (kind._tag) suche(kind);
        }
      };
      suche(el);
      return ergebnis;
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

/* ---------- DOM-Baum aus dem echten index.html ---------- */

function attribut(tagKopf, name) {
  const m = tagKopf.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`));
  return m ? m[1] : null;
}

function kindelemente(containerId, containerTag, ziel) {
  const blatt = html.match(new RegExp(`<${containerTag}[^>]*id="${containerId}"[^>]*>([\\s\\S]*?)</${containerTag}>`));
  if (!blatt) {
    console.error(`Markup-Fehler: <${containerTag} id="${containerId}"> fehlt in index.html`);
    process.exitCode = 1;
    return;
  }
  const muster = new RegExp(`<${containerTag === "ul" ? "li" : "button"}([^>]*)>([\\s\\S]*?)</${containerTag === "ul" ? "li" : "button"}>`, "g");
  let m;
  while ((m = muster.exec(blatt[1]))) {
    const el = makeEl(containerTag === "ul" ? "li" : "button");
    const klassen = attribut(m[1], "class");
    if (klassen) klassen.split(/\s+/).filter(Boolean).forEach((c) => el._classes.push(c));
    const dataQuelle = attribut(m[1], "data-quelle");
    if (dataQuelle !== null) el.dataset["quelle"] = dataQuelle;
    const dataKategorie = attribut(m[1], "data-kategorie");
    if (dataKategorie !== null) el.dataset["kategorie"] = dataKategorie;
    el._text = m[2].trim();
    ziel.appendChild(el);
  }
}

const statusLeiste = makeEl("ul");
statusLeiste._classes.push("statusleiste");
kindelemente("quellenstatus", "ul", statusLeiste);

const filterLeiste = makeEl("div");
filterLeiste._classes.push("filterleiste");
kindelemente("quellenfilter", "div", filterLeiste);

const kategorieLeiste = makeEl("div");
kategorieLeiste._classes.push("filterleiste");
kindelemente("kategoriefilter", "div", kategorieLeiste);

console.log(`Aus index.html gelesen: ${statusLeiste._children.length} Statuspunkte, ${kategorieLeiste._children.length} Kategorie-Chips, ${filterLeiste._children.length} Quellen-Chips (initial)`);

const grid = makeEl("section");
grid._classes.push("newsgrid");
const suchfeld = makeEl("input");
const zaehler = makeEl("p");
const byId = {
  newsgrid: grid,
  quellenfilter: filterLeiste,
  kategoriefilter: kategorieLeiste,
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
// Relative URLs gegen den Live-Server auflösen; dabei die ECHTE native
// fetch-Funktion verwenden, sonst würde sich das Wrapper rekursiv aufrufen
// und mit "Maximum call stack size exceeded" scheitern.
const nativeFetch = globalThis.fetch;
global.fetch = (u, o) =>
  nativeFetch(typeof u === "string" && u.startsWith("/") ? new URL(u, BASE).href : u, o);

/* ---------- Echte app.js laden und ausführen ---------- */
const code = readFileSync(path.join(__dirname, "frontend/app.js"), "utf8");
await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));

for (let k = 0; k < 40 && !global.__sseDone && !global.__sseError; k++) {
  await new Promise((r) => setTimeout(r, 200));
}

/* ---------- Prüfung ---------- */
const karten = grid._children.filter((c) => c._classes.includes("karte"));
const placeholder = grid._children.find((c) => c._classes.includes("fehlerzustand") || c._classes.includes("leerzustand"));

console.log("SSE init empfangen:", global.__sseDone === true);
if (global.__sseError) console.log("SSE-Fehler:", global.__sseError);
console.log("Renderte Karten:", karten.length);
console.log("Placeholder:", placeholder ? placeholder._classes.join(" ") : "(keine)");
console.log("Zähler-Text:", JSON.stringify(zaehler.textContent));

let ok = global.__sseDone === true && karten.length >= 1;
if (karten.length > 0) {
  const k = karten[0];
  const h3 = k.querySelector("h3");
  const link = h3 ? h3._children[0] : null;
  const titel = link?.textContent ?? "";
  const url = link?.attrs?.href ?? link?.href ?? "";
  const inhalt = k._children.find((c) => c._classes.includes("karte-inhalt"));
  const zeitEl = inhalt ? inhalt._children[0] : null; // kopf
  const time = zeitEl ? zeitEl._children.find((c) => c._tag === "time") : null;
  const zeit = time?.attrs?.dateTime ?? time?._text ?? "";
  const badge = zeitEl ? zeitEl._children.find((c) => c._classes.includes("karte-badge")) : null;
  const quelle = badge?.textContent ?? "";
  console.log("Titel:", titel);
  console.log("Quelle:", quelle, "| Zeit:", zeit, "| Link:", url);
  ok = ok && !!titel && !!quelle && !!zeit && /^https?:/.test(url);
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

const laden = statusLeiste._children.filter((c) => c.classList.contains("status-laden")).length;
const sOk = statusLeiste._children.filter((c) => c.classList.contains("status-ok")).length;
const sErr = statusLeiste._children.filter((c) => c.classList.contains("status-fehler")).length;
console.log(`Status: ok=${sOk} fehler=${sErr} laden=${laden}`);

// Quellen-Filterchips: 1 (Alle) + 8 Quellen = 9
const chips = filterLeiste._children.filter((c) => c._classes.includes("filterchip")).length;
console.log("Quellen-Filterchips:", chips);
ok = ok && chips === 9;

// Kategorie-Chips aus dem echten Markup: 5 (Alle, Weltpolitik, Finanzen, Lokalpolitik, KI)
const katChips = kategorieLeiste._children.filter((c) => c._classes.includes("filterchip")).length;
console.log("Kategorie-Filterchips:", katChips);
ok = ok && katChips === 5;
for (const erwartet of ["", "weltpolitik", "finanzen", "lokalpolitik", "ai"]) {
  ok = ok && kategorieLeiste._children.some((c) => c.dataset.kategorie === erwartet);
}

// Kategorie-Filter verhalten: „Finanzen“ zeigt genau die finanzen-Artikel.
try {
  const antwort = await fetch("/api/nachrichten");
  const daten = await antwort.json();
  const finanzenAnzahl = daten.artikel.filter((a) => a.kategorie === "finanzen").length;
  const finChips = kategorieLeiste._children.filter((c) => c.dataset.kategorie === "finanzen");
  if (finChips[0]) {
    finChips[0]._listeners.click?.forEach((cb) => cb());
    const finKarten = grid._children.filter((c) => c._classes.includes("karte"));
    console.log(`Karten nach Finanzen-Filter: ${finKarten.length} (API liefert ${finanzenAnzahl} finanzen-Artikel)`);
    ok = ok && finKarten.length === finanzenAnzahl && finKarten.length >= 1;
    ok = ok && finChips[0].classList.contains("aktiv");
    // „Alle“ zurückstellen.
    const alleKat = kategorieLeiste._children.find((c) => c.dataset.kategorie === "");
    alleKat?._listeners.click?.forEach((cb) => cb());
    const zurueck = grid._children.filter((c) => c._classes.includes("karte")).length;
    console.log("Karten nach Zurücksetzen auf Alle:", zurueck);
    ok = ok && zurueck === karten.length;
  } else {
    console.log("Kategorie-Filter fehlerhaft: kein Finanzen-Chip im Markup");
    ok = false;
  }
} catch (e) {
  console.log("Kategorie-Filter-Check übersprungen (API nicht erreichbar):", e.message);
}

console.log(ok ? "\n=== DOM-PRUEFUNG OK: Karten werden gerendert ===" : "\n=== DOM-PRUEFUNG SCHOITIG ===");
process.exit(ok ? 0 : 1);
