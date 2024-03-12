import { MerkleMap, Field } from "o1js";

import { NewBlockTransactions } from "../contract/domain-contract";
import { DomainTransactionData } from "./transaction";

export function createBlock(elements: DomainTransactionData[], map: MerkleMap) {
  const count = elements.length;
  const oldRoot = map.getRoot();
  let hashSum = Field(0);
  for (let i = 0; i < count; i++) {
    const domain = elements[i].tx.domain;
    const key = domain.key();
    const value = domain.value();
    const hash = elements[i].tx.hash();
    hashSum = hashSum.add(hash);
    map.set(key, value);
  }
  const root = map.getRoot();
  return {
    oldRoot,
    root,
    txs: new NewBlockTransactions({
      value: hashSum,
      count: Field(count),
    }),
  };
}
