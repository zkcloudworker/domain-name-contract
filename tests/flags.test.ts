import { describe, expect, it } from "@jest/globals";
import { Bool, Field } from "o1js";
import { Flags } from "../src/contract/domain-contract";

describe("Flags", () => {
  it(`should convert Flags to Field and back`, async () => {
    for (let i = 0; i < 1000; i++) {
      const flags = new Flags({
        isValidated: Bool(Math.random() > 0.5),
        isProved: Bool(Math.random() > 0.5),
        isFinal: Bool(Math.random() > 0.5),
        isInvalid: Bool(Math.random() > 0.5),
      });
      const f = flags.toField();
      const flags2 = Flags.fromField(f);
      expect(flags.isFinal.toBoolean()).toBe(flags2.isFinal.toBoolean());
      expect(flags.isProved.toBoolean()).toBe(flags2.isProved.toBoolean());
      expect(flags.isValidated.toBoolean()).toBe(
        flags2.isValidated.toBoolean()
      );
      expect(flags.isInvalid.toBoolean()).toBe(flags2.isInvalid.toBoolean());
    }
  });

  it(`should convert Field(0) to Flags`, async () => {
    const flags = Flags.fromField(Field(0));
    expect(flags.isFinal.toBoolean()).toBe(false);
    expect(flags.isProved.toBoolean()).toBe(false);
    expect(flags.isValidated.toBoolean()).toBe(false);
    expect(flags.isInvalid.toBoolean()).toBe(false);
  });
});
