import { describe, expect, it } from "@jest/globals";
import { makeString } from "zkcloudworker";
import { Field, PrivateKey, Encoding } from "o1js";
import { DomainName } from "../src/contract/update";
import { Metadata } from "../src/contract/metadata";
import { Storage } from "../src/contract/storage";
import { MerkleTree } from "../src/lib/merkle-tree";
import { MerkleMap } from "../src/lib/merkle-map";

const ELEMENTS_NUMBER = 1000;
const elements: DomainName[] = [];

describe("Map", () => {
  it(`should prepare data`, async () => {
    console.time(`prepared data of ${ELEMENTS_NUMBER} items`);
    const storage: Storage = new Storage({ hashString: [Field(0), Field(0)] });
    for (let i = 0; i < ELEMENTS_NUMBER; i++) {
      const name = Encoding.stringToFields(makeString(30))[0];
      const address = PrivateKey.random().toPublicKey();
      const metadata = new Metadata({ data: Field(0), kind: Field(0) });
      const element = new DomainName({
        name,
        address,
        metadata,
        storage,
      });
      elements.push(element);
    }
    console.timeEnd(`prepared data of ${ELEMENTS_NUMBER} items`);
  });

  it(`should export tree`, async () => {
    const tree = new MerkleTree(20);
    const maxLeafs = tree.leafCount;
    console.log("maxLeafs", maxLeafs);
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
      map.set(elements[i].name, elements[i].value());
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

  /*
  const max = [
    ELEMENTS_NUMBER / 1000,
    ELEMENTS_NUMBER / 100,
    ELEMENTS_NUMBER / 10,
    ELEMENTS_NUMBER / 1,
  ];
  for (const m of max) {
    it(`should create a block of ${m} items`, async () => {
      console.time(`created a block of ${m} items`);
      const map: MerkleMap = new MerkleMap();
      for (let i = 0; i < m; i++) {
        map.set(elements[i].name, elements[i].value());
      }
      const root = map.getRoot();
      console.timeEnd(`created a block of ${m} items`);
    });
  }
  */
});
