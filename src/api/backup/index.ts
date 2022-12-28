/**
 * Backup api client to perform RQLite back and load operations
 * @module api/backup
 */
import { HttpRequest, HttpRequestOptions } from '../../http-request';
import {
  CONTENT_TYPE_APPLICATION_OCTET_STREAM,
  CONTENT_TYPE_TEXT_PLAIN,
} from '../../http-request/content-types';

/**
 * The RQLite load api path
 */
export const PATH_LOAD = '/db/load';

/**
 * The RQLite backup api path
 */
export const PATH_BACKUP = '/db/backup';

/**
 * Use plain SQL dump as the back up format
 */
export const BACKUP_DATA_FORMAT_SQL = 'sql';

/**
 * Use sqlite3 dump as the back up format
 */
export const BACKUP_DATA_FORMAT_DUMP = 'dump';

/**
 * Backup api client to perform RQLite back up and load operations
 */
export class BackupApiClient {
  _httpRequest: HttpRequest;

  constructor(hosts: string[] | string, options?: HttpRequestOptions) {
    this._httpRequest = new HttpRequest(hosts, options);
  }

  /**
   * Perform a SQL dump backup from the RQLite server
   * @param The backup data format
   * @returns The response stream
   */
  async backup(
    format: string = BACKUP_DATA_FORMAT_DUMP
  ): Promise<ReadableStream<Uint8Array>> {
    const stream = await this._httpRequest.fetchRaw({
      httpMethod: 'GET',
      headers: {
        // Always sends application/octet-stream from the server in RQLite v4.x
        Accept: CONTENT_TYPE_APPLICATION_OCTET_STREAM,
      },
      ...(format === BACKUP_DATA_FORMAT_SQL
        ? { query: { fmt: BACKUP_DATA_FORMAT_SQL } }
        : {}),
      json: false,
      stream: true,
      uri: PATH_BACKUP,
      useLeader: true,
    });

    return stream.body!;
  }

  /**
   * Perform a SQL restore by sending data the RQLite server
   * @param data The data to be loaded
   * @param format The backup data format
   * @returns The response stream
   */
  async load(
    data: Buffer | string,
    format = BACKUP_DATA_FORMAT_SQL
  ): Promise<ReadableStream<Uint8Array>> {
    const response = await this._httpRequest.fetchRaw({
      httpMethod: 'POST',
      body: data,
      headers: {
        // eslint-disable-next-line max-len
        'Content-Type':
          format === BACKUP_DATA_FORMAT_SQL
            ? CONTENT_TYPE_TEXT_PLAIN
            : CONTENT_TYPE_APPLICATION_OCTET_STREAM,
      },
      json: false,
      stream: true,
      uri: PATH_LOAD,
      useLeader: true,
    });

    return response.body!;
  }
}
