import {
  zkCloudWorker,
  Cloud,
  fee,
  DeployedSmartContract,
  fetchMinaAccount,
  sleep,
  getNetworkIdHash,
  CloudTransaction,
  makeString,
  accountBalanceMina,
} from "zkcloudworker";
import os from "os";
import assert from "node:assert/strict";
import {
  verify,
  JsonProof,
  VerificationKey,
  Field,
  PublicKey,
  Mina,
  PrivateKey,
  AccountUpdate,
  UInt64,
  Bool,
  Signature,
  MerkleMap,
  Encoding,
} from "o1js";
import {
  MapTransition,
  MapUpdate,
  MapUpdateData,
  MapUpdateProof,
  DomainTransactionData,
  DomainName,
  DomainTransaction,
  DomainTransactionEnum,
  DomainNameValue,
  DomainSerializedTransaction,
  DomainCloudTransaction,
  DomainCloudTransactionData,
} from "./rollup/transaction";
import { Storage } from "./contract/storage";
import { deserializeFields, serializeFields } from "./lib/fields";
import {
  ValidatorsDecision,
  ValidatorsVoting,
  ValidatorsVotingProof,
  ValidatorDecisionType,
} from "./rollup/validators";
import {
  DomainNameContract,
  BlockContract,
  BlockData,
  BlockParams,
  BlockCreationData,
  BlockValidationData,
  BadBlockValidationData,
  LastBlocks,
} from "./contract/domain-contract";
import { calculateValidatorsProof } from "./rollup/validators-proof";
import { createBlock } from "./rollup/blocks";
import { treeFromJSON, treeToJSON } from "./lib/map-json";
import { DomainDatabase } from "./rollup/database";
import { saveToIPFS, loadFromIPFS } from "./contract/storage";
import { blockProducer } from "./config";
import { stringToFields } from "./lib/hash";
import { Metadata } from "./contract/metadata";

const fullValidation = true;
const waitTx = true;
const proofsOff = false as boolean;

export class DomainNameServiceWorker extends zkCloudWorker {
  static mapUpdateVerificationKey: VerificationKey | undefined = undefined;
  static contractVerificationKey: VerificationKey | undefined = undefined;
  static blockContractVerificationKey: VerificationKey | undefined = undefined;
  static validatorsVerificationKey: VerificationKey | undefined = undefined;
  readonly MIN_TIME_BETWEEN_BLOCKS = 1000 * 60 * 10; // 20 minutes
  readonly MIN_TRANSACTIONS = 2;
  readonly MAX_TRANSACTIONS = 4;

  constructor(cloud: Cloud) {
    super(cloud);
  }
  public async deployedContracts(): Promise<DeployedSmartContract[]> {
    throw new Error("not implemented");
  }

  private async compile(compileSmartContracts: boolean = true): Promise<void> {
    const cpuCores = os.cpus();
    const numberOfCPUCores = cpuCores.length;
    console.log("CPU cores:", numberOfCPUCores);
    console.time("compiled");
    if (DomainNameServiceWorker.mapUpdateVerificationKey === undefined) {
      console.time("compiled MapUpdate");
      DomainNameServiceWorker.mapUpdateVerificationKey = (
        await MapUpdate.compile({
          cache: this.cloud.cache,
        })
      ).verificationKey;
      console.timeEnd("compiled MapUpdate");
    }

    if (compileSmartContracts === false) {
      console.timeEnd("compiled");
      return;
    }

    if (DomainNameServiceWorker.blockContractVerificationKey === undefined) {
      console.time("compiled BlockContract");
      DomainNameServiceWorker.blockContractVerificationKey = (
        await BlockContract.compile({
          cache: this.cloud.cache,
        })
      ).verificationKey;
      console.timeEnd("compiled BlockContract");
    }
    if (DomainNameServiceWorker.validatorsVerificationKey === undefined) {
      console.time("compiled ValidatorsVoting");
      DomainNameServiceWorker.validatorsVerificationKey = (
        await ValidatorsVoting.compile({
          cache: this.cloud.cache,
        })
      ).verificationKey;
      console.timeEnd("compiled ValidatorsVoting");
    }

    if (DomainNameServiceWorker.contractVerificationKey === undefined) {
      console.time("compiled DomainNameContract");
      DomainNameServiceWorker.contractVerificationKey = (
        await DomainNameContract.compile({
          cache: this.cloud.cache,
        })
      ).verificationKey;
      console.timeEnd("compiled DomainNameContract");
    }
    console.timeEnd("compiled");
  }

  public async create(transaction: string): Promise<string | undefined> {
    console.time("proof created");
    const args = JSON.parse(transaction);
    if (proofsOff === false) {
      const state: MapTransition = MapTransition.fromFields(
        deserializeFields(args.state)
      ) as MapTransition;
      // TODO: handle all operations
      const isAccepted = args.isAccepted;
      const updateType = args.type;
      const signature = args.signature
        ? (Signature.fromBase58(args.signature) as Signature)
        : undefined;
      const oldDomain = args.oldDomain
        ? (DomainName.fromFields(
            deserializeFields(args.oldDomain)
          ) as DomainName)
        : undefined;
      const oldRoot = args.oldRoot ? Field.fromJSON(args.oldRoot) : undefined;
      const time = args.time ? UInt64.from(BigInt(args.time)) : undefined;
      const tx = args.tx
        ? (DomainTransaction.fromFields(
            deserializeFields(args.tx)
          ) as DomainTransaction)
        : undefined;

      if (isAccepted === undefined) throw new Error("isAccepted is undefined");
      if (updateType === undefined) throw new Error("updateType is undefined");
      if (
        updateType !== "add" &&
        updateType !== "remove" &&
        updateType !== "update" &&
        updateType !== "extend"
      )
        throw new Error("updateType is invalid");

      if (
        updateType === "update" &&
        (oldDomain === undefined || signature === undefined)
      )
        throw new Error("oldDomain or signature is undefined");
      if (updateType === "extend" && oldDomain === undefined)
        throw new Error("oldDomain is undefined");
      if (
        isAccepted === false &&
        (time === undefined || tx === undefined || oldRoot === undefined)
      )
        throw new Error("time, tx or oldRoot is undefined");

      await this.compile(false);
      if (DomainNameServiceWorker.mapUpdateVerificationKey === undefined)
        throw new Error("verificationKey is undefined");

      let proof: MapUpdateProof;
      if (isAccepted === true) {
        const update: MapUpdateData = MapUpdateData.fromFields(
          deserializeFields(args.update)
        ) as MapUpdateData;
        if (update === undefined) throw new Error("update is undefined");
        if (updateType === undefined)
          throw new Error("updateType is undefined");
        if (updateType === "add") {
          proof = await MapUpdate.add(state, update);
        } else if (updateType === "remove") {
          proof = await MapUpdate.remove(state, update);
        } else if (updateType === "update") {
          if (update === undefined) throw new Error("update is undefined");
          if (oldDomain === undefined)
            throw new Error("oldDomain is undefined");
          if (signature === undefined)
            throw new Error("signature is undefined");
          const txSignature: Signature = signature;
          const txUpdate: MapUpdateData = update;
          const txDomain: DomainName = oldDomain;
          proof = await MapUpdate.update(
            state,
            txUpdate,
            txDomain,
            txSignature
          );
        } else if (updateType === "extend") {
          if (update === undefined) throw new Error("update is undefined");
          if (oldDomain === undefined)
            throw new Error("oldDomain is undefined");
          const txUpdate: MapUpdateData = update;
          const txDomain: DomainName = oldDomain;
          proof = await MapUpdate.extend(state, txUpdate, txDomain);
        } else {
          throw new Error("invalid updateType");
        }
      } else {
        if (time === undefined || tx === undefined || oldRoot === undefined)
          throw new Error("time, tx or oldRoot is undefined");
        proof = await MapUpdate.reject(state, oldRoot, time, tx);
      }

      const ok = await verify(
        proof.toJSON(),
        DomainNameServiceWorker.mapUpdateVerificationKey
      );
      if (!ok) throw new Error("proof verification failed");
      console.timeEnd("proof created");
      return JSON.stringify(proof.toJSON(), null, 2);
    } else {
      console.log("Proofs are off, returning state as is");
      console.timeEnd("proof created");
      return args.state;
    }
  }
  public async merge(
    proof1: string,
    proof2: string
  ): Promise<string | undefined> {
    console.time("proof merged");
    if (proofsOff === false) {
      await this.compile(false);
      try {
        if (DomainNameServiceWorker.mapUpdateVerificationKey === undefined)
          throw new Error("verificationKey is undefined");

        const sourceProof1: MapUpdateProof = await MapUpdateProof.fromJSON(
          JSON.parse(proof1) as JsonProof
        );
        const sourceProof2: MapUpdateProof = await MapUpdateProof.fromJSON(
          JSON.parse(proof2) as JsonProof
        );
        const state = MapTransition.merge(
          sourceProof1.publicInput,
          sourceProof2.publicInput
        );
        const proof = await MapUpdate.merge(state, sourceProof1, sourceProof2);
        const ok = await verify(
          proof.toJSON(),
          DomainNameServiceWorker.mapUpdateVerificationKey
        );
        if (!ok) throw new Error("proof verification failed");
        console.timeEnd("proof merged");
        return JSON.stringify(proof.toJSON(), null, 2);
      } catch (error) {
        console.log("Error in merge", error);
        console.timeEnd("proof merged");
        throw error;
      }
    } else {
      console.log("Proofs are off, merging state");
      const state1: MapTransition = MapTransition.fromFields(
        deserializeFields(proof1)
      ) as MapTransition;
      const state2: MapTransition = MapTransition.fromFields(
        deserializeFields(proof2)
      ) as MapTransition;
      const state = MapTransition.merge(state1, state2);
      console.timeEnd("proof merged");
      return serializeFields(MapTransition.toFields(state));
    }
  }

