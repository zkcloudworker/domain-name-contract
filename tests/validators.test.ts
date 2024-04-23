import { describe, expect, it } from "@jest/globals";
//import { ValidatorsVoting } from "../src/rollup/validators";
import {
  Cache,
  ZkProgram,
  Field,
  MerkleWitness,
  Struct,
  PublicKey,
  UInt64,
  Provable,
  UInt32,
  Signature,
  Poseidon,
  SelfProof,
} from "o1js";

export const ValidatorDecisionType = {
  validate: Field(1),
  badBlock: Field(2),
  createBlock: Field(3),
  setValidators: Field(4),
};

export class ValidatorWitness extends MerkleWitness(3) {}

export class ValidatorsDecision extends Struct({
  contractAddress: PublicKey,
  chainId: Field, // chain id
  validatorsRoot: Field,
  decisionType: Field,
  expiry: UInt64, // Unix time when decision expires
  data: Provable.Array(Field, 8),
}) {
  static assertEquals(a: ValidatorsDecision, b: ValidatorsDecision) {
    a.contractAddress.assertEquals(b.contractAddress);
    a.chainId.assertEquals(b.chainId);
    a.validatorsRoot.assertEquals(b.validatorsRoot);
    a.decisionType.assertEquals(b.decisionType);
    a.expiry.assertEquals(b.expiry);
    a.data[0].assertEquals(b.data[0]);
    a.data[1].assertEquals(b.data[1]);
    a.data[2].assertEquals(b.data[2]);
    a.data[3].assertEquals(b.data[3]);
    a.data[4].assertEquals(b.data[4]);
    a.data[5].assertEquals(b.data[5]);
    a.data[6].assertEquals(b.data[6]);
    a.data[7].assertEquals(b.data[7]);
  }
}

export class ValidatorsDecisionState extends Struct({
  decision: ValidatorsDecision,
  hash: Field,
  count: UInt32,
}) {
  static vote(
    decision: ValidatorsDecision,
    validatorAddress: PublicKey,
    witness: ValidatorWitness,
    signature: Signature
  ) {
    const hash = Poseidon.hashPacked(PublicKey, validatorAddress);
    signature
      .verify(validatorAddress, ValidatorsDecision.toFields(decision))
      .assertTrue("Wrong validator signature");
    const root = witness.calculateRoot(hash);
    decision.validatorsRoot.assertEquals(root);
    return new ValidatorsDecisionState({
      decision,
      count: UInt32.from(1),
      hash,
    });
  }

  static abstain(
    decision: ValidatorsDecision,
    validatorAddress: PublicKey,
    witness: ValidatorWitness
  ) {
    const hash = Poseidon.hashPacked(PublicKey, validatorAddress);
    const root = witness.calculateRoot(hash);
    decision.validatorsRoot.assertEquals(root);
    return new ValidatorsDecisionState({
      decision,
      count: UInt32.from(1),
      hash,
    });
  }

  static merge(
    state1: ValidatorsDecisionState,
    state2: ValidatorsDecisionState
  ) {
    ValidatorsDecision.assertEquals(state1.decision, state2.decision);

    return new ValidatorsDecisionState({
      decision: state1.decision,
      count: state1.count.add(state2.count),
      hash: state1.hash.add(state2.hash),
    });
  }

  static assertEquals(a: ValidatorsDecisionState, b: ValidatorsDecisionState) {
    ValidatorsDecision.assertEquals(a.decision, b.decision);
    a.count.assertEquals(b.count);
    a.hash.assertEquals(b.hash);
  }
}

const ValidatorsVoting = ZkProgram({
  name: "ValidatorsVoting",
  publicInput: ValidatorsDecisionState,

  methods: {
    vote: {
      privateInputs: [
        ValidatorsDecision,
        PublicKey,
        ValidatorWitness,
        Signature,
      ],

      async method(
        state: ValidatorsDecisionState,
        decision: ValidatorsDecision,
        validatorAddress: PublicKey,
        witness: ValidatorWitness,
        signature: Signature
      ) {
        const calculatedState = ValidatorsDecisionState.vote(
          decision,
          validatorAddress,
          witness,
          signature
        );
        ValidatorsDecisionState.assertEquals(state, calculatedState);
      },
    },

    abstain: {
      privateInputs: [ValidatorsDecision, PublicKey, ValidatorWitness],

      async method(
        state: ValidatorsDecisionState,
        decision: ValidatorsDecision,
        validatorAddress: PublicKey,
        witness: ValidatorWitness
      ) {
        const calculatedState = ValidatorsDecisionState.abstain(
          decision,
          validatorAddress,
          witness
        );
        ValidatorsDecisionState.assertEquals(state, calculatedState);
      },
    },

    merge: {
      privateInputs: [SelfProof, SelfProof],

      async method(
        state: ValidatorsDecisionState,
        proof1: SelfProof<ValidatorsDecisionState, void>,
        proof2: SelfProof<ValidatorsDecisionState, void>
      ) {
        proof1.verify();
        proof2.verify();
        const calculatedState = ValidatorsDecisionState.merge(
          proof1.publicInput,
          proof2.publicInput
        );
        ValidatorsDecisionState.assertEquals(state, calculatedState);
      },
    },
  },
});

describe("Validators", () => {
  it(`should compile Validators`, async () => {
    console.log("Compiling Validators...");
    console.time("compiled Validators");
    const cache: Cache = Cache.FileSystem("./cache");
    await ValidatorsVoting.compile({ cache });
    console.timeEnd("compiled Validators");
  });
});
