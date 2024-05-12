import { describe, expect, it } from "@jest/globals";
import { state, State, Field, SmartContract, method, ZkProgram } from "o1js";
import { MapTransition } from "../src/rollup/transaction";

export const MyZkProgram = ZkProgram({
  name: "MyZkProgram",
  publicInput: Field,
  publicOutput: Field,

  methods: {
    check: {
      privateInputs: [],
      async method(value: Field) {
        value.assertLessThanOrEqual(Field(100));
        return value;
      },
    },
  },
});

export class MyZkProgramProof extends ZkProgram.Proof(MyZkProgram) {}

describe("ZkProgram Raw methods", () => {
  it(`should compile`, async () => {
    console.log("Raw methods", MyZkProgram.rawMethods["check"]);
    try {
      const rawProof = await MyZkProgram.rawMethods.check(Field(50));
      console.log("Raw proof", rawProof.toJSON());
    } catch (e) {
      console.log("Error", e);
    }

    const { verificationKey } = await MyZkProgram.compile();
    const proof = await MyZkProgram.check(Field(5));
    console.log(
      "Proof",
      proof.publicInput.toJSON(),
      proof.publicOutput.toJSON()
    );
  });
});