  public async execute(transactions: string[]): Promise<string | undefined> {
    switch (this.cloud.task) {
      case "createTxTask":
        return await this.createTxTask();
      case "getBlocksInfo":
        return await this.getBlocksInfo();
      case "restart":
        return await this.restart();
      default:
        console.error("Unknown task in execute:", this.cloud.task);
        return "Unknown task in execute";
    }
  }

  public async task(): Promise<string | undefined> {
    if (this.cloud.task === undefined) throw new Error("task is undefined");
    console.log(
      `Executing task ${this.cloud.task} with taskId ${this.cloud.taskId}`
    );
    try {
      switch (this.cloud.task) {
        case "validateBlock":
          return await this.validateRollupBlock();
        case "proveBlock":
          return await this.proveRollupBlock();
        case "txTask":
          return await this.txTask();

        default:
          console.error("Unknown task in task:", this.cloud.task);
          return "error: Unknown task in task";
      }
    } catch (error) {
      console.error("Error in task", error);
      return "error in task";
    }
  }

  private async txTask(): Promise<string | undefined> {
    const txToken = await this.cloud.getDataByKey("txToken");
    if (txToken === undefined) {
      console.error("txToken is undefined, exiting");
      await this.cloud.deleteTask(this.cloud.taskId);
      return "exiting txTask due to undefined txToken";
    }
    if (this.cloud.args === undefined) {
      console.error("cloud.args are undefined, exiting");
      await this.cloud.deleteTask(this.cloud.taskId);
      return "exiting txTask due to undefined cloud.args";
    }
    if (txToken !== JSON.parse(this.cloud.args).txToken) {
      console.error("txToken is wrong, exiting");
      await this.cloud.deleteTask(this.cloud.taskId);
      return "exiting txTask due to wrong txToken";
    }
    const timeStarted = await this.cloud.getDataByKey("txTask.timeStarted");
    if (
      timeStarted !== undefined &&
      Date.now() - Number(timeStarted) < 1000 * 60
    ) {
      console.error(
        "txTask is already running, detected double invocation, exiting"
      );
      if (this.cloud.isLocalCloud === false)
        return "exiting txTask due to double invocation";
    }
    await this.cloud.saveDataByKey("txTask.timeStarted", Date.now().toString());
    const transactions = await this.cloud.getTransactions();
    console.log(`txTask with ${transactions.length} transaction(s)`);
    if (transactions.length !== 0) {
      // sort by timeReceived, ascending
      transactions.sort((a, b) => a.timeReceived - b.timeReceived);
      console.log(
        `Executing txTask with ${
          transactions.length
        } transactions, first tx created at ${new Date(
          transactions[0].timeReceived
        ).toLocaleString()}...`
      );
      try {
        // TODO: Use processTransactions ???
        const result = await this.createRollupBlock(transactions);
        return result;
      } catch (error) {
        console.error("Error in txTask", error);
        return "Error in txTask";
      }
    }
    return "no transactions to process";
  }

  private async run(): Promise<boolean> {
    const taskId = this.cloud.taskId;
    if (taskId === undefined) {
      console.error("taskId is undefined", this.cloud);
      return false;
    }
    const statusId = "task.status." + taskId;
    const status = await this.cloud.getDataByKey(statusId);
    if (status === undefined) {
      await this.cloud.saveDataByKey(statusId, Date.now().toString());
      return true;
    } else if (Date.now() - Number(status) > 1000 * 60 * 15) {
      console.error(
        "Task is running for more than 15 minutes, restarting",
        this.cloud
      );
      await this.cloud.saveDataByKey(statusId, Date.now().toString());
      return true;
    } else {
      console.log("Task is already running", taskId);
      return false;
    }
  }

  private async stop() {
    const taskId = this.cloud.taskId;
    const statusId = "task.status." + taskId;
    await this.cloud.saveDataByKey(statusId, undefined);
  }

