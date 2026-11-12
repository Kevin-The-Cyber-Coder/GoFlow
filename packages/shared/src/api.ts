/**
 * Transport-level contracts. Keeping them here means the API and the web client
 * describe pagination and errors in exactly one place.
 */

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
  };
}

export interface ApiSuccessBody<T> {
  data: T;
}
