import { describe, expect, it } from "@jest/globals";
import { makeString } from "zkcloudworker";
import { Field, PrivateKey, Encoding, MerkleMap } from "o1js";
import { DomainName } from "../src/contract/update";
import { Metadata } from "../src/contract/metadata";
import { Storage } from "../src/contract/storage";

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
});
