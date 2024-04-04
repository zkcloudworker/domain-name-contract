import { describe, expect, it } from "@jest/globals";
import assert from "node:assert/strict";
import {
  Field,
  PrivateKey,
  PublicKey,
  Signature,
  setNumberOfWorkers,
  Mina,
  AccountUpdate,
  VerificationKey,
  UInt64,
  JsonProof,
  verify,
  Bool,
} from "o1js";
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
import { Storage } from "../src/contract/storage";
import { nameContract, JWT } from "../src/config";
import {
  zkCloudWorkerClient,
  formatTime,
  makeString,
  initBlockchain,
  blockchain,
  getNetworkIdHash,
  accountBalanceMina,
  sleep,
} from "zkcloudworker";
import {
  DomainName,
  DomainNameValue,
  DomainTransaction,
  DomainTransactionData,
  DomainTransactionEnum,
  MapUpdate,
  MapUpdateProof,
} from "../src/rollup/transaction";
import { Metadata } from "../src/contract/metadata";
import { createBlock } from "../src/rollup/blocks";
import {
  calculateTransactionsProof,
  prepareProofData,
} from "../src/rollup/txs-proof";
import { MerkleMap } from "../src/lib/merkle-map";
import { MerkleTree } from "../src/lib/merkle-tree";
import { DomainDatabase } from "../src/rollup/database";
import { zkcloudworker } from "../src/worker";
import { saveToIPFS, loadFromIPFS } from "../src/contract/storage";

setNumberOfWorkers(8);
const network: blockchain = "local";
const pinataJWT = "local";
const useLocalCloudWorker = true;
const api = new zkCloudWorkerClient({
  jwt: useLocalCloudWorker ? "local" : JWT,
  zkcloudworker,
  chain: "local",
});

const { keys, networkIdHash } = initBlockchain(network, 1);
const { privateKey: deployer, publicKey: sender } = keys[0];

const fullValidation = true;
const ELEMENTS_NUMBER = 3;
const BLOCKS_NUMBER = 3;
const domainNames: DomainTransactionData[][] = [];

const { tree, totalHash } = getValidatorsTreeAndHash();
const validators = validatorsPrivateKeys.map((key) => key.toPublicKey());
const validatorsRoot = tree.getRoot();
const privateKey = PrivateKey.random();
const publicKey = privateKey.toPublicKey();

const zkApp = new DomainNameContract(publicKey);
let verificationKey: VerificationKey;
let blockVerificationKey: VerificationKey;
let mapVerificationKey: VerificationKey;
let tokenId: Field;
const map = new MerkleMap();
const proveMap = new MerkleMap();
let failed = false;

interface Block {
  address: PublicKey;
  txs: Field;
  root: Field;
  count: Field;
  storage: Storage;
  //json: string;
  //mapJson: string;
  jobId?: string;
  proofStartTime?: number;
  isProved: boolean;
  blockNumber: number;
}
const blocks: Block[] = [];

