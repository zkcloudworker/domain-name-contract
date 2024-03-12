import { Field } from "o1js";

import { NewBlockTransactions } from "../contract/domain-contract";
import { DomainTransactionData } from "./transaction";
import { MerkleMap } from "../lib/merkle-map";
import { DomainDatabase } from "./database";

export function createBlock(
  elements: DomainTransactionData[],
  map: MerkleMap,
  database: DomainDatabase
) {
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
    database.insert(domain);
  }
  const root = map.getRoot();
  return {
    oldRoot,
    root,
    txs: new NewBlockTransactions({
      value: hashSum,
      count: Field(count),
    }),
    database,
  };
}
