import { describe, expect, it } from "vitest";
import { isIP, isIPv4, isIPv6 } from "../src/lib/ip";

describe("isIPv4", () => {
  it.each(["0.0.0.0", "8.8.8.8", "192.0.2.1", "255.255.255.255"])(
    "accepts %s",
    (value) => {
      expect(isIPv4(value)).toBe(true);
    },
  );

  it.each([
    "",
    "1.2.3",
    "1.2.3.4.5",
    "256.1.1.1",
    "01.2.3.4",
    "1.2.3.-1",
    "1.2.3.4 ",
    "example.com",
  ])("rejects %s", (value) => {
    expect(isIPv4(value)).toBe(false);
  });
});

describe("isIPv6", () => {
  it.each([
    "::",
    "::1",
    "2001:db8::1",
    "fe80::1",
    "1:2:3:4:5:6:7:8",
    "1:2:3:4:5:6:7::",
    "::1:2:3:4:5:6:7",
    "::ffff:192.0.2.1",
    "1:2:3:4:5:6:192.0.2.1",
  ])("accepts %s", (value) => {
    expect(isIPv6(value)).toBe(true);
  });

  it.each([
    "",
    "1.2.3.4",
    "2001:db8",
    "2001:db8::1::2",
    "1:2:3:4:5:6:7:8:9",
    "1:2:3:4:5:6:7",
    "1:2:3:4:5:6:7:8::",
    "::ffff:192.0.2.1:1",
    "192.0.2.1::",
    "fe80::1%eth0",
    "1:::2",
    ":::",
    "example.com",
  ])("rejects %s", (value) => {
    expect(isIPv6(value)).toBe(false);
  });
});

describe("isIP", () => {
  it("accepts both address families", () => {
    expect(isIP("8.8.8.8")).toBe(true);
    expect(isIP("2001:db8::1")).toBe(true);
  });

  it("rejects hostnames and empty values", () => {
    expect(isIP("ipinfo.io")).toBe(false);
    expect(isIP("")).toBe(false);
  });
});
