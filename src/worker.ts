import {
  zkCloudWorker,
  Cloud,
  sleep,
  fee,
  DeployedSmartContract,
  getNetworkIdHash,
  CloudTransaction,
} from "zkcloudworker";
import os from "os";
import assert from "node:assert/strict";
import {
  verify,
  JsonProof,
  VerificationKey,
  Field,
  PublicKey,
  Signature,
  fetchAccount,
  Mina,
  setNumberOfWorkers,
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

import { validatorsPrivateKeys } from "../src/config";
import {
  ValidatorsDecision,
  ValidatorDecisionExtraData,
  ValidatorsVoting,
  ValidatorsVotingProof,
  ValidatorDecisionType,
} from "../src/rollup/validators";
import {
  DomainNameContract,
  BlockContract,
  BlockData,
  NewBlockTransactions,
  Flags,
} from "../src/contract/domain-contract";
import { stringToFields } from "../src/lib/hash";
import {
  getValidatorsTreeAndHash,
  calculateValidatorsProof,
} from "../src/rollup/validators-proof";

import { createBlock } from "../src/rollup/blocks";
import { MerkleMap } from "../src/lib/merkle-map";
import { MerkleTree } from "../src/lib/merkle-tree";
import { DomainDatabase } from "../src/rollup/database";
import { saveToIPFS, loadFromIPFS } from "../src/contract/storage";
import { p } from "o1js/dist/node/bindings/crypto/finite-field";
const pinataJWT = process.env.PINATA_JWT ?? "local";
const fullValidation = true;

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

  private async compile(): Promise<void> {
    if (DomainNameServiceWorker.mapUpdateVerificationKey !== undefined) {
      return;
    }
    const cpuCores = os.cpus();
    const numberOfCPUCores = cpuCores.length;
    console.log("CPU cores:", numberOfCPUCores);
    console.time("compiled MapUpdate");
    DomainNameServiceWorker.mapUpdateVerificationKey = (
      await MapUpdate.compile({
        cache: this.cloud.cache,
      })
    ).verificationKey;
    console.timeEnd("compiled MapUpdate");
  }

  public async create(transaction: string): Promise<string | undefined> {
    await this.compile();

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
    return JSON.stringify(proof.toJSON(), null, 2);
  }

  public async merge(
    proof1: string,
    proof2: string
  ): Promise<string | undefined> {
    await this.compile();
    try {
      if (DomainNameServiceWorker.mapUpdateVerificationKey === undefined)
        throw new Error("verificationKey is undefined");
      console.time("merge mapPoof");

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
      console.timeEnd("merge mapPoof");
      return JSON.stringify(proof.toJSON(), null, 2);
    } catch (error) {
      console.log("Error in merge", error);
      throw error;
    }
  }

  public async execute(transactions: string[]): Promise<string | undefined> {
    switch (this.cloud.task) {
      case "createBlock":
        return await this.createRollupBlock(transactions);
      default:
        console.error("Unknown task", this.cloud.task);
        return undefined;
    }
  }

  public async task(): Promise<string | undefined> {
    if (this.cloud.task === undefined) throw new Error("task is undefined");
    try {
      switch (this.cloud.task) {
        case "validateBlock":
          return await this.validateRollupBlock();
        case "proveBlock":
          return await this.proveRollupBlock();
        default:
          console.error("Unknown task", this.cloud.task);
          return undefined;
      }
    } catch (error) {
      console.error("Error in task", error);
      return undefined;
    }
  }

  private async proveRollupBlock(): Promise<string | undefined> {
    // TODO: add fetchAccount and check that block validation tx is confirmed
    if (this.cloud.args === undefined)
      throw new Error("this.cloud.args is undefined");
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
    if (result.result === undefined) return "proof is not ready";
    const proof: MapUpdateProof = MapUpdateProof.fromJSON(
      JSON.parse(result.result) as JsonProof
    );

    const contractAddress = PublicKey.fromBase58(args.contractAddress);
    const blockAddress = PublicKey.fromBase58(args.blockAddress);
    const zkApp = new DomainNameContract(contractAddress);

    const deployer = await this.cloud.getDeployer();
    if (deployer === undefined) throw new Error("deployer is undefined");
    const sender = deployer.toPublicKey();

    const tx = await Mina.transaction(
      { sender, fee: await fee(), memo: "zkCloudWorker" },
      () => {
        zkApp.proveBlock(proof, blockAddress);
      }
    );

    await tx.prove();
    const txSent = await tx.sign([deployer]).send();
    if (txSent.status !== "pending")
      throw new Error("Error sending block creation transaction");
    console.log("Deleting proveBlock task", this.cloud.taskId);
    await this.cloud.deleteTask(this.cloud.taskId);
    return txSent.hash;
  }

  private async validateRollupBlock(): Promise<string | undefined> {
    // TODO: add fetchAccount and check that block creation tx is confirmed

    if (this.cloud.args === undefined)
      throw new Error("this.cloud.args is undefined");
    const args = JSON.parse(this.cloud.args);
    console.log(`Validating block ${args.blockNumber}...`);
    if (args.contractAddress === undefined)
      throw new Error("args.contractAddress is undefined");
    if (args.blockAddress === undefined)
      throw new Error("args.blockAddress is undefined");
    let validated = true;
    let decision: ValidatorsDecision | undefined = undefined;
    let proofData: string[] = [];
    console.time(`block validated`);
    const contractAddress = PublicKey.fromBase58(args.contractAddress);
    const blockAddress = PublicKey.fromBase58(args.blockAddress);
    const zkApp = new DomainNameContract(contractAddress);
    const validatorsRoot = zkApp.validators.get();
    const validatorsHash = zkApp.validatorsHash.get();
    try {
      const tokenId = zkApp.deriveTokenId();
      const block = new BlockContract(blockAddress, tokenId);
      const previousBlockAddress = block.previousBlock.get();
      const previousBlock = new BlockContract(previousBlockAddress, tokenId);
      const blockNumber = Number(block.blockNumber.get().toBigInt());

      const map = new MerkleMap();
      const oldMap = new MerkleMap();

      const blockStorage = block.storage.get();
      const hash = blockStorage.toIpfsHash();
      const data = await loadFromIPFS(hash);
      const json = JSON.parse(data);
      if (json.map === undefined) throw new Error("json.map is undefined");
      if (json.map.startsWith("i:") === false)
        throw new Error("json.map does not start with 'i:'");
      const mapData = await loadFromIPFS(json.map.substring(2));
      const mapJson = JSON.parse(mapData);
      let database = new DomainDatabase();

      console.log("blockNumber", blockNumber);
      if (blockNumber > 1) {
        console.log("getting previous block data for validation...");
        const previousBlockStorage = previousBlock.storage.get();
        const previousBlockRoot = previousBlock.root.get();
        const previousBlockHash = previousBlockStorage.toIpfsHash();
        const previousBlockData = await loadFromIPFS(previousBlockHash);
        const previousBlockJson = JSON.parse(previousBlockData);
        //console.log("previousBlockJson map:", previousBlockJson.map);
        if (previousBlockJson.map === undefined)
          throw new Error("previousBlockJson.map is undefined");
        if (previousBlockJson.map.startsWith("i:") === false)
          throw new Error("previousBlockJson.map does not start with 'i:'");
        const previousBlockMapData = await loadFromIPFS(
          previousBlockJson.map.substring(2)
        );
        const previousBlockMapJson = JSON.parse(previousBlockMapData);
        database = new DomainDatabase(previousBlockJson.database);
        oldMap.tree = MerkleTree.fromCompressedJSON(previousBlockMapJson.map);
        const oldRoot = oldMap.getRoot();
        if (previousBlockRoot.toJSON() !== oldRoot.toJSON())
          throw new Error("Invalid previous block root");
      }
      map.tree = MerkleTree.fromCompressedJSON(mapJson.map);
      const transactionData: DomainTransactionData[] = json.txs.map((tx: any) =>
        DomainTransactionData.fromJSON(JSON.parse(tx))
      );
      const root = block.root.get();
      if (root.toJSON() !== map.getRoot().toJSON())
        throw new Error("Invalid block root");
      const storage = block.storage.get();
      const txs = block.txs.get();

      const {
        root: calculatedRoot,
        txs: calculatedTxs,
        proofData: calculatedProofData,
      } = createBlock({
        elements: transactionData,
        map: oldMap,
        database,
        calculateTransactions: true,
      });
      proofData = calculatedProofData;
      if (calculatedRoot.toJSON() !== root.toJSON())
        throw new Error("Invalid block root");
      if (calculatedTxs.hash().toJSON() !== txs.toJSON())
        throw new Error("Invalid block transactions");
      const loadedDatabase = new DomainDatabase(json.database);
      assert.deepStrictEqual(database.data, loadedDatabase.data);
      if (root.toJSON() !== database.getRoot().toJSON())
        throw new Error("Invalid block root");
      if (root.toJSON() !== loadedDatabase.getRoot().toJSON())
        throw new Error("Invalid block root");
      console.log(`Block ${blockNumber} is valid`);
      decision = new ValidatorsDecision({
        contract: contractAddress,
        chainId: getNetworkIdHash(),
        root: validatorsRoot,
        decision: ValidatorDecisionType.validate,
        address: blockAddress,
        data: ValidatorDecisionExtraData.fromBlockValidationData({
          storage,
          txs,
          root,
        }),
        expiry: UInt64.from(Date.now() + 1000 * 60 * 60),
      });
    } catch (error) {
      console.error("Error in validateBlock", error);
      validated = false;
      decision = new ValidatorsDecision({
        contract: contractAddress,
        chainId: getNetworkIdHash(),
        root: validatorsRoot,
        decision: ValidatorDecisionType.badBlock,
        address: blockAddress,
        data: ValidatorDecisionExtraData.empty(),
        expiry: UInt64.from(Date.now() + 1000 * 60 * 60),
      });
    }

    if (decision === undefined) throw new Error("decision is undefined");
    if (DomainNameServiceWorker.validatorsVerificationKey === undefined) {
      console.time("compiled ValidatorsVoting");
      DomainNameServiceWorker.validatorsVerificationKey = (
        await ValidatorsVoting.compile({
          cache: this.cloud.cache,
        })
      ).verificationKey;
      console.timeEnd("compiled ValidatorsVoting");
    }
    const validatorsVerificationKey: VerificationKey =
      DomainNameServiceWorker.validatorsVerificationKey;
    const proof: ValidatorsVotingProof = await calculateValidatorsProof(
      decision,
      validatorsVerificationKey,
      false
    );

    if (
      validatorsHash !== undefined &&
      proof.publicInput.hash.toJSON() !== validatorsHash.toJSON()
    )
      throw new Error("Invalid validatorsHash");

    const deployer = await this.cloud.getDeployer();
    if (deployer === undefined) throw new Error("deployer is undefined");
    const sender = deployer.toPublicKey();

    const tx = await Mina.transaction(
      { sender, fee: await fee(), memo: "zkCloudWorker" },
      () => {
        validated ? zkApp.validateBlock(proof) : zkApp.badBlock(proof);
      }
    );

    await tx.prove();
    const txSent = await tx.sign([deployer]).send();
    if (txSent.status !== "pending")
      throw new Error("Error sending block creation transaction");
    console.log("Deleting validateBlock task", this.cloud.taskId);
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
    console.timeEnd(`block validated`);
    return txSent.hash;
  }

  private async createRollupBlock(
    transactions: string[]
  ): Promise<string | undefined> {
    if (this.cloud.args === undefined)
      throw new Error("this.cloud.args is undefined");
    const args = JSON.parse(this.cloud.args);
    if (args.contractAddress === undefined)
      throw new Error("args.contractAddress is undefined");
    const contractAddress = PublicKey.fromBase58(args.contractAddress);
    const zkApp = new DomainNameContract(contractAddress);
    const tokenId = zkApp.deriveTokenId();
    const previousBlockAddress = zkApp.lastBlock.get();
    const previousBlock = new BlockContract(previousBlockAddress, tokenId);
    const blockNumber = Number(previousBlock.blockNumber.get().toBigInt()) + 1;
    console.time(`block ${blockNumber} created`);
    const validatorsRoot = zkApp.validators.get();
    const validatorsHash = zkApp.validatorsHash.get();
    let database: DomainDatabase = new DomainDatabase();
    let map = new MerkleMap();
    const previousBlockRoot = previousBlock.root.get();
    if (blockNumber > 1) {
      const storage = previousBlock.storage.get();
      const hash = storage.toIpfsHash();
      const data = await loadFromIPFS(hash);
      const json = JSON.parse(data);
      if (json.map === undefined) throw new Error("json.map is undefined");
      if (json.map.startsWith("i:") === false)
        throw new Error("json.map does not start with 'i:'");
      const mapData = await loadFromIPFS(json.map.substring(2));
      const mapJson = JSON.parse(mapData);
      map.tree = MerkleTree.fromCompressedJSON(mapJson.map);
      database = new DomainDatabase(json.database);
    }

    if (fullValidation) {
      if (
        database.getRoot().toJSON() !== previousBlockRoot.toJSON() ||
        map.getRoot().toJSON() !== previousBlockRoot.toJSON()
      )
        throw new Error("Invalid previous block");
    }

    const { root, oldRoot, txs } = createBlock({
      elements: transactions.map((tx) =>
        DomainTransactionData.fromJSON(JSON.parse(tx))
      ),
      map,
      database,
    });

    const mapJson = {
      map: map.tree.toCompressedJSON(),
    };
    if (fullValidation) {
      const restoredMap = new MerkleMap();
      restoredMap.tree = MerkleTree.fromCompressedJSON(mapJson.map);
      if (restoredMap.getRoot().toJSON() !== root.toJSON())
        throw new Error("Invalid root");
    }

    const strMapJson = JSON.stringify(mapJson, null, 2);
    const mapHash = await saveToIPFS(strMapJson, pinataJWT);
    expect(mapHash).toBeDefined();
    if (mapHash === undefined) throw new Error("mapHash is undefined");
    const json = {
      txs: transactions,
      database: database.data,
      map: "i:" + mapHash,
    };
    const strJson = JSON.stringify(json, null, 2);
    const hash = await saveToIPFS(strJson, pinataJWT);
    expect(hash).toBeDefined();
    if (hash === undefined) throw new Error("hash is undefined");

    console.log(
      `Block ${blockNumber} JSON size: ${strJson.length.toLocaleString()}, map JSON size: ${strMapJson.length.toLocaleString()}`
    );

    const blockStorage = Storage.fromIpfsHash(hash);
    const blockPrivateKey = PrivateKey.random();
    const blockPublicKey = blockPrivateKey.toPublicKey();
    const blockProducerPrivateKey = PrivateKey.random();
    const blockProducerPublicKey = blockProducerPrivateKey.toPublicKey();
    if (DomainNameServiceWorker.blockContractVerificationKey === undefined) {
      console.time("compiled BlockContract");
      DomainNameServiceWorker.blockContractVerificationKey = (
        await BlockContract.compile({
          cache: this.cloud.cache,
        })
      ).verificationKey;
      console.timeEnd("compiled BlockContract");
    }
    const blockVerificationKey: VerificationKey =
      DomainNameServiceWorker.blockContractVerificationKey;
    if (DomainNameServiceWorker.validatorsVerificationKey === undefined) {
      console.time("compiled ValidatorsVoting");
      DomainNameServiceWorker.validatorsVerificationKey = (
        await ValidatorsVoting.compile({
          cache: this.cloud.cache,
        })
      ).verificationKey;
      console.timeEnd("compiled ValidatorsVoting");
    }
    const validatorsVerificationKey: VerificationKey =
      DomainNameServiceWorker.validatorsVerificationKey;

    const decision = new ValidatorsDecision({
      contract: contractAddress,
      chainId: getNetworkIdHash(),
      root: validatorsRoot,
      decision: ValidatorDecisionType.createBlock,
      address: blockProducerPublicKey,
      data: ValidatorDecisionExtraData.fromBlockCreationData({
        verificationKey: blockVerificationKey,
        blockPublicKey,
        oldRoot,
      }),
      expiry: UInt64.from(Date.now() + 1000 * 60 * 60),
    });
    const proof: ValidatorsVotingProof = await calculateValidatorsProof(
      decision,
      validatorsVerificationKey,
      false
    );
    if (proof.publicInput.hash.toJSON() !== validatorsHash.toJSON())
      throw new Error("Invalid validatorsHash");

    const blockData: BlockData = new BlockData({
      address: blockPublicKey,
      root,
      storage: blockStorage,
      txs,
      isFinal: Bool(false),
      isProved: Bool(false),
      isInvalid: Bool(false),
      isValidated: Bool(false),
      blockNumber: Field(blockNumber),
    });
    const signature = Signature.create(
      blockProducerPrivateKey,
      BlockData.toFields(blockData)
    );

    if (DomainNameServiceWorker.contractVerificationKey === undefined) {
      console.time("compiled DomainNameContract");
      DomainNameServiceWorker.contractVerificationKey = (
        await DomainNameContract.compile({
          cache: this.cloud.cache,
        })
      ).verificationKey;
      console.timeEnd("compiled DomainNameContract");
    }

    const deployer = await this.cloud.getDeployer();
    if (deployer === undefined) throw new Error("deployer is undefined");
    const sender = deployer.toPublicKey();

    const tx = await Mina.transaction(
      { sender, fee: await fee(), memo: "zkCloudWorker" },
      () => {
        AccountUpdate.fundNewAccount(sender);
        zkApp.block(proof, signature, blockData, blockVerificationKey);
      }
    );

    await tx.prove();
    const txSent = await tx.sign([deployer, blockPrivateKey]).send();
    if (txSent.status !== "pending")
      throw new Error("Error sending block creation transaction");
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
    console.timeEnd(`block ${blockNumber} created`);
    return txSent.hash;
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