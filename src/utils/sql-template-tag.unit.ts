import sql from 'sql-template-tag';
import { describe, expect, test, vi } from 'vitest';
import {
  isSqlTemplateTag,
  normalizeManySqlQueries,
  normalizeOneSqlQuery,
} from './sql-template-tag';

describe('sql-template-tag', () => {
  test('can identify sql template tag', () => {
    expect(isSqlTemplateTag(null)).toBe(false);
    expect(isSqlTemplateTag(undefined)).toBe(false);
    expect(isSqlTemplateTag('SELECT * from table')).toBe(false);
    expect(isSqlTemplateTag(sql`SELECT * from table`)).toBe(true);
    expect(
      isSqlTemplateTag([sql`SELECT * from table`, sql`SELECT * from table`])
    ).toBe(false);
    expect(isSqlTemplateTag({ someText: 'hello world' })).toBe(false);
    expect(isSqlTemplateTag({ sql: 'hi there' })).toBe(true); // effectively we are checking for a string property named "sql"
  });

  test('can normalize a single sql query', () => {
    expect(normalizeOneSqlQuery('SELECT * from users')).toEqual([
      'SELECT * from users',
    ]);

    // two queries are not valid here
    expect(() =>
      normalizeOneSqlQuery([
        ['SELECT * FROM users WHERE id = ? AND deleted = ?', 1, false],
        ['SELECT * FROM users WHERE id = ? AND deleted = ?', 1, false],
      ] as any)
    ).toThrowError();

    // we do not have a good way to tell this case apart, so it should not throw
    // we will interpret it as one query with a bound variable of type array
    expect(() =>
      normalizeOneSqlQuery([
        'SELECT * FROM users WHERE id = ? AND deleted = ?',
        ['SELECT * FROM users WHERE id = ? AND deleted = ?', 1, false],
      ])
    ).not.toThrow();

    // we do not have a good way to tell this case apart, so it should not throw
    // we will interpret it as one query with a bound variable of type array
    expect(() =>
      normalizeOneSqlQuery([
        'SELECT * FROM users WHERE id = ? AND deleted = ?',
        'SELECT * FROM users WHERE id = ? AND deleted = ?',
      ])
    ).not.toThrow();

    expect(() =>
      normalizeOneSqlQuery([
        sql`SELECT * FROM users WHERE id = ${1}`,
        sql`SELECT * FROM users WHERE id = ${1}`,
      ] as any)
    ).toThrowError();

    expect(
      normalizeOneSqlQuery(sql`SELECT * FROM users WHERE id = ${1}`)
    ).toEqual(['SELECT * FROM users WHERE id = ?', 1]);

    expect(
      normalizeOneSqlQuery([
        'SELECT * FROM users WHERE id = ? AND deleted = ?',
        1,
        false,
      ])
    ).toEqual(['SELECT * FROM users WHERE id = ? AND deleted = ?', 1, false]);

    expect(
      normalizeOneSqlQuery([
        'SELECT * FROM users WHERE id = $id AND deleted = $deleted',
        { id: 1, deleted: false },
      ])
    ).toEqual([
      'SELECT * FROM users WHERE id = $id AND deleted = $deleted',
      { id: 1, deleted: false },
    ]);
  });

  test('can normalize multiple sql query', () => {
    expect(normalizeManySqlQueries('SELECT * from users')).toEqual([
      ['SELECT * from users'],
    ]);

    // two queries are not valid here
    expect(
      normalizeManySqlQueries([
        ['SELECT * FROM users WHERE id = ? AND deleted = ?', 1, false],
        ['SELECT * FROM users WHERE id = ? AND deleted = ?', 1, false],
      ])
    ).toEqual([
      ['SELECT * FROM users WHERE id = ? AND deleted = ?', 1, false],
      ['SELECT * FROM users WHERE id = ? AND deleted = ?', 1, false],
    ]);

    // we do not have a good way to tell this case apart, so it should not throw
    expect(
      normalizeManySqlQueries([
        'SELECT * FROM users WHERE id = ? AND deleted = ?',
        ['SELECT * FROM users WHERE id = ? AND deleted = ?', 1, false],
      ])
    ).toEqual([
      ['SELECT * FROM users WHERE id = ? AND deleted = ?'],
      ['SELECT * FROM users WHERE id = ? AND deleted = ?', 1, false],
    ]);

    // same here
    expect(
      normalizeManySqlQueries([
        'SELECT * FROM users WHERE id = ? AND deleted = ?',
        'SELECT * FROM users WHERE id = ? AND deleted = ?',
      ])
    ).toEqual([
      ['SELECT * FROM users WHERE id = ? AND deleted = ?'],
      ['SELECT * FROM users WHERE id = ? AND deleted = ?'],
    ]);

    expect(
      normalizeManySqlQueries([
        sql`SELECT * FROM users WHERE id = ${1}`,
        sql`SELECT * FROM users WHERE id = ${1}`,
      ])
    ).toEqual([
      ['SELECT * FROM users WHERE id = ?', 1],
      ['SELECT * FROM users WHERE id = ?', 1],
    ]);

    expect(
      normalizeManySqlQueries(sql`SELECT * FROM users WHERE id = ${1}`)
    ).toEqual([['SELECT * FROM users WHERE id = ?', 1]]);
  });

  test('extremely ambiguous input formats give an extra warning', () => {
    // We have to be careful because some formats are super ambiguous. For
    // example when all elements of the array are string:
    //
    // normalizeManySqlQueries([
    //   'SELECT * FROM users WHERE id = ?',
    //   '1',
    // ]);
    //
    // There is no way for the system to know if this is one or two
    // queries, without analyzing the query contents like the '1'.
    //
    // For a very similar input:
    //
    // normalizeManySqlQueries([
    //   'SELECT * FROM users WHERE id = ?',
    //   1,
    // ]);
    //
    // We can detect that the input is one query and automatically
    // normalize it because the `1` is type number. A similar problem
    // could appear during runtime if one of the bound variables is
    // often null (allowing correct parsing) but sometimes string,
    // breaking the parsing. Therefore, we need to always warn when
    // this automatically normalization is applied.

    const spy = vi.spyOn(console, 'warn');

    expect(
      normalizeManySqlQueries([
        'SELECT * FROM users WHERE id = ? AND deleted = ?',
        1,
        false,
      ])
    ).toEqual([['SELECT * FROM users WHERE id = ? AND deleted = ?', 1, false]]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();

    expect(
      normalizeManySqlQueries([
        'SELECT * FROM users WHERE id = $id AND deleted = $deleted',
        { id: 1, deleted: false },
      ])
    ).toEqual([
      [
        'SELECT * FROM users WHERE id = $id AND deleted = $deleted',
        { id: 1, deleted: false },
      ],
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
