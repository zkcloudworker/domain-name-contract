import { describe, expect, it } from "@jest/globals";
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
  MerkleMap,
  MerkleList,
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
import { nameContract } from "../src/config";
import {
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
import { calculateTransactionsProof } from "../src/contract/proof";

//setNumberOfWorkers(8);
const network: blockchain = "local";
//const Local = Mina.LocalBlockchain();
//Mina.setActiveInstance(Local);
//const deployer = Local.testAccounts[0].privateKey;
const { keys, networkIdHash } = initBlockchain(network, 1);
const { privateKey: deployer, publicKey: sender } = keys[0];

const ELEMENTS_NUMBER = 1;
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
const storage = new Storage({ hashString: [Field(0), Field(0)] });
const map = new MerkleMap();
const proveMap = new MerkleMap();

interface Block {
  address: PublicKey;
  txs: NewBlockTransactions;
  root: Field;
  storage: Storage;
}
const blocks: Block[] = [];

describe("Validators", () => {
  it(`should prepare blocks data`, async () => {
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
    console.log("sender", sender.toBase58());
    console.log("Sender balance", await accountBalanceMina(sender));
    expect(deployer).toBeDefined();
    expect(sender).toBeDefined();
    expect(deployer.toPublicKey().toBase58()).toBe(sender.toBase58());
    //expect(typeof networkId).toBe("object");
    //if (typeof networkId !== "object")
    //  throw new Error("networkId is not an object");
    //expect(networkId.custom).toBe(network);

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
  });

  for (let i = 0; i < BLOCKS_NUMBER; i++) {
    it(`should create a block`, async () => {
      console.time(`block ${i} created`);
      const blockPrivateKey = PrivateKey.random();
      const blockPublicKey = blockPrivateKey.toPublicKey();
      const blockProducerPrivateKey = PrivateKey.random();
      const blockProducerPublicKey = blockProducerPrivateKey.toPublicKey();

      const { root, oldRoot, txs } = createBlock(domainNames[i], map);

      blocks.push({
        address: blockPublicKey,
        txs,
        root,
        storage,
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
        storage: storage,
        txs,
      });
      const signature = Signature.create(
        blockProducerPrivateKey,
        blockData.toFields()
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

      const decision = new ValidatorsDecision({
        contract: publicKey,
        chainId: networkIdHash,
        root: validatorsRoot,
        decision: ValidatorDecisionType.validate,
        address: blocks[i].address,
        data: ValidatorDecisionExtraData.fromBlockValidationData({
          storage: blocks[i].storage,
          hash: blocks[i].txs.hash(),
          root: blocks[i].root,
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

      const proof: MapUpdateProof = await calculateTransactionsProof(
        domainNames[i],
        proveMap,
        mapVerificationKey,
        true
      );

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
