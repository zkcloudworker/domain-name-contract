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
} from "o1js";
import { validatorsPrivateKeys } from "../src/config";
import {
  ValidatorsDecision,
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

const setValidators: ValidatorDecisionType = "setValidators";
const setValidatorsField = stringToFields(setValidators)[0];
const createBlock: ValidatorDecisionType = "createBlock";
const createBlockField = stringToFields(createBlock)[0];
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
    console.time("compiled");
    console.log("Compiling contracts...");
    setNumberOfWorkers(8);
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
  });

  it(`should create block`, async () => {
    const blockPrivateKey = PrivateKey.random();
    const blockPublicKey = blockPrivateKey.toPublicKey();
    const blockProducerPrivateKey = PrivateKey.random();
    const blockProducerPublicKey = blockProducerPrivateKey.toPublicKey();

    const decision = new ValidatorsDecision({
      contract: publicKey,
      root,
      decision: createBlockField,
      address: blockProducerPublicKey,
      data1: blockVerificationKey.hash,
      data2: Poseidon.hashPacked(PublicKey, blockPublicKey),
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
      root,
      decision: setValidatorsField,
      address: PrivateKey.random().toPublicKey(),
      data1: Field(1),
      data2: Field(1),
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
