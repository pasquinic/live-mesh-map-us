// Langue de l'interface : français (texte d'origine) ou anglais, traduit à l'affichage.
// Le code reste écrit en français ; en anglais, chaque texte affiché (nœuds texte, title, placeholder, aria-label,
// boîtes alert/confirm/prompt) passe par le dictionnaire /i18n/en.json. Les « {} » d'une entrée valent n'importe quel
// morceau variable (nom, nombre…), lui-même traduit s'il est connu. Le contenu des utilisateurs (messages, noms) porte
// translate="no" et n'est jamais touché.
(function () {
  const lire = () => { try { return localStorage.getItem('gaulix_langue'); } catch { return null; } };
  const choix = lire() || 'en'; // US edition: English by default, French still available
  window.LANGUE = choix;
  window.choisirLangue = (l) => { try { localStorage.setItem('gaulix_langue', l); } catch { /* navigation privée */ } location.reload(); };
  // Units shown (US edition): imperial by default (mi, ft, mi², mph, °F), metric on request. The code computes in
  // metric; values are converted at display time, like the translation. Input fields stay metric (their labels say so).
  const unites = (() => { try { return localStorage.getItem('gaulix_unites') || 'imperial'; } catch { return 'imperial'; } })();
  window.UNITES = unites;
  window.choisirUnites = (u) => { try { localStorage.setItem('gaulix_unites', u); } catch { /* navigation privée */ } location.reload(); };
  const NB = '(?<![\\w.,])(-?\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?)';
  const nombre = (x) => Number(String(x).replace(/,/g, ''));
  const ecrire = (v, dec) => { const d = Math.abs(v) >= 10 ? 0 : dec; return Number(v.toFixed(d)).toLocaleString('en-US', { maximumFractionDigits: d }); };
  // value (or range "3–6") + unit → converted value(s) + new unit
  const REGLES = [
    ['km²', (v) => v * 0.386102, 'mi²', 1],
    ['km/h', (v) => v * 0.621371, 'mph', 0],
    ['km', (v) => v * 0.621371, 'mi', 1],
    ['m', (v) => v * 3.28084, 'ft', 0],
    ['°C', (v) => (v * 9) / 5 + 32, '°F', 0],
  ].map(([u, f, nu, dec]) => [new RegExp(`${NB}(?:(\\s?[–-]\\s?)${NB})?(\\s?)${u.replace(/[/]/g, '\\/')}(?![\\w²³/])`, 'g'), f, nu, dec]);
  function imperial(t) {
    if (unites !== 'imperial' || !/\d/.test(t) || !/km|m|°C/.test(t)) return t;
    for (const [re, f, nu, dec] of REGLES) t = t.replace(re, (_, a, sep, b, esp) => ecrire(f(nombre(a)), dec) + (b != null ? sep + ecrire(f(nombre(b)), dec) : '') + esp + nu);
    return t;
  }
  window.imperial = imperial;
  // Traduction d'un texte isolé (pour le code qui en a besoin) : identité en français
  window.tr = (t) => t;
  if (choix !== 'en') return;
  document.documentElement.lang = 'en';

  const exact = new Map(); // texte -> traduction
  const motifs = new Map(); // premier mot littéral (ou '') -> [{ re, en }]
  const prefixes = []; // entrées qui peuvent ouvrir un texte plus long (« Message direct de » + nom)
  const memo = new Map();
  let pret = false;
  const echap = (s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  const norme = (s) => s.replace(/\s+/g, ' ').trim();
  function charger(dico) {
    for (const [fr, en] of Object.entries(dico)) {
      if (!en) continue;
      if (fr.includes('{}')) {
        const parts = fr.split('{}');
        // Deux variables collées : la seconde reste vide (évite les retours arrière sans fin des expressions)
        let src = '^' + echap(parts[0]);
        for (let i = 1; i < parts.length; i++) src += (parts[i - 1] === '' && i > 1 ? '()' : /[a-zà-ÿ]$/i.test(parts[i - 1]) ? '(\\S{0,12}?)' : '([\\s\\S]*?)') + echap(parts[i]);
        const re = new RegExp(src + '$');
        const cle = (parts[0].match(/^\S+/) || [''])[0];
        if (!motifs.has(cle)) motifs.set(cle, []);
        motifs.get(cle).push({ re, en, morceaux: parts.filter((x) => x.trim()), poids: fr.replace(/\{\}/g, '').length });
      } else {
        exact.set(fr, en);
        if (fr.length >= 6 && /[a-zà-ÿ]$|[:…]$/i.test(fr)) prefixes.push(fr);
      }
    }
    for (const l of motifs.values()) l.sort((a, b) => b.poids - a.poids);
    prefixes.sort((a, b) => b.length - a.length);
  }
  // Remplit « Message sur {} » → « Message on {} » ; {0} {1}… pour changer l'ordre
  // Une variable longue restée en français (phrase non reconnue) : le motif ne convient pas, on n'en fait pas un mélange
  // (US edition: node names and other user text are English, so a long variable only counts as French when it has
  // French accents or French function words)
  const MOTS_FR = /[éèêàùçôîœûâëïÉÈÀÊ]|(?<![\p{L}\p{N}_])(le|la|les|des|du|une|est|pour|avec|sur|dans|aux?|par|que|qui|pas|sont|ses|son|sa|leur|depuis|selon|sans|puis|mais|entre|vers|chez|ou|et|il|elle|ils|nous|vous|paquets?|sauts?|relais|passerelles?|réglages?|rediffusion|voisinage|canaux|réseau|carte|jamais|aucun|aucune|toutes?|tous|un|hors|ligne|fois|connecter|relier|tâches?|terminée?)(?![\p{L}\p{N}_])/iu;
  const MOTS_FR_G = new RegExp(MOTS_FR.source, 'giu');
  const phraseFr = (v) => v.length > 20 && /[a-zà-ÿ]{3,}[ ’'][a-zà-ÿ]{2,} [a-zà-ÿ]{3,}/i.test(v) && MOTS_FR.test(v);
  function remplir(en, g) {
    const t = g.map((v) => (v == null ? '' : traduire(v, true)));
    // A French variable (message built from pieces): give it the piece-by-piece translation too
    for (let i = 0; i < t.length; i++) if (g[i] && t[i] === g[i] && phraseFr(g[i])) { const u = traduire(g[i], false); if (u !== g[i] && !MOTS_FR.test(u)) t[i] = u; }
    if (g.some((v, i) => v && t[i] === v && phraseFr(v))) return null;
    let k = 0;
    return en.replace(/\{(\d*)\}/g, (_, n) => { const v = t[n === '' ? k++ : Number(n)]; return v == null ? '' : v; });
  }
  function traduire(t, interne) {
    const s = norme(t);
    if (!s || !/[a-zà-ÿ]/i.test(s)) return t;
    if (memo.has(s)) return memo.get(s);
    // Log line « [Tag] message »: translate the message, keep the tag
    const tag = /^(\[[^\]]{1,30}\]\s*)([\s\S]+)$/.exec(s);
    if (tag) { const m = traduire(tag[2], interne); const r0 = m === tag[2] ? t : tag[1] + m; memo.set(s, r0); return r0; }
    let r = exact.get(s);
    if (r == null && s.length <= 800) {
      const premier = (s.match(/^\S+/) || [''])[0];
      for (const cle of [premier, '']) {
        const l = motifs.get(cle);
        if (!l) continue;
        for (const m of l) { if (s.length > m.poids + 160 || !m.morceaux.every((x) => s.includes(x))) continue; const g = m.re.exec(s); if (g) { r = remplir(m.en, g.slice(1)); if (r != null) break; } }
        if (r != null) break;
      }
    }
    if (r == null && !interne) {
      // Début connu suivi d'un nom ou d'une valeur
      for (const p of prefixes) if (s.length > p.length + 1 && s.startsWith(p) && /^[\s:]*[A-Z0-9!«“"'(À-Ý]/.test(s.slice(p.length))) { r = exact.get(p) + s.slice(p.length); break; }
    }
    // Still French (sentence built from pieces): translate each piece between separators, then the common words
    if (!interne && (r == null || MOTS_FR.test(r)) && MOTS_FR.test(s)) {
      const base = r == null ? s : norme(r);
      // Coarse pieces first (between « · »), then finer ones inside a piece that is still French
      const NIVEAUX = [/( — | – | : |: | › )/, /(, |; | \(|\) )/];
      const fin = (m, n = 0) => {
        // « head : tail » where the tail is a known sentence (an error message after a name…)
        if (n === 0) {
          const re = / : |: /g; let x;
          while ((x = re.exec(m))) {
            const tete = m.slice(0, x.index), queue = m.slice(x.index + x[0].length);
            const q = traduire(queue, true);
            if (q !== queue && !MOTS_FR.test(q)) return (MOTS_FR.test(tete) ? fin(tete) : tete) + ': ' + q;
          }
        }
        return finN(m, n);
      };
      const finN = (m, n = 0) => (n >= NIVEAUX.length ? m : m.split(NIVEAUX[n]).map((x, k) => (k % 2 || !MOTS_FR.test(x) ? x : (() => { const v = morceau(x, false); return v !== x && !MOTS_FR.test(v) ? v : fin(x, n + 1); })())).join(''));
      const morceaux = base.split(/( · )/);
      const morceau = (m, detailler = true) => {
        let v = traduire(m, true);
        if (v !== m && !MOTS_FR.test(v)) return v;
        const g = /^(\s*[·›•.]?\s*)(.*?)(\s*[›…:.]?\s*)$/u.exec(m);
        if (g && g[2] && g[2] !== m) { const w = traduire(g[2], true); if (w !== g[2] && !MOTS_FR.test(w)) return g[1] + w + g[3]; }
        return detailler ? fin(v) : v;
      };
      const x1 = morceaux.map((m, k) => (k % 2 || !MOTS_FR.test(m) ? m : morceau(m))).join('');
      const x2 = fragments(x1);
      // Keep the result only when it is (almost) fully English: half-translated sentences read worse than either language
      const reste = (y) => (y.match(MOTS_FR_G) || []).length;
      const choix = [x1, x2].filter((y) => y !== base && reste(y) <= 1).sort((a, b) => reste(a) - reste(b))[0];
      if (choix) r = choix;
    }
    if (r == null) r = t;
    if (memo.size > 20000) memo.clear();
    memo.set(s, r);
    return r;
  }
  // Last resort for leftover French words in assembled sentences (US edition)
  const FRAGMENTS = [
    [/\bil y a (\d+) ?min\b/g, '$1 min ago'], [/\bil y a (\d+) ?h\b/g, '$1 h ago'], [/\bil y a (\d+) ?j\b/g, '$1 d ago'], [/\bil y a (\d+) ?s\b/g, '$1 s ago'],
    [/\bil y a\b/g, 'ago'], [/\bà l’instant\b/g, 'just now'], [/\bà l'instant\b/g, 'just now'], [/\bjamais\b/g, 'never'],
    [/\bpaquets?\(s\)/g, 'packet(s)'], [/\bpaquets\/j\b/g, 'packets/d'], [/\bpaquets\b/g, 'packets'], [/\bpaquet\b/g, 'packet'],
    [/\bsauts?\(s\)/g, 'hop(s)'], [/\bsauts\b/g, 'hops'], [/\bsaut\b/g, 'hop'],
    [/\bSNR moyen\b/g, 'average SNR'], [/\bentendu par\b/g, 'heard by'], [/\bEntendu par\b/g, 'Heard by'], [/\bentendus?\b/g, 'heard'],
    [/\bapparu\b/g, 'appeared'], [/\bdécouverte automatique\b/g, 'automatic discovery'], [/\bdécouverte\b/g, 'discovery'], [/\b(lire|horloge|voisins|annonce|chemin|statut|tracer|telemetrie)\b/g, (m) => ({ lire: 'read', horloge: 'clock', voisins: 'neighbors', annonce: 'advert', chemin: 'path', statut: 'status', tracer: 'trace', telemetrie: 'telemetry' }[m])], [/\btâches?\b/g, 'task'], [/\bterminée?s?\b/g, 'finished'], [/\blancée?s?\b/g, 'started'], [/\ben attente\b/g, 'waiting'], [/\bdernier reçu\b/g, 'last received'], [/\blast reçu\b/g, 'last received'], [/\breçus?\b/g, 'received'],
    [/\bsa position\b/g, 'its position'], [/\bsa télémétrie\b/g, 'its telemetry'], [/\bsa fiche\b/g, 'its node info'], [/\btélémétrie\b/g, 'telemetry'],
    [/\btoutes les\b/g, 'every'], [/\btous les\b/g, 'every'], [/\bdéconnectée?s?\b/g, 'disconnected'], [/\bconnectée?s?\b/g, 'connected'],
    [/\bà sens unique\b/g, 'one-way'], [/\bjournal de la base\b/g, 'database journal'], [/(\d) fois\b/g, '$1 times'],
    [/\bd’après son rapport de voisinage\b/g, 'from its neighbor report'], [/\balors que (.+?) l’entend\b/g, 'while $1 hears it'],
    [/\b(chargé|saturé)\b/g, (m) => (m === 'chargé' ? 'busy' : 'saturated')], [/\bd'occupation\b/g, 'busy'], [/\butilisation\b/g, 'busy'], [/\bautour de\b/g, 'around'],
    [/\(facultatif\)/g, '(optional)'], [/\bfacultatif\b/g, 'optional'], [/\bNom\b/g, 'Name'],
    [/Meshtastic® est une marque de Meshtastic LLC/g, 'Meshtastic® is a trademark of Meshtastic LLC'], [/\bCarte ©/g, 'Map ©'], [/\bdonnées ©/g, 'data ©'], [/\bcontributeurs OpenStreetMap\b/g, 'OpenStreetMap contributors'], [/\bFond ©/g, 'Base map ©'],
    [/\bclé du companion\b/g, 'companion key'], [/\bclé en base64\b/g, 'base64 key'], [/\bMonCanal\b/g, 'MyChannel'],
    [/\ben ligne\b/g, 'online'], [/\bEn ligne\b/g, 'Online'], [/\bhors ligne\b/g, 'offline'], [/\bHors ligne\b/g, 'Offline'],
    [/\bnœuds\b/g, 'nodes'], [/\bnœud\b/g, 'node'], [/\brelais\b/g, 'relay(s)'], [/\bpasserelles\b/g, 'gateways'], [/\bpasserelle\b/g, 'gateway'],
    [/\bvia le\b/g, 'via the'], [/\bdepuis\b/g, 'since'], [/\bpuis\b/g, 'then'], [/\bavec\b/g, 'with'], [/\bsans\b/g, 'without'], [/\bpour\b/g, 'for'],
    [/\brediffusion\b/g, 'rebroadcast'], [/\bgain RX boosté\b/g, 'boosted RX gain'], [/\bvoisinage\b/g, 'neighbor info'], [/\bcanaux\b/g, 'channels'], [/\bréglages?\b/g, 'settings'], [/\bréseau\b/g, 'network'], [/\bcarte\b/g, 'map'], [/\béchec\b/g, 'failed'], [/\bréussie?\b/g, 'succeeded'], [/\brelié\b/g, 'connected'],
    [/\bcanal\b/g, 'channel'], [/\bémission\b/g, 'airtime'], [/\bRépéteurs?\b/g, (m) => (m.endsWith('s') ? 'Repeaters' : 'Repeater')], [/\brépéteurs?\b/g, (m) => (m.endsWith('s') ? 'repeaters' : 'repeater')], [/\bCapteur\b/g, 'Sensor'], [/\bInconnu\b/g, 'Unknown'], [/« ?/g, '“'], [/ ?»/g, '”'], [/\bmodule\b/g, 'node'], [/ : /g, ': '],
    [/\bsur\b/g, 'on'], [/\bdans\b/g, 'in'], [/\bet\b/g, 'and'], [/\(ou\b/g, '(or'], [/\bou\b/g, 'or'], [/\btous\b/g, 'all'], [/\btoutes\b/g, 'all'], [/\baucune?\b/g, 'none'],
  ];
  // JavaScript's \b ignores accented letters (à, é…): use Unicode-aware boundaries instead
  const FRAG = FRAGMENTS.map(([re, en]) => {
    let src = re.source, debut = true;
    src = src.replace(/\\b/g, (m, i) => { const r = i === 0 && debut ? '(?<![\\p{L}\\p{N}_])' : '(?![\\p{L}\\p{N}_])'; debut = false; return r; });
    return [new RegExp(src, 'gu'), en];
  });
  function fragments(x) { for (const [re, en] of FRAG) x = x.replace(re, en); return x; }
  window.__fragments = fragments;
  window.tr = (t) => (pret ? traduire(String(t)) : t);
  const poses = new WeakMap(); // nœuds texte déjà traduits par nous : valeur posée
  const IGNORER = 'script,style,textarea,code,pre,[translate="no"],.notranslate,.leaflet-tile-pane';
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
  function traduireNoeud(n) {
    if (n.nodeType === 3) {
      const p = n.parentElement;
      if (!p || p.closest(IGNORER)) return;
      const v = n.nodeValue;
      if (!/[a-zà-ÿ]/i.test(v)) return;
      if (poses.get(n) === v) return;
      const r = imperial(traduire(v));
      if (r !== v) {
        const avant = v.match(/^\s*/)[0], apres = v.match(/\s*$/)[0];
        n.nodeValue = avant + norme(r) + apres;
        poses.set(n, n.nodeValue);
      }
      return;
    }
    if (n.nodeType !== 1) return;
    // A text box's content is the user's, but its placeholder and title are ours
    const champ = (e) => e.tagName === 'TEXTAREA' && !e.closest('[translate="no"],.notranslate');
    if (champ(n)) { traduireAttrs(n); return; }
    if (n.closest(IGNORER)) return;
    traduireAttrs(n);
    const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (x) => { if (x.nodeType === 1 && champ(x)) traduireAttrs(x); return x.nodeType === 1 && x.matches(IGNORER) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; },
    });
    let x;
    while ((x = w.nextNode())) { if (x.nodeType === 3) traduireNoeud(x); else traduireAttrs(x); }
  }
  function traduireAttrs(e) {
    for (const a of ATTRS) {
      const v = e.getAttribute(a);
      if (v && /[a-zà-ÿ]/i.test(v)) { const r = imperial(traduire(v)); if (r !== v) e.setAttribute(a, r); }
    }
    if (e.tagName === 'INPUT' && (e.type === 'button' || e.type === 'submit') && e.value) { const r = traduire(e.value); if (r !== e.value) e.value = r; }
  }
  let titre = null;
  function demarrer() {
    pret = true;
    traduireNoeud(document.body);
    titre = traduire(document.title); document.title = titre;
    new MutationObserver((l) => {
      for (const m of l) {
        if (m.type === 'childList') m.addedNodes.forEach(traduireNoeud);
        else if (m.type === 'characterData') traduireNoeud(m.target);
        else if (m.type === 'attributes') { if (!m.target.closest || !m.target.closest('script,style,[translate="no"],.notranslate') ) traduireAttrs(m.target); }
      }
      if (document.title !== titre) { titre = traduire(document.title); if (titre !== document.title) document.title = titre; }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  // Boîtes du navigateur
  for (const f of ['alert', 'confirm', 'prompt']) {
    const o = window[f].bind(window);
    window[f] = (m, ...r) => o(m == null ? m : String(m).split('\n').map((l) => traduire(l)).join('\n'), ...r);
  }
  const v = (document.currentScript && document.currentScript.src.match(/\?v=([^&]+)/)) || [];
  fetch('/i18n-en.json' + (v[1] ? '?v=' + v[1] : ''))
    .then((r) => r.json())
    .then((d) => { charger(d); if (document.body) demarrer(); else document.addEventListener('DOMContentLoaded', demarrer); })
    .catch(() => { /* dictionnaire indisponible : l'interface reste en français */ });
})();