describe("Domain Name Service Contract", () => {
  it(`should prepare blocks data`, async () => {
    console.log("Preparing data...");
    console.time(`prepared data`);
    const nftStorage = new Storage({ hashString: [Field(0), Field(0)] });
    for (let j = 0; j < BLOCKS_NUMBER; j++) {
      const blockElements: DomainTransactionData[] = [];
      for (let i = 0; i < ELEMENTS_NUMBER; i++) {
        const domainName: DomainName = new DomainName({
          name: stringToFields(makeString(20))[0],
          data: new DomainNameValue({
            address: PrivateKey.random().toPublicKey(),
            metadata: new Metadata({
              data: Field(0),
              kind: Field(0),
            }),
            storage: nftStorage,
            expiry: UInt64.from(Date.now() + 1000 * 60 * 60 * 24 * 365),
          }),
        });
        const domainTransaction: DomainTransaction = new DomainTransaction({
          type: DomainTransactionEnum.add,
          domain: domainName,
        });
        const domainTransactionData: DomainTransactionData =
          new DomainTransactionData(domainTransaction);
        blockElements.push(domainTransactionData);
      }
      domainNames.push(blockElements);
    }
    console.timeEnd(`prepared data`);
  });

  it(`should compile and deploy contract`, async () => {
    const networkId = Mina.getNetworkId();
    console.log("Network ID:", networkId);
    const networkIdHash = getNetworkIdHash();
    console.log("Network ID hash:", networkIdHash.toJSON());
    //console.log("sender", sender.toBase58());
    console.log("Sender balance", await accountBalanceMina(sender));
    expect(deployer).toBeDefined();
    expect(sender).toBeDefined();
    expect(deployer.toPublicKey().toBase58()).toBe(sender.toBase58());

    console.time("methods analyzed");
    const methods = [
      {
        name: "DomainNameContract",
        result: DomainNameContract.analyzeMethods(),
      },
      { name: "BlockContract", result: BlockContract.analyzeMethods() },
      {
        name: "ValidatorsVoting",
        result: ValidatorsVoting.analyzeMethods(),
        skip: true,
      },
      {
        name: "MapUpdate",
        result: MapUpdate.analyzeMethods(),
        skip: true,
      },
    ];
    console.timeEnd("methods analyzed");
    const maxRows = 2 ** 16;
    for (const contract of methods) {
      // calculate the size of the contract - the sum or rows for each method
      const size = Object.values(contract.result).reduce(
        (acc, method) => acc + method.rows,
        0
      );
      // calculate percentage rounded to 0 decimal places
      const percentage = Math.round((size / maxRows) * 100);

      console.log(
        `method's total size for a ${contract.name} is ${size} rows (${percentage}% of max ${maxRows} rows)`
      );
      if (contract.skip !== true)
        for (const method in contract.result) {
          console.log(method, `rows:`, (contract.result as any)[method].rows);
        }
    }

    console.time("compiled");
    console.log("Compiling contracts...");
    verificationKey = (await ValidatorsVoting.compile()).verificationKey;
    blockVerificationKey = (await BlockContract.compile()).verificationKey;
    mapVerificationKey = (await MapUpdate.compile()).verificationKey;
    await DomainNameContract.compile();
    console.timeEnd("compiled");

    const tx = await Mina.transaction({ sender }, () => {
      AccountUpdate.fundNewAccount(sender);
      zkApp.deploy({});
      zkApp.validators.set(validatorsRoot);
      zkApp.validatorsHash.set(totalHash);
    });

    await tx.sign([deployer, privateKey]).send();

    const tx2 = await Mina.transaction({ sender }, () => {
      AccountUpdate.fundNewAccount(sender);
      zkApp.firstBlock(nameContract.firstBlockPublicKey!);
    });
    await tx2.prove();
    await tx2.sign([deployer, nameContract.firstBlockPrivateKey!]).send();
    tokenId = zkApp.deriveTokenId();
  });

  for (let i = 0; i < BLOCKS_NUMBER; i++) {
    const blockNumber = i + 1;
    if (failed === true) return;
    it(`should create a block`, async () => {
      if (failed === true) return;
      console.time(`block ${blockNumber} created`);
      const blockPrivateKey = PrivateKey.random();
      const blockPublicKey = blockPrivateKey.toPublicKey();
      const blockProducerPrivateKey = PrivateKey.random();
      const blockProducerPublicKey = blockProducerPrivateKey.toPublicKey();

      let oldDatabase: DomainDatabase = new DomainDatabase();
      let map = new MerkleMap();
      if (i > 0) {
        const lastBlock = zkApp.lastBlock.get();
        const block = new BlockContract(lastBlock, tokenId);
        const storage = block.storage.get();
        const hash = storage.toIpfsHash();
        const data = await loadFromIPFS(hash);
        const json = JSON.parse(data);
        if (json.map === undefined) throw new Error("json.map is undefined");
        if (json.map.startsWith("i:") === false)
          throw new Error("json.map does not start with 'i:'");
        const mapData = await loadFromIPFS(json.map.substring(2));
        const mapJson = JSON.parse(mapData);
        map.tree = MerkleTree.fromCompressedJSON(mapJson.map);
        oldDatabase = new DomainDatabase(json.database);
      }

      const { root, oldRoot, txs, database } = createBlock(
        domainNames[i],
        map,
        oldDatabase
      );
      const mapJson = {
        map: map.tree.toCompressedJSON(),
      };
      const strMapJson = JSON.stringify(mapJson, null, 2);
      const mapHash = await saveToIPFS(strMapJson, pinataJWT);
      expect(mapHash).toBeDefined();
      if (mapHash === undefined) throw new Error("mapHash is undefined");
      const json = {
        txs: domainNames[i].map((tx) => tx.toJSON()),
        database: database.data,
        map: "i:" + mapHash,
      };
      const strJson = JSON.stringify(json, null, 2);
      const hash = await saveToIPFS(strJson, pinataJWT);
      expect(hash).toBeDefined();
      if (hash === undefined) throw new Error("hash is undefined");

      if (fullValidation) {
        expect(root.toJSON()).toBe(database.getRoot().toJSON());
        const restoredMap = new MerkleMap();
        restoredMap.tree = MerkleTree.fromCompressedJSON(mapJson.map);
        expect(restoredMap.getRoot().toJSON()).toBe(root.toJSON());
      }

      console.log(
        `Block ${blockNumber} JSON size: ${strJson.length.toLocaleString()}, map JSON size: ${strMapJson.length.toLocaleString()}`
      );

      const blockStorage = Storage.fromIpfsHash(hash);

      blocks.push({
        address: blockPublicKey,
        txs: txs.hash(),
        count: txs.count,
        root,
        storage: blockStorage,
        isProved: false,
        blockNumber,
      });

      const decision = new ValidatorsDecision({
        contract: publicKey,
        chainId: networkIdHash,
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
        verificationKey,
        false
      );
      expect(Number(proof.publicInput.count.toBigInt())).toBe(
        validators.length
      );
      expect(proof.publicInput.hash.toJSON()).toBe(totalHash.toJSON());
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

      const tx = await Mina.transaction({ sender }, () => {
        AccountUpdate.fundNewAccount(sender);
        zkApp.block(proof, signature, blockData, blockVerificationKey);
      });

      await tx.prove();
      await tx.sign([deployer, blockPrivateKey]).send();
      console.timeEnd(`block ${blockNumber} created`);
    });

    it(`should validate a block`, async () => {
      if (failed === true) return;
      console.time(`block ${blockNumber} validated`);
      const map = new MerkleMap();
      const oldMap = new MerkleMap();
      const blockAddress = blocks[i].address;
      const block = new BlockContract(blockAddress, tokenId);
      const blockStorage = block.storage.get();
      const hash = blockStorage.toIpfsHash();
      const data = await loadFromIPFS(hash);
      const json = JSON.parse(data);
      if (json.map === undefined) throw new Error("json.map is undefined");
      if (json.map.startsWith("i:") === false)
        throw new Error("json.map does not start with 'i:'");
      const mapData = await loadFromIPFS(json.map.substring(2));
      const mapJson = JSON.parse(mapData);
      let oldDatabase = new DomainDatabase();
      const previousBlockAddress = block.previousBlock.get();
      const previousBlock = new BlockContract(previousBlockAddress, tokenId);
      const previousBlockNumber = Number(
        previousBlock.blockNumber.get().toBigInt()
      );
      //console.log("previousBlockNumber", previousBlockNumber);
      if (previousBlockNumber > 0) {
        const previousBlockStorage = previousBlock.storage.get();
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
        oldDatabase = new DomainDatabase(previousBlockJson.database);
        oldMap.tree = MerkleTree.fromCompressedJSON(previousBlockMapJson.map);
        const oldRoot = oldMap.getRoot();
        expect(oldRoot.toJSON()).toBe(blocks[i - 1].root.toJSON());
      }
      map.tree = MerkleTree.fromCompressedJSON(mapJson.map);
      const transactionData: DomainTransactionData[] = json.txs.map((tx: any) =>
        DomainTransactionData.fromJSON(tx)
      );
      const root = block.root.get();
      expect(root.toJSON()).toBe(blocks[i].root.toJSON());
      expect(root.toJSON()).toBe(map.getRoot().toJSON());
      const storage = block.storage.get();
      Storage.assertEquals(storage, blocks[i].storage);
      const txs = block.txs.get();
      expect(txs.toJSON()).toBe(blocks[i].txs.toJSON());

      const {
        root: calculatedRoot,
        txs: calculatedTxs,
        database,
      } = createBlock(transactionData, oldMap, oldDatabase);
      expect(calculatedRoot.toJSON()).toBe(root.toJSON());
      expect(calculatedTxs.hash().toJSON()).toBe(txs.toJSON());
      const loadedDatabase = new DomainDatabase(json.database);
      assert.deepStrictEqual(database.data, loadedDatabase.data);
      expect(root.toJSON()).toBe(database.getRoot().toJSON());
      expect(root.toJSON()).toBe(loadedDatabase.getRoot().toJSON());

      const decision = new ValidatorsDecision({
        contract: publicKey,
        chainId: networkIdHash,
        root: validatorsRoot,
        decision: ValidatorDecisionType.validate,
        address: blocks[i].address,
        data: ValidatorDecisionExtraData.fromBlockValidationData({
          storage,
          txs,
          root,
        }),
        expiry: UInt64.from(Date.now() + 1000 * 60 * 60),
      });
      const proof: ValidatorsVotingProof = await calculateValidatorsProof(
        decision,
        verificationKey,
        false
      );
      expect(Number(proof.publicInput.count.toBigInt())).toBe(
        validators.length
      );
      expect(proof.publicInput.hash.toJSON()).toBe(totalHash.toJSON());

      const tx = await Mina.transaction({ sender }, () => {
        zkApp.validateBlock(proof);
      });

      await tx.prove();
      await tx.sign([deployer]).send();
      const flags = block.flags.get();
      expect(Flags.fromField(flags).isValidated.toBoolean()).toBe(true);
      console.timeEnd(`block ${blockNumber} validated`);
    });

    it(`should prove a blocks`, async () => {
      if (failed === true) return;
      let proved = await proveBlocks();
      while (proved) {
        proved = await proveBlocks();
      }
    });

    it(`should prepare proof for a block`, async () => {
      if (failed === true) return;
      let proof: MapUpdateProof;
      const proofData = await prepareProofData(domainNames[i], proveMap, true);
      const transactions = proofData.transactions;
      console.log("sending proofMap job for block", i);
      let startTime = Date.now();
      let args: string = "";

      let sent = false;
      let apiresult;
      let attempt = 1;
      while (sent === false) {
        apiresult = await api.recursiveProof({
          repo: "nameservice",
          task: "proofMap",
          transactions,
          args,
          developer: "@staketab",
          metadata: `Block ${blockNumber} at ${new Date().toISOString()}`,
        });
        if (apiresult.success === true) sent = true;
        else {
          console.log(`Error creating job for block ${i}, retrying...`);
          await sleep(30000 * attempt);
          attempt++;
        }
      }

      expect(apiresult).toBeDefined();
      if (apiresult === undefined) return;
      expect(apiresult.success).toBe(true);

      expect(apiresult.jobId).toBeDefined();
      console.log(
        "proofMap job created for block",
        blockNumber,
        ", jobId:",
        apiresult.jobId
      );
      if (apiresult.jobId === undefined) return;
      blocks[i].jobId = apiresult.jobId;
      blocks[i].proofStartTime = startTime;
    });
  }

  it(`should prove remaining blocks`, async () => {
    if (failed === true) return;
    console.log("Proving remaining blocks...");
    while (blocks[blocks.length - 1].isProved === false) {
      const proved = await proveBlocks();
      if (!proved) await sleep(10000);
    }
  });

  it(`should change validators`, async () => {
    if (failed === true) return;
    const decision = new ValidatorsDecision({
      contract: publicKey,
      chainId: networkIdHash,
      root: validatorsRoot,
      decision: ValidatorDecisionType.setValidators,
      address: PrivateKey.random().toPublicKey(),
      data: ValidatorDecisionExtraData.fromSetValidatorsData({
        root: Field(1),
        hash: Field(1),
        oldRoot: tree.getRoot(),
      }),
      expiry: UInt64.from(Date.now() + 1000 * 60 * 60),
    });
    const proof: ValidatorsVotingProof = await calculateValidatorsProof(
      decision,
      verificationKey,
      false
    );

    const tx2 = await Mina.transaction({ sender }, () => {
      zkApp.setValidators(proof);
    });
    await tx2.prove();
    await tx2.sign([deployer]).send();
    const validators = zkApp.validators.get();
    const validatorsHash = zkApp.validatorsHash.get();
    expect(validators.toJSON()).toBe(Field(1).toJSON());
    expect(validatorsHash.toJSON()).toBe(Field(1).toJSON());
  });
});

async function proveBlocks(): Promise<boolean> {
  // find the first block that is not proved
  let blockIndex = 0;
  let found = false;
  while (found === false && blockIndex < blocks.length) {
    if (blocks[blockIndex].isProved === false) {
      found = true;
    } else blockIndex++;
  }
  if (!found) return false;
  const blockNumber = blockIndex + 1;
  const jobId = blocks[blockIndex].jobId;
  if (jobId !== undefined) {
    /*
      console.log(
        `Checking if proof for the block ${j} is ready, jobId:`,
        blocks[j].jobId
      );
      */
    let attempt = 1;
    let received = false;
    let result;
    await sleep(1000);
    while (received === false) {
      result = await api.jobResult({ jobId });
      if (result.success === false) {
        console.log(
          `Error getting job result for block ${blockNumber}, attempt ${
            attempt + 1
          }...`
        );
        await sleep(10000 * attempt);
        attempt++;
      } else received = true;
      if (attempt > 5) return false;
    }
    if (result?.result.jobStatus === "failed") {
      console.error(`job failed for block ${blockIndex}: ${result?.result}`);
      failed = true;
      return false;
    }
    if (result?.result?.result !== undefined) {
      //console.log(`job result for block ${j}`, result.result.result);
      console.time(`block ${blockNumber} proved`);
      let endTime = Date.now();
      const startTime = blocks[blockIndex].proofStartTime ?? 0;
      console.log(
        `Time spent to calculate the proof for block ${blockNumber}: ${formatTime(
          endTime - startTime
        )} (${endTime - startTime} ms)`
      );
      const proof: MapUpdateProof = MapUpdateProof.fromJSON(
        JSON.parse(result.result.result) as JsonProof
      );

      expect(proof).toBeDefined();
      if (proof === undefined) return false;
      const ok = await verify(proof.toJSON(), mapVerificationKey);
      if (!ok) console.error("Proof verification failed");
      expect(ok).toBe(true);
      const tx = await Mina.transaction({ sender }, () => {
        zkApp.proveBlock(proof, blocks[blockIndex].address);
      });

      await tx.prove();
      await tx.sign([deployer]).send();
      blocks[blockIndex].isProved = true;
      const block = new BlockContract(blocks[blockIndex].address, tokenId);
      const flags = block.flags.get();
      expect(Flags.fromField(flags).isProved.toBoolean()).toBe(true);
      console.timeEnd(`block ${blockNumber} proved`);
      return true;
    } else {
      if (Date.now() - result?.result.timeStarted > 5 * 60 * 1000)
        console.log(
          `No result for block ${blockNumber}: ${result?.result.jobStatus} ${(
            (Date.now() - result?.result.timeStarted) /
            1000
          ).toFixed(0)} seconds ago`
        );
      return false;
    }
  }
  return false;
}
