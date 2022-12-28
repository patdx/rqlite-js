/**
 * Plain HTTP client to be used when creating RQLite specific API HTTP clients
 * @module http-request
 */

import type { HTTPError, KyResponse } from 'ky';
import type { SqlDialect } from '../utils/sql-template-tag';
import { CONTENT_TYPE_APPLICATION_JSON } from './content-types';
import { ERROR_HTTP_REQUEST_MAX_REDIRECTS } from './errors';
import { HTTP_METHOD_GET, HTTP_METHOD_POST } from './http-methods';
import {
  RETRYABLE_ERROR_CODES,
  RETRYABLE_HTTP_METHODS,
  RETRYABLE_STATUS_CODES,
} from './retryable';

export type HttpRequestOptions = {
  /**
   * A object for user authentication
   */
  auth?: {
    username?: string;
    password?: string;
  };
  /**
   * The body of the HTTP request
   */
  body?: any;
  /**
   * HTTP headers to send with the request
   */
  headers?: Record<string, string>;
  /**
   * The HTTP method for the request
   * i.e. GET or POST
   */
  httpMethod?: 'GET' | 'POST';
  /**
   * An object with the query to send with the HTTP request
   */
  query?: any;
  /**
   * When true the returned value is a request object with
   * stream support instead of a request-promise result
   *
   * @deprecated use the fetchRaw and read the response.body instead
   */
  stream?: boolean;
  /**
   * Optional timeout to override default
   */
  timeout?: number;
  /**
   * The uri for the request which can be a relative path to use
   * the currently active host or a full i.e. http://localhost:4001/db/query which is used
   * literally
   */
  uri?: string;
  /**
   * When true the request will use the master host, the
   * first host in this.hosts, this is ideal for write operations to skip the redirect
   */
  useLeader?: boolean;
  /**
   * The number of retries, defaults to the number of
   * hosts times 3
   */
  retries?: number;
  /**
   * The maximum number of HTTP redirects to follow before
   * throwing an error
   */
  maxRedirects?: number;
  /**
   * The current attempt count when retrying or redirecting
   */
  attempt?: number;
  /**
   * The current attempt based on retry logic
   */
  retryAttempt?: number;
  /**
   * The current attempt based on redirect logic
   */
  redirectAttempt?: number;
  /**
   * When in a retry state the host index of the last
   * attempt which is used to get the next host index
   */
  attemptHostIndex?: number;
  /**
   * An option http agent, useful for
   * keepalive pools using plain HTTP
   */
  httpAgent?: any;
  /**
   * An option http agent, useful
   * for keepalive pools using SSL
   */
  httpsAgent?: any;

  /**
   * The exponential backoff base for retries
   */
  exponentialBackoffBase?: number;

  /**
   * send body as json or raw
   * usually we use json mode, but for backup restore, for example
   * we send it exactly
   */
  json?: boolean;

  /**
   * Whether or not the setNextActiveHostIndex() should
   * perform a round robin strategy
   */
  activeHostRoundRobin?: boolean;

  retryableErrorCodes?: Set<string> | string[];
  retryableStatusCodes?: Set<number> | number[];
  retryableHttpMethods?: Set<string> | string[];

  /**
   * By default we use dialect sqlite but when this API is being
   * used as a proxy server, for example, we may use a different
   * dialect. Most notably, postgres uses a different format for
   * expressing paramterized values. This function affects the
   * parsing of sql template tags.
   */
  dialect?: SqlDialect;
};

export type HttpRequestOptionsNormalized = Omit<
  HttpRequestOptions,
  'retryableErrorCodes' | 'retryableStatusCodes' | 'retryableHttpMethods'
> & {
  retryableErrorCodes: Set<string>;
  retryableStatusCodes: Set<number>;
  retryableHttpMethods: Set<string>;
};

/**
 * The default timeout value
 */
export const DEFAULT_TIMEOUT = 30000;

// TODO: separate into options for
// ky, general http request options and
// per-attempt options
const HTTP_REQUEST_DEFAULTS: HttpRequestOptions = {
  activeHostRoundRobin: true,
  retryableErrorCodes: RETRYABLE_ERROR_CODES,
  retryableStatusCodes: RETRYABLE_STATUS_CODES,
  retryableHttpMethods: RETRYABLE_HTTP_METHODS,
  exponentialBackoffBase: 100,
  httpMethod: HTTP_METHOD_GET,
  stream: false,
  timeout: DEFAULT_TIMEOUT,
  useLeader: false,
  maxRedirects: 10,
  attempt: 0,
  retryAttempt: 0,
  redirectAttempt: 0,
  json: true,
};

