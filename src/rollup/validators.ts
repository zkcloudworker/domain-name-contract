import { MerkleWitness } from "../lib/merkle-tree";
import {
  Struct,
  Field,
  PublicKey,
  Signature,
  ZkProgram,
  Bool,
  Poseidon,
  SelfProof,
  VerificationKey,
  UInt64,
} from "o1js";
import { stringToFields } from "../lib/hash";
import { Storage } from "../contract/storage";

export const ValidatorDecisionType = {
  validate: stringToFields("validate")[0],
  badBlock: stringToFields("badBlock")[0],
  createBlock: stringToFields("createBlock")[0],
  setValidators: stringToFields("setValidators")[0],
};

export class ValidatorWitness extends MerkleWitness(3) {}

export class ValidatorDecisionExtraData extends Struct({
  data: [Field, Field, Field],
}) {
  public convertToFields(): Field[] {
    return this.data;
  }
  static fromBlockCreationData(params: {
    verificationKey: VerificationKey;
    blockPublicKey: PublicKey;
    oldRoot: Field;
  }) {
    const { verificationKey, blockPublicKey, oldRoot } = params;
    return new ValidatorDecisionExtraData({
      data: [
        verificationKey.hash,
        Poseidon.hashPacked(PublicKey, blockPublicKey),
        oldRoot,
      ],
    });
  }

  verifyBlockCreationData(params: {
    verificationKey: VerificationKey;
    blockPublicKey: PublicKey;
    oldRoot: Field;
  }) {
    const { verificationKey, blockPublicKey, oldRoot } = params;
    this.data[0].assertEquals(verificationKey.hash);
    this.data[1].assertEquals(Poseidon.hashPacked(PublicKey, blockPublicKey));
    this.data[2].assertEquals(oldRoot);
  }

  static fromBlockValidationData(params: {
    storage: Storage;
    txs: Field;
    root: Field;
  }) {
    const { storage, txs, root } = params;
    return new ValidatorDecisionExtraData({
      data: [root, txs, Poseidon.hashPacked(Storage, storage)],
    });
  }

  verifyBlockValidationData(params: {
    storage: Storage;
    hash: Field;
    root: Field;
  }) {
    const { storage, hash, root } = params;
    this.data[0].assertEquals(root);
    this.data[1].assertEquals(hash);
    this.data[2].assertEquals(Poseidon.hashPacked(Storage, storage));
  }

  static fromSetValidatorsData(params: {
    root: Field;
    hash: Field;
    oldRoot: Field;
  }) {
    const { root, hash, oldRoot } = params;
    return new ValidatorDecisionExtraData({
      data: [root, hash, oldRoot],
    });
  }

  verifySetValidatorsData(params: { oldRoot: Field }) {
    this.data[2].assertEquals(params.oldRoot);
    return { root: this.data[0], hash: this.data[1] };
  }

  static assertEquals(
    a: ValidatorDecisionExtraData,
    b: ValidatorDecisionExtraData
  ) {
    a.data[0].assertEquals(b.data[0]);
    a.data[1].assertEquals(b.data[1]);
    a.data[2].assertEquals(b.data[2]);
  }
}

export class ValidatorsDecision extends Struct({
  contract: PublicKey,
  chainId: Field, // chain id
  root: Field,
  decision: Field,
  address: PublicKey,
  data: ValidatorDecisionExtraData,
  expiry: UInt64, // Unix time when decision expires
}) {
  public convertToFields() {
    return [
      ...this.contract.toFields(),
      this.chainId,
      this.root,
      this.decision,
      ...this.address.toFields(),
      ...this.data.convertToFields(),
      ...this.expiry.toFields(),
    ];
  }

  static assertEquals(a: ValidatorsDecision, b: ValidatorsDecision) {
    a.contract.assertEquals(b.contract);
    a.root.assertEquals(b.root);
    a.decision.assertEquals(b.decision);
    a.address.assertEquals(b.address);
    ValidatorDecisionExtraData.assertEquals(a.data, b.data);
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
      .verify(validatorAddress, decision.convertToFields())
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
