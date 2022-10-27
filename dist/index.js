// src/http-request/index.js
import axios from "axios";
import { stringify as stringifyQuery } from "qs";
import { parse as parseUrl } from "url";

// src/http-request/http-methods.js
var HTTP_METHOD_DELETE = "DELETE";
var HTTP_METHOD_GET = "GET";
var HTTP_METHOD_HEAD = "HEAD";
var HTTP_METHOD_OPTIONS = "OPTIONS";
var HTTP_METHOD_PATCH = "PATCH";
var HTTP_METHOD_POST = "POST";
var HTTP_METHOD_PUT = "PUT";

// src/http-request/content-types.js
var CONTENT_TYPE_TEXT_PLAIN = "text/plain";
var CONTENT_TYPE_APPLICATION_JSON = "application/json;charset=utf-8";
var CONTENT_TYPE_APPLICATION_OCTET_STREAM = "application/octet-stream";

// src/http-request/errors.js
var ERROR_HTTP_REQUEST_MAX_REDIRECTS = class extends Error {
  constructor(...args) {
    super(...args);
    this.name = this.constructor.name;
    this.code = this.constructor.name;
  }
};

// src/http-request/retryable.js
var RETRYABLE_ERROR_CODES = /* @__PURE__ */ new Set([
  "EADDRINUSE",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT"
]);
var RETRYABLE_STATUS_CODES = /* @__PURE__ */ new Set([
  408,
  413,
  429,
  500,
  502,
  503,
  504,
  521,
  522,
  524
]);
var RETRYABLE_HTTP_METHODS = /* @__PURE__ */ new Set([
  HTTP_METHOD_DELETE,
  HTTP_METHOD_GET,
  HTTP_METHOD_HEAD,
  HTTP_METHOD_OPTIONS,
  HTTP_METHOD_PATCH,
  HTTP_METHOD_POST,
  HTTP_METHOD_PUT
]);

