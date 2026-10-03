/**
 * Demonstration reports for the in-memory store.
 *
 * Generated deterministically (seeded PRNG) so cluster arithmetic in demo mode
 * is reproducible: the store recomputes every incident aggregate from these
 * rows, exercising the same domain code as production.
 */

function seededRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

const CATEGORIES = ["Total outage", "Low voltage", "Flickering", "Sparking / unsafe line", "Meter problem"];
const NAMES = [
  "M. Njoya", "A. Mbarga", "F. Etoundi", "R. Nkoulou", "C. Abena", "S. Biya", "L. Talla", "N. Ngo Bell",
  "P. Somo", "E. Mata", "J. Fogui", "B. Ayissi", "D. Etoa", "G. Ondoa", "T. Ndong", "K. Mballa"
];

const CLUSTERS = [
  { incident_id: 1, count: 26, origin: [3.8841, 11.5168], district: "Bastos, Yaounde", spread: 0.006, start: "2026-09-22T16:42:00.000Z", stepMinutes: 7 },
  { incident_id: 2, count: 42, origin: [4.0527, 9.7043], district: "Akwa, Douala", spread: 0.0075, start: "2026-09-22T14:05:00.000Z", stepMinutes: 8 },
  { incident_id: 3, count: 12, origin: [4.0908, 9.7434], district: "Bonamoussadi, Douala", spread: 0.0035, start: "2026-09-22T18:35:00.000Z", stepMinutes: 7 },
  { incident_id: 4, count: 6, origin: [3.8665, 11.4964], district: "Melen, Yaounde", spread: 0.002, start: "2026-09-21T07:40:00.000Z", stepMinutes: 18 }
];

function buildReports() {
  const random = seededRandom(20260929);
  const reports = [];
  let id = 100;
  for (const cluster of CLUSTERS) {
    for (let index = 0; index < cluster.count; index += 1) {
      const name = NAMES[(id + index) % NAMES.length];
      reports.push({
        id: (id += 1),
        incident_id: cluster.incident_id,
        user_id: null,
        reporter_name: name,
        phone: `+237 6${String(90000000 + id).slice(0, 8)}`,
        category: CATEGORIES[id % CATEGORIES.length],
        description: "No electricity reported by the resident; details captured from the mobile report form.",
        district: cluster.district,
        latitude: Number((cluster.origin[0] + (random() - 0.5) * cluster.spread).toFixed(6)),
        longitude: Number((cluster.origin[1] + (random() - 0.5) * cluster.spread).toFixed(6)),
        status: "clustered",
        severity: "low",
        photo_url: null,
        created_at: new Date(new Date(cluster.start).getTime() + index * cluster.stepMinutes * 60_000).toISOString()
      });
    }
  }
  return reports.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

module.exports = buildReports();
