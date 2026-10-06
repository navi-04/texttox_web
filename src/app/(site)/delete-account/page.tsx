import type { Metadata } from "next";
import DeleteAccountForm from "@/components/DeleteAccountForm";
import { reportRecipient } from "@/lib/report-mail";

export const metadata: Metadata = {
  title: "Delete your account · Text to X",
  description: "How to delete your Text to X account and the data tied to it.",
  robots: { index: true, follow: true },
};

// Read at request time so the contact address comes from the environment, not from the code.
export const dynamic = "force-dynamic";

export default function DeleteAccount() {
  const contact = process.env.CONTACT_EMAIL?.trim() || reportRecipient();

  return (
    <main className="x-doc">
      <h1>Delete your Text to X account</h1>
      <p className="x-dim">For the Text to X app and website (texttox.fewinfos.com)</p>

      <p>
        You can delete your Text to X account, and the data tied to it, yourself. It takes less than a minute and works whether or not you still have the app
        installed.
      </p>

      <h2>How to delete your account</h2>
      <ol>
        <li>Enter the username (or email) and password of your account below.</li>
        <li>Tick the box to confirm.</li>
        <li>Press &ldquo;Delete my account permanently&rdquo;. The deletion happens immediately.</li>
      </ol>

      <DeleteAccountForm />

      <h2>What is deleted</h2>
      <p>Everything tied to your account is deleted right away and can&rsquo;t be recovered:</p>
      <ul>
        <li>your email address, username and password (which was only ever stored as a one-way hash)</li>
        <li>your boy / girl choice and your &ldquo;last seen&rdquo; time</li>
        <li>your sign-in sessions and any waiting sign-in codes</li>
        <li>every private chat you were in, with its messages (the other person simply returns to the home screen)</li>
        <li>your public room messages</li>
        <li>reports you made and reports made about you, and any admin log lines that mention your email</li>
      </ul>

      <h2>What is kept, and for how long</h2>
      <p>
        Nothing that identifies you is kept after deletion. The only things that remain are short-lived counters used to limit abuse (for example, too many sign-in
        attempts from one internet address). They are not linked to your account and expire on their own within an hour. Messages that other people sent to you
        stay in their own chats until those chats are deleted by the normal rules (when both people have left, or after 24 hours), but they are no longer linked
        to you.
      </p>

      <h2>Can&rsquo;t sign in, or forgot your password?</h2>
      <p>
        Use &ldquo;Forgot password?&rdquo; in the app to set a new password, then come back here. If that isn&rsquo;t possible, email{" "}
        <a href={`mailto:${contact}`}>{contact}</a> from the address you signed up with and we will delete the account for you, normally within 30 days.
      </p>
      <p>
        Accounts that have been blocked for breaking the rules can&rsquo;t be deleted here; email the address above and we will help.
      </p>

      <p className="x-dim" style={{ marginTop: 28 }}>
        See also our <a href="/privacy-policy">privacy policy</a>.
      </p>
    </main>
  );
}