  private async getBlocksInfo(): Promise<string | undefined> {
    const MAX_BLOCKS = 10;
    try {
      let startBlock: PublicKey | undefined = undefined;
      let contractAddress: PublicKey | undefined = undefined;
      if (this.cloud.args !== undefined) {
        const args = JSON.parse(this.cloud.args);
        startBlock =
          args.startBlock === undefined
            ? undefined
            : PublicKey.fromBase58(args.startBlock);
        contractAddress = PublicKey.fromBase58(args.contractAddress);
      }
      if (contractAddress === undefined) {
        console.error("getBlocksInfo: contractAddress is undefined");
        return "getBlocksInfo: contractAddress is undefined";
      }
      const zkApp = new DomainNameContract(contractAddress);
      const tokenId = zkApp.deriveTokenId();
      await fetchMinaAccount({
        publicKey: contractAddress,
      });
      if (!Mina.hasAccount(contractAddress)) {
        console.error(
          `getBlocksInfo: Contract ${contractAddress.toBase58()} not found`
        );
        return `error: Contract ${contractAddress.toBase58()} not found`;
      }
      if (startBlock === undefined) {
        startBlock = LastBlocks.unpack(zkApp.blocks.get()).lastBlockAddress;
      }
      await fetchMinaAccount({ publicKey: startBlock, tokenId });
      if (!Mina.hasAccount(startBlock, tokenId)) {
        console.error(
          `getBlocksInfo: Block ${startBlock.toBase58()} not found`
        );
        return `error: Block ${startBlock.toBase58()} not found`;
      }
      let count = 0;
      const validators = zkApp.validators.get();
      const lastBlocks = LastBlocks.unpack(zkApp.blocks.get());
      const contractState = {
        domain: Encoding.stringFromFields([zkApp.domain.get()]),
        lastBlocks: {
          lastBlock: {
            address: lastBlocks.lastBlockAddress.toBase58(),
            number: lastBlocks.lastBlockNumber.toBigInt().toString(),
          },
          lastValidatedBlock: {
            address: lastBlocks.lastValidatedBlockAddress.toBase58(),
            number: lastBlocks.lastValidatedBlockNumber.toBigInt().toString(),
          },
          lastProvedBlock: {
            address: lastBlocks.lastProvedBlockAddress.toBase58(),
            number: lastBlocks.lastProvedBlockNumber.toBigInt().toString(),
          },
        },
        validators: {
          root: validators.root.toJSON(),
          hash: validators.hash.toJSON(),
          count: validators.count.toBigint().toString(),
        },
      };
      let blockAddress = startBlock;
      let block = new BlockContract(blockAddress, tokenId);
      let blockNumber = Number(block.blockNumber.get().toBigInt());
      const blocks: {}[] = [];
      while (count < MAX_BLOCKS && blockNumber > 0) {
        const root = block.root.get().toJSON();
        const storage = block.storage.get().toIpfsHash();
        const flags = BlockParams.unpack(block.blockParams.get());
        const isValidated = flags.isValidated.toBoolean();
        const isInvalid = flags.isInvalid.toBoolean();
        const isProved = flags.isProved.toBoolean();
        const isFinal = flags.isFinal.toBoolean();
        const timeCreated = flags.timeCreated;
        const txsCount = flags.txsCount;
        const txsHash = block.txsHash.get().toJSON();
        const previousBlockAddress = block.previousBlock.get();
        blocks.push({
          blockNumber,
          blockAddress: blockAddress.toBase58(),
          root,
          ipfs: storage,
          isValidated,
          isInvalid,
          isProved,
          isFinal,
          timeCreated,
          txsCount,
          txsHash,
          previousBlockAddress: previousBlockAddress.toBase58(),
        });

        blockAddress = previousBlockAddress;
        block = new BlockContract(blockAddress, tokenId);
        await fetchMinaAccount({
          publicKey: blockAddress,
          tokenId,
          force: true,
        });
        blockNumber = Number(block.blockNumber.get().toBigInt());
        count++;
      }
      return JSON.stringify(
        {
          contractAddress: contractAddress.toBase58(),
          startBlock: startBlock.toBase58(),
          contractState,
          blocks,
        },
        null,
        2
      );
    } catch (error) {
      console.error("Error in getBlocksInfo", error);
      return "Error in getBlocksInfo";
    }
  }

  private async restart(): Promise<string | undefined> {
    try {
      let startBlock: PublicKey | undefined = undefined;
      let contractAddress: PublicKey | undefined = undefined;
      if (this.cloud.args !== undefined) {
        const args = JSON.parse(this.cloud.args);
        startBlock =
          args.startBlock === undefined
            ? undefined
            : PublicKey.fromBase58(args.startBlock);
        contractAddress = PublicKey.fromBase58(args.contractAddress);
      }
      if (contractAddress === undefined) {
        console.error("getBlocksInfo: contractAddress is undefined");
        return "getBlocksInfo: contractAddress is undefined";
      }
      const zkApp = new DomainNameContract(contractAddress);
      const tokenId = zkApp.deriveTokenId();
      await fetchMinaAccount({
        publicKey: contractAddress,
      });
      if (!Mina.hasAccount(contractAddress)) {
        console.error(
          `getBlocksInfo: Contract ${contractAddress.toBase58()} not found`
        );
        return `error: Contract ${contractAddress.toBase58()} not found`;
      }
      if (startBlock === undefined) {
        startBlock = LastBlocks.unpack(zkApp.blocks.get()).lastBlockAddress;
      }
      await fetchMinaAccount({ publicKey: startBlock, tokenId });
      if (!Mina.hasAccount(startBlock, tokenId)) {
        console.error(
          `getBlocksInfo: Block ${startBlock.toBase58()} not found`
        );
        return `error: Block ${startBlock.toBase58()} not found`;
      }
      let blockAddress = startBlock;
      let block = new BlockContract(blockAddress, tokenId);
      let blockNumber = Number(block.blockNumber.get().toBigInt());
      let flags = BlockParams.unpack(block.blockParams.get());
      const blocks: { blockAddress: string; blockNumber: number }[] = [];
      while (flags.isFinal.toBoolean() === false && blockNumber > 0) {
        blocks.push({
          blockAddress: blockAddress.toBase58(),
          blockNumber: blockNumber,
        });

        const previousBlockAddress = block.previousBlock.get();
        blockAddress = previousBlockAddress;
        block = new BlockContract(blockAddress, tokenId);
        await fetchMinaAccount({
          publicKey: blockAddress,
          tokenId,
          force: true,
        });
        flags = BlockParams.unpack(block.blockParams.get());
        blockNumber = Number(block.blockNumber.get().toBigInt());
      }
      for (let i = blocks.length - 1; i >= 0; i--) {
        await this.cloud.addTask({
          args: JSON.stringify(
            {
              contractAddress: contractAddress.toBase58(),
              blockAddress: blocks[i].blockAddress,
              blockNumber: blocks[i].blockNumber,
            },
            null,
            2
          ),
          task: "validateBlock",
          metadata: `block ${blocks[i].blockNumber} validation (restart)`,
          userId: this.cloud.userId,
          maxAttempts: 20,
        });
      }

      return "validation restarted";
    } catch (error) {
      console.error("Error in getBlocksInfo", error);
      return "Error in getBlocksInfo";
    }
  }

  private async createTxTask(): Promise<string | undefined> {
    // TODO: add fetchMinaAccount and check that block validation tx is confirmed
    if (this.cloud.args === undefined)
      throw new Error("this.cloud.args is undefined");
    const args = JSON.parse(this.cloud.args);
    console.log(
      `Adding txTask, proofs off: ${proofsOff === true ? true : false}`
    );
    if (args.contractAddress === undefined)
      throw new Error("args.contractAddress is undefined");
    const txToken = makeString(32);
    await this.cloud.saveDataByKey("txToken", txToken);
    await this.cloud.addTask({
      args: JSON.stringify(
        {
          contractAddress: args.contractAddress,
          txToken,
        },
        null,
        2
      ),
      task: "txTask",
      maxAttempts: 120,
      metadata: `tx processing`,
      userId: this.cloud.userId,
    });
    return "txTask added";
  }

