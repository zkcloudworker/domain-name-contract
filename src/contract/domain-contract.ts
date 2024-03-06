import {
  Field,
  state,
  State,
  method,
  SmartContract,
  DeployArgs,
  Permissions,
  Struct,
  PublicKey,
  Bool,
  Signature,
  Account,
  TokenContract,
  AccountUpdateForest,
  UInt64,
  AccountUpdate,
  VerificationKey,
  Poseidon,
} from "o1js";

import { Storage } from "./storage";
import {
  ValidatorDecisionType,
  ValidatorsVotingProof,
} from "../rollup/validators";
import { stringToFields } from "../lib/hash";

const setValidators: ValidatorDecisionType = "setValidators";
const setValidatorsField = stringToFields(setValidators)[0];

const createBlock: ValidatorDecisionType = "createBlock";
const createBlockField = stringToFields(createBlock)[0];

export class NewBlockData extends Struct({
  keys: Field,
  values: Field,
  count: Field,
}) {
  toFields() {
    return [this.keys, this.values, this.count];
  }
  hash() {
    return Poseidon.hashPacked(NewBlockData, this);
  }
}

export class BlockData extends Struct({
  newData: NewBlockData,
  root: Field,
  storage: Storage,
  address: PublicKey,
}) {
  toFields() {
    return [
      ...this.newData.toFields(),
      this.root,
      ...this.storage.toFields(),
      ...this.address.toFields(),
    ];
  }

  toState(previousBlock: PublicKey): Field[] {
    return [
      this.root,
      this.newData.hash(),
      ...previousBlock.toFields(),
      ...this.storage.toFields(),
      Bool(false).toField(),
      Bool(false).toField(),
    ];
  }
}
export class BlockEvent extends Struct({
  root: Field,
  data: BlockData,
  previousBlock: PublicKey,
}) {}

export class BlockContract extends SmartContract {
  @state(Field) root = State<Field>();
  @state(Field) blockData = State<Field>();
  @state(PublicKey) previousBlock = State<PublicKey>();
  @state(Storage) storage = State<Storage>();
  @state(Bool) isFinal = State<Bool>();
  @state(Bool) isValidated = State<Bool>();

  deploy(args: DeployArgs) {
    super.deploy(args);
    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proof(),
    });
  }

  init() {
    super.init();
  }
  @method validate() {
    this.isValidated.set(Bool(true));
  }
  @method invalidate() {
    this.isValidated.set(Bool(false));
    this.isFinal.set(Bool(true));
  }

  @method finalize() {
    const isFinal = this.isFinal.getAndRequireEquals();
    isFinal.assertEquals(Bool(false));
    const isValidated = this.isValidated.getAndRequireEquals();
    isValidated.assertEquals(Bool(true));
    this.isFinal.set(Bool(true));
  }
}

export class DomainNameContract extends TokenContract {
  @state(Field) domain = State<Field>();
  @state(Field) validators = State<Field>();
  @state(Field) validatorsHash = State<Field>();
  @state(PublicKey) lastBlock = State<PublicKey>();
  @state(PublicKey) lastProvedBlock = State<PublicKey>();

  deploy(args: DeployArgs) {
    super.deploy(args);
    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proof(),
    });
  }

  init() {
    super.init();
  }

  @method approveBase(forest: AccountUpdateForest) {
    this.checkZeroBalanceChange(forest);
  }

  // TODO: snapshot, 5 last states in token accounts, reduce updates

  events = {
    block: BlockEvent,
  };

  @method block(
    proof: ValidatorsVotingProof,
    signature: Signature,
    data: BlockData,
    verificationKey: VerificationKey
  ) {
    // TODO: verify expiry of the decision
    this.checkValidatorsDecision(proof);
    signature
      .verify(proof.publicInput.decision.address, data.toFields())
      .assertEquals(true);
    proof.publicInput.decision.decision.assertEquals(createBlockField);
    proof.publicInput.decision.data1.assertEquals(verificationKey.hash);
    proof.publicInput.decision.data2.assertEquals(
      Poseidon.hashPacked(PublicKey, data.address)
    );
    const tokenId = this.deriveTokenId();
    const account = Account(data.address, tokenId);
    const tokenBalance = account.balance.getAndRequireEquals();
    tokenBalance.assertEquals(UInt64.from(0));
    this.internal.mint({
      address: data.address,
      amount: 1_000_000_000,
    });
    const update = AccountUpdate.createSigned(data.address, tokenId);
    update.body.update.verificationKey = {
      isSome: Bool(true),
      value: verificationKey,
    };
    update.body.update.permissions = {
      isSome: Bool(true),
      value: {
        ...Permissions.default(),
        editState: Permissions.proof(),
      },
    };
    const lastBlock = this.lastBlock.getAndRequireEquals();
    const state = data.toState(lastBlock);
    update.body.update.appState = [
      { isSome: Bool(true), value: state[0] },
      { isSome: Bool(true), value: state[1] },
      { isSome: Bool(true), value: state[2] },
      { isSome: Bool(true), value: state[3] },
      { isSome: Bool(true), value: state[4] },
      { isSome: Bool(true), value: state[5] },
      { isSome: Bool(true), value: state[6] },
      { isSome: Bool(true), value: state[7] },
    ];
    const blockEvent = new BlockEvent({
      root: data.root,
      data,
      previousBlock: lastBlock,
    });
    this.lastBlock.set(data.address);
    this.emitEvent("block", blockEvent);
  }

  @method setValidators(proof: ValidatorsVotingProof) {
    this.checkValidatorsDecision(proof);
    proof.publicInput.decision.decision.assertEquals(setValidatorsField);
    this.validators.set(proof.publicInput.decision.data1);
    this.validatorsHash.set(proof.publicInput.decision.data2);
  }

  checkValidatorsDecision(proof: ValidatorsVotingProof) {
    const validators = this.validators.getAndRequireEquals();
    const validatorsHash = this.validatorsHash.getAndRequireEquals();
    proof.verify();
    proof.publicInput.hash.assertEquals(validatorsHash);
    proof.publicInput.decision.root.assertEquals(validators);
    proof.publicInput.count.assertGreaterThan(Field(1));
    proof.publicInput.decision.contract.assertEquals(this.address);
  }
}
