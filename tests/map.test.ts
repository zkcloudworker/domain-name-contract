import { describe, expect, it } from "@jest/globals";
import { Field } from "o1js";
import { MerkleTree } from "../src/lib/merkle-tree";
import { MerkleMap } from "../src/lib/merkle-map";

const ELEMENTS_NUMBER = 1000;

describe("Map", () => {
  it(`should export tree`, async () => {
    const tree = new MerkleTree(20);
    const maxLeafs = tree.leafCount;
    //console.log("maxLeafs", maxLeafs);
    for (let i = 0; i < 20; i++) {
      tree.setLeaf(BigInt(i), Field(i + 10));
    }
    const root1 = tree.getRoot();
    const json = tree.toJSON();
    const str = JSON.stringify(json, null, 2);
    const tree2 = MerkleTree.fromJSON(JSON.parse(str));
    const root2 = tree2.getRoot();
    expect(root1.toJSON()).toEqual(root2.toJSON());
  });

  it(`should export map`, async () => {
    const map: MerkleMap = new MerkleMap();
    console.time("created");
    for (let i = 0; i < ELEMENTS_NUMBER; i++) {
      map.set(Field.random(), Field.random());
    }
    console.timeEnd("created");
    const root = map.getRoot();
    const str = JSON.stringify(map.tree.toJSON(), null, 2);
    console.log("str", str.length);
    const map2: MerkleMap = new MerkleMap();
    console.time("fromJSON");
    map2.tree = MerkleTree.fromJSON(JSON.parse(str));
    console.timeEnd("fromJSON");
    const root2 = map2.getRoot();
    expect(root.toJSON()).toEqual(root2.toJSON());
  });
});
