// Plain-language labels and colors for answers and for the flags code puts on AI suggestions.
// Shared by server pages and client components, so no "use client" here.
import type { Answer } from "./requirements";

export const ANSWER_TONES: Record<Answer, string> = {
  Yes: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300",
  No: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300",
  Maybe: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
};

export const GAP_NAMES: Record<string, string> = {
  fedramp: "FedRAMP",
  on_premises_or_private_cloud: "On-premises or private cloud",
  hipaa_baa: "HIPAA BAA",
  eu_data_residency: "EU data residency",
  cjis: "CJIS",
  stateramp_in_progress_q2_2027: "StateRAMP (in progress, Q2 2027)",
  no_native_telephony_via_twilio: "No native telephony (Twilio only)",
  breach_notice_72_hours: "Breach notice is 72 hours",
};

const AMBER = "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300";
const RED = "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300";
const GREY = "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200";

export function flagLabel(flag: string): { text: string; tone: string } {
  const [kind, name] = flag.split(":");
  const gap = GAP_NAMES[name] ?? name?.replaceAll("_", " ");
  switch (kind) {
    case "stale_source": return { text: "Source is stale", tone: AMBER };
    case "unprofiled_source": return { text: "Source not in vendor profile", tone: AMBER };
    case "hard_fail_gap": return { text: `Known gap, no-bid if mandatory: ${gap}`, tone: RED };
    case "soft_gap": return { text: `Known gap: ${gap}`, tone: GREY };
    default: return { text: flag, tone: GREY };
  }
}

export const isGap = (flag: string) => flag.startsWith("hard_fail_gap:") || flag.startsWith("soft_gap:");
