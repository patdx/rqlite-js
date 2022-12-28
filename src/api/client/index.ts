/**
 * Base API client for RQLite which abstracts the HTTP calls
 * @module api/client
 */
import { HttpRequest, HttpRequestOptions } from '../../http-request';
import {
  HTTP_METHOD_GET,
  HTTP_METHOD_POST,
} from '../../http-request/http-methods';
import {
  normalizeManySqlQueries,
  SqlInputMany,
} from '../../utils/sql-template-tag';

type QueryOptions = {
  /** The consistency level */
  level?: string;
  /** Pretty print the response body */
  pretty?: boolean;
  /** Provide query timings */
  timings?: boolean;
  /** Treat all commands in the request as a single transaction for RQLite v5 and higher */
  atomic?: boolean;
  /** Treat all commands in the request as a single transaction for RQLite v4 and lower */
  transaction?: boolean;
};

/**
 * Create the base HTTP query options from RQLite API options
 */
export function createQuery(options?: QueryOptions): QueryOptions {
  const { level, pretty, timings, atomic, transaction } = options ?? {};

  // Remove all undefined values
  const query = { level, pretty, timings, atomic, transaction };
  return Object.entries(query).reduce<Record<string, any>>((acc, entry) => {
    const [key, val] = entry;
    // Only take defined values
    if (typeof val !== 'undefined') {
      acc[key] = val;
    }
    return acc;
  }, {});
}

// I don't think arrays are possible or common in sqlite but they may be used in postgres, for example.
type PrimativeType =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<PrimativeType>;

export type SqlQueryArrayFormat = [string, ...PrimativeType[]];
export type SqlQueryObjectFormat = [string, Record<string, PrimativeType>];

export type SqlQuery = string | SqlQueryArrayFormat | SqlQueryObjectFormat;

/**
 * Base API client for RQLite which abstracts the HTTP calls
 * from the user
 */
export class ApiClient {
  _httpRequest: HttpRequest;

  constructor(hosts: string[] | string, options?: HttpRequestOptions) {
    this._httpRequest = new HttpRequest(hosts, options);
  }

  /**
   * Perform a RQLite data API get request
   * @param {String} path The path for the request i.e. /db/query
   * @param {String} sql The SQL query
   * @param {HttpRequestOptions} [options={}] RQLite API options
   */
  async get(
    path: string,
    sql: string,
    options?: HttpRequestOptions & QueryOptions
  ) {
    const useLeader = options?.useLeader;
    if (!path) {
      throw new Error('The path argument is required');
    }
    const headers = options?.headers;
    return this._httpRequest.get({
      useLeader,
      uri: path,
      httpMethod: HTTP_METHOD_GET,
      // TODO: right now the latest headers object "wins"
      // make sure it both headers objects merge instead
      ...(headers ? { headers } : {}),
      query: { ...createQuery(options), q: sql },
    });
  }

  /**
   * Perform a RQLite data API post request
   * @param {String} path The path for the request i.e. /db/query
   * @param {String} sql The SQL query
   * @param {HttpRequestOptions} [options={}]
   */
  async post(
    path: string,
    sql: SqlInputMany,
    /** RQLite API options */
    options?: HttpRequestOptions & QueryOptions
  ) {
    const queries = normalizeManySqlQueries(sql, {
      dialect: options?.dialect ?? this._httpRequest.options.dialect,
    });
    const useLeader = options?.useLeader;
    if (!path) {
      throw new Error('The path argument is required');
    }
    const headers = options?.headers;
    return this._httpRequest.post({
      useLeader,
      uri: path,
      httpMethod: HTTP_METHOD_POST,
      query: createQuery(options),
      ...(headers ? { headers } : {}),
      body: queries,
    });
  }
}
