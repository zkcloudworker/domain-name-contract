import { Field, verify, VerificationKey, UInt64 } from "o1js";
import {
  MapUpdateData,
  MapTransition,
  MapUpdateProof,
  MapUpdate,
  DomainName,
  DomainTransactionData,
  DomainTransactionType,
} from "./transaction";
import { MerkleMap } from "../lib/merkle-map";
import { Memory } from "../lib/memory";

export async function calculateTransactionsProof(
  elements: DomainTransactionData[],
  map: MerkleMap,
  verificationKey: VerificationKey | undefined,
  verbose: boolean = false
): Promise<MapUpdateProof> {
  console.log(`Calculating proofs for ${elements.length} elements...`);
  if (verificationKey === undefined)
    throw new Error("MapUpdate Verification key is not defined");

  interface ElementState {
    isElementAccepted: boolean;
    update?: MapUpdateData;
    oldRoot: Field;
    type: DomainTransactionType;
  }
  let updates: ElementState[] = [];
  const time = UInt64.from(Date.now() - 1000 * 60 * 60 * 10);

  for (const element of elements) {
    const oldRoot = map.getRoot();
    const txType = element.txType();
    //console.log(`Calculating proof data for ${txType} ...`);
    if (isAccepted(element)) {
      const key = element.tx.domain.key();
      const value = txType === "remove" ? Field(0) : element.tx.domain.value();
      map.set(key, value);
      const newRoot = map.getRoot();
      const update = new MapUpdateData({
        oldRoot,
        newRoot,
        time,
        tx: element.tx,
        witness: map.getWitness(key),
      });
      updates.push({ isElementAccepted: true, update, oldRoot, type: txType });
    } else {
      updates.push({ isElementAccepted: false, oldRoot, type: txType });
    }
  }

  let proofs: MapUpdateProof[] = [];
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

    const proof = updates[i].isElementAccepted
      ? updates[i].type === "add"
        ? await MapUpdate.add(state, updates[i].update!)
        : updates[i].type === "remove"
        ? await MapUpdate.remove(state, updates[i].update!)
        : updates[i].type === "update"
        ? await MapUpdate.update(
            state,
            updates[i].update!,
            elements[i].oldDomain!,
            elements[i].signature!
          )
        : await MapUpdate.extend(
            state,
            updates[i].update!,
            elements[i].oldDomain!
          )
      : await MapUpdate.reject(state, updates[i].oldRoot, time, elements[i].tx);

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
    proof = mergedProof;
    if (verbose) Memory.info(`Proof ${i}/${proofs.length - 1} merged`);
  }

  const verificationResult: boolean = await verify(
    proof.toJSON(),
    verificationKey
  );

  //console.log("Proof verification result:", verificationResult);
  if (verificationResult === false) {
    throw new Error("Proof verification error");
  }

  return proof;
}

function isAccepted(element: DomainTransactionData): boolean {
  if (
    (element.txType() === "update" || element.txType() === "extend") &&
    element.oldDomain === undefined
  )
    return false;
  if (element.txType() === "update" && element.signature === undefined)
    return false;
  if (
    element.txType() === "extend" &&
    element.tx.domain.data.expiry
      .greaterThan(element.oldDomain!.data.expiry)
      .toBoolean() === false
  )
    return false;
  return true; // TODO: implement
}

export async function prepareProofData(
  elements: DomainTransactionData[],
  map: MerkleMap,
  verbose: boolean = false
): Promise<{ state: Field[]; transactions: string[] }> {
  console.log(`Preparing proofs data for ${elements.length} elements...`);
  const transactions: string[] = [];
  interface ElementState {
    isElementAccepted: boolean;
    update?: MapUpdateData;
    oldRoot: Field;
    type: DomainTransactionType;
  }
  let updates: ElementState[] = [];
  const time = UInt64.from(Date.now() - 1000 * 60 * 60 * 10);

  for (const element of elements) {
    const oldRoot = map.getRoot();
    const txType = element.txType();
    //console.log(`Calculating proof data for ${txType} ...`);
    if (isAccepted(element)) {
      const key = element.tx.domain.key();
      const value = txType === "remove" ? Field(0) : element.tx.domain.value();
      map.set(key, value);
      const newRoot = map.getRoot();
      const update = new MapUpdateData({
        oldRoot,
        newRoot,
        time,
        tx: element.tx,
        witness: map.getWitness(key),
      });
      updates.push({ isElementAccepted: true, update, oldRoot, type: txType });
      if (txType !== "add")
        throw new Error("Only add transactions are supported");
    } else {
      throw new Error("Not accepted is not supported yet");
      updates.push({ isElementAccepted: false, oldRoot, type: txType });
    }
  }

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
      state: MapTransition.toFields(state).map((f) => f.toJSON()),
      update: MapUpdateData.toFields(updates[i].update!).map((f) => f.toJSON()),
    };
    transactions.push(JSON.stringify(tx, null, 2));
  }

  let state: MapTransition = states[0];
  for (let i = 1; i < states.length; i++) {
    const newState = MapTransition.merge(state, states[i]);
    state = newState;
  }

  return { state: MapTransition.toFields(state), transactions };
}

/*
export async function calculateBlockProof(
  tree: MerkleTree,
  block: Field,
  value: Field,
  treeVerificationKey: VerificationKey | undefined,
  verbose: boolean = false
): Promise<BlockCalculationProof> {
  if (treeVerificationKey === undefined)
    throw new Error("Tree Verification key is not defined");
  const oldRoot = tree.getRoot();
  const index = block.toBigInt();
  tree.setLeaf(index, value);
  const newRoot = tree.getRoot();
  const witness: BlockMerkleTreeWitness = new BlockMerkleTreeWitness(
    tree.getWitness(index)
  );
  const newBlock: Block = new Block({
    oldRoot,
    newRoot,
    index: block,
    value,
  });
  const proof = await BlockCalculation.create(newBlock, witness);
  const verificationResult: boolean = await verify(
    proof.toJSON(),
    treeVerificationKey
  );
  console.log("Block proof verification result:", verificationResult);
  if (verificationResult === false) {
    throw new Error("Block proof verification error");
  }
  return proof;
}


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
