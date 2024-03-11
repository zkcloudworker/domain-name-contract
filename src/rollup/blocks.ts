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

/*
export interface BlockElement {
  key: Field;
  value: Field;
}

export async function addBlock(
  blocks: Field[],
  elements: BlockElement[],
  expiryTimeSlot: Field
): Promise<BlockCalculationProof> {

  // TODO: count and expiry date
  const tree: MerkleTree = new MerkleTree(TREE_HEIGHT);
  const size = blocks.length;
  tree.fill(blocks);
  const oldRoot = tree.getRoot();
  const blockRoot = createBlock(elements, expiryTimeSlot);
  tree.setLeaf(BigInt(size), blockRoot);
  const newRoot = tree.getRoot();
  const witness = new BlockMerkleTreeWitness(tree.getWitness(BigInt(size)));
  const block: Block = new Block({
    oldRoot,
    newRoot,
    index: Field(size),
    value: blockRoot,
  });
  const proof = await BlockCalculation.create(block, witness);

  return proof;
}
*/
