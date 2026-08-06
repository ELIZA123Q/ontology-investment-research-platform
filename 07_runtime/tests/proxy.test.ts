import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

function request(url: string, init: ConstructorParameters<typeof NextRequest>[1] = {}) {
  return new NextRequest(url, init);
}

describe("loopback API boundary", () => {
  it("rejects non-loopback Host and cross-site mutations", () => {
    expect(proxy(request("http://example.com/api/runs")).status).toBe(403);
    expect(proxy(request("http://127.0.0.1:3010/api/runs", {
      method: "POST", headers: { host: "127.0.0.1:3010", origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    })).status).toBe(403);
  });

  it("allows same-origin browser requests and origin-less local clients", () => {
    expect(proxy(request("http://127.0.0.1:3010/api/runs", {
      method: "POST", headers: { host: "127.0.0.1:3010", origin: "http://127.0.0.1:3010", "sec-fetch-site": "same-origin" },
    })).status).toBe(200);
    expect(proxy(request("http://localhost:3010/api/runs", { method: "POST", headers: { host: "localhost:3010" } })).status).toBe(200);
  });
});
