import { describe, expect, it } from "@jest/globals";
import { Field, PrivateKey, Signature } from "o1js";
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
  it(`should convert DomainTransaction`, async () => {
    const domainName = DomainName.empty();
    expect(domainName.toFields().length).toBe(8);
    const signature = Signature.create(PrivateKey.random(), [Field(0)]);
    const tx = new DomainTransaction({
      type: DomainTransactionEnum.add,
      domain: domainName,
    });
    const s = serializeFields(tx.toFields());
    console.log(s);
    const restored = DomainTransaction.fromFields(deserializeFields(s));
    const tx1 = tx.toFields();
    console.log(signature.toFields().length);
    const tx2 = restored.toFields();
    console.log(tx2.length);
    expect(tx1.length).toBe(tx2.length);
    for (let i = 0; i < tx1.length; i++) {
      expect(tx1[i].toJSON()).toEqual(tx2[i].toJSON());
    }
  });
});