  private async proveRollupBlock(): Promise<string | undefined> {
    if (!(await this.run())) return "proveRollupBlock is already running";
    if (this.cloud.args === undefined)
      throw new Error("this.cloud.args is undefined");
    console.time("proveBlock");

    const args = JSON.parse(this.cloud.args);
    console.log(`Proving block ${args.blockNumber}, proofs off: ${proofsOff}`);
    if (args.contractAddress === undefined)
      throw new Error("args.contractAddress is undefined");
    if (args.blockAddress === undefined)
      throw new Error("args.blockAddress is undefined");
    if (args.jobId === undefined) throw new Error("args.jobId is undefined");
    const result = await this.cloud.jobResult(args.jobId);
    if (result === undefined) throw new Error("job is undefined");
    if (result.result === undefined) {
      console.timeEnd("proveBlock");
      await this.stop();
      return "proof job is not finished yet";
    }

    let proof: MapUpdateProof;
    let state: MapTransition;
    if (proofsOff === false) {
      proof = await MapUpdateProof.fromJSON(
        JSON.parse(result.result) as JsonProof
      );
      state = proof.publicInput;
    } else {
      state = MapTransition.fromFields(
        deserializeFields(result.result)
      ) as MapTransition;
    }
    if (state === undefined) throw new Error("state is undefined");

    const contractAddress = PublicKey.fromBase58(args.contractAddress);
    const blockAddress = PublicKey.fromBase58(args.blockAddress);
    const blockNumber = args.blockNumber;
    const zkApp = new DomainNameContract(contractAddress);
    const tokenId = zkApp.deriveTokenId();
    await fetchMinaAccount({ publicKey: blockAddress, tokenId, force: false });
    if (!Mina.hasAccount(blockAddress, tokenId)) {
      console.log(`Block ${blockAddress.toBase58()} not found`);
      console.timeEnd("proveBlock");
      await this.stop();
      return "block is not found";
    }
    const block = new BlockContract(blockAddress, tokenId);
    const flags = BlockParams.unpack(block.blockParams.get());
    if (flags.isValidated.toBoolean() === false) {
      console.log(`Block ${blockNumber} is not yet validated`);
      console.timeEnd("proveBlock");
      await this.stop();
      return "block is not validated";
    }
    if (flags.isInvalid.toBoolean() === true) {
      console.error(`Block ${blockNumber} is invalid`);
      await this.cloud.deleteTask(this.cloud.taskId);
      console.timeEnd("proveBlock");
      await this.stop();
      return "block is invalid";
    }

    if (flags.isProved.toBoolean() === true) {
      console.error(`Block ${blockNumber} is already proved`);
      await this.cloud.deleteTask(this.cloud.taskId);
      console.timeEnd("proveBlock");
      await this.stop();
      return "block is already proved";
    }

    const previousBlockAddress = block.previousBlock.get();
    await fetchMinaAccount({
      publicKey: previousBlockAddress,
      tokenId,
      force: true,
    });
    if (!Mina.hasAccount(previousBlockAddress, tokenId)) {
      console.log(
        `Previous block ${previousBlockAddress.toBase58()} not found`
      );
      console.timeEnd("proveBlock");
      await this.stop();
      return "previous block is not found";
    }

    const previousBlock = new BlockContract(previousBlockAddress, tokenId);
    const oldRoot = previousBlock.root.get();
    if (oldRoot.toJSON() !== state.oldRoot.toJSON()) {
      console.error(`Invalid previous block root`);
      console.timeEnd("proveBlock");
      await this.stop();
      return "Invalid previous block root";
    }

    const flagsPrevious = BlockParams.unpack(previousBlock.blockParams.get());
    if (flagsPrevious.isFinal.toBoolean() === false) {
      console.log(`Previous block is not final`);
      console.timeEnd("proveBlock");
      await this.stop();
      return "Previous block is not final";
    } else {
      const previousBlockNumber = Number(
        previousBlock.blockNumber.get().toBigInt()
      );
      await this.cloud.saveDataByKey(
        `proofMap.${previousBlockNumber}.jobId`,
        undefined
      );
    }

    await this.compile();
    if (
      DomainNameServiceWorker.mapUpdateVerificationKey === undefined ||
      DomainNameServiceWorker.blockContractVerificationKey === undefined ||
      DomainNameServiceWorker.validatorsVerificationKey === undefined ||
      DomainNameServiceWorker.contractVerificationKey === undefined
    )
      throw new Error("verificationKey is undefined");

    const deployer = await this.cloud.getDeployer();
    if (deployer === undefined) throw new Error("deployer is undefined");
    const sender = deployer.toPublicKey();
    await fetchMinaAccount({ publicKey: sender, force: true });
    await fetchMinaAccount({ publicKey: contractAddress, force: true });

    const tx = await Mina.transaction(
      { sender, fee: await fee(), memo: `block ${blockNumber} is proved` },
      async () => {
        proofsOff
          ? await zkApp.proveBlockProofsOff(state, blockAddress)
          : await zkApp.proveBlock(proof, blockAddress);
      }
    );

    await tx.prove();
    const txSent = await tx.sign([deployer]).send();
    if (txSent.errors.length > 0) {
      console.error(
        `prove block tx error: hash: ${txSent.hash} status: ${txSent.status}  errors: ${txSent.errors}`
      );
    } else
      console.log(
        `prove block tx sent: hash: ${txSent.hash} status: ${txSent.status}`
      );
    if (txSent.status !== "pending") {
      await this.cloud.releaseDeployer([]);
      throw new Error("Error sending prove block transaction");
    }
    await this.cloud.releaseDeployer([txSent.hash]);
    //console.log("Deleting proveBlock task", this.cloud.taskId);
    console.log(`Block ${blockNumber} is proved`);
    await this.cloud.deleteTask(this.cloud.taskId);
    console.timeEnd("proveBlock");
    if (waitTx) {
      const txIncluded = await txSent.wait();
      console.log(
        `prove block ${blockNumber} tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`
      );
      await sleep(20000);
    }
    await this.stop();
    return txSent.hash;
  }

