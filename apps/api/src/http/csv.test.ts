import { describe, expect, it } from '@jest/globals';

import { CsvFormatError, parseCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('maps header names to lower-cased keys', () => {
    const result = parseCsv('Name,E-MAIL\nAcme,ops@acme.test\n');

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.values).toEqual({ name: 'Acme', 'e-mail': 'ops@acme.test' });
    expect(result.errors).toEqual([]);
  });

  it('handles quoted commas, escaped quotes and embedded newlines', () => {
    const csv = 'name,notes\r\n"Northwind, Inc.","They said ""ship it""\r\non Friday"\r\n';
    const result = parseCsv(csv);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.values.name).toBe('Northwind, Inc.');
    expect(result.records[0]?.values.notes).toBe('They said "ship it"\r\non Friday');
    // The record starts on line 2 even though the quoted field spans two lines.
    expect(result.records[0]?.line).toBe(2);
  });

  it('strips a UTF-8 BOM from the first header', () => {
    const result = parseCsv('\ufeffname\nAcme\n');
    expect(result.headers).toEqual(['name']);
    expect(result.records[0]?.values.name).toBe('Acme');
  });

  it('skips fully blank rows but reports mismatched column counts', () => {
    const result = parseCsv('name,email\n\nAcme,ops@acme.test,extra\n');

    expect(result.records).toHaveLength(0);
    expect(result.errors).toEqual([{ line: 3, message: 'Expected 2 columns but found 3.' }]);
  });

  it('rejects a duplicate or empty header', () => {
    expect(() => parseCsv('name,name\nA,B\n')).toThrow(CsvFormatError);
    expect(() => parseCsv('name,\nA,B\n')).toThrow(/empty column/);
  });

  it('rejects an unclosed quoted field', () => {
    expect(() => parseCsv('name\n"Acme\n')).toThrow(/never closed/);
  });

  it('rejects an empty file', () => {
    expect(() => parseCsv('')).toThrow(/empty/);
  });
});

describe('toCsv', () => {
  it('quotes only fields that need it and rounds-trips', () => {
    const csv = toCsv(
      ['name', 'notes'],
      [
        ['Acme', 'plain'],
        ['Northwind, Inc.', 'multi\r\nline "quoted"'],
        ['Empty', null],
      ],
    );

    expect(csv.startsWith('name,notes\r\n')).toBe(true);
    expect(csv).toContain('"Northwind, Inc.",');

    const roundTripped = parseCsv(csv);
    expect(roundTripped.records).toHaveLength(3);
    expect(roundTripped.records[1]?.values.notes).toBe('multi\r\nline "quoted"');
    expect(roundTripped.records[2]?.values.notes).toBe('');
  });
});
