import { describe, expect, it } from "@jest/globals";
import { Field, PrivateKey, PublicKey, Signature } from "o1js";
import { serializeFields, deserializeFields } from "../src/lib/fields";
import { fieldToBase64, fieldFromBase64 } from "../src/lib/base64";
import {
  DomainName,
  DomainTransactionEnum,
  DomainTransaction,
  DomainTransactionData,
} from "../src/rollup/transaction";

const ELEMENTS_NUMBER = 10;

describe("Map", () => {
  let str: string = "";
  const elements: Field[] = [];
  it(`should prepare data`, async () => {
    for (let i = 0; i < ELEMENTS_NUMBER; i++) {
      elements.push(Field.random());
    }
  });

  it(`should convert Field to base64`, async () => {
    const f = Field(64);
    const str = fieldToBase64(f);
    console.log("base58:", str);
    const f1 = fieldFromBase64(str);
    expect(f1.toJSON()).toEqual(f.toJSON());
  });

  it(`should convert Fields to string`, async () => {
    str = serializeFields(elements);
    //console.log(str);
  });

  it(`should convert Fields to base64`, async () => {
    for (let i = 0; i < ELEMENTS_NUMBER; i++) {
      const f = Field.random();
      const str = fieldToBase64(f);
      const f1 = fieldFromBase64(str);
      expect(f1.toJSON()).toEqual(f.toJSON());
    }
    for (let j = 0; j < 100; j++) {
      const f = Field(j);
      const str = fieldToBase64(f);
      const f1 = fieldFromBase64(str);
      expect(f1.toJSON()).toEqual(f.toJSON());
    }
  });

  it(`should convert string to Fields`, async () => {
    const fields = deserializeFields(str);
    expect(fields.length).toBe(ELEMENTS_NUMBER);
    for (let i = 0; i < ELEMENTS_NUMBER; i++) {
      expect(fields[i].toJSON()).toEqual(elements[i].toJSON());
    }
  });
  it(`should convert PublicKey`, async () => {
    const publicKey = PrivateKey.random().toPublicKey();
    const json = publicKey.toJSON();
    const restored = PublicKey.fromJSON(json);
    expect(restored.equals(publicKey).toBoolean()).toBe(true);
  });
  it(`should convert DomainTransaction`, async () => {
    const domainName = DomainName.empty();
    const tx = new DomainTransaction({
      type: DomainTransactionEnum.add,
      domain: domainName,
    });
    const tx1 = DomainTransaction.toFields(tx);
    const s = serializeFields(tx1);
    const fields = deserializeFields(s);
    const restored = new DomainTransaction(
      DomainTransaction.fromFields(fields)
    );
    const tx2 = DomainTransaction.toFields(restored);
    const signature = Signature.create(PrivateKey.random(), [Field(1)]);
    const data: DomainTransactionData = new DomainTransactionData(
      tx,
      domainName,
      signature
    );
    const json = data.toJSON();
    const str = JSON.stringify(json, null, 2);
    console.log("str", str);
    const data2 = DomainTransactionData.fromJSON(JSON.parse(str));
    const tx3 = DomainTransaction.toFields(data2.tx);
    expect(tx1.length).toBe(tx2.length);
    for (let i = 0; i < tx1.length; i++) {
      expect(tx1[i].toJSON()).toEqual(tx2[i].toJSON());
      expect(tx1[i].toJSON()).toEqual(tx3[i].toJSON());
    }
  });
  it(`should convert Signature`, async () => {
    const signature = Signature.create(PrivateKey.random(), [
      Field(1),
      Field(2),
      Field(3),
      Field(4),
      Field(5),
      Field(6),
      Field(7),
      Field(8),
    ]);
    const s = serializeFields(signature.toFields());
    const restored = Signature.fromFields(deserializeFields(s));
    const tx1 = signature.toFields();
    const tx2 = restored.toFields();
    expect(tx1.length).toBe(tx2.length);
    for (let i = 0; i < tx1.length; i++) {
      expect(tx1[i].toJSON()).toEqual(tx2[i].toJSON());
    }
  });
});
