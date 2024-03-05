import { MerkleMap, MerkleTree, Field } from "o1js";

//import { FastMerkleTree, MerkleNode } from "../lib/fast-merkle-tree";
import {
  BlockCalculation,
  BlockCalculationProof,
  Block,
  BlockMerkleTreeWitness,
} from "./proof";

export const TREE_HEIGHT = 20;

export interface BlockElement {
  key: Field;
  value: Field;
}

function createBlock(elements: BlockElement[], expiryTimeSlot: Field): Field {
  const map = new MerkleMap();
  for (const element of elements) {
    map.set(element.key, element.value);
  }
  map.set(Field(0), expiryTimeSlot);
  return map.getRoot();
}

export async function addBlock(
  blocks: Field[],
  elements: BlockElement[],
  expiryTimeSlot: Field
): Promise<BlockCalculationProof> {
  /* TODO: use FastMerkleTree
      const tree: FastMerkleTree = new FastMerkleTree(TREE_HEIGHT);
      const nodes: MerkleNode[] = [];
      for (let i = 0; i < size; i++)
        nodes.push({ level: 0, index: BigInt(i), digest: blocks[i] });

      tree.setLeaves(nodes);
      nodes.push({ level: 0, index: BigInt(size), digest: block });
      tree.setLeaves([{ level: 0, index: BigInt(size), digest: block }]);
  */
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
