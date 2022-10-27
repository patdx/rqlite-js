/**
 * Data api client to perform RQLite data operations such
 * as query and execute
 * @module api/data
 */
import { HttpRequestOptions } from '../../http-request';
import { ApiClient, SqlQuery } from '../client';
import { DataResults } from '../results';
import { RawDataResults } from '../results/data-results';

/**
 * The RQLite query api path
 */
export const PATH_QUERY = '/db/query';

/**
 * The RQLite execute api path
 */
export const PATH_EXECUTE = '/db/execute';

/**
 * Read query consistency level none which means
 * any node can respond
 */
export const CONSISTENCY_LEVEL_NONE = 'none';

/**
 * Read query consistency strong which must come from
 * the master node
 */
export const CONSISTENCY_LEVEL_STRONG = 'strong';

/**
 * Read query consistency weak which must come from
 * the master node
 */
export const CONSISTENCY_LEVEL_WEAK = 'weak';

type DataRequestBaseOptions = {
  /**
   * If true return the raw http response from
   * RQLite response
   */
  raw?: boolean;
};

type QueryRequestBaseOptions = {
  /**
   * The api consistency level
   */
  level?: string;
};

type QueryRequestOptions = HttpRequestOptions &
  DataRequestBaseOptions &
  QueryRequestBaseOptions;

type ExecuteRequestOptions = HttpRequestOptions & DataRequestBaseOptions;

/**
 * Send an RQLite query API request to the RQLite server
 */
function handleResponse(
  response: {
    body: RawDataResults;
  },
  options?: DataRequestBaseOptions
): DataResults {
  const { body } = response;
  if (options?.raw) {
    // TODO: lets type the raw version later
    return response as any;
  }
  return new DataResults(body);
}

/**
 * Data api client to perform RQLite queries
 */
export class DataApiClient extends ApiClient {
  /**
   * Send an RQLite query API request to the RQLite server
   * @param {String} sql The SQL string to excute on the server
   * @param {QueryRequestOptions} [options={}] RQLite api options
   */
  async query(
    sql: SqlQuery | SqlQuery[],
    options?: QueryRequestOptions
  ): Promise<DataResults> {
    const level = options?.level;
    let useLeader = options?.useLeader;
    // Weak and strong consistency will be redirect to the master anyway
    // so skip the redirect HTTP response and got right to the master
    if (level !== CONSISTENCY_LEVEL_NONE) {
      useLeader = true;
    }
    let response;
    if (Array.isArray(sql)) {
      response = await super.post(PATH_QUERY, sql, { ...options, useLeader });
    } else {
      response = await super.get(PATH_QUERY, sql, { ...options, useLeader });
    }
    // If round robin is true try and balance selects across hosts when
    // the master node is not queried directly
    if (!useLeader) {
      // eslint-disable-next-line no-underscore-dangle
      this._httpRequest.setNextActiveHostIndex();
    }

    return handleResponse(response as any, options);
  }

  /**
   * Send an RQLite execute API request to the RQLite server
   * @param {String} sql The SQL string to excute on the server
   * @param {ExecuteRequestOptions} [options={}] RQLite execute api options
   */
  async execute(
    sql: SqlQuery | SqlQuery[],
    options?: ExecuteRequestOptions
  ): Promise<DataResults> {
    const response = await super.post(PATH_EXECUTE, sql, options);
    return handleResponse(response as any, options);
  }
}
