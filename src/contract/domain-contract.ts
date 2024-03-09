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
  MerkleMap,
} from "o1js";
import { chainId } from "../rollup/chainid";
import { Storage } from "./storage";
import {
  ValidatorDecisionExtraData,
  ValidatorDecisionType,
  ValidatorsVotingProof,
} from "../rollup/validators";

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
export class NewBlockEvent extends Struct({
  root: Field,
  address: PublicKey,
  storage: Storage,
  newData: NewBlockData,
  previousBlock: PublicKey,
}) {}

export class ValidatedBlockEvent extends Struct({
  root: Field,
  address: PublicKey,
  storage: Storage,
}) {}

export class ProvedBlockEvent extends Struct({
  root: Field,
  address: PublicKey,
  storage: Storage,
}) {}

export class SetValidatorsEvent extends Struct({
  root: Field,
  address: PublicKey,
  storage: Storage,
}) {}

export class FirstBlockEvent extends Struct({
  root: Field,
  address: PublicKey,
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
  @method validateBlock(data: ValidatorDecisionExtraData, tokenId: Field) {
    data.verifyBlockValidationData({
      hash: this.blockData.getAndRequireEquals(),
      storage: this.storage.getAndRequireEquals(),
      root: this.root.getAndRequireEquals(),
    });
    const block = new BlockContract(
      this.previousBlock.getAndRequireEquals(),
      tokenId
    );
    // TODO: add error messages for all assertions
    const isValidatedOrFinal = block.isValidated
      .get() // TODO: change to getAndRequireEquals() after o1js bug fix https://github.com/o1-labs/o1js/issues/1245
      .or(block.isFinal.get()); // TODO: change to getAndRequireEquals() after o1js bug fix https://github.com/o1-labs/o1js/issues/1245
    isValidatedOrFinal.assertEquals(Bool(true));
    this.isValidated.set(Bool(true));
  }

  @method badBlock(tokenId: Field) {
    const block = new BlockContract(
      this.previousBlock.getAndRequireEquals(),
      tokenId
    );
    const root = block.root.getAndRequireEquals();
    this.isValidated.set(Bool(false));
    this.isFinal.set(Bool(true));
    this.root.set(root);
  }

  @method proveBlock() {
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
  @state(Field) validatorsRequired = State<Field>();
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
    this.lastBlock.set(PublicKey.empty());
    this.lastProvedBlock.set(PublicKey.empty());
  }

  @method approveBase(forest: AccountUpdateForest) {
    // https://discord.com/channels/484437221055922177/1215258350577647616
    // this.checkZeroBalanceChange(forest);
    forest.isEmpty().assertEquals(Bool(true));
  }

  events = {
    firstBlock: FirstBlockEvent,
    newBlock: NewBlockEvent,
    validatedBlock: ValidatedBlockEvent,
    provedBlock: ProvedBlockEvent,
    setValidators: SetValidatorsEvent,
  };

  @method block(
    proof: ValidatorsVotingProof,
    signature: Signature,
    data: BlockData,
    verificationKey: VerificationKey
  ) {
    this.checkValidatorsDecision(proof);
    const tokenId = this.deriveTokenId();
    signature
      .verify(proof.publicInput.decision.address, data.toFields())
      .assertEquals(true);
    proof.publicInput.decision.decision.assertEquals(
      ValidatorDecisionType.createBlock
    );
    const lastBlock = this.lastBlock.getAndRequireEquals();
    lastBlock.equals(PublicKey.empty()).assertEquals(Bool(false));
    const block = new BlockContract(lastBlock, tokenId);
    const oldRoot = block.root.get(); // TODO: change to getAndRequireEquals() after o1js bug fix https://github.com/o1-labs/o1js/issues/1245
    proof.publicInput.decision.data.verifyBlockCreationData({
      verificationKey,
      blockPublicKey: data.address,
      oldRoot,
    });

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
    const blockEvent = new NewBlockEvent({
      root: data.root,
      address: data.address,
      storage: data.storage,
      newData: data.newData,
      previousBlock: lastBlock,
    });
    this.emitEvent("newBlock", blockEvent);
    this.lastBlock.set(data.address);
  }

  @method firstBlock(publicKey: PublicKey) {
    const lastBlock = this.lastBlock.getAndRequireEquals();
    lastBlock.equals(PublicKey.empty()).assertEquals(Bool(true));
    const tokenId = this.deriveTokenId();
    this.internal.mint({
      address: publicKey,
      amount: 1_000_000_000,
    });
    const root = new MerkleMap().getRoot();
    const update = AccountUpdate.createSigned(publicKey, tokenId);
    update.body.update.appState = [
      { isSome: Bool(true), value: root },
      { isSome: Bool(true), value: Field(0) },
      { isSome: Bool(true), value: Field(0) },
      { isSome: Bool(true), value: Field(0) },
      { isSome: Bool(true), value: Field(0) },
      { isSome: Bool(true), value: Field(0) },
      { isSome: Bool(true), value: Bool(true).toField() },
      { isSome: Bool(true), value: Bool(true).toField() },
    ];
    this.lastBlock.set(publicKey);
    this.emitEvent(
      "firstBlock",
      new FirstBlockEvent({ root, address: publicKey })
    );
  }

  @method validateBlock(proof: ValidatorsVotingProof) {
    this.checkValidatorsDecision(proof);
    proof.publicInput.decision.decision.assertEquals(
      ValidatorDecisionType.validate
    );
    const tokenId = this.deriveTokenId();
    const block = new BlockContract(
      proof.publicInput.decision.address,
      tokenId
    );
    block.validateBlock(proof.publicInput.decision.data, tokenId);
  }

  @method badBlock(proof: ValidatorsVotingProof) {
    this.checkValidatorsDecision(proof);
    proof.publicInput.decision.decision.assertEquals(
      ValidatorDecisionType.badBlock
    );
    const tokenId = this.deriveTokenId();
    const block = new BlockContract(
      proof.publicInput.decision.address,
      tokenId
    );
    block.badBlock(tokenId);
  }

  @method setValidators(proof: ValidatorsVotingProof) {
    this.checkValidatorsDecision(proof);
    proof.publicInput.decision.decision.assertEquals(
      ValidatorDecisionType.setValidators
    );
    const oldRoot = this.validators.getAndRequireEquals();
    const { root, hash } =
      proof.publicInput.decision.data.verifySetValidatorsData({ oldRoot });
    const validatorsRequired = this.validatorsRequired.getAndRequireEquals();
    proof.publicInput.count.assertGreaterThan(validatorsRequired.mul(Field(2)));
    this.validators.set(root);
    this.validatorsHash.set(hash);
  }

  checkValidatorsDecision(proof: ValidatorsVotingProof) {
    // TODO: change chainId.berkeley to chainId.mainnet when deploying to mainnet
    // see https://discord.com/channels/484437221055922177/1215291691364524072
    proof.publicInput.decision.chainId.assertEquals(chainId.berkeley);
    const timestamp = this.network.timestamp.getAndRequireEquals();
    timestamp.assertLessThan(proof.publicInput.decision.expiry);
    const validators = this.validators.getAndRequireEquals();
    const validatorsHash = this.validatorsHash.getAndRequireEquals();
    proof.verify();
    proof.publicInput.hash.assertEquals(validatorsHash);
    proof.publicInput.decision.root.assertEquals(validators);
    const validatorsRequired = this.validatorsRequired.getAndRequireEquals();
    proof.publicInput.count.assertGreaterThan(validatorsRequired);
    proof.publicInput.decision.contract.assertEquals(this.address);
  }
}
