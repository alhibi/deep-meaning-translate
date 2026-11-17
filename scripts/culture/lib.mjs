/**
 * Shared helpers for the Met Open Access cultural corpus.
 *
 * Everything here is deterministic and auditable:
 * - place resolution never guesses: an unmapped country/culture is a rejected record;
 * - category mapping is derived only from the institution's own labels (department,
 *   classification, objectName, medium, title, tags) and every rule states its evidence;
 * - the English summary is a template over documented source facts (name / place / date /
 *   medium); it never adds a fact the record does not contain.
 *
 * Runtime: plain Node (.mjs), no bundler. The generated corpus is TypeScript under
 * src/lib/culture/data/ because the client loads it as hashed lazy modules.
 */
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../..");
export const DATA_DIR = join(REPO_ROOT, "src/lib/culture/data");
export const ARTIFACT_DIR = join(REPO_ROOT, "artifacts/phase2/task-17");
export const REGISTRY_PATH = join(REPO_ROOT, "data/culture/met-source.json");

export const CULTURE_SCHEMA_VERSION = 1;
export const CHUNK_SIZE = 80;

/** The institution, its API and the rights statement every record inherits. */
export const MET = {
  organization: "The Metropolitan Museum of Art",
  apiBase: "https://collectionapi.metmuseum.org/public/collection/v1",
  searchBase: "https://collectionapi.metmuseum.org/public/collection/v1.1/search",
  apiDocs: "https://metmuseum.github.io/",
  openAccessPolicy: "https://www.metmuseum.org/about-the-met/policies-and-documents/open-access",
  license: "CC0-1.0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  imageHosts: ["images.metmuseum.org"],
};

/**
 * Departments deliberately chosen for cultural breadth. target is the number of accepted
 * records we want from each one; a department that cannot fill its target is reported as a
 * shortfall, never padded with weak records. Department ids/names come from
 * GET /public/collection/v1/departments (verified 2026-11-17).
 */
export const DEPARTMENTS = [
  { id: 5, name: "Arts of Africa, Oceania, and the Americas", target: 120 },
  { id: 6, name: "Asian Art", target: 100 },
  { id: 14, name: "Islamic Art", target: 80 },
  { id: 10, name: "Egyptian Art", target: 60 },
  { id: 13, name: "Greek and Roman Art", target: 55 },
  { id: 3, name: "Ancient West Asian Art", target: 40 },
  { id: 17, name: "Medieval Art", target: 40 },
  { id: 18, name: "Musical Instruments", target: 40 },
  { id: 1, name: "The American Wing", target: 30 },
  { id: 4, name: "Arms and Armor", target: 30 },
  { id: 12, name: "European Sculpture and Decorative Arts", target: 30 },
  { id: 8, name: "The Costume Institute", target: 20 },
  { id: 11, name: "European Paintings", target: 15 },
  { id: 7, name: "The Cloisters", target: 15 },
];

export const SEARCH_PAGE_SIZE = 100;
/** Met's collection API is public but rate-limited by an edge WAF; stay at ~0.8 req/s. */
export const DEFAULT_GAP_MS = 1200;
export const MAX_SEARCH_PAGES = 6;

export const CONTINENTS = ["africa", "asia", "europe", "north-america", "south-america", "oceania"];

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------

export function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

export function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * Met labels carry uncertainty markers: "United States (?)", "probably Egypt". For place
 * resolution only, drop the marker; the uncertainty is never copied into a fact field.
 */
export function stripPlaceQualifiers(value) {
  return clean(value)
    .replace(/\s*\((?:\?|possibly|probably|maybe|ca\.)[^)]*\)\s*$/i, "")
    .replace(/^(?:possibly|probably|maybe)\s+/i, "")
    .trim();
}