  private async validateRollupBlock(): Promise<string | undefined> {
    if (!(await this.run())) return "validateRollupBlock is already running";

    if (this.cloud.args === undefined)
      throw new Error("this.cloud.args is undefined");
    const args = JSON.parse(this.cloud.args);
    console.time(`block ${args.blockNumber} validated`);

    if (args.contractAddress === undefined)
      throw new Error("args.contractAddress is undefined");
    if (args.blockAddress === undefined)
      throw new Error("args.blockAddress is undefined");
    let validated = true;
    let onlyRestartProving = false;
    let decision: ValidatorsDecision | undefined = undefined;
    let proofData: string[] = [];
    const contractAddress = PublicKey.fromBase58(args.contractAddress);
    const blockAddress = PublicKey.fromBase58(args.blockAddress);
    const zkApp = new DomainNameContract(contractAddress);
    const tokenId = zkApp.deriveTokenId();
    await fetchMinaAccount({ publicKey: contractAddress, force: true });
    const validators = zkApp.validators.get();
    let timeCreated = UInt64.from(0);
    let isPreviousBlockFinal: boolean = false;

    let blockNumber = 0;
    try {
      await fetchMinaAccount({
        publicKey: blockAddress,
        tokenId,
        force: false,
      });
      if (!Mina.hasAccount(blockAddress, tokenId)) {
        console.log(`Block ${blockAddress.toBase58()} not found`);
        console.timeEnd(`block ${args.blockNumber} validated`);
        await this.stop();
        return "block is not found";
      }

      const block = new BlockContract(blockAddress, tokenId);
      blockNumber = Number(block.blockNumber.get().toBigInt());
      console.log(`Validating block ${blockNumber}...`);
      if (blockNumber === 0)
        throw new Error("validateRollupBlock: Block number is 0");
      const flags = BlockParams.unpack(block.blockParams.get());
      if (flags.isInvalid.toBoolean() === true) {
        console.log(`Block ${blockNumber} is marked as invalid`);
        await this.cloud.deleteTask(this.cloud.taskId);
        console.timeEnd(`block ${args.blockNumber} validated`);
        await this.stop();
        return `Block ${blockNumber} is marked as invalid`;
      }

      if (
        flags.isValidated.toBoolean() === true &&
        flags.isProved.toBoolean() === false
      ) {
        console.log(
          `Block ${blockNumber} is already validated, but not proved`
        );

        const jobId = await this.cloud.getDataByKey(
          `proofMap.${blockNumber}.jobId`
        );
        if (jobId === undefined) onlyRestartProving = true;
        else {
          await this.cloud.addTask({
            args: JSON.stringify(
              {
                contractAddress: args.contractAddress,
                blockAddress: args.blockAddress,
                blockNumber: blockNumber,
                jobId,
              },
              null,
              2
            ),
            task: "proveBlock",
            metadata: `prove block ${args.blockNumber} (restart)`,
            userId: this.cloud.userId,
            maxAttempts: 20,
          });
          await this.cloud.deleteTask(this.cloud.taskId);
          console.timeEnd(`block ${args.blockNumber} validated`);
          await this.stop();
          return `Block ${blockNumber} is already validated`;
        }
      }

      const previousBlockAddress = block.previousBlock.get();
      let previousValidBlockAddress = previousBlockAddress;
      let previousBlock = new BlockContract(previousValidBlockAddress, tokenId);
      await fetchMinaAccount({
        publicKey: previousBlockAddress,
        tokenId,
        force: true,
      });
      let previousBlockParams = BlockParams.unpack(
        previousBlock.blockParams.get()
      );
      isPreviousBlockFinal = previousBlockParams.isFinal.toBoolean();
      let found = false;
      while (found === false) {
        if (previousBlockParams.isInvalid.toBoolean() === false) found = true;
        else {
          previousValidBlockAddress = previousBlock.previousBlock.get();
          previousBlock = new BlockContract(previousValidBlockAddress, tokenId);

          await fetchMinaAccount({
            publicKey: previousValidBlockAddress,
            tokenId,
            force: true,
          });
          previousBlockParams = BlockParams.unpack(
            previousBlock.blockParams.get()
          );
        }
      }

      if (previousBlockParams.isValidated.toBoolean() === false) {
        console.log(`Previous block is not validated yet, waiting`);
        console.timeEnd(`block ${args.blockNumber} validated`);
        await this.stop();
        return `Previous block is not validated yet, waiting`;
      }

      const blockParams = BlockParams.unpack(block.blockParams.get());
      timeCreated = blockParams.timeCreated;

      const map = new MerkleMap();
      const oldMap = new MerkleMap();

      const blockStorage = block.storage.get();
      const hash = blockStorage.toIpfsHash();
      const json = await loadFromIPFS(hash);
      if (json.map === undefined) throw new Error("json.map is undefined");
      if (json.map.startsWith("i:") === false)
        throw new Error("json.map does not start with 'i:'");
      const mapJson = await loadFromIPFS(json.map.substring(2));

      /* validate json contents 
      blockNumber,
      timeCreated: time.toBigInt().toString(),
      contractAddress: contractAddress.toBase58(),
      blockAddress: blockPublicKey.toBase58(),
      root: root.toJSON(),
      blockProducer: blockProducer.publicKey.toBase58(),
      chainId: getNetworkIdHash().toJSON(),
      txsCount: txsCount.toBigint().toString(),
      txsHash: txsHash.toJSON(),
      previousBlockAddress: previousBlockAddress.toBase58(),
      previousValidBlockAddress: previousValidBlockAddress.toBase58(),
      oldRoot: oldRoot.toJSON(),
      transactions: elements.map((element) => {
        return {
          tx: element.serializedTx,
          fields: element.domainData?.toJSON(),
        };
      }),
      database: database.data,
      map: "i:" + mapHash,
      */
      if (timeCreated.toBigInt() !== BigInt(json.timeCreated))
        throw new Error(
          `Invalid timeCreated, ${timeCreated.toBigInt()} != ${
            json.timeCreated
          }`
        );
      if (contractAddress.toBase58() !== json.contractAddress)
        throw new Error("Invalid contractAddress");
      if (blockAddress.toBase58() !== json.blockAddress)
        throw new Error("Invalid blockAddress");
      if (block.root.get().toJSON() !== json.root)
        throw new Error("Invalid block root");
      if (getNetworkIdHash().toJSON() !== json.chainId)
        throw new Error("Invalid chainId");
      if (blockParams.txsCount.toBigint().toString() !== json.txsCount)
        throw new Error("Invalid txsCount");
      if (block.txsHash.get().toJSON() !== json.txsHash)
        throw new Error("Invalid txsHash");
      if (previousBlockAddress.toBase58() !== json.previousBlockAddress)
        throw new Error("Invalid previousBlockAddress");

      let database = new DomainDatabase();

      //console.log("blockNumber", blockNumber);
      if (blockNumber > 1) {
        console.log("getting previous block data for validation...");
        const previousBlockStorage = previousBlock.storage.get();
        const previousBlockRoot = previousBlock.root.get();
        const previousBlockHash = previousBlockStorage.toIpfsHash();
        const previousBlockJson = await loadFromIPFS(previousBlockHash);
        //console.log("previousBlockJson map:", previousBlockJson.map);
        if (previousBlockJson.map === undefined)
          throw new Error("previousBlockJson.map is undefined");
        if (previousBlockJson.map.startsWith("i:") === false)
          throw new Error("previousBlockJson.map does not start with 'i:'");
        const previousBlockMapJson = await loadFromIPFS(
          previousBlockJson.map.substring(2)
        );
        database = new DomainDatabase(previousBlockJson.database);
        oldMap.tree = treeFromJSON(previousBlockMapJson.map);
        const oldRoot = oldMap.getRoot();
        if (previousBlockRoot.toJSON() !== oldRoot.toJSON())
          throw new Error("Invalid previous block root");
      }
      map.tree = treeFromJSON(mapJson.map);

      const elements: DomainCloudTransactionData[] = json.transactions.map(
        (element: any) => {
          return {
            serializedTx: element.tx,
            domainData:
              element.fields === undefined
                ? undefined
                : DomainTransactionData.fromJSON(element.fields),
          } as DomainCloudTransactionData;
        }
      );
      const root = block.root.get();
      if (root.toJSON() !== map.getRoot().toJSON())
        throw new Error("Invalid block root");

      const {
        root: calculatedRoot,
        txsHash: calculatedTxsHash,
        txsCount: calculatedTxsCount,
        proofData: calculatedProofData,
      } = createBlock({
        elements,
        map: oldMap,
        time: timeCreated,
        database,
        calculateTransactions: true,
      });
      proofData = calculatedProofData;
      const storage = block.storage.get();
      const txsHash = block.txsHash.get();

      if (calculatedRoot.toJSON() !== root.toJSON())
        throw new Error("Invalid block root");
      if (calculatedTxsHash.toJSON() !== txsHash.toJSON())
        throw new Error("Invalid block transactions");
      if (calculatedTxsCount.toBigint() !== blockParams.txsCount.toBigint())
        throw new Error("Invalid block transactions count");
      const loadedDatabase = new DomainDatabase(json.database);
      assert.deepStrictEqual(database.data, loadedDatabase.data);
      if (root.toJSON() !== database.getRoot().toJSON())
        throw new Error("Invalid block root");
      if (root.toJSON() !== loadedDatabase.getRoot().toJSON())
        throw new Error("Invalid block root");
      //console.log(`Block ${blockNumber} is valid`);

      if (onlyRestartProving === true) {
        const jobId = await this.cloud.recursiveProof({
          transactions: proofData,
          task: "proofMap",
          metadata: `block ${blockNumber} proof creation (restart)`,
          userId: this.cloud.userId,
          args: JSON.stringify({
            timeCreated: timeCreated.toJSON(),
            proofsOff,
          }),
        });
        await this.cloud.saveDataByKey(`proofMap.${blockNumber}.jobId`, jobId);

        await this.cloud.addTask({
          args: JSON.stringify(
            {
              contractAddress: args.contractAddress,
              blockAddress: args.blockAddress,
              blockNumber: blockNumber,
              jobId,
            },
            null,
            2
          ),
          task: "proveBlock",
          metadata: `prove block ${blockNumber} (restart)`,
          userId: this.cloud.userId,
          maxAttempts: 20,
        });
        await this.cloud.deleteTask(this.cloud.taskId);
        console.timeEnd(`block ${blockNumber} validated`);
        await this.stop();
        return `Block ${blockNumber} is already validated`;
      }

      await this.compile();
      if (
        DomainNameServiceWorker.mapUpdateVerificationKey === undefined ||
        DomainNameServiceWorker.blockContractVerificationKey === undefined ||
        DomainNameServiceWorker.validatorsVerificationKey === undefined ||
        DomainNameServiceWorker.contractVerificationKey === undefined
      )
        throw new Error("verificationKey is undefined");

      decision = new ValidatorsDecision({
        contractAddress,
        chainId: getNetworkIdHash(),
        validatorsRoot: validators.root,
        decisionType: ValidatorDecisionType.validate,
        data: BlockValidationData.toFields({
          storage,
          root,
          txsHash,
          txsCount: calculatedTxsCount,
          blockAddress,
          notUsed: Field(0),
        }),
        expiry: UInt64.from(Date.now() + 1000 * 60 * 60 * 24 * 2000),
      });
    } catch (error) {
      console.error("Error in validateBlock", error);
      if (isPreviousBlockFinal === false) {
        console.error(
          `Block ${args.blockNumber} is bad and previous block is not final`
        );
        console.timeEnd(`block ${args.blockNumber} validated`);
        await this.stop();
        return `Block ${args.blockNumber} is bad and previous block is not final`;
      }
      validated = false;
      decision = new ValidatorsDecision({
        contractAddress,
        chainId: getNetworkIdHash(),
        validatorsRoot: validators.root,
        decisionType: ValidatorDecisionType.badBlock,
        data: BadBlockValidationData.toFields({
          blockAddress,
          notUsed: [Field(0), Field(0), Field(0), Field(0), Field(0), Field(0)],
        }),
        expiry: UInt64.from(Date.now() + 1000 * 60 * 60),
      });
      await this.compile();
      if (
        DomainNameServiceWorker.mapUpdateVerificationKey === undefined ||
        DomainNameServiceWorker.blockContractVerificationKey === undefined ||
        DomainNameServiceWorker.validatorsVerificationKey === undefined ||
        DomainNameServiceWorker.contractVerificationKey === undefined
      )
        throw new Error("verificationKey is undefined");
    }

    if (decision === undefined) throw new Error("decision is undefined");

    const proof: ValidatorsVotingProof = await calculateValidatorsProof(
      decision,
      DomainNameServiceWorker.validatorsVerificationKey,
      false
    );

    if (proof.publicInput.hash.toJSON() !== validators.hash.toJSON())
      throw new Error("Invalid validators hash in proof");

    const deployer = await this.cloud.getDeployer();
    if (deployer === undefined) throw new Error("deployer is undefined");
    const sender = deployer.toPublicKey();

    await fetchMinaAccount({ publicKey: sender, force: true });

    const tx = await Mina.transaction(
      {
        sender,
        fee: await fee(),
        memo: validated
          ? `block ${blockNumber} is valid`
          : `bad block ${blockNumber}`,
      },
      async () => {
        validated
          ? await zkApp.validateBlock(proof)
          : await zkApp.badBlock(proof);
      }
    );

    await tx.prove();
    const txSent = await tx.sign([deployer]).send();
    if (txSent.errors.length > 0) {
      console.error(
        `validate block tx error: hash: ${txSent.hash} status: ${txSent.status}  errors: ${txSent.errors}`
      );
    } else
      console.log(
        `validate block tx sent: hash: ${txSent.hash} status: ${txSent.status}`
      );
    if (txSent.status !== "pending") {
      await this.cloud.releaseDeployer([]);
      throw new Error("Error sending block creation transaction");
    }
    await this.cloud.releaseDeployer([txSent.hash]);
    //console.log("Deleting validateBlock task", this.cloud.taskId);
    await this.cloud.deleteTask(this.cloud.taskId);
    if (validated) {
      const jobId = await this.cloud.recursiveProof({
        transactions: proofData,
        task: "proofMap",
        metadata: `block ${args.blockNumber} proof creation`,
        userId: this.cloud.userId,
        args: JSON.stringify({ timeCreated: timeCreated.toJSON() }),
      });
      await this.cloud.saveDataByKey(
        `proofMap.${args.blockNumber}.jobId`,
        jobId
      );
      await this.cloud.addTask({
        args: JSON.stringify(
          {
            contractAddress: args.contractAddress,
            blockAddress: args.blockAddress,
            blockNumber: args.blockNumber,
            txHash: txSent.hash,
            jobId,
          },
          null,
          2
        ),
        task: "proveBlock",
        metadata: `prove block ${args.blockNumber}`,
        userId: this.cloud.userId,
        maxAttempts: 20,
      });
    }
    console.timeEnd(`block ${args.blockNumber} validated`);
    if (waitTx) {
      const txIncluded = await txSent.wait();
      console.log(
        `validate block ${blockNumber} tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`
      );
      await sleep(20000);
    }
    await this.stop();
    return txSent.hash;
  }

