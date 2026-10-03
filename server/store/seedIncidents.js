/** Demonstration incidents used by the in-memory store (no local MySQL). */
module.exports = [
  {
    id: 1, reference: "INC-2026-0047", title: "Clustered outage near Bastos feeder",
    district: "Bastos, Yaounde", latitude: 3.8841, longitude: 11.5168, radius_m: 500,
    reports_count: 37, severity: "high", status: "pending_validation", assignee: null,
    root_cause: "Awaiting SOCADEL validation", resolution: "Reports are being correlated before dispatch.",
    zone_id: 1, estimated_area_m2: 785398, severity_score: 75.5, agency_report: null, rejection_reason: null,
    first_report_at: "2026-09-22T18:42:00.000Z", last_report_at: "2026-09-22T19:58:00.000Z",
    validated_by: null, validated_at: null, completed_at: null, restored_at: null, closed_at: null,
    created_at: "2026-09-22T18:42:00.000Z", updated_at: "2026-09-22T19:58:00.000Z"
  },
  {
    id: 2, reference: "INC-2026-0051", title: "Transformer overload around Akwa",
    district: "Akwa, Douala", latitude: 4.0527, longitude: 9.7043, radius_m: 620,
    reports_count: 54, severity: "critical", status: "under_intervention", assignee: "VoltCare Contractors",
    root_cause: "Suspected low-voltage transformer overload", resolution: "Crew is isolating the affected branch and replacing fuses.",
    zone_id: 2, estimated_area_m2: 1207628, severity_score: 100, agency_report: "Isolating the affected branch and replacing LV fuse links.",
    rejection_reason: null, first_report_at: "2026-09-22T17:05:00.000Z", last_report_at: "2026-09-22T19:40:00.000Z",
    validated_by: "SOCADEL operator", validated_at: "2026-09-22T17:30:00.000Z",
    completed_at: null, restored_at: null, closed_at: null,
    created_at: "2026-09-22T17:05:00.000Z", updated_at: "2026-09-22T19:40:00.000Z"
  },
  {
    id: 3, reference: "INC-2026-0053", title: "Voltage instability reports in Bonamoussadi",
    district: "Bonamoussadi, Douala", latitude: 4.0908, longitude: 9.7434, radius_m: 350,
    reports_count: 12, severity: "medium", status: "validated", assignee: "SOCADEL Network Team",
    root_cause: "Probable feeder phase imbalance", resolution: "Validated and queued for field assignment.",
    zone_id: 2, estimated_area_m2: 384845, severity_score: 25.8, agency_report: null, rejection_reason: null,
    first_report_at: "2026-09-22T19:05:00.000Z", last_report_at: "2026-09-22T19:50:00.000Z",
    validated_by: "SOCADEL operator", validated_at: "2026-09-22T20:00:00.000Z",
    completed_at: null, restored_at: null, closed_at: null,
    created_at: "2026-09-22T19:05:00.000Z", updated_at: "2026-09-22T20:00:00.000Z"
  },
  {
    id: 4, reference: "INC-2026-0056", title: "Localized outage near Melen",
    district: "Melen, Yaounde", latitude: 3.8665, longitude: 11.4964, radius_m: 250,
    reports_count: 5, severity: "low", status: "closed", assignee: "GridFix CM",
    root_cause: "Service drop cable fault", resolution: "Cable repaired. Power restored and verified by customer confirmations.",
    zone_id: 1, estimated_area_m2: 196350, severity_score: 12, agency_report: "Replaced the damaged service drop and re-energised the span.",
    rejection_reason: null, first_report_at: "2026-09-21T08:10:00.000Z", last_report_at: "2026-09-21T09:30:00.000Z",
    validated_by: "SOCADEL operator", validated_at: "2026-09-21T09:45:00.000Z",
    completed_at: "2026-09-21T12:20:00.000Z", restored_at: "2026-09-21T12:55:00.000Z", closed_at: "2026-09-21T13:10:00.000Z",
    created_at: "2026-09-21T08:10:00.000Z", updated_at: "2026-09-21T13:10:00.000Z"
  }
];
