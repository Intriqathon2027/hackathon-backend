import { Injectable } from "@nestjs/common";
import { Resend } from "resend";
import {
  EmailTemplate,
  MailingSettings,
} from "../configuration/entities/mail_settings";
import { loadTemplateFile, renderTemplate } from "./template-builder.util";
import { PrismaService } from "../prisma/prisma.service";
import { HackathonConfigKey } from "@prisma/client";

@Injectable()
export class MailerService {
  private readonly resend: Resend;
  private readonly allowedEmails: string[];

  constructor(private readonly prisma: PrismaService) {
    this.resend = new Resend(process.env.RESEND_API_KEY);
    const allowed = process.env.ALLOWED_EMAILS;
    this.allowedEmails = allowed
      ? allowed.split(",").map((email) => email.trim())
      : [];
  }

  async sendInviteEmail(to: string, firstLoginUrl: string) {
    const variables = {
      firstLoginUrl,
    };
    const config = await this.getMailingConfig();

    return await this.sendTemplateEmail(
      to,
      "invite-first-login",
      config.firstConnectionTemplate,
      variables,
    );
  }

  async sendPasswordResetEmail(to: string, resetPasswordUrl: string) {
    const variables = {
      resetPasswordUrl,
    };
    const config = await this.getMailingConfig();

    return await this.sendTemplateEmail(
      to,
      "password-reset",
      config.passwordResetTemplate,
      variables,
    );
  }

  async sendTemplateEmail(
    to: string,
    templateName: string,
    templateData: EmailTemplate,
    variables: Record<string, any>,
  ) {
    if (!this.isEmailAllowed(to)) {
      console.warn(`Email to ${to} blocked by allowed emails configuration.`);
      return;
    }

    try {
      // load template file
      const file = loadTemplateFile(templateName);

      // merge template with data and variables
      const html = renderTemplate(file, templateData, variables);

      // send via Resend
      return await this.resend.emails.send({
        from: process.env.FROM_EMAIL!,
        to,
        subject: templateData.object,
        html,
      });
    } catch (error) {
      console.error("Error sending email:", error);
      throw error;
    }
  }

  private isEmailAllowed(email: string): boolean {
    if (this.allowedEmails.length > 0 && this.allowedEmails[0] === "*") {
      return true; // All emails are allowed
    }
    return this.allowedEmails.includes(email);
  }

  private async getMailingConfig(): Promise<MailingSettings> {
    const config = await this.prisma.hackathonConfig
      .findUnique({
        where: { key: HackathonConfigKey.MAILING },
      })
      .then((conf) => conf?.value as unknown as MailingSettings);

    if (!config) {
      return this.getDefaultMailingSettings();
    }
    return config;
  }

  private getDefaultMailingSettings(): MailingSettings {
    return {
      firstConnectionTemplate: {
        object: "Welcome to {{hackathonName}}",
        title: "Welcome!",
        introParagraph: "You have been invited to join {{hackathonName}}.",
        actionPrompt:
          "Please click the button below to log in for the first time:",
        buttonText: "Login",
        closingNote:
          "If you have any questions, please contact the organizers.",
        signatureSalutation: "Best regards,",
        signatureName: "{{hackathonName}} Team",
      },
      passwordResetTemplate: {
        object: "Password Reset Request for {{hackathonName}}",
        title: "Password Reset Request",
        introParagraph: "We received a request to reset your password.",
        actionPrompt: "Click the button below to reset your password:",
        buttonText: "Reset My Password",
        closingNote:
          "If you did not request a password reset, please ignore this email or contact support if you have questions.",
        signatureSalutation: "Best regards,",
        signatureName: "{{hackathonName}} Team",
      },
    };
  }
}
