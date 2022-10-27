/**
 * Base API client for RQLite which abstracts the HTTP calls
 * @module api/client
 */
import {
  HttpRequest,
  HttpRequestOptions,
  HttpRequestOptions2,
} from '../../http-request';
import {
  HTTP_METHOD_GET,
  HTTP_METHOD_POST,
} from '../../http-request/http-methods';

type QueryOptions = {
  level?: string;
  pretty?: boolean;
  timings?: boolean;
  atomic?: boolean;
  transaction?: boolean;

  useLeader?: boolean;
};

/**
 * Create the base HTTP query options from RQLite API options
 * @param {Object} [options={}] The RQLite API options
 * @param {String} [options.level] The consistency level
 * @param {String} [options.pretty] Pretty print the response body
 * @param {String} [options.timings] Provide query timings
 * @param {String} [options.atomic] Treat all commands in the request as a single transaction
 * for RQLite v5 and higher
 * @param {String} [options.transaction] Treat all commands in the request as a single transaction
 * for RQLite v4 and lower
 * @returns {Object} The HTTP query
 */
export function createQuery(options: QueryOptions = {}) {
  const { level, pretty, timings, atomic, transaction } = options;

  // Remove all undefined values
  const query = { level, pretty, timings, atomic, transaction };
  return Object.entries(query).reduce((acc, entry) => {
    const [key, val] = entry;
    // Only take defined values
    if (typeof val !== 'undefined') {
      acc[key] = val;
    }
    return acc;
  }, {});
}

type PrimativeType = string | number | null | undefined;

export type SqlQuery =
  | string
  | [string, ...PrimativeType[]]
  | [string, Record<string, PrimativeType>];

/**
 * Base API client for RQLite which abstracts the HTTP calls
 * from the user
 */
export class ApiClient {
  _httpRequest: HttpRequest;

  constructor(hosts: string[] | string, options: HttpRequestOptions2 = {}) {
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
    const { useLeader } = options;
    if (!path) {
      throw new Error('The path argument is required');
    }
    return this._httpRequest.get({
      useLeader,
      uri: path,
      httpMethod: HTTP_METHOD_GET,
      headers: options.headers,
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
    sql: SqlQuery | SqlQuery[],
    /** RQLite API options */
    options?: HttpRequestOptions & QueryOptions
  ) {
    const { useLeader } = options;
    if (!path) {
      throw new Error('The path argument is required');
    }
    return this._httpRequest.post({
      useLeader,
      uri: path,
      httpMethod: HTTP_METHOD_POST,
      query: createQuery(options),
      headers: options.headers,
      body: Array.isArray(sql) ? sql : [sql],
    });
  }
}
