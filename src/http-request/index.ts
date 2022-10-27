/**
 * Plain HTTP client to be used when creating RQLite specific API HTTP clients
 * @module http-request
 */
import axios, { AxiosError } from 'axios';
import { stringify as stringifyQuery } from 'qs';
import { parse as parseUrl } from 'url';
import { HTTP_METHOD_GET, HTTP_METHOD_POST } from './http-methods';
import {
  CONTENT_TYPE_APPLICATION_JSON,
  // CONTENT_TYPE_APPLICATION_OCTET_STREAM,
} from './content-types';
import { ERROR_HTTP_REQUEST_MAX_REDIRECTS } from './errors';
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
  httpMethod?: string;
  /**
   * An object with the query to send with the HTTP request
   */
  query?: any;
  /**
   * When true the returned value is a request object with
   * stream support instead of a request-promise result
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
  httpAgent?: import('node:http').Agent;
  /**
   * An option http agent, useful
   * for keepalive pools using SSL
   */
  httpsAgent?: import('node:https').Agent;

  // added after checking typescript
  exponentailBackoffBase?: number;
  json?: boolean;
};

export type HttpRequestOptions2 = {
  authentication?: {
    username?: string;
    password?: string;
  };
  activeHostRoundRobin?: boolean;
  httpAgent?: import('node:http').Agent;
  httpsAgent?: import('node:https').Agent;
  retryableErrorCodes?: Set<any> | string[];
  retryableStatusCodes?: Set<any> | number[];
  retryableHttpMethods?: Set<any> | string[];
  exponentailBackoffBase?: number;
};

/**
 * The default timeout value
 */
