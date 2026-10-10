/** 生成会议的日历邀请（RFC 5545），邮件客户端据此显示“接受 / 拒绝”并加入日历 */
export interface IcsInput {
  uid: string;
  sequence: number;
  method: 'REQUEST' | 'CANCEL';
  start: Date;
  end: Date;
  title: string;
  location: string;
  description: string;
  organizer: { name: string; email: string };
  attendees: { name: string; email: string }[];
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** 文本值转义：反斜杠、分号、逗号、换行 */
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** 每行不超过 75 个字节，超出时折行（续行以空格开头） */
function fold(line: string) {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > 74) { out.push(cur); cur = ' '; bytes = 1; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

export function buildIcs(i: IcsInput): string {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Claude-PM//Meetings//ZH', 'CALSCALE:GREGORIAN', `METHOD:${i.method}`,
    'BEGIN:VEVENT',
    `UID:${i.uid}`, `SEQUENCE:${i.sequence}`, `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(i.start)}`, `DTEND:${stamp(i.end)}`,
    `SUMMARY:${esc(i.title)}`, `LOCATION:${esc(i.location)}`, `DESCRIPTION:${esc(i.description)}`,
    `ORGANIZER;CN=${esc(i.organizer.name)}:mailto:${i.organizer.email}`,
    ...i.attendees.filter((a) => a.email).map((a) => `ATTENDEE;CN=${esc(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`),
    `STATUS:${i.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
