import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll } from "vitest";

import { network } from "./network";

// Anything not explicitly mocked fails as a network error rather than reaching the internet.
const unmocked = http.all("*", ({ request }) => {
  console.error(`Unmocked request in test: ${request.method} ${request.url}`);
  return HttpResponse.error();
});

beforeAll(() => {
  network.resetHandlers(unmocked);
  network.enable();
});
afterEach(() => network.resetHandlers(unmocked));
afterAll(() => network.disable());
