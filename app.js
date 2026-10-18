/* Schulplaner – Handy-App. Liest Wochenpakete (JSON aus der Datenbank), speichert alle Eintragungen
   nur auf diesem Gerät (localStorage) und gibt sie als Rückmeldung-Datei zurück. Kein Server. */
"use strict";
const APP_VERSION = "0.8.0";
const SCHLUESSEL = "schulplaner";
const TAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const ZEITEN = { B: "Bahnfahrt", F: "Vormittag", N: "Nachmittag", A: "Abend", W: "Wochenende" };
const STAND = ["–", "¼", "½", "¾", "✓"];
const UEBEN_IDEEN = ["Aufgaben im Buch", "Online-Übung", "Karteikarten", "Selbsttest (abdecken)", "aus dem Kopf aufschreiben oder zeichnen", "mit Lösung vergleichen"];
const URSACHEN = ["Methode", "Menge", "Zeitpunkt", "Ort", "Fokus", "Sonstiges"];
const TAG_LANG = { Mo: "Montag", Di: "Dienstag", Mi: "Mittwoch", Do: "Donnerstag", Fr: "Freitag", Sa: "Samstag", So: "Sonntag" };
// Wie sitzt es? Leer = noch nicht eingeschätzt (Sanduhr). Die Werte gehen so in die Datenbank (tblWegMaterial.Einschaetzung).
const NOTIZ_ARTEN = [["Frage", "Frage"], ["schwierig", "schwierig"], ["Idee", "Idee"], ["sonstiges", "sonstiges"]];
const SITZT = [["", "noch nicht eingeschätzt"], ["sitzt", "sitzt"], ["unsicher", "unsicher"], ["nicht verstanden", "nicht verstanden"]];
// Beispiele zum Üben, klein unter der Übungszeit: in der Bahn nur Leichtes
const UEBEN_BAHN = "zum Beispiel Karteikarten, Vokabeln, ein Video ansehen, etwas Kurzes lesen";
const UEBEN_TISCH = "zum Beispiel Aufgaben im Buch, Online-Übung, Karteikarten, Selbsttest, aus dem Kopf aufschreiben";

// ---------------------------------------------------------------- Zustand
let Z = laden();
let ansicht = { seite: "heute", fach: null };   // dazu kurz offen: leiste (Auswahl unter dem Titel), notiz, tipp, melden, hilfe

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
  if (!Z.e[w].vt) Z.e[w].vt = {};                      // Änderungen an der Stoffverteilung (je VerteilungID)
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
// ---- Stoffverteilung aus der Datenbank (Wochenpaket.Verteilung): je Zeile Tag, Zeitfenster, Fach, Art, Aufgabe, Minuten.
// Emil kann Tag und Zeitfenster ändern; die Änderung liegt in eintraege().vt und geht mit der Rückmeldung zurück.
const verteilung = () => (paket() && paket().Verteilung) || [];
function eVt(id) { const e = eintraege(); if (!e.vt[id]) e.vt[id] = {}; return e.vt[id]; }
const vtTag = (v) => eVt(v.VerteilungID).tag || v.Wochentag;
const vtFenster = (v) => eVt(v.VerteilungID).fenster || v.Zeitfenster;
const istVorschlag = (v) => !!v.VorschlagTag && vtTag(v) === v.VorschlagTag && vtFenster(v) === v.VorschlagFenster;
const sortVt = (a, b) => TAGE.indexOf(vtTag(a)) - TAGE.indexOf(vtTag(b)) || String(vtFenster(a)).localeCompare(String(vtFenster(b)));
const zeitKurz = (fenster) => (/Bahn/.test(fenster || "") ? fenster.replace(/^\d\d:\d\d /, "") : String(fenster || "").slice(0, 5));
// Alle Zeitfenster zur Auswahl beim Verschieben: Bahn, Schulstunden, Zeiten zu Hause und was schon in der Verteilung steht
function zeitfenster() {
  const p = paket(), l = new Set(["08:00 Bahn hin", "14:00 Bahn heim"]);
  for (const s of p.Stundenplan || []) if (s.Reihenfolge >= 2 && s.ZeitBis && !/^Pause/i.test(s.Inhalt)) l.add(s.ZeitVon + "-" + s.ZeitBis);
  for (const v of verteilung()) l.add(v.Zeitfenster);
  for (const v of Object.values(eintraege().vt)) if (v.fenster) l.add(v.fenster);
  return [...l].filter(Boolean).sort();
}
// Was in diesem Zeitfenster ist: Schulstunde, Bahn oder Termin zu Hause
function fensterText(tag, fenster) {
  const p = paket();
  if (/Bahn/.test(fenster)) return fenster.replace(/^\d\d:\d\d /, "") + " (" + fenster.slice(0, 5) + ")";
  const s = (p.Stundenplan || []).find((x) => x.Wochentag === tag && x.ZeitVon + "-" + x.ZeitBis === fenster);
  if (s) return fenster.replace(/-/, "–") + ` · ${s.Inhalt}`;
  // sonst ein Termin (Nachmittag, Wochenende): Name enthält Uhrzeit und Ort, dazu Fach und Person
  const t = (p.Termine || []).find((x) => x.Datum && x.FachID && TAGE[(datum(x.Datum).getDay() + 6) % 7] === tag && fenster.startsWith(x.Uhrzeit || "~"));
  return fenster.replace(/-/, "–") + (t ? ` · ${t.FachID}${t.PersonName ? " mit " + t.PersonName : ""}` : "");
}
// Wochentag mit Datum in der geladenen Woche, zum Beispiel "Di 20.10."
const tagDatum = (tag) => { const p = paket(); if (!p) return tag; const d = datum(p.Woche.StartDatum); d.setDate(d.getDate() + TAGE.indexOf(tag)); return tag + " " + d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }); };
const wannText = (v) => `${vtTag(v)} ${zeitKurz(vtFenster(v))}`;
const marke = (v) => (istVorschlag(v) ? `<span class="vorschlag">Vorschlag</span>` : `<span class="geaendert">${v.VorschlagTag ? "verschoben" : "eigen"}</span>`);
// Auswahl zum Verschieben, eingeklappt
const verschieben = (v) => `<details class="verschieben"><summary>verschieben</summary><div class="zwei">${auswahl("vt-tag", TAGE.map((t) => [t, t]), vtTag(v), "Tag", `data-id="${v.VerteilungID}"`)}${auswahl("vt-fenster", zeitfenster().map((z) => [z, z]), vtFenster(v), "Zeit", `data-id="${v.VerteilungID}"`)}</div>${v.VorschlagTag && !istVorschlag(v) ? `<button class="link" data-a="vt-zurueck" data-id="${v.VerteilungID}">zurück zum Vorschlag (${esc(v.VorschlagTag)} ${esc(zeitKurz(v.VorschlagFenster))})</button>` : ""}</details>`;
// Art einer Aufgabe: Symbol und Text für den Knopf (aus Kategorie, Fundstelle, Link)
function medium(a) {
  const t = [a.Kategorie, a.Fundstelle, a.Titel, a.URL].join(" ");
  if (!a.URL) return { symbol: "📖", art: "Buch", knopf: "" };
  if (/video|film|youtube|ted\.com|elllo|abc\.net/i.test(t)) return { symbol: "🎬", art: "Video", knopf: "Video ansehen" };
  if (/listening|hören|audio|podcast/i.test(t)) return { symbol: "🎧", art: "Hören", knopf: "Anhören" };
  if (/pdf/i.test(t)) return { symbol: "📄", art: "PDF", knopf: "PDF öffnen" };
  if (/übung|interaktiv|geogebra|applet|quiz|exercise|training/i.test(t)) return { symbol: "✏️", art: "Online-Übung", knopf: "Online üben" };
  return { symbol: "🌐", art: "Online-Text", knopf: "Online lesen" };
}
const artZeichen = (a) => `<span class="art" title="${medium(a).art}"><span aria-hidden="true">${medium(a).symbol}</span> ${medium(a).art}</span>`;
// Symbol vor dem Zeitfenster: Bahn, Schule, Termin
const ortZeichen = (fenster) => (/Bahn/.test(fenster) ? "🚆" : /^\d\d:\d\d-\d\d:\d\d$/.test(fenster) ? "🏫" : "📍");
const kurzQuelle = (s) => { s = (s || "").split(" (")[0]; return s.length > 38 ? s.slice(0, 37) + "…" : s; };

function fortschritt(f) {                               // Anteil der Pflichtaufgaben, gestrichene zählen nicht
  const liste = pflicht(f).filter((a) => !eMat(a.MaterialID).weg);
  if (!liste.length) return { fertig: 0, anzahl: 0, anteil: 0 };
  const summe = liste.reduce((s, a) => s + (eMat(a.MaterialID).stand || 0) / 4, 0);
  return { fertig: liste.filter((a) => eMat(a.MaterialID).stand === 4).length, anzahl: liste.length, anteil: summe / liste.length };
}

