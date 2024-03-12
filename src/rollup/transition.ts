import { Field, Struct, UInt64 } from "o1js";

import { DomainTransactionEnum, MapUpdateData } from "./transaction";

export class MapTransition extends Struct({
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
}
