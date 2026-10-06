import nodemailer, { type Transporter } from "nodemailer";

let transport: Transporter | undefined;

function smtp() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return { host: SMTP_HOST, port: Number(SMTP_PORT) || 465, user: SMTP_USER, pass: SMTP_PASS, from: SMTP_FROM || SMTP_USER };
}

export async function sendMail(msg: { to: string; subject: string; text: string; html?: string }): Promise<void> {
  const cfg = smtp();
  if (!cfg) {
    if (process.env.NODE_ENV === "production") throw new Error("SMTP_HOST / SMTP_USER / SMTP_PASS are not set");
    console.log(`[dev] email to ${msg.to}\n  subject: ${msg.subject}\n${msg.text}`); // no mail server configured: print instead
    return;
  }
  transport ??= nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 10_000,
    socketTimeout: 15_000,
  });
  await transport.sendMail({ from: cfg.from, ...msg });
}

export type CodePurpose = "signup" | "reset";

/** The one-time code for creating an account or resetting a password. */
export async function sendLoginCode(to: string, code: string, purpose: CodePurpose = "signup"): Promise<void> {
  if (!smtp() && process.env.NODE_ENV !== "production") {
    console.log(`[dev] login code for ${to}: ${code}`);
    return;
  }
  const what = purpose === "reset" ? "reset your password" : "create your account";
  await sendMail({
    to,
    subject: `${code} is your Text to X code`,
    text: `Your Text to X code is ${code}.

Enter it to ${what}. It expires in 10 minutes. If you did not ask for it, ignore this email: nothing changes unless the code is used.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:360px">
      <p style="margin:0 0 12px">Your Text to X code to ${what}:</p>
      <p style="font-size:32px;letter-spacing:6px;font-weight:600;margin:0 0 12px">${code}</p>
      <p style="color:#666;font-size:13px;margin:0">It expires in 10 minutes. If you did not ask for it, ignore this email: nothing changes unless the code is used.</p>
    </div>`,
  });
}
