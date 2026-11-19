/**
 * KiNews-Frontend: lädt Quellen, rendert das News-Grid und empfängt
 * neue Artikel über Server-Sent Events (ohne Reload).
 */

/* ---------- Zustand ---------- */
const state = {
  artikel: [],
  quellens: [],
  status: [],
  quelle: "", // "" = alle
  kategorie: "", // "" = alle
  suche: "",
  verbunden: false,
  letzteAktualisierung: null
};

const grid = document.getElementById("newsgrid");
const kategorieLeiste = document.getElementById("kategoriefilter");
const filterLeiste = document.getElementById("quellenfilter");
const statusLeiste = document.getElementById("quellenstatus");
const suchfeld = document.getElementById("suchfeld");
const zaehler = document.getElementById("zähler");

/* ---------- Helfer ---------- */

function quellensuche(id) {
  return state.quellens.find((q) => q.id === id) ?? { name: id, farbe: "#8a93ad" };
}

function sortiereChronologisch(liste) {
  const basis = Array.isArray(liste) ? liste : [];
  return [...basis].sort((a, b) => String(b.zeit ?? "").localeCompare(String(a.zeit ?? "")));
}

function formatiereZeit(iso) {
  if (!iso) return "";
  const datum = new Date(iso);
  if (Number.isNaN(datum.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(datum);
}

function relativZeit(iso) {
  if (!iso) return "";
  const sekunden = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (sekunden < 60) return "gerade eben";
  if (sekunden < 3600) return `vor ${Math.floor(sekunden / 60)} Min.`;
  if (sekunden < 86400) return `vor ${Math.floor(sekunden / 3600)} Std.`;
  return `vor ${Math.floor(sekunden / 86400)} Tag(en)`;
}

/* ---------- Rendering ---------- */

function erstelleKarte(artikel, { neu = false } = {}) {
  const quelle = quellensuche(artikel.quelle);
  const karte = document.createElement("article");
  karte.className = "karte" + (neu ? " neu" : "");
  karte.dataset.id = artikel.id;
  karte.style.setProperty("--quelle-farbe", quelle.farbe);

  // Bild (optional, mit Fehler-Fallback)
  if (artikel.bild) {
    const bildDiv = document.createElement("div");
    bildDiv.className = "karte-bild";
    const img = document.createElement("img");
    img.src = artikel.bild;
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", () => {
      const farbe = quelle.farbe || "#3b5bff";
      bildDiv.innerHTML = "";
      const fallback = document.createElement("div");
      fallback.className = "karte-bild-fallback";
      fallback.style.background = `linear-gradient(135deg, ${farbe}cc, ${farbe}66)`;
      fallback.textContent = "📰";
      bildDiv.appendChild(fallback);
    });
    bildDiv.appendChild(img);
    karte.appendChild(bildDiv);
  }

  const inhalt = document.createElement("div");
  inhalt.className = "karte-inhalt";

  const kopf = document.createElement("div");
  kopf.className = "karte-kopf";
  const badge = document.createElement("span");
  badge.className = "karte-badge";
  const punkt = document.createElement("span");
  punkt.className = "punkt";
  badge.append(punkt, document.createTextNode(quelle.name));
  const zeit = document.createElement("time");
  zeit.className = "karte-zeit";
  zeit.setAttribute("datetime", artikel.zeit ?? "");
  zeit.title = formatiereZeit(artikel.zeit);
  zeit.textContent = relativZeit(artikel.zeit);
  kopf.append(badge, zeit);

  const titel = document.createElement("h3");
  titel.className = "karte-titel";
  const link = document.createElement("a");
  link.href = artikel.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = artikel.titel;
  titel.appendChild(link);

  inhalt.append(kopf, titel);

  if (artikel.beschreibung) {
    const desc = document.createElement("p");
    desc.className = "karte-beschreibung";
    desc.textContent = artikel.beschreibung;
    inhalt.appendChild(desc);
  }

  const mehr = document.createElement("a");
  mehr.className = "karte-link";
  mehr.href = artikel.url;
  mehr.target = "_blank";
  mehr.rel = "noopener noreferrer";
  mehr.textContent = "Zum Original →";
  inhalt.appendChild(mehr);

  karte.appendChild(inhalt);
  return karte;
}

function gefilterteArtikel() {
  let liste = state.artikel;
  if (state.quelle) liste = liste.filter((a) => a.quelle === state.quelle);
  if (state.suche) {
    const begriff = state.suche.toLowerCase();
    liste = liste.filter(
      (a) =>
        a.titel.toLowerCase().includes(begriff) ||
        (a.beschreibung ?? "").toLowerCase().includes(begriff)
    );
  }
  return sortiereChronologisch(liste);
}

