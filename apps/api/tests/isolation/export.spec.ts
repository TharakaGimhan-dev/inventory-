// export.spec.ts covers the file formats and the import parser.
//
// CSV escaping is the part worth testing hardest: it is the format every
// customer opens in Excel, and getting it wrong either corrupts their data or
// hands them a spreadsheet that runs what an attacker typed into an asset name.
import { UTF8_BOM, toCsv } from '../../src/modules/export/service/csv';
import { ImportService } from '../../src/modules/export/service/import.service';

const parser = new ImportService(
  null as any, null as any, null as any, null as any, null as any,
);

describe('CSV writing', () => {
  it('quotes a field containing a comma', () => {
    const csv = toCsv(['a'], [['Chair, broken']]);
    expect(csv).toBe('a\r\n"Chair, broken"');
  });

  it('doubles inner quotes', () => {
    const csv = toCsv(['a'], [['He said "no"']]);
    expect(csv).toBe('a\r\n"He said ""no"""');
  });

  it('quotes a field containing a newline', () => {
    const csv = toCsv(['a'], [['line one\nline two']]);
    expect(csv).toBe('a\r\n"line one\nline two"');
  });

  it('neutralises a formula', () => {
    // Without the prefix, Excel executes this when the file is opened - and
    // the value came from whatever a user typed into an asset name.
    for (const dangerous of ['=cmd|calc', '+1+1', '-1+1', '@SUM(A1)']) {
      const csv = toCsv(['a'], [[dangerous]]);
      expect(csv).toContain(`'${dangerous}`);
    }
  });

  it('leaves an ordinary value alone', () => {
    expect(toCsv(['a'], [['Dell Latitude 5420']])).toBe('a\r\nDell Latitude 5420');
  });

  it('writes empty for null and undefined', () => {
    expect(toCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\r\n,');
  });

  it('uses CRLF, which is what Excel expects', () => {
    expect(toCsv(['a'], [['1'], ['2']])).toBe('a\r\n1\r\n2');
  });

  it('exports a BOM, so Excel reads UTF-8', () => {
    // Without it, a Sinhala asset name opens as mojibake and the customer
    // believes we lost their data.
    expect(UTF8_BOM).toBe('﻿');
  });
});

describe('import parsing', () => {
  const csv = (body: string) => parser.parse(body);

  it('reads a simple file', () => {
    const { rows, problems } = csv('Name,Location\nDesk,Room 1\nChair,Room 2');

    expect(problems).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'Desk', location: 'Room 1', line: 2 });
  });

  it('accepts the column names people actually use', () => {
    // "Qty" and "Item" are what is in the spreadsheet they already have.
    const { rows, problems } = csv('Item,Qty,Cost\nPaper,40,1200');

    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({ name: 'Paper', quantity: 40, purchasePrice: '1200' });
  });

  it('refuses a file with no name column, and says which columns work', () => {
    const { problems } = csv('Thing,Place\nDesk,Room 1');

    expect(problems[0].message).toContain('needs a "Name" column');
    expect(problems[0].message).toContain('serial number');
  });

  it('reports every problem at once, with line numbers', () => {
    // A customer fixing a file wants the whole list, not one error at a time.
    const { problems } = csv(
      'Name,Status,Price,Qty\n' +
        'Good,in_store,100,1\n' +
        ',in_store,100,1\n' +
        'Bad,teleported,abc,0\n',
    );

    expect(problems).toHaveLength(4);
    expect(problems.map((p) => p.line)).toEqual([3, 4, 4, 4]);
    expect(problems.find((p) => p.column === 'status')!.message).toContain('teleported');
  });

  it('normalises a status people type by hand', () => {
    const { rows, problems } = csv('Name,Status\nDesk,In Use');

    expect(problems).toEqual([]);
    expect(rows[0].status).toBe('in_use');
  });

  it('accepts an amount with thousands separators', () => {
    // "12,500.00" is how the number appears in their existing sheet, and it
    // arrives quoted because of the comma.
    const { rows, problems } = csv('Name,Price\nBoard,"12,500.00"');

    expect(problems).toEqual([]);
    expect(rows[0].purchasePrice).toBe('12500.00');
  });

  it('handles a quoted field containing a newline', () => {
    const { rows, problems } = csv('Name,Serial\n"Desk\nwith note",SN1');

    expect(problems).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Desk\nwith note');
  });

  it('skips blank lines rather than failing on them', () => {
    // A file exported from Excel usually ends with one.
    const { rows, problems } = csv('Name\nDesk\n\nChair\n');

    expect(problems).toEqual([]);
    expect(rows).toHaveLength(2);
  });

  it('survives a BOM on the header', () => {
    const { rows, problems } = csv('﻿Name\nDesk');

    expect(problems).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it('rejects an empty file with a readable message', () => {
    expect(csv('').problems[0].message).toBe('The file is empty');
  });
});
