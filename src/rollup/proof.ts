import { Field, ZkProgram, Struct, MerkleWitness } from "o1js";

import { TREE_HEIGHT } from "./blocks";

export class MerkleTreeWitness extends MerkleWitness(20) {}

export class Block extends Struct({
  oldRoot: Field,
  newRoot: Field,
  index: Field,
  value: Field,
}) {
  public toJSON() {
    return {
      originalRoot: this.oldRoot.toJSON(),
      redactedRoot: this.newRoot.toJSON(),
      index: this.index.toJSON(),
      value: this.value.toJSON(),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static fromJSON(json: any) {
    return new Block({
      oldRoot: Field.fromJSON(json.originalRoot),
      newRoot: Field.fromJSON(json.redactedRoot),
      index: Field.fromJSON(json.index),
      value: Field.fromJSON(json.value),
    });
  }
}

export const AddBlock = ZkProgram({
  name: "AddBlock",
  publicInput: Block,

  methods: {
    create: {
      privateInputs: [MerkleTreeWitness],

      method(block: Block, witness: MerkleTreeWitness) {
        const witnessOldRoot = witness.calculateRoot(Field(0));
        block.oldRoot.assertEquals(witnessOldRoot);
        const witnessNewRoot = witness.calculateRoot(block.value);
        block.newRoot.assertEquals(witnessNewRoot);
        const calculatedIndex = witness.calculateIndex();
        calculatedIndex.assertEquals(block.index);
      },
    },
  },
});

export class AddBlockProof extends ZkProgram.Proof(AddBlock) {}