export const DEAULT_TIMEOUT = 30000;

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
  headers: Record<string, string> = {}
): Record<string, string> {
  const { Accept = CONTENT_TYPE_APPLICATION_JSON } = headers;
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
   * Whether or not the setNextActiveHostIndex() should
   * perform a round robin strategy
   */
  activeHostRoundRobin = true;

  /**
   * The regex pattern to check if a uri is absolute or relative,
   * if it is absolute the host is not appended
   */
  absoluteUriPattern = /^https?:\/\//;

  /**
   * A list of hosts that are tried in round robin fashion
   * when certain HTTP responses are received
   * @type {String[]}
   */
  hosts: string[] = [];

  /**
   * @type {import('node:http').Agent} The http agent if it is set
   */
  httpAgent?: import('node:http').Agent;

  /**
   * @type {import('node:https').Agent} The https agent if it is set
   */
  httpsAgent?: import('node:https').Agent;

  /**
   * The host list index of the leader node defaults
   * to the first host
   * @type {Number}
   */
  leaderHostIndex: number = 0;

  /**
   * Http error codes which are considered retryable
   * @type {Set}
   */
  retryableErrorCodes: Set<any> = RETRYABLE_ERROR_CODES;

  /**
   * Http status codes which are considered retryable
   * @type {Set}
   */
  retryableStatusCodes: Set<any> = RETRYABLE_STATUS_CODES;

  /**
   * Http methods which are considered retryable
   * @type {Set}
   */
  retryableHttpMethods: Set<any> = RETRYABLE_HTTP_METHODS;

  /**
   * The exponential backoff base for retries
   */
  exponentailBackoffBase?: number = 100;

  /**
   * Authentication Map
   * @type {Map}
   * @property {String} username
   * @property {String} password
   */
  authentication: Map<string, string> = new Map();

  /**
   * Construtor for HttpRequest
   * @param {String[]|String} hosts An array of RQLite hosts or a string
   * that will be split on "," to create an array of hosts, the first
   * host will be tried first when there are multiple hosts
   * @param {Object} [options={}] Additional options
   * @param {Object} [options.authentication] Authentication options
   * @param {String} [options.authentication.username] The host authentication username
   * @param {String} [options.authentication.password] The host authentication password
   * @param {Boolean} [options.activeHostRoundRobin=true] If true this.setNextActiveHostIndex()
   * will perform a round robin when called
   * @param {import('node:http').Agent} [options.httpAgent] An option http agent, useful for
   * keepalive pools using plain HTTP
   * @param {import('node:https').Agent} [options.httpsAgent] An option http agent, useful
   * for keepalive pools using SSL
   * @param {Set|String[]} [options.retryableErrorCodes] The list of retryable error codes
   * @param {Set|Number[]} [options.retryableStatusCodes] The list of retryable http status codes
   * @param {Set|String[]} [options.retryableHttpMethods] The list of retryable http methods
   * @param {Number} [options.exponentailBackoffBase] The value for exponentail backoff base
   * for retry exponential backoff
   */
  constructor(hosts: string[] | string, options: HttpRequestOptions2 = {}) {
    this.setHosts(hosts);
    if (this.getTotalHosts() === 0) {
      throw new Error('At least one host must be provided');
    }
    const {
      activeHostRoundRobin = true,
      httpAgent,
      httpsAgent,
      retryableErrorCodes,
      retryableStatusCodes,
      retryableHttpMethods,
      exponentailBackoffBase,
      authentication,
    } = options;
    if (typeof authentication === 'object') {
      const { username, password } = authentication;
      if (username) {
        this.authentication.set('username', username);
      }
      if (password) {
        this.authentication.set('password', password);
      }
    }
    if (typeof activeHostRoundRobin !== 'undefined') {
      this.setActiveHostRoundRobin(activeHostRoundRobin);
    }
    if (typeof httpAgent !== 'undefined') {
      this.setHttpAgent(httpAgent);
    }
    if (typeof httpsAgent !== 'undefined') {
      this.setHttpsAgent(httpsAgent);
    }
    if (
      retryableErrorCodes instanceof Set ||
      Array.isArray(retryableErrorCodes)
    ) {
      this.setRetryableErrorCodes(
        Array.isArray(retryableErrorCodes)
          ? new Set(retryableErrorCodes)
          : retryableErrorCodes
      );
    }
    if (
      retryableStatusCodes instanceof Set ||
      Array.isArray(retryableStatusCodes)
    ) {
      this.setRetryableStatusCodes(
        Array.isArray(retryableStatusCodes)
          ? new Set(retryableStatusCodes)
          : retryableStatusCodes
      );
    }
    if (
      retryableHttpMethods instanceof Set ||
      Array.isArray(retryableHttpMethods)
    ) {
      this.setRetryableHttpMethods(
        Array.isArray(retryableHttpMethods)
          ? new Set(retryableHttpMethods)
          : retryableHttpMethods
      );
    }
    if (Number.isFinite(exponentailBackoffBase)) {
      this.setExponentailBackoffBase(exponentailBackoffBase);
    }
  }

  /**
   * Set<any> authentication information
   * @param {Object} [authentication] Authentication data
   * @param {String} [authentication.username] The host authentication username
   * @param {String} [authentication.password] The host authentication password
   */
  setAuthentication(
    authentication: {
      username?: string;
      password?: string;
    } = {}
  ) {
    const { username, password } = authentication;
    if (username) {
      this.authentication.set('username', username);
    }
    if (password) {
      this.authentication.set('password', password);
    }
  }

  /**
   * Set<any> the exponentail backoff base
   * @param {Number} exponentailBackoffBase
   */
  setExponentailBackoffBase(exponentailBackoffBase?: number) {
    this.exponentailBackoffBase = exponentailBackoffBase;
  }

  /**
   * Get the exponentail backoff base
   * @return {Number} The exponentail backoff base
   */
  getExponentailBackoffBase(): number | undefined {
    return this.exponentailBackoffBase;
  }

  /**
   * Set<any> the retryable error codes
   * @param {Set} retryableErrorCodes
   */
  setRetryableErrorCodes(retryableErrorCodes: Set<any>) {
    this.retryableErrorCodes = retryableErrorCodes;
  }

  /**
   * Get the retryable error codes
   * @returns {Set}
   */
  getRetryableErrorCodes(): Set<any> {
    return this.retryableErrorCodes;
  }

  /**
   * Set<any> the retryable status codes
   * @param {Set} retryableStatusCodes
   */
  setRetryableStatusCodes(retryableStatusCodes: Set<any>) {
    this.retryableStatusCodes = retryableStatusCodes;
  }

  /**
   * Get the retryable status codes
   * @returns {Set}
   */
  getRetryableStatusCodes(): Set<any> {
    return this.retryableStatusCodes;
  }

  /**
   * Set<any> the retryable http methods
   * @param {Set} retryableHttpMethods
   */
  setRetryableHttpMethods(retryableHttpMethods: Set<any>) {
    this.retryableHttpMethods = retryableHttpMethods;
  }

  /**
   * Get the retryable http methods
   * @returns {Set}
   */
  getRetryableHttpMethods(): Set<any> {
    return this.retryableHttpMethods;
  }

  /**
   * Set<any> an http agent which is useful for http keepalive requests
   * @param {import('node:http').Agent} httpAgent An http agent
   */
  setHttpAgent(httpAgent: import('node:http').Agent) {
    this.httpAgent = httpAgent;
  }

  /**
   * Get the Set<any> http agent
   * @returns {import('node:http').Agent|undefined} The https agent if it is set
   */
  getHttpAgent(): import('node:http').Agent | undefined {
    return this.httpAgent;
  }

  /**
   * Set<any> an https agent which is useful for https keepalive requests
   * @param {import('node:https').Agent} httpsAgent An https agent
   */
  setHttpsAgent(httpsAgent: import('node:https').Agent) {
    this.httpsAgent = httpsAgent;
  }

  /**
   * Get the Set<any> https agent
   * @returns {import('node:https').Agent|undefined} The https agent if it is set
   */
  getHttpsAgent(): import('node:https').Agent | undefined {
    return this.httpsAgent;
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
  findHostIndex(host: string): number {
    const parsedHostToFind = parseUrl(host);
    return this.getHosts().findIndex((v) => {
      const parsedHost = parseUrl(v);
      // Find a host where all the parsed fields match the requested host
      return (['hostname', 'protocol', 'port', 'path'] as const).every(
        (field) => parsedHostToFind[field] === parsedHost[field]
      );
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
   * Set<any> active host round robin value
   * @param {Boolean} activeHostRoundRobin If true setActiveHostIndex() will
   * perform a round robin
   */
  setActiveHostRoundRobin(activeHostRoundRobin: boolean) {
    if (typeof activeHostRoundRobin !== 'boolean') {
      throw new Error('The activeHostRoundRobin argument must be boolean');
    }
    this.activeHostRoundRobin = activeHostRoundRobin;
  }

  /**
   * Get active host round robin value
   * @returns {Boolean} The value of activeHostRoundRobin
   */
  getActiveHostRoundRobin(): boolean {
    return this.activeHostRoundRobin;
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
   * Returns whether or not the uri passes a test for this.absoluteUriPattern
   * @returns {Boolean} True if the path is absolute
   */
  uriIsAbsolute(uri: string): boolean {
    return this.absoluteUriPattern.test(uri);
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
    if (!this.getRetryableHttpMethods().has(httpMethod)) {
      return false;
    }
    if (statusCode && this.getRetryableStatusCodes().has(statusCode)) {
      return true;
    }
    if (errorCode && this.getRetryableErrorCodes().has(errorCode)) {
      return true;
    }
    return false;
  }

  /**
   * Perform an HTTP request using the provided options
   * @param {HttpRequestOptions} [options={}] Options for the HTTP client
   * @returns {Promise<{status: Number, body: Object|String}>} An object with a status and body
   * property when stream is false and a stream when the stream option is true
   * @throws {ERROR_HTTP_REQUEST_MAX_REDIRECTS} When the maximum number of redirect has been reached
   */
  async fetch(
    options?: HttpRequestOptions
  ): Promise<{ status: number; body: object | string }> {
    const {
      body,
      headers = {},
      httpMethod = HTTP_METHOD_GET,
      query,
      stream = false,
      timeout = DEAULT_TIMEOUT,
      useLeader = false,
      retries = this.getTotalHosts() * 3,
      maxRedirects = 10,
      attempt = 0,
      retryAttempt = 0,
      redirectAttempt = 0,
      attemptHostIndex,
      exponentailBackoffBase = this.getExponentailBackoffBase(),
      httpAgent = this.getHttpAgent(),
      httpsAgent = this.getHttpsAgent(),
    } = options ?? {};
    // Honor the supplied attemptHostIndex or get the active host
    const activeHost = Number.isFinite(attemptHostIndex)
      ? this.getHosts()[attemptHostIndex!]
      : this.getActiveHost(useLeader);

    let uri = options?.uri;
    if (!uri) {
      throw new Error('The uri option is required');
    }

    uri = this.uriIsAbsolute(uri) ? uri : `${activeHost}/${cleanPath(uri)}`;
    try {
      let auth;
      if (this.authentication.size) {
        auth = {
          username: this.authentication.get('username'),
          password: this.authentication.get('password'),
        } as any;
      }
      const response = await axios({
        url: uri,
        auth,
        data: body,
        maxRedirects: 0, // Handle redirects manually to allow reposting data
        headers: createDefaultHeaders(headers),
        responseType: stream ? 'stream' : 'json',
        method: httpMethod,
        params: query,
        timeout,
        httpsAgent,
        httpAgent,
        paramsSerializer(params) {
          return stringifyQuery(params, { arrayFormat: 'brackets' });
        },
      });
      if (stream) {
        return response.data;
      }
      return {
        body: response.data,
        status: response.status,
      };
    } catch (e) {
      // axios.isAxiosError(e)
      const { response = {}, code: errorCode } = e as AxiosError;
      const { status: responseStatus, headers: responseHeaders = {} } =
        response as any;
      // Check if the error was a redirect
      const retryable = this.requestIsRetryable({
        statusCode: responseStatus,
        errorCode,
        httpMethod,
      });
      // Save the next active host index and pass it to retry manually
      let nextAttemptHostIndex = Number.isFinite(attemptHostIndex)
        ? attemptHostIndex!
        : this.getActiveHostIndex();

      nextAttemptHostIndex += 1;
      // We go past the last index start from zero
      if (nextAttemptHostIndex === this.getTotalHosts()) {
        nextAttemptHostIndex = 0;
      }
      // First check if this is a redirect error
      if (responseStatus === 301 || responseStatus === 302) {
        // We maxed out on redirect attempts
        if (redirectAttempt >= maxRedirects) {
          throw new ERROR_HTTP_REQUEST_MAX_REDIRECTS(
            `The maximum number of redirects ${maxRedirects} has been reached`
          );
        }
        const location =
          typeof responseHeaders === 'object'
            ? responseHeaders.location
            : undefined;
        // If we were asked to use the leader, but got redirect the leader moved so remember it
        if (useLeader) {
          const newLeaderHostIndex = this.findHostIndex(location);
          // If the redirect exists in the hosts list remember it for next time
          if (newLeaderHostIndex > -1) {
            this.setLeaderHostIndex(newLeaderHostIndex);
          }
        }
        return this.fetch({
          ...options,
          uri: location,
          attempt: attempt + 1,
          redirectAttempt: redirectAttempt + 1,
          attemptHostIndex: nextAttemptHostIndex,
        });
      }
      if (retryable && retryAttempt < retries) {
        const waitTime = getWaitTimeExponential(
          retryAttempt,
          exponentailBackoffBase
        );
        const delayPromise = new Promise((resolve) => {
          setTimeout(resolve, waitTime);
        });
        await delayPromise;
        return this.fetch({
          ...options,
          attempt: attempt + 1,
          retryAttempt: retryAttempt + 1,
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
  async get(options: HttpRequestOptions = {}) {
    return this.fetch({ ...options, httpMethod: HTTP_METHOD_GET });
  }

  /**
   * Perform an HTTP POST request
   * @param {HttpRequestOptions} [options={}] The options
   * @see this.fetch() for options
   */
  async post(options: HttpRequestOptions = {}) {
    return this.fetch({ ...options, httpMethod: HTTP_METHOD_POST });
  }
}
