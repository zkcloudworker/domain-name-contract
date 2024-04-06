import { describe, expect, it } from "@jest/globals";
import { makeString } from "zkcloudworker";
import {
  Field,
  PublicKey,
  Poseidon,
  PrivateKey,
  Encoding,
  MerkleMap,
  MerkleTree,
  VerificationKey,
  verify,
  setNumberOfWorkers,
} from "o1js";
import { TREE_HEIGHT, addBlock, BlockElement } from "../rollup/blocks";
import { BlockCalculation, BlockCalculationProof } from "./proof";
import { MapUpdate, DomainName } from "../rollup/transaction";
import { Storage } from "../contract/storage";
import { Metadata } from "../contract/metadata";
import { calculateProof } from "../rollup/blocks";
import { stringToFields } from "../lib/hash";
import { DomainNameAction } from "../contract/domain-contract";
const TREE_MAX_ELEMENTS = (365 * 24 * 60) / 3; // 1 year of 3 minutes blocks
const ELEMENTS_NUMBER = 10;
const BLOCKS_NUMBER = 3;
const ACTIONS_COUNT = 2;
const elements: BlockElement[][] = [];
const blocks: Field[] = [];
let verificationKey: VerificationKey | undefined = undefined;
const tree = new MerkleTree(TREE_HEIGHT);
let root: Field = tree.getRoot();

describe("Rollup", () => {
  it(`should check height`, async () => {
    console.log("TREE_MAX_ELEMENTS", TREE_MAX_ELEMENTS);
    const tree = new MerkleTree(TREE_HEIGHT);
    const maxLeafs = tree.leafCount;
    console.log("maxLeafs", maxLeafs);
    expect(maxLeafs).toBeGreaterThan(TREE_MAX_ELEMENTS);
  });

  it(`should calculate proof`, async () => {
    console.log("Compiling contracts...");
    console.time("MapUpdate compiled");
    const mapVerificationKey = (await MapUpdate.compile()).verificationKey;
    console.timeEnd("MapUpdate compiled");

    console.time("BlockCalculation compiled");
    const treeVerificationKey = (await BlockCalculation.compile())
      .verificationKey;
    console.timeEnd("BlockCalculation compiled");
    verificationKey = treeVerificationKey;
    const elements: DomainNameAction[] = [];
    const storage = new Storage({ hashString: [Field(1), Field(2)] });
    const metadata = new Metadata({ data: Field(0), kind: Field(0) });
    for (let i = 0; i < ACTIONS_COUNT; i++) {
      const name = Field(i < 2 ? 1 : i + 1);
      const userPrivateKey = PrivateKey.random();
      const address = userPrivateKey.toPublicKey();

      const element = new DomainName({
        name,
        address,
        metadata,
        storage,
      });
      elements.push({ domain: element, hash: element.hash() });
    }
    for (let i = 6; i < 20; i++) {
      if (i > 6) setNumberOfWorkers(i);
      const map = new MerkleMap();
      const tree = new MerkleTree(20);
      console.time(`created a proof using ${i} workers`);
      const { proof, blockProof } = await calculateProof(
        elements,
        map,
        tree,
        Field(0),
        mapVerificationKey,
        treeVerificationKey
      );
      console.timeEnd(`created a proof using ${i} workers`);
    }
  });

  it(`should prepare data`, async () => {
    console.time(`prepared data`);
    for (let j = 0; j < BLOCKS_NUMBER; j++) {
      const blockElements: BlockElement[] = [];
      for (let i = 0; i < ELEMENTS_NUMBER; i++) {
        const key = stringToFields(makeString(30));
        expect(key.length).toBe(1);
        const storage = stringToFields("i:" + makeString(45));
        expect(storage.length).toBe(2);
        const address = PrivateKey.random().toPublicKey().toFields();
        const value = Poseidon.hash([...address, ...storage]);
        const element: BlockElement = {
          key: key[0],
          value,
        };
        blockElements.push(element);
      }
      elements.push(blockElements);
    }
    console.timeEnd(`prepared data`);
  });

  it.skip(`should compile contract`, async () => {
    const methods = BlockCalculation.analyzeMethods();
    //console.log("methods", methods);
    // calculate the size of the contract - the sum or rows for each method
    const size = Object.values(methods).reduce(
      (acc, method) => acc + method.rows,
      0
    );
    // calculate percentage rounded to 0 decimal places
    const maxRows = 2 ** 16;
    const percentage = Math.round((size / maxRows) * 100);

    console.log(
      `method's total size for BlockCalculation is ${size} rows (${percentage}% of max ${maxRows} rows)`
    );
    console.log("Compiling contract...");
    console.time("BlockCalculation compiled");
    verificationKey = (await BlockCalculation.compile()).verificationKey;
    console.timeEnd("BlockCalculation compiled");
  });

  it(`should create a blocks`, async () => {
    for (let i = 0; i < BLOCKS_NUMBER; i++) {
      expect(verificationKey).toBeDefined();
      if (verificationKey === undefined) return;
      console.time(`created a block ${i} of ${ELEMENTS_NUMBER} elements`);
      const proof = await addBlock(blocks, elements[i], Field(0));
      const ok = await verify(proof, verificationKey);
      expect(ok).toBe(true);
      if (!ok) return;
      expect(proof.publicInput.oldRoot.equals(root).toBoolean()).toBe(true);
      root = proof.publicInput.newRoot;
      blocks.push(proof.publicInput.value);
      console.timeEnd(`created a block ${i} of ${ELEMENTS_NUMBER} elements`);
    }
  });
});