/** Met titles/summaries occasionally carry inline italic markup (<i>...</i>); display copy must be plain text. */
export function stripMarkup(value) {
  return clean(value)
    .replace(/<\/?[a-z][^>]{0,80}>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

const DISPLAY_FIELDS = [
  "title",
  "objectName",
  "culture",
  "country",
  "region",
  "period",
  "dynasty",
  "objectDate",
  "medium",
  "classification",
  "department",
  "creditLine",
  "accessionNumber",
];

/** Plain-text copy of one Met detail; raw responses stay untouched in the cache. */
export function sanitizeDetail(detail) {
  const out = { ...detail };
  for (const field of DISPLAY_FIELDS) {
    if (typeof out[field] === "string") out[field] = stripMarkup(out[field]);
  }
  if (Array.isArray(out.tags)) {
    out.tags = out.tags
      .map((tag) => (typeof tag === "string" ? tag : tag && tag.term))
      .map(stripMarkup)
      .filter(Boolean);
  }
  return out;
}

export function normaliseKey(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isHttpsUrl(value) {
  if (typeof value !== "string" || !/^https:\/\//.test(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function hostOf(value) {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

export function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

export function log(...args) {
  // Ingestion progress goes to stderr so piped stdout stays parsable.
  console.error(...args);
}

// ---------------------------------------------------------------------------
// place resolution
// ---------------------------------------------------------------------------

const place = (continent, iso, label) => ({
  continent,
  countries: iso ? [iso] : [],
  label,
});

function rowsToMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const name = row[0];
    const continent = row[1];
    const iso = row[2] === null ? null : row[2];
    const label = row[3] || name;
    map.set(normaliseKey(name), place(continent, iso, label));
  }
  return map;
}

/** ISO 3166-1 alpha-2 states with the continent used by the taxonomy. */
const COUNTRY_ROWS = [
  ["Afghanistan", "asia", "AF"],
  ["Albania", "europe", "AL"],
  ["Algeria", "africa", "DZ"],
  ["Andorra", "europe", "AD"],
  ["Angola", "africa", "AO"],
  ["Argentina", "south-america", "AR"],
  ["Armenia", "asia", "AM"],
  ["Australia", "oceania", "AU"],
  ["Austria", "europe", "AT"],
  ["Azerbaijan", "asia", "AZ"],
  ["Bahamas", "north-america", "BS", "the Bahamas"],
  ["Bahrain", "asia", "BH"],
  ["Bangladesh", "asia", "BD"],
  ["Barbados", "north-america", "BB"],
  ["Belarus", "europe", "BY"],
  ["Belgium", "europe", "BE"],
  ["Belize", "north-america", "BZ"],
  ["Benin", "africa", "BJ"],
  ["Bhutan", "asia", "BT"],
  ["Bolivia", "south-america", "BO"],
  ["Bosnia and Herzegovina", "europe", "BA"],
  ["Botswana", "africa", "BW"],
  ["Brazil", "south-america", "BR"],
  ["Brunei", "asia", "BN"],
  ["Bulgaria", "europe", "BG"],
  ["Burkina Faso", "africa", "BF"],
  ["Burundi", "africa", "BI"],
  ["Cambodia", "asia", "KH"],
  ["Cameroon", "africa", "CM"],
  ["Canada", "north-america", "CA"],
  ["Cape Verde", "africa", "CV"],
  ["Central African Republic", "africa", "CF", "the Central African Republic"],
  ["Chad", "africa", "TD"],
  ["Chile", "south-america", "CL"],
  ["China", "asia", "CN"],
  ["Republic of the Congo", "africa", "CG", "the Republic of the Congo"],
  ["Colombia", "south-america", "CO"],
  ["Comoros", "africa", "KM"],
  ["Costa Rica", "north-america", "CR"],
  ["Croatia", "europe", "HR"],
  ["Cuba", "north-america", "CU"],
  ["Cyprus", "asia", "CY"],
  ["Czech Republic", "europe", "CZ", "the Czech Republic"],
  ["Czechia", "europe", "CZ", "Czechia"],
  ["Democratic Republic of the Congo", "africa", "CD", "the Democratic Republic of the Congo"],
  ["Denmark", "europe", "DK"],
  ["Djibouti", "africa", "DJ"],
  ["Dominican Republic", "north-america", "DO", "the Dominican Republic"],
  ["Ecuador", "south-america", "EC"],
  ["Egypt", "africa", "EG"],
  ["El Salvador", "north-america", "SV"],
  ["Equatorial Guinea", "africa", "GQ"],
  ["Eritrea", "africa", "ER"],
  ["Estonia", "europe", "EE"],
  ["Eswatini", "africa", "SZ"],
  ["Ethiopia", "africa", "ET"],
  ["Fiji", "oceania", "FJ"],
  ["Finland", "europe", "FI"],
  ["France", "europe", "FR"],
  ["Gabon", "africa", "GA"],
  ["Gambia", "africa", "GM", "the Gambia"],
  ["Georgia", "asia", "GE"],
  ["Germany", "europe", "DE"],
  ["Ghana", "africa", "GH"],
  ["Greece", "europe", "GR"],
  ["Guatemala", "north-america", "GT"],
  ["Guinea", "africa", "GN"],
  ["Guinea-Bissau", "africa", "GW"],
  ["Guyana", "south-america", "GY"],
  ["Haiti", "north-america", "HT"],
  ["Honduras", "north-america", "HN"],
  ["Hungary", "europe", "HU"],
  ["Iceland", "europe", "IS"],
  ["India", "asia", "IN"],
  ["Indonesia", "asia", "ID"],
  ["Iran", "asia", "IR"],
  ["Iraq", "asia", "IQ"],
  ["Ireland", "europe", "IE"],
  ["Israel", "asia", "IL"],
  ["Italy", "europe", "IT"],
  ["Ivory Coast", "africa", "CI", "Cote d'Ivoire"],
  ["Jamaica", "north-america", "JM"],
  ["Japan", "asia", "JP"],
  ["Jordan", "asia", "JO"],
  ["Kazakhstan", "asia", "KZ"],
  ["Kenya", "africa", "KE"],
  ["Kiribati", "oceania", "KI"],
  ["Kosovo", "europe", "XK"],
  ["Kuwait", "asia", "KW"],
  ["Kyrgyzstan", "asia", "KG"],
  ["Laos", "asia", "LA"],
  ["Latvia", "europe", "LV"],
  ["Lebanon", "asia", "LB"],
  ["Lesotho", "africa", "LS"],
  ["Liberia", "africa", "LR"],
  ["Libya", "africa", "LY"],
  ["Liechtenstein", "europe", "LI"],
  ["Lithuania", "europe", "LT"],
  ["Luxembourg", "europe", "LU"],
  ["Madagascar", "africa", "MG"],
  ["Malawi", "africa", "MW"],
  ["Malaysia", "asia", "MY"],
  ["Maldives", "asia", "MV"],
  ["Mali", "africa", "ML"],
  ["Malta", "europe", "MT"],
  ["Marshall Islands", "oceania", "MH", "the Marshall Islands"],
  ["Mauritania", "africa", "MR"],
  ["Mauritius", "africa", "MU"],
  ["Mexico", "north-america", "MX"],
  ["Micronesia", "oceania", "FM"],
  ["Moldova", "europe", "MD"],
  ["Monaco", "europe", "MC"],
  ["Mongolia", "asia", "MN"],
  ["Montenegro", "europe", "ME"],
  ["Morocco", "africa", "MA"],
  ["Mozambique", "africa", "MZ"],
  ["Myanmar", "asia", "MM"],
  ["Namibia", "africa", "NA"],
  ["Nauru", "oceania", "NR"],
  ["Nepal", "asia", "NP"],
  ["Netherlands", "europe", "NL", "the Netherlands"],
  ["New Zealand", "oceania", "NZ"],
  ["Nicaragua", "north-america", "NI"],
  ["Niger", "africa", "NE"],
  ["Nigeria", "africa", "NG"],
  ["North Macedonia", "europe", "MK"],
  ["Norway", "europe", "NO"],
  ["Oman", "asia", "OM"],
  ["Pakistan", "asia", "PK"],
  ["Palau", "oceania", "PW"],
  ["Palestine", "asia", "PS"],
  ["Panama", "north-america", "PA"],
  ["Papua New Guinea", "oceania", "PG"],
  ["Paraguay", "south-america", "PY"],
  ["Peru", "south-america", "PE"],
  ["Philippines", "asia", "PH", "the Philippines"],
  ["Poland", "europe", "PL"],
  ["Portugal", "europe", "PT"],
  ["Puerto Rico", "north-america", "PR"],
  ["Qatar", "asia", "QA"],
  ["Romania", "europe", "RO"],
  ["Russia", "europe", "RU"],
  ["Rwanda", "africa", "RW"],
  ["Samoa", "oceania", "WS"],
  ["San Marino", "europe", "SM"],
  ["Sao Tome and Principe", "africa", "ST"],
  ["Saudi Arabia", "asia", "SA"],
  ["Senegal", "africa", "SN"],
  ["Serbia", "europe", "RS"],
  ["Seychelles", "africa", "SC"],
  ["Sierra Leone", "africa", "SL"],
  ["Singapore", "asia", "SG"],
  ["Slovakia", "europe", "SK"],
  ["Slovenia", "europe", "SI"],
  ["Solomon Islands", "oceania", "SB", "the Solomon Islands"],
  ["Somalia", "africa", "SO"],
  ["South Africa", "africa", "ZA"],
  ["South Korea", "asia", "KR"],
  ["South Sudan", "africa", "SS"],
  ["Spain", "europe", "ES"],
  ["Sri Lanka", "asia", "LK"],
  ["Sudan", "africa", "SD"],
  ["Suriname", "south-america", "SR"],
  ["Sweden", "europe", "SE"],
  ["Switzerland", "europe", "CH"],
  ["Syria", "asia", "SY"],
  ["Taiwan", "asia", "TW"],
  ["Tajikistan", "asia", "TJ"],
  ["Tanzania", "africa", "TZ"],
  ["Thailand", "asia", "TH"],
  ["Timor-Leste", "asia", "TL"],
  ["Togo", "africa", "TG"],
  ["Tonga", "oceania", "TO"],
  ["Trinidad and Tobago", "north-america", "TT"],
  ["Tunisia", "africa", "TN"],
  ["Turkey", "asia", "TR"],
  ["Turkmenistan", "asia", "TM"],
  ["Tuvalu", "oceania", "TV"],
  ["Uganda", "africa", "UG"],
  ["Ukraine", "europe", "UA"],
  ["United Arab Emirates", "asia", "AE", "the United Arab Emirates"],
  ["United Kingdom", "europe", "GB", "the United Kingdom"],
  ["United States", "north-america", "US", "the United States"],
  ["Uruguay", "south-america", "UY"],
  ["Uzbekistan", "asia", "UZ"],
  ["Vanuatu", "oceania", "VU"],
  ["Vatican City", "europe", "VA"],
  ["Venezuela", "south-america", "VE"],
  ["Vietnam", "asia", "VN"],
  ["Yemen", "asia", "YE"],
  ["Zambia", "africa", "ZM"],
  ["Zimbabwe", "africa", "ZW"],
];

/** Common Met country spellings/aliases that are not the modern short name. */
const COUNTRY_ALIASES = [
  ["USA", "United States"],
  ["U.S.A.", "United States"],
  ["United States of America", "United States"],
  ["Great Britain", "United Kingdom"],
  ["England", "United Kingdom"],
  ["Scotland", "United Kingdom"],
  ["Wales", "United Kingdom"],
  ["Northern Ireland", "United Kingdom"],
  ["Holland", "Netherlands"],
  ["The Netherlands", "Netherlands"],
  ["Republic of Ireland", "Ireland"],
  ["Republic of Korea", "South Korea"],
  ["Korea", "South Korea"],
  ["Korea, Republic of", "South Korea"],
  ["Macedonia", "North Macedonia"],
  ["Burma", "Myanmar"],
  ["Siam", "Thailand"],
  ["Cote d'Ivoire", "Ivory Coast"],
  ["Democratic Republic of Congo", "Democratic Republic of the Congo"],
  ["Congo, Democratic Republic of the", "Democratic Republic of the Congo"],
  ["Congo", "Republic of the Congo"],
  ["Republic of Congo", "Republic of the Congo"],
  ["Russia Federation", "Russia"],
  ["Czechoslovakia", "Czech Republic"],
  ["Yugoslavia", "Serbia"],
  ["USSR", "Russia"],
  ["Soviet Union", "Russia"],
  ["West Germany", "Germany"],
  ["East Germany", "Germany"],
  ["Prussia", "Germany"],
  ["Bohemia", "Czech Republic"],
  ["Moravia", "Czech Republic"],
  ["Flanders", "Belgium"],
];

/** Cultures/peoples whose name is not a modern state name but is unambiguous enough. */
const CULTURE_ROWS = [
  ["Egyptian", "africa", "EG", "Egypt"],
  ["Greek", "europe", "GR", "Greece"],
  ["Roman", "europe", null, "the Roman world"],
  ["Etruscan", "europe", "IT", "Etruria"],
  ["Byzantine", "europe", null, "the Byzantine world"],
  ["Cypriot", "asia", "CY", "Cyprus"],
  ["Minoan", "europe", "GR", "Minoan Crete"],
  ["Mycenaean", "europe", "GR", "Mycenaean Greece"],
  ["Sumerian", "asia", null, "ancient Mesopotamia"],
  ["Babylonian", "asia", null, "ancient Mesopotamia"],
  ["Assyrian", "asia", null, "ancient Mesopotamia"],
  ["Akkadian", "asia", null, "ancient Mesopotamia"],
  ["Sasanian", "asia", "IR", "Iran"],
  ["Persian", "asia", "IR", "Iran"],
  ["Ottoman", "asia", "TR", "the Ottoman world"],
  ["Umayyad", "asia", null, "the Umayyad world"],
  ["Abbasid", "asia", null, "the Abbasid world"],
  ["Fatimid", "africa", "EG", "Fatimid Egypt"],
  ["Mamluk", "africa", "EG", "Mamluk Egypt"],
  ["Ilkhanid", "asia", "IR", "Ilkhanid Iran"],
  ["Timurid", "asia", null, "the Timurid world"],
  ["Safavid", "asia", "IR", "Safavid Iran"],
  ["Mughal", "asia", null, "Mughal India"],
  ["Joseon", "asia", "KR", "Korea"],
  ["Goryeo", "asia", "KR", "Korea"],
  ["Ainu", "asia", "JP", "Ainu Japan"],
  ["Ryukyuan", "asia", "JP", "Ryukyu"],
  ["Maori", "oceania", "NZ", "Maori New Zealand"],
  ["Aboriginal Australian", "oceania", "AU", "Aboriginal Australia"],
  ["Inuit", "north-america", null, "the Inuit world"],
  ["Native American", "north-america", null, "Native America"],
  ["Maya", "north-america", null, "the Maya world"],
  ["Aztec", "north-america", "MX", "Aztec Mexico"],
  ["Olmec", "north-america", "MX", "Olmec Mexico"],
  ["Zapotec", "north-america", "MX", "Zapotec Mexico"],
  ["Teotihuacan", "north-america", "MX", "Teotihuacan"],
  ["Inca", "south-america", "PE", "the Inca world"],
  ["Moche", "south-america", "PE", "Moche Peru"],
  ["Nazca", "south-america", "PE", "Nazca Peru"],
  ["Chimu", "south-america", "PE", "Chimu Peru"],
  ["Nubian", "africa", null, "Nubia"],
  ["Ethiopian", "africa", "ET", "Ethiopia"],
  ["Yoruba", "africa", "NG", "Yorubaland"],
  ["Bamana", "africa", "ML", "Bamana Mali"],
  ["Dogon", "africa", "ML", "Dogon country"],
  ["Fang", "africa", null, "the Fang world"],
  ["Kongo", "africa", null, "the Kongo world"],
  ["Luba", "africa", "CD", "Luba country"],
  ["Kuba", "africa", "CD", "Kuba country"],
  ["Chokwe", "africa", null, "the Chokwe world"],
  ["Benin", "africa", "NG", "Benin City"],
  ["Ife", "africa", "NG", "Ife"],
  ["Asante", "africa", "GH", "Asante"],
  ["Akan", "africa", "GH", "Akan"],
  ["Senufo", "africa", null, "the Senufo world"],
  ["Guro", "africa", "CI", "Guro country"],
  ["Baule", "africa", "CI", "Baule country"],
  ["Dan", "africa", null, "the Dan world"],
  ["Lega", "africa", "CD", "Lega country"],
  ["Hemba", "africa", "CD", "Hemba country"],
  ["Pende", "africa", "CD", "Pende country"],
  ["Songye", "africa", "CD", "Songye country"],
  ["Mumuye", "africa", "NG", "Mumuye country"],
  ["Igbo", "africa", "NG", "Igboland"],
  ["Edo", "africa", "NG", "Edo"],
  ["Djenne", "africa", "ML", "Djenne"],
  ["Tibetan", "asia", null, "Tibet"],
  ["Nepalese", "asia", "NP", "Nepal"],
  ["Thai", "asia", "TH", "Thailand"],
  ["Khmer", "asia", "KH", "Cambodia"],
  ["Vietnamese", "asia", "VN", "Vietnam"],
  ["Indonesian", "asia", "ID", "Indonesia"],
  ["Javanese", "asia", "ID", "Java"],
  ["Balinese", "asia", "ID", "Bali"],
  ["Burmese", "asia", "MM", "Myanmar"],
  ["Indian", "asia", "IN", "India"],
  ["Pakistani", "asia", "PK", "Pakistan"],
  ["Afghan", "asia", "AF", "Afghanistan"],
  ["Uzbek", "asia", "UZ", "Uzbekistan"],
  ["Kazakh", "asia", "KZ", "Kazakhstan"],
  ["Turkmen", "asia", "TM", "Turkmenistan"],
  ["Armenian", "asia", "AM", "Armenia"],
  ["Georgian", "asia", "GE", "Georgia"],
  ["Syrian", "asia", "SY", "Syria"],
  ["Lebanese", "asia", "LB", "Lebanon"],
  ["Palestinian", "asia", "PS", "Palestine"],
  ["Yemeni", "asia", "YE", "Yemen"],
  ["Saudi", "asia", "SA", "Saudi Arabia"],
  ["Iraqi", "asia", "IQ", "Iraq"],
  ["Iranian", "asia", "IR", "Iran"],
  ["Turkish", "asia", "TR", "Turkey"],
  ["Moroccan", "africa", "MA", "Morocco"],
  ["Tunisian", "africa", "TN", "Tunisia"],
  ["Algerian", "africa", "DZ", "Algeria"],
  ["Libyan", "africa", "LY", "Libya"],
  ["Sudanese", "africa", "SD", "Sudan"],
  ["Kenyan", "africa", "KE", "Kenya"],
  ["Tanzanian", "africa", "TZ", "Tanzania"],
  ["Ghanaian", "africa", "GH", "Ghana"],
  ["Nigerian", "africa", "NG", "Nigeria"],
  ["Malian", "africa", "ML", "Mali"],
  ["Senegalese", "africa", "SN", "Senegal"],
  ["Cameroonian", "africa", "CM", "Cameroon"],
  ["Angolan", "africa", "AO", "Angola"],
  ["Zimbabwean", "africa", "ZW", "Zimbabwe"],
  ["South African", "africa", "ZA", "South Africa"],
  ["Mexican", "north-america", "MX", "Mexico"],
  ["Guatemalan", "north-america", "GT", "Guatemala"],
  ["Peruvian", "south-america", "PE", "Peru"],
  ["Colombian", "south-america", "CO", "Colombia"],
  ["Brazilian", "south-america", "BR", "Brazil"],
  ["Argentine", "south-america", "AR", "Argentina"],
  ["Chilean", "south-america", "CL", "Chile"],
  ["Ecuadorian", "south-america", "EC", "Ecuador"],
  ["Bolivian", "south-america", "BO", "Bolivia"],
  ["American", "north-america", "US", "the United States"],
  ["Canadian", "north-america", "CA", "Canada"],
  ["British", "europe", "GB", "the United Kingdom"],
  ["English", "europe", "GB", "England"],
  ["Scottish", "europe", "GB", "Scotland"],
  ["Irish", "europe", "IE", "Ireland"],
  ["French", "europe", "FR", "France"],
  ["German", "europe", "DE", "Germany"],
  ["Austrian", "europe", "AT", "Austria"],
  ["Swiss", "europe", "CH", "Switzerland"],
  ["Dutch", "europe", "NL", "the Netherlands"],
  ["Flemish", "europe", "BE", "Flanders"],
  ["Belgian", "europe", "BE", "Belgium"],
  ["Spanish", "europe", "ES", "Spain"],
  ["Portuguese", "europe", "PT", "Portugal"],
  ["Italian", "europe", "IT", "Italy"],
  ["Sicilian", "europe", "IT", "Sicily"],
  ["Cretan", "europe", "GR", "Crete"],
  ["Russian", "europe", "RU", "Russia"],
  ["Polish", "europe", "PL", "Poland"],
  ["Hungarian", "europe", "HU", "Hungary"],
  ["Czech", "europe", "CZ", "the Czech Republic"],
  ["Bohemian", "europe", "CZ", "Bohemia"],
  ["Scandinavian", "europe", null, "Scandinavia"],
  ["Danish", "europe", "DK", "Denmark"],
  ["Swedish", "europe", "SE", "Sweden"],
  ["Norwegian", "europe", "NO", "Norway"],
  ["Finnish", "europe", "FI", "Finland"],
  ["Icelandic", "europe", "IS", "Iceland"],
  ["Ukrainian", "europe", "UA", "Ukraine"],
  ["Croatian", "europe", "HR", "Croatia"],
  ["Serbian", "europe", "RS", "Serbia"],
  ["Greek Cypriot", "asia", "CY", "Cyprus"],
  ["Australian", "oceania", "AU", "Australia"],
  ["New Zealander", "oceania", "NZ", "New Zealand"],
  ["Papuan", "oceania", "PG", "Papua New Guinea"],
  ["Polynesian", "oceania", null, "Polynesia"],
  ["Melanesian", "oceania", null, "Melanesia"],
  ["Micronesian", "oceania", null, "Micronesia"],
  // Region-level culture labels (the source names an area, not a state). The continent is
  // documented by the label itself; countries stay empty because the culture spans states.
  ["South American", "south-america", null, "South America"],
  ["North American", "north-america", null, "North America"],
  ["Central American", "north-america", null, "Central America"],
  ["Mesoamerican", "north-america", null, "Mesoamerica"],
  ["Caribbean", "north-america", null, "the Caribbean"],
  ["Andean", "south-america", null, "the Andes"],
  ["Amazonian", "south-america", null, "Amazonia"],
  ["African", "africa", null, "Africa"],
  ["West African", "africa", null, "West Africa"],
  ["East African", "africa", null, "East Africa"],
  ["Central African", "africa", null, "Central Africa"],
  ["North African", "africa", null, "North Africa"],
  ["Sub-Saharan African", "africa", null, "sub-Saharan Africa"],
  ["Southern African", "africa", null, "Southern Africa"],
  ["Asian", "asia", null, "Asia"],
  ["East Asian", "asia", null, "East Asia"],
  ["South Asian", "asia", null, "South Asia"],
  ["Southeast Asian", "asia", null, "Southeast Asia"],
  ["Central Asian", "asia", null, "Central Asia"],
  ["West Asian", "asia", null, "West Asia"],
  ["Middle Eastern", "asia", null, "the Middle East"],
  ["Himalayan", "asia", null, "the Himalayas"],
  ["Persianate", "asia", null, "the Persianate world"],
  ["European", "europe", null, "Europe"],
  ["Nordic", "europe", null, "the Nordic countries"],
  ["Baltic", "europe", null, "the Baltic region"],
  ["Balkan", "europe", null, "the Balkans"],
  ["Iberian", "europe", null, "Iberia"],
  ["Celtic", "europe", null, "the Celtic world"],
  ["Germanic", "europe", null, "the Germanic world"],
  ["Slavic", "europe", null, "the Slavic world"],
  ["Oceanic", "oceania", null, "Oceania"],
  ["Pacific Islander", "oceania", null, "the Pacific islands"],
  ["Huron", "north-america", null, "the Huron world"],
  ["Iroquois", "north-america", null, "the Iroquois world"],
  ["Lakota", "north-america", null, "the Lakota world"],
  ["Sioux", "north-america", null, "the Sioux world"],
  ["Navajo", "north-america", null, "the Navajo world"],
  ["Pueblo", "north-america", null, "the Pueblo world"],
  ["Apache", "north-america", null, "the Apache world"],
  ["Cherokee", "north-america", null, "the Cherokee world"],
  ["Haida", "north-america", null, "Haida Gwaii"],
  ["Tlingit", "north-america", null, "the Tlingit world"],
  ["Kwakwaka'wakw", "north-america", null, "the Kwakwaka'wakw world"],
  ["Hopi", "north-america", null, "the Hopi world"],
  ["Zuni", "north-america", null, "the Zuni world"],
  ["Ojibwe", "north-america", null, "the Ojibwe world"],
  ["Cree", "north-america", null, "the Cree world"],
  ["Inupiat", "north-america", null, "the Inupiat world"],
  ["Yup'ik", "north-america", null, "the Yup'ik world"],
  ["Mixe", "north-america", null, "the Mixe world"],
  ["Nahua", "north-america", null, "the Nahua world"],
  ["Totonac", "north-america", null, "the Totonac world"],
  ["Oaxaca", "north-america", null, "Oaxaca"],
  ["Aymara", "south-america", null, "the Aymara world"],
  ["Quechua", "south-america", null, "the Quechua world"],
  ["Wari", "south-america", null, "the Wari world"],
  ["Tiwanaku", "south-america", null, "Tiwanaku"],
  ["Chavin", "south-america", null, "Chavin"],
  ["Sican", "south-america", null, "the Sican world"],
  ["Shipibo", "south-america", null, "the Shipibo world"],
  ["Ashanti", "africa", "GH", "Asante"],
  ["Ewe", "africa", null, "the Ewe world"],
  ["Fon", "africa", "BJ", "the Fon world"],
  ["Mende", "africa", "SL", "the Mende world"],
  ["Kissi", "africa", null, "the Kissi world"],
  ["Kota", "africa", "GA", "the Kota world"],
  ["Kwele", "africa", null, "the Kwele world"],
  ["Tsonga", "africa", "ZA", "the Tsonga world"],
  ["Zulu", "africa", "ZA", "the Zulu world"],
  ["Xhosa", "africa", "ZA", "the Xhosa world"],
  ["Ovimbundu", "africa", "AO", "the Ovimbundu world"],
  ["Kuba", "africa", "CD", "Kuba country"],
  ["Mangbetu", "africa", "CD", "the Mangbetu world"],
  ["Azande", "africa", null, "the Azande world"],
  ["Nok", "africa", "NG", "Nok"],
  ["Sao", "africa", null, "the Sao world"],
  ["Bura", "africa", null, "the Bura world"],
  ["Djenne", "africa", "ML", "Djenne"],
  ["Bura-Asinda", "africa", null, "Bura-Asinda"],
  ["Koma", "africa", "GH", "the Koma world"],
  ["Lobi", "africa", null, "the Lobi world"],
  ["Kulango", "africa", null, "the Kulango world"],
  ["Bwa", "africa", null, "the Bwa world"],
  ["Mossi", "africa", "BF", "the Mossi world"],
  ["Bobo", "africa", null, "the Bobo world"],
  ["Marka", "africa", "ML", "the Marka world"],
  ["Tellem", "africa", "ML", "the Tellem world"],
  ["Dogon", "africa", "ML", "Dogon country"],
  ["Bamana", "africa", "ML", "Bamana Mali"],
  ["Kongo", "africa", null, "the Kongo world"],
  ["Teke", "africa", null, "the Teke world"],
  ["Lulua", "africa", "CD", "the Lulua world"],
  ["Kusu", "africa", "CD", "the Kusu world"],
  ["Mbole", "africa", "CD", "the Mbole world"],
  ["Ngbaka", "africa", "CD", "the Ngbaka world"],
  ["Bembe", "africa", null, "the Bembe world"],
  ["Bakongo", "africa", null, "the Bakongo world"],
];

const COUNTRY_MAP = rowsToMap(COUNTRY_ROWS);
for (const [alias, canonical] of COUNTRY_ALIASES) {
  const entry = COUNTRY_MAP.get(normaliseKey(canonical));
  if (!entry) throw new Error("Unknown country alias target: " + canonical);
  COUNTRY_MAP.set(normaliseKey(alias), entry);
}
const CULTURE_MAP = rowsToMap(CULTURE_ROWS);
// A country name can also appear in the culture field (e.g. culture: "Japan").
for (const [key, entry] of COUNTRY_MAP) {
  if (!CULTURE_MAP.has(key)) CULTURE_MAP.set(key, entry);
}

/**
 * Resolve the record's place from its own metadata only.
 * Returns null when neither country nor culture maps to a documented place; the caller
 * rejects that record and reports the unmapped label instead of guessing.
 */
export function resolvePlace({ country, culture }) {
  const countryClean = stripPlaceQualifiers(country);
  const cultureClean = stripPlaceQualifiers(culture);
  const countryEntry = countryClean ? COUNTRY_MAP.get(normaliseKey(countryClean)) : null;
  if (countryEntry) {
    const countryKey = normaliseKey(countryClean);
    const peopleLabel =
      cultureClean &&
      normaliseKey(cultureClean) !== countryKey &&
      !COUNTRY_MAP.has(normaliseKey(cultureClean))
        ? cultureClean
        : null;
    return {
      continent: countryEntry.continent,
      countries: [...countryEntry.countries],
      label: countryEntry.label,
      labelKind: "country",
      community: peopleLabel,
    };
  }
  if (!cultureClean) return null;
  const cultureEntry = CULTURE_MAP.get(normaliseKey(cultureClean));
  if (!cultureEntry) return null;
  const isCountryName = COUNTRY_MAP.has(normaliseKey(cultureClean));
  return {
    continent: cultureEntry.continent,
    countries: [...cultureEntry.countries],
    label: cultureEntry.label,
    labelKind: isCountryName ? "country" : "community",
    community: isCountryName ? null : cultureClean,
  };
}

// ---------------------------------------------------------------------------
// category mapping - every rule cites the institution's own label words
// ---------------------------------------------------------------------------

const rule = (name, evidence, pattern) => ({ category: name, evidence, pattern });

/**
 * Rules are evaluated in order; the first documented source label wins. A record that
 * matches none falls back to objects (a museum object with no more specific documented
 * label). The evidence string is copied into data/culture/met-source.json so the mapping is
 * auditable without reading this file.
 */
export const CATEGORY_RULES = [
  rule(
    "music",
    "Met department Musical Instruments, or a source classification/objectName that names an instrument",
    /musical instrument|\blute\b|\bflute\b|\bdrum\b|\blyre\b|\bharp\b|\bviolin\b|\btrumpet\b|\bhorn\b|\brebec\b|\bsitar\b|\bqanun\b|\bshaker\b/,
  ),
  rule(
    "astronomy",
    "source classification/objectName/medium names an astrolabe, celestial globe, armillary sphere, sundial or astronomical instrument",
    /astrolab|celestial globe|armillary|sundial|astronom|planetarium|celestial/,
  ),
  rule(
    "games",
    "source classification/objectName names a game, game board, chess piece, die, playing card or toy",
    /\bgame\b|\bgames\b|game board|game piece|chess|\bdice\b|playing card|domino|\btoy\b|\bdoll\b|puzzle/,
  ),
  rule(
    "medicine-knowledge",
    "source classification/objectName/medium names medical, surgical, anatomical or apothecary material",
    /medical|surgical|anatomical|apothecary|pharmac|medicine|physician|dental|prosthe/,
  ),
  rule(
    "agriculture",
    "source classification/objectName names an agricultural implement or practice (plow, sickle, harvest, granary)",
    /agricultur|plow|plough|\bsickle\b|farming|harvest|irrigation|granary/,
  ),
  rule(
    "trade",
    "source classification/objectName is a coin or other documented medium of exchange",
    /\bcoin\b|\bcoins\b|numismatic|coinage|ingot|money/,
  ),
  rule(
    "landscapes",
    "a painting/print/drawing/photograph whose source title, object name or tags name a landscape, view, coast, garden or cityscape",
    /landscape|seascape|prospect|view of|coast|harbor|river|mountain|forest|park\b|garden|cityscape|street scene/,
  ),
  rule(
    "language",
    "source classification/objectName/tags explicitly name calligraphy, script or an inscription (writing/script heritage)",
    /calligraph|inscription|\bscript\b|writing/,
  ),
  rule(
    "storytelling",
    "source classification/objectName is a manuscript, book, folio or codex (a text-carrying object)",
    /manuscript|\bbook\b|\bfolio\b|\bcodex\b|illuminated/,
  ),
  rule(
    "architecture",
    "source classification/objectName names an architectural element (column, capital, window, door, mihrab, stucco, dome, facade)",
    /architectural|architecture|\bcolumn\b|\bcapital\b|\bfrieze\b|\blintel\b|\bwindow\b|\bdoor\b|portal|facade|\bniche\b|mihrab|minbar|minaret|\bdome\b|\bvault\b|stucco|tile panel|wall panel/,
  ),
  rule(
    "ritual-objects",
    "source classification/objectName names a religious or ritual object, vessel or site (reliquary, votive, amulet, censer, altar, deity, funerary, sarcophagus, Qur'an, chalice, mask)",
    /ritual|votive|reliquar|amulet|censer|shrine|altar|deity|divin|buddha|bodhisattva|\bicon\b|funerar|sarcophag|canopic|ushabti|shabti|mummy|coffin|book of the dead|prayer|\bqur|koran|torah|menorah|chalice|\bcross\b|linga|stupa|pagoda|kami|ancestral|ceremonial|\bmask\b|rosary|relic/,
  ),
  rule(
    "textiles",
    "source classification/objectName/medium names textile or costume material (textile, tapestry, carpet, embroidery, costume, silk, velvet, garment)",
    /textile|tapestry|\bcarpet\b|\brug\b|embroidery|costume|\bdress\b|\brobe\b|garment|\bsilk\b|velvet|brocade|\blace\b|shawl|quilt|kimono|caftan|\btunic\b|mantle|\bcloth\b|kilim|sampler|\bapron\b|\bglove\b|\bshoe\b|\bhat\b|headwear/,
  ),
  rule(
    "design",
    "source classification/objectName names furniture, a clock/watch or a designed household/lighting object",
    /furniture|\bchair\b|\btable\b|cabinet|\bclock\b|\bwatch\b|commode|\bdesk\b|secretaire|armchair|\bstool\b|\bbench\b|\bmirror\b|candelabr|chandelier|\blamp\b/,
  ),
  rule(
    "everyday-life",
    "source classification/objectName names a domestic vessel, container or utensil (bowl, plate, cup, jar, bottle, vessel, box, basket)",
    /\bbowl\b|\bplate\b|\bdish\b|\bcup\b|\bjar\b|\bjug\b|\bbottle\b|\bvessel\b|\bpot\b|\bbasin\b|\bewer\b|pitcher|\bflask\b|teapot|kettle|\btray\b|\bspoon\b|\bfork\b|\bknife\b|\bcomb\b|\bbasket\b|\bbox\b|container|utensil|tableware|household/,
  ),
  rule(
    "tools",
    "source classification/objectName names a weapon, armor, tool or implement (arrow, sword, dagger, helmet, shield, sickle, hammer, chisel, adze)",
    /\barrow\b|\bspear\b|\bsword\b|\bdagger\b|armor|helmet|\bshield\b|firearm|\bgun\b|\baxe\b|\btool\b|implement|\bhammer\b|\bchisel\b|\badze\b|\bmace\b|halberd|crossbow|quiver|saddle|stirrup|\bspur\b|needle|\bsaw\b|\bdrill\b|weight|scale|balance/,
  ),
  rule(
    "crafts",
    "source classification/objectName/medium names a crafted object or material (jewelry, ceramics, glass, metalwork, sculpture, figurine, ivory, lacquer, woodwork, inlay)",
    /jewel|necklace|bracelet|\bring\b|earring|brooch|\bbead\b|ceramic|porcelain|\bglass\b|metalwork|sculpture|figurine|statuette|statue|\brelief\b|ivory|lacquer|woodwork|\bbronze\b|\bgold\b|\bsilver\b|inlay|sphinx|\bbust\b|\bfigure\b|ornament|plaque|medallion|\bseal\b|\bpanel\b|\btile\b|fragment|\bhead\b|\bhand\b|\bfoot\b/,
  ),
];

export function resolveCategory(detail) {
  const tagTerms = (detail.tags || []).map((tag) => clean(tag && tag.term)).filter(Boolean);
  const fields = {
    department: clean(detail.department),
    classification: clean(detail.classification),
    objectName: clean(detail.objectName),
    medium: clean(detail.medium),
    title: clean(detail.title),
    tags: tagTerms,
    haystack: [
      clean(detail.department),
      clean(detail.classification),
      clean(detail.objectName),
      clean(detail.medium),
      clean(detail.title),
      tagTerms.join(" | "),
    ]
      .join(" | ")
      .toLowerCase(),
  };
  for (const candidate of CATEGORY_RULES) {
    if (candidate.pattern.test(fields.haystack)) {
      return {
        category: candidate.category,
        subcategory: clean(detail.classification) || clean(detail.objectName) || undefined,
        matchedRule: candidate.evidence,
      };
    }
  }
  return {
    category: "objects",
    subcategory: clean(detail.classification) || clean(detail.objectName) || undefined,
    matchedRule: "fallback: no more specific source label; the record is a museum object",
  };
}

// ---------------------------------------------------------------------------
// English display text (template over documented source facts, no invention)
// ---------------------------------------------------------------------------

function capitalise(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** Medium lines often start with the object name (e.g. Hanging scroll; ink and color on silk). */
function mediumLine(detail) {
  const medium = clean(detail.medium);
  if (!medium) return "";
  const objectName = clean(detail.objectName);
  let rest = medium;
  if (objectName && medium.toLowerCase().startsWith(objectName.toLowerCase())) {
    rest = medium.slice(objectName.length).replace(/^[\s;,.:-]+/, "");
  }
  return rest ? rest.replace(/\.+$/, "") : "";
}

/**
 * One or two sentences assembled only from documented fields:
 * <object name> from <place>, <date>. <medium>.
 * A community-only place is written in parentheses: <object name> (<people>), <date>.
 */
export function buildEnglishSummary(detail, place) {
  const base =
    clean(detail.objectName) || clean(detail.classification) || clean(detail.title) || "Object";
  const date = clean(detail.objectDate) || clean(detail.period);
  const first =
    place.labelKind === "country" ? base + " from " + place.label : base + " (" + place.label + ")";
  const firstSentence = capitalise(first + (date ? ", " + date : "")) + ".";
  const medium = mediumLine(detail);
  return medium ? firstSentence + " " + capitalise(medium) + "." : firstSentence;
}

// ---------------------------------------------------------------------------
// record normalisation
// ---------------------------------------------------------------------------

const REJECT = (reason) => ({ ok: false, reason });

/**
 * Turn one Met object detail into a display-ready record or a named rejection.
 * Acceptance requires, independently: a public-domain flag, a real https image on the
 * allowed host, a real title, a culture/country label, a date or medium, a documented place
 * and an in-taxonomy category. Nothing is invented to fill a missing field.
 */
export function normalizeDetail(rawDetail, ingestedAt) {
  if (!rawDetail || typeof rawDetail !== "object") return REJECT("missing_detail");
  const detail = sanitizeDetail(rawDetail);
  const objectID = Number(detail.objectID);
  if (!Number.isInteger(objectID) || objectID <= 0) return REJECT("bad_object_id");
  if (detail.isPublicDomain !== true) return REJECT("not_public_domain");

  const image = clean(detail.primaryImage);
  const thumbnail = clean(detail.primaryImageSmall);
  if (!isHttpsUrl(image) || hostOf(image) !== MET.imageHosts[0]) return REJECT("no_public_image");
  if (!isHttpsUrl(thumbnail) || hostOf(thumbnail) !== MET.imageHosts[0]) {
    return REJECT("no_thumbnail_image");
  }

  const title = clean(detail.title);
  if (title.length < 2) return REJECT("no_title");
  if (/^(untitled|title|no title|unknown)$/i.test(title)) return REJECT("no_title");

  const culture = clean(detail.culture);
  const country = clean(detail.country);
  if (!culture && !country) return REJECT("no_culture_or_country");

  const objectDate = clean(detail.objectDate);
  const medium = clean(detail.medium);
  if (!objectDate && !medium) return REJECT("no_date_or_medium");

  const place = resolvePlace({ country, culture });
  if (!place) return REJECT("place_unmapped:" + (country || culture));

  const category = resolveCategory(detail);
  const tags = (detail.tags || [])
    .map((tag) => clean(typeof tag === "string" ? tag : tag && tag.term))
    .filter(Boolean)
    .filter((tag) => tag.length <= 60)
    .filter((tag, index, all) => all.indexOf(tag) === index)
    .slice(0, 4);
  if (tags.length === 0) {
    // A record without keywords still has the institution's own classification, object
    // name or department label; never invent a keyword.
    for (const fallbackTag of [
      clean(detail.classification),
      clean(detail.objectName),
      clean(detail.department),
    ]) {
      if (fallbackTag && fallbackTag.length <= 60) {
        tags.push(fallbackTag);
        break;
      }
    }
  }

  const objectURL = clean(detail.objectURL);
  if (!isHttpsUrl(objectURL)) return REJECT("no_source_url");
  const metadataDate = clean(detail.metadataDate);
  if (!isIsoDate(metadataDate)) return REJECT("no_source_modified");
  const creditLine = clean(detail.creditLine);

  const media = {
    url: image,
    license: MET.license,
    credit: creditLine ? MET.organization + ", " + creditLine : MET.organization,
    thumbnailUrl: thumbnail,
  };

  const source = {
    organization: MET.organization,
    url: objectURL,
    license: MET.license,
    licenseUrl: MET.licenseUrl,
    attribution: creditLine
      ? MET.organization + ", New York - " + creditLine
      : MET.organization + ", New York - Open Access",
    modified: metadataDate,
  };

  const id = "met-" + objectID;
  const item = {
    id,
    version: CULTURE_SCHEMA_VERSION,
    title: { en: title, original: title, originalLanguage: "en" },
    summary: { en: buildEnglishSummary(detail, place) },
    taxonomy: category.subcategory
      ? { category: category.category, subcategory: category.subcategory }
      : { category: category.category },
    place: place.community
      ? { continent: place.continent, countries: place.countries, community: place.community }
      : { continent: place.continent, countries: place.countries },
    tags,
    media,
    source,
    provenance: "machine-translated",
    ingestedAt,
  };
  const dateLabel = objectDate || clean(detail.period);
  if (dateLabel) item.period = dateLabel;
  if (place.region && clean(detail.region)) item.place.region = clean(detail.region);
  const subject = clean(detail.classification) || clean(detail.objectName);
  if (subject) item.subject = subject;

  // Curatorial selection metadata used for the index weight. isHighlight is the Met's own
  // curatorial flag; the remaining factors are documented richness, not rarity.
  const richness = {
    hasDate: Boolean(objectDate),
    hasCultureAndCountry: Boolean(culture) && Boolean(country),
    hasMedium: Boolean(medium),
    hasSourceTags: tags.length > 0,
    isHighlight: detail.isHighlight === true,
  };
  let weight = 0.4;
  if (richness.hasDate) weight += 0.15;
  if (richness.hasCultureAndCountry) weight += 0.1;
  if (richness.hasMedium) weight += 0.1;
  if (richness.hasSourceTags) weight += 0.1;
  if (richness.isHighlight) weight += 0.15;
  weight = Math.min(1, Math.round(weight * 100) / 100);

  return {
    ok: true,
    item,
    weight,
    richness,
    categoryRule: category.matchedRule,
  };
}

/** Stable subset kept in the raw snapshot so a rebuild can re-run the mapping offline. */
export function snapshotDetail(detail) {
  return {
    objectID: detail.objectID,
    isHighlight: detail.isHighlight === true,
    isPublicDomain: detail.isPublicDomain === true,
    title: detail.title || "",
    objectName: detail.objectName || "",
    culture: detail.culture || "",
    country: detail.country || "",
    region: detail.region || "",
    period: detail.period || "",
    dynasty: detail.dynasty || "",
    objectDate: detail.objectDate || "",
    medium: detail.medium || "",
    classification: detail.classification || "",
    department: detail.department || "",
    creditLine: detail.creditLine || "",
    accessionNumber: detail.accessionNumber || "",
    metadataDate: detail.metadataDate || "",
    objectURL: detail.objectURL || "",
    primaryImage: detail.primaryImage || "",
    primaryImageSmall: detail.primaryImageSmall || "",
    tags: (detail.tags || []).map((tag) => clean(tag && tag.term)).filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// polite HTTP
// ---------------------------------------------------------------------------

/**
 * Sequential limiter. The Met API sits behind an edge WAF that bans a burst (observed:
 * roughly 85 requests in 20 seconds -> a temporary 403 for about five minutes). One request
 * at a time, spaced by gapMs, is the contract for this corpus.
 */
export function createLimiter(gapMs = DEFAULT_GAP_MS) {
  let last = 0;
  return async function limit() {
    const wait = last + gapMs - Date.now();
    if (wait > 0) await new Promise((resolveWait) => setTimeout(resolveWait, wait));
    last = Date.now();
  };
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/**
 * Fetch one JSON document with bounded retries and a long backoff on the WAF 403.
 * A 404 is a normal no-such-object answer, not a failure. Any other terminal response
 * throws with the status only - never the body, which can contain an incident page.
 */
export async function fetchJson(url, { limit, retries = 4, label = "" } = {}) {
  let attempt = 0;
  let backoffMs = 4000;
  for (;;) {
    attempt += 1;
    if (limit) await limit();
    let response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "today-cultural-corpus/1.0 (Met Open Access CC0; contact: owner)",
        },
      });
    } catch (error) {
      if (attempt > retries) {
        throw new Error("network failure for " + label + " (" + (error && error.name) + ")");
      }
      log("  network error, retrying in " + backoffMs + "ms: " + label);
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 120000);
      continue;
    }
    if (response.status === 200) {
      const text = await response.text();
      try {
        return { status: 200, json: JSON.parse(text) };
      } catch {
        if (attempt > retries) throw new Error("non-JSON 200 body for " + label);
        log("  non-JSON body, retrying in " + backoffMs + "ms: " + label);
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 120000);
        continue;
      }
    }
    if (response.status === 404) {
      await response.body?.cancel().catch(() => {});
      return { status: 404, json: null };
    }
    await response.body?.cancel().catch(() => {});
    if (attempt > retries) {
      throw new Error(
        "HTTP " + response.status + " for " + label + " after " + attempt + " attempts",
      );
    }
    const waf = response.status === 403 || response.status === 429;
    const wait = waf
      ? Math.min(30000 * attempt, 180000)
      : Math.min(backoffMs + 2000 * attempt, 60000);
    log(
      "  HTTP " +
        response.status +
        ", waiting " +
        Math.round(wait / 1000) +
        "s then retrying: " +
        label,
    );
    await sleep(wait);
    backoffMs = Math.min(backoffMs * 2, 120000);
  }
}