/**
 * The default to retry a request using the next host in the chain
 */
export const DEAULT_RETRY_DELAY = 30000;

/**
 * Create default header for all HTTP requests
 * @param {Object} [headers={}] HTTP headers to send with the request
 * @returns {Object} The headers with defaults applied
 */
export function createDefaultHeaders(
  headers?: Record<string, string>
): Record<string, string> {
  const { Accept = CONTENT_TYPE_APPLICATION_JSON } = headers ?? {};
  return { ...headers, Accept };
}

/**
 * Clean the request path remove / from the beginning
 * @param {String} path The path to clean
 * @returns {String} The clean path
 */
function cleanPath(path: string): string {
  return String(path).replace(/^\//, '');
}

/**
 * The regex pattern to check if a uri is absolute or relative,
 * if it is absolute the host is not appended
 */
const ABSOLUTE_URI_PATTERN = /^https?:\/\//;

/**
 * Returns the next wait interval, in milliseconds, using an exponential
 * backoff algorithm.
 * @param {Number} attempt The retry attempt
 * @param {Number} base The base of the exponential backoff
 * @param {Number} pow The exponential power
 * @returns {Number} The time to wait in milliseconds
 */
export function getWaitTimeExponential(
  attempt: number = 0,
  base: number = 100,
  pow: number = 2
): number {
  if (attempt === 0) {
    return 0;
  }
  return pow ** attempt * base;
}

/**
 * Returns whether or not the uri passes a test for this.absoluteUriPattern
 * @returns {Boolean} True if the path is absolute
 */
function uriIsAbsolute(uri: string): boolean {
  return ABSOLUTE_URI_PATTERN.test(uri);
}

const normalizeOptions = (
  options?: HttpRequestOptions
): HttpRequestOptionsNormalized => {
  const out: HttpRequestOptions = {
    ...options,
  };

  if (
    out.retryableErrorCodes instanceof Set ||
    Array.isArray(out.retryableErrorCodes)
  ) {
    out.retryableErrorCodes = Array.isArray(out.retryableErrorCodes)
      ? new Set(out.retryableErrorCodes)
      : out.retryableErrorCodes;
  }
  if (
    out.retryableStatusCodes instanceof Set ||
    Array.isArray(out.retryableStatusCodes)
  ) {
    out.retryableStatusCodes = Array.isArray(out.retryableStatusCodes)
      ? new Set(out.retryableStatusCodes)
      : out.retryableStatusCodes;
  }
  if (
    out.retryableHttpMethods instanceof Set ||
    Array.isArray(out.retryableHttpMethods)
  ) {
    out.retryableHttpMethods = Array.isArray(out.retryableHttpMethods)
      ? new Set(out.retryableHttpMethods)
      : out.retryableHttpMethods;
  }

  return out as any;
};

const mergeOptions = (a?: HttpRequestOptions, b?: HttpRequestOptions) => {
  const options = {
    ...normalizeOptions(a),
    ...normalizeOptions(b),
  };

  return options;
};

/**
 * Generic HTTP Request class which all RQLiteJS client
 * should extend for consistent communitication with an RQLite
 * server
 */
export class HttpRequest {
  /**
   * The index of the host in this.hosts which will be tried
   * first before attempting other hosts
   * @type {Number}
   */
  activeHostIndex: number = 0;

  /**
   * A list of hosts that are tried in round robin fashion
   * when certain HTTP responses are received
   * @type {String[]}
   */
  hosts: string[] = [];

  /**
   * The host list index of the leader node defaults
   * to the first host
   * @type {Number}
   */
  leaderHostIndex: number = 0;

  options: HttpRequestOptionsNormalized;

  constructor(hosts: string[] | string, options?: HttpRequestOptions) {
    this.setHosts(hosts);
    if (this.getTotalHosts() === 0) {
      throw new Error('At least one host must be provided');
    }
    this.options = mergeOptions(HTTP_REQUEST_DEFAULTS, options);
  }

  /**
   * Set<any> the list of hosts
   * @param {String[]|String} hosts An array of RQLite hosts or a string
   * that will be split on "," to create an array of hosts, the first
   * host will be tried first when there are multiple hosts
   */
  setHosts(hosts: string[] | string) {
    this.hosts = !Array.isArray(hosts) ? String(hosts).split(',') : hosts;
    this.hosts = this.hosts.flatMap((v) => {
      // Remove trailing slashed from hosts
      const host = String(v).trim().replace(/\/$/, '');
      return host ? [host] : [];
    });
  }

  /**
   * Get the list of hosts
   * @returns {String[]} The list of hosts
   */
  getHosts(): string[] {
    return this.hosts;
  }

  /**
   * Given a host string find the index of that host in the hosts
   * @param {String} host A host to find in hosts
   * @returns {Number} The found host index or -1 if not found
   */
  findHostIndex(host?: string | null): number {
    if (typeof host !== 'string') return -1;
    const parsedHostToFind = new URL(host);
    return this.getHosts().findIndex((v) => {
      const parsedHost = new URL(v);

      // Find a host where all the parsed fields match the requested host
      return (
        ['hostname', 'protocol', 'port', 'pathname', 'search'] as const
      ).every((field) => parsedHostToFind[field] === parsedHost[field]);
    });
  }

  /**
   * Get the current active host from the hosts array
   * @param {Boolean} useLeader If true use the first host which is always
   * the master, this is prefered for write operations
   * @returns {String} The active host
   */
  getActiveHost(useLeader: boolean): string {
    // When useLeader is true we should just use the first host
    const activeHostIndex = useLeader
      ? this.getLeaderHostIndex()
      : this.getActiveHostIndex();
    return this.getHosts()[activeHostIndex];
  }

  /**
   * Set<any> the active host index with check based on this.hosts
   * @param {Number} activeHostIndex The index
   * @returns {Number} The active host index
   */
  setActiveHostIndex(activeHostIndex: number): number {
    if (!Number.isFinite(activeHostIndex)) {
      throw new Error('The activeHostIndex should be a finite number');
    }
    const totalHosts = this.getTotalHosts();
    if (activeHostIndex < 0) {
      // Don't allow an index less then zero
      this.activeHostIndex = 0;
    } else if (activeHostIndex >= totalHosts) {
      // Don't allow an index greater then the length of the hosts
      this.activeHostIndex = totalHosts - 1;
    } else {
      this.activeHostIndex = activeHostIndex;
    }
    return this.activeHostIndex;
  }

  /**
   * Get the host index for the leader node
   * @returns {Number} The host index for the leader node
   */
  getLeaderHostIndex(): number {
    return this.leaderHostIndex;
  }

  /**
   * Set<any> the index in the host array for the leader node
   * @param {Number} leaderHostIndex The index of the host that is the leader node
   * @returns {Number} The host index for the leader node
   */
  setLeaderHostIndex(leaderHostIndex: number): number {
    if (!Number.isFinite(leaderHostIndex)) {
      throw new Error('The leaderHostIndex should be a finite number');
    }
    const totalHosts = this.getTotalHosts();
    if (leaderHostIndex < 0) {
      this.leaderHostIndex = 0;
    } else if (leaderHostIndex > totalHosts) {
      this.leaderHostIndex = totalHosts - 1;
    } else {
      this.leaderHostIndex = leaderHostIndex;
    }
    return this.leaderHostIndex;
  }

  /**
   * Get the active host index
   * @returns {Number} The active host index
   */
  getActiveHostIndex(): number {
    return this.activeHostIndex;
  }

  /**
   * Get active host round robin value
   * @returns {Boolean} The value of activeHostRoundRobin
   */
  getActiveHostRoundRobin(): boolean {
    return this.options.activeHostRoundRobin ?? false;
  }

  /**
   * Get the next active host index
   * @param {Number} [activeHostIndex] An optional paramater to provide the active host index
   * @returns {Number} The next active host index which will wrap around to zero
   */
  getNextActiveHostIndex(
    activeHostIndex: number = this.getActiveHostIndex()
  ): number {
    const totalHosts = this.getTotalHosts();
    const nextIndex = activeHostIndex + 1;
    // If we are past the last index start back over at 1
    if (totalHosts === nextIndex) {
      return 0;
    }
    return nextIndex;
  }

  /**
   * Set<any> the active host index to the next host using a
   * round robin strategy
   */
  setNextActiveHostIndex() {
    // Don't bother if we only have one host
    if (!this.getActiveHostRoundRobin()) {
      return;
    }
    const totalHosts = this.getTotalHosts();
    if (this.getActiveHostRoundRobin() && totalHosts <= 1) {
      return;
    }
    this.setActiveHostIndex(this.getNextActiveHostIndex());
  }

  /**
   * Get the total number of hosts
   * @returns {Number} The total number of hosts
   */
  getTotalHosts(): number {
    return this.getHosts().length;
  }

  /**
   * Returns true when the HTTP request is retryable
   * @param {Object} options The options
   * @param {Number} options.statusCode The HTTP status code
   * @param {String} options.errorCode The error code
   * @param {String} options.httpMethod The http method
   * @returns {Boolean} True if the request is retry able
   */
  requestIsRetryable(
    options: {
      statusCode?: number;
      errorCode?: string;
      httpMethod?: string;
    } = {}
  ): boolean {
    const { statusCode, errorCode, httpMethod } = options;
    // Honor strictly the http method
    if (!this.options.retryableHttpMethods.has(httpMethod!)) {
      return false;
    }
    if (statusCode && this.options.retryableStatusCodes.has(statusCode)) {
      return true;
    }
    if (errorCode && this.options.retryableErrorCodes.has(errorCode)) {
      return true;
    }
    return false;
  }

  async fetch(
    options?: HttpRequestOptions
  ): Promise<{ status: number; body: object | string }> {
    const response = await this.fetchRaw(options);

    const finalOuput = {
      body: (await response.json()) as any,
      status: response.status,
    };

    return finalOuput;
  }

  /**
   * Perform an HTTP request using the provided options
   * @param {HttpRequestOptions} [options={}] Options for the HTTP client
   * @returns {Promise<{status: Number, body: Object|String}>} An object with a status and body
   * property when stream is false and a stream when the stream option is true
   * @throws {ERROR_HTTP_REQUEST_MAX_REDIRECTS} When the maximum number of redirect has been reached
   */
  async fetchRaw(_options?: HttpRequestOptions): Promise<KyResponse> {
    const options = mergeOptions(
      { ...this.options, retries: this.getTotalHosts() * 3 },
      normalizeOptions(_options)
    );

    // Honor the supplied attemptHostIndex or get the active host
    const activeHost = Number.isFinite(options.attemptHostIndex)
      ? this.getHosts()[options.attemptHostIndex!]
      : this.getActiveHost(options.useLeader!);

    let uri = options?.uri;
    if (!uri) {
      throw new Error('The uri option is required');
    }

    uri = uriIsAbsolute(uri) ? uri : `${activeHost}/${cleanPath(uri)}`;
    try {
      // const url = new URL(uri);
      // url.search = new URLSearchParams(query).toString();

      const headers = new Headers(createDefaultHeaders(options.headers));

      if (options.auth) {
        headers.append(
          'Authorization',
          `Basic ${btoa(`${options.auth.username}:${options.auth.password}`)}`
        );
      }

      // Use dynamic import to support CJS output
      const ky = await import('ky').then((m) => m.default);

      const response = await ky(uri, {
        ...(options.body && options.json ? { json: options.body } : {}),
        ...(options.body && !options.json ? { body: options.body } : {}),
        headers,
        method: options.httpMethod,
        // fetch: nodeFetch,
        // hooks: {
        //   beforeRequest: [
        //     (request) => {
        //       // console.log(`REQUEST TO: ${request.url}`);
        //     },
        //   ],
        // },
        redirect: 'manual',
        // req,
        ...(Object.keys(options.query ?? {}).length >= 1
          ? { searchParams: options.query }
          : {}),

        timeout: options.timeout,
        // c,
      });

      return response;

      // if (options.stream) {
      //   // TODO: have stream be a separate function to avoid
      //   // typescript overloading
      //   return response.body as any;
      // }

      // console.log(`finalOutput`, finalOuput);

      // const response = await axios({
      //   url: uri,
      //   auth,
      //   data: body,
      //   maxRedirects: 0, // Handle redirects manually to allow reposting data
      //   headers: createDefaultHeaders({
      //     // default headers for client
      //     ...this.headers,
      //     // headers for fetch request
      //     ...options?.headers,
      //   }),
      //   responseType: stream ? 'stream' : 'json',
      //   method: httpMethod,
      //   params: query,
      //   timeout,
      //   httpsAgent,
      //   httpAgent,
      //   // https://github.com/axios/axios/issues/5058#issuecomment-1272107602
      //   // qs.stringify({ a: ['b', 'c'] }, { arrayFormat: 'brackets' }) ==> config.paramsSerializer.indexes = false// 'a[]=b&a[]=c' // **Default**
      //   paramsSerializer: {
      //     indexes: false,
      //   },
      //   // paramsSerializer(params) {
      //   //   return stringifyQuery(params, { arrayFormat: 'brackets' });
      //   // },
      // });
      // if (stream) {
      //   return response.data;
      // }
      // return {
      //   body: response.data,
      //   status: response.status,
      // };
    } catch (e) {
      // axios.isAxiosError(e)

      // const { response = {}, code: errorCode } = e as AxiosError;
      // const { status: responseStatus, headers: responseHeaders = {} } =
      //   response as any;

      const httpError = e as HTTPError;

      const responseStatus = httpError?.response?.status;
      const responseHeaders = httpError?.response?.headers;

      // Check if the error was a redirect
      const retryable = this.requestIsRetryable({
        statusCode: responseStatus,
        errorCode: (e as any).code,
        httpMethod: options.httpMethod,
      });
      // Save the next active host index and pass it to retry manually
      let nextAttemptHostIndex = Number.isFinite(options.attemptHostIndex)
        ? options.attemptHostIndex!
        : this.getActiveHostIndex();

      nextAttemptHostIndex += 1;
      // We go past the last index start from zero
      if (nextAttemptHostIndex === this.getTotalHosts()) {
        nextAttemptHostIndex = 0;
      }
      // First check if this is a redirect error
      if (responseStatus === 301 || responseStatus === 302) {
        // We maxed out on redirect attempts
        if (options.redirectAttempt! >= options.maxRedirects!) {
          throw new ERROR_HTTP_REQUEST_MAX_REDIRECTS(
            `The maximum number of redirects ${options.maxRedirects} has been reached`
          );
        }
        const location =
          typeof responseHeaders === 'object'
            ? responseHeaders.get('location')
            : undefined;
        // If we were asked to use the leader, but got redirect the leader moved so remember it
        if (options.useLeader) {
          const newLeaderHostIndex = this.findHostIndex(location);
          // If the redirect exists in the hosts list remember it for next time
          if (newLeaderHostIndex > -1) {
            this.setLeaderHostIndex(newLeaderHostIndex);
          }
        }
        return this.fetchRaw({
          ...options,
          uri: location ?? undefined,
          attempt: options.attempt! + 1,
          redirectAttempt: options.redirectAttempt! + 1,
          attemptHostIndex: nextAttemptHostIndex,
        });
      }
      if (retryable && options.retryAttempt! < options.retries!) {
        const waitTime = getWaitTimeExponential(
          options.retryAttempt,
          options.exponentialBackoffBase
        );
        const delayPromise = new Promise((resolve) => {
          setTimeout(resolve, waitTime);
        });
        await delayPromise;
        return this.fetchRaw({
          ...options,
          attempt: options.attempt! + 1,
          retryAttempt: options.retryAttempt! + 1,
          attemptHostIndex: nextAttemptHostIndex,
        });
      }
      throw e;
    }
  }

  /**
   * Perform an HTTP GET request
   * @param {HttpRequestOptions} [options={}] The options
   * @see this.fetch() for options
   */
  async get(options?: HttpRequestOptions) {
    return this.fetch({ ...options, httpMethod: HTTP_METHOD_GET });
  }

  async getStream(options?: HttpRequestOptions) {
    const res = await this.fetchRaw({
      ...options,
      httpMethod: HTTP_METHOD_GET,
    });
    return res.body!;
  }

  /**
   * Perform an HTTP POST request
   * @param {HttpRequestOptions} [options={}] The options
   * @see this.fetch() for options
   */
  async post(options?: HttpRequestOptions) {
    return this.fetch({ ...options, httpMethod: HTTP_METHOD_POST });
  }

  async postStream(options?: HttpRequestOptions) {
    const res = await this.fetchRaw({
      ...options,
      httpMethod: HTTP_METHOD_POST,
    });
    return res.body!;
  }
}
