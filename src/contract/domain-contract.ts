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
  TokenContract,
  AccountUpdateForest,
  UInt64,
  AccountUpdate,
  VerificationKey,
  MerkleMap,
  UInt32,
  Provable,
} from "o1js";
import { Storage } from "./storage";
import {
  ValidatorDecisionType,
  ValidatorsVotingProof,
} from "../rollup/validators";
import { MapUpdateProof, MapTransition } from "../rollup/transaction";
import { getNetworkIdHash } from "zkcloudworker";

export class BlockParams extends Struct({
  txsCount: UInt32,
  timeCreated: UInt64,
  isValidated: Bool,
  isFinal: Bool,
  isProved: Bool,
  isInvalid: Bool,
}) {
  pack(): Field {
    const txsCount = this.txsCount.value.toBits(32);
    const timeCreated = this.timeCreated.value.toBits(64);
    return Field.fromBits([
      ...txsCount,
      ...timeCreated,
      this.isValidated,
      this.isFinal,
      this.isProved,
      this.isInvalid,
    ]);
  }
  static unpack(packed: Field) {
    const bits = packed.toBits(32 + 64 + 4);
    const txsCount = UInt32.from(0);
    const timeCreated = UInt64.from(0);
    txsCount.value = Field.fromBits(bits.slice(0, 32));
    timeCreated.value = Field.fromBits(bits.slice(32, 96));
    return new BlockParams({
      txsCount,
      timeCreated,
      isValidated: bits[96],
      isFinal: bits[97],
      isProved: bits[98],
      isInvalid: bits[99],
    });
  }
}

export class BlockCreationData extends Struct({
  oldRoot: Field,
  verificationKeyHash: Field,
  blockAddress: PublicKey,
  blockProducer: PublicKey,
  previousBlockAddress: PublicKey,
}) {}

export class BlockValidationData extends Struct({
  storage: Storage,
  root: Field,
  txsHash: Field,
  txsCount: UInt32,
  blockAddress: PublicKey,
  notUsed: Field,
}) {}

export class BadBlockValidationData extends Struct({
  blockAddress: PublicKey,
  notUsed: Provable.Array(Field, 6),
}) {}

export class ValidatorsState extends Struct({
  root: Field,
  hash: Field,
  count: UInt32,
}) {
  static assertEquals(a: ValidatorsState, b: ValidatorsState) {
    a.root.assertEquals(b.root);
    a.hash.assertEquals(b.hash);
    a.count.assertEquals(b.count);
  }
}

export class ChangeValidatorsData extends Struct({
  new: ValidatorsState,
  old: ValidatorsState,
  storage: Storage,
}) {}

export class BlockData extends Struct({
  blockNumber: UInt64,
  root: Field,
  storage: Storage,
  previousBlockAddress: PublicKey,
  txsHash: Field,
  blockParams: Field,
  blockAddress: PublicKey,
}) {
  toState(): Field[] {
    return [
      this.blockNumber.value,
      this.root,
      ...this.storage.hashString,
      ...this.previousBlockAddress.toFields(),
      this.txsHash,
      this.blockParams,
    ];
  }
}

export class LastBlocksPacked extends Struct({
  lastBlockAddressX: Field,
  lastValidatedBlockAddressX: Field,
  lastProvedBlockAddressX: Field,
  data: Field,
}) {}

export class LastBlocks extends Struct({
  lastBlockAddress: PublicKey,
  lastValidatedBlockAddress: PublicKey,
  lastProvedBlockAddress: PublicKey,
  lastBlockNumber: UInt64,
  lastValidatedBlockNumber: UInt64,
  lastProvedBlockNumber: UInt64,
}) {
  pack(): LastBlocksPacked {
    return new LastBlocksPacked({
      lastBlockAddressX: this.lastBlockAddress.x,
      lastValidatedBlockAddressX: this.lastValidatedBlockAddress.x,
      lastProvedBlockAddressX: this.lastProvedBlockAddress.x,
      data: Field.fromBits([
        ...this.lastBlockNumber.value.toBits(64),
        ...this.lastValidatedBlockNumber.value.toBits(64),
        ...this.lastProvedBlockNumber.value.toBits(64),
        this.lastBlockAddress.isOdd,
        this.lastValidatedBlockAddress.isOdd,
        this.lastProvedBlockAddress.isOdd,
      ]),
    });
  }

  static unpack(packed: LastBlocksPacked): LastBlocks {
    const bits = packed.data.toBits(64 * 3 + 3);
    const lastBlockNumber = UInt64.from(0);
    const lastValidatedBlockNumber = UInt64.from(0);
    const lastProvedBlockNumber = UInt64.from(0);
    lastBlockNumber.value = Field.fromBits(bits.slice(0, 64));
    lastValidatedBlockNumber.value = Field.fromBits(bits.slice(64, 128));
    lastProvedBlockNumber.value = Field.fromBits(bits.slice(128, 192));
    return new LastBlocks({
      lastBlockAddress: PublicKey.from({
        x: packed.lastBlockAddressX,
        isOdd: bits[192],
      }),
      lastValidatedBlockAddress: PublicKey.from({
        x: packed.lastValidatedBlockAddressX,
        isOdd: bits[193],
      }),
      lastProvedBlockAddress: PublicKey.from({
        x: packed.lastProvedBlockAddressX,
        isOdd: bits[194],
      }),
      lastBlockNumber,
      lastValidatedBlockNumber,
      lastProvedBlockNumber,
    });
  }
}

