import { CORS_ALLOWED_HEADERS, CORS_EXPOSED_HEADERS } from "./cors-headers";
import { REQUEST_ID_HEADER } from "./request-context";

describe("CORS header constants", () => {
  it("allow the usual request headers plus the request id", () => {
    expect(CORS_ALLOWED_HEADERS).toEqual([
      "Content-Type",
      "Authorization",
      "Accept",
      REQUEST_ID_HEADER,
    ]);
  });

  it("expose only the request id", () => {
    expect(CORS_EXPOSED_HEADERS).toEqual([REQUEST_ID_HEADER]);
  });
});
