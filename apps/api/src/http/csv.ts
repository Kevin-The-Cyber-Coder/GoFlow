/**
 * Minimal RFC 4180 CSV reader/writer.
 *
 * The API only exchanges small client lists, so a focused implementation beats
 * a dependency: it handles quoted fields, escaped quotes, embedded newlines and
 * CRLF, and it reports the physical line each row started on so import errors
 * can point at the user's file instead of at an array index.
 */

export interface CsvRecord {
  /** 1-based physical line where the record starts. */
  readonly line: number;
  readonly values: Record<string, string>;
}

export interface CsvParseResult {
  readonly headers: string[];
  readonly records: CsvRecord[];
  readonly errors: Array<{ line: number; message: string }>;
}

/** Thrown for structural problems that make the whole file unusable. */
export class CsvFormatError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = 'CsvFormatError';
  }
}

function splitRecords(text: string): Array<{ line: number; fields: string[] }> {
  const rows: Array<{ line: number; fields: string[] }> = [];
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';

    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === '\n') {
          line += 1;
        }
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
      continue;
    }

    if (char === ',') {
      fields.push(field);
      field = '';
      continue;
    }

    if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') {
        index += 1;
      }
      fields.push(field);
      rows.push({ line: recordLine, fields });
      fields = [];
      field = '';
      line += 1;
      recordLine = line;
      continue;
    }

    field += char;
  }

  if (quoted) {
    throw new CsvFormatError('A quoted field is never closed.', recordLine);
  }

  if (field.length > 0 || fields.length > 0) {
    fields.push(field);
    rows.push({ line: recordLine, fields });
  }

  return rows;
}

/**
 * Parses CSV text into header-keyed records. Header names are trimmed and
 * lower-cased so `E-mail`, `e-mail` and `E-MAIL` all match. Fully blank rows are
 * ignored; rows whose field count does not match the header are reported as
 * errors but do not abort the rest of the parse.
 */
export function parseCsv(text: string): CsvParseResult {
  const rows = splitRecords(text);
  if (rows.length === 0) {
    throw new CsvFormatError('The file is empty.', 1);
  }

  const headerRow = rows[0];
  if (headerRow === undefined) {
    throw new CsvFormatError('The file is empty.', 1);
  }

  const headers = headerRow.fields.map((header) => header.trim().toLowerCase());
  if (headers.length === 1 && headers[0] === '') {
    throw new CsvFormatError('The header row is empty.', headerRow.line);
  }
  if (headers.some((header) => header.length === 0)) {
    throw new CsvFormatError('The header row contains an empty column name.', headerRow.line);
  }
  if (new Set(headers).size !== headers.length) {
    throw new CsvFormatError('The header row contains duplicate column names.', headerRow.line);
  }

  const records: CsvRecord[] = [];
  const errors: Array<{ line: number; message: string }> = [];

  for (const row of rows.slice(1)) {
    if (row.fields.every((field) => field.trim().length === 0)) {
      continue;
    }
    if (row.fields.length !== headers.length) {
      errors.push({
        line: row.line,
        message: `Expected ${headers.length} columns but found ${row.fields.length}.`,
      });
      continue;
    }
    const values: Record<string, string> = {};
    headers.forEach((header, index) => {
      values[header] = row.fields[index]?.trim() ?? '';
    });
    records.push({ line: row.line, values });
  }

  return { headers, records, errors };
}

/**
 * Serialises rows to CSV. A field is quoted only when it must be (comma,
 * quote, CR or LF), and quotes are doubled as RFC 4180 requires. Output uses
 * CRLF line endings so Excel and Google Sheets agree on row boundaries.
 */
export function toCsv(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | null | undefined>>,
): string {
  const escape = (value: string | null | undefined): string => {
    const text = value ?? '';
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };

  const lines = [headers.map(escape).join(',')];
  for (const row of rows) {
    lines.push(row.map(escape).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
