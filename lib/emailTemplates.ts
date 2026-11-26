import { appBaseUrl } from "@/lib/mailer";

const GOLD = "#f0c05a";
const BG = "#0b1a16";

function shell(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="ro"><body style="margin:0;padding:0;background:${BG};font-family:Futura,'Century Gothic',Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#122420;border:1px solid #1e3a34;border-radius:14px;padding:26px 24px">
        <tr><td style="text-align:center;color:${GOLD};font-size:22px;letter-spacing:6px;font-weight:bold;padding-bottom:6px">ST0NE QUIZ</td></tr>
        <tr><td style="text-align:center;color:#8fb0ac;font-size:12px;letter-spacing:3px;text-transform:uppercase;padding-bottom:20px">${title}</td></tr>
        <tr><td style="color:#cfe0de;font-size:15px;line-height:1.6">${bodyHtml}</td></tr>
        <tr><td style="border-top:1px solid #1e3a34;padding-top:14px;color:#5f7e7a;font-size:11px;line-height:1.5;text-align:center">
          Ai primit acest email pentru că cineva a folosit adresa ta pe stonequiz.dalimagic.ro.<br/>Dacă nu ai fost tu, ignoră mesajul — fără click nu se întâmplă nimic.
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px auto"><tr>
    <td style="background:${GOLD};border-radius:10px">
      <a href="${href}" style="display:inline-block;padding:14px 26px;color:#20160a;font-size:15px;font-weight:bold;text-decoration:none;letter-spacing:1px">${label}</a>
    </td></tr></table>`;
}

export function verificationEmail(displayName: string, token: string) {
  const link = `${appBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  return {
    subject: "Confirmă-ți adresa de email — ST0NE QUIZ",
    text: [
      `Salut, ${displayName}!`,
      "",
      "Confirmă-ți adresa de email ca să-ți activezi contul ST0NE QUIZ:",
      link,
      "",
      "Linkul e valabil 24 de ore și poate fi folosit o singură dată.",
      "Dacă nu ai creat tu contul, ignoră acest mesaj.",
    ].join("\n"),
    html: shell(
      "Confirmare adresă de email",
      `<p>Salut, <strong style="color:#e6efe9">${escapeHtml(displayName)}</strong>!</p>
       <p>Mai e un singur pas: confirmă-ți adresa de email ca să-ți activăm contul.</p>
       ${button(link, "CONFIRMĂ EMAILUL")}
       <p style="font-size:12px;color:#8fb0ac">Sau deschide linkul: <br/><a href="${link}" style="color:${GOLD};word-break:break-all">${link}</a></p>
       <p style="font-size:12px;color:#8fb0ac">Linkul expiră în 24 de ore și e valabil o singură dată.</p>`
    ),
  };
}

export function passwordResetEmail(displayName: string, token: string) {
  const link = `${appBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    subject: "Resetare parolă — ST0NE QUIZ",
    text: [
      `Salut, ${displayName}!`,
      "",
      "Am primit o cerere de resetare a parolei. Alege o parolă nouă aici:",
      link,
      "",
      "Linkul e valabil o oră. Dacă nu ai cerut resetarea, ignoră mesajul — parola rămâne neschimbată.",
    ].join("\n"),
    html: shell(
      "Resetare parolă",
      `<p>Salut, <strong style="color:#e6efe9">${escapeHtml(displayName)}</strong>!</p>
       <p>Am primit o cerere de resetare a parolei pentru contul tău.</p>
       ${button(link, "ALEGE O PAROLĂ NOUĂ")}
       <p style="font-size:12px;color:#8fb0ac">Sau deschide linkul: <br/><a href="${link}" style="color:${GOLD};word-break:break-all">${link}</a></p>
       <p style="font-size:12px;color:#8fb0ac">Linkul expiră într-o oră. Dacă nu ai cerut resetarea, parola rămâne neschimbată.</p>`
    ),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
