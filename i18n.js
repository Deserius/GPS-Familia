/**
 * GPS FAMILIA i18n — English + Español.
 * Server: GET /api/i18n?lang=en|es
 * Client: import { t, setLang, getLang, applyI18n } from "./i18n.js"
 */
const STRINGS = {
  en: {
    "app.name": "GPS FAMILIA",
    "app.tagline": "Family. Loyalty. Location.",
    "nav.menu": "Open GPS FAMILIA menu",
    "nav.trackOn": "Track On",
    "nav.trackOff": "Track Off",
    "nav.sos": "SOS",
    "nav.feed": "Feed",
    "nav.search": "Find people",
    "nav.inbox": "Inbox",
    "nav.family": "Family members",
    "nav.help": "Help",
    "map.street": "Street map",
    "map.satellite": "Satellite",
    "map.terrain": "Terrain",
    "map.zoomIn": "Zoom in",
    "map.zoomOut": "Zoom out",
    "map.refresh": "Refresh family pins",
    "map.me": "Center on me",
    "map.trail": "Map or hide my trail",
    "auth.login": "Log in",
    "auth.register": "Register",
    "auth.password": "Password",
    "splash.enter": "Enter",
    "footer.offline": "offline",
    "footer.live": "live",
    "lang.en": "English",
    "lang.es": "Español",
    "a11y.skip": "Skip to map",
    "acct.language": "Language"
  },
  es: {
    "app.name": "GPS FAMILIA",
    "app.tagline": "Familia. Lealtad. Ubicación.",
    "nav.menu": "Abrir menú de GPS FAMILIA",
    "nav.trackOn": "Rastreo activo",
    "nav.trackOff": "Rastreo off",
    "nav.sos": "SOS",
    "nav.feed": "Feed",
    "nav.search": "Buscar personas",
    "nav.inbox": "Bandeja",
    "nav.family": "Familia",
    "nav.help": "Ayuda",
    "map.street": "Mapa de calles",
    "map.satellite": "Satélite",
    "map.terrain": "Terreno",
    "map.zoomIn": "Acercar",
    "map.zoomOut": "Alejar",
    "map.refresh": "Actualizar pines",
    "map.me": "Centrar en mí",
    "map.trail": "Ver u ocultar mi ruta",
    "auth.login": "Entrar",
    "auth.register": "Registrarse",
    "auth.password": "Contraseña",
    "splash.enter": "Entrar",
    "footer.offline": "sin conexión",
    "footer.live": "en vivo",
    "lang.en": "English",
    "lang.es": "Español",
    "a11y.skip": "Saltar al mapa",
    "acct.language": "Idioma"
  }
};

const LANG_KEY = "f360_lang";
const SUPPORTED = ["en", "es"];

function normalizeLang(v) {
  const s = String(v || "en").toLowerCase().slice(0, 2);
  return SUPPORTED.includes(s) ? s : "en";
}

function getLang() {
  try {
    if (typeof localStorage !== "undefined") return normalizeLang(localStorage.getItem(LANG_KEY) || document.documentElement.lang);
  } catch (e) {}
  return "en";
}

function t(key, lang) {
  const l = normalizeLang(lang || getLang());
  return (STRINGS[l] && STRINGS[l][key]) || (STRINGS.en && STRINGS.en[key]) || key;
}

function applyI18n(root) {
  const el = root || (typeof document !== "undefined" ? document : null);
  if (!el) return;
  el.documentElement && (el.documentElement.lang = getLang());
  (el.querySelectorAll ? el.querySelectorAll("[data-i18n]") : []).forEach((n) => {
    n.textContent = t(n.getAttribute("data-i18n"));
  });
  (el.querySelectorAll ? el.querySelectorAll("[data-i18n-aria]") : []).forEach((n) => {
    n.setAttribute("aria-label", t(n.getAttribute("data-i18n-aria")));
  });
  (el.querySelectorAll ? el.querySelectorAll("[data-i18n-title]") : []).forEach((n) => {
    n.setAttribute("title", t(n.getAttribute("data-i18n-title")));
  });
}

function setLang(lang) {
  const l = normalizeLang(lang);
  try { localStorage.setItem(LANG_KEY, l); } catch (e) {}
  if (typeof document !== "undefined") {
    document.documentElement.lang = l;
    applyI18n(document);
  }
  return l;
}

function catalog(lang) {
  const l = normalizeLang(lang);
  return { lang: l, supported: SUPPORTED, strings: STRINGS[l] || STRINGS.en };
}

export { t, setLang, getLang, applyI18n, catalog, SUPPORTED, STRINGS };
