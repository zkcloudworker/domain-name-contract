import { Field, UInt32, UInt64, MerkleMap } from "o1js";
import {
  MapUpdateData,
  MapTransition,
  DomainTransaction,
  DomainTransactionData,
  DomainTransactionType,
  DomainCloudTransactionData,
  DomainName,
} from "./transaction";
import { DomainDatabase } from "./database";
import { serializeFields } from "../lib/fields";
import { stringFromFields } from "../lib/hash";

function isAccepted(
  element: DomainTransactionData,
  time: UInt64,
  map: MerkleMap
): { accepted: boolean; reason?: string } {
  if (element.txType() === "update") {
    if (element.oldDomain === undefined)
      return { accepted: false, reason: "no old domain" };
    if (element.signature === undefined)
      return { accepted: false, reason: "no signature" };
    if (
      element.signature
        .verify(
          element.oldDomain.data.address,
          DomainTransaction.toFields(element.tx)
        )
        .toBoolean() === false
    )
      return { accepted: false, reason: "invalid signature" };
  }

  if (element.txType() === "extend") {
    if (element.oldDomain === undefined)
      return { accepted: false, reason: "no old domain" };
    if (
      element.tx.domain.data.expiry
        .greaterThan(element.oldDomain!.data.expiry)
        .toBoolean() === false
    )
      return {
        accepted: false,
        reason: "new expiry date is before the old expiry date",
      };
  }

  if (element.txType() === "remove") {
    if (element.tx.domain.data.expiry.greaterThan(time).toBoolean() === true)
      return {
        accepted: false,
        reason: "the domain name is not expired yet, cannot remove",
      };
  }

  if (element.txType() === "add") {
    if (map.get(element.tx.domain.name).equals(Field(0)).toBoolean() === false)
      return { accepted: false, reason: "the name already registered" };
  }

  return { accepted: true };
}

export function createBlock(params: {
  elements: DomainCloudTransactionData[];
  map: MerkleMap;
  database: DomainDatabase;
  time: UInt64;
  calculateTransactions?: boolean;
}): {
  oldRoot: Field;
  root: Field;
  txsHash: Field;
  txsCount: UInt32;
  invalidTxsCount: number;
  state: Field[];
  proofData: string[];
} {
  const { elements, map, database, time } = params;
  const calculateTransactions = params.calculateTransactions ?? false;
  console.log(`Calculating block for ${elements.length} elements...`);

  interface ElementState {
    isElementAccepted: boolean;
    update?: MapUpdateData;
    oldRoot: Field;
    type: DomainTransactionType;
    element: DomainTransactionData;
  }

  const oldRoot = map.getRoot();
  let txsHash = Field(0);
  let invalidTxsCount = 0;
  let txsCount = 0;
  const proofData: string[] = [];
  let state: Field[] = [];
  const updates: ElementState[] = [];

  for (const tx of elements) {
    if (tx.domainData === undefined) {
      invalidTxsCount++;
      console.log("Invalid transaction", tx);
    } else {
      txsCount++;
      const element = tx.domainData;
      const root = map.getRoot();
      const hash = element.tx.hash();
      txsHash = txsHash.add(hash);
      const txType = element.txType();
      // TODO: check for duplicate names
      const { accepted, reason } = isAccepted(element, time, map);
      //console.log("Processing transaction", { tx, accepted, reason });
      if (accepted) {
        tx.serializedTx.status = "accepted";
        const key = element.tx.domain.key();
        const value =
          txType === "remove" ? Field(0) : element.tx.domain.value();
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
            element,
          });
        }
      } else {
        console.log(
          `Transaction rejected: ${reason}, name: ${stringFromFields([
            element.tx.domain.name,
          ])}`,
          tx
        );
        tx.serializedTx.status = "rejected";
        tx.serializedTx.reason = reason ?? "invalid request";
        if (calculateTransactions)
          updates.push({
            isElementAccepted: false,
            oldRoot: root,
            type: txType,
            element,
          });
      }
    }
  }
  if (calculateTransactions) {
    let states: MapTransition[] = [];
    for (const update of updates) {
      const state = update.isElementAccepted
        ? update.type === "add"
          ? MapTransition.add(update.update!)
          : update.type === "remove"
          ? MapTransition.remove(update.update!)
          : update.type === "update"
          ? MapTransition.update(
              update.update!,
              update.element.oldDomain!,
              update.element.signature!
            )
          : MapTransition.extend(update.update!, update.element.oldDomain!)
        : MapTransition.reject(update.oldRoot, time, update.element.tx);
      states.push(state);
      const tx = update.isElementAccepted
        ? {
            time,
            oldRoot: update.oldRoot.toJSON(),
            type: update.type,
            isAccepted: update.isElementAccepted,
            state: serializeFields(MapTransition.toFields(state)),
            update: serializeFields(MapUpdateData.toFields(update.update!)),
            oldDomain: update.element.oldDomain
              ? serializeFields(DomainName.toFields(update.element.oldDomain))
              : undefined,
            signature: update.element.signature?.toBase58(),
          }
        : {
            time: time.toBigInt().toString(),
            oldRoot: update.oldRoot.toJSON(),
            type: update.type,
            isAccepted: update.isElementAccepted,
            state: serializeFields(MapTransition.toFields(state)),
            tx: serializeFields(DomainTransaction.toFields(update.element.tx)),
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
  console.log(
    "Block calculated:",
    txsCount,
    "transactions",
    "invalid:",
    invalidTxsCount
  );
  return {
    state,
    proofData,
    oldRoot,
    root,
    txsCount: UInt32.from(txsCount),
    invalidTxsCount,
    txsHash,
  };
}
