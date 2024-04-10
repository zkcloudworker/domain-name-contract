// https://github.com/o1-labs/o1js/issues/1551

import { describe, expect, it } from "@jest/globals";
import {
  Cache,
  Field,
  SelfProof,
  ZkProgram,
  Struct,
  Poseidon,
  PublicKey,
  UInt64,
  UInt8,
  Signature,
  MerkleMapWitness,
  SmartContract,
  method,
  state,
  State,
  DeployArgs,
  Permissions,
} from "o1js";

export class Data extends Struct({
  name: Field,
  data: Field,
}) {
  static empty(): Data {
    return new Data({
      name: Field(0),
      data: Field(0),
    });
  }
  hash(): Field {
    return Poseidon.hashPacked(Data, this);
  }
}

export type TransactionType = "add" | "extend" | "update" | "remove";

export const TransactionEnum: { [k in TransactionType]: UInt8 } = {
  add: UInt8.from(1),
  extend: UInt8.from(2),
  update: UInt8.from(3),
  remove: UInt8.from(4),
};

export class Transaction extends Struct({
  type: UInt8,
  data: Data,
}) {
  hash(): Field {
    return Poseidon.hashPacked(Transaction, this);
  }
}

class MapUpdateData extends Struct({
  oldRoot: Field,
  newRoot: Field,
  time: UInt64, // unix time when the map was updated
  tx: Transaction,
  witness: MerkleMapWitness,
}) {}

class MapTransition extends Struct({
  oldRoot: Field,
  newRoot: Field,
  time: UInt64,
  hash: Field,
  count: Field,
}) {
  static add(update: MapUpdateData) {
    update.tx.type.assertEquals(TransactionEnum.add);
    const key = update.tx.data.name;
    const value = update.tx.data.hash();

    const [rootBefore, keyBefore] = update.witness.computeRootAndKey(Field(0));
    update.oldRoot.assertEquals(rootBefore);
    key.assertEquals(keyBefore);

    const [rootAfter, keyAfter] = update.witness.computeRootAndKey(value);
    update.newRoot.assertEquals(rootAfter);
    key.assertEquals(keyAfter);

    const hash = update.tx.hash();

    return new MapTransition({
      oldRoot: update.oldRoot,
      newRoot: update.newRoot,
      hash,
      count: Field(1),
      time: update.time,
    });
  }

  static update(
    update: MapUpdateData,
    oldData: Data,
    signature: Signature,
    publicKey: PublicKey
  ) {
    update.tx.type.assertEquals(TransactionEnum.update);
    const key = update.tx.data.name;
    key.assertEquals(oldData.name);
    const value = update.tx.data.hash();
    const oldValue = oldData.hash();

    const [rootBefore, keyBefore] = update.witness.computeRootAndKey(oldValue);
    update.oldRoot.assertEquals(rootBefore);
    key.assertEquals(keyBefore);

    const [rootAfter, keyAfter] = update.witness.computeRootAndKey(value);
    update.newRoot.assertEquals(rootAfter);
    key.assertEquals(keyAfter);

    signature.verify(publicKey, Transaction.toFields(update.tx));

    const hash = update.tx.hash();

    return new MapTransition({
      oldRoot: update.oldRoot,
      newRoot: update.newRoot,
      hash,
      count: Field(1),
      time: update.time,
    });
  }

  static extend(update: MapUpdateData, oldData: Data) {
    update.tx.data.data.assertEquals(oldData.data);

    update.tx.type.assertEquals(TransactionEnum.extend);
    const key = update.tx.data.name;
    key.assertEquals(oldData.name);
    const value = update.tx.data.hash();
    const oldValue = oldData.hash();

    const [rootBefore, keyBefore] = update.witness.computeRootAndKey(oldValue);
    update.oldRoot.assertEquals(rootBefore);
    key.assertEquals(keyBefore);

    const [rootAfter, keyAfter] = update.witness.computeRootAndKey(value);
    update.newRoot.assertEquals(rootAfter);
    key.assertEquals(keyAfter);

    const hash = update.tx.hash();

    return new MapTransition({
      oldRoot: update.oldRoot,
      newRoot: update.newRoot,
      hash,
      count: Field(1),
      time: update.time,
    });
  }

  static remove(update: MapUpdateData) {
    update.tx.type.assertEquals(TransactionEnum.remove);
    const key = update.tx.data.name;
    const value = update.tx.data.hash();

    const [rootBefore, keyBefore] = update.witness.computeRootAndKey(value);
    update.oldRoot.assertEquals(rootBefore);
    key.assertEquals(keyBefore);

    const [rootAfter, keyAfter] = update.witness.computeRootAndKey(Field(0));
    update.newRoot.assertEquals(rootAfter);
    key.assertEquals(keyAfter);

    const hash = update.tx.hash();

    return new MapTransition({
      oldRoot: update.oldRoot,
      newRoot: update.newRoot,
      hash,
      count: Field(1),
      time: update.time,
    });
  }

  static reject(root: Field, time: UInt64, data: Data) {
    const hash = data.hash();
    return new MapTransition({
      oldRoot: root,
      newRoot: root,
      hash,
      count: Field(1),
      time,
    });
  }

  static merge(transition1: MapTransition, transition2: MapTransition) {
    transition1.newRoot.assertEquals(transition2.oldRoot);
    transition1.time.assertEquals(transition2.time);
    return new MapTransition({
      oldRoot: transition1.oldRoot,
      newRoot: transition2.newRoot,
      hash: transition1.hash.add(transition2.hash),
      count: transition1.count.add(transition2.count),
      time: transition1.time,
    });
  }

  static assertEquals(transition1: MapTransition, transition2: MapTransition) {
    transition1.oldRoot.assertEquals(transition2.oldRoot);
    transition1.newRoot.assertEquals(transition2.newRoot);
    transition1.hash.assertEquals(transition2.hash);
    transition1.count.assertEquals(transition2.count);
    transition1.time.assertEquals(transition2.time);
  }
}

