import type { Metadata } from "next";
import { reportRecipient } from "@/lib/report-mail";

export const metadata: Metadata = {
  title: "Privacy Policy · Text to X",
  description: "What Text to X collects, how long it is kept, and how to have it deleted.",
  robots: { index: true, follow: true },
};

// Read at request time so the contact address comes from the environment, not from the code.
export const dynamic = "force-dynamic";

const UPDATED = "9 October 2026";

export default function PrivacyPolicy() {
  const contact = process.env.CONTACT_EMAIL?.trim() || reportRecipient();

  return (
    <main className="x-doc">
      <h1>Privacy Policy</h1>
      <p className="x-dim">Text to X · Last updated {UPDATED}</p>

      <p>
        Text to X is an anonymous chat service at texttox.fewinfos.com. It is built to keep as little about you as possible. This page explains exactly what is
        kept, for how long, and how to have it deleted.
      </p>

      <h2>The short version</h2>
      <ul>
        <li>Your chats are anonymous. Other people never see your email, only a username, and only if you choose to show it.</li>
        <li>Private chat messages (including Truth or Dare games) are deleted as soon as both people have left the chat, and in any case after 24 hours.</li>
        <li>Public room messages disappear automatically, after 12 to 48 hours at most (the time is set by the site admin).</li>
        <li>We have no advertising, no analytics and no tracking. We do not sell or share your data.</li>
        <li>You can have your account and everything tied to it deleted at any time (see &ldquo;Deleting your data&rdquo;).</li>
      </ul>

      <h2>What we keep, and for how long</h2>
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Why</th>
            <th>How long</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Email address</td>
            <td>To send your sign-up and password-reset codes, and to recognise your account.</td>
            <td>Until your account is deleted.</td>
          </tr>
          <tr>
            <td>Username</td>
            <td>To sign in, and the name you may choose to show in a chat.</td>
            <td>Until your account is deleted.</td>
          </tr>
          <tr>
            <td>Password</td>
            <td>Only a salted one-way hash is stored. Nobody, including us, can read your password.</td>
            <td>Until your account is deleted or you change it.</td>
          </tr>
          <tr>
            <td>Boy / girl choice</td>
            <td>Only if you pick a specific chat, to pair you with the person you asked for.</td>
            <td>Until your account is deleted.</td>
          </tr>
          <tr>
            <td>Sign-in session</td>
            <td>A random token (stored as a hash) in a cookie keeps you signed in.</td>
            <td>30 days, or until you log out.</td>
          </tr>
          <tr>
            <td>Sign-up and reset codes</td>
            <td>Proves you own the email. Stored as a hash.</td>
            <td>10 minutes, then deleted.</td>
          </tr>
          <tr>
            <td>Private chat messages (specific chat, random chat and Truth or Dare)</td>
            <td>To deliver the conversation. In Truth or Dare this includes the truths and dares shown in the game, and any you type for the other person.</td>
            <td>Deleted when both people have left, and after 24 hours of inactivity at the latest. The exception is a chat that was reported (below).</td>
          </tr>
          <tr>
            <td>Public room messages</td>
            <td>To show them to everyone in the room. Other people see only the text and the time, never who wrote it. We link each message to its account so we can remove abuse.</td>
            <td>Hidden after a set time of 12 to 48 hours at most, and then deleted.</td>
          </tr>
          <tr>
            <td>Reports</td>
            <td>If someone reports a chat, the reporter&rsquo;s note and the conversation are kept so the site admin can review them.</td>
            <td>The conversation is deleted when the report is closed without action. Records of the report itself are kept for safety, and are deleted with the accounts involved.</td>
          </tr>
          <tr>
            <td>Internet address (IP)</td>
            <td>Used only for short-lived counters that limit abuse, such as too many sign-in attempts.</td>
            <td>Minutes to one hour, then deleted. It is not linked to your account.</td>
          </tr>
          <tr>
            <td>&ldquo;Last seen&rdquo; time</td>
            <td>To show how many people are online and whether your chat partner is online.</td>
            <td>Until your account is deleted.</td>
          </tr>
        </tbody>
      </table>

      <h2>What we do not collect</h2>
      <p>
        No location, contacts, photos, microphone or camera access, device identifiers, or advertising identifiers. We do not use analytics or advertising
        services, and the only cookie is the one that keeps you signed in.
      </p>

      <h2>Who can see what</h2>
      <ul>
        <li>
          <strong>Other users</strong> see only what you say. Your username is shown to a chat partner only if you switch your anonymity off in that chat. Your email is
          never shown to other users.
        </li>
        <li>
          <strong>The site admin</strong> can see account details (email, username) and can read a conversation only after someone has reported it. The admin can also
          see who posted a public room message, to remove abuse.
        </li>
        <li>
          <strong>Service providers</strong> that run the site on our behalf (web hosting, the database, and email delivery) process data only to provide the service.
          We do not sell your data or share it for advertising.
        </li>
        <li>
          <strong>The law:</strong> we may disclose information if we are legally required to.
        </li>
      </ul>

      <h2>Deleting your data</h2>
      <p>
        You can delete your account yourself at any time, instantly, at <a href="/delete-account">texttox.fewinfos.com/delete-account</a>. Enter your username (or
        email) and password and everything tied to your account is permanently deleted: your email, username, password hash, sessions, chats, public room messages
        and reports about you or by you. If you can&rsquo;t sign in, email <a href={`mailto:${contact}`}>{contact}</a> from the address you signed up with and we will
        delete it for you, normally within 30 days. Chats and public messages are also deleted automatically as described above.
      </p>

      <h2>Security</h2>
      <p>
        Connections to the site are encrypted with HTTPS. Passwords are stored only as salted hashes, and sign-in codes are stored only as hashes and expire after 10
        minutes. No system is perfectly secure, so please do not share information in chat that you would not want others to see.
      </p>

      <h2>Children</h2>
      <p>Text to X is not for children under 13, and we do not knowingly collect data from them. If you believe a child has an account, contact us and we will delete it.</p>

      <h2>Changes to this policy</h2>
      <p>If we change this policy we will update the date at the top of this page.</p>

      <h2>Contact</h2>
      <p>
        Questions or deletion requests: <a href={`mailto:${contact}`}>{contact}</a>
      </p>
    </main>
  );
}