// ---------------------------------------------------------------- Symbole (SVG, wie im Mock-up)
const svg = (inhalt, gross = 24) => `<svg viewBox="0 0 24 24" width="${gross}" height="${gross}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inhalt}</svg>`;
const IKON = {
  welt: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3.2 3.6 3.2 14.4 0 18M12 3c-3.2 3.6-3.2 14.4 0 18"/>',
  film: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M6 6l2 4M11 6l2 4M16 6l2 4"/>',
  hoeren: '<path d="M4 16v-4a8 8 0 0 1 16 0v4"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/>',
  pdf: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h4"/>',
  uebung: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  notiz: '<path d="M15 9V4H5v16h6"/><path d="M8 8h4M8 12h3"/><path d="M13 21l.8-3 5.4-5.4 2.2 2.2-5.4 5.4z"/>',
  birne: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.8 10.6c.6.6.8 1.4.8 2.4h6c0-1 .2-1.8.8-2.4A6 6 0 0 0 12 3z"/>',
  mond: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  sonne: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M5 19l1.4-1.4M17.6 6.4L19 5"/>',
  sanduhr: '<path d="M6 3h12M6 21h12M7.5 3c0 5 4.5 6 4.5 9s-4.5 4-4.5 9M16.5 3c0 5-4.5 6-4.5 9s4.5 4 4.5 9"/>',
  fahne: '<path d="M6 21V4"/><path d="M6 4h11l-2.5 4L17 12H6"/>',
  joker: '<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><path d="M9.8 9.3a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.4v.6M12 16.8h.01"/>',
  uhr: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  mikro: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  kopieren: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2"/>',
};
const ikon = (name, gross) => svg(IKON[name], gross);
// Fortschritt als grüner Kreis: leer, ¼, ½, ¾ oder voll
function torte(stand, gross = 30) {
  const r = 9.5, c = 12, w = (stand || 0) / 4 * 2 * Math.PI;
  const x = (c + r * Math.sin(w)).toFixed(2), y = (c - r * Math.cos(w)).toFixed(2);
  const fuell = stand >= 4 ? `<circle cx="12" cy="12" r="${r}" fill="var(--gut)"/>` : stand > 0 ? `<path d="M12 12V${c - r}A${r} ${r} 0 ${stand > 2 ? 1 : 0} 1 ${x} ${y}z" fill="var(--gut)"/>` : "";
  return `<svg viewBox="0 0 24 24" width="${gross}" height="${gross}" aria-hidden="true"><circle cx="12" cy="12" r="${r}" fill="none" stroke="var(--gut)" stroke-width="2"/>${fuell}</svg>`;
}
// Wie sitzt es? graue Sanduhr, grüner Haken, gelbes Dreieck mit !, rotes Dreieck mit ?
function sitztZeichen(wert, gross = 30) {
  if (wert === "sitzt") return `<span class="gruen">${svg('<path d="M4.5 12.5l5 5L19.5 7" stroke-width="3"/>', gross)}</span>`;
  const dreieck = (fuell, rand, zeichen, farbe) => `<svg viewBox="0 0 24 24" width="${gross}" height="${gross}" aria-hidden="true"><path d="M12 2.8L22 20.5H2z" fill="${fuell}" stroke="${rand}" stroke-width="1.4" stroke-linejoin="round"/><text x="12" y="18.2" text-anchor="middle" font-size="11" font-weight="700" font-family="system-ui,sans-serif" fill="${farbe}">${zeichen}</text></svg>`;
  if (wert === "unsicher") return dreieck("#f2c230", "#8a6d00", "!", "#1b1f24");
  if (wert === "nicht verstanden") return dreieck("#d64535", "#8f1f14", "?", "#ffffff");
  return `<span class="grau">${ikon("sanduhr", gross)}</span>`;
}
const STAND_TEXT = ["noch nicht angefangen", "ein Viertel geschafft", "die Hälfte geschafft", "drei Viertel geschafft", "fertig"];
const standWerte = STAND_TEXT.map((t, i) => [i, t]);
// Status rechts neben dem Titel. Ein Tipp öffnet darunter die Leiste mit allen Werten, ein Tipp auf einen Wert wählt ihn und schließt sie.
const statusKnopf = (schluessel, inhalt, text) => `<button class="status" data-a="auf" data-w="${schluessel}" aria-expanded="${ansicht.leiste === schluessel}" aria-label="${esc(text)} (ändern)">${inhalt}</button>`;
function leiste(schluessel, aktion, werte, aktiv, zeichen, id) {
  if (ansicht.leiste !== schluessel) return "";
  return `<div class="leiste" role="group">` + werte.map(([w, t]) => `<button data-a="${aktion}" data-w="${esc(w)}" ${id} aria-pressed="${String(aktiv ?? "") === String(w)}" aria-label="${esc(t)}">${zeichen(w)}</button>`).join("") + `</div>`;
}
// Kopf einer Karte: Titel links, Fortschritt und (nur bei Aufgaben) Wie sitzt es? rechts, darunter die offene Leiste
function kartenKopf(titel, standAktion, stand, id, sitzt) {
  const k = id.replace(/\D/g, ""), sS = `${standAktion}:${k}`, sZ = `sitzt:${k}`;
  return `<div class="kartenkopf"><div class="kopftext">${titel}</div><div class="statusse">
      ${statusKnopf(sS, torte(stand), "Wie weit: " + STAND_TEXT[stand || 0])}
      ${sitzt !== undefined ? statusKnopf(sZ, sitztZeichen(sitzt), "Wie sitzt es: " + (sitzt || "noch nicht eingeschätzt")) : ""}</div></div>
    ${leiste(sS, standAktion, standWerte, stand || 0, (w) => torte(Number(w), 34), id)}
    ${sitzt !== undefined ? leiste(sZ, "sitzt", SITZT, sitzt || "", (w) => sitztZeichen(w, 30), id) : ""}`;
}
// Wann eine Zeile der Stoffverteilung ist, in Worten: "Mittwoch Bahnfahrt", "Dienstag Freiarbeit / Vormittag, 09:50"
function eingeplantText(v) {
  const tag = vtTag(v), fenster = vtFenster(v) || "", lang = TAG_LANG[tag] || tag;
  if (/Bahn/.test(fenster)) return lang + " Bahnfahrt";
  const h = Number(fenster.slice(0, 2));
  const teil = tag === "Sa" || tag === "So" ? "Wochenende" : h < 13 ? "Freiarbeit / Vormittag" : h < 18 ? "Nachmittag" : "Abend";
  return `${lang} ${teil}${/^\d\d:\d\d/.test(fenster) ? ", " + fenster.slice(0, 5) : ""}`;
}
// Eingeplant: aus der Stoffverteilung (lila = Vorschlag), sonst selbst gewählt; fehlt beides, rote Auswahlfelder Tag und Zeitraum
function planZeile(a, m, id) {
  const vs = verteilung().filter((v) => v.MaterialID === a.MaterialID).sort(sortVt);
  if (vs.length) return `<p class="eingeplant">Eingeplant: ` + vs.map((v) => `<span class="${istVorschlag(v) ? "lila" : ""}">${esc(eingeplantText(v))}</span>`).join(", ") + `</p>`;
  const felder = `<div class="zwei">${auswahl("tag", tagOptionen, m.tag, "Tag", id + (m.tag ? "" : ' class="rot"'))}${auswahl("zeit", zeitOptionen, m.zeit, "Zeitraum", id + (m.zeit ? "" : ' class="rot"'))}</div>`;
  if (m.tag && m.zeit) return `<p class="eingeplant">Eingeplant: ${esc(TAG_LANG[m.tag] + " " + ZEITEN[m.zeit])}</p><details class="verschieben"><summary>ändern</summary>${felder}</details>`;
  return `<div class="planen">${felder}</div>`;
}
// ---- Notizfeld: Art der Notiz, Textfeld, Mikrofon (Spracherkennung von Chrome, wo vorhanden)
const SPRACHE = window.SpeechRecognition || window.webkitSpeechRecognition;
let sprachErkennung = null;
function notizFeld(aktion, wert, art, platz, extra) {
  return `<div class="notizfeld"><div class="zeile notizkopf">${auswahl(aktion + "-art", NOTIZ_ARTEN, art, "Art der Notiz", extra)}` +
    (SPRACHE ? `<button class="ikon" data-a="sprechen" aria-label="Sprechen statt tippen" title="Sprechen statt tippen">${ikon("mikro")}</button>` : "") + `</div>` +
    text(aktion, wert || "", platz, extra) + (SPRACHE ? "" : `<p class="leise">Tipp: Mit der Mikrofon-Taste der Tastatur kannst du auch diktieren.</p>`) + `</div>`;
}
// Spracheingabe: Text erscheint live im Feld und lässt sich danach korrigieren. Gespeichert wird nur der Text (Kennzeichen „gesprochen“).
function sprechen(knopf) {
  const feld = knopf.closest(".notizfeld").querySelector("textarea");
  if (!Z.sprachOk) {
    if (!confirm("Die Spracherkennung von Chrome schickt die Aufnahme zur Umwandlung in Text an Google. Gespeichert wird nur der Text. Einverstanden?")) return;
    Z.sprachOk = true; speichern();
  }
  if (sprachErkennung) { sprachErkennung.stop(); return; }   // zweiter Tipp beendet die Aufnahme
  const r = new SPRACHE(), anfang = feld.value ? feld.value.replace(/\s*$/, " ") : "";
  r.lang = "de-DE"; r.interimResults = true; r.continuous = true;
  r.onresult = (ev) => { let t = ""; for (const x of ev.results) t += x[0].transcript; feld.value = anfang + t; };
  r.onend = () => { sprachErkennung = null; knopf.classList.remove("an"); feld.dataset.gesprochen = "1"; feld.dispatchEvent(new Event("change", { bubbles: true })); };
  r.onerror = () => { sprachErkennung = null; knopf.classList.remove("an"); };
  sprachErkennung = r; knopf.classList.add("an"); r.start();
}

// ---- Arbeitszeit (Uhr): freiwillig, von–bis oder Dauer, mehrere Einträge werden addiert
const dauerText = (min) => (min >= 60 ? `${Math.floor(min / 60)} Std.${min % 60 ? " " + (min % 60) + " Min." : ""}` : `${min} Min.`);
const zeitraumAus = (uhr) => { const h = Number(String(uhr).slice(0, 2)); return h < 13 ? "Freiarbeit / Vormittag" : h < 18 ? "Nachmittag" : "Abend"; };
const summeZeit = (m) => (m.zeiten || []).reduce((s, z) => s + (z.min || 0), 0);
function uhrFeld(a, m, id) {
  const art = ansicht.uhrArt || "vonbis", tag = TAGE.includes(heuteTag()) ? heuteTag() : "Mo";
  let h = `<div class="aufklapp"><p><strong>Arbeitszeit eintragen</strong> <span class="leise">(freiwillig)</span></p>` + chips("uhr-art", [["vonbis", "von – bis"], ["dauer", "Dauer"]], art) +
    (art === "vonbis" ? `<div class="zwei"><label>von<input type="time" class="z-von"></label><label>bis<input type="time" class="z-bis"></label></div>`
      : `<div class="zwei"><label>Stunden<input type="number" min="0" max="12" class="z-std" value="0"></label><label>Minuten<input type="number" min="0" max="59" step="5" class="z-min" value="30"></label></div>`) +
    `<label>An welchem Tag?<select class="z-tag">${TAGE.map((t) => `<option value="${t}" ${t === tag ? "selected" : ""}>${TAG_LANG[t]}</option>`).join("")}</select></label>
    <button class="knopf haupt voll" data-a="zeit-eintragen" ${id}>Eintragen</button>`;
  if ((m.zeiten || []).length) h += `<ul class="versuche">` + m.zeiten.map((z, i) => `<li>${esc(TAG_LANG[z.tag] || z.tag)}${z.von ? ` ${esc(z.von)}–${esc(z.bis)}` : ""} · ${dauerText(z.min)}${z.zeitraum ? " · " + esc(z.zeitraum) : ""} <button class="link" data-a="zeit-weg" data-i="${i}" ${id}>entfernen</button></li>`).join("") + `</ul>`;
  return h + `</div>`;
}

