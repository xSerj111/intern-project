import { REQUEST_ID_HEADER } from "./request-context";

/** CORS `allowedHeaders` shared by every backend: lets the client send a request id. */
export const CORS_ALLOWED_HEADERS: readonly string[] = [
  "Content-Type",
  "Authorization",
  "Accept",
  REQUEST_ID_HEADER,
];

/** CORS `exposedHeaders` shared by every backend: lets the client read the echoed request id. */
export const CORS_EXPOSED_HEADERS: readonly string[] = [REQUEST_ID_HEADER];