export class BlockContract extends SmartContract {
  @state(UInt64) blockNumber = State<UInt64>();
  @state(Field) root = State<Field>();
  @state(Storage) storage = State<Storage>();
  @state(PublicKey) previousBlock = State<PublicKey>();
  @state(Field) txsHash = State<Field>();
  @state(Field) blockParams = State<Field>();

  async deploy(args: DeployArgs) {
    super.deploy(args);
    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proof(),
    });
  }

  @method.returns(UInt64)
  async validateBlock(data: BlockValidationData, tokenId: Field) {
    const params = BlockParams.unpack(this.blockParams.getAndRequireEquals());
    params.isValidated.assertEquals(Bool(false));
    params.isFinal.assertEquals(Bool(false));
    params.isProved.assertEquals(Bool(false));
    params.isInvalid.assertEquals(Bool(false));

    params.txsCount.assertEquals(data.txsCount);
    Storage.assertEquals(data.storage, this.storage.getAndRequireEquals());
    data.txsHash.assertEquals(this.txsHash.getAndRequireEquals());
    data.root.assertEquals(this.root.getAndRequireEquals());

    const previousBlockContract = new BlockContract(
      this.previousBlock.getAndRequireEquals(),
      tokenId
    );
    // TODO: add error messages for all assertions
    // TODO: change to getAndRequireEquals() after o1js bug fix https://github.com/o1-labs/o1js/issues/1245
    const previousBlockParams = BlockParams.unpack(
      previousBlockContract.blockParams.get()
    );
    previousBlockParams.isValidated
      .or(previousBlockParams.isFinal)
      .assertTrue();
    params.isValidated = Bool(true);
    this.blockParams.set(params.pack());
    return this.blockNumber.getAndRequireEquals();
  }

  @method async badBlock(tokenId: Field) {
    const previousBlockContract = new BlockContract(
      this.previousBlock.getAndRequireEquals(),
      tokenId
    );
    const previousBlockParams = BlockParams.unpack(
      // TODO: change to getAndRequireEquals() after o1js bug fix https://github.com/o1-labs/o1js/issues/1245
      previousBlockContract.blockParams.get()
    );
    previousBlockParams.isFinal.assertTrue();
    // TODO: change to getAndRequireEquals() after o1js bug fix https://github.com/o1-labs/o1js/issues/1245
    const root = previousBlockContract.root.get();
    const params = BlockParams.unpack(this.blockParams.getAndRequireEquals());
    params.isFinal.assertFalse();
    params.isValidated = Bool(false);
    params.isInvalid = Bool(true);
    params.isFinal = Bool(true);
    this.blockParams.set(params.pack());
    this.root.set(root);
  }

  @method.returns(UInt64)
  async proveBlock(data: MapTransition, tokenId: Field) {
    const params = BlockParams.unpack(this.blockParams.getAndRequireEquals());
    params.isFinal.assertFalse();
    params.isValidated.assertTrue(); // We need to make sure that IPFS data is available and correct

    const previousBlockContract = new BlockContract(
      this.previousBlock.getAndRequireEquals(),
      tokenId
    );
    const oldRoot = previousBlockContract.root.get(); // TODO: change to getAndRequireEquals() after o1js bug fix https://github.com/o1-labs/o1js/issues/1245
    oldRoot.assertEquals(data.oldRoot);
    data.newRoot.assertEquals(this.root.getAndRequireEquals());
    const previousBlockParams = BlockParams.unpack(
      // TODO: change to getAndRequireEquals() after o1js bug fix https://github.com/o1-labs/o1js/issues/1245
      previousBlockContract.blockParams.get()
    );
    previousBlockParams.isFinal.assertTrue();
    data.hash.assertEquals(this.txsHash.getAndRequireEquals());
    data.count.assertEquals(params.txsCount);
    params.isProved = Bool(true);
    params.isFinal = Bool(true);
    this.blockParams.set(params.pack());
    return this.blockNumber.getAndRequireEquals();
  }
}

