import {
  zkCloudWorker,
  Cloud,
  fee,
  DeployedSmartContract,
  fetchMinaAccount,
  sleep,
  getNetworkIdHash,
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
} from "o1js";
import {
  MapTransition,
  MapUpdate,
  MapUpdateData,
  MapUpdateProof,
  DomainTransactionData,
} from "./rollup/transaction";
import { Storage } from "./contract/storage";
import { deserializeFields } from "./lib/fields";
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
} from "./contract/domain-contract";
import { calculateValidatorsProof } from "./rollup/validators-proof";
import { createBlock } from "./rollup/blocks";
import { MerkleMap } from "./lib/merkle-map";
import { MerkleTree } from "./lib/merkle-tree";
import { DomainDatabase } from "./rollup/database";
import { saveToIPFS, loadFromIPFS } from "./contract/storage";
import { blockProducer } from "./config";

const fullValidation = true;
const waitTx = false;

export class DomainNameServiceWorker extends zkCloudWorker {
  static mapUpdateVerificationKey: VerificationKey | undefined = undefined;
  static contractVerificationKey: VerificationKey | undefined = undefined;
  static blockContractVerificationKey: VerificationKey | undefined = undefined;
  static validatorsVerificationKey: VerificationKey | undefined = undefined;

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
    await this.compile(false);
    console.time("proof created");

    if (DomainNameServiceWorker.mapUpdateVerificationKey === undefined)
      throw new Error("verificationKey is undefined");

    const args = JSON.parse(transaction);
    const isAccepted = args.isAccepted;
    const state: MapTransition = MapTransition.fromFields(
      deserializeFields(args.state)
    ) as MapTransition;

    let proof: MapUpdateProof;
    //if (isAccepted === true) {
    const update: MapUpdateData = MapUpdateData.fromFields(
      deserializeFields(args.update)
    ) as MapUpdateData;

