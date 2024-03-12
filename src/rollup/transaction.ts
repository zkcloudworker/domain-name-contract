export { MapUpdate, MapTransition, MapUpdateProof, MapUpdateData };
import {
  Field,
  SelfProof,
  ZkProgram,
  Struct,
  MerkleMapWitness,
  Poseidon,
  PublicKey,
  UInt64,
  Bool,
  UInt8,
  Signature,
  Provable,
} from "o1js";
import { Metadata } from "../contract/metadata";
import { Storage } from "../contract/storage";

export class DomainNameValue extends Struct({
  address: PublicKey,
  metadata: Metadata,
  storage: Storage,
  expiry: UInt64,
}) {
  hash(): Field {
    return Poseidon.hashPacked(DomainNameValue, this);
  }
  convertToFields(): Field[] {
    return [
      ...this.address.toFields(),
      ...this.metadata.convertToFields(),
      ...this.storage.convertToFields(),
      ...this.expiry.toFields(),
    ];
  }
  static createFromFields(fields: Field[]): DomainNameValue {
    return new DomainNameValue({
      address: PublicKey.fromFields(fields.slice(0, 2)),
      metadata: Metadata.createFromFields(fields.slice(2, 4)),
      storage: Storage.createFromFields(fields.slice(4, 6)),
      expiry: UInt64.fromFields(fields.slice(6)),
    });
  }
  static empty(): DomainNameValue {
    return new DomainNameValue({
      address: PublicKey.empty(),
      metadata: new Metadata({ data: Field(0), kind: Field(0) }),
      storage: new Storage({ hashString: [Field(0), Field(0)] }),
      expiry: UInt64.from(0),
    });
  }
}

export class DomainName extends Struct({
  name: Field,
  data: DomainNameValue,
}) {
  convertToFields(): Field[] {
    return [this.name, ...this.data.convertToFields()];
  }

  static createFromFields(fields: Field[]): DomainName {
    return new DomainName({
      name: fields[0],
      data: DomainNameValue.createFromFields(fields.slice(1)),
    });
  }

  static empty(): DomainName {
    return new DomainName({
      name: Field(0),
      data: DomainNameValue.empty(),
    });
  }

  isEmpty(): Bool {
    return this.data.expiry.equals(UInt64.from(0));
  }

  value(): Field {
    return this.data.hash();
  }

  key(): Field {
    return this.name;
  }

  hash(): Field {
    return Poseidon.hashPacked(DomainName, this);
  }
}

export type DomainTransactionType = "add" | "extend" | "update" | "remove"; // removeExpired

export const DomainTransactionEnum: { [k in DomainTransactionType]: UInt8 } = {
  add: UInt8.from(1),
  extend: UInt8.from(2),
  update: UInt8.from(3),
  remove: UInt8.from(4),
};

export class DomainTransaction extends Struct({
  type: UInt8,
  domain: DomainName,
}) {
  convertToFields(): Field[] {
    return [
      this.type.toUInt32().toFields()[0],
      ...this.domain.convertToFields(),
    ];
  }

  static createFromFields(fields: Field[]): DomainTransaction {
    fields[0].assertLessThanOrEqual(Field(4));
    return new DomainTransaction({
      type: UInt8.from(fields[0]),
      domain: DomainName.createFromFields(fields.slice(1, 9)),
    });
  }

  hash(): Field {
    return Poseidon.hashPacked(DomainTransaction, this);
  }
}

export class DomainTransactionData {
  constructor(
    public readonly tx: DomainTransaction,
    public readonly oldDomain?: DomainName,
    public readonly signature?: Signature
  ) {
    this.tx = tx;
    this.oldDomain = oldDomain;
    this.signature = signature;
  }

  public txType(): DomainTransactionType {
    return ["add", "extend", "update", "remove"][
      this.tx.type.toNumber() - 1
    ] as DomainTransactionType;
  }
}

class MapUpdateData extends Struct({
  oldRoot: Field,
  newRoot: Field,
  time: UInt64, // unix time when the map was updated
  tx: DomainTransaction,
  witness: MerkleMapWitness,
}) {
  convertToFields(): Field[] {
    return [
      this.oldRoot,
      this.newRoot,
      this.time.toFields()[0],
      ...this.tx.convertToFields(),
      ...this.witness.toFields(),
    ];
  }

  static createFromFields(fields: Field[]): MapUpdateData {
    return new MapUpdateData({
      oldRoot: fields[0],
      newRoot: fields[1],
      time: UInt64.from(fields[2]),
      tx: DomainTransaction.createFromFields(fields.slice(3, 12)),
      witness: MerkleMapWitness.fromFields(fields.slice(12)),
    });
  }
}

