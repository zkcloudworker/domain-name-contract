import { describe, expect, it } from "@jest/globals";
import { Field } from "o1js";
import { MerkleTree } from "../src/lib/merkle-tree";
import { MerkleMap } from "../src/lib/merkle-map";
import { saveZipFile, loadZipFile } from "../src/lib/zip";
import fs from "fs/promises";

const ELEMENTS_NUMBER = 100;
const elements: { key: Field; value: Field }[] = [];

describe("Map", () => {
  for (let i = 0; i < ELEMENTS_NUMBER; i++) {
    elements.push({ key: Field.random(), value: Field.random() });
  }
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

  it.skip(`should export map`, async () => {
    const map: MerkleMap = new MerkleMap();
    console.time("created");
    for (let i = 0; i < ELEMENTS_NUMBER; i++) {
      map.set(elements[i].key, elements[i].value);
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

  it(`should export map in compressed format`, async () => {
    const map: MerkleMap = new MerkleMap();
    console.time("created");
    for (let i = 0; i < ELEMENTS_NUMBER; i++) {
      map.set(elements[i].key, elements[i].value);
    }
    console.timeEnd("created");
    const root = map.getRoot();
    console.time("toJSON");
    const str = JSON.stringify(map.tree.toCompressedJSON(), null, 2);
    console.timeEnd("toJSON");
    console.log("JSON size:", str.length.toLocaleString());
    console.time("saveZipFile");
    const filename = await saveZipFile({ data: str, filename: "map" });
    console.timeEnd("saveZipFile");
    expect(filename).toBeDefined();
    if (filename === undefined) throw new Error("Filename is undefined");
    const stat = await fs.stat(filename);
    console.log("file size:", stat.size.toLocaleString());
    //console.log(str);
    const map2: MerkleMap = new MerkleMap();
    console.time("loadZipFile");
    const str2 = await loadZipFile("map");
    expect(str2).toBeDefined();
    if (str2 === undefined) throw new Error("str2 is undefined");
    console.timeEnd("loadZipFile");
    console.time("fromJSON");
    map2.tree = MerkleTree.fromCompressedJSON(JSON.parse(str2));
    console.timeEnd("fromJSON");
    const root2 = map2.getRoot();
    expect(root.toJSON()).toEqual(root2.toJSON());
  });
});
