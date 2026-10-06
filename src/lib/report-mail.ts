import { reportDetail, type ReportDetail } from "./admin";
import { sendMail } from "./mail";

/** Reports go to REPORT_EMAIL; failing that, to the SMTP sender address, so they are never silently dropped. */
export const reportRecipient = () => process.env.REPORT_EMAIL?.trim() || process.env.SMTP_FROM?.match(/<([^>]+)>/)?.[1] || process.env.SMTP_FROM?.trim() || "";

const when = (ms: number) =>
  new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) + " IST";

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

/** Plain text on purpose: what people typed never gets interpreted as HTML. */
export function reportEmail(d: ReportDetail, origin: string): { subject: string; text: string } {
  const label = { reporter: "Reporter", reported: "Reported", system: "System" } as const;
  const recent = d.timeline.slice(-15).map((m) => `  [${when(m.at).replace(/^.*?, /, "")}] ${m.kind === "msg" ? `${label[m.who]}: ${clip(m.text, 300)}` : `(${m.text})`}`);
  const person = (u: ReportDetail["reporterInfo"]) => `${u.username ?? "(no username)"} <${u.email}> (${u.gender ?? "gender not set"})${u.blocked ? " - BLOCKED" : ""}`;

  const text = [
    `New report #${d.id}, ${when(d.at)}`,
    "",
    `Reason: ${d.reason || "(none given)"}`,
    "",
    `Reporter: ${person(d.reporterInfo)}`,
    `Reported: ${person(d.reportedInfo)}`,
    `The reported person has been reported ${d.timesReported} time${d.timesReported === 1 ? "" : "s"} in total.`,
    "",
    d.timeline.length
      ? `Last ${recent.length} of ${d.timeline.length} entries in the conversation:\n${recent.join("\n")}`
      : "The conversation is no longer stored.",
    "",
    `Review it, block or dismiss: ${origin}/admin#report=${d.id}`,
  ].join("\n");

  return { subject: `[Text to X] New report #${d.id}: ${clip(d.reason || "no reason given", 60)}`, text };
}

/** Emails the report to the admin. Never throws: the report is already saved, so a mail problem is only logged. */
export async function notifyReport(reportId: number, origin: string): Promise<void> {
  try {
    const { subject, text } = reportEmail(await reportDetail(reportId), origin);
    await sendMail({ to: reportRecipient(), subject, text });
  } catch (e) {
    console.error(`Could not email report #${reportId}:`, e);
  }
}
