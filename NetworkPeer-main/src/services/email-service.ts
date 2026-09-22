import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { config } from "../config.js";

export interface SendOtpEmailParams {
  to: string;
  code: string;
  clientIp?: string;
  role?: string;
}

export interface EmailSendResult {
  /** True only when a provider accepted the message for delivery. */
  success: boolean;
  messageId?: string;
  provider: "ses" | "resend" | "log";
  error?: string;
}

export class EmailService {
  private sesClient: SESv2Client | null = null;

  private formatHtml(code: string, ip?: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NetworkPeers Verification Code</title>
</head>
<body style="margin:0;padding:0;background-color:#0B0F17;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#F3F4F6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0B0F17;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background-color:#111827;border:1px solid #1F2937;border-radius:24px;padding:40px;box-shadow:0 20px 25px -5px rgba(0,0,0,0.5);">
          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <div style="background-color:#F9C933;color:#111827;display:inline-block;padding:8px 18px;border-radius:12px;font-weight:800;font-size:16px;letter-spacing:1px;text-transform:uppercase;">
                NetworkPeer
              </div>
            </td>
          </tr>
          <!-- Title -->
          <tr>
            <td align="center" style="padding-bottom:12px;">
              <h1 style="margin:0;color:#FFFFFF;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Verification Code</h1>
            </td>
          </tr>
          <!-- Subtitle -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <p style="margin:0;color:#9CA3AF;font-size:14px;line-height:1.6;">
                Use the one-time password below to complete your passwordless login to the NetworkPeers marketplace.
              </p>
            </td>
          </tr>
          <!-- Code Box -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <div style="background-color:#1F2937;border:2px solid #F9C933;border-radius:16px;padding:20px 36px;display:inline-block;">
                <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono',monospace;color:#F9C933;font-size:36px;font-weight:800;letter-spacing:10px;text-align:center;">
                  ${code}
                </span>
              </div>
            </td>
          </tr>
          <!-- Security Notice -->
          <tr>
            <td style="background-color:#182234;border:1px solid #27354A;border-radius:12px;padding:16px;margin-bottom:24px;">
              <p style="margin:0;color:#93C5FD;font-size:12px;line-height:1.5;">
                ⏱ <strong>Expires in 10 minutes.</strong><br>
                🔒 For your security, never forward or share this code. NetworkPeers administrators will never ask for your verification code.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:32px;border-top:1px solid #1F2937;">
              <p style="margin:0;color:#6B7280;font-size:11px;line-height:1.5;">
                Requested${ip ? ` from IP ${ip}` : ""} on ${new Date().toUTCString()}.<br>
                NetworkPeers Physical Field Operations & Verification Infrastructure.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  /**
   * Chooses the provider. An unimplemented or unconfigured provider resolves to
   * "log", which NP-02 makes fail closed in production rather than reporting a
   * delivery that never happened.
   */
  private resolveProvider(): "ses" | "resend" | "log" {
    if (config.EMAIL_PROVIDER === "ses") return "ses";
    if (config.EMAIL_PROVIDER === "resend") return "resend";
    if (config.EMAIL_PROVIDER === "log") return "log";
    // Historical behaviour: a Resend key implies Resend when nothing is set.
    return config.RESEND_API_KEY ? "resend" : "log";
  }

  private ses(): SESv2Client {
    this.sesClient ??= new SESv2Client({ region: config.SES_REGION || config.AWS_REGION });
    return this.sesClient;
  }

  private formatText(code: string, ip?: string): string {
    return [
      `Your NetworkPeers verification code is ${code}.`,
      "",
      "It expires in 10 minutes and may be used once.",
      "Never share this code. NetworkPeers staff will never ask you for it.",
      "",
      `Requested${ip ? ` from IP ${ip}` : ""} on ${new Date().toUTCString()}.`,
    ].join("\n");
  }

  private async sendViaSes(to: string, subject: string, html: string, text: string): Promise<EmailSendResult> {
    try {
      const result = await this.ses().send(new SendEmailCommand({
        FromEmailAddress: config.EMAIL_FROM,
        Destination: { ToAddresses: [to] },
        ...(config.SES_CONFIGURATION_SET ? { ConfigurationSetName: config.SES_CONFIGURATION_SET } : {}),
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: "UTF-8" },
            Body: {
              Html: { Data: html, Charset: "UTF-8" },
              Text: { Data: text, Charset: "UTF-8" },
            },
          },
        },
      }));
      return { success: true, messageId: result.MessageId, provider: "ses" };
    } catch (err) {
      // A sandboxed SES identity rejects unverified recipients here. The caller
      // surfaces the failure instead of pretending the code was delivered.
      const name = err instanceof Error ? err.name : "UnknownError";
      const detail = err instanceof Error ? err.message : String(err);
      return { success: false, provider: "ses", error: `${name}: ${detail}` };
    }
  }

  private async sendViaResend(to: string, subject: string, html: string): Promise<EmailSendResult> {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: config.EMAIL_FROM, to: [to], subject, html }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        return { success: false, provider: "resend", error: `Resend HTTP ${response.status}: ${errBody}` };
      }

      const data = (await response.json()) as { id?: string };
      return { success: true, messageId: data.id, provider: "resend" };
    } catch (err) {
      return { success: false, provider: "resend", error: String(err) };
    }
  }

  private sendViaLog(to: string, subject: string, code: string): EmailSendResult {
    if (config.NODE_ENV === "production") {
      // NP-02: the log provider delivers nothing. Reporting success here is what
      // made a broken production login look like a working one.
      return {
        success: false,
        provider: "log",
        error: "No email provider is configured. Set EMAIL_PROVIDER to ses or resend.",
      };
    }

    // eslint-disable-next-line no-console -- the development provider exists to print the code
    console.log(
      `\n${"=".repeat(56)}\n[EmailService:SIMULATED] ${subject}\nTo: ${to}\nCode: ${code}\n${"=".repeat(56)}\n`,
    );
    return { success: true, provider: "log", messageId: `sim_${Date.now()}` };
  }

  async sendOtpEmail(params: SendOtpEmailParams): Promise<EmailSendResult> {
    const { to, code, clientIp } = params;
    const subject = `${code} is your NetworkPeers verification code`;
    const html = this.formatHtml(code, clientIp);
    const text = this.formatText(code, clientIp);

    switch (this.resolveProvider()) {
      case "ses":
        return this.sendViaSes(to, subject, html, text);
      case "resend":
        return this.sendViaResend(to, subject, html);
      default:
        return this.sendViaLog(to, subject, code);
    }
  }
}

export const emailService = new EmailService();
