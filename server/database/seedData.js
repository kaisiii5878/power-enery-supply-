/**
 * Simulated demonstration data for the PostgreSQL seed.
 *
 * Clearly labelled as development data: fictional citizens, crews and
 * neighbourhoods, created so the university demonstration has realistic detail
 * without any real customer information.
 *
 * The incident and report fixtures are the same ones the in-memory store uses
 * (`server/store/seedIncidents.js`, `server/store/seedReports.js`), so the demo
 * behaves identically whether the app runs on PostgreSQL or offline.
 */

const ZONES = [
  { id: 1, name: "Yaounde Central", region: "Centre", latitude: 3.8667, longitude: 11.5, radius_m: 6000,
    description: "Bastos, Centre-ville, Melen and Odza feeders." },
  { id: 2, name: "Douala Wouri", region: "Littoral", latitude: 4.0511, longitude: 9.7679, radius_m: 7000,
    description: "Akwa, Bonamoussadi, Deido and Bonapriso feeders." }
];

/** Field crews, named after the assignees referenced by the incident fixtures. */
const CREWS = [
  { username: "voltcare.crew", full_name: "VoltCare Contractors", email: "dispatch@voltcare.example", phone: "+237690000101" },
  { username: "gridfix.crew", full_name: "GridFix CM", email: "dispatch@gridfix.example", phone: "+237690000102" }
];

/** Citizens, positioned inside the seeded outage clusters. */
const CITIZENS = [
  { username: "aida.ngombe", full_name: "Aida Ngombe", email: "aida.ngombe@example.cm", phone: "+237600000001",
    latitude: 3.8845, longitude: 11.5171, neighborhood: "Bastos, Yaounde" },
  { username: "bruno.ayissi", full_name: "Bruno Ayissi", email: "bruno.ayissi@example.cm", phone: "+237600000002",
    latitude: 4.0529, longitude: 9.7047, neighborhood: "Akwa, Douala" },
  { username: "clarisse.mbala", full_name: "Clarisse Mbala", email: "clarisse.mbala@example.cm", phone: "+237600000003",
    latitude: 4.0906, longitude: 9.7431, neighborhood: "Bonamoussadi, Douala" },
  { username: "didier.eto", full_name: "Didier Eto", email: "didier.eto@example.cm", phone: "+237600000004",
    latitude: 3.8667, longitude: 11.4967, neighborhood: "Melen, Yaounde" },
  { username: "estelle.fotso", full_name: "Estelle Fotso", email: "estelle.fotso@example.cm", phone: "+237600000005",
    latitude: 4.0531, longitude: 9.7050, neighborhood: "Akwa, Douala" },
  { username: "franck.ondoa", full_name: "Franck Ondoa", email: "franck.ondoa@example.cm", phone: "+237600000006",
    latitude: 3.8850, longitude: 11.5160, neighborhood: "Bastos, Yaounde" }
];

const AUDIT = [
  { actor: "SOCADEL operator", action: "auth.login", incident_id: null, details: { role: "socadel", simulated: true } },
  { actor: "SOCADEL operator", action: "incident.validated", incident_id: 2, details: { from: "pending_validation" } },
  { actor: "SOCADEL operator", action: "work.assigned", incident_id: 2, details: { contractor: "VoltCare Contractors" } },
  { actor: "GridFix CM", action: "incident.completed", incident_id: 4, details: { from: "under_intervention" } },
  { actor: "SOCADEL operator", action: "incident.closed", incident_id: 4, details: { restoration_confirmed: true } }
];

module.exports = { ZONES, CREWS, CITIZENS, AUDIT };