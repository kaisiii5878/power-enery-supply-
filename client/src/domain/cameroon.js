/**
 * Cameroon location reference data.
 *
 * These are the curated publishing suggestions shown in the report form. They
 * are only hints: every field stays free text, and users can always type a
 * quarter that is not listed and pin it on the map themselves.
 */

export const REGION_CENTRE = {
  Adamawa: [7.32, 13.58],
  Centre: [3.87, 11.52],
  East: [4.58, 13.68],
  "Far North": [10.59, 14.32],
  Littoral: [4.05, 9.7],
  North: [9.3, 13.4],
  "North-West": [5.96, 10.15],
  West: [5.48, 10.42],
  South: [2.9, 11.15],
  "South-West": [4.16, 9.24]
};

export const CITIES_BY_REGION = {
  Adamawa: {
    Ngaoundere: ["Dang", "Joli-Soir", "Bali", "Sabongari", "Ngaoundéré I", "Ngaoundéré II"],
    Banyo: ["Centre", "Hore Mayo", "Hore Taram"],
    Meiganga: ["Centre", "Garga", "Djounde"]
  },
  Centre: {
    Yaounde: [
      "Bastos", "Melen", "Mokolo", "Nlongkak", "Essos", "Mvog-Mbi", "Nsam", "Biyem-Assi",
      "Emombo", "Mendong", "Yaoundé I", "Yaoundé II", "Yaoundé III", "Yaoundé IV",
      "Yaoundé V", "Yaoundé VI", "Yaoundé VII"
    ],
    Mbalmayo: ["Centre", "Abang", "Nkolngok"],
    Obala: ["Centre", "Nkolbogo", "Nkometou"]
  },
  East: {
    Bertoua: ["Centre", "Enia", "Yadembam", "Mokolo I", "Mokolo II", "Bertoua I", "Bertoua II"],
    Batouri: ["Centre", "Mbang", "Ndong"],
    "Abong-Mbang": ["Centre", "Zoume"]
  },
  "Far North": {
    Maroua: [
      "Centre", "Domayo", "Palar", "Doualaré", "Zokok", "Djimi", "Mayel Ibbe",
      "Djarengol", "Ouro Tchede", "Salak", "Maroua I", "Maroua II"
    ],
    Kousseri: ["Centre", "Afadé", "Mada"],
    Mokolo: ["Centre", "Dougoy"]
  },
  Littoral: {
    Douala: [
      "Akwa", "Bonanjo", "Bonapriso", "Bonamoussadi", "Deido", "Bepanda", "Logbessou",
      "Makepe", "New Bell", "Village", "PK 14"
    ],
    Nkongsamba: ["Centre", "Ebonè", "Mbaressoumtou"],
    Edéa: ["Centre", "Pongo", "Ndogbong"]
  },
  North: {
    Garoua: ["Centre", "Roumdé Adjia", "Poumpoumré", "Yelwa", "Garoua Winde", "Garoua I", "Garoua II"],
    Guider: ["Centre", "Djougui"],
    Tchollire: ["Centre", "Barki"]
  },
  "North-West": {
    Bamenda: [
      "Commercial Avenue", "Nkwen", "Mankon", "Mile 4", "Mile 3", "Ntarikon",
      "Bamendankwe", "Bamenda I", "Bamenda II", "Bamenda III"
    ],
    Kumbo: ["Squares", "Tobin", "Shisong"],
    Ndop: ["Centre", "Bamessing"]
  },
  West: {
    Bafoussam: [
      "Centre", "Famla", "Djeleng", "Banengo", "Tchitchap", "Baleng", "Toungang II",
      "Tchouwong", "Tsewong", "Bafoussam I", "Bafoussam II", "Bafoussam III"
    ],
    Dschang: ["Centre", "Paidground", "Tsinkop"],
    Mbouda: ["Centre", "Bamessingue"]
  },
  South: {
    Ebolowa: ["Centre", "New-Bell", "Angounou", "Ebolowa I", "Ebolowa II", "Elat", "Eves"],
    Kribi: ["Centre", "Mpangou", "Londji"],
    Sangmelima: ["Centre", "Bulu"]
  },
  "South-West": {
    Buea: ["Molyko", "Mile 17", "Great Soppo", "Muea", "Buea Town", "Small Soppo", "Buea I", "Buea II"],
    Limbe: ["Down Beach", "Church Street", "New Town", "Bota"],
    Kumba: ["Fiango", "Mbonge Road", "Kosala", "Centre"]
  }
};

export const REGIONS = Object.keys(CITIES_BY_REGION);

export const citiesFor = (region) => Object.keys(CITIES_BY_REGION[region] || {});

export const quartersFor = (region, city) => CITIES_BY_REGION[region]?.[city] || [];

/** Default camera centre when a report has no pin yet. */
export const CAMEROON_CENTRE = [5.5, 12.5];
export const CAMEROON_ZOOM = 6;

/** Builds the district string the API stores for a report. */
export function composeDistrict({ quarter, city, region }) {
  return [quarter, city, region].map((part) => String(part || "").trim()).filter(Boolean).join(", ");
}

/**
 * Maps a geocoder result back onto the region names used in the form. Photon
 * returns French spellings, so both are matched.
 */
const REGION_ALIASES = {
  Adamawa: ["adamawa", "adamaoua"],
  Centre: ["centre"],
  East: ["east", "est"],
  "Far North": ["far north", "extreme-nord", "extreme nord"],
  Littoral: ["littoral"],
  North: ["north", "nord"],
  "North-West": ["north-west", "north west", "nord-ouest", "nord ouest"],
  West: ["west", "ouest"],
  South: ["south", "sud"],
  "South-West": ["south-west", "south west", "sud-ouest", "sud ouest"]
};

const fold = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export function matchRegion(rawRegion) {
  const value = fold(rawRegion);
  if (!value) return null;
  return REGIONS.find((region) => REGION_ALIASES[region].some((alias) => value.includes(fold(alias)))) || null;
}