  private async convertTransaction(
    txInput: CloudTransaction
  ): Promise<DomainCloudTransactionData> {
    try {
      const tx: DomainSerializedTransaction = JSON.parse(
        txInput.transaction
      ) as DomainSerializedTransaction;
      const map = new MerkleMap();
      const root = map.getRoot();
      const nftStorage = new Storage({ hashString: [Field(0), Field(0)] });
      const name = stringToFields(tx.name);
      if (name.length !== 1) throw new Error("Invalid name length");
      const domainName: DomainName = new DomainName({
        name: name[0],
        data: new DomainNameValue({
          address: PublicKey.fromBase58(tx.address),
          metadata: new Metadata({
            data: root,
            kind: root,
          }),
          storage: nftStorage,
          expiry: UInt64.from(tx.expiry),
        }),
      });
      let oldDomain: DomainName | undefined = undefined;
      if (tx.oldDomain !== undefined) {
        oldDomain = new DomainName({
          name: stringToFields(tx.oldDomain.name)[0],
          data: new DomainNameValue({
            address: PublicKey.fromBase58(tx.oldDomain.address),
            metadata: new Metadata({
              data: root,
              kind: root,
            }),
            storage: nftStorage,
            expiry: UInt64.from(tx.oldDomain.expiry),
          }),
        });
      }
      const operationType =
        tx.operation === "add"
          ? DomainTransactionEnum.add
          : tx.operation === "extend"
          ? DomainTransactionEnum.extend
          : tx.operation === "update"
          ? DomainTransactionEnum.update
          : tx.operation === "remove"
          ? DomainTransactionEnum.remove
          : undefined;
      if (operationType === undefined) {
        console.error("Invalid operation type:", tx.operation);
        return {
          serializedTx: {
            txId: txInput.txId,
            transaction: txInput.transaction,
            timeReceived: txInput.timeReceived,
            status: "invalid",
            reason: "Invalid operation type",
          } as DomainCloudTransaction,
          domainData: undefined,
        };
      }
      const domainTransaction: DomainTransaction = new DomainTransaction({
        type: operationType,
        domain: domainName,
      }) as DomainTransaction;
      const domainTransactionData: DomainTransactionData =
        new DomainTransactionData(
          domainTransaction,
          oldDomain,
          tx.signature === undefined
            ? undefined
            : Signature.fromBase58(tx.signature)
        );
      return {
        serializedTx: {
          txId: txInput.txId,
          transaction: txInput.transaction,
          timeReceived: txInput.timeReceived,
          status: "pending",
        } as DomainCloudTransaction,
        domainData: domainTransactionData,
      };
    } catch (error: any) {
      console.error("Error in convertTransaction", error, "tx:", txInput);
      return {
        serializedTx: {
          txId: txInput.txId,
          transaction: txInput.transaction,
          timeReceived: txInput.timeReceived,
          status: "invalid",
          reason: error.message,
        } as DomainCloudTransaction,
        domainData: undefined,
      };
    }
  }

