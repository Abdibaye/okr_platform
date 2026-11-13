export const EMPLOYEE_CSV_HEADERS = ["email", "name", "role", "manager_email", "team_name", "job_title", "status"] as const;
export type EmployeeCsvHeader = (typeof EMPLOYEE_CSV_HEADERS)[number];

export class CsvParseError extends Error {
  constructor(message: string, public readonly line: number) {
    super(message);
  }
}

export interface CsvRecord {
  /** 1-based physical line where the record starts (header is line 1). */
  line: number;
  fields: string[];
}

/**
 * RFC 4180 parser: comma separated, double-quoted fields may contain commas, CRLF/LF line breaks
 * and escaped quotes (""). Accepts LF or CRLF record separators and an optional trailing newline.
 */
export function parseCsv(input: string): CsvRecord[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let recordStarted = false;
  let line = 1;
  let recordLine = 1;
  let index = 0;

  const endRecord = () => {
    fields.push(field);
    records.push({ line: recordLine, fields });
    fields = [];
    field = "";
    recordStarted = false;
  };

  while (index < text.length) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        const next = text[index];
        if (next !== undefined && next !== "," && next !== "\r" && next !== "\n") {
          throw new CsvParseError("Unexpected character after closing quote", line);
        }
        continue;
      }
      if (character === "\n") line += 1;
      field += character;
      index += 1;
      continue;
    }

    if (character === '"') {
      if (field.length) throw new CsvParseError("Quote found inside an unquoted field", line);
      inQuotes = true;
      recordStarted = true;
      index += 1;
    } else if (character === ",") {
      fields.push(field);
      field = "";
      recordStarted = true;
      index += 1;
    } else if (character === "\r" || character === "\n") {
      endRecord();
      index += character === "\r" && text[index + 1] === "\n" ? 2 : 1;
      line += 1;
      recordLine = line;
    } else {
      field += character;
      recordStarted = true;
      index += 1;
    }
  }

  if (inQuotes) throw new CsvParseError("Unterminated quoted field", recordLine);
  if (recordStarted || field.length || fields.length) endRecord();
  return records;
}

export function isBlankRecord(record: CsvRecord) {
  return record.fields.every((value) => value.trim() === "");
}

/** Validates the header row; returns column positions or a list of problems. */
export function validateEmployeeHeaders(header: string[]):
  | { ok: true; columns: Record<EmployeeCsvHeader, number> }
  | { ok: false; errors: string[] } {
  const normalized = header.map((value) => value.trim().toLowerCase());
  const errors: string[] = [];
  const columns = {} as Record<EmployeeCsvHeader, number>;
  for (const name of EMPLOYEE_CSV_HEADERS) {
    const position = normalized.indexOf(name);
    if (position === -1) errors.push(`Missing column "${name}"`);
    else columns[name] = position;
  }
  normalized.forEach((name, position) => {
    if (!(EMPLOYEE_CSV_HEADERS as readonly string[]).includes(name)) errors.push(`Unknown column "${header[position]}"`);
    else if (normalized.indexOf(name) !== position) errors.push(`Duplicate column "${name}"`);
  });
  return errors.length ? { ok: false, errors } : { ok: true, columns };
}
