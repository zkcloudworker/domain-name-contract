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
} from "o1js";
import { TREE_HEIGHT, addBlock, BlockElement } from "../src/rollup/blocks";
import { BlockCalculation, BlockCalculationProof } from "../src/rollup/proof";
import { stringToFields } from "../src/lib/hash";
const TREE_MAX_ELEMENTS = (365 * 24 * 60) / 3; // 1 year of 3 minutes blocks
const ELEMENTS_NUMBER = 10;
const BLOCKS_NUMBER = 3;
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

  it(`should compile contract`, async () => {
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
      `method's total size for AddBlock is ${size} rows (${percentage}% of max ${maxRows} rows)`
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
