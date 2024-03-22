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
} from "../src/contract/domain-contract";
import { stringToFields } from "../src/lib/hash";
import {
  getValidatorsTreeAndHash,
  calculateValidatorsProof,
} from "../src/rollup/validators-proof";
import { Storage } from "../src/contract/storage";
import { nameContract, JWT } from "../src/config";
import {
  zkCloudWorker,
  formatTime,
  makeString,
  initBlockchain,
  blockchain,
  getNetworkIdHash,
  accountBalanceMina,
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

setNumberOfWorkers(8);
const network: blockchain = "local";
const useCloudWorker = true;
let calculateJobId = "";
const api = new zkCloudWorker(JWT);

const { keys, networkIdHash } = initBlockchain(network, 1);
const { privateKey: deployer, publicKey: sender } = keys[0];

const fullValidation = true;
const ELEMENTS_NUMBER = 8;
const BLOCKS_NUMBER = 1;
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
const storage = new Storage({ hashString: [Field(0), Field(0)] });
const map = new MerkleMap();
const proveMap = new MerkleMap();

interface Block {
  address: PublicKey;
  txs: Field;
  root: Field;
  count: Field;
  storage: Storage;
}
const blocks: Block[] = [];
let blockJson = "";
let lastBlockJson = "";

describe("Domain Name Service Contract", () => {
  it(`should prepare blocks data`, async () => {
    console.log("Preparing data...");
    console.time(`prepared data`);
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
            storage,
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
    it(`should create a block`, async () => {
      console.time(`block ${i} created`);
      const blockPrivateKey = PrivateKey.random();
      const blockPublicKey = blockPrivateKey.toPublicKey();
      const blockProducerPrivateKey = PrivateKey.random();
      const blockProducerPublicKey = blockProducerPrivateKey.toPublicKey();

      let oldDatabase: DomainDatabase = new DomainDatabase();
      let map = new MerkleMap();
      if (i > 0) {
        const json = JSON.parse(blockJson);
        map.tree = MerkleTree.fromCompressedJSON(json.map);
        oldDatabase = new DomainDatabase(json.database);
      }

      const { root, oldRoot, txs, database } = createBlock(
        domainNames[i],
        map,
        oldDatabase
      );
      const json = {
        txs: domainNames[i].map((tx) => tx.toJSON()),
        database: database.data,
        map: map.tree.toCompressedJSON(),
      };
      //console.log("txs", json.txs);
      //console.log("database", database.data);
      if (fullValidation) {
        expect(root.toJSON()).toBe(database.getRoot().toJSON());
        const restoredMap = new MerkleMap();
        restoredMap.tree = MerkleTree.fromCompressedJSON(json.map);
        expect(restoredMap.getRoot().toJSON()).toBe(root.toJSON());
      }
      const str = JSON.stringify(json, null, 2);
      console.log("JSON size:", str.length.toLocaleString());

      blocks.push({
        address: blockPublicKey,
        txs: txs.hash(),
        count: txs.count,
        root,
        storage,
      });
      lastBlockJson = blockJson;
      blockJson = str;

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
        storage: storage,
        txs,
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
      console.timeEnd(`block ${i} created`);
    });

    it(`should validate a block`, async () => {
      console.time(`block ${i} validated`);
      const map = new MerkleMap();
      const oldMap = new MerkleMap();
      const json = JSON.parse(blockJson);
      let oldDatabase = new DomainDatabase();
      if (i > 0) {
        const oldJson = JSON.parse(lastBlockJson);
        oldDatabase = new DomainDatabase(oldJson.database);
        oldMap.tree = MerkleTree.fromCompressedJSON(oldJson.map);
        const oldRoot = oldMap.getRoot();
        expect(oldRoot.toJSON()).toBe(blocks[i - 1].root.toJSON());
      }
      map.tree = MerkleTree.fromCompressedJSON(json.map);
      const transactionData: DomainTransactionData[] = json.txs.map((tx: any) =>
        DomainTransactionData.fromJSON(tx)
      );
      const block = new BlockContract(blocks[i].address, tokenId);
      const root = block.root.get();
      expect(root.toJSON()).toBe(blocks[i].root.toJSON());
      expect(root.toJSON()).toBe(map.getRoot().toJSON());
      const storage = block.storage.get();
      Storage.assertEquals(storage, blocks[i].storage);
      const txs = block.txs.get();
      expect(txs.toJSON()).toBe(blocks[i].txs.toJSON());
      if (fullValidation) {
      }

      const {
        root: calculatedRoot,
        txs: calculatedTxs,
        database,
      } = createBlock(transactionData, oldMap, oldDatabase);
      expect(calculatedRoot.toJSON()).toBe(root.toJSON());
      expect(calculatedTxs.hash().toJSON()).toBe(txs.toJSON());
      const loadedDatabase = new DomainDatabase(json.database);
      assert.deepStrictEqual(database.data, loadedDatabase.data);
      if (fullValidation) {
        expect(root.toJSON()).toBe(database.getRoot().toJSON());
        expect(root.toJSON()).toBe(loadedDatabase.getRoot().toJSON());
      }

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
      console.timeEnd(`block ${i} validated`);
    });

    it(`should prove a block`, async () => {
      console.time(`block ${i} proved`);
      let proof: MapUpdateProof;
      if (useCloudWorker) {
        const proofData = await prepareProofData(
          domainNames[i],
          proveMap,
          true
        );
        const transactions = proofData.transactions;
        const update = proofData.state;
        console.log("sending proofMap job", update.length);
        let args: string[] = [];

        let apiresult = await api.createJob({
          name: "nameservice",
          task: "proofMap",
          transactions,
          args,
          developer: "@staketab",
        });
        let startTime = Date.now();
        console.log("proofMap api call result", apiresult);
        expect(apiresult.success).toBe(true);
        expect(apiresult.jobId).toBeDefined();
        if (apiresult.jobId === undefined) return;
        calculateJobId = apiresult.jobId;
        let result = await api.waitForJobResult({ jobId: calculateJobId });
        let endTime = Date.now();
        console.log(
          `Time spent to calculate the proof: ${formatTime(
            endTime - startTime
          )} (${endTime - startTime} ms)`
        );
        //console.log("api call result", result);
        expect(result.success).toBe(true);
        if (result.success === false) return;
        proof = MapUpdateProof.fromJSON(
          JSON.parse(result.result.result) as JsonProof
        );
        //console.log("proof", proof);
        expect(proof).toBeDefined();
        if (proof === undefined) return;
      } else {
        proof = await calculateTransactionsProof(
          domainNames[i],
          proveMap,
          mapVerificationKey,
          true
        );
      }

      const tx = await Mina.transaction({ sender }, () => {
        zkApp.proveBlock(proof, blocks[i].address);
      });

      await tx.prove();
      await tx.sign([deployer]).send();
      console.timeEnd(`block ${i} proved`);
    });
  }

  it(`should change validators`, async () => {
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