function rendertGrid({ neueIds = new Set() } = {}) {
  grid.innerHTML = "";

  const liste = gefilterteArtikel();
  zaehler.textContent = liste.length > 0
    ? `${liste.length} Artikel${state.quelle ? ` von ${quellensuche(state.quelle).name}` : ""}${state.suche ? ` zu „${state.suche}“` : ""}`
    : "";

  if (liste.length === 0) {
    const box = document.createElement("div");
    if (state.artikel.length === 0) {
      box.className = "fehlerzustand";
      box.innerHTML = `<span class="emoji" aria-hidden="true">📡</span>
        <h2>Noch keine Nachrichten verfügbar</h2>
        <p>Der erste Abruf der Quellen läuft – neue Artikel erscheinen hier automatisch.</p>`;
    } else {
      box.className = "leerzustand";
      box.innerHTML = `<span class="emoji" aria-hidden="true">🔍</span>
        <h2>Keine Treffer</h2>
        <p>Für diesen Filter/Suche wurden keine Artikel gefunden.</p>`;
    }
    grid.appendChild(box);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const artikel of liste) {
    fragment.appendChild(erstelleKarte(artikel, { neu: neueIds.has(artikel.id) }));
  }
  grid.appendChild(fragment);
}

function rendertStatus() {
  for (const punkt of statusLeiste.querySelectorAll(".statuspunkt")) {
    const id = punkt.dataset.quelle;
    const eintrag = state.status.find((s) => s.id === id);
    punkt.classList.remove("status-ok", "status-fehler", "status-laden");
    const fehlerText = punkt.querySelector(".status-fehler-text");
    if (fehlerText) fehlerText.remove();

    if (!eintrag) {
      punkt.classList.add("status-laden");
      punkt.title = "Noch nicht geprüft";
      continue;
    }
    if (eintrag.ok) {
      punkt.classList.add("status-ok");
      punkt.title = `${eintrag.artikelGefunden} KI-Artikel gefunden · zuletzt geprüft ${formatiereZeit(eintrag.letztePruefung)}`;
    } else {
      punkt.classList.add("status-fehler");
      punkt.title = eintrag.fehler ?? "Nicht erreichbar";
      const span = document.createElement("span");
      span.className = "status-fehler-text";
      span.textContent = "Fehler";
      punkt.appendChild(span);
    }
  }
}

function rendertAlles({ neueIds = new Set() } = {}) {
  rendertGrid({ neueIds });
  rendertStatus();
}

/* ---------- Filter & Suche ---------- */

function bautFilterChips() {
  filterLeiste.querySelectorAll(".filterchip[data-quelle]:not([data-quelle=''])").forEach((c) => c.remove());
  for (const quelle of state.quellens) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "filterchip";
    chip.dataset.quelle = quelle.id;
    chip.style.setProperty("--chip-farbe", quelle.farbe);
    const punkt = document.createElement("span");
    punkt.className = "punkt";
    chip.append(punkt, document.createTextNode(quelle.name));
    chip.addEventListener("click", () => setzeQuelle(quelle.id));
    filterLeiste.appendChild(chip);
  }
}

function setzeQuelle(id) {
  state.quelle = id === state.quelle ? "" : id;
  filterLeiste.querySelectorAll(".filterchip").forEach((chip) => {
    chip.classList.toggle("aktiv", chip.dataset.quelle === state.quelle);
  });
  rendertGrid();
}

if (kategorieLeiste) {
  kategorieLeiste.querySelectorAll(".filterchip[data-kategorie]").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.kategorie = chip.dataset.kategorie === state.kategorie ? "" : chip.dataset.kategorie;
      kategorieLeiste.querySelectorAll(".filterchip").forEach((c) => {
        c.classList.toggle("aktiv", c.dataset.kategorie === state.kategorie);
      });
      rendertGrid();
    });
  });
}

suchfeld.addEventListener("input", () => {
  state.suche = suchfeld.value.trim();
  rendertGrid();
});

/* ---------- Echtzeit (SSE) ---------- */

function verbinde() {
  const quelle = new EventSource("/api/events");

  quelle.addEventListener("init", (ereignis) => {
    const daten = JSON.parse(ereignis.data);
    state.artikel = daten.artikel ?? [];
    state.status = daten.status ?? [];
    state.verbunden = true;
    state.letzteAktualisierung = new Date();
    rendertAlles();
  });

  quelle.addEventListener("neue_artikel", (ereignis) => {
    const daten = JSON.parse(ereignis.data);
    const einlaufend = daten.artikel ?? [];
    const bekannte = new Set(state.artikel.map((a) => a.id));
    const tatsaechlichNeue = einlaufend.filter((a) => !bekannte.has(a.id));
    if (tatsaechlichNeue.length === 0) return;
    state.artikel.push(...tatsaechlichNeue);
    state.letzteAktualisierung = new Date();
    rendertAlles({ neueIds: new Set(tatsaechlichNeue.map((a) => a.id)) });
  });

  quelle.addEventListener("status", (ereignis) => {
    const daten = JSON.parse(ereignis.data);
    if (Array.isArray(daten.status)) state.status = daten.status;
    rendertStatus();
  });

  quelle.addEventListener("error", () => {
    state.verbunden = false;
    // EventSource verbindet automatisch neu; Hinweis im Zähler zeigen.
    zaehler.textContent = "Verbindung verloren – verbinde neu …";
  });
}

/* ---------- Start ---------- */

async function starte() {
  try {
    const antwort = await fetch("/api/quellen");
    const daten = await antwort.json();
    state.quellens = daten.quellens ?? [];
  } catch {
    state.quellens = [];
  }
  bautFilterChips();
  rendertAlles();
  verbinde();
}

starte();
