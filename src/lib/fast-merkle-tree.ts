import { Field, Poseidon } from "o1js";

export type MerkleNodesMap = {
  [level: number]: {
    [nodes: string]: Field;
  };
};

export type MerkleNode = {
  level: number;
  index: bigint;
  digest: Field;
};

export class FastMerkleTree {
  private height: number;
  private nodes: MerkleNodesMap;
  protected zeroes: Field[];
  private size: number;

  constructor(height: number) {
    this.height = height;
    this.nodes = {};
    this.generateZeroes();
    this.size = 0;
  }

  private generateZeroes() {
    this.zeroes = new Array(this.height);
    this.zeroes[0] = Field(0);
    for (let i = 1; i < this.height; i += 1) {
      this.zeroes[i] = Poseidon.hash([this.zeroes[i - 1], this.zeroes[i - 1]]);
    }
  }

  private recalculateMerkleTree(newHeight: number) {
    if (newHeight <= this.height) {
      throw Error("New height must not be lower or equal to existed");
    }

    this.height = newHeight;

    this.generateZeroes();

    const levelZeroNodes = this.nodes[0];
    if (!levelZeroNodes) {
      return [];
    }

    const nodes = Object.entries(levelZeroNodes).map(([index, digest]) => ({
      level: 0,
      index: BigInt(index),
      digest,
    }));

    this.setLeaves(nodes);
  }

  public getRoot() {
    return this.getNode(this.height - 1, 0n);
  }

  public setLeaves(leaves: MerkleNode[]) {
    if (this.size + leaves.length >= this.leafCount) {
      this.recalculateMerkleTree(this.height + 1);
    }

    let cacheSet = new Set<bigint>();

    for (let i = 0; i < leaves.length; i++) {
      const currentIndex = leaves[i].index;
      const parentIndex = (currentIndex - (currentIndex % 2n)) / 2n;
      cacheSet.add(parentIndex);

      this.setLeaf(currentIndex, leaves[i].digest);
    }

    for (let level = 1; level < this.height; level += 1) {
      const intermediateCacheSet = new Set<bigint>();

      intermediateCacheSet.clear();

      for (const currentIndex of cacheSet) {
        const parentIndex = (currentIndex - (currentIndex % 2n)) / 2n;
        intermediateCacheSet.add(parentIndex);

        const leftChild = this.getNode(level - 1, currentIndex * 2n);
        const rightChild = this.getNode(level - 1, currentIndex * 2n + 1n);

        this.setNode({
          level,
          index: currentIndex,
          digest: Poseidon.hash([leftChild, rightChild]),
        });
      }

      cacheSet = intermediateCacheSet;
    }
  }

  public getNode(level: number, index: bigint): Field {
    return this.nodes[level]?.[index.toString()] ?? this.zeroes[level];
  }

  public isNodeExist(level: number, index: bigint): boolean {
    return !!this.nodes[level]?.[index.toString()];
  }

  public setNode(node: MerkleNode) {
    (this.nodes[node.level] ??= {})[node.index.toString()] = node.digest;
  }

  public setLeaf(index: bigint, digest: Field) {
    if (!this.isNodeExist(0, index)) {
      this.size += 1;
    }

    this.setNode({
      level: 0,
      index,
      digest,
    });
  }

  get leafCount() {
    return 2n ** BigInt(this.height - 1);
  }
}