// ---- Link melden (Fähnchen neben dem Link)
const GRUENDE = ["geht nicht", "falscher Inhalt", "kostenpflichtig oder Anmeldung nötig", "sonstiges"];
function meldenFeld(a, m, id) {
  return `<div class="aufklapp"><p><strong>Was ist mit dem Link?</strong></p><div class="chips">` +
    GRUENDE.map((g) => `<button class="chip" data-a="melden" data-w="${esc(g)}" ${id} aria-pressed="${!!m.meldung && m.meldung.grund === g}">${esc(g)}</button>`).join("") + `</div>` +
    (m.meldung ? feld("melden-text", m.meldung.text || "", "Optional ein Satz dazu", id) + `<p class="leise">Gemeldet. Die Meldung geht mit der Rückmeldung an Mama und Papa.</p><button class="link" data-a="melden-weg" ${id}>Meldung zurücknehmen</button>` : `<p class="leise">Tipp auf einen Grund. Die Meldung geht mit der Rückmeldung an Mama und Papa.</p>`) + `</div>`;
}
// ---- Hilfe holen (Joker-Karte): Person wählen, Text entsteht von selbst, Weg wählen, danach „Wie ist es gelaufen?“
const kontakte = () => (paket() && paket().Kontakte) || [];
const HILFE_STATUS = { "": "angefragt", Termin: "Termin", "nicht erreicht": "nachhaken", "geklärt": "geklärt" };
function hilfeStatus(m) { const l = m.hilfe || []; if (!l.length) return null; return HILFE_STATUS[l[l.length - 1].ergebnis || ""]; }
// Telefonnummer international: 0171 … wird +49171…
function nummer(t) { let n = String(t || "").replace(/[^\d+]/g, ""); if (n.startsWith("00")) n = "+" + n.slice(2); else if (n.startsWith("0")) n = "+49" + n.slice(1); return n; }
function hilfeText(f, a, person) {
  const p = paket();
  return `Hallo ${person}, ich komme bei einer Aufgabe nicht weiter.\n${f.Fach}, Woche ${p.Woche.WocheID}: ${a.Titel}\n${[kurzQuelle(a.Quelle), a.Fundstelle].filter(Boolean).join(", ")}\nMeine Frage: \nKannst du mir helfen? ${p.Plan.Lernende}`;
}
// Mögliche Wege aus den Kontaktdaten; der bevorzugte steht vorn mit ★
function hilfeWege(k, text, f) {
  const tel = k.Telefon ? nummer(k.Telefon) : "", w = [], enc = encodeURIComponent;
  if (tel) w.push(["Anrufen", "tel:" + tel]);
  if (tel) w.push(["SMS", `sms:${tel}?body=${enc(text)}`]);
  if (tel && k.WhatsApp) w.push(["WhatsApp", `https://wa.me/${tel.replace("+", "")}?text=${enc(text)}`]);
  if (tel && k.Signal) w.push(["Signal", `https://signal.me/#p/${tel}`]);
  if (k.Email) w.push(["E-Mail", `mailto:${k.Email}?subject=${enc("Frage zu " + f.Fach)}&body=${enc(text)}`]);
  w.push(["persönlich", ""]);
  return w.sort((x, y) => (y[0] === k.Bevorzugt) - (x[0] === k.Bevorzugt));
}
function hilfeFeld(f, a, m, id) {
  const l = m.hilfe || [], letzte = l[l.length - 1], e = m.hilfeEntwurf || {};
  let h = `<div class="aufklapp">`;
  if (l.length) h += `<ul class="versuche">` + l.map((x) => `<li>${esc(kurzDatum(x.am.slice(0, 10)))} · ${esc(x.weg)} an ${esc(x.person)}${x.ergebnis ? " · " + esc(x.ergebnis) : " · offen"}${x.termin ? " (" + esc(x.termin) + ")" : ""}</li>`).join("") + `</ul>`;
  if (letzte && !letzte.ergebnis) {
    h += `<p><strong>Wie ist es gelaufen?</strong></p>` + chips("hilfe-ergebnis", [["Termin", "erreicht, Termin"], ["nicht erreicht", "nicht erreicht"], ["geklärt", "geklärt"]], "", id);
  } else if (letzte && letzte.ergebnis === "Termin" && !letzte.termin) {
    h += `<label>Wann ist der Termin?${feld("hilfe-termin", "", "zum Beispiel Di 17 Uhr", id)}</label>`;
  }
  h += `<p><strong>${l.length ? "Neuer Versuch" : "Wen fragst du?"}</strong></p>` + auswahl("hilfe-person", kontakte().map((k) => [k.PersonName, k.PersonName + (k.Rolle ? " · " + k.Rolle.split(",")[0] : "")]), e.person, "Person wählen", id);
  const k = kontakte().find((x) => x.PersonName === e.person);
  if (k) {
    const wege = hilfeWege(k, e.text, f), nurReden = !k.Telefon && !k.Email;
    h += `<label>${nurReden ? "Stichpunkte fürs Gespräch" : "Deine Nachricht (Stichpunkte fürs Gespräch)"}${text("hilfe-text", e.text || "", "", id)}</label>
      <div class="zeile wege">` + wege.map(([weg, url]) => {
        const name = (weg === k.Bevorzugt ? "★ " : "") + weg;
        if (weg === "Signal") return `<button class="knopf" data-a="hilfe-signal" data-w="${esc(url)}" ${id}>${esc(name)}</button>`;
        return url ? `<a class="knopf" href="${esc(url)}" target="_blank" rel="noopener" data-a="hilfe-weg" data-w="${esc(weg)}" ${id}>${esc(name)}</a>` : `<button class="knopf" data-a="hilfe-weg" data-w="${esc(weg)}" ${id}>${esc(name)}</button>`;
      }).join("") + `<button class="knopf" data-a="hilfe-kopieren" ${id}>${ikon("kopieren", 18)} Text kopieren</button></div>`;
    if (nurReden) h += `<p class="leise">Für ${esc(k.PersonName)} sind kein Telefon und keine E-Mail eingetragen. Frag persönlich.</p>`;
  } else if (!kontakte().length) h += `<p class="leise">Noch keine Kontakte im Wochenpaket.</p>`;
  return h + `</div>`;
}

