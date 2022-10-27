/**
 * Class for handling RQLite data api result error
 * @module api/results/data-results
 */

export type PlainDataResultError = {
  error: string;
};

/**
 * A class that represents one data error result from an RQLite query or execute
 * API call
 */
export class DataResultError extends Error {
  name = 'DataResultError';

  code = 'DataResultError';

  error?: string;

  constructor(message?: string) {
    super(message);
    this.error = message;
  }

  /**
   * Get the result data error as plain object
   */
  toObject(): PlainDataResultError {
    return { error: this.message };
  }

  /**
   * Convert the result data error to a JSON string
   */
  toString(): string {
    return JSON.stringify(this.toObject());
  }

  toJSON(): PlainDataResultError {
    return this.toObject();
  }
}
