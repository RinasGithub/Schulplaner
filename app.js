/* Schulplaner – Handy-App. Liest Wochenpakete (JSON aus der Datenbank), speichert alle Eintragungen
   nur auf diesem Gerät (localStorage) und gibt sie als Rückmeldung-Datei zurück. Kein Server. */
"use strict";
const APP_VERSION = "0.3.1";
const SCHLUESSEL = "schulplaner";
const TAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const ZEITEN = { B: "Bahnfahrt", F: "Vormittag", N: "Nachmittag", A: "Abend", W: "Wochenende" };
const STAND = ["–", "¼", "½", "¾", "✓"];
const UEBEN_IDEEN = ["Aufgaben im Buch", "Online-Übung", "Karteikarten", "Selbsttest (abdecken)", "aus dem Kopf aufschreiben oder zeichnen", "mit Lösung vergleichen"];
const URSACHEN = ["Methode", "Menge", "Zeitpunkt", "Ort", "Fokus"];

// ---------------------------------------------------------------- Zustand
let Z = laden();
let ansicht = { seite: "heute", fach: null };

function laden() {
  let z = null;
  try { z = JSON.parse(localStorage.getItem(SCHLUESSEL)); } catch (e) { /* leer oder gesperrt */ }
  return Object.assign({ pakete: {}, woche: null, e: {}, theme: null }, z || {});
}
function speichern() {
  try { localStorage.setItem(SCHLUESSEL, JSON.stringify(Z)); } catch (e) { /* privater Modus */ }
}
const paket = () => Z.pakete[Z.woche] || null;
function eintraege() {                                  // Eintragungen der aktuellen Woche
  const w = Z.woche;
  if (!Z.e[w]) Z.e[w] = { mat: {}, fach: {}, retro: {}, termine: {} };
  return Z.e[w];
}
function eFach(name) {
  const e = eintraege();
  if (!e.fach[name]) e.fach[name] = { ueben: [], frei: {} };
  return e.fach[name];
}
function eMat(id) {
  const e = eintraege();
  if (!e.mat[id]) e.mat[id] = { stand: 0 };
  return e.mat[id];
}

// ---------------------------------------------------------------- Helfer
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const datum = (iso) => new Date(iso + "T12:00:00");
const kurzDatum = (iso) => { const d = datum(iso); return TAGE[(d.getDay() + 6) % 7] + " " + d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }); };
const heuteTag = () => TAGE[(new Date().getDay() + 6) % 7];
const heuteIso = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const pflicht = (f) => f.Aufgaben.filter((a) => a.KernVertiefung === "Kern");
const freiwillig = (f) => f.Aufgaben.filter((a) => a.KernVertiefung !== "Kern");
const vorschlaege = (f, art) => f.Vorschlaege.filter((v) => v.Art === art);
const kurzQuelle = (s) => { s = (s || "").split(" (")[0]; return s.length > 38 ? s.slice(0, 37) + "…" : s; };

function fortschritt(f) {                               // Anteil der Pflichtaufgaben, gestrichene zählen nicht
  const liste = pflicht(f).filter((a) => !eMat(a.MaterialID).weg);
  if (!liste.length) return { fertig: 0, anzahl: 0, anteil: 0 };
  const summe = liste.reduce((s, a) => s + (eMat(a.MaterialID).stand || 0) / 4, 0);
  return { fertig: liste.filter((a) => eMat(a.MaterialID).stand === 4).length, anzahl: liste.length, anteil: summe / liste.length };
}

// ---------------------------------------------------------------- Bausteine
const chips = (aktion, werte, aktiv, extra = "") => `<div class="chips" role="group">` + werte.map((w, i) => {
  const [wert, text] = Array.isArray(w) ? w : [i, w];
  return `<button class="chip" data-a="${aktion}" data-w="${esc(wert)}" ${extra} aria-pressed="${String(aktiv) === String(wert)}">${esc(text)}</button>`;
}).join("") + `</div>`;
const auswahl = (aktion, optionen, aktiv, leer, extra = "") => `<select data-a="${aktion}" ${extra} aria-label="${esc(leer)}"><option value="">${esc(leer)}</option>` +
  optionen.map(([w, t]) => `<option value="${esc(w)}" ${String(aktiv) === String(w) ? "selected" : ""}>${esc(t)}</option>`).join("") + `</select>`;
