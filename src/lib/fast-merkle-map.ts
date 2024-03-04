import { Field } from "o1js";
import { FastMerkleTree } from "./fast-merkle-tree";

const bits = 255;

export type MerkleDomainName = {
  key: Field;
  value: Field;
};

export class FastMerkleMap {
  tree: FastMerkleTree;

  constructor() {
    this.tree = new FastMerkleTree(bits + 1);
  }

  _keyToIndex(key: Field) {
    // the bit map is reversed to make reconstructing the key during proving more convenient
    let keyBits = key
      .toBits()
      .slice(0, bits)
      .reverse()
      .map((b) => b.toBoolean());

    let n = 0n;
    for (let i = 0; i < keyBits.length; i++) {
      const b = keyBits[i] ? 1 : 0;
      n += 2n ** BigInt(i) * BigInt(b);
    }

    return n;
  }

  public setLeaves(leaves: MerkleDomainName[]) {
    const nodes = leaves.map((leaf) => {
      const index = this._keyToIndex(leaf.key);
      return {
        level: 0,
        index,
        digest: leaf.value,
      };
    });

    this.tree.setLeaves(nodes);
  }

  /**
   * Sets a key of the merkle map to a given value.
   * @param key The key to set in the map.
   * @param key The value to set.
   */
  set(key: Field, value: Field) {
    const index = this._keyToIndex(key);
    this.tree.setLeaf(index, value);
  }

  /**
   * Returns a value given a key. Values are by default Field(0).
   * @param key The key to get the value from.
   * @returns The value stored at the key.
   */
  get(key: Field) {
    const index = this._keyToIndex(key);
    return this.tree.getNode(0, index);
  }

  /**
   * Returns the root of the Merkle Map.
   * @returns The root of the Merkle Map.
   */
  getRoot() {
    return this.tree.getRoot();
  }
}
