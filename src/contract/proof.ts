import { Field, MerkleMap, verify, VerificationKey } from "o1js";
import { DomainNameAction } from "./domain-contract";
import {
  MapUpdateData,
  MapTransition,
  MapUpdateProof,
  MapUpdate,
  DomainName,
} from "./update";
import { Memory } from "../lib/memory";

export async function calculateProof(
  elements: DomainNameAction[],
  map: MerkleMap,
  verificationKey: VerificationKey | undefined,
  verbose: boolean = false
): Promise<MapUpdateProof> {
  console.log(`Calculating proofs for ${elements.length} elements...`);
  if (verificationKey === undefined)
    throw new Error("Verification key is not defined");

  interface ElementState {
    isElementAccepted: boolean;
    update?: MapUpdateData;
    oldRoot: Field;
  }
  let updates: ElementState[] = [];

  for (const element of elements) {
    const oldRoot = map.getRoot();
    if (isAccepted(element)) {
      const key = element.domain.key();
      const value = element.domain.value();
      map.set(key, value);
      const newRoot = map.getRoot();
      const update = new MapUpdateData({
        oldRoot,
        newRoot,
        key,
        oldValue: Field(0),
        newValue: value,
        witness: map.getWitness(key),
      });
      updates.push({ isElementAccepted: true, update, oldRoot });
    } else {
      updates.push({ isElementAccepted: false, oldRoot });
    }
  }

  let proofs: MapUpdateProof[] = [];
  for (let i = 0; i < elements.length; i++) {
    const state = updates[i].isElementAccepted
      ? MapTransition.accept(updates[i].update!, elements[i].domain)
      : MapTransition.reject(updates[i].oldRoot, elements[i].domain);

    const proof = updates[i].isElementAccepted
      ? await MapUpdate.accept(state, updates[i].update!, elements[i].domain)
      : await MapUpdate.reject(state, updates[i].oldRoot, elements[i].domain);
    if (i === 0) Memory.info(`Setting base for RSS memory`, false, true);
    proofs.push(proof);
    if (verbose) Memory.info(`Proof ${i + 1}/${elements.length} created`);
  }

  console.log("Merging proofs...");
  let proof: MapUpdateProof = proofs[0];
  for (let i = 1; i < proofs.length; i++) {
    const state = MapTransition.merge(proof.publicInput, proofs[i].publicInput);
    let mergedProof: MapUpdateProof = await MapUpdate.merge(
      state,
      proof,
      proofs[i]
    );
    if (i === 1) Memory.info(`Setting base for RSS memory`, false, true);
    proof = mergedProof;
    if (verbose) Memory.info(`Proof ${i}/${proofs.length - 1} merged`);
  }

  function isAccepted(element: DomainNameAction): boolean {
    const name = element.domain.name;
    const value = map.get(name);
    const isAccepted: boolean = value.equals(Field(0)).toBoolean();
    return isAccepted;
  }
  const verificationResult: boolean = await verify(
    proof.toJSON(),
    verificationKey
  );

  console.log("Proof verification result:", verificationResult);
  if (verificationResult === false) {
    throw new Error("Proof verification error");
  }

  return proof;
}

/*
export async function prepareProofData(
  elements: DomainName[],
  map: MerkleMap
): Promise<{ state: Field[]; transactions: string[] }> {
  console.log(`Preparing proofs data for ${elements.length} elements...`);
  const transactions: string[] = [];

  interface ElementState {
    isElementAccepted: boolean;
    update?: MapUpdateData;
    oldRoot: Field;
  }

  function isAccepted(element: DomainNameAction): boolean {
    const name = element.domain.name;
    const value = map.get(name);
    const isAccepted: boolean = value.equals(Field(0)).toBoolean();
    return isAccepted;
  }

  let updates: ElementState[] = [];

  for (const element of elements) {
    const oldRoot = map.getRoot();
    if (isAccepted(element)) {
      map.set(element.name, element.addressHash);
      const newRoot = map.getRoot();
      const update = new MapUpdateData({
        oldRoot,
        newRoot,
        key: element.name,
        oldValue: Field(0),
        newValue: element.addressHash,
        witness: map.getWitness(element.name),
      });
      updates.push({ isElementAccepted: true, update, oldRoot });
    } else {
      updates.push({ isElementAccepted: false, oldRoot });
    }
  }

  let states: MapTransition[] = [];
  for (let i = 0; i < elements.length; i++) {
    console.log(
      `Calculating state ${i}/${elements.length}...`,
      elements[i].name.toJSON()
    );
    if (updates[i].isElementAccepted) {
      const update = updates[i].update;
      if (update === undefined) throw new Error("Update is undefined");
      const state = MapTransition.accept(update, elements[i].address);
      states.push(state);
      const tx = {
        isAccepted: true,
        state: state.toFields().map((f) => f.toJSON()),
        address: elements[i].address.toBase58(),
        update: update.toFields().map((f) => f.toJSON()),
      };
      transactions.push(JSON.stringify(tx, null, 2));
    } else {
      const state = MapTransition.reject(
        updates[i].oldRoot,
        elements[i].name,
        elements[i].address
      );
      const tx = {
        isAccepted: false,
        state: state.toFields().map((f) => f.toJSON()),
        address: elements[i].address.toBase58(),
        root: updates[i].oldRoot.toJSON(),
        name: elements[i].name.toJSON(),
      };
      transactions.push(JSON.stringify(tx, null, 2));
      states.push(state);
    }
  }

  let state: MapTransition = states[0];
  for (let i = 1; i < states.length; i++) {
    const newState = MapTransition.merge(state, states[i]);
    state = newState;
  }

  return { state: state.toFields(), transactions };
}
*/
