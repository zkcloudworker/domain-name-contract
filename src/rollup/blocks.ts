import { MerkleMap, MerkleTree, Field } from "o1js";
import { FastMerkleTree, MerkleNode } from "../lib/fast-merkle-tree";

import {
  BlockCalculation,
  BlockCalculationProof,
  Block,
  BlockMerkleTreeWitness,
} from "./proof";

import { NewBlockData } from "../contract/domain-contract";
import { DomainName } from "../contract/update";

export const TREE_HEIGHT = 20;

export interface BlockElement {
  key: Field;
  value: Field;
}

export function createBlock(elements: DomainName[], map: MerkleMap) {
  const keys = new FastMerkleTree(TREE_HEIGHT);
  const values = new FastMerkleTree(TREE_HEIGHT);
  const count = elements.length;
  const oldRoot = map.getRoot();
  for (let i = 0; i < count; i++) {
    const key = elements[i].key();
    const value = elements[i].value();
    keys.setLeaf(BigInt(i), key);
    values.setLeaf(BigInt(i), value);
    map.set(key, value);
  }
  const root = map.getRoot();
  return {
    oldRoot,
    root,
    newBlockData: new NewBlockData({
      keys: keys.getRoot(),
      values: values.getRoot(),
      count: Field(count),
    }),
  };
}

/*
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
