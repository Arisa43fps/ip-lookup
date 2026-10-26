import { describe, expect, it } from "vitest";
import { isHostname } from "../src/lib/host";

describe("isHostname", () => {
  it.each([
    "example.com",
    "www.example.com",
    "a-b.example.co.uk",
    "EXAMPLE.COM",
    "xn--80ak6aa92e.com",
    "example.com.",
    "123.example.com",
  ])("accepts %s", (value) => {
    expect(isHostname(value)).toBe(true);
  });

  it.each([
    "",
    "localhost",
    "example",
    ".example.com",
    "example..com",
    "example.com..",
    "-example.com",
    "example-.com",
    "exa mple.com",
    "example.c",
    "999.1.1.1",
    "1.2.3.4",
    "example.123",
    "http://example.com",
    "example.com/path",
    "user@example.com",
    "ex_ample.com",
    `${"a".repeat(64)}.com`,
    `${"a.".repeat(127)}com`,
  ])("rejects %j", (value) => {
    expect(isHostname(value)).toBe(false);
  });
});