  private async createRollupBlock(
    txs: CloudTransaction[]
  ): Promise<string | undefined> {
    if (!(await this.run())) return "createRollupBlock is already running";

    if (txs.length < this.MIN_TRANSACTIONS) {
      console.log("Not enough transactions to create a block:", txs.length);
      await this.stop();
      return "Not enough transactions to create a block";
    }
    if (this.cloud.args === undefined)
      throw new Error("this.cloud.args is undefined");
    const args = JSON.parse(this.cloud.args);
    console.log("args", args);
    if (args.contractAddress === undefined)
      throw new Error("args.contractAddress is undefined");

    const blockPrivateKey = PrivateKey.random();
    const blockPublicKey = blockPrivateKey.toPublicKey();
    const contractAddress = PublicKey.fromBase58(args.contractAddress);
    const zkApp = new DomainNameContract(contractAddress);
    const tokenId = zkApp.deriveTokenId();
    await fetchMinaAccount({ publicKey: contractAddress, force: true });
    const validators = zkApp.validators.get();
    const previousBlockAddress = LastBlocks.unpack(
      zkApp.blocks.get()
    ).lastBlockAddress;
    let previousValidBlockAddress = previousBlockAddress;
    console.log("previousBlockAddress", previousBlockAddress.toBase58());

    const previousBlockAddressVar = await this.cloud.getDataByKey(
      "lastBlockAddress"
    );
    if (previousBlockAddressVar !== undefined) {
      const { address, timeStarted } = JSON.parse(previousBlockAddressVar);
      if (address !== undefined && timeStarted !== undefined) {
        if (
          address !== previousBlockAddress.toBase58() &&
          timeStarted > Date.now() - 1000 * 60 * 20
        ) {
          console.log(
            "lastBlockAddress is not equal to previousBlockAddress, waiting.."
          );
          await this.stop();
          return "lastBlockAddress is not equal to previousBlockAddress";
        }
        if (timeStarted > Date.now() - this.MIN_TIME_BETWEEN_BLOCKS) {
          console.log("Not enough time between blocks:", {
            lastBlockTme: new Date(timeStarted).toLocaleString(),
            now: new Date().toLocaleString(),
          });
          await this.stop();
          return "Not enough time between blocks";
        }
        await this.cloud.saveDataByKey(
          "previousBlockAddress",
          previousBlockAddressVar
        );
      }
    }
    await this.cloud.saveDataByKey(
      "lastBlockAddress",
      JSON.stringify(
        { address: blockPublicKey.toBase58(), timeStarted: Date.now() },
        null,
        2
      )
    );

    console.time(`block created`);
    console.time("block calculated");
    const elements: DomainCloudTransactionData[] = [];
    let count = 0;
    for (let i = 0; i < txs.length; i++) {
      if (elements.length >= this.MAX_TRANSACTIONS) break;
      const element = await this.convertTransaction(txs[i]);
      if (element.domainData !== undefined) count++;
      elements.push(element);
    }
    const length = elements.length;
    if (count < this.MIN_TRANSACTIONS) {
      console.log("Not enough transactions to create a block:", count);
      await this.stop();
      return "Not enough transactions to create a block";
    }
    console.log(
      `Creating block with ${count} transactions of ${txs.length} transactions...`
    );
    //console.log("transactions", transactions);
    //console.log("this.cloud", this.cloud);

    let previousBlock = new BlockContract(previousValidBlockAddress, tokenId);
    await fetchMinaAccount({
      publicKey: previousValidBlockAddress,
      tokenId,
      force: true,
    });
    const blockNumber = Number(previousBlock.blockNumber.get().toBigInt()) + 1;
    let previousValidBlockParams = BlockParams.unpack(
      previousBlock.blockParams.get()
    );
    let found = false;
    while (found === false) {
      if (previousValidBlockParams.isInvalid.toBoolean() === false)
        found = true;
      else {
        previousValidBlockAddress = previousBlock.previousBlock.get();
        previousBlock = new BlockContract(previousValidBlockAddress, tokenId);
        await fetchMinaAccount({
          publicKey: previousValidBlockAddress,
          tokenId,
          force: true,
        });
        previousValidBlockParams = BlockParams.unpack(
          previousBlock.blockParams.get()
        );
      }
    }
    const previousValidBlockNumber = Number(
      previousBlock.blockNumber.get().toBigInt()
    );
    console.log(
      `Creating block ${blockNumber}, last valid block: ${previousValidBlockNumber}`
    );

    let database: DomainDatabase = new DomainDatabase();
    let map = new MerkleMap();
    const previousBlockRoot = previousBlock.root.get();
    if (blockNumber > 1) {
      const storage = previousBlock.storage.get();
      const hash = storage.toIpfsHash();
      const json = await loadFromIPFS(hash);
      if (json.map === undefined) throw new Error("json.map is undefined");
      if (json.map.startsWith("i:") === false)
        throw new Error("json.map does not start with 'i:'");
      const mapJson = await loadFromIPFS(json.map.substring(2));
      map.tree = treeFromJSON(mapJson.map);
      database = new DomainDatabase(json.database);
    }

    if (fullValidation) {
      console.time("full validation");
      if (
        database.getRoot().toJSON() !== previousBlockRoot.toJSON() ||
        map.getRoot().toJSON() !== previousBlockRoot.toJSON()
      ) {
        console.timeEnd("full validation");
        throw new Error("Invalid previous block");
      }
      console.timeEnd("full validation");
    }
    const time = UInt64.from(Date.now());
    const { root, oldRoot, txsHash, txsCount } = createBlock({
      elements,
      map,
      time,
      database,
    });

    const mapJson = {
      map: treeToJSON(map.tree),
    };
    if (fullValidation) {
      console.time("full validation");
      const restoredMap = new MerkleMap();
      restoredMap.tree = treeFromJSON(mapJson.map);

      if (restoredMap.getRoot().toJSON() !== root.toJSON()) {
        console.timeEnd("full validation");
        throw new Error("Invalid root");
      }
      console.timeEnd("full validation");
    }

    console.time("map saved to IPFS");
    const mapHash = await saveToIPFS({
      data: mapJson,
      pinataJWT: process.env.PINATA_JWT!,
      name: `block.${blockNumber}.map.${contractAddress.toBase58()}.json`,
      keyvalues: {
        blockNumber: blockNumber.toString(),
        type: "Merkle Map",
        contractAddress: contractAddress.toBase58(),
        repo: this.cloud.repo,
        developer: this.cloud.developer,
        id: this.cloud.id,
        userId: this.cloud.userId,
        chain: this.cloud.chain,
        networkId: getNetworkIdHash().toJSON(),
      },
    });
    console.timeEnd("map saved to IPFS");
    if (mapHash === undefined) throw new Error("mapHash is undefined");
    const json = {
      blockNumber,
      timeCreated: time.toBigInt().toString(),
      contractAddress: contractAddress.toBase58(),
      blockAddress: blockPublicKey.toBase58(),
      root: root.toJSON(),
      blockProducer: blockProducer.publicKey.toBase58(),
      chainId: getNetworkIdHash().toJSON(),
      txsCount: txsCount.toBigint().toString(),
      txsHash: txsHash.toJSON(),
      previousBlockAddress: previousBlockAddress.toBase58(),
      previousValidBlockAddress: previousValidBlockAddress.toBase58(),
      oldRoot: oldRoot.toJSON(),
      transactions: elements.map((element) => {
        return {
          tx: element.serializedTx,
          fields: element.domainData?.toJSON(),
        };
      }),
      database: database.data,
      map: "i:" + mapHash,
    };
    const hash = await saveToIPFS({
      data: json,
      pinataJWT: process.env.PINATA_JWT!,
      name: `block.${blockNumber}.${contractAddress.toBase58()}.json`,
      keyvalues: {
        blockNumber: blockNumber.toString(),
        type: "block data",
        contractAddress: contractAddress.toBase58(),
        repo: this.cloud.repo,
        developer: this.cloud.developer,
        id: this.cloud.id,
        userId: this.cloud.userId,
        chain: this.cloud.chain,
        networkId: getNetworkIdHash().toJSON(),
      },
    });
    if (hash === undefined) throw new Error("hash is undefined");

    console.log(
      `Block ${blockNumber} created with hash ${hash} and map hash ${mapHash}`
    );

    const blockStorage = Storage.fromIpfsHash(hash);
    if (
      blockProducer.privateKey.toPublicKey().toBase58() !==
      blockProducer.publicKey.toBase58()
    )
      throw new Error("blockProducer keys mismatch");

    console.timeEnd("block calculated");
    await this.compile();

    if (
      DomainNameServiceWorker.mapUpdateVerificationKey === undefined ||
      DomainNameServiceWorker.blockContractVerificationKey === undefined ||
      DomainNameServiceWorker.validatorsVerificationKey === undefined ||
      DomainNameServiceWorker.contractVerificationKey === undefined
    )
      throw new Error("verificationKey is undefined");
    const blockVerificationKey: VerificationKey =
      DomainNameServiceWorker.blockContractVerificationKey;
    const validatorsVerificationKey: VerificationKey =
      DomainNameServiceWorker.validatorsVerificationKey;

    console.time("validators proof");

    const decision = new ValidatorsDecision({
      contractAddress,
      chainId: getNetworkIdHash(),
      validatorsRoot: validators.root,
      decisionType: ValidatorDecisionType.createBlock,
      data: BlockCreationData.toFields({
        oldRoot,
        blockAddress: blockPublicKey,
        blockProducer: blockProducer.publicKey,
        previousBlockAddress,
        verificationKeyHash:
          DomainNameServiceWorker.blockContractVerificationKey.hash,
      }),
      expiry: UInt64.from(Date.now() + 1000 * 60 * 60 * 24 * 2000),
    });
    const proof: ValidatorsVotingProof = await calculateValidatorsProof(
      decision,
      validatorsVerificationKey,
      false
    );
    if (proof.publicInput.hash.toJSON() !== validators.hash.toJSON())
      throw new Error("Invalid validatorsHash");
    const ok = await verify(proof, validatorsVerificationKey);
    if (!ok) throw new Error("proof verification failed");
    console.log("validators proof verified:", ok);
    console.timeEnd("validators proof");

    console.time("prepared tx");
    const blockData: BlockData = new BlockData({
      blockAddress: blockPublicKey,
      root,
      storage: blockStorage,
      txsHash,
      blockNumber: UInt64.from(blockNumber),
      blockParams: new BlockParams({
        txsCount,
        timeCreated: time,
        isFinal: Bool(false),
        isProved: Bool(false),
        isInvalid: Bool(false),
        isValidated: Bool(false),
      }).pack(),
      previousBlockAddress: previousBlockAddress,
    });

    await fetchMinaAccount({ publicKey: blockProducer.publicKey, force: true });
    const blockProducerBalance = await accountBalanceMina(
      blockProducer.publicKey
    );
    console.log("Block producer balance:", blockProducerBalance);
    if (blockProducerBalance < 20) {
      console.error("Block producer balance is less than 20 MINA");
    }

    if (blockProducerBalance < 10) {
      console.log(
        "Block producer balance is less than 10 MINA, replenishing..."
      );
      const deployer = await this.cloud.getDeployer();
      if (deployer !== undefined) {
        const deployerPublicKey = deployer.toPublicKey();
        const transaction = await Mina.transaction(
          { sender: deployerPublicKey, fee: "100000000", memo: "payment" },
          async () => {
            const senderUpdate = AccountUpdate.createSigned(deployerPublicKey);
            senderUpdate.send({
              to: blockProducer.publicKey,
              amount: 25_000_000_000,
            });
          }
        );
        const txSent = await transaction.sign([deployer]).send();
        console.log("Replenishing block producer balance tx sent:", {
          status: txSent.status,
          hash: txSent.hash,
        });
      }
    }

    console.log(`Sending tx for block ${blockNumber}...`);
    const memo = `block ${blockNumber} created: ${count} txs`.substring(0, 30);
    const tx = await Mina.transaction(
      { sender: blockProducer.publicKey, fee: await fee(), memo },
      async () => {
        AccountUpdate.fundNewAccount(blockProducer.publicKey);
        await zkApp.block(proof, blockData, blockVerificationKey); //signature,
      }
    );

    tx.sign([blockProducer.privateKey, blockPrivateKey]);
    try {
      await tx.prove();
      console.timeEnd("prepared tx");
      const txSent = await tx.send();
      console.log(
        `Block ${blockNumber} sent with hash ${txSent.hash} and status ${txSent.status}`
      );
      if (txSent.status !== "pending") {
        console.error("Error sending block creation transaction");
        console.timeEnd(`block created`);
        await this.stop();
        return "Error sending block creation transaction";
      }
      if (waitTx) {
        const txIncluded = await txSent.wait();
        console.log(
          `create block ${blockNumber} tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`
        );
        await sleep(20000);
      }

      await this.cloud.addTask({
        args: JSON.stringify(
          {
            contractAddress: args.contractAddress,
            blockAddress: blockPublicKey.toBase58(),
            txHash: txSent.hash,
            blockNumber,
          },
          null,
          2
        ),
        task: "validateBlock",
        metadata: `block ${blockNumber} validation`,
        userId: this.cloud.userId,
        maxAttempts: 20,
      });
      for (let i = 0; i < length; i++) {
        await this.cloud.deleteTransaction(txs[i].txId);
      }
      console.timeEnd(`block created`);
      await this.stop();
      return txSent.hash;
    } catch (error) {
      console.error("Error sending block creation transaction", error);
      console.timeEnd(`block created`);
      await this.stop();
      return "Error sending block creation transaction";
    }
  }
}