const feld = (aktion, wert, platz, extra = "", typ = "text") => `<input type="${typ}" data-a="${aktion}" ${extra} value="${esc(wert)}" placeholder="${esc(platz)}" aria-label="${esc(platz)}">`;
const text = (aktion, wert, platz, extra = "") => `<textarea data-a="${aktion}" ${extra} placeholder="${esc(platz)}" aria-label="${esc(platz)}">${esc(wert)}</textarea>`;
const tagOptionen = TAGE.map((t) => [t, t]);
const zeitOptionen = Object.entries(ZEITEN);

function aufgabeKarte(f, a, mitFach) {
  const m = eMat(a.MaterialID), id = `data-id="${a.MaterialID}"`;
  const meta = [kurzQuelle(a.Quelle), a.Fundstelle, a.Minuten ? a.Minuten + " Min." : "bei Bedarf"].filter(Boolean).join(" · ");
  return `<div class="karte ${m.stand === 4 ? "fertig" : ""} ${m.weg ? "weg" : ""}" style="--farbe:${esc(f.Farbe)}">
    ${mitFach ? `<span class="fachname">${esc(f.Fach)}</span>` : ""}
    <div class="titel">${esc(a.Titel)}</div>
    <div class="meta">${esc(meta)}</div>
    <p>${esc(a.Anweisung)}</p>
    ${m.weg ? `<p class="leise">Lasse ich weg.</p>` : `<div class="zeile"><span class="leise">Wie weit?</span>${chips("stand", STAND, m.stand || 0, id)}</div>
    <div class="zwei" style="margin-top:8px">${auswahl("tag", tagOptionen, m.tag, "Tag", id)}${auswahl("zeit", zeitOptionen, m.zeit, "Zeitraum", id)}</div>`}
    <div class="zeile">
      ${a.URL ? `<a class="knopf" href="${esc(a.URL)}" target="_blank" rel="noopener">Öffnen</a>` : ""}
      <button class="chip" data-a="weg" ${id} aria-pressed="${!!m.weg}">lasse ich weg</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- Seiten
function seiteHeute() {
  const p = paket();
  if (!p) return ohnePaket();
  const tag = heuteTag(), heute = heuteIso();
  let h = "";
  const inWoche = heute >= p.Woche.StartDatum && heute <= p.Woche.EndDatum;
  if (!inWoche) h += `<div class="hinweis">Geladen ist ${esc(p.Woche.WocheID)} (${kurzDatum(p.Woche.StartDatum)} bis ${kurzDatum(p.Woche.EndDatum)}). Heute liegt nicht in dieser Woche.</div>`;
  if (p.Plan.PruefungAb) {
    const tage = Math.ceil((datum(p.Plan.PruefungAb) - new Date()) / 86400000);
    if (tage >= 0) h += `<p class="leise">Noch ${tage} Tage bis zur ersten Prüfung.</p>`;
  }
  const termine = p.Termine.filter((t) => t.Datum === heute);
  if (termine.length) h += `<h2>Termine heute</h2>` + termine.map((t) => `<div class="karte"><div class="titel">${esc(t.Art)}: ${esc(t.FachID)}${t.PersonName ? " mit " + esc(t.PersonName) : ""}</div><div class="meta">${esc(t.Zeitraum)}${t.Status ? " · " + esc(t.Status) : ""}</div></div>`).join("");

  let geplant = "", offen = 0;
  for (const f of p.Faecher) {
    for (const a of pflicht(f)) {
      const m = eMat(a.MaterialID);
      if (m.weg) continue;
      if (m.tag === tag) geplant += aufgabeKarte(f, a, true);
      else if (!m.tag && m.stand !== 4) offen++;
    }
    eFach(f.Fach).ueben.forEach((u, i) => { if (u.tag === tag) geplant += uebenKarte(f, u, i, true); });
  }
  h += `<h2>Heute (${tag})</h2>` + (geplant || `<p class="leise">Für heute ist nichts eingeplant.</p>`);
  if (offen) h += `<div class="hinweis">${offen} Pflichtaufgaben haben noch keinen Tag. <button class="link" data-a="seite" data-w="woche">Zur Woche</button></div>`;
  return h;
}

function seiteWoche() {
  const p = paket();
  if (!p) return ohnePaket();
  const wochen = Object.keys(Z.pakete).sort((a, b) => Z.pakete[a].Woche.Reihenfolge - Z.pakete[b].Woche.Reihenfolge);
  let h = `<div class="weiter">${wochen.length > 1 ? auswahl("woche", wochen.map((w) => [w, w + " · ab " + kurzDatum(Z.pakete[w].Woche.StartDatum)]), Z.woche, "Woche wählen") : `<p class="leise">${esc(p.Woche.Art)}</p>`}</div>`;
  for (const f of p.Faecher) {
    const fs = fortschritt(f), e = eFach(f.Fach), t = f.Termin;
    h += `<div class="karte fach" style="--farbe:${esc(f.Farbe)}">
      <span class="fachname">${esc(f.Fach)}</span>
      <div class="titel">${esc(f.Thema)}</div>
      <div class="meta">Paket: ${esc(f.Paket || "–")}${f.PaketSpaetestensBis ? " · bis " + kurzDatum(f.PaketSpaetestensBis) : ""}</div>
      <div class="balken"><span style="width:${Math.round(fs.anteil * 100)}%"></span></div>
      <p class="leise">Aufnehmen ${fs.fertig} von ${fs.anzahl} fertig · Üben ${e.ueben.length} geplant · Start-Check ${e.einstufung ? esc(e.einstufung) : "offen"}</p>
      ${t ? `<p class="leise">Zeig-Termin: ${kurzDatum(t.Datum)} ${esc(t.Zeitraum)}${t.PersonName ? " mit " + esc(t.PersonName) : ""}</p>` : ""}
      <button class="knopf haupt voll" data-a="fach" data-w="${esc(f.Fach)}">Öffnen</button>
    </div>`;
  }
  return h;
}

function uebenKarte(f, u, i, mitFach) {
  const x = `data-fach="${esc(f.Fach)}" data-i="${i}"`;
  return `<div class="karte ${u.stand === 4 ? "fertig" : ""}" style="--farbe:${esc(f.Farbe)}">
    ${mitFach ? `<span class="fachname">${esc(f.Fach)} · Üben</span>` : ""}
    ${feld("u-was", u.was || "", "Was übe ich? (Seite, Aufgaben)", x)}
    <div class="zwei" style="margin-top:8px">${auswahl("u-wie", UEBEN_IDEEN.map((w) => [w, w]), u.wie, "Wie?", x)}${auswahl("u-tag", tagOptionen, u.tag, "Tag", x)}</div>
    <div class="zeile"><span class="leise">Wie weit?</span>${chips("u-stand", STAND, u.stand || 0, x)}<button class="chip" data-a="u-weg" ${x}>entfernen</button></div>
  </div>`;
}

function seiteFach() {
  const p = paket(), f = p && p.Faecher.find((x) => x.Fach === ansicht.fach);
  if (!f) { ansicht.seite = "woche"; return seiteWoche(); }
  const e = eFach(f.Fach), x = `data-fach="${esc(f.Fach)}"`, t = f.Termin;
  let h = `<button class="link" data-a="seite" data-w="woche">‹ Zur Woche</button>
    <div class="karte fach" style="--farbe:${esc(f.Farbe)}">
      <span class="fachname">${esc(f.Fach)}</span><div class="titel">${esc(f.Thema)}</div>
      <p><strong>Ziel:</strong> ${esc(f.Lernziel)}</p>
      <p class="leise">Paket: ${esc(f.Paket || "–")}${f.PaketErsteWoche ? ` (${esc(f.PaketErsteWoche)}${f.PaketLetzteWoche !== f.PaketErsteWoche ? " bis " + esc(f.PaketLetzteWoche) : ""})` : ""}${f.PaketSpaetestensBis ? " · spätestens bis " + kurzDatum(f.PaketSpaetestensBis) : ""}</p>
      <p><strong>Zeig-Termin:</strong> ${t ? `${kurzDatum(t.Datum)} ${esc(t.Zeitraum)}${t.PersonName ? " mit " + esc(t.PersonName) : ""}` : "noch offen" + (f.TerminPlatzhalter ? " – " + esc(f.TerminPlatzhalter) + ", am Sonntag festlegen" : "")}</p>
    </div>`;

  h += `<h3>1 · Stand prüfen</h3>` + vorschlaege(f, "Start-Check").map((v) => `<p>${esc(v.Vorschlagstext)}</p>`).join("") +
    `<div class="karte"><p class="leise">Erst schätzen, dann testen.</p>
      <div class="drei"><label>Vorhersage${feld("vorhersage", e.vorhersage ?? "", "", x, "number")}</label><label>Ergebnis${feld("ergebnis", e.ergebnis ?? "", "", x, "number")}</label><label>von (höchstens)${feld("max", e.max ?? "", "", x, "number")}</label></div>
      <div class="zeile">${chips("einstufung", [["neu", "neu"], ["teilweise", "teilweise"], ["sicher", "sicher"]], e.einstufung, x)}</div>
      ${e.einstufung === "sicher" ? `<p class="leise">Sicher heißt: Der Test hat es gezeigt, nicht das Gefühl. Dann darfst du unten Aufgaben weglassen.</p>` : ""}</div>`;

  h += `<h3>2 · Aufnehmen – das musst du diese Woche lernen</h3>` + (pflicht(f).map((a) => aufgabeKarte(f, a, false)).join("") || `<p class="leise">Im Plan steht hier nichts.</p>`);

  h += `<h3>3 · Üben – das legst du am Wochenanfang selbst fest</h3>
    <p class="leise">Geh die Seiten von oben durch: Was willst du üben, mit welchen Aufgaben auf welcher Seite, wie und wann?${f.UebungsMin ? ` Du hast dafür ${f.UebungsMin} Min. freie Übungszeit.` : ""}</p>` +
    e.ueben.map((u, i) => uebenKarte(f, u, i, false)).join("") + `<button class="knopf voll" data-a="u-neu" ${x}>+ Übung festlegen</button>`;

  const ideen = vorschlaege(f, "Zeigen");
  h += `<h3>4 · Zeigen</h3><div class="karte">` + ideen.map((v, i) => `<label class="radio"><input type="radio" name="zeig" data-a="zeig" data-w="${i}" ${x} ${String(e.zeig) === String(i) ? "checked" : ""}><span>${esc(v.Vorschlagstext)}${v.Zeigform ? ` <span class="leise">(${esc(v.Zeigform)})</span>` : ""}</span></label>`).join("") +
    `<label class="radio"><input type="radio" name="zeig" data-a="zeig" data-w="eigen" ${x} ${e.zeig === "eigen" ? "checked" : ""}><span>Eigene Idee</span></label>
     ${e.zeig === "eigen" ? feld("zeigEigen", e.zeigEigen || "", "Meine Idee", x) : ""}
     <div class="zeile"><span class="leise">Größe</span>${chips("groesse", [["klein", "klein"], ["mittel", "mittel"], ["groß", "groß"]], e.groesse, x)}</div>
     <label>Dafür lasse ich weg${feld("lasseWeg", e.lasseWeg || "", "zum Beispiel eine Übung", x)}</label>
     <label>Dafür nehme ich dazu${feld("nehmeDazu", e.nehmeDazu || "", "zum Beispiel ein Video", x)}</label></div>`;

  const frei = freiwillig(f), songs = f.Songs.filter((s) => s.Empfohlen);
  if (frei.length || songs.length) {
    h += `<h3>Freiwillig</h3><div class="karte"><ul class="liste">` +
      frei.map((a) => `<li><input type="checkbox" data-a="frei" data-id="${a.MaterialID}" ${x} ${e.frei[a.MaterialID] ? "checked" : ""} aria-label="erledigt"><span>${a.URL ? `<a href="${esc(a.URL)}" target="_blank" rel="noopener">${esc(a.Titel)}</a>` : esc(a.Titel)}<br><span class="meta">${esc([kurzQuelle(a.Quelle), a.Fundstelle, a.Minuten ? a.Minuten + " Min." : ""].filter(Boolean).join(" · "))}</span></span></li>`).join("") +
      songs.map((s) => `<li><span aria-hidden="true">♪</span><span><a href="https://www.youtube.com/results?search_query=${encodeURIComponent(s.Titel + " " + s.Interpret)}" target="_blank" rel="noopener">${esc(s.Titel)}</a> – ${esc(s.Interpret)}</span></li>`).join("") + `</ul></div>`;
  }
  h += `<h3>Notiz zum Fach</h3>${text("notiz", e.notiz || "", "Fragen, Schwieriges, Ideen", x)}`;
  return h;
}

function seiteSonntag() {
  const p = paket();
  if (!p) return ohnePaket();
  const r = eintraege().retro;
  return `<p class="leise">${p.Plan.Zielsatz ? "Mein Zielsatz: " + esc(p.Plan.Zielsatz) : "Dein Zielsatz steht noch nicht in der Datenbank."}</p>
    <h3>Vor der Woche</h3>
    <label>Mein größtes Hindernis diese Woche${feld("r-hindernis", r.hindernis || "", "", "")}</label>
    <label>Wenn …${feld("r-wenn", r.wenn || "", "wenn ich zum Handy greife", "")}</label>
    <label>dann …${feld("r-dann", r.dann || "", "dann lege ich es in den Flur", "")}</label>
    <h3>Nach der Woche: Retro</h3>
    <label>Was lief gut?${text("r-gut", r.gut || "", "", "")}</label>
    <label>Was lief nicht gut, und woran lag es?${text("r-nichtgut", r.nichtgut || "", "", "")}</label>
    <div class="zeile"><span class="leise">Ursache</span>${chips("r-ursache", URSACHEN.map((u) => [u, u]), r.ursache)}</div>
    <label>Das probiere ich nächste Woche aus (nur eine Sache)${feld("r-experiment", r.experiment || "", "", "")}</label>
    <label>Rückmeldung an meine Begleiter (beibehalten, ändern)${text("r-feedback", r.feedback || "", "", "")}</label>
    <h3>Abschicken</h3>
    <p class="leise">Die Rückmeldung enthält alles, was du in dieser Woche eingetragen hast. Sie wird am PC in die Datenbank eingelesen.</p>
    <button class="knopf haupt voll" data-a="rueckmeldung">Rückmeldung für ${esc(p.Woche.WocheID)} speichern oder teilen</button>`;
}

function seiteMehr() {
  const wochen = Object.keys(Z.pakete).sort();
  const thema = Z.theme || "system";
  return `<h3>Wochenpakete</h3>
    <p class="leise">Ein Wochenpaket ist die Datei aus der Datenbank (Schulplaner_Wochenpaket_….json).</p>
    <button class="knopf haupt voll" data-a="laden">Wochenpaket laden</button>
    ${wochen.length ? `<ul class="liste">` + wochen.map((w) => `<li><span style="flex:1">${esc(w)} · ${esc(Z.pakete[w].Plan.Lernende)} · ab ${kurzDatum(Z.pakete[w].Woche.StartDatum)}</span><button class="chip" data-a="paket-weg" data-w="${esc(w)}">entfernen</button></li>`).join("") + `</ul>` : `<p class="leise">Noch keines geladen.</p>`}
    <h3>Darstellung</h3>${chips("theme", [["system", "wie das Gerät"], ["light", "hell"], ["dark", "dunkel"]], thema)}
    <h3>So liest du den Plan</h3>
    <p class="leise">Fest sind nur Ziel und Zeig-Termin. Den Weg dahin wählst du. Grün wird ein Thema erst nach einem Test, nicht nach Gefühl.</p>
    <p class="leise">– ¼ ½ ¾ ✓ zeigt, wie weit du bist. Zeiträume: ${Object.values(ZEITEN).join(", ")}.</p>
    <h3>Daten</h3>
    <p class="leise">Alles liegt nur auf diesem Gerät. Sichere es, bevor du den Browser leerst.</p>
    <div class="zeile"><button class="knopf" data-a="sichern">Alles sichern</button><button class="knopf" data-a="laden">Sicherung einlesen</button></div>
    <p class="leise">Schulplaner App ${APP_VERSION}</p>`;
}

const ohnePaket = () => `<div class="karte"><div class="titel">Noch kein Wochenpaket</div><p>Lade die Datei für deine Woche. Du bekommst sie am Sonntag aus der Datenbank.</p><button class="knopf haupt voll" data-a="laden">Wochenpaket laden</button></div>`;

// ---------------------------------------------------------------- Zeichnen
const SEITEN = { heute: ["Heute", seiteHeute], woche: ["Woche", seiteWoche], sonntag: ["Sonntag", seiteSonntag], mehr: ["Mehr", seiteMehr], fach: ["Fach", seiteFach] };
function zeichnen(obenBleiben) {
  const y = window.scrollY, p = paket();
  document.documentElement.dataset.theme = Z.theme && Z.theme !== "system" ? Z.theme : "";
  if (!document.documentElement.dataset.theme) delete document.documentElement.dataset.theme;
  document.getElementById("kopf").innerHTML = `<h1>${ansicht.seite === "fach" ? esc(ansicht.fach) : SEITEN[ansicht.seite][0]}</h1><p>${p ? `${esc(p.Plan.Lernende)} · ${esc(p.Woche.WocheID)} · ${kurzDatum(p.Woche.StartDatum)} bis ${kurzDatum(p.Woche.EndDatum)}${p.Umgebung !== "Produktion" ? " · " + esc(p.Umgebung.toUpperCase()) : ""}` : "Schulplaner"}</p>`;
  document.getElementById("inhalt").innerHTML = SEITEN[ansicht.seite][1]();
  document.getElementById("nav").innerHTML = ["heute", "woche", "sonntag", "mehr"].map((s) => `<button data-a="seite" data-w="${s}" ${ansicht.seite === s || (s === "woche" && ansicht.seite === "fach") ? 'aria-current="page"' : ""}>${SEITEN[s][0]}</button>`).join("");
  window.scrollTo(0, obenBleiben ? y : 0);
}

// ---------------------------------------------------------------- Eingaben
function handle(el, wert) {
  const a = el.dataset.a, d = el.dataset;
  const zahl = (v) => (v === "" ? null : Number(v));
  let neu = true;                                       // neu zeichnen?
  switch (a) {
    case "seite": ansicht = { seite: wert, fach: null }; zeichnen(false); return;
    case "fach": ansicht = { seite: "fach", fach: wert }; zeichnen(false); return;
    case "woche": if (wert) Z.woche = wert; break;
    case "stand": eMat(d.id).stand = Number(wert); break;
    case "tag": eMat(d.id).tag = wert || null; break;
    case "zeit": eMat(d.id).zeit = wert || null; break;
    case "weg": eMat(d.id).weg = !eMat(d.id).weg; break;
    case "frei": eFach(d.fach).frei[d.id] = el.checked; neu = false; break;
    case "vorhersage": case "ergebnis": case "max": eFach(d.fach)[a] = zahl(wert); neu = false; break;
    case "einstufung": case "groesse": eFach(d.fach)[a] = eFach(d.fach)[a] === wert ? null : wert; break;
    case "zeig": eFach(d.fach).zeig = wert; break;
    case "zeigEigen": case "lasseWeg": case "nehmeDazu": case "notiz": eFach(d.fach)[a] = wert; neu = false; break;
    case "u-neu": eFach(d.fach).ueben.push({ was: "", wie: "", tag: "", stand: 0 }); break;
    case "u-weg": eFach(d.fach).ueben.splice(Number(d.i), 1); break;
    case "u-was": eFach(d.fach).ueben[d.i].was = wert; neu = false; break;
    case "u-wie": eFach(d.fach).ueben[d.i].wie = wert; neu = false; break;
    case "u-tag": eFach(d.fach).ueben[d.i].tag = wert; break;
    case "u-stand": eFach(d.fach).ueben[d.i].stand = Number(wert); break;
    case "r-ursache": eintraege().retro.ursache = eintraege().retro.ursache === wert ? null : wert; break;
    case "theme": Z.theme = wert; break;
    case "laden": document.getElementById("datei").click(); return;
    case "paket-weg": if (confirm(`Wochenpaket ${wert} und deine Eintragungen dazu von diesem Gerät entfernen?`)) { delete Z.pakete[wert]; delete Z.e[wert]; if (Z.woche === wert) Z.woche = Object.keys(Z.pakete).sort()[0] || null; } break;
    case "rueckmeldung": abgeben(`Schulplaner_Rueckmeldung_${Z.woche}.json`, rueckmeldung()); return;
    case "sichern": abgeben(`Schulplaner_Sicherung_${heuteIso()}.json`, { Art: "Sicherung", Stand: Z }); return;
    default:
      if (a && a.startsWith("r-")) { eintraege().retro[a.slice(2)] = wert; neu = false; } else return;
  }
  speichern();
  if (neu) zeichnen(true);
}
document.addEventListener("click", (ev) => {
  const el = ev.target.closest("button[data-a]");
  if (el) handle(el, el.dataset.w);
});
document.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el.id === "datei") { dateienLesen(el.files); el.value = ""; return; }
  if (el.dataset && el.dataset.a && el.tagName !== "BUTTON") handle(el, el.type === "radio" ? el.dataset.w : el.value);
});

// ---------------------------------------------------------------- Dateien
function paketAufnehmen(obj) {
  if (obj && obj.Art === "Sicherung" && obj.Stand) { Z = Object.assign(laden(), obj.Stand); return "Sicherung eingelesen."; }
  if (!obj || !obj.Woche || !obj.Faecher || !obj.Plan) throw new Error("Das ist kein Wochenpaket.");
  const w = obj.Woche.WocheID;
  Z.pakete[w] = obj; Z.woche = w;
  return `Wochenpaket ${w} geladen.`;
}
async function dateienLesen(dateien) {
  const meldungen = [];
  for (const d of dateien) {
    try { meldungen.push(paketAufnehmen(JSON.parse((await d.text()).replace(/^﻿/, "")))); } catch (e) { meldungen.push(`${d.name}: ${e.message}`); }
  }
  speichern(); ansicht = { seite: "woche", fach: null }; zeichnen(false);
  if (meldungen.length) alert(meldungen.join("\n"));
}
function rueckmeldung() {
  const p = paket(), e = eintraege();
  return {
    Art: "Rueckmeldung", AppVersion: APP_VERSION, Erstellt: new Date().toISOString(), PlanID: p.Plan.PlanID, Lernende: p.Plan.Lernende, Woche: p.Woche.WocheID,
    Material: p.Faecher.flatMap((f) => f.Aufgaben.map((a) => ({ a, m: e.mat[a.MaterialID], frei: (e.fach[f.Fach] || {}).frei })).filter((x) => (x.m && (x.m.stand || x.m.tag || x.m.weg)) || (x.frei && x.frei[x.a.MaterialID])).map((x) => ({
      MaterialID: x.a.MaterialID, FortschrittProzent: x.frei && x.frei[x.a.MaterialID] ? 100 : ((x.m && x.m.stand) || 0) * 25, Tag: (x.m && x.m.tag) || null, Zeitraum: (x.m && ZEITEN[x.m.zeit]) || null, Entscheidung: x.m && x.m.weg ? "gestrichen" : "bleibt" }))),
    Faecher: p.Faecher.map((f) => {
      const x = e.fach[f.Fach] || { ueben: [] }, ideen = vorschlaege(f, "Zeigen");
      return { Fach: f.Fach, Paket: f.Paket, Vorhersage: x.vorhersage ?? null, Ergebnis: x.ergebnis ?? null, Maximal: x.max ?? null, StartCheck: x.einstufung || null,
        ZeigIdee: x.zeig === "eigen" ? x.zeigEigen || "eigene Idee" : (ideen[x.zeig] ? ideen[x.zeig].Vorschlagstext : null), Zeigform: x.zeig !== "eigen" && ideen[x.zeig] ? ideen[x.zeig].Zeigform : null,
        Groesse: x.groesse || null, LasseWeg: x.lasseWeg || null, NehmeDazu: x.nehmeDazu || null, Notiz: x.notiz || null,
        Ueben: (x.ueben || []).map((u) => ({ Was: u.was, Wie: u.wie, Tag: u.tag, FortschrittProzent: (u.stand || 0) * 25 })) };
    }),
    Retro: e.retro,
  };
}
async function abgeben(name, obj) {
  const inhalt = JSON.stringify(obj, null, 1), datei = new File([inhalt], name, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [datei] })) {
    try { await navigator.share({ files: [datei], title: name }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(datei); a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

// ---------------------------------------------------------------- Start
window.schulplaner = { paketAufnehmen, rueckmeldung, zustand: () => Z, neuZeichnen: () => { speichern(); zeichnen(false); } };
if (!paket() && Object.keys(Z.pakete).length) Z.woche = Object.keys(Z.pakete).sort()[0];
if (!paket()) ansicht.seite = "mehr";
zeichnen(false);
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
