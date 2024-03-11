import { Field, Poseidon } from "o1js";

function convert(value: string, radix: number) {
  return [...value.toString()].reduce(
    (r, v) => r * BigInt(radix) + BigInt(parseInt(v, radix)),
    0n
  );
}

export function serializeFields(fields: Field[]): string {
  const hash = Poseidon.hash(fields);
  const value = [hash, ...fields];
  return value.map((f) => f.toBigInt().toString(36)).join(".");
}

export function deserializeFields(s: string): Field[] {
  try {
    const value = s.split(".").map((n) => Field(BigInt(convert(n, 36))));
    const hash = Poseidon.hash(value.slice(1));
    if (hash.equals(value[0]).toBoolean()) {
      return value.slice(1);
    } else throw new Error("deserializeFields: invalid hash: data mismatch");
  } catch (e) {
    throw new Error(`deserializeFields: invalid string: ${s}`);
  }
}
