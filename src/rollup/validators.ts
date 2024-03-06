import { p } from "o1js/dist/node/bindings/crypto/finite-field";
import { MerkleTree, MerkleWitness } from "../lib/merkle-tree";
import {
  Struct,
  Field,
  PublicKey,
  Signature,
  ZkProgram,
  Bool,
  Poseidon,
  SelfProof,
} from "o1js";

export type ValidatorDecisionType =
  | "validate"
  | "badBlock"
  | "createBlock"
  | "setValidators";

export class ValidatorWitness extends MerkleWitness(3) {}

export class ValidatorsDecision extends Struct({
  contract: PublicKey,
  root: Field,
  decision: Field,
  address: PublicKey,
  data1: Field,
  data2: Field,
}) {
  public toFields() {
    return [
      ...this.contract.toFields(),
      this.root,
      this.decision,
      ...this.address.toFields(),
      this.data1,
      this.data2,
    ];
  }

  static assertEquals(a: ValidatorsDecision, b: ValidatorsDecision) {
    a.contract.assertEquals(b.contract);
    a.root.assertEquals(b.root);
    a.decision.assertEquals(b.decision);
    a.address.assertEquals(b.address);
    a.data1.assertEquals(b.data1);
    a.data2.assertEquals(b.data2);
  }
}

export class ValidatorsDecisionState extends Struct({
  decision: ValidatorsDecision,
  count: Field,
  hash: Field,
}) {
  static vote(
    decision: ValidatorsDecision,
    validatorAddress: PublicKey,
    witness: ValidatorWitness,
    signature: Signature
  ) {
    const hash = Poseidon.hashPacked(PublicKey, validatorAddress);
    signature
      .verify(validatorAddress, decision.toFields())
      .assertEquals(Bool(true));
    const root = witness.calculateRoot(hash);
    decision.root.assertEquals(root);
    return new ValidatorsDecisionState({
      decision,
      count: Field(1),
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
    decision.root.assertEquals(root);
    return new ValidatorsDecisionState({
      decision,
      count: Field(0),
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

export const ValidatorsVoting = ZkProgram({
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

      method(
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

      method(
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

      method(
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

export class ValidatorsVotingProof extends ZkProgram.Proof(ValidatorsVoting) {}