// Symbol-Leiste unten: Link öffnen (Symbol je nach Art), Notiz (mit Punkt, wenn eine da ist), Glühbirne (Lerntechnik)
const LINK_IKON = { Video: "film", "Hören": "hoeren", PDF: "pdf", "Online-Übung": "uebung", "Online-Text": "welt" };
function ikonLeiste(f, a, m, id, mitWeg) {
  const md = medium(a), tech = a.Techniken || [], hs = hilfeStatus(m);
  let h = summeZeit(m) ? `<p class="eingeplant">Arbeitszeit: geplant ${a.Minuten ? dauerText(a.Minuten) : "–"} · gebraucht ${dauerText(summeZeit(m))}</p>` : "";
  h += `<div class="ikonleiste">`;
  if (a.URL) h += `<a class="ikon" href="${esc(a.URL)}" target="_blank" rel="noopener" aria-label="${esc(md.knopf)}" title="${esc(md.knopf)}">${ikon(LINK_IKON[md.art] || "welt")}</a>
    <button class="fahne ${m.meldung ? "gemeldet" : ""}" data-a="melden-auf" data-w="${a.MaterialID}" aria-expanded="${ansicht.melden === a.MaterialID}" aria-label="Link melden${m.meldung ? " (gemeldet)" : ""}" title="Link melden">${ikon("fahne", 20)}</button>`;
  h += `<button class="ikon ${m.notiz ? "hat" : ""}" data-a="notiz-auf" data-w="${a.MaterialID}" aria-expanded="${ansicht.notiz === a.MaterialID}" aria-label="Notiz${m.notiz ? " (vorhanden)" : ""}" title="Notiz">${ikon("notiz")}</button>`;
  if (tech.length) h += `<button class="ikon" data-a="tipp-auf" data-w="${a.MaterialID}" aria-expanded="${ansicht.tipp === a.MaterialID}" aria-label="Lerntechnik" title="Lerntechnik">${ikon("birne")}</button>`;
  h += `<button class="ikon ${m.zeiten && m.zeiten.length ? "hat" : ""}" data-a="uhr-auf" data-w="${a.MaterialID}" aria-expanded="${ansicht.uhr === a.MaterialID}" aria-label="Arbeitszeit eintragen" title="Arbeitszeit">${ikon("uhr")}</button>`;
  h += `<button class="ikon ${hs ? "hilfe-" + hs.replace(/ä/g, "ae") : ""}" data-a="hilfe-auf" data-w="${a.MaterialID}" aria-expanded="${ansicht.hilfe === a.MaterialID}" aria-label="Hilfe holen${hs ? " (" + hs + ")" : ""}" title="Hilfe holen">${ikon("joker")}</button>`;
  if (mitWeg) h += `<button class="chip klein rechts" data-a="weg" ${id} aria-pressed="${!!m.weg}">lasse ich weg</button>`;
  h += `</div>`;
  if (ansicht.notiz === a.MaterialID) h += `<div class="aufklapp">${notizFeld("m-notiz", m.notiz, m.notizArt, "Notiz zu dieser Aufgabe: Fragen, Schwieriges, Ideen", id)}</div>`;
  if (ansicht.uhr === a.MaterialID) h += uhrFeld(a, m, id);
  if (ansicht.melden === a.MaterialID) h += meldenFeld(a, m, id);
  if (ansicht.hilfe === a.MaterialID) h += hilfeFeld(f, a, m, id);
  if (ansicht.tipp === a.MaterialID) h += `<div class="aufklapp">` + tech.map((t) => `<p><strong>${esc(t.Technik)}</strong><br>${esc(t.KurzErklaert || "")}</p>${t.SoGehts ? `<details><summary>So geht's</summary><p class="sogehts">${esc(t.SoGehts)}</p></details>` : ""}`).join("") + `</div>`;
  return h;
}

// ---------------------------------------------------------------- Ampel (Regel wie in den Excel-Dateien)
// Rückstand = Pflichtaufgaben, die nicht fertig sind und aus einer früheren Woche stammen
// oder in dieser Woche auf einen schon vergangenen Tag geplant waren. Freiwillige Fächer haben keine Ampel.
function tagVorbei(tag) { const p = paket(), d = datum(p.Woche.StartDatum); d.setDate(d.getDate() + TAGE.indexOf(tag)); const iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); return iso < heuteIso(); }
// Ist eine Aufgabe einer früheren Woche hier in der App schon fertig (oder gestrichen), obwohl die Datenbank das noch nicht weiß?
const lokalErledigt = (x) => { const m = Z.e[x.WocheID] && Z.e[x.WocheID].mat[x.MaterialID]; return !!m && (m.stand === 4 || !!m.weg); };
function rueckstand(f) {
  if (f.Optional) return null;
  const frueher = (paket().OffenVorwochen || []).filter((x) => x.FachID === f.Fach && !lokalErledigt(x));
  const vergangen = pflicht(f).filter((a) => {
    const m = eMat(a.MaterialID); if (m.weg || m.stand === 4) return false;
    const tage = verteilung().filter((v) => v.MaterialID === a.MaterialID).map(vtTag);
    if (!tage.length && m.tag) tage.push(m.tag);
    return tage.length > 0 && tage.every(tagVorbei);
  });
  return { anzahl: frueher.length + vergangen.length, frueher, vergangen };
}
function ampel(f) {
  const r = rueckstand(f);
  if (!r) return "";
  const voraus = !r.anzahl && f.Aufgaben.some((a) => /vorgezogen aus/.test(a.Titel) && eMat(a.MaterialID).stand === 4);
  const [farbe, text] = r.anzahl > 3 ? ["rot", `${r.anzahl} im Rückstand`] : r.anzahl ? ["gelb", `${r.anzahl} im Rückstand`] : voraus ? ["blau", "voraus"] : ["gruen", "im Plan"];
  return `<span class="ampel ampel-${farbe}"><i aria-hidden="true"></i>${text}</span>`;
}
// Teil 1/2: Die Stoffverteilung hat eine Aufgabe auf mehrere Zeiten verteilt
function teilMarke(v) {
  const alle = verteilung().filter((x) => x.MaterialID && x.MaterialID === v.MaterialID).sort(sortVt);
  return alle.length > 1 ? `<span class="teil">Teil ${alle.indexOf(v) + 1}/${alle.length}</span>` : "";
}
// Kasten oben in der Woche: offene Pflichtaufgaben früherer Wochen (aus der Datenbank, ohne das, was hier schon fertig ist)
function offenKasten() {
  const p = paket(), pflichtFaecher = p.Faecher.filter((f) => !f.Optional).map((f) => f.Fach);
  const l = (p.OffenVorwochen || []).filter((x) => pflichtFaecher.includes(x.FachID) && !lokalErledigt(x));
  let h = "";
  if (l.length) h += `<details class="hinweis offen"><summary><strong>Offen aus früheren Wochen: ${l.length} Pflichtaufgaben</strong></summary><ul class="versuche">` +
    l.map((x) => `<li>${esc(x.FachID)} · ${esc(x.WocheID)} · ${esc(x.Titel)}</li>`).join("") + `</ul><p class="leise">Sie kommen nicht von selbst in diese Woche. Am Sonntag mit Mama oder Papa entscheiden: nachholen, später oder streichen.</p></details>`;
  const viel = p.Faecher.filter((f) => f.Aufgaben.filter((a) => a.KernVertiefung === "Kern" && /nachgeholt aus/.test(a.Titel)).length > 3);
  if (viel.length) h += `<div class="hinweis nachhaken">In ${esc(viel.map((f) => f.Fach).join(", "))} holst du mehr als 3 Aufgaben nach. Sprich mit Mama oder Papa, ob der Plan angepasst werden muss.</div>`;
  return h;
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
    ${mitFach ? `<span class="fachname"><i class="punkt"></i>${esc(f.Fach)}</span>` : ""}
    ${kartenKopf(`<div class="titel">${esc(a.Titel)}</div><div class="meta">${artZeichen(a)} · ${esc(meta)}</div>`, "stand", m.stand || 0, id, m.sitzt || "")}
    <p>${esc(a.Anweisung)}</p>
    ${m.weg ? `<p class="leise">Lasse ich weg.</p>` : planZeile(a, m, id)}
    ${ikonLeiste(f, a, m, id, true)}
  </div>`;
}

// ---------------------------------------------------------------- Seiten
// Eine Karte für eine Zeile der Stoffverteilung: Aufnehmen zeigt die Aufgabe, Üben und Zeigen eine eigene Karte
function vtKarte(v) {
  const p = paket(), f = p.Faecher.find((x) => x.Fach === v.FachID);
  if (!f) return "";
  const a = v.MaterialID && f.Aufgaben.find((x) => x.MaterialID === v.MaterialID);
  const kopf = `<div class="zeile kopfzeile"><span class="fachname">${esc(f.Fach)} · ${esc(v.Art)}</span>${teilMarke(v)}${marke(v)}<span class="leise">${v.Minuten ? v.Minuten + " Min." : ""}</span></div>`;
  if (a) {
    const m = eMat(a.MaterialID), id = `data-id="${a.MaterialID}"`;
    const meta = [kurzQuelle(a.Quelle), a.Fundstelle, a.Minuten ? "insgesamt " + a.Minuten + " Min." : ""].filter(Boolean).join(" · ");
    return `<div class="karte fach ${m.stand === 4 ? "fertig" : ""} ${m.weg ? "weg" : ""}" style="--farbe:${esc(f.Farbe)}">${kopf}
      ${kartenKopf(`<div class="titel">${esc(a.Titel)}</div><div class="meta">${artZeichen(a)} · ${esc(meta)}</div>`, "stand", m.stand || 0, id, m.sitzt || "")}
      <p>${esc(a.Anweisung)}</p>${m.weg ? `<p class="leise">Lasse ich weg.</p>` : ""}
      ${ikonLeiste(f, a, m, id, false)}${verschieben(v)}</div>`;
  }
  const o = eVt(v.VerteilungID), x = `data-id="${v.VerteilungID}"`;
  return `<div class="karte fach ${o.stand === 4 ? "fertig" : ""}" style="--farbe:${esc(f.Farbe)}">${kopf}
    ${kartenKopf(v.Art === "Üben" ? `<p class="beispiel">${/Bahn/.test(vtFenster(v)) ? UEBEN_BAHN : UEBEN_TISCH}</p>` : `<div class="titel">${v.Art === "Zeigen" ? '<span aria-hidden="true">🎤</span> ' : ""}${esc(v.Beschreibung || v.Art)}</div>`, "vt-stand", o.stand || 0, x)}
    ${v.Art === "Üben" ? feld("vt-was", o.was || "", "Was übe ich? (Seite, Aufgaben)", x) : ""}${verschieben(v)}</div>`;
}
// Ein Tag: Termine, dann die Stoffverteilung nach Zeitfenstern
function seiteTag(tag, istHeute) {
  const p = paket(), vs = verteilung().filter((v) => vtTag(v) === tag).sort(sortVt);
  const wt = (iso) => TAGE[(datum(iso).getDay() + 6) % 7];
  let h = "";
  const termine = (p.Termine || []).filter((t) => t.Datum && wt(t.Datum) === tag && t.Datum >= p.Woche.StartDatum && t.Datum <= p.Woche.EndDatum);
  if (termine.length) h += `<h2><span aria-hidden="true">📅</span> Termine</h2>` + termine.map((t) => `<div class="karte"><div class="titel">${t.Uhrzeit ? esc(t.Uhrzeit) + " Uhr · " : ""}${esc(t.FachID)}${t.PersonName ? " mit " + esc(t.PersonName) : ""}</div><div class="meta">${t.Ort ? esc(t.Ort) + " · " : ""}${esc(t.Art || "")}${t.Status ? " · " + esc(t.Status) : ""}</div></div>`).join("");
  // Der ganze Tag in zeitlicher Reihenfolge: jede Schulstunde laut Stundenplan, dazu Bahn und Termine.
  // Stunden ohne Stoff stehen klein da (teilnehmen, Pause, Weg, frei), damit Emil sieht, was dazwischen ist.
  const plaetze = new Map();
  const platz = (fenster) => { if (!plaetze.has(fenster)) plaetze.set(fenster, { fenster, start: fenster.slice(0, 5), stunde: null, eintraege: [] }); return plaetze.get(fenster); };
  if (vs.length) for (const s of (p.Stundenplan || []).filter((x) => x.Wochentag === tag && x.Reihenfolge >= 2 && x.ZeitBis)) platz(s.ZeitVon + "-" + s.ZeitBis).stunde = s;
  for (const v of vs) platz(vtFenster(v)).eintraege.push(v);
  for (const pl of [...plaetze.values()].sort((a, b) => a.start.localeCompare(b.start))) {
    if (pl.eintraege.length) { h += `<h2><span aria-hidden="true">${ortZeichen(pl.fenster)}</span> ${esc(fensterText(tag, pl.fenster))}</h2>` + pl.eintraege.map(vtKarte).join(""); continue; }
    const s = pl.stunde, bem = (s && s.Bemerkung) || "";
    const was = /^Pause/i.test(s.Inhalt) ? "Pause" : /^Weg /i.test(bem) ? "Weg zwischen Schule und Bahnhof" : s.Teilnahme === "P" ? "Pflicht, teilnehmen" : /wichtig/i.test(bem) ? "dir wichtig, teilnehmen" : s.FachID ? "Selbstlernen, nichts eingeplant" : "frei";
    h += `<div class="stunde ${was === "frei" ? "" : "dabei"}"><span class="zeit">${esc(pl.fenster.replace("-", "–"))}</span><span><strong>${esc(s.Inhalt)}</strong> · ${esc(was)}</span></div>`;
  }
  if (!vs.length) h += `<p class="leise">${istHeute ? "Für heute" : "Für diesen Tag"} ist nichts eingeplant.</p>`;
  // eigene Übungen, die Emil selbst auf diesen Tag gelegt hat
  let eigene = "";
  for (const f of p.Faecher) eFach(f.Fach).ueben.forEach((u, i) => { if (u.tag === tag) eigene += uebenKarte(f, u, i, true); });
  if (eigene) h += `<h2>Meine Übungen</h2>` + eigene;
  return h;
}
// Konzentration 25 / 5: nur eine Hilfe zum Dranbleiben, misst keine Lernzeit
const POMO = { lernen: 25 * 60, pause: 5 * 60 };
let pomo = { phase: "lernen", rest: POMO.lernen, ende: null };
const mmss = (sek) => `${String(Math.floor(sek / 60)).padStart(2, "0")}:${String(Math.max(0, Math.round(sek % 60))).padStart(2, "0")}`;
function pomoKarte() {
  return `<div class="karte pomo"><div class="titel">Konzentration 25 / 5</div>
    <p class="leise">Nur eine Hilfe zum Dranbleiben. Sie misst keine Lernzeit.</p>
    <div class="pomo-zeit" id="pomo-zeit" aria-live="off">${mmss(pomo.rest)}</div><p class="pomo-phase" id="pomo-phase">${pomo.phase === "lernen" ? "Lernen" : "Pause"}</p>
    <div class="zeile"><button class="knopf haupt" data-a="pomo-start" id="pomo-knopf">${pomo.ende ? "Anhalten" : "Start"}</button><button class="knopf" data-a="pomo-reset">Zurücksetzen</button></div></div>`;
}
function pomoTick() {
  if (!pomo.ende) return;
  pomo.rest = (pomo.ende - Date.now()) / 1000;
  if (pomo.rest <= 0) {                                   // Phase vorbei: kurz vibrieren und piepen, dann die andere Phase starten
    pomo.phase = pomo.phase === "lernen" ? "pause" : "lernen"; pomo.rest = POMO[pomo.phase]; pomo.ende = Date.now() + pomo.rest * 1000;
    try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch (e) { /* ohne Vibration */ }
    try { const c = new (window.AudioContext || window.webkitAudioContext)(), o = c.createOscillator(); o.frequency.value = 880; o.connect(c.destination); o.start(); o.stop(c.currentTime + 0.4); } catch (e) { /* ohne Ton */ }
  }
  const z = document.getElementById("pomo-zeit"), ph = document.getElementById("pomo-phase");
  if (z) z.textContent = mmss(pomo.rest);
  if (ph) ph.textContent = pomo.phase === "lernen" ? "Lernen" : "Pause";
}
setInterval(pomoTick, 1000);
// Was unterwegs geht: Videos, Hören, Online lesen oder üben (kein Buch)
const unterwegs = (a) => !!a.URL && medium(a).art !== "PDF";
function tagNotiz(tag) { const e = eintraege(); if (!e.tage) e.tage = {}; if (!e.tage[tag]) e.tage[tag] = {}; return e.tage[tag]; }
// Hilfe-Anfragen, bei denen niemand erreicht wurde: orange oben auf Heute
function nachhakenKasten() {
  const p = paket(), l = [];
  for (const f of p.Faecher) for (const a of f.Aufgaben) { const m = eintraege().mat[a.MaterialID]; if (m && hilfeStatus(m) === "nachhaken") l.push([f, a, m.hilfe[m.hilfe.length - 1]]); }
  return l.length ? `<div class="hinweis nachhaken"><strong>Nachhaken:</strong> ` + l.map(([f, a, x]) => `${esc(a.Titel)} (${esc(f.Fach)}): ${esc(x.person)} nicht erreicht. <button class="link" data-a="fach" data-w="${esc(f.Fach)}">Zur Aufgabe</button>`).join("<br>") + `</div>` : "";
}
function seiteHeute() {
  const p = paket();
  if (!p) return ohnePaket();
  const tag = heuteTag(), heute = heuteIso();
  let h = nachhakenKasten();
  const inWoche = heute >= p.Woche.StartDatum && heute <= p.Woche.EndDatum;
  if (!inWoche) h += `<div class="hinweis">Geladen ist ${esc(p.Woche.WocheID)} (${kurzDatum(p.Woche.StartDatum)} bis ${kurzDatum(p.Woche.EndDatum)}). Heute liegt nicht in dieser Woche.</div>`;
  if (p.Plan.PruefungAb) {
    const tage = Math.ceil((datum(p.Plan.PruefungAb) - new Date()) / 86400000);
    if (tage >= 0) h += `<p class="leise">Noch ${tage} Tage bis zur ersten Prüfung.</p>`;
  }
  if (verteilung().length) {
    // heute fertig x von y (Aufnehmen, Üben, Zeigen aus der Stoffverteilung)
    const heuteVs = verteilung().filter((v) => vtTag(v) === tag);
    const fertig = heuteVs.filter((v) => (v.MaterialID ? eMat(v.MaterialID).stand : eVt(v.VerteilungID).stand) === 4).length;
    if (heuteVs.length) h += `<div class="karte heutekopf"><div class="titel">Heute fertig: ${fertig} von ${heuteVs.length}</div><div class="balken"><span style="width:${Math.round(fertig / heuteVs.length * 100)}%"></span></div></div>`;
    h += `<div class="zeile">${chips("bahn", [["", "Alles"], ["1", "Bahn-Modus"]], Z.bahn ? "1" : "")}</div>`;
    if (Z.bahn) {
      // Bahn-Modus: die Bahnfahrten von heute und alles, was unterwegs geht
      const bahnVs = heuteVs.filter((v) => /Bahn/.test(vtFenster(v))).sort(sortVt);
      h += bahnVs.length ? `<h2><span aria-hidden="true">🚆</span> Bahnfahrten heute</h2>` + bahnVs.map(vtKarte).join("") : `<p class="leise">Heute sind keine Bahnfahrten eingeplant.</p>`;
      // höchstens 6 Karten: erst Pflicht, dann freiwillig
      const mehr = [];
      for (const f of p.Faecher) for (const a of f.Aufgaben) {
        const m = eMat(a.MaterialID);
        if (unterwegs(a) && !m.weg && m.stand !== 4 && !bahnVs.some((v) => v.MaterialID === a.MaterialID)) mehr.push([f, a]);
      }
      mehr.sort((x, y) => (x[1].KernVertiefung === "Kern" ? 0 : 1) - (y[1].KernVertiefung === "Kern" ? 0 : 1));
      h += `<h2>Geht auch unterwegs</h2><p class="leise">Videos, Hören und Online-Texte, die noch offen sind. Erst Pflicht, dann freiwillig.</p>` +
        (mehr.slice(0, 6).map(([f, a]) => aufgabeKarte(f, a, true)).join("") || `<p class="leise">Alles erledigt.</p>`) +
        (mehr.length > 6 ? `<p class="leise">und ${mehr.length - 6} weitere unter Woche bei den Fächern.</p>` : "");
    } else h += seiteTag(tag, true);
    h += pomoKarte();
    h += `<h3>Notiz zum Tag</h3>${notizFeld("tag-notiz", tagNotiz(tag).notiz, tagNotiz(tag).art, "Wie lief es heute? Was war schwierig?", `data-tag="${tag}"`)}`;
    const ohne = p.Faecher.reduce((n, f) => n + pflicht(f).filter((a) => a.Phase !== 1 && a.Phase !== 4 && !eMat(a.MaterialID).weg && eMat(a.MaterialID).stand !== 4 && !verteilung().some((v) => v.MaterialID === a.MaterialID)).length, 0);
    if (ohne) h += `<div class="hinweis">${ohne} Pflichtaufgaben haben keine Zeit in der Stoffverteilung. <button class="link" data-a="seite" data-w="woche">Zur Woche</button></div>`;
    return h;
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
  h += offenKasten();
  if (verteilung().length) {
    h += `<h2>Nach Tagen</h2><div class="karte"><ul class="liste">` + TAGE.map((t) => {
      const vs = verteilung().filter((v) => vtTag(v) === t), min = vs.reduce((s, v) => s + (v.Minuten || 0), 0);
      const fae = [...new Set(vs.map((v) => v.FachID))].join(", ");
      return vs.length ? `<li><button class="link tagzeile" data-a="tagansicht" data-w="${t}"><strong>${t}</strong> · ${vs.length} Einträge · ${Math.round(min / 6) / 10} Std.<br><span class="leise">${esc(fae)}</span></button></li>` : "";
    }).join("") + `</ul></div><h2>Nach Fächern</h2>`;
  }
  const freiwillig = p.Faecher.filter((f) => f.Optional);
  for (const f of p.Faecher.filter((x) => !x.Optional)) {
    const fs = fortschritt(f), e = eFach(f.Fach), t = f.Termin;
    h += `<div class="karte fach" style="--farbe:${esc(f.Farbe)}">
      <div class="zeile kopfzeile"><span class="fachname">${esc(f.Fach)}</span>${ampel(f)}</div>
      <div class="titel">${esc(f.Thema)}</div>
      <div class="meta">Paket: ${esc(f.Paket || "–")}${f.PaketSpaetestensBis ? " · bis " + kurzDatum(f.PaketSpaetestensBis) : ""}</div>
      <div class="balken"><span style="width:${Math.round(fs.anteil * 100)}%"></span></div>
      <p class="leise">Aufnehmen ${fs.fertig} von ${fs.anzahl} fertig · Üben ${e.ueben.length} geplant · Start-Check ${e.einstufung ? esc(e.einstufung) : "offen"}</p>
      <p class="leise">Zeig-Termin: ${zeigTermin(f)}</p>
      <button class="knopf haupt voll" data-a="fach" data-w="${esc(f.Fach)}">Öffnen</button>
    </div>`;
  }
  // Freiwillige Fächer (Physik, Chemie): Thema der Woche sehen, alles darf, nichts muss
  if (freiwillig.length) h += `<h2>Freiwillige Fächer</h2><p class="leise">Du entscheidest, ob und wie viel du machst. Vorschlag: die NaWi-Stunden am Montag.</p>` + freiwillig.map((f) => {
    const fs = fortschritt(f);
    return `<div class="karte fach" style="--farbe:${esc(f.Farbe)}"><span class="fachname">${esc(f.Fach)} · freiwillig</span>
      <div class="titel">${esc(f.Thema)}</div>
      <div class="balken"><span style="width:${Math.round(fs.anteil * 100)}%"></span></div>
      <p class="leise">${fs.fertig} von ${fs.anzahl} Aufgaben fertig</p>
      <button class="knopf voll" data-a="fach" data-w="${esc(f.Fach)}">Ansehen</button></div>`;
  }).join("");
  const e = eintraege();
  h += `<h3>Notiz zur Woche</h3>` + notizFeld("woche-notiz", e.wocheNotiz, e.wocheNotizArt, "Was fällt dir zu dieser Woche ein? Fragen, Ideen", "");
  return h;
}

// ---------------------------------------------------------------- Fortschritt
function seiteFortschritt() {
  const p = paket();
  if (!p) return ohnePaket();
  let h = "";
  // Zeitlinie über alle Wochen: jetzt, Ferien, Ferienwochen, Wiederholung, Prüfung
  const wochen = p.Wochen || [], heute = heuteIso();
  if (wochen.length) {
    const klasse = (w) => (/Wiederholung/.test(w.Art) ? "wdh" : /Ferienwoche/.test(w.Art) ? "fw" : /Ferien/.test(w.Art) ? "ferien" : "lern");
    h += `<h2>Dein Weg bis zur Prüfung</h2><div class="zeitlinie" role="img" aria-label="Zeitlinie über ${wochen.length} Wochen">` +
      wochen.map((w) => `<span class="${klasse(w)} ${w.WocheID === p.Woche.WocheID ? "jetzt" : ""} ${w.EndDatum < heute ? "vorbei" : ""}" title="${esc(w.WocheID)} ab ${esc(kurzDatum(w.StartDatum))} · ${esc(w.Art)}"></span>`).join("") +
      `<span class="pruefung" title="Prüfung">P</span></div>
      <div class="legende"><span><i class="lern"></i>Lernwoche</span><span><i class="fw"></i>Ferienwoche (halb)</span><span><i class="ferien"></i>Ferien</span><span><i class="wdh"></i>Wiederholung</span><span><i class="jetzt"></i>jetzt (${esc(p.Woche.WocheID)})</span></div>`;
  }
  if (p.Plan.PruefungAb) { const tage = Math.ceil((datum(p.Plan.PruefungAb) - new Date()) / 86400000); if (tage >= 0) h += `<p class="leise">Noch ${tage} Tage bis zur ersten Prüfung am ${esc(kurzDatum(p.Plan.PruefungAb))}</p>`; }
  h += nachhakenKasten();
  // je Fach: Ampel, diese Woche, ganzes Schuljahr (Stand der Datenbank)
  h += `<h2>Fächer</h2>`;
  for (const f of [...p.Faecher.filter((x) => !x.Optional), ...p.Faecher.filter((x) => x.Optional)]) {
    const fs = fortschritt(f), g = (p.Gesamt || []).find((x) => x.FachID === f.Fach), r = rueckstand(f);
    h += `<div class="karte fach" style="--farbe:${esc(f.Farbe)}"><div class="zeile kopfzeile"><span class="fachname">${esc(f.Fach)}${f.Optional ? " · freiwillig" : ""}</span>${ampel(f)}</div>
      <p class="leise">Diese Woche: ${fs.fertig} von ${fs.anzahl} Pflichtaufgaben fertig</p><div class="balken"><span style="width:${Math.round(fs.anteil * 100)}%"></span></div>` +
      (g && g.Anzahl ? `<p class="leise">Schuljahr: ${Math.round(g.Fertig / g.Anzahl * 100)} % geschafft · bis zu dieser Woche geplant ${Math.round(g.BisJetzt / g.Anzahl * 100)} %</p><div class="balken jahr"><span style="width:${Math.round(g.Fertig / g.Anzahl * 100)}%"></span><b style="left:${Math.round(g.BisJetzt / g.Anzahl * 100)}%"></b></div>` : "") +
      (r && r.anzahl ? `<details><summary class="leise">Was ist im Rückstand?</summary><ul class="versuche">` + [...r.frueher.map((x) => `${x.WocheID}: ${x.Titel}`), ...r.vergangen.map((a) => `diese Woche: ${a.Titel}`)].map((t) => `<li>${esc(t)}</li>`).join("") + `</ul></details>` : "") +
      `<button class="knopf voll" data-a="fach" data-w="${esc(f.Fach)}">Zum Fach</button></div>`;
  }
  // was nicht sitzt
  const wackelig = [];
  for (const f of p.Faecher) for (const a of f.Aufgaben) { const m = eintraege().mat[a.MaterialID]; if (m && (m.sitzt === "unsicher" || m.sitzt === "nicht verstanden")) wackelig.push([f, a, m.sitzt]); }
  h += `<h2>Unsicher oder nicht verstanden</h2>` + (wackelig.length ? `<ul class="liste">` + wackelig.map(([f, a, w]) => `<li>${sitztZeichen(w, 24)}<span><strong>${esc(f.Fach)}:</strong> ${esc(a.Titel)}<br><button class="link" data-a="fach" data-w="${esc(f.Fach)}">Zur Aufgabe</button></span></li>`).join("") + `</ul>` : `<p class="leise">Nichts markiert. Wenn etwas nicht sitzt: am Titel auf die Sanduhr tippen.</p>`);
  h += `<p class="leise">Der Stand fürs Schuljahr kommt aus der Datenbank (Wochenpaket vom ${esc(String(p.Erstellt || "").slice(0, 10).split("-").reverse().join("."))}). Neu wird er, wenn deine Rückmeldung eingelesen ist.</p>`;
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

// Zeig-Termin: eingetragener Termin, sonst der Vorschlag aus der Stoffverteilung (lila), sonst offen
function zeigTermin(f) {
  const t = f.Termin;
  if (t) return `${kurzDatum(t.Datum)} ${t.Uhrzeit ? esc(t.Uhrzeit) + " Uhr" : esc(t.Zeitraum || "")}${t.PersonName ? " mit " + esc(t.PersonName) : ""}${t.Ort ? ", " + esc(t.Ort) : ""}`;
  const z = verteilung().filter((v) => v.FachID === f.Fach && v.Art === "Zeigen").sort(sortVt)[0];
  if (z) return `<span class="${istVorschlag(z) ? "lila" : ""}">${esc(vtTag(z))} ${esc(fensterText(vtTag(z), vtFenster(z)))} · ${esc(z.Beschreibung || "")}</span>`;
  return "noch offen, am Sonntag festlegen";
}
function seiteFach() {
  const p = paket(), f = p && p.Faecher.find((x) => x.Fach === ansicht.fach);
  if (!f) { ansicht.seite = "woche"; return seiteWoche(); }
  const e = eFach(f.Fach), x = `data-fach="${esc(f.Fach)}"`, t = f.Termin;
  let h = `<button class="link" data-a="seite" data-w="woche">‹ Zur Woche</button>
    <div class="karte fach" style="--farbe:${esc(f.Farbe)}">
      <span class="fachname">${esc(f.Fach)}${f.Optional ? " · freiwillig" : ""}</span><div class="titel">${esc(f.Thema)}</div>
      ${f.Optional ? `<p class="leise">Ein freiwilliges Fach: Du entscheidest, ob und wie viel du machst.</p>` : ""}
      <p><strong>Ziel:</strong> ${esc(f.Lernziel)}</p>
      <p class="leise">Paket: ${esc(f.Paket || "–")}${f.PaketErsteWoche ? ` (${esc(f.PaketErsteWoche)}${f.PaketLetzteWoche !== f.PaketErsteWoche ? " bis " + esc(f.PaketLetzteWoche) : ""})` : ""}${f.PaketSpaetestensBis ? " · spätestens bis " + kurzDatum(f.PaketSpaetestensBis) : ""}</p>
      <p><strong>Zeig-Termin:</strong> ${zeigTermin(f)}</p>
    </div>`;

  h += `<h3>1 · Stand prüfen</h3>` + vorschlaege(f, "Start-Check").map((v) => `<p>${esc(v.Vorschlagstext)}</p>`).join("") +
    `<div class="karte"><p class="leise">Erst schätzen, dann testen.</p>
      <div class="drei"><label>Vorhersage${feld("vorhersage", e.vorhersage ?? "", "", x, "number")}</label><label>Ergebnis${feld("ergebnis", e.ergebnis ?? "", "", x, "number")}</label><label>von (höchstens)${feld("max", e.max ?? "", "", x, "number")}</label></div>
      <div class="zeile">${chips("einstufung", [["neu", "neu"], ["teilweise", "teilweise"], ["sicher", "sicher"]], e.einstufung, x)}</div>
      ${e.einstufung === "sicher" ? `<p class="leise">Sicher heißt: Der Test hat es gezeigt, nicht das Gefühl. Dann darfst du unten Aufgaben weglassen.</p>` : ""}</div>`;

  h += `<h3>2 · Aufnehmen – das musst du diese Woche lernen</h3>` + (pflicht(f).map((a) => aufgabeKarte(f, a, false)).join("") || `<p class="leise">Im Plan steht hier nichts.</p>`);

  h += `<h3>3 · Üben – das legst du am Wochenanfang selbst fest</h3>
    <p class="leise">Geh die Seiten von oben durch: Was willst du üben, mit welchen Aufgaben auf welcher Seite, wie und wann?${f.UebungsMin ? ` Du hast dafür ${f.UebungsMin} Min. freie Übungszeit.` : ""}</p>` +
    verteilung().filter((v) => v.FachID === f.Fach && v.Art === "Üben").sort(sortVt).map(vtKarte).join("") +
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
  h += `<h3>Notiz zum Fach</h3>${notizFeld("notiz", e.notiz, e.notizArt, "Fragen, Schwieriges, Ideen", x)}`;
  return h;
}

// gewählte Ursachen als Liste (frühere Version speicherte nur eine)
const ursachen = (r) => (Array.isArray(r.ursache) ? r.ursache : r.ursache ? [r.ursache] : []);
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
    <div class="zeile"><span class="leise">Ursache (mehrere möglich)</span><div class="chips" role="group">${URSACHEN.map((u) => `<button class="chip" data-a="r-ursache" data-w="${u}" aria-pressed="${ursachen(r).includes(u)}">${u}</button>`).join("")}</div></div>
    ${ursachen(r).includes("Sonstiges") ? `<label>Sonstiges, und zwar${feld("r-ursacheText", r.ursacheText || "", "", "")}</label>` : ""}
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
    <p class="leise">Zeiträume: ${Object.values(ZEITEN).join(", ")}.</p>
    <h3>Die Symbole</h3>
    <ul class="liste symbole">
      <li>${torte(0, 26)}${torte(2, 26)}${torte(4, 26)}<span><strong>Wie weit?</strong> Leer, ¼, ½, ¾ oder voll. Voll heißt fertig. Antippen zum Ändern.</span></li>
      <li>${sitztZeichen("", 26)}${sitztZeichen("sitzt", 26)}<span><strong>Wie sitzt es?</strong> Sanduhr: noch nicht eingeschätzt. Haken: sitzt.</span></li>
      <li>${sitztZeichen("unsicher", 26)}${sitztZeichen("nicht verstanden", 26)}<span>Gelb: unsicher. Rot: nicht verstanden. Dann frag nach.</span></li>
      <li>${ikon("welt", 26)}${ikon("film", 26)}<span><strong>Öffnen:</strong> Webseite, Video, Hören, PDF oder Online-Übung.</span></li>
      <li>${ikon("notiz", 26)}<span><strong>Notiz</strong> zu dieser Aufgabe. Ein Punkt zeigt, dass schon eine da ist.</span></li>
      <li>${ikon("birne", 26)}<span><strong>Lerntechnik:</strong> wie du diese Aufgabe gut lernen kannst.</span></li>
      <li><span class="fahne gemeldet">${ikon("fahne", 24)}</span><span><strong>Link melden,</strong> wenn ein Link nicht geht oder etwas nicht stimmt. Orange heißt: gemeldet.</span></li>
      <li>${ikon("joker", 26)}<span><strong>Hilfe holen:</strong> Person wählen, Nachricht steht schon da. Blau angefragt, orange nachhaken, grün Termin, grau geklärt.</span></li>
      <li>${ikon("uhr", 26)}<span><strong>Arbeitszeit</strong> eintragen, wenn du magst: von–bis oder Dauer. Zeigt „geplant · gebraucht“.</span></li>
      <li>${ikon("mikro", 26)}<span><strong>Sprechen statt tippen</strong> bei Notizen. Der Text erscheint im Feld und du kannst ihn verbessern.</span></li>
      <li><span class="ampel ampel-gruen"><i></i>im Plan</span><span><strong>Ampel:</strong> grün im Plan, gelb 1–3 im Rückstand, rot mehr als 3, blau voraus.</span></li>
      <li>${ikon("mond", 26)}<span>Oben rechts: hell oder dunkel.</span></li>
    </ul>
    ${notizUebersicht()}
    ${gemeldeteLinks()}
    <h3>Daten</h3>
    <p class="leise">Alles liegt nur auf diesem Gerät. Sichere es, bevor du den Browser leerst.</p>
    <div class="zeile"><button class="knopf" data-a="sichern">Alles sichern</button><button class="knopf" data-a="laden">Sicherung einlesen</button></div>
    <p class="leise">Schulplaner App ${APP_VERSION}</p>`;
}

