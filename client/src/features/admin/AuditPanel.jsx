/**
 * Audit log.
 *
 * Read-only evidence of who did what. Every workflow decision, account change and
 * settings edit lands here, which is what makes the console defensible.
 */

import { useMemo, useState } from "react";
import { History, RefreshCw, ShieldCheck } from "lucide-react";
import { adminApi } from "../../lib/api.js";
import { useAsync } from "../../lib/hooks.js";
import { formatDateTime, formatRelative, humanise } from "../../lib/format.js";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  ListSkeleton,
  PageHeader,
  SearchInput,
  Select,
  StatCard,
  StatGrid
} from "../../components/ui/index.js";

const LIMITS = [50, 100, 200, 500];

/** Turns an audit action code into a readable verb group. */
const groupOf = (action) => String(action || "").split(".")[0] || "other";

export function AuditPanel() {
  const [limit, setLimit] = useState(100);
  const [term, setTerm] = useState("");
  const [group, setGroup] = useState("all");

  const log = useAsync(async () => {
    const result = await adminApi.audit({ limit });
    return result.audit || [];
  }, [limit]);

  const groups = useMemo(() => {
    const set = new Set((log.data || []).map((entry) => groupOf(entry.action)));
    return [...set].sort();
  }, [log.data]);

  const rows = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return (log.data || [])
      .filter((entry) => group === "all" || groupOf(entry.action) === group)
      .filter(
        (entry) =>
          !needle ||
          `${entry.actor} ${entry.action} ${JSON.stringify(entry.details || {})}`
            .toLowerCase()
            .includes(needle)
      );
  }, [log.data, term, group]);

  const columns = [
    {
      key: "created_at",
      header: "When",
      render: (row) => (
        <span className="stack stack--sm">
          <span>{formatDateTime(row.created_at)}</span>
          <span className="text-caption">{formatRelative(row.created_at)}</span>
        </span>
      )
    },
    { key: "actor", header: "Actor", render: (row) => <span className="text-strong">{row.actor}</span> },
    {
      key: "action",
      header: "Action",
      render: (row) => (
        <span className="stack stack--sm">
          <span>{humanise(row.action.replace(/\./g, " "))}</span>
          <span className="mono text-caption">{row.action}</span>
        </span>
      )
    },
    {
      key: "incident",
      header: "Incident",
      render: (row) => (row.incident_id ? <span className="mono">#{row.incident_id}</span> : "—")
    },
    {
      key: "details",
      header: "Details",
      render: (row) => (
        <span className="mono text-caption clamp-2">
          {row.details ? JSON.stringify(row.details) : "—"}
        </span>
      )
    }
  ];

  return (
    <div className="page">
      <PageHeader
        title="Audit log"
        subtitle="Every recorded action, newest first."
        actions={
          <Button variant="outline" icon={RefreshCw} onClick={log.reload} busy={log.loading}>
            Refresh
          </Button>
        }
      />

      {log.error ? (
        <ErrorState title="We could not load the audit log" error={log.error} onRetry={log.reload} />
      ) : null}

      <StatGrid>
        <StatCard icon={History} label="Entries loaded" value={(log.data || []).length} hint={`Limit ${limit}`} />
        <StatCard
          icon={ShieldCheck}
          label="Account events"
          value={(log.data || []).filter((entry) => groupOf(entry.action) === "account").length}
          hint="Created, activated, deactivated"
        />
        <StatCard
          label="Workflow events"
          value={(log.data || []).filter((entry) => groupOf(entry.action) === "incident").length}
          hint="Validated, assigned, closed"
        />
      </StatGrid>

      <FilterBar summary={`${rows.length} of ${(log.data || []).length} entries`}>
        <SearchInput
          value={term}
          onChange={setTerm}
          placeholder="Actor, action or detail"
          label="Search the audit log"
        />
        <Select label="Category" value={group} onChange={(event) => setGroup(event.target.value)}>
          <option value="all">Every category</option>
          {groups.map((value) => (
            <option key={value} value={value}>
              {humanise(value)}
            </option>
          ))}
        </Select>
        <Select label="Entries" value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
          {LIMITS.map((value) => (
            <option key={value} value={value}>
              Latest {value}
            </option>
          ))}
        </Select>
      </FilterBar>

      <Card>
        <CardHeader
          title="Recorded actions"
          subtitle="Details are stored as the server recorded them"
          headingLevel={2}
        />
        {log.loading ? (
          <CardBody>
            <ListSkeleton rows={6} />
          </CardBody>
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            emptyState={
              <EmptyState
                compact
                icon={History}
                title="No entries match"
                message="Try a different category, or raise the number of entries loaded."
              />
            }
          />
        )}
      </Card>
    </div>
  );
}