const MyZkProgram = ZkProgram({
  name: "MyZkProgram",
  publicInput: MapTransition,
  overrideWrapDomain: 2,

  methods: {
    add: {
      privateInputs: [MapUpdateData],

      async method(state: MapTransition, update: MapUpdateData) {
        const computedState = MapTransition.add(update);
        MapTransition.assertEquals(computedState, state);
      },
    },

    update: {
      privateInputs: [MapUpdateData, Data, Signature, PublicKey],

      async method(
        state: MapTransition,
        update: MapUpdateData,
        oldData: Data,
        signature: Signature,
        publicKey: PublicKey
      ) {
        const computedState = MapTransition.update(
          update,
          oldData,
          signature,
          publicKey
        );
        MapTransition.assertEquals(computedState, state);
      },
    },

    extend: {
      privateInputs: [MapUpdateData, Data],

      async method(state: MapTransition, update: MapUpdateData, oldData: Data) {
        const computedState = MapTransition.extend(update, oldData);
        MapTransition.assertEquals(computedState, state);
      },
    },

    remove: {
      privateInputs: [MapUpdateData],

      async method(state: MapTransition, update: MapUpdateData) {
        const computedState = MapTransition.remove(update);
        MapTransition.assertEquals(computedState, state);
      },
    },

    reject: {
      privateInputs: [Field, UInt64, Data],

      async method(
        state: MapTransition,
        root: Field,
        time: UInt64,
        data: Data
      ) {
        const computedState = MapTransition.reject(root, time, data);
        MapTransition.assertEquals(computedState, state);
      },
    },

    merge: {
      privateInputs: [SelfProof, SelfProof],

      async method(
        newState: MapTransition,
        proof1: SelfProof<MapTransition, void>,
        proof2: SelfProof<MapTransition, void>
      ) {
        proof1.verify();
        proof2.verify();
        const computedState = MapTransition.merge(
          proof1.publicInput,
          proof2.publicInput
        );
        MapTransition.assertEquals(computedState, newState);
      },
    },
  },
});

class MyProof extends ZkProgram.Proof(MyZkProgram) {}

export class MySmartContract extends SmartContract {
  @state(Field) root = State<Field>();

  async deploy(args: DeployArgs) {
    super.deploy(args);
    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proof(),
    });
  }

  @method async setRoot(proof: MyProof) {
    proof.verify();
    this.root.set(proof.publicInput.newRoot);
  }
}

describe("Compile", () => {
  it(`should compile the ZkProgram`, async () => {
    const cache: Cache = Cache.FileSystem("./cache");
    console.log("Compiling MyZkProgram...");
    await MyZkProgram.compile({ cache });
    console.log("Compiling MySmartContract...");
    await MySmartContract.compile({ cache });
  });
});
