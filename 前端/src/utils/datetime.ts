// 平台统一时区：所有对用户展示的时间一律东八区（Asia/Shanghai）。
// 后端存储保持 ISO/UTC，只在展示层转换。

const TZ = 'Asia/Shanghai';

function format(iso: string, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, ...options }).format(date);
}

/** "2026-09-16 11:53:25"（东八区） */
export function formatDateTime(iso: string): string {
  return format(iso, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).replace('T', ' ');
}

/** "11:53:25"（东八区，仅时分秒） */
export function formatClock(value: string | Date): string {
  return format(typeof value === 'string' ? value : value.toISOString(), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