// Alle Notizen aus allen geladenen Wochen, mit Filter nach Art, Ebene, Fach und Woche
function alleNotizen() {
  const l = [];
  for (const [w, e] of Object.entries(Z.e)) {
    const p = Z.pakete[w];
    const titel = (id) => { for (const f of (p ? p.Faecher : [])) { const a = f.Aufgaben.find((x) => String(x.MaterialID) === String(id)); if (a) return [f.Fach, a.Titel]; } return ["", ""]; };
    for (const [id, m] of Object.entries(e.mat || {})) if (m.notiz) { const [fach, t] = titel(id); l.push({ woche: w, ebene: "Aufgabe", fach, wo: t, art: m.notizArt, text: m.notiz, gesprochen: m.notizGesprochen }); }
    for (const [tag, x] of Object.entries(e.tage || {})) if (x.notiz) l.push({ woche: w, ebene: "Tag", fach: "", wo: TAG_LANG[tag] || tag, art: x.art, text: x.notiz, gesprochen: x.gesprochen });
    if (e.wocheNotiz) l.push({ woche: w, ebene: "Woche", fach: "", wo: "", art: e.wocheNotizArt, text: e.wocheNotiz, gesprochen: e.wocheNotizGesprochen });
    for (const [fach, x] of Object.entries(e.fach || {})) if (x.notiz) l.push({ woche: w, ebene: "Fach", fach, wo: "", art: x.notizArt, text: x.notiz, gesprochen: x.notizGesprochen });
  }
  return l;
}
function notizUebersicht() {
  const alle = alleNotizen();
  if (!alle.length) return `<h3>Alle Notizen</h3><p class="leise">Noch keine Notizen.</p>`;
  const nf = ansicht.nf || {}, werte = (k) => [...new Set(alle.map((n) => n[k]).filter(Boolean))].sort().map((v) => [v, v]);
  const l = alle.filter((n) => (!nf.art || n.art === nf.art) && (!nf.ebene || n.ebene === nf.ebene) && (!nf.fach || n.fach === nf.fach) && (!nf.woche || n.woche === nf.woche));
  return `<h3>Alle Notizen</h3><div class="zwei filter">${auswahl("nf-art", NOTIZ_ARTEN, nf.art, "jede Art")}${auswahl("nf-ebene", ["Aufgabe", "Tag", "Woche", "Fach"].map((x) => [x, x]), nf.ebene, "jede Ebene")}${auswahl("nf-fach", werte("fach"), nf.fach, "jedes Fach")}${auswahl("nf-woche", werte("woche"), nf.woche, "jede Woche")}</div>
    <ul class="liste">` + l.map((n) => `<li><span><span class="leise">${esc([n.woche, n.ebene, n.fach, n.wo].filter(Boolean).join(" · "))}${n.art ? ` · <strong>${esc(n.art)}</strong>` : ""}${n.gesprochen ? " · gesprochen" : ""}</span><br>${esc(n.text)}</span></li>`).join("") + `</ul>` + (l.length ? "" : `<p class="leise">Keine Notiz passt zum Filter.</p>`);
}
function gemeldeteLinks() {
  const p = paket(); if (!p) return "";
  const l = []; for (const f of p.Faecher) for (const a of f.Aufgaben) { const m = eintraege().mat[a.MaterialID]; if (m && m.meldung) l.push([f, a, m.meldung]); }
  return l.length ? `<h3>Gemeldete Links</h3><ul class="liste">` + l.map(([f, a, x]) => `<li><span><strong>${esc(f.Fach)}:</strong> ${esc(a.Titel)}<br><span class="leise">${esc(x.grund)}${x.text ? " · " + esc(x.text) : ""}</span></span></li>`).join("") + `</ul>` : "";
}
const ohnePaket = () => `<div class="karte"><div class="titel">Noch kein Wochenpaket</div><p>Lade die Datei für deine Woche. Du bekommst sie am Sonntag aus der Datenbank.</p><button class="knopf haupt voll" data-a="laden">Wochenpaket laden</button></div>`;