    proof = await MapUpdate.add(state, update);
    /*
    } 
    else {
      const name = Field.fromJSON(args.name);
      const root = Field.fromJSON(args.root);
      proof = await MapUpdate.reject(state, root, name, address);
    }
    */
    const ok = await verify(
      proof.toJSON(),
      DomainNameServiceWorker.mapUpdateVerificationKey
    );
    if (!ok) throw new Error("proof verification failed");
    console.timeEnd("proof created");
    return JSON.stringify(proof.toJSON(), null, 2);
  }

  public async merge(
    proof1: string,
    proof2: string
  ): Promise<string | undefined> {
    await this.compile(false);
    try {
      if (DomainNameServiceWorker.mapUpdateVerificationKey === undefined)
        throw new Error("verificationKey is undefined");
      console.time("proof merged");

      const sourceProof1: MapUpdateProof = MapUpdateProof.fromJSON(
        JSON.parse(proof1) as JsonProof
      );
      const sourceProof2: MapUpdateProof = MapUpdateProof.fromJSON(
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
      throw error;
    }
  }

  public async execute(transactions: string[]): Promise<string | undefined> {
    switch (this.cloud.task) {
      case "createTxTask":
        return await this.createTxTask();
      default:
        console.error("Unknown task in execute:", this.cloud.task);
        return undefined;
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
          return undefined;
      }
    } catch (error) {
      console.error("Error in task", error);
      return undefined;
    }
  }

  private async txTask(): Promise<string | undefined> {
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
        const result = await this.createRollupBlock(
          transactions.map((tx) => tx.transaction)
        );
        for (const tx of transactions) {
          await this.cloud.deleteTransaction(tx.txId);
        }
        return result;
      } catch (error) {
        console.error("Error in txTask", error);
        return undefined;
      }
    }
  }

  private async createTxTask(): Promise<string | undefined> {
    // TODO: add fetchMinaAccount and check that block validation tx is confirmed
    if (this.cloud.args === undefined)
      throw new Error("this.cloud.args is undefined");
    const args = JSON.parse(this.cloud.args);
    console.log(`Adding txTask...`);
    if (args.contractAddress === undefined)
      throw new Error("args.contractAddress is undefined");
    await this.cloud.addTask({
      args: JSON.stringify(
        {
          contractAddress: args.contractAddress,
        },
        null,
        2
      ),
      task: "txTask",
      metadata: this.cloud.metadata,
      userId: this.cloud.userId,
    });
    return "txTask added";
  }

  private async proveRollupBlock(): Promise<string | undefined> {
    // TODO: add fetchMinaAccount and check that block validation tx is confirmed
    if (this.cloud.args === undefined)
      throw new Error("this.cloud.args is undefined");
    console.time("proveBlock");

    const args = JSON.parse(this.cloud.args);
    console.log(`Proving block ${args.blockNumber}...`);
    if (args.contractAddress === undefined)
      throw new Error("args.contractAddress is undefined");
    if (args.blockAddress === undefined)
      throw new Error("args.blockAddress is undefined");
    if (args.txHash === undefined) throw new Error("args.txHash is undefined");
    if (args.jobId === undefined) throw new Error("args.jobId is undefined");
    const result = await this.cloud.jobResult(args.jobId);
    if (result === undefined) throw new Error("job is undefined");
    if (result.result === undefined) {
      console.timeEnd("proveBlock");
      return undefined;
    }
    const proof: MapUpdateProof = MapUpdateProof.fromJSON(
      JSON.parse(result.result) as JsonProof
    );

    const contractAddress = PublicKey.fromBase58(args.contractAddress);
    const blockAddress = PublicKey.fromBase58(args.blockAddress);
    const blockNumber = args.blockNumber;
    const zkApp = new DomainNameContract(contractAddress);
    const tokenId = zkApp.deriveTokenId();
    await fetchMinaAccount({ publicKey: blockAddress, tokenId, force: false });
    if (!Mina.hasAccount(blockAddress, tokenId)) {
      console.log(`Block ${blockAddress.toBase58()} not found`);
      console.timeEnd("proveBlock");
      return undefined;
    }
    const block = new BlockContract(blockAddress, tokenId);
    const flags = BlockParams.unpack(block.blockParams.get());
    if (flags.isValidated.toBoolean() === false) {
      console.log(`Block ${blockNumber} is not yet validated`);
      console.timeEnd("proveBlock");
      return undefined;
    }
    if (flags.isInvalid.toBoolean() === true) {
      console.error(`Block ${blockNumber} is invalid`);
      await this.cloud.deleteTask(this.cloud.taskId);
      console.timeEnd("proveBlock");
      return undefined;
    }

    if (flags.isProved.toBoolean() === true) {
      console.error(`Block ${blockNumber} is already proved`);
      await this.cloud.deleteTask(this.cloud.taskId);
      console.timeEnd("proveBlock");
      return undefined;
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
        await zkApp.proveBlock(proof, blockAddress);
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
    return txSent.hash;
  }

  private async validateRollupBlock(): Promise<string | undefined> {
    // TODO: add fetchMinaAccount and check that block creation tx is confirmed

    if (this.cloud.args === undefined)
      throw new Error("this.cloud.args is undefined");
    const args = JSON.parse(this.cloud.args);
    console.time(`block ${args.blockNumber} validated`);

    if (args.contractAddress === undefined)
      throw new Error("args.contractAddress is undefined");
    if (args.blockAddress === undefined)
      throw new Error("args.blockAddress is undefined");
    let validated = true;
    let decision: ValidatorsDecision | undefined = undefined;
    let proofData: string[] = [];
    const contractAddress = PublicKey.fromBase58(args.contractAddress);
    const blockAddress = PublicKey.fromBase58(args.blockAddress);
    const zkApp = new DomainNameContract(contractAddress);
    const tokenId = zkApp.deriveTokenId();
    await fetchMinaAccount({ publicKey: contractAddress, force: true });
    const validators = zkApp.validators.get();

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
        return undefined;
      }

      const block = new BlockContract(blockAddress, tokenId);
      const previousBlockAddress = block.previousBlock.get();
      await fetchMinaAccount({
        publicKey: previousBlockAddress,
        tokenId,
        force: true,
      });

      const previousBlock = new BlockContract(previousBlockAddress, tokenId);
      blockNumber = Number(block.blockNumber.get().toBigInt());

      const map = new MerkleMap();
      const oldMap = new MerkleMap();

      const blockStorage = block.storage.get();
      const hash = blockStorage.toIpfsHash();
      //const data = await loadFromIPFS(hash);
      //const json = JSON.parse(data);
      const json = await loadFromIPFS(hash);
      if (json.map === undefined) throw new Error("json.map is undefined");
      if (json.map.startsWith("i:") === false)
        throw new Error("json.map does not start with 'i:'");
      const mapJson = await loadFromIPFS(json.map.substring(2));
      //const mapJson = JSON.parse(mapData);
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
        oldMap.tree = MerkleTree.fromJSON(previousBlockMapJson.map);
        const oldRoot = oldMap.getRoot();
        if (previousBlockRoot.toJSON() !== oldRoot.toJSON())
          throw new Error("Invalid previous block root");
      }
      map.tree = MerkleTree.fromJSON(mapJson.map);
      const transactionData: DomainTransactionData[] = json.txs.map((tx: any) =>
        DomainTransactionData.fromJSON(JSON.parse(tx))
      );
      const root = block.root.get();
      if (root.toJSON() !== map.getRoot().toJSON())
        throw new Error("Invalid block root");

      const blockParams = BlockParams.unpack(block.blockParams.get());
      const time = blockParams.timeCreated;

      const {
        root: calculatedRoot,
        txsHash: calculatedTxsHash,
        txsCount: calculatedTxsCount,
        proofData: calculatedProofData,
      } = createBlock({
        elements: transactionData,
        map: oldMap,
        time,
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
    }

    if (decision === undefined) throw new Error("decision is undefined");
    await this.compile();
    if (
      DomainNameServiceWorker.mapUpdateVerificationKey === undefined ||
      DomainNameServiceWorker.blockContractVerificationKey === undefined ||
      DomainNameServiceWorker.validatorsVerificationKey === undefined ||
      DomainNameServiceWorker.contractVerificationKey === undefined
    )
      throw new Error("verificationKey is undefined");

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
          : `block ${blockNumber} is invalid`,
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
        metadata: this.cloud.metadata,
        userId: this.cloud.userId,
      });
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
        metadata: this.cloud.metadata,
        userId: this.cloud.userId,
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
    return txSent.hash;
  }

  private async createRollupBlock(
    transactions: string[]
  ): Promise<string | undefined> {
    console.log(`Creating block with ${transactions.length} transactions...`);
    //console.log("transactions", transactions);
    //console.log("this.cloud", this.cloud);
    if (this.cloud.args === undefined)
      throw new Error("this.cloud.args is undefined");
    const args = JSON.parse(this.cloud.args);
    console.log("args", args);
    if (args.contractAddress === undefined)
      throw new Error("args.contractAddress is undefined");
    console.time(`block created`);

    const contractAddress = PublicKey.fromBase58(args.contractAddress);
    const zkApp = new DomainNameContract(contractAddress);
    const tokenId = zkApp.deriveTokenId();
    await fetchMinaAccount({ publicKey: contractAddress, force: true });
    const validators = zkApp.validators.get();
    const previousBlockAddress = zkApp.lastBlockAddress.get();
    console.log("previousBlockAddress", previousBlockAddress.toBase58());
    const previousBlock = new BlockContract(previousBlockAddress, tokenId);
    await fetchMinaAccount({
      publicKey: previousBlockAddress,
      tokenId,
      force: true,
    });
    const blockNumber = Number(previousBlock.blockNumber.get().toBigInt()) + 1;
    console.log(`Creating block ${blockNumber}...`);

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
      map.tree = MerkleTree.fromJSON(mapJson.map);
      database = new DomainDatabase(json.database);
    }

    if (fullValidation) {
      if (
        database.getRoot().toJSON() !== previousBlockRoot.toJSON() ||
        map.getRoot().toJSON() !== previousBlockRoot.toJSON()
      )
        throw new Error("Invalid previous block");
    }

    const time = UInt64.from(Date.now());
    const { root, oldRoot, txsHash, txsCount } = createBlock({
      elements: transactions.map((tx) =>
        DomainTransactionData.fromJSON(JSON.parse(tx))
      ),
      map,
      time,
      database,
    });

    const mapJson = {
      map: map.tree.toJSON(),
    };
    if (fullValidation) {
      const restoredMap = new MerkleMap();
      restoredMap.tree = MerkleTree.fromJSON(mapJson.map);
      if (restoredMap.getRoot().toJSON() !== root.toJSON())
        throw new Error("Invalid root");
    }

    const blockPrivateKey = PrivateKey.random();
    const blockPublicKey = blockPrivateKey.toPublicKey();

    const mapHash = await saveToIPFS({
      data: mapJson,
      pinataJWT: process.env.PINATA_JWT!,
      name: `block.${blockNumber}.map.json`,
    });
    if (mapHash === undefined) throw new Error("mapHash is undefined");
    const json = {
      blockNumber,
      timeCreated: Date.now(),
      contractAddress: contractAddress.toBase58(),
      blockAddress: blockPublicKey.toBase58(),
      txs: transactions,
      database: database.data,
      map: "i:" + mapHash,
    };
    const hash = await saveToIPFS({
      data: json,
      pinataJWT: process.env.PINATA_JWT!,
      name: `block.${blockNumber}.json`,
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

    const blockData: BlockData = new BlockData({
      blockAddress: blockPublicKey,
      root,
      storage: blockStorage,
      txsHash,
      blockNumber: UInt64.from(blockNumber),
      blockParams: new BlockParams({
        txsCount,
        timeCreated: UInt64.from(Date.now()),
        isFinal: Bool(false),
        isProved: Bool(false),
        isInvalid: Bool(false),
        isValidated: Bool(false),
      }).pack(),
      previousBlockAddress: previousBlockAddress,
    });

    await fetchMinaAccount({ publicKey: blockProducer.publicKey, force: true });

    console.log(`Sending tx for block ${blockNumber}...`);
    const memo = `block ${blockNumber}`;
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
      const txSent = await tx.send();
      console.log(
        `Block ${blockNumber} sent with hash ${txSent.hash} and status ${txSent.status}`
      );
      if (txSent.status !== "pending") {
        console.error("Error sending block creation transaction");
        console.timeEnd(`block created`);
        return undefined;
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
        metadata: this.cloud.metadata,
        userId: this.cloud.userId,
      });
      console.timeEnd(`block created`);
      return txSent.hash;
    } catch (error) {
      console.error("Error sending block creation transaction", error);
      console.timeEnd(`block created`);
      return undefined;
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
