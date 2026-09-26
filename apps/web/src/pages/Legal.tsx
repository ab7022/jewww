import { useEffect } from "react";
import { Logo } from "../components/Nav.js";
import { Link } from "../router.js";

/**
 * Privacy policy, terms and refund policy.
 *
 * Written from what the product actually does — every collection, recipient and
 * retention below maps to a collection in apps/server/src/db.ts or a service the
 * server calls. If the code changes what it stores or sends, this page must change
 * with it; the Chrome Web Store and the payment provider both hold us to it.
 */

const UPDATED = "27 September 2026";
const CONTACT = "bayees1@gmail.com";

type Doc = { title: string; path: string; body: React.ReactNode };

const Mail = () => <a href={`mailto:${CONTACT}`}>{CONTACT}</a>;

const PRIVACY: Doc = {
  title: "Privacy policy",
  path: "/privacy",
  body: (
    <>
      <p>
        Jev is a Chrome extension and website (jev-olive.vercel.app) that carries out tasks on web pages when you
        ask it to. This policy explains what Jev collects, why, who it is shared with, and how to have it deleted.
      </p>

      <h2>The short version</h2>
      <ul>
        <li>Jev only looks at a web page when you give it a task on that page.</li>
        <li>It never types passwords, one-time codes, card numbers or government ID numbers, and never makes payments for you.</li>
        <li>We do not sell your data, use it for advertising, or use it to train models.</li>
      </ul>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Your account:</strong> your Google account's email address, name and profile picture, when you sign
          in with Google. We never receive your Google password.
        </li>
        <li>
          <strong>What you ask Jev to do:</strong> the text of each request, the address of the page it started on,
          and a record of each step it took (for example “clicked ‘Easy Apply’”, the page address, and whether the
          step needed your approval). This is your task history.
        </li>
        <li>
          <strong>Page content, while a task runs:</strong> to decide each step, the extension sends the server a
          summary of the page you gave it the task on — the page's title and address, its visible buttons, links and
          form fields, and some of its visible text. What is typed in password, one-time-code and card-number fields is never read or sent. Page
          content is used to make the decision and is not stored, beyond the step record above.
        </li>
        <li>
          <strong>Details you save:</strong> anything you add under “Your details” (such as name, phone, city, job
          title) and your standing instructions. These are used only to fill in forms when you ask Jev to.
        </li>
        <li>
          <strong>Credits and orders:</strong> your credit balance, a ledger of credits used and added, and your
          orders. Card details are handled entirely by our payment provider; Jev never sees them.
        </li>
        <li>
          <strong>Voice:</strong> if you turn on voice, speech is recognised by Google Chrome's built-in speech
          recognition. Jev receives only the resulting text, as a request. No audio reaches Jev.
        </li>
        <li>
          <strong>Website analytics:</strong> anonymous, cookie-free page-view statistics from Vercel Web Analytics.
        </li>
      </ul>

      <h2>Who it is shared with</h2>
      <p>Only the service providers needed to run Jev, each limited to its part:</p>
      <ul>
        <li><strong>AI model providers</strong> (via OpenRouter): your request and the page summary for each step, to decide what to do and to write text you asked for.</li>
        <li><strong>Vercel</strong>: hosts the website and server.</li>
        <li><strong>MongoDB Atlas</strong>: stores the data listed above.</li>
        <li><strong>Google</strong>: sign-in, and speech recognition if you use voice.</li>
        <li><strong>Dodo Payments</strong>: our merchant of record, which processes purchases and issues invoices.</li>
      </ul>
      <p>We may disclose information if required by law.</p>

      <h2>Chrome Web Store user data policy</h2>
      <p>
        The use of information received from the Jev extension adheres to the Chrome Web Store User Data Policy,
        including the Limited Use requirements. Data is used only to provide the features you use; it is not
        transferred to third parties except as listed above to provide those features, not used for advertising,
        not used to determine creditworthiness, and not read by humans except with your consent, for security, or
        as required by law.
      </p>

      <h2>Permissions the extension asks for</h2>
      <ul>
        <li><strong>Site access</strong> — asked per site the first time you run a task there (or once for all sites, if you choose). Needed to read and act on the page.</li>
        <li><strong>Tabs, scripting</strong> — to run a task in the tab you are on and follow links it opens.</li>
        <li><strong>Side panel, storage, alarms</strong> — the Jev panel, your panel state, and keeping a long task alive.</li>
        <li><strong>Identity</strong> — Google sign-in.</li>
        <li><strong>Debugger</strong> (optional, asked only when needed) — attaching a file you chose to a form.</li>
        <li><strong>Microphone</strong> (only if you turn on voice).</li>
      </ul>

      <h2>How long we keep it, and deleting it</h2>
      <p>
        Account data, task history, saved details and orders are kept while your account exists. Sign-in sessions
        expire on their own. To delete your account and everything associated with it, email <Mail /> from the
        address you signed in with; we delete it within 30 days, except order records we must keep for tax and
        accounting. You can remove saved details yourself at any time from your account page.
      </p>

      <h2>Security</h2>
      <p>
        Data is sent over HTTPS. Sign-in tokens are stored only as hashes on the server, and the website keeps its
        long-lived session in an httpOnly cookie that page scripts cannot read.
      </p>

      <h2>Children</h2>
      <p>Jev is not intended for anyone under 16.</p>

      <h2>Changes and contact</h2>
      <p>
        We will update this page if what Jev collects changes, and change the date above. Questions: <Mail />.
      </p>
    </>
  ),
};

