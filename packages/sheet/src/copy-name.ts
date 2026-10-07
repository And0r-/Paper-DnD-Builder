/**
 * When a kept copy was made, as its name shows it: the date without the
 * year (unless it is not this year's) and the time to the minute, in the
 * reader's language and time zone. The screen and the PDF show the same,
 * so two copies of one day are told apart on paper as on the screen.
 */
export interface CopyWhen {
  /** "7. Oktober", "October 7"; with the year if not this year's. */
  date: string;
  /** "09:40". */
  time: string;
}

export function copyWhen(
  language: string,
  createdAt: Date,
  { timeZone, now = new Date() }: { timeZone?: string | undefined; now?: Date } = {},
): CopyWhen {
  const zone = timeZone === undefined ? {} : { timeZone };
  const year = (d: Date) => new Intl.DateTimeFormat("en", { year: "numeric", ...zone }).format(d);
  const date = new Intl.DateTimeFormat(language, {
    day: "numeric",
    month: "long",
    ...(year(createdAt) === year(now) ? {} : { year: "numeric" }),
    ...zone,
  }).format(createdAt);
  const time = new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit", ...zone }).format(
    createdAt,
  );
  return { date, time };
}

/** Whether `timeZone` is a zone the formatter knows ("Europe/Zurich"). */
export function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}
