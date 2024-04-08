import { Field, UInt64 } from "o1js";
import {
  MapUpdateData,
  MapTransition,
  DomainTransaction,
  DomainTransactionData,
  DomainTransactionType,
} from "./transaction";
import { MerkleMap } from "../lib/merkle-map";
import { DomainDatabase } from "./database";
import { NewBlockTransactions } from "../contract/domain-contract";
import { serializeFields } from "../lib/fields";

function isAccepted(element: DomainTransactionData, time: UInt64): boolean {
  if (element.txType() === "update") {
    if (element.oldDomain === undefined) return false;
    if (element.signature === undefined) return false;
    if (
      element.signature
        .verify(
          element.oldDomain.data.address,
          DomainTransaction.toFields(element.tx)
        )
        .toBoolean() === false
    )
      return false;
  }

  if (element.txType() === "extend") {
    if (element.oldDomain === undefined) return false;
    if (
      element.tx.domain.data.expiry
        .greaterThan(element.oldDomain!.data.expiry)
        .toBoolean() === false
    )
      return false;
  }

  if (element.txType() === "remove") {
    if (element.tx.domain.data.expiry.greaterThan(time).toBoolean() === true)
      return false;
  }

  return true;
}

export function createBlock(params: {
  elements: DomainTransactionData[];
  map: MerkleMap;
  database: DomainDatabase;
  calculateTransactions?: boolean;
}): {
  oldRoot: Field;
  root: Field;
  txs: NewBlockTransactions;
  state: Field[];
  proofData: string[];
} {
  const { elements, map, database } = params;
  const calculateTransactions = params.calculateTransactions ?? false;
  console.log(`Calculating block for ${elements.length} elements...`);

  interface ElementState {
    isElementAccepted: boolean;
    update?: MapUpdateData;
    oldRoot: Field;
    type: DomainTransactionType;
  }

  const count = elements.length;
  const oldRoot = map.getRoot();
  let hashSum = Field(0);
  const proofData: string[] = [];
  let state: Field[] = [];
  let updates: ElementState[] = [];
  const time = UInt64.from(Date.now() - 1000 * 60 * 60 * 10);

  for (const element of elements) {
    const root = map.getRoot();
    const hash = element.tx.hash();
    hashSum = hashSum.add(hash);
    const txType = element.txType();
    if (isAccepted(element, time)) {
      const key = element.tx.domain.key();
      const value = txType === "remove" ? Field(0) : element.tx.domain.value();
      map.set(key, value);
      if (txType === "remove") database.remove(key);
      else database.insert(element.tx.domain);
      if (calculateTransactions) {
        const newRoot = map.getRoot();
        const update = new MapUpdateData({
          oldRoot: root,
          newRoot,
          time,
          tx: element.tx,
          witness: map.getWitness(key),
        });
        updates.push({
          isElementAccepted: true,
          update,
          oldRoot: root,
          type: txType,
        });
      }
    } else {
      if (calculateTransactions)
        updates.push({ isElementAccepted: false, oldRoot: root, type: txType });
    }
  }

  if (calculateTransactions) {
    let states: MapTransition[] = [];
    for (let i = 0; i < elements.length; i++) {
      const state = updates[i].isElementAccepted
        ? updates[i].type === "add"
          ? MapTransition.add(updates[i].update!)
          : updates[i].type === "remove"
          ? MapTransition.remove(updates[i].update!)
          : updates[i].type === "update"
          ? MapTransition.update(
              updates[i].update!,
              elements[i].oldDomain!,
              elements[i].signature!
            )
          : MapTransition.extend(updates[i].update!, elements[i].oldDomain!)
        : MapTransition.reject(updates[i].oldRoot, time, elements[i].tx);
      states.push(state);
      const tx = {
        isAccepted: updates[i].isElementAccepted,
        state: serializeFields(MapTransition.toFields(state)),
        update: serializeFields(MapUpdateData.toFields(updates[i].update!)),
      };
      proofData.push(JSON.stringify(tx, null, 2));
    }

    let finalState: MapTransition = states[0];
    for (let i = 1; i < states.length; i++) {
      const newState = MapTransition.merge(finalState, states[i]);
      finalState = newState;
    }
    state = MapTransition.toFields(finalState);
  }

  const root = map.getRoot();
  return {
    state,
    proofData,
    oldRoot,
    root,
    txs: new NewBlockTransactions({
      value: hashSum,
      count: Field(count),
    }),
  };
}