class MapTransition extends Struct({
  oldRoot: Field,
  newRoot: Field,
  time: UInt64, // unix time when the map was updated
  hash: Field, // sum of hashes of all the new keys and values of the Map
  count: Field, // number of new keys in the Map
}) {
  // TODO: addNew, replaceExpired, extend, change
  static add(update: MapUpdateData) {
    update.tx.type.assertEquals(DomainTransactionEnum.add);
    const key = update.tx.domain.name;
    const value = update.tx.domain.data.hash();

    const [rootBefore, keyBefore] = update.witness.computeRootAndKey(Field(0));
    update.oldRoot.assertEquals(rootBefore);
    key.assertEquals(keyBefore);

    const [rootAfter, keyAfter] = update.witness.computeRootAndKey(value);
    update.newRoot.assertEquals(rootAfter);
    key.assertEquals(keyAfter);

    const hash = update.tx.hash();
    //Provable.log("MapTransition add hash", hash);

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
    oldDomain: DomainName,
    signature: Signature
  ) {
    update.tx.type.assertEquals(DomainTransactionEnum.update);
    const key = update.tx.domain.name;
    key.assertEquals(oldDomain.name);
    const value = update.tx.domain.data.hash();
    const oldValue = oldDomain.data.hash();

    const [rootBefore, keyBefore] = update.witness.computeRootAndKey(oldValue);
    update.oldRoot.assertEquals(rootBefore);
    key.assertEquals(keyBefore);

    const [rootAfter, keyAfter] = update.witness.computeRootAndKey(value);
    update.newRoot.assertEquals(rootAfter);
    key.assertEquals(keyAfter);

    signature.verify(oldDomain.data.address, update.tx.convertToFields());

    const hash = update.tx.hash();

    return new MapTransition({
      oldRoot: update.oldRoot,
      newRoot: update.newRoot,
      hash,
      count: Field(1),
      time: update.time,
    });
  }

  static extend(update: MapUpdateData, oldDomain: DomainName) {
    update.tx.domain.data.address.assertEquals(oldDomain.data.address);
    Metadata.assertEquals(
      update.tx.domain.data.metadata,
      oldDomain.data.metadata
    );
    Storage.assertEquals(update.tx.domain.data.storage, oldDomain.data.storage);
    update.tx.domain.data.expiry.assertGreaterThan(oldDomain.data.expiry);

    update.tx.type.assertEquals(DomainTransactionEnum.extend);
    const key = update.tx.domain.name;
    key.assertEquals(oldDomain.name);
    const value = update.tx.domain.data.hash();
    const oldValue = oldDomain.data.hash();

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
    update.tx.type.assertEquals(DomainTransactionEnum.remove);
    update.tx.domain.data.expiry.assertLessThanOrEqual(update.time);
    const key = update.tx.domain.name;
    const value = update.tx.domain.data.hash();

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

  // Incorrect or unpaid txs are being rejected
  static reject(root: Field, time: UInt64, domain: DomainTransaction) {
    const hash = domain.hash();
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

  convertToFields(): Field[] {
    return [
      this.oldRoot,
      this.newRoot,
      this.hash,
      this.count,
      this.time.toFields()[0],
    ];
  }

  static createFromFields(fields: Field[]): MapTransition {
    return new MapTransition({
      oldRoot: fields[0],
      newRoot: fields[1],
      hash: fields[2],
      count: fields[3],
      time: UInt64.from(fields[4]),
    });
  }
}

const MapUpdate = ZkProgram({
  name: "MapUpdate",
  publicInput: MapTransition,

  methods: {
    add: {
      privateInputs: [MapUpdateData],

      method(state: MapTransition, update: MapUpdateData) {
        //Provable.log("MapUpdate.add state.hash:", state.hash);
        const computedState = MapTransition.add(update);
        MapTransition.assertEquals(computedState, state);
      },
    },

    update: {
      privateInputs: [MapUpdateData, DomainName, Signature],

      method(
        state: MapTransition,
        update: MapUpdateData,
        oldDomain: DomainName,
        signature: Signature
      ) {
        const computedState = MapTransition.update(
          update,
          oldDomain,
          signature
        );
        MapTransition.assertEquals(computedState, state);
      },
    },

    extend: {
      privateInputs: [MapUpdateData, DomainName],

      method(
        state: MapTransition,
        update: MapUpdateData,
        oldDomain: DomainName
      ) {
        const computedState = MapTransition.extend(update, oldDomain);
        MapTransition.assertEquals(computedState, state);
      },
    },

    remove: {
      privateInputs: [MapUpdateData],

      method(state: MapTransition, update: MapUpdateData) {
        const computedState = MapTransition.remove(update);
        MapTransition.assertEquals(computedState, state);
      },
    },

    reject: {
      privateInputs: [Field, UInt64, DomainTransaction],

      method(
        state: MapTransition,
        root: Field,
        time: UInt64,
        domain: DomainTransaction
      ) {
        const computedState = MapTransition.reject(root, time, domain);
        MapTransition.assertEquals(computedState, state);
      },
    },

    merge: {
      privateInputs: [SelfProof, SelfProof],

      method(
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

class MapUpdateProof extends ZkProgram.Proof(MapUpdate) {}
