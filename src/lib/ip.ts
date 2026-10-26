const IPV4_PATTERN =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

export function isIPv4(value: string): boolean {
  return IPV4_PATTERN.test(value);
}

function countIPv6Groups(part: string, allowEmbeddedIPv4: boolean): number | null {
  if (part === "") return 0;

  const groups = part.split(":");
  let count = 0;

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    const isLast = index === groups.length - 1;

    if (!group) return null;

    if (group.includes(".")) {
      if (!allowEmbeddedIPv4 || !isLast || !isIPv4(group)) return null;
      count += 2;
      continue;
    }

    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    count += 1;
  }

  return count;
}

export function isIPv6(value: string): boolean {
  if (!value.includes(":") || value.includes("%")) return false;

  const compression = value.indexOf("::");
  if (compression !== -1 && value.indexOf("::", compression + 1) !== -1) {
    return false;
  }

  if (compression === -1) {
    return countIPv6Groups(value, true) === 8;
  }

  const head = value.slice(0, compression);
  const tail = value.slice(compression + 2);

  // An embedded IPv4 address can only be the final 32 bits of the address.
  if (head.includes(".")) return false;

  const headGroups = countIPv6Groups(head, false);
  const tailGroups = countIPv6Groups(tail, true);

  if (headGroups === null || tailGroups === null) return false;
  return headGroups + tailGroups < 8;
}

export function isIP(value: string): boolean {
  return isIPv4(value) || isIPv6(value);
}
