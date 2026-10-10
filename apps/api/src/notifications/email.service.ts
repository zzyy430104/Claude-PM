import { Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  /** 日历邀请（.ics），邮件客户端会显示“接受 / 拒绝” */
  icalEvent?: { method: 'REQUEST' | 'CANCEL'; filename?: string; content: string };
}

/**
 * 邮件发送：配置 SMTP_URL（如 smtp://user:pass@host:587）后启用；未配置时不发送。
 * MAIL_TRANSPORT=memory 用于测试，邮件保存在 EmailService.outbox。
 */
@Injectable()
export class EmailService {
  static readonly outbox: Mail[] = [];
  private readonly logger = new Logger(EmailService.name);
  private transport: Transporter | null | undefined;

  get enabled() {
    return process.env.MAIL_TRANSPORT === 'memory' || !!process.env.SMTP_URL;
  }

  private getTransport(): Transporter | null {
    if (this.transport !== undefined) return this.transport;
    this.transport = process.env.SMTP_URL ? createTransport(process.env.SMTP_URL) : null;
    return this.transport;
  }

  /** 发送失败只记录日志，不影响业务操作 */
  async send(mail: Mail): Promise<void> {
    try {
      if (process.env.MAIL_TRANSPORT === 'memory') {
        EmailService.outbox.push(mail);
        return;
      }
      const t = this.getTransport();
      if (!t) return;
      await t.sendMail({ from: process.env.MAIL_FROM ?? 'Claude-PM <no-reply@localhost>', ...mail });
    } catch (e) {
      this.logger.warn(`Failed to send mail to ${mail.to}: ${(e as Error).message}`);
    }
  }
}