// ---------------------------------------------------------------- Zeichnen
const istDunkel = () => Z.theme === "dark" || (Z.theme !== "light" && !!window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
const seiteTagAnsicht = () => (paket() ? `<button class="link" data-a="seite" data-w="woche">‹ Zur Woche</button>` + seiteTag(ansicht.tag, ansicht.tag === heuteTag()) : ohnePaket());
const SEITEN = { heute: ["Heute", seiteHeute], woche: ["Woche", seiteWoche], fortschritt: ["Fortschritt", seiteFortschritt], sonntag: ["Sonntag", seiteSonntag], mehr: ["Mehr", seiteMehr], fach: ["Fach", seiteFach], tag: ["Tag", seiteTagAnsicht] };
function zeichnen(obenBleiben) {
  const y = window.scrollY, p = paket();
  document.documentElement.dataset.theme = Z.theme && Z.theme !== "system" ? Z.theme : "";
  if (!document.documentElement.dataset.theme) delete document.documentElement.dataset.theme;
  document.getElementById("kopf").innerHTML = `<button class="thema" data-a="theme-wechsel" aria-label="${istDunkel() ? "Hell" : "Dunkel"} darstellen">${ikon(istDunkel() ? "sonne" : "mond", 22)}</button><h1>${ansicht.seite === "fach" ? esc(ansicht.fach) : ansicht.seite === "tag" ? esc(tagDatum(ansicht.tag)) : SEITEN[ansicht.seite][0]}</h1><p>${p ? `${esc(p.Plan.Lernende)} · ${esc(p.Woche.WocheID)} · ${kurzDatum(p.Woche.StartDatum)} bis ${kurzDatum(p.Woche.EndDatum)}${p.Umgebung !== "Produktion" ? " · " + esc(p.Umgebung.toUpperCase()) : ""}` : "Schulplaner"}</p>`;
  document.getElementById("inhalt").innerHTML = SEITEN[ansicht.seite][1]();
  document.getElementById("nav").innerHTML = ["heute", "woche", "fortschritt", "sonntag", "mehr"].map((s) => `<button data-a="seite" data-w="${s}" ${ansicht.seite === s || (s === "woche" && (ansicht.seite === "fach" || ansicht.seite === "tag")) ? 'aria-current="page"' : ""}>${SEITEN[s][0]}</button>`).join("");
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
    case "tagansicht": ansicht = { seite: "tag", fach: null, tag: wert }; zeichnen(false); return;
    case "vt-tag": eVt(d.id).tag = wert || null; break;
    case "vt-fenster": eVt(d.id).fenster = wert || null; break;
    case "vt-zurueck": delete eVt(d.id).tag; delete eVt(d.id).fenster; break;
    case "vt-stand": eVt(d.id).stand = Number(wert); ansicht.leiste = null; break;
    case "auf": ansicht.leiste = ansicht.leiste === wert ? null : wert; zeichnen(true); return;
    case "notiz-auf": ansicht.notiz = ansicht.notiz === Number(wert) ? null : Number(wert); zeichnen(true); return;
    case "tipp-auf": ansicht.tipp = ansicht.tipp === Number(wert) ? null : Number(wert); zeichnen(true); return;
    case "sitzt": eMat(d.id).sitzt = wert || null; ansicht.leiste = null; break;
    case "m-notiz": eMat(d.id).notiz = wert; if (d.gesprochen) eMat(d.id).notizGesprochen = true; neu = false; break;
    case "m-notiz-art": eMat(d.id).notizArt = wert || null; neu = false; break;
    case "notiz-art": eFach(d.fach).notizArt = wert || null; neu = false; break;
    case "tag-notiz-art": tagNotiz(d.tag).art = wert || null; neu = false; break;
    case "woche-notiz": eintraege().wocheNotiz = wert; if (d.gesprochen) eintraege().wocheNotizGesprochen = true; neu = false; break;
    case "woche-notiz-art": eintraege().wocheNotizArt = wert || null; neu = false; break;
    case "sprechen": sprechen(el); return;
    case "nf-art": case "nf-ebene": case "nf-fach": case "nf-woche": ansicht.nf = Object.assign(ansicht.nf || {}, { [a.slice(3)]: wert || null }); zeichnen(true); return;
    case "uhr-auf": ansicht.uhr = ansicht.uhr === Number(wert) ? null : Number(wert); zeichnen(true); return;
    case "uhr-art": ansicht.uhrArt = wert; zeichnen(true); return;
    case "zeit-eintragen": {
      const box = el.closest(".aufklapp"), q = (k) => box.querySelector(k), m = eMat(d.id), tag = q(".z-tag").value;
      let min = 0, von = null, bis = null;
      if (q(".z-von")) {
        von = q(".z-von").value; bis = q(".z-bis").value;
        if (!von || !bis) { alert("Bitte von und bis eintragen."); return; }
        min = (Number(bis.slice(0, 2)) * 60 + Number(bis.slice(3))) - (Number(von.slice(0, 2)) * 60 + Number(von.slice(3)));
        if (min <= 0) { alert("bis muss nach von liegen."); return; }
      } else min = Number(q(".z-std").value || 0) * 60 + Number(q(".z-min").value || 0);
      if (!min) return;
      if (!m.zeiten) m.zeiten = [];
      m.zeiten.push({ tag, von, bis, min, zeitraum: von ? zeitraumAus(von) : null });
      break;
    }
    case "zeit-weg": eMat(d.id).zeiten.splice(Number(d.i), 1); break;
    case "theme-wechsel": Z.theme = istDunkel() ? "light" : "dark"; break;
    case "bahn": Z.bahn = wert === "1"; break;
    case "tag-notiz": tagNotiz(d.tag).notiz = wert; if (d.gesprochen) tagNotiz(d.tag).gesprochen = true; neu = false; break;
    case "pomo-start":
      if (pomo.ende) { pomo.rest = (pomo.ende - Date.now()) / 1000; pomo.ende = null; } else pomo.ende = Date.now() + pomo.rest * 1000;
      el.textContent = pomo.ende ? "Anhalten" : "Start"; return;
    case "pomo-reset": pomo = { phase: "lernen", rest: POMO.lernen, ende: null }; zeichnen(true); return;
    case "melden-auf": ansicht.melden = ansicht.melden === Number(wert) ? null : Number(wert); zeichnen(true); return;
    case "melden": { const m = eMat(d.id); m.meldung = { grund: wert, text: (m.meldung && m.meldung.text) || "", am: new Date().toISOString() }; break; }
    case "melden-text": if (eMat(d.id).meldung) eMat(d.id).meldung.text = wert; neu = false; break;
    case "melden-weg": delete eMat(d.id).meldung; break;
    case "hilfe-auf": ansicht.hilfe = ansicht.hilfe === Number(wert) ? null : Number(wert); zeichnen(true); return;
    case "hilfe-person": {
      const f = paket().Faecher.find((x) => x.Aufgaben.some((y) => String(y.MaterialID) === String(d.id))), a = f && f.Aufgaben.find((y) => String(y.MaterialID) === String(d.id));
      eMat(d.id).hilfeEntwurf = wert ? { person: wert, text: hilfeText(f, a, wert) } : null; break;
    }
    case "hilfe-text": if (eMat(d.id).hilfeEntwurf) eMat(d.id).hilfeEntwurf.text = wert; neu = false; break;
    case "hilfe-weg": case "hilfe-signal": {
      const m = eMat(d.id), e = m.hilfeEntwurf || {};
      if (!m.hilfe) m.hilfe = [];
      m.hilfe.push({ person: e.person, weg: a === "hilfe-signal" ? "Signal" : wert, am: new Date().toISOString(), ergebnis: null, termin: null });
      if (a === "hilfe-signal") {                          // Signal kann keinen Text vorbelegen: Text kopieren, dann Signal öffnen
        try { navigator.clipboard.writeText(e.text || ""); } catch (x) { /* ohne Zwischenablage */ }
        alert("Der Text ist kopiert. In Signal einfach einfügen.");
        window.open(wert, "_blank", "noopener");
      }
      speichern(); setTimeout(() => zeichnen(true), 400); return;   // Link erst öffnen lassen, dann neu zeichnen
    }
    case "hilfe-kopieren": { const e = eMat(d.id).hilfeEntwurf || {}; try { navigator.clipboard.writeText(e.text || ""); el.textContent = "kopiert"; } catch (x) { /* ohne Zwischenablage */ } return; }
    case "hilfe-ergebnis": { const l = eMat(d.id).hilfe || []; if (l.length) l[l.length - 1].ergebnis = wert; break; }
    case "hilfe-termin": { const l = eMat(d.id).hilfe || []; if (l.length) l[l.length - 1].termin = wert; break; }
    case "vt-was": eVt(d.id).was = wert; neu = false; break;
    case "woche": if (wert) Z.woche = wert; break;
    case "stand": eMat(d.id).stand = Number(wert); ansicht.leiste = null; break;
    case "tag": eMat(d.id).tag = wert || null; break;
    case "zeit": eMat(d.id).zeit = wert || null; break;
    case "weg": eMat(d.id).weg = !eMat(d.id).weg; break;
    case "frei": eFach(d.fach).frei[d.id] = el.checked; neu = false; break;
    case "vorhersage": case "ergebnis": case "max": eFach(d.fach)[a] = zahl(wert); neu = false; break;
    case "einstufung": case "groesse": eFach(d.fach)[a] = eFach(d.fach)[a] === wert ? null : wert; break;
    case "zeig": eFach(d.fach).zeig = wert; break;
    case "zeigEigen": case "lasseWeg": case "nehmeDazu": case "notiz": eFach(d.fach)[a] = wert; if (a === "notiz" && d.gesprochen) eFach(d.fach).notizGesprochen = true; neu = false; break;
    case "u-neu": eFach(d.fach).ueben.push({ was: "", wie: "", tag: "", stand: 0 }); break;
    case "u-weg": eFach(d.fach).ueben.splice(Number(d.i), 1); break;
    case "u-was": eFach(d.fach).ueben[d.i].was = wert; neu = false; break;
    case "u-wie": eFach(d.fach).ueben[d.i].wie = wert; neu = false; break;
    case "u-tag": eFach(d.fach).ueben[d.i].tag = wert; break;
    case "u-stand": eFach(d.fach).ueben[d.i].stand = Number(wert); break;
    case "r-ursache": { const r = eintraege().retro, l = ursachen(r); r.ursache = l.includes(wert) ? l.filter((u) => u !== wert) : [...l, wert]; break; }
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
  const el = ev.target.closest("button[data-a], a[data-a]");
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
    Material: p.Faecher.flatMap((f) => f.Aufgaben.map((a) => ({ a, m: e.mat[a.MaterialID], frei: (e.fach[f.Fach] || {}).frei })).filter((x) => (x.m && (x.m.stand || x.m.tag || x.m.weg || x.m.sitzt || x.m.notiz || x.m.meldung || (x.m.hilfe && x.m.hilfe.length) || summeZeit(x.m))) || (x.frei && x.frei[x.a.MaterialID])).map((x) => ({
      MaterialID: x.a.MaterialID, FortschrittProzent: x.frei && x.frei[x.a.MaterialID] ? 100 : ((x.m && x.m.stand) || 0) * 25, Tag: (x.m && x.m.tag) || null, Zeitraum: (x.m && ZEITEN[x.m.zeit]) || null, Entscheidung: x.m && x.m.weg ? "gestrichen" : "bleibt",
      Einschaetzung: (x.m && x.m.sitzt) || null, Notiz: (x.m && x.m.notiz) || null, NotizArt: (x.m && x.m.notizArt) || null, NotizGesprochen: !!(x.m && x.m.notizGesprochen),
      MinutenIst: x.m && summeZeit(x.m) ? summeZeit(x.m) : null,
      LinkMeldung: x.m && x.m.meldung ? { Grund: x.m.meldung.grund, Text: x.m.meldung.text || null, Am: x.m.meldung.am } : null,
      Hilfe: ((x.m && x.m.hilfe) || []).map((v) => ({ Person: v.person, Weg: v.weg, Am: v.am, Ergebnis: v.ergebnis, Termin: v.termin })) }))),
    TagNotizen: Object.entries(e.tage || {}).filter(([, v]) => v.notiz).map(([t, v]) => ({ Tag: t, Notiz: v.notiz, Art: v.art || null, Gesprochen: !!v.gesprochen })),
    WochenNotiz: e.wocheNotiz ? { Notiz: e.wocheNotiz, Art: e.wocheNotizArt || null, Gesprochen: !!e.wocheNotizGesprochen } : null,
    Faecher: p.Faecher.map((f) => {
      const x = e.fach[f.Fach] || { ueben: [] }, ideen = vorschlaege(f, "Zeigen");
      return { Fach: f.Fach, Paket: f.Paket, Vorhersage: x.vorhersage ?? null, Ergebnis: x.ergebnis ?? null, Maximal: x.max ?? null, StartCheck: x.einstufung || null,
        ZeigIdee: x.zeig === "eigen" ? x.zeigEigen || "eigene Idee" : (ideen[x.zeig] ? ideen[x.zeig].Vorschlagstext : null), Zeigform: x.zeig !== "eigen" && ideen[x.zeig] ? ideen[x.zeig].Zeigform : null,
        Groesse: x.groesse || null, LasseWeg: x.lasseWeg || null, NehmeDazu: x.nehmeDazu || null, Notiz: x.notiz || null, NotizArt: x.notizArt || null, NotizGesprochen: !!x.notizGesprochen,
        Ueben: (x.ueben || []).map((u) => ({ Was: u.was, Wie: u.wie, Tag: u.tag, FortschrittProzent: (u.stand || 0) * 25 })) };
    }),
    // Ursachen als Text, zum Beispiel "Methode, Fokus, Sonstiges: zu müde"
    Retro: { ...e.retro, ursache: ursachen(e.retro).map((u) => (u === "Sonstiges" && e.retro.ursacheText ? "Sonstiges: " + e.retro.ursacheText : u)).join(", ") || null },
    // Stoffverteilung: verschobene Zeilen und Fortschritt bei Üben und Zeigen
    Verteilung: verteilung().filter((v) => { const o = e.vt[v.VerteilungID]; return o && (o.tag || o.fenster || o.stand || o.was); }).map((v) => {
      const o = e.vt[v.VerteilungID];
      return { VerteilungID: v.VerteilungID, Wochentag: vtTag(v), Zeitfenster: vtFenster(v), Verschoben: !istVorschlag(v) && !!(o.tag || o.fenster), FortschrittProzent: (o.stand || 0) * 25, Was: o.was || null };
    }),
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