const TERMS: Doc = {
  title: "Terms of service",
  path: "/terms",
  body: (
    <>
      <p>By using the Jev extension or website you agree to these terms.</p>

      <h2>What Jev does</h2>
      <p>
        Jev carries out tasks you describe on web pages in your own browser, points to where things are, or explains
        a page. It acts on your instructions, with your accounts, on your behalf. You decide how far it may go: it
        asks before irreversible steps unless you tell it otherwise, and it never types passwords, codes, card or ID
        numbers, solves CAPTCHAs, creates accounts or makes payments.
      </p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Review what Jev does, especially anything you let it submit or send without asking.</li>
        <li>Use Jev only on sites and accounts you are allowed to use, and in line with those sites' terms.</li>
        <li>Do not use Jev for spam, fraud, scraping you are not permitted to do, or anything unlawful.</li>
      </ul>

      <h2>AI can make mistakes</h2>
      <p>
        Jev's decisions and any text it writes are generated by AI models and may be wrong. Jev is provided “as is”,
        without warranties. To the extent the law allows, we are not liable for indirect or consequential losses
        arising from actions taken in your browser at your request, and our total liability is limited to the amount
        you paid us in the 12 months before the claim.
      </p>

      <h2>Credits</h2>
      <p>
        New accounts receive free credits. Additional credits are sold as one-time packs through Dodo Payments, our
        merchant of record. Credits are used as Jev works, do not expire, have no cash value and cannot be
        transferred. See the <Link href="/refunds">refund policy</Link>.
      </p>

      <h2>Accounts</h2>
      <p>
        We may suspend accounts that break these terms. You may stop using Jev and ask for your account to be deleted
        at any time — see the <Link href="/privacy">privacy policy</Link>.
      </p>

      <h2>Changes</h2>
      <p>We may update these terms; continuing to use Jev after a change means you accept it. Contact: <Mail />.</p>
    </>
  ),
};

const REFUNDS: Doc = {
  title: "Refund policy",
  path: "/refunds",
  body: (
    <>
      <p>Credit packs are one-time purchases, processed by Dodo Payments, our merchant of record.</p>
      <ul>
        <li>
          <strong>Unused packs:</strong> if you have not used any of the credits from a pack, you can ask for a full
          refund within 14 days of purchase.
        </li>
        <li>
          <strong>Partly used packs:</strong> not refundable, except where required by law.
        </li>
        <li>
          <strong>Charged but no credits:</strong> if a payment went through and credits did not appear, we refund it
          or add the credits, whichever you prefer.
        </li>
      </ul>
      <p>
        To ask for a refund, email <Mail /> with the order date and the email you signed in with. Your orders and
        invoices are listed on your <Link href="/account">account page</Link>. Approved refunds go back to the
        original payment method, usually within 5–10 business days.
      </p>
    </>
  ),
};

export const LEGAL: Doc[] = [PRIVACY, TERMS, REFUNDS];

export function Legal({ path }: { path: string }) {
  const doc = LEGAL.find((d) => path.startsWith(d.path)) ?? PRIVACY;
  useEffect(() => {
    document.title = `${doc.title} — Jev`;
  }, [doc.title]);
  return (
    <div className="legal">
      <header className="legal-top">
        <Logo />
        <nav>
          {LEGAL.map((d) => (
            <Link key={d.path} href={d.path} className={d === doc ? "on" : ""}>
              {d.title}
            </Link>
          ))}
        </nav>
      </header>
      <main className="legal-body">
        <h1>{doc.title}</h1>
        <p className="muted">Last updated {UPDATED}</p>
        {doc.body}
      </main>
    </div>
  );
}
