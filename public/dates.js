const kyivDate = new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Kyiv'});

export const dateInKyiv = (now = new Date()) => kyivDate.format(now);

export function scheduleDates(now = new Date()) {
  const today = dateInKyiv(now);
  // Calendar arithmetic avoids skipping/repeating a day at DST transitions.
  const next = new Date(`${today}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return [today, next.toISOString().slice(0, 10)];
}

export function currentSlot(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(now).split(':').map(Number);
  return parts[0] * 2 + parts[1] / 30;
}

export function outageHours(slots, slot = 0) {
  return slots.reduce((sum, value, i) => sum + (value === false ? Math.max(0, Math.min(1, i + 1 - slot)) / 2 : 0), 0);
}