export async function zkcloudworker(cloud: Cloud): Promise<zkCloudWorker> {
  return new DomainNameServiceWorker(cloud);
}

/*
  public async send(transaction: string): Promise<string | undefined> {
    
    minaInit();
    const deployer = await getDeployer();
    const sender = deployer.toPublicKey();
    const contractAddress = PublicKey.fromBase58(this.args[1]);
    const zkApp = new MapContract(contractAddress);
    await fetchMinaAccount(deployer.toPublicKey());
    await fetchMinaAccount(contractAddress);
    let tx;

    const args = JSON.parse(transaction);
    if (this.args[0] === "add") {
      const name = Field.fromJSON(args.name);
      const address = PublicKey.fromBase58(args.address);
      const signature = Signature.fromBase58(args.signature);
      const storage: Storage = new Storage({
        hashString: [
          Field.fromJSON(args.storage[0]),
          Field.fromJSON(args.storage[1]),
        ],
      });

      tx = await Mina.transaction(
        { sender, fee: await fee(), memo: "add" },
        () => {
          zkApp.add(name, address, storage, signature);
        }
      );
    } else if (this.args[0] === "reduce") {
      try {
        const startActionState = Field.fromJSON(args.startActionState);
        const endActionState = Field.fromJSON(args.endActionState);
        const reducerState = new ReducerState({
          count: Field.fromJSON(args.reducerState.count),
          hash: Field.fromJSON(args.reducerState.hash),
        });
        const count = Number(reducerState.count.toBigInt());
        console.log("ReducerState count", reducerState.count.toJSON());
        await fetchMinaActions(contractAddress, startActionState);

        const proof: MapUpdateProof = MapUpdateProof.fromJSON(
          JSON.parse(args.proof) as JsonProof
        );
        console.log("proof count", proof.publicInput.count.toJSON());
        const signature = Signature.fromBase58(args.signature);

        tx = await Mina.transaction(
          { sender, fee: await fee(), memo: "reduce" },
          () => {
            zkApp.reduce(
              startActionState,
              endActionState,
              reducerState,
              proof,
              signature
            );
          }
        );
      } catch (error) {
        console.log("Error in reduce", error);
      }
    } else if (this.args[0] === "setRoot") {
      const root = Field.fromJSON(args.root);
      const count = Field.fromJSON(args.count);
      const signature = Signature.fromBase58(args.signature);

      tx = await Mina.transaction(
        { sender, fee: await fee(), memo: "reset" },
        () => {
          zkApp.setRoot(root, count, signature);
        }
      );
    } else throw new Error("unknown action");

    if (tx === undefined) throw new Error("tx is undefined");
    await tx.prove();
    const txSent = await tx.sign([deployer]).send();
    if (txSent === undefined) throw new Error("tx is undefined");
    const hash: string | undefined = txSent.hash;
    if (hash === undefined) throw new Error("hash is undefined");
    return hash;
    
    throw new Error("not implemented");
  }

  public async mint(transaction: string): Promise<string | undefined> {
    throw new Error("not implemented");
  }
  */
