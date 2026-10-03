/**
 * Message thread for a single incident.
 *
 * The same conversation appears in the citizen case view, the field agent app and
 * the operations console, so there is one implementation. Reading is public on the
 * citizen side; posting requires a signed-in account, which the composer reflects
 * instead of failing at submit time.
 */

import { useState } from "react";
import { LogIn, MessageSquare } from "lucide-react";
import { incidentsApi } from "../../lib/api.js";
import { formatDateTime, initials } from "../../lib/format.js";
import { useApp } from "../../app/AppContext.jsx";
import { Alert, Button, EmptyState, Textarea } from "../../components/ui/index.js";

export function MessageThread({ incidentId, messages = [], onPosted, placeholder }) {
  const { user } = useApp();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(event) {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    try {
      await incidentsApi.sendMessage(incidentId, body.trim());
      setBody("");
      onPosted?.();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {messages.length === 0 ? (
        <EmptyState
          compact
          icon={MessageSquare}
          title="No messages yet"
          message="Anything written here is visible to the citizen, the crew and the operations desk."
        />
      ) : (
        <ul className="stack stack--sm">
          {messages.map((message) => (
            <li className="card card--pad" key={message.id}>
              <div className="inline-row" style={{ gap: "var(--space-2)" }}>
                <span className="badge" data-tone={message.author_role === "socadel" ? "brand" : "info"}>
                  {message.author_role}
                </span>
                <span className="text-caption">
                  {message.author_name || initials(message.author_name)} ·{" "}
                  {formatDateTime(message.created_at)}
                </span>
              </div>
              <p className="body-text" style={{ marginTop: "var(--space-2)" }}>
                {message.body}
              </p>
            </li>
          ))}
        </ul>
      )}

      {user ? (
        <form className="stack stack--sm" onSubmit={send}>
          <Textarea
            label="Send a message"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={2}
            maxLength={2000}
            placeholder={placeholder || "Share anything that helps the crew or the resident."}
            error={error || undefined}
          />
          <div>
            <Button type="submit" variant="primary" icon={MessageSquare} busy={busy} disabled={!body.trim()}>
              Send message
            </Button>
          </div>
        </form>
      ) : (
        <Alert tone="info" icon={LogIn} title="Sign in to take part">
          Create a free citizen account to send messages about this case.
        </Alert>
      )}
    </div>
  );
}
