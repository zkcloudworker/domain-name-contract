import { Field, ZkProgram, Struct, MerkleWitness } from "o1js";

import { TREE_HEIGHT } from "./blocks";

export class BlockMerkleTreeWitness extends MerkleWitness(20) {}

export class Block extends Struct({
  oldRoot: Field,
  newRoot: Field,
  index: Field,
  value: Field,
}) {
  public toJSON() {
    return {
      oldRoot: this.oldRoot.toJSON(),
      newRoot: this.newRoot.toJSON(),
      index: this.index.toJSON(),
      value: this.value.toJSON(),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static fromJSON(json: any) {
    return new Block({
      oldRoot: Field.fromJSON(json.oldRoot),
      newRoot: Field.fromJSON(json.newRoot),
      index: Field.fromJSON(json.index),
      value: Field.fromJSON(json.value),
    });
  }

  public toFields() {
    return [this.oldRoot, this.newRoot, this.index, this.value];
  }

  public static fromFields(fields: Field[]) {
    return new Block({
      oldRoot: fields[0],
      newRoot: fields[1],
      index: fields[2],
      value: fields[3],
    });
  }
}

export const BlockCalculation = ZkProgram({
  name: "AddBlock",
  publicInput: Block,

  methods: {
    create: {
      privateInputs: [BlockMerkleTreeWitness],

      method(block: Block, witness: BlockMerkleTreeWitness) {
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

export class BlockCalculationProof extends ZkProgram.Proof(BlockCalculation) {}
