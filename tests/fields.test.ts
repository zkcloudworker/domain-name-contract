import { describe, expect, it } from "@jest/globals";
import { Field, PrivateKey, PublicKey, Signature, Struct } from "o1js";
import { serializeFields, deserializeFields } from "../src/lib/fields";
import {
  DomainName,
  DomainTransactionEnum,
  DomainTransaction,
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

  it(`should convert Fields to string`, async () => {
    str = serializeFields(elements);
    //console.log(str);
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
    expect(tx1.length).toBe(tx2.length);
    for (let i = 0; i < tx1.length; i++) {
      expect(tx1[i].toJSON()).toEqual(tx2[i].toJSON());
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
