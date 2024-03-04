import { describe, expect, it } from "@jest/globals";
import { Field, MerkleTree } from "o1js";
import { FastMerkleTree, MerkleNode } from "../src/lib/fast-merkle-tree";

const ELEMENTS_NUMBER = 10000;
const height = 20;
const elements: Field[] = [];
const nodes: MerkleNode[] = [];

describe("Fast Tree", () => {
  let root: Field | undefined = undefined;

  it(`should prepare data`, async () => {
    console.time(`prepared data of ${ELEMENTS_NUMBER} items`);
    for (let i = 0; i < ELEMENTS_NUMBER; i++) {
      const value = Field.random();
      elements.push(value);
      nodes.push({ level: 0, index: BigInt(i), digest: value });
    }
    console.timeEnd(`prepared data of ${ELEMENTS_NUMBER} items`);
  });

  it(`should create a tree`, async () => {
    console.time(`created a fast tree`);
    const tree: FastMerkleTree = new FastMerkleTree(height);
    tree.setLeaves(nodes);
    root = tree.getRoot();
    console.log(`root`, root.toJSON());
    console.timeEnd(`created a fast tree`);
  });

  it(`should check a tree root`, async () => {
    expect(root).toBeDefined();
    if (root === undefined) return;
    console.time(`created a tree`);
    const tree: MerkleTree = new MerkleTree(height);
    for (let i = 0; i < ELEMENTS_NUMBER; i++) {
      tree.setLeaf(BigInt(i), elements[i]);
    }
    const treeRoot = tree.getRoot();
    console.log(`root`, treeRoot.toJSON());
    console.timeEnd(`created a tree`);
    expect(root.toJSON()).toEqual(treeRoot.toJSON());
  });
});