// src/http-request/index.js
var DEAULT_TIMEOUT = 3e4;
function createDefaultHeaders(headers = {}) {
  const { Accept = CONTENT_TYPE_APPLICATION_JSON } = headers;
  return { ...headers, Accept };
}
function cleanPath(path) {
  return String(path).replace(/^\//, "");
}
function getWaitTimeExponential(attempt = 0, base = 100, pow = 2) {
  if (attempt === 0) {
    return 0;
  }
  return pow ** attempt * base;
}
var HttpRequest = class {
  activeHostIndex = 0;
  activeHostRoundRobin = true;
  absoluteUriPattern = /^https?:\/\//;
  hosts = [];
  httpAgent;
  httpsAgent;
  leaderHostIndex = 0;
  retryableErrorCodes = RETRYABLE_ERROR_CODES;
  retryableStatusCodes = RETRYABLE_STATUS_CODES;
  retryableHttpMethods = RETRYABLE_HTTP_METHODS;
  exponentailBackoffBase = 100;
  authentication = /* @__PURE__ */ new Map();
  constructor(hosts, options = {}) {
    this.setHosts(hosts);
    if (this.getTotalHosts() === 0) {
      throw new Error("At least one host must be provided");
    }
    const {
      activeHostRoundRobin = true,
      httpAgent,
      httpsAgent,
      retryableErrorCodes,
      retryableStatusCodes,
      retryableHttpMethods,
      exponentailBackoffBase,
      authentication
    } = options;
    if (typeof authentication === "object") {
      const { username, password } = authentication;
      if (username) {
        this.authentication.set("username", username);
      }
      if (password) {
        this.authentication.set("password", password);
      }
    }
    if (typeof activeHostRoundRobin !== "undefined") {
      this.setActiveHostRoundRobin(activeHostRoundRobin);
    }
    if (typeof httpAgent !== "undefined") {
      this.setHttpAgent(httpAgent);
    }
    if (typeof httpsAgent !== "undefined") {
      this.setHttpsAgent(httpsAgent);
    }
    if (retryableErrorCodes instanceof Set || Array.isArray(retryableErrorCodes)) {
      this.setRetryableErrorCodes(
        Array.isArray(retryableErrorCodes) ? Set(retryableErrorCodes) : retryableErrorCodes
      );
    }
    if (retryableStatusCodes instanceof Set || Array.isArray(retryableStatusCodes)) {
      this.setRetryableStatusCodes(
        Array.isArray(retryableStatusCodes) ? Set(retryableStatusCodes) : retryableStatusCodes
      );
    }
    if (retryableHttpMethods instanceof Set || Array.isArray(retryableHttpMethods)) {
      this.setRetryableHttpMethods(
        Array.isArray(retryableHttpMethods) ? Set(retryableHttpMethods) : retryableHttpMethods
      );
    }
    if (Number.isFinite(exponentailBackoffBase)) {
      this.setExponentailBackoffBase(exponentailBackoffBase);
    }
  }
  setAuthentication(authentication = {}) {
    const { username, password } = authentication;
    if (username) {
      this.authentication.set("username", username);
    }
    if (password) {
      this.authentication.set("password", password);
    }
  }
  setExponentailBackoffBase(exponentailBackoffBase) {
    this.exponentailBackoffBase = exponentailBackoffBase;
  }
  getExponentailBackoffBase() {
    return this.exponentailBackoffBase;
  }
  setRetryableErrorCodes(retryableErrorCodes) {
    this.retryableErrorCodes = retryableErrorCodes;
  }
  getRetryableErrorCodes() {
    return this.retryableErrorCodes;
  }
  setRetryableStatusCodes(retryableStatusCodes) {
    this.retryableStatusCodes = retryableStatusCodes;
  }
  getRetryableStatusCodes() {
    return this.retryableStatusCodes;
  }
  setRetryableHttpMethods(retryableHttpMethods) {
    this.retryableHttpMethods = retryableHttpMethods;
  }
  getRetryableHttpMethods() {
    return this.retryableHttpMethods;
  }
  setHttpAgent(httpAgent) {
    this.httpAgent = httpAgent;
  }
  getHttpAgent() {
    return this.httpAgent;
  }
  setHttpsAgent(httpsAgent) {
    this.httpsAgent = httpsAgent;
  }
  getHttpsAgent() {
    return this.httpsAgent;
  }
  setHosts(hosts) {
    this.hosts = !Array.isArray(hosts) ? String(hosts).split(",") : hosts;
    this.hosts = this.hosts.reduce((acc, v) => {
      const host = String(v).trim().replace(/\/$/, "");
      if (!host) {
        return acc;
      }
      return acc.concat(host);
    }, []);
  }
  getHosts() {
    return this.hosts;
  }
  findHostIndex(host) {
    const parsedHostToFind = parseUrl(host);
    return this.getHosts().findIndex((v) => {
      const parsedHost = parseUrl(v);
      return ["hostname", "protocol", "port", "path"].every(
        (field) => parsedHostToFind[field] === parsedHost[field]
      );
    });
  }
  getActiveHost(useLeader) {
    const activeHostIndex = useLeader ? this.getLeaderHostIndex() : this.getActiveHostIndex();
    return this.getHosts()[activeHostIndex];
  }
  setActiveHostIndex(activeHostIndex) {
    if (!Number.isFinite(activeHostIndex)) {
      throw new Error("The activeHostIndex should be a finite number");
    }
    const totalHosts = this.getTotalHosts();
    if (activeHostIndex < 0) {
      this.activeHostIndex = 0;
    } else if (activeHostIndex >= totalHosts) {
      this.activeHostIndex = totalHosts - 1;
    } else {
      this.activeHostIndex = activeHostIndex;
    }
    return this.activeHostIndex;
  }
  getLeaderHostIndex() {
    return this.leaderHostIndex;
  }
  setLeaderHostIndex(leaderHostIndex) {
    if (!Number.isFinite(leaderHostIndex)) {
      throw new Error("The leaderHostIndex should be a finite number");
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
  getActiveHostIndex() {
    return this.activeHostIndex;
  }
  setActiveHostRoundRobin(activeHostRoundRobin) {
    if (typeof activeHostRoundRobin !== "boolean") {
      throw new Error("The activeHostRoundRobin argument must be boolean");
    }
    this.activeHostRoundRobin = activeHostRoundRobin;
  }
  getActiveHostRoundRobin() {
    return this.activeHostRoundRobin;
  }
  getNextActiveHostIndex(activeHostIndex = this.getActiveHostIndex()) {
    const totalHosts = this.getTotalHosts();
    const nextIndex = activeHostIndex + 1;
    if (totalHosts === nextIndex) {
      return 0;
    }
    return nextIndex;
  }
  setNextActiveHostIndex() {
    if (!this.getActiveHostRoundRobin()) {
      return;
    }
    const totalHosts = this.getTotalHosts();
    if (this.getActiveHostRoundRobin() && totalHosts <= 1) {
      return;
    }
    this.setActiveHostIndex(this.getNextActiveHostIndex());
  }
  getTotalHosts() {
    return this.getHosts().length;
  }
  uriIsAbsolute(uri) {
    return this.absoluteUriPattern.test(uri);
  }
  requestIsRetryable(options = {}) {
    const { statusCode, errorCode, httpMethod } = options;
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
  async fetch(options = {}) {
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
      httpsAgent = this.getHttpsAgent()
    } = options;
    const activeHost = Number.isFinite(attemptHostIndex) ? this.getHosts()[attemptHostIndex] : this.getActiveHost(useLeader);
    let { uri } = options;
    if (!uri) {
      throw new Error("The uri option is required");
    }
    uri = this.uriIsAbsolute(uri) ? uri : `${activeHost}/${cleanPath(uri)}`;
    try {
      let auth;
      if (this.authentication.size) {
        auth = {
          username: this.authentication.get("username"),
          password: this.authentication.get("password")
        };
      }
      const response = await axios({
        url: uri,
        auth,
        data: body,
        maxRedirects: 0,
        headers: createDefaultHeaders(headers),
        responseType: stream ? "stream" : "json",
        method: httpMethod,
        params: query,
        timeout,
        httpsAgent,
        httpAgent,
        paramsSerializer(params) {
          return stringifyQuery(params, { arrayFormat: "brackets" });
        }
      });
      if (stream) {
        return response.data;
      }
      return {
        body: response.data,
        status: response.status
      };
    } catch (e) {
      const { response = {}, code: errorCode } = e;
      const { status: responseStatus, headers: responseHeaders = {} } = response;
      const retryable = this.requestIsRetryable({
        statusCode: responseStatus,
        errorCode,
        httpMethod
      });
      let nextAttemptHostIndex = Number.isFinite(attemptHostIndex) ? attemptHostIndex : this.getActiveHostIndex();
      nextAttemptHostIndex += 1;
      if (nextAttemptHostIndex === this.getTotalHosts()) {
        nextAttemptHostIndex = 0;
      }
      if (responseStatus === 301 || responseStatus === 302) {
        if (redirectAttempt >= maxRedirects) {
          throw ERROR_HTTP_REQUEST_MAX_REDIRECTS(
            `The maximum number of redirects ${maxRedirects} has been reached`
          );
        }
        const location = typeof responseHeaders === "object" ? responseHeaders.location : void 0;
        if (useLeader) {
          const newLeaderHostIndex = this.findHostIndex(location);
          if (newLeaderHostIndex > -1) {
            this.setLeaderHostIndex(newLeaderHostIndex);
          }
        }
        return this.fetch({
          ...options,
          uri: location,
          attempt: attempt + 1,
          redirectAttempt: redirectAttempt + 1,
          attemptHostIndex: nextAttemptHostIndex
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
          attemptHostIndex: nextAttemptHostIndex
        });
      }
      throw e;
    }
  }
  async get(options = {}) {
    return this.fetch({ ...options, httpMethod: HTTP_METHOD_GET });
  }
  async post(options = {}) {
    return this.fetch({ ...options, httpMethod: HTTP_METHOD_POST });
  }
};

// src/api/client/index.js
function createQuery(options = {}) {
  const { level, pretty, timings, atomic, transaction } = options;
  const query = { level, pretty, timings, atomic, transaction };
  return Object.entries(query).reduce((acc, entry) => {
    const [key, val] = entry;
    if (typeof val !== "undefined") {
      acc[key] = val;
    }
    return acc;
  }, {});
}
var ApiClient = class extends HttpRequest {
  async get(path, sql, options = {}) {
    const { useLeader } = options;
    if (!path) {
      throw new Error("The path argument is required");
    }
    return super.get({
      useLeader,
      uri: path,
      httpMethod: HTTP_METHOD_GET,
      query: { ...createQuery(options), q: sql }
    });
  }
  async post(path, sql, options = {}) {
    const { useLeader } = options;
    if (!path) {
      throw new Error("The path argument is required");
    }
    return super.post({
      useLeader,
      uri: path,
      httpMethod: HTTP_METHOD_POST,
      query: createQuery(options),
      body: Array.isArray(sql) ? sql : [sql]
    });
  }
};

// src/api/results/data-result.js
var DataResult = class {
  time = 0;
  lastInsertId;
  rowsAffected = 0;
  results = [];
  data = {};
  constructor(result, valuesIndex) {
    if (typeof result !== "object") {
      throw new Error("The result argument is required to be an object");
    }
    if (typeof valuesIndex !== "undefined" && !Number.isFinite(valuesIndex)) {
      throw new Error(
        "The valuesIndex argument is required to be a finite number when provided"
      );
    }
    this.time = parseFloat(result.time || 0);
    this.rowsAffected = parseInt(result.rows_affected || 0, 10);
    this.lastInsertId = result.last_insert_id;
    if (Number.isFinite(valuesIndex)) {
      const { columns } = result;
      const resultValues = result.values[valuesIndex];
      if (resultValues) {
        this.data = resultValues.reduce((acc, val, i) => {
          const col = columns[i];
          acc[col] = val;
          return acc;
        }, {});
      }
    }
  }
  get(property) {
    return this.data[property];
  }
  getTime() {
    return this.time;
  }
  getLastInsertId() {
    return this.lastInsertId;
  }
  getRowsAffected() {
    return this.rowsAffected;
  }
  toObject() {
    return JSON.parse(JSON.stringify(this.data));
  }
  toArray() {
    return Object.values(this.data);
  }
  toColumnsArray() {
    return Object.keys(this.data);
  }
  toString() {
    return JSON.stringify(this.data);
  }
};

// src/api/results/data-result-error.js
var DataResultError = class extends Error {
  constructor(...args) {
    super(...args);
    this.name = this.constructor.name;
    this.code = this.constructor.name;
  }
  toObject() {
    return { error: this.message };
  }
  toString() {
    return JSON.stringify(this.toObject());
  }
};

// src/api/results/data-results.js
var DataResults = class {
  time = 0;
  results = [];
  constructor(data) {
    this.setApiData(data);
  }
  setApiData(data) {
    if (typeof data !== "object") {
      throw new Error("The data argument is required to be an object");
    }
    if (!data.results) {
      throw new Error("The data object is required to have a results property");
    }
    this.time = parseFloat(data.time || 0);
    const { results = [] } = data;
    this.results = results.reduce((acc, result) => {
      if (typeof result === "object" && result.error) {
        return acc.concat(new DataResultError(result.error));
      }
      const { values: vals } = result;
      if (!vals) {
        return acc.concat(new DataResult(result));
      }
      const dataResults = vals.map(
        (_v, valuesIndex) => new DataResult(result, valuesIndex)
      );
      return acc.concat(dataResults);
    }, []);
  }
  hasError() {
    return !!this.getFirstError();
  }
  getFirstError() {
    return this.results.find((v) => v instanceof DataResultError);
  }
  getTime() {
    return this.time;
  }
  get(index) {
    return this.results[index];
  }
  getResults() {
    return this.results;
  }
  toArray() {
    return this.results.map((result) => result.toObject());
  }
  toString() {
    const list = this.results.map((result) => result.toObject());
    return JSON.stringify(list);
  }
};

// src/api/data/index.js
var PATH_QUERY = "/db/query";
var PATH_EXECUTE = "/db/execute";
var CONSISTENCY_LEVEL_NONE = "none";
var CONSISTENCY_LEVEL_STRONG = "strong";
var CONSISTENCY_LEVEL_WEAK = "weak";
function handleResponse(response, options = {}) {
  const { raw } = options;
  const { body } = response;
  if (raw) {
    return response;
  }
  return new DataResults(body);
}
var DataApiClient = class extends ApiClient {
  async query(sql, options = {}) {
    const { level } = options;
    let { useLeader } = options;
    if (level !== CONSISTENCY_LEVEL_NONE) {
      useLeader = true;
    }
    let response;
    if (Array.isArray(sql)) {
      response = await super.post(PATH_QUERY, sql, { ...options, useLeader });
    } else {
      response = await super.get(PATH_QUERY, sql, { ...options, useLeader });
    }
    if (!useLeader) {
      this.setNextActiveHostIndex();
    }
    return handleResponse(response, options);
  }
  async execute(sql, options = {}) {
    const response = await super.post(PATH_EXECUTE, sql, options);
    return handleResponse(response, options);
  }
};

// src/api/backup/index.js
var PATH_LOAD = "/db/load";
var PATH_BACKUP = "/db/backup";
var BACKUP_DATA_FORMAT_SQL = "sql";
var BACKUP_DATA_FORMAT_DUMP = "dump";
var BackupApiClient = class extends HttpRequest {
  async backup(format = BACKUP_DATA_FORMAT_DUMP) {
    const stream = super.get({
      headers: {
        Accept: CONTENT_TYPE_APPLICATION_OCTET_STREAM
      },
      query: { fmt: format === BACKUP_DATA_FORMAT_SQL ? format : void 0 },
      json: false,
      stream: true,
      uri: PATH_BACKUP,
      useLeader: true
    });
    return stream;
  }
  async load(data, format = BACKUP_DATA_FORMAT_SQL) {
    return super.post({
      body: data,
      headers: {
        "Content-Type": format === BACKUP_DATA_FORMAT_SQL ? CONTENT_TYPE_TEXT_PLAIN : CONTENT_TYPE_APPLICATION_OCTET_STREAM
      },
      json: false,
      stream: true,
      uri: PATH_LOAD,
      useLeader: true
    });
  }
};

// src/api/status/index.js
var PATH_STATUS = "/status";
var StatusApiClient = class extends ApiClient {
  async status(options = {}) {
    return super.get(PATH_STATUS, { useLeader: true, ...options });
  }
  async statusAllHosts(options = {}) {
    const hosts = this.getHosts();
    const promises = hosts.map(async (_host, activeHostIndex) => {
      const response = await this.status({ ...options, activeHostIndex });
      return { response, host: hosts[activeHostIndex] };
    });
    return Promise.all(promises);
  }
};
export {
  BACKUP_DATA_FORMAT_DUMP,
  BACKUP_DATA_FORMAT_SQL,
  BackupApiClient,
  CONSISTENCY_LEVEL_NONE,
  CONSISTENCY_LEVEL_STRONG,
  CONSISTENCY_LEVEL_WEAK,
  DataApiClient,
  PATH_BACKUP,
  PATH_EXECUTE,
  PATH_LOAD,
  PATH_QUERY,
  PATH_STATUS,
  StatusApiClient
};
