const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export interface RandomSource {
  next(): number;
  integer(minInclusive: number, maxInclusive: number): number;
}

function seedHash(seed: number | string): number {
  const input = String(seed);
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

export function createRandomSource(seed: number | string): RandomSource {
  let state = seedHash(seed);

  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };

  return {
    next: () => nextUint32() / 0x1_0000_0000,
    integer: (minInclusive, maxInclusive) =>
      minInclusive +
      Math.floor(
        (nextUint32() / 0x1_0000_0000) * (maxInclusive - minInclusive + 1),
      ),
  };
}

function encodeBase32(value: bigint, length: number): string {
  let remainder = value;
  let encoded = "";

  for (let index = 0; index < length; index += 1) {
    encoded = CROCKFORD_BASE32[Number(remainder & 31n)] + encoded;
    remainder >>= 5n;
  }

  return encoded;
}

export function createUlidFactory(
  random: RandomSource,
): (timestampMs: number) => string {
  return (timestampMs) => {
    const timestamp = BigInt(timestampMs);
    let randomBits = 0n;

    for (let index = 0; index < 10; index += 1) {
      randomBits = (randomBits << 8n) | BigInt(random.integer(0, 255));
    }

    return `${encodeBase32(timestamp, 10)}${encodeBase32(randomBits, 16)}`;
  };
}
