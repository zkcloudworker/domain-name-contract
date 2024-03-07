import { describe, expect, it } from "@jest/globals";
import {
  Field,
  PrivateKey,
  Encoding,
  Poseidon,
  PublicKey,
  Signature,
  verify,
  setNumberOfWorkers,
  Mina,
  AccountUpdate,
  Account,
  VerificationKey,
  UInt64,
  MerkleMap,
} from "o1js";
import { validatorsPrivateKeys } from "../src/config";
import {
  ValidatorsDecision,
  ValidatorDecisionExtraData,
  ValidatorsDecisionState,
  ValidatorsVoting,
  ValidatorsVotingProof,
  ValidatorWitness,
  ValidatorDecisionType,
} from "../src/rollup/validators";
import { MerkleTree } from "../src/lib/merkle-tree";
import {
  DomainNameContract,
  BlockContract,
  BlockData,
  NewBlockData,
} from "../src/contract/domain-contract";
import { stringToFields } from "../src/lib/hash";
import {
  getValidatorsTreeAndHash,
  calculateProof,
} from "../src/rollup/validators-proof";
import { Storage } from "../src/contract/storage";
import { nameContract } from "../src/config";

setNumberOfWorkers(8);

const { tree, totalHash } = getValidatorsTreeAndHash();
const validators = validatorsPrivateKeys.map((key) => key.toPublicKey());
const root = tree.getRoot();
const privateKey = PrivateKey.random();
const publicKey = privateKey.toPublicKey();
const Local = Mina.LocalBlockchain();
Mina.setActiveInstance(Local);
const deployer = Local.testAccounts[0].privateKey;
const sender = deployer.toPublicKey();
const zkApp = new DomainNameContract(publicKey);
let verificationKey: VerificationKey;
let blockVerificationKey: VerificationKey;

describe("Validators", () => {
  it(`should compile and deploy contract`, async () => {
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
    await DomainNameContract.compile();
    console.timeEnd("compiled");

    const tx = await Mina.transaction({ sender }, () => {
      AccountUpdate.fundNewAccount(sender);
      zkApp.deploy({});
      zkApp.validators.set(root);
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

  it(`should create block`, async () => {
    const blockPrivateKey = PrivateKey.random();
    const blockPublicKey = blockPrivateKey.toPublicKey();
    const blockProducerPrivateKey = PrivateKey.random();
    const blockProducerPublicKey = blockProducerPrivateKey.toPublicKey();

    const decision = new ValidatorsDecision({
      contract: publicKey,
      chainId: Field(1),
      root,
      decision: ValidatorDecisionType.createBlock,
      address: blockProducerPublicKey,
      data: ValidatorDecisionExtraData.fromBlockCreationData({
        verificationKey: blockVerificationKey,
        blockPublicKey,
        oldRoot: new MerkleMap().getRoot(),
      }),
      expiry: UInt64.from(Date.now() + 1000 * 60 * 60),
    });
    const proof: ValidatorsVotingProof = await calculateProof(
      decision,
      verificationKey
    );
    const ok = await verify(proof.toJSON(), verificationKey);
    console.log("Proof verification result:", ok);
    expect(ok).toBe(true);
    if (!ok) return;
    expect(Number(proof.publicInput.count.toBigInt())).toBe(validators.length);
    expect(proof.publicInput.hash.toJSON()).toBe(totalHash.toJSON());
    const storage = new Storage({ hashString: [Field(1), Field(2)] });
    const blockData: BlockData = new BlockData({
      address: blockPublicKey,
      root: Field(0),
      storage: storage,
      newData: new NewBlockData({
        keys: Field(0),
        values: Field(0),
        count: Field(0),
      }),
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
  });

  it(`should change validators`, async () => {
    const decision = new ValidatorsDecision({
      contract: publicKey,
      chainId: Field(1),
      root,
      decision: ValidatorDecisionType.setValidators,
      address: PrivateKey.random().toPublicKey(),
      data: ValidatorDecisionExtraData.fromSetValidatorsData({
        root: Field(1),
        hash: Field(1),
        oldRoot: tree.getRoot(),
      }),
      expiry: UInt64.from(Date.now() + 1000 * 60 * 60),
    });
    const proof: ValidatorsVotingProof = await calculateProof(
      decision,
      verificationKey
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
