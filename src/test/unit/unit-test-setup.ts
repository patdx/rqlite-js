/**
 * Bootstrap for unit tests
 */
import nock from 'nock';
import nodeFetch, { Headers, Request, Response } from 'node-fetch';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

globalThis.fetch = nodeFetch;
globalThis.Headers = Headers;
globalThis.Request = Request;
globalThis.Response = Response;

describe('empty file', () => {
  it('should be true', () => {
    expect(true, 'fake test');
  });
});

beforeAll(() => {
  nock.disableNetConnect();
  nock.enableNetConnect('127.0.0.1');
});

/**
 * Destory all nocks before each test
 */
beforeEach(() => {
  nock.cleanAll();
});

afterAll(() => {
  nock.enableNetConnect();
});
