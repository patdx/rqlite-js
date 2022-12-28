/* eslint-disable no-else-return */
// import type { Sql } from 'sql-template-tag';
import type {
  SqlQuery,
  SqlQueryArrayFormat,
  SqlQueryObjectFormat,
} from '../api/client';

interface SqlTemplateTag {
  sql: string;
  values?: any[];
}

export const isSqlTemplateTag = (obj?: unknown): obj is SqlTemplateTag => {
  if (obj == null) return false;

  if (typeof obj === 'object') {
    const { sql } = obj as SqlTemplateTag;
    if (typeof sql === 'string') {
      return true;
    }
  }

  return false;
};

export const isSqlQueryArrayOrObjectFormat = (
  obj?: unknown
): obj is SqlQueryArrayFormat | SqlQueryObjectFormat => {
  if (!Array.isArray(obj)) return false;

  if (typeof obj[0] !== 'string') return false; // first parameter must be string query

  return true;
};

export type SqlInputOne = SqlQuery | SqlTemplateTag;

export const normalizeOneSqlQuery = (
  obj: SqlInputOne
): SqlQueryArrayFormat | SqlQueryObjectFormat => {
  // console.log(`noralizeOneSqlQuery(${JSON.stringify(obj)})`);
  if (Array.isArray(obj)) {
    if (!isSqlQueryArrayOrObjectFormat(obj)) {
      throw new Error(
        `This object cannot be parsed as one SQL query. Could it be two queries?: ${JSON.stringify(
          obj
        )}`
      );
    }
    // an array is not necessarily bad, but
  }

  if (typeof obj === 'string') {
    return [obj];
  } else if (isSqlTemplateTag(obj)) {
    return [obj.sql, ...(obj.values ?? [])];
  } else {
    return obj as any;
  }
};

export type SqlInputMany =
  | SqlQuery
  | SqlTemplateTag
  | (SqlQuery | SqlTemplateTag)[];

const canBeParsedAsOneSqlQuery = (el?: unknown): boolean =>
  typeof el === 'string' ||
  isSqlTemplateTag(el) ||
  isSqlQueryArrayOrObjectFormat(el);

export const normalizeManySqlQueries = (
  obj: SqlInputMany
): (SqlQueryArrayFormat | SqlQueryObjectFormat)[] => {
  // console.log(`normalizeManySqlQueries(${JSON.stringify(obj)})`);
  if (Array.isArray(obj)) {
    if ((obj as any[]).every((el) => canBeParsedAsOneSqlQuery(el))) {
      // in functions where multiple queries are possible, to avoid ambiguity
      // we will always prefer the array form to avoid ambiguity about variables
      // vs plain queries without variables

      // (SqlQuery | Sql)[]
      return (obj as SqlInputOne[]).map((el) => normalizeOneSqlQuery(el));
    } else {
      // however, if the input cannot possible be parsed as multiple queries
      // we will automatically add the array wrapping out of kindness
      // I think in principal we should try to not encourage this behavior.

      const normalized = normalizeOneSqlQuery(obj as SqlInputOne);

      console.warn(
        `Wrap this query in an extra array to avoid ambiguity: ${JSON.stringify(
          [normalized]
        )}. Or, use the template tag form: sql\`${normalized[0]}\``
      );

      return [normalized];
    }
    // x
  } else {
    // SqlQuery | Sql
    return [normalizeOneSqlQuery(obj)];
  }
};