export class DomainNameContract extends TokenContract {
  @state(Field) domain = State<Field>();
  @state(ValidatorsState) validators = State<ValidatorsState>();
  @state(LastBlocksPacked) blocks = State<LastBlocksPacked>();

  async deploy(args: DeployArgs) {
    super.deploy(args);
    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proof(),
    });
  }

  init() {
    super.init();
    this.blocks.set(
      new LastBlocks({
        lastBlockAddress: PublicKey.empty(),
        lastValidatedBlockAddress: PublicKey.empty(),
        lastProvedBlockAddress: PublicKey.empty(),
        lastBlockNumber: UInt64.from(0),
        lastValidatedBlockNumber: UInt64.from(0),
        lastProvedBlockNumber: UInt64.from(0),
      }).pack()
    );
  }

  async approveBase(forest: AccountUpdateForest) {
    // https://discord.com/channels/484437221055922177/1215258350577647616
    // this.checkZeroBalanceChange(forest);
    //forest.isEmpty().assertEquals(Bool(true));
    throw Error("transfers are not allowed");
  }

  events = {
    newBlock: BlockData,
    validatedBlock: PublicKey,
    provedBlock: PublicKey,
    setValidators: ChangeValidatorsData,
  };

  @method async block(
    proof: ValidatorsVotingProof,
    data: BlockData,
    verificationKey: VerificationKey
  ) {
    this.checkValidatorsDecision(proof);
    const tokenId = this.deriveTokenId();
    const blockProducer = this.sender.getAndRequireSignature();
    proof.publicInput.decision.decisionType.assertEquals(
      ValidatorDecisionType.createBlock
    );
    const decision = BlockCreationData.fromFields(
      proof.publicInput.decision.data
    );
    decision.verificationKeyHash.assertEquals(verificationKey.hash);
    decision.blockAddress.assertEquals(data.blockAddress);
    decision.blockProducer.assertEquals(blockProducer);
    decision.previousBlockAddress.assertEquals(data.previousBlockAddress);
    const blocks = LastBlocks.unpack(this.blocks.getAndRequireEquals());
    blocks.lastBlockAddress.equals(PublicKey.empty()).assertFalse();
    data.previousBlockAddress.assertEquals(blocks.lastBlockAddress);
    data.blockNumber.assertEquals(blocks.lastBlockNumber.add(UInt64.from(1)));
    const previousBlock = new BlockContract(blocks.lastBlockAddress, tokenId);
    const oldRoot = previousBlock.root.get(); // TODO: change to getAndRequireEquals() after o1js bug fix https://github.com/o1-labs/o1js/issues/1245
    decision.oldRoot.assertEquals(oldRoot);
    const blockNumber = previousBlock.blockNumber.get().add(UInt64.from(1));
    blockNumber.assertEquals(data.blockNumber);
    const previousBlockParams = BlockParams.unpack(
      previousBlock.blockParams.get()
    );
    const blockParams = BlockParams.unpack(data.blockParams);
    previousBlockParams.timeCreated.assertLessThan(blockParams.timeCreated);
    AccountUpdate.create(data.blockAddress, tokenId)
      .account.balance.getAndRequireEquals()
      .assertEquals(UInt64.from(0));
    this.internal.mint({
      address: data.blockAddress,
      amount: 1_000_000_000,
    });
    const update = AccountUpdate.createSigned(data.blockAddress, tokenId);
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
    const state = data.toState();
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
    this.emitEvent("newBlock", data);
    blocks.lastBlockAddress = data.blockAddress;
    blocks.lastBlockNumber = data.blockNumber;
    this.blocks.set(blocks.pack());
  }

  @method async blockZero(publicKey: PublicKey, timeCreated: UInt64) {
    // TODO: check timeCreated
    const blocks = LastBlocks.unpack(this.blocks.getAndRequireEquals());
    blocks.lastBlockAddress.equals(PublicKey.empty()).assertTrue();
    const tokenId = this.deriveTokenId();
    this.internal.mint({
      address: publicKey,
      amount: 1_000_000_000,
    });
    const update = AccountUpdate.createSigned(publicKey, tokenId);
    const data: BlockData = new BlockData({
      blockNumber: UInt64.from(0),
      root: new MerkleMap().getRoot(),
      storage: Storage.empty(),
      previousBlockAddress: PublicKey.empty(),
      txsHash: Field(0),
      blockParams: new BlockParams({
        txsCount: UInt32.from(0),
        timeCreated,
        isValidated: Bool(true),
        isFinal: Bool(true),
        isProved: Bool(true),
        isInvalid: Bool(false),
      }).pack(),
      blockAddress: publicKey,
    });
    const state = data.toState();
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
    this.blocks.set(
      new LastBlocks({
        lastBlockAddress: publicKey,
        lastValidatedBlockAddress: publicKey,
        lastProvedBlockAddress: publicKey,
        lastBlockNumber: UInt64.from(0),
        lastValidatedBlockNumber: UInt64.from(0),
        lastProvedBlockNumber: UInt64.from(0),
      }).pack()
    );
    this.emitEvent("newBlock", data);
  }

  @method async validateBlock(proof: ValidatorsVotingProof) {
    this.checkValidatorsDecision(proof);
    proof.publicInput.decision.decisionType.assertEquals(
      ValidatorDecisionType.validate
    );
    const tokenId = this.deriveTokenId();
    const data = BlockValidationData.fromFields(
      proof.publicInput.decision.data
    );
    const block = new BlockContract(data.blockAddress, tokenId);
    const blockNumber = await block.validateBlock(data, tokenId);
    const blocks = LastBlocks.unpack(this.blocks.getAndRequireEquals());
    blocks.lastValidatedBlockAddress = data.blockAddress;
    blocks.lastValidatedBlockNumber = blockNumber;
    this.blocks.set(blocks.pack());
    this.emitEvent("validatedBlock", data.blockAddress);
  }

  @method async proveBlock(proof: MapUpdateProof, blockAddress: PublicKey) {
    proof.verify();
    await this.internalProveBlock(proof.publicInput, blockAddress);
  }

  // TODO: remove after testing
  @method async proveBlockProofsOff(
    transition: MapTransition,
    blockAddress: PublicKey
  ) {
    await this.internalProveBlock(transition, blockAddress);
  }

  private async internalProveBlock(
    transition: MapTransition,
    blockAddress: PublicKey
  ) {
    // TODO: return back after o1js bug fix https://github.com/o1-labs/o1js/issues/1588
    // and use this.network.timestamp.requireBetween()
    //const timestamp = this.network.timestamp.getAndRequireEquals();
    //Provable.log("proveBlock time", timestamp);
    //timestamp.assertGreaterThan(proof.publicInput.time);

    const tokenId = this.deriveTokenId();
    const block = new BlockContract(blockAddress, tokenId);
    const blockNumber = await block.proveBlock(transition, tokenId);
    const blocks = LastBlocks.unpack(this.blocks.getAndRequireEquals());
    blocks.lastProvedBlockAddress = blockAddress;
    blocks.lastProvedBlockNumber = blockNumber;
    this.blocks.set(blocks.pack());
  }

  @method async badBlock(proof: ValidatorsVotingProof) {
    this.checkValidatorsDecision(proof);
    proof.publicInput.decision.decisionType.assertEquals(
      ValidatorDecisionType.badBlock
    );
    const data: BadBlockValidationData = BadBlockValidationData.fromFields(
      proof.publicInput.decision.data
    );
    const tokenId = this.deriveTokenId();
    const block = new BlockContract(data.blockAddress, tokenId);
    await block.badBlock(tokenId);
  }

  @method async setValidators(proof: ValidatorsVotingProof) {
    this.checkValidatorsDecision(proof);
    proof.publicInput.decision.decisionType.assertEquals(
      ValidatorDecisionType.setValidators
    );
    const old = this.validators.getAndRequireEquals();
    const data = ChangeValidatorsData.fromFields(
      proof.publicInput.decision.data
    );
    ValidatorsState.assertEquals(data.old, old);
    proof.publicInput.count.assertGreaterThan(old.count.mul(UInt32.from(2)));
    this.validators.set(data.new);
    this.emitEvent("setValidators", data);
  }

  checkValidatorsDecision(proof: ValidatorsVotingProof) {
    // see https://discord.com/channels/484437221055922177/1215291691364524072
    proof.publicInput.decision.chainId.assertEquals(getNetworkIdHash());
    // TODO: return back after o1js bug fix https://github.com/o1-labs/o1js/issues/1588
    // and use this.network.timestamp.requireBetween()
    //const timestamp = this.network.timestamp.getAndRequireEquals();
    //timestamp.assertLessThan(proof.publicInput.decision.expiry);
    const validators = this.validators.getAndRequireEquals();
    proof.verify();
    proof.publicInput.hash.assertEquals(validators.hash);
    proof.publicInput.decision.validatorsRoot.assertEquals(validators.root);
    proof.publicInput.count.assertGreaterThan(validators.count);
    proof.publicInput.decision.contractAddress.assertEquals(this.address);
  }
}
