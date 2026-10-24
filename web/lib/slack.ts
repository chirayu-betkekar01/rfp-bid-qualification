/**
 * Slack messages for the bid-qualification round.
 *
 * Demo setup: one incoming webhook posts to one channel, and each message names the
 * person it is for. Every attempt is logged in `notification`, sent or not, so the
 * manager can see who was told what. Messages never include buyer contact details.
 */
import type { Db } from "./requirements";

export type Message = {
  personId: number | null;
  kind: "send_out" | "forwarded" | "reassigned" | "nudge" | "all_done";
  text: string;                  // Slack mrkdwn
};

export type Post = (text: string) => Promise<{ ok: boolean; error?: string }>;

export const appUrl = () => (process.env.APP_BASE_URL || "http://localhost:3100").replace(/\/$/, "");
export const personalLink = (token: string) => `${appUrl()}/r/${token}`;
export const managerLink = (rfpId: number) => `${appUrl()}/rfps/${rfpId}`;

export const postToSlack: Post = async (text) => {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return { ok: false, error: "SLACK_WEBHOOK_URL is not set" };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return response.ok ? { ok: true } : { ok: false, error: `Slack replied ${response.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

/** Post each message and log the outcome. Runs after the change is committed, so a Slack outage never undoes it. */
export async function deliver(db: Db, rfpId: number, messages: Message[], post: Post = postToSlack): Promise<number> {
  let sent = 0;
  for (const m of messages) {
    const result = await post(m.text);
    if (result.ok) sent += 1;
    await db.query(
      `insert into notification (rfp_id, person_id, kind, text, ok, error) values ($1, $2, $3, $4, $5, $6)`,
      [rfpId, m.personId, m.kind, m.text, result.ok, result.error ?? null],
    );
  }
  return sent;
}
