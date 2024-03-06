export { MapUpdate, MapTransition, MapUpdateProof, MapUpdateData };
import {
  Field,
  SelfProof,
  ZkProgram,
  Struct,
  MerkleMapWitness,
  Poseidon,
  PublicKey,
} from "o1js";
import { Metadata } from "./metadata";
import { Storage } from "./storage";

export class DomainNameValue extends Struct({
  address: PublicKey,
  metadata: Metadata,
  storage: Storage,
  expiry: Field,
}) {
  hash(): Field {
    return Poseidon.hashPacked(DomainNameValue, this);
  }
}

export class DomainName extends Struct({
  name: Field,
  address: PublicKey,
  metadata: Metadata,
  storage: Storage,
  expiry: Field,
}) {
  toFields(): Field[] {
    return [
      this.name,
      ...this.address.toFields(),
      ...this.metadata.toFields(),
      ...this.storage.toFields(),
      this.expiry,
    ];
  }

  static fromFields(fields: Field[]): DomainName {
    return new DomainName({
      name: fields[0],
      address: PublicKey.fromFields(fields.slice(1, 3)),
      metadata: Metadata.fromFields(fields.slice(3, 5)),
      storage: Storage.fromFields(fields.slice(5)),
      expiry: fields[fields.length - 1],
    });
  }

  value(): Field {
    return new DomainNameValue({
      address: this.address,
      metadata: this.metadata,
      storage: this.storage,
      expiry: this.expiry,
    }).hash();
  }

  key(): Field {
    return this.name;
  }

  hash(): Field {
    return Poseidon.hashPacked(DomainName, this);
  }
}

class MapUpdateData extends Struct({
  oldRoot: Field,
  newRoot: Field,
  key: Field,
  oldValue: Field,
  newValue: Field,
  witness: MerkleMapWitness,
}) {
  toFields(): Field[] {
    return [
      this.oldRoot,
      this.newRoot,
      this.key,
      this.oldValue,
      this.newValue,
      ...this.witness.toFields(),
    ];
  }

  static fromFields(fields: Field[]): MapUpdateData {
    return new MapUpdateData({
      oldRoot: fields[0],
      newRoot: fields[1],
      key: fields[2],
      oldValue: fields[3],
      newValue: fields[4],
      witness: MerkleMapWitness.fromFields(fields.slice(5)),
    });
  }
}

class MapTransition extends Struct({
  oldRoot: Field,
  newRoot: Field,
  hash: Field, // sum of hashes of all the new keys and values of the Map
  count: Field, // number of new keys in the Map
}) {
  static accept(update: MapUpdateData, domain: DomainName) {
    const key = domain.name;
    key.assertEquals(update.key);

    const value = Poseidon.hashPacked(
      DomainNameValue,
      new DomainNameValue({
        address: domain.address,
        metadata: domain.metadata,
        storage: domain.storage,
        expiry: domain.expiry,
      })
    );
    value.assertEquals(update.newValue);

    const [dataWitnessRootBefore, dataWitnessKey] =
      update.witness.computeRootAndKey(update.oldValue);
    update.oldRoot.assertEquals(dataWitnessRootBefore);
    dataWitnessKey.assertEquals(update.key);

    const [dataWitnessRootAfter, _] = update.witness.computeRootAndKey(
      update.newValue
    );
    update.newRoot.assertEquals(dataWitnessRootAfter);

    const hash = domain.hash();

    return new MapTransition({
      oldRoot: update.oldRoot,
      newRoot: update.newRoot,
      hash,
      count: Field(1),
    });
  }

  static reject(root: Field, domain: DomainName) {
    const hash = domain.hash();
    return new MapTransition({
      oldRoot: root,
      newRoot: root,
      hash,
      count: Field(1),
    });
  }

  static merge(transition1: MapTransition, transition2: MapTransition) {
    transition1.newRoot.assertEquals(transition2.oldRoot);
    return new MapTransition({
      oldRoot: transition1.oldRoot,
      newRoot: transition2.newRoot,
      hash: transition1.hash.add(transition2.hash),
      count: transition1.count.add(transition2.count),
    });
  }

  static assertEquals(transition1: MapTransition, transition2: MapTransition) {
    transition1.oldRoot.assertEquals(transition2.oldRoot);
    transition1.newRoot.assertEquals(transition2.newRoot);
    transition1.hash.assertEquals(transition2.hash);
    transition1.count.assertEquals(transition2.count);
  }

  toFields(): Field[] {
    return [this.oldRoot, this.newRoot, this.hash, this.count];
  }

  static fromFields(fields: Field[]): MapTransition {
    return new MapTransition({
      oldRoot: fields[0],
      newRoot: fields[1],
      hash: fields[2],
      count: fields[3],
    });
  }
}

const MapUpdate = ZkProgram({
  name: "MapUpdate",
  publicInput: MapTransition,

  methods: {
    accept: {
      privateInputs: [MapUpdateData, DomainName],

      method(state: MapTransition, update: MapUpdateData, domain: DomainName) {
        const computedState = MapTransition.accept(update, domain);
        MapTransition.assertEquals(computedState, state);
      },
    },

    reject: {
      privateInputs: [Field, DomainName],

      method(state: MapTransition, root: Field, domain: DomainName) {
        const computedState = MapTransition.reject(root, domain);
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
