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
import { getNetworkIdHash } from "zkcloudworker";
import { Storage } from "./storage";
import {
  ValidatorDecisionExtraData,
  ValidatorDecisionType,
  ValidatorsVotingProof,
} from "../rollup/validators";
import { MapUpdateProof, MapTransition } from "../rollup/transaction";

export class NewBlockTransactions extends Struct({
  value: Field, // sum of the hashes of all transactions
  count: Field, // number of transactions
}) {
  hash() {
    return Poseidon.hashPacked(NewBlockTransactions, this);
  }
}
const a = new NewBlockTransactions({ value: Field(1), count: Field(2) });

export class Flags extends Struct({
  isValidated: Bool,
  isProved: Bool,
  isFinal: Bool,
  isInvalid: Bool,
}) {
  toField(): Field {
    return Field.fromBits([
      this.isValidated,
      this.isProved,
      this.isFinal,
      this.isInvalid,
    ]);
  }
  static fromField(f: Field) {
    const bits = f.toBits(4);
    return new Flags({
      isValidated: bits[0],
      isProved: bits[1],
      isFinal: bits[2],
      isInvalid: bits[3],
    });
  }
}
export class BlockData extends Struct({
  root: Field,
  txs: NewBlockTransactions,
  storage: Storage,
  address: PublicKey,
  blockNumber: Field,
  isValidated: Bool,
  isFinal: Bool,
  isProved: Bool,
  isInvalid: Bool,
}) {
  toState(previousBlock: PublicKey): Field[] {
    return [
      this.root,
      this.txs.hash(),
      ...previousBlock.toFields(),
      ...Storage.toFields(this.storage),
      new Flags({
        isValidated: this.isValidated,
        isProved: this.isProved,
        isFinal: this.isFinal,
        isInvalid: this.isInvalid,
      }).toField(),
      this.blockNumber,
    ];
  }
}
export class NewBlockEvent extends Struct({
  root: Field,
  address: PublicKey,
  storage: Storage,
  txs: NewBlockTransactions,
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
  @state(Field) txs = State<Field>();
  @state(PublicKey) previousBlock = State<PublicKey>();
  @state(Storage) storage = State<Storage>();
  @state(Field) flags = State<Field>();
  @state(Field) blockNumber = State<Field>();
  // TODO: pack Bool vars into one Field and add block number, add more statuses

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
      hash: this.txs.getAndRequireEquals(),
      storage: this.storage.getAndRequireEquals(),
      root: this.root.getAndRequireEquals(),
    });
    const previousBlockContract = new BlockContract(
      this.previousBlock.getAndRequireEquals(),
      tokenId
    );
    // TODO: add error messages for all assertions
    const previousFlags = Flags.fromField(previousBlockContract.flags.get()); // TODO: change to getAndRequireEquals() after o1js bug fix https://github.com/o1-labs/o1js/issues/1245
    const isValidatedOrFinal = previousFlags.isValidated.or(
      previousFlags.isFinal
    );
    isValidatedOrFinal.assertEquals(Bool(true));
    const flags = Flags.fromField(this.flags.getAndRequireEquals());
    flags.isValidated = Bool(true);
    this.flags.set(flags.toField());
  }

  @method badBlock(tokenId: Field) {
    const previousBlockContract = new BlockContract(
      this.previousBlock.getAndRequireEquals(),
      tokenId
    );
    const previousFlags = Flags.fromField(previousBlockContract.flags.get()); // TODO: change to getAndRequireEquals() after o1js bug fix https://github.com/o1-labs/o1js/issues/1245
    previousFlags.isFinal.assertEquals(Bool(true));
    const root = previousBlockContract.root.get();
    const flags = Flags.fromField(this.flags.getAndRequireEquals());
    flags.isValidated = Bool(false);
    flags.isInvalid = Bool(true);
    flags.isFinal = Bool(true);
    this.flags.set(flags.toField());
    this.root.set(root);
  }

  @method proveBlock(data: MapTransition, tokenId: Field) {
    const flags = Flags.fromField(this.flags.getAndRequireEquals());
    flags.isFinal.assertEquals(Bool(false));
    flags.isValidated.assertEquals(Bool(true)); // We need to make sure that IPFS data is available and correct

    const previousBlockContract = new BlockContract(
      this.previousBlock.getAndRequireEquals(),
      tokenId
    );
    const oldRoot = previousBlockContract.root.get(); // TODO: change to getAndRequireEquals() after o1js bug fix https://github.com/o1-labs/o1js/issues/1245
    oldRoot.assertEquals(data.oldRoot);
    data.newRoot.assertEquals(this.root.getAndRequireEquals());
    const previousFlags = Flags.fromField(previousBlockContract.flags.get()); // TODO: change to getAndRequireEquals() after o1js bug fix
    previousFlags.isFinal.assertEquals(Bool(true));
    const txs: NewBlockTransactions = new NewBlockTransactions({
      value: data.hash,
      count: data.count,
    });
    txs.hash().assertEquals(this.txs.getAndRequireEquals());
    flags.isProved = Bool(true);
    flags.isFinal = Bool(true);
    this.flags.set(flags.toField());
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

  approveBase(forest: AccountUpdateForest) {
    // https://discord.com/channels/484437221055922177/1215258350577647616
    // this.checkZeroBalanceChange(forest);
    //forest.isEmpty().assertEquals(Bool(true));
    throw Error("transfers are not allowed");
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
      .verify(proof.publicInput.decision.address, BlockData.toFields(data))
      .assertEquals(true);
    proof.publicInput.decision.decision.assertEquals(
      ValidatorDecisionType.createBlock
    );
    const lastBlock = this.lastBlock.getAndRequireEquals();
    lastBlock.equals(PublicKey.empty()).assertEquals(Bool(false));
    const previousBlock = new BlockContract(lastBlock, tokenId);
    const oldRoot = previousBlock.root.get(); // TODO: change to getAndRequireEquals() after o1js bug fix https://github.com/o1-labs/o1js/issues/1245
    proof.publicInput.decision.data.verifyBlockCreationData({
      verificationKey,
      blockPublicKey: data.address,
      oldRoot,
    });
    const blockNumber = previousBlock.blockNumber.get().add(Field(1));
    blockNumber.assertEquals(data.blockNumber);

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
      txs: data.txs,
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
      {
        isSome: Bool(true),
        value: new Flags({
          isValidated: Bool(true),
          isProved: Bool(true),
          isFinal: Bool(true),
          isInvalid: Bool(false),
        }).toField(),
      },
      { isSome: Bool(true), value: Field(0) },
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

  @method proveBlock(proof: MapUpdateProof, blockAddress: PublicKey) {
    const timestamp = this.network.timestamp.getAndRequireEquals();
    //Provable.log("proveBlock time", timestamp);
    timestamp.assertGreaterThan(proof.publicInput.time);
    proof.verify();
    const tokenId = this.deriveTokenId();
    const block = new BlockContract(blockAddress, tokenId);
    //block.proveBlock(proof.publicInput, tokenId);
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
    // see https://discord.com/channels/484437221055922177/1215291691364524072
    const id = getNetworkIdHash();
    proof.publicInput.decision.chainId.assertEquals(id);
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
