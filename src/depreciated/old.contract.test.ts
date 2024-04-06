import { describe, expect, it } from "@jest/globals";
import {
  Field,
  PrivateKey,
  Mina,
  Reducer,
  AccountUpdate,
  Poseidon,
  MerkleMap,
  MerkleTree,
  Bool,
  Signature,
  VerificationKey,
  Account,
  verify,
} from "o1js";
import { makeString } from "zkcloudworker";
import {
  DomainNameContract,
  DomainNameAction,
  ReducerState,
  BATCH_SIZE,
} from "../contract/domain-contract";
import { stringToFields } from "../lib/hash";
import { MapUpdateProof, MapUpdate, DomainName } from "../rollup/transaction";
import { TREE_HEIGHT, addBlock, BlockElement } from "../rollup/blocks";
import { BlockCalculation } from "./proof";
import { calculateProof } from "../rollup/blocks";
import { Storage } from "../contract/storage";
import { Metadata } from "../contract/metadata";
import { emptyActionsHash, calculateActionsHash } from "../lib/hash";
import { Memory } from "../lib/memory";

const ACTIONS_COUNT = 1;
const ELEMENTS_NUMBER = 1000;
const BLOCKS_NUMBER = 2;
const blockData: BlockElement[][] = [];

let treeVerificationKey: VerificationKey | undefined = undefined;
let mapVerificationKey: VerificationKey | undefined = undefined;
let blocks: Field[] = [];

describe("Contract", () => {
  const Local = Mina.LocalBlockchain();
  Mina.setActiveInstance(Local);
  const deployer = Local.testAccounts[0].privateKey;
  const sender = deployer.toPublicKey();
  const privateKey = PrivateKey.random();
  const publicKey = privateKey.toPublicKey();
  const zkApp = new DomainNameContract(publicKey);
  const userPrivateKeys: PrivateKey[] = [];
  const elements: DomainName[] = [];
  const storage = new Storage({ hashString: [Field(1), Field(2)] });
  const metadata = new Metadata({ data: Field(0), kind: Field(0) });
  const ownerPrivateKey = PrivateKey.random(); // owner of the contract
  const ownerPublicKey = ownerPrivateKey.toPublicKey();

  it(`should prepare blocks data`, async () => {
    console.time(`prepared data`);
    for (let j = 0; j < BLOCKS_NUMBER; j++) {
      const blockElements: BlockElement[] = [];
      for (let i = 0; i < ELEMENTS_NUMBER; i++) {
        const key = stringToFields(makeString(30));
        expect(key.length).toBe(1);
        const storage = stringToFields("i:" + makeString(45));
        expect(storage.length).toBe(2);
        const address = PrivateKey.random().toPublicKey().toFields();
        const value = Poseidon.hash([...address, ...storage]);
        const element: BlockElement = {
          key: key[0],
          value,
        };
        blockElements.push(element);
      }
      blockData.push(blockElements);
    }
    console.timeEnd(`prepared data`);
  });

  it(`should compile contract`, async () => {
    console.time("methods analyzed");
    let methods = DomainNameContract.analyzeMethods();
    console.timeEnd("methods analyzed");
    //console.log("methods", methods);
    // calculate the size of the contract - the sum or rows for each method
    let size = Object.values(methods).reduce(
      (acc, method) => acc + method.rows,
      0
    );
    const maxRows = 2 ** 16;
    // calculate percentage rounded to 0 decimal places
    let percentage = Math.round((size / maxRows) * 100);

    console.log(
      `method's total size for a contract with batch size ${BATCH_SIZE} is ${size} rows (${percentage}% of max ${maxRows} rows)`
    );
    console.log("add rows:", methods["add"].rows);
    console.log("update rows:", methods["update"].rows);
    console.log("reduce rows:", methods["reduce"].rows);
    console.log("setOwner rows:", methods["setOwner"].rows);

    const methods1 = MapUpdate.analyzeMethods();

    //console.log("methods", methods);
    // calculate the size of the contract - the sum or rows for each method
    size = Object.values(methods1).reduce(
      (acc, method) => acc + method.rows,
      0
    );
    // calculate percentage rounded to 0 decimal places
    percentage = Math.round((size / maxRows) * 100);

    console.log(
      `method's total size for a MapUpdate is ${size} rows (${percentage}% of max ${maxRows} rows)`
    );

    const methods2 = BlockCalculation.analyzeMethods();

    //console.log("methods", methods);
    // calculate the size of the contract - the sum or rows for each method
    size = Object.values(methods2).reduce(
      (acc, method) => acc + method.rows,
      0
    );
    // calculate percentage rounded to 0 decimal places
    percentage = Math.round((size / maxRows) * 100);

    console.log(
      `method's total size for a BlockCalculation is ${size} rows (${percentage}% of max ${maxRows} rows)`
    );

    console.log("Compiling contracts...");
    console.time("MapUpdate compiled");
    mapVerificationKey = (await MapUpdate.compile()).verificationKey;
    console.timeEnd("MapUpdate compiled");

    console.time("BlockCalculation compiled");
    treeVerificationKey = (await BlockCalculation.compile()).verificationKey;
    console.timeEnd("BlockCalculation compiled");

    console.time("DomainNameContract compiled");
    await DomainNameContract.compile();
    console.timeEnd("DomainNameContract compiled");
    Memory.info(`should compile the SmartContract`);
  });

  it("should deploy the contract", async () => {
    const tx = await Mina.transaction({ sender }, () => {
      AccountUpdate.fundNewAccount(sender);
      zkApp.deploy({});
      zkApp.domain.set(Field(0));
      zkApp.owner.set(ownerPublicKey);
    });
    await tx.sign([deployer, privateKey]).send();
    Memory.info(`should deploy the contract`);
    const account = Account(publicKey);
    const finalActionState = account.actionState.get();
    //console.log("first ActionState", finalActionState.toJSON());
    const emptyActionsState = emptyActionsHash();
    //console.log("emptyActionsState", emptyActionsState.toJSON());
    const reducerActionsState = Reducer.initialActionState;
    //console.log("reducerActionsState", reducerActionsState.toJSON());
    expect(finalActionState.toJSON()).toEqual(emptyActionsState.toJSON());
    expect(finalActionState.toJSON()).toEqual(reducerActionsState.toJSON());
    const isSynced = zkApp.isSynced.get().toBoolean();
    expect(isSynced).toEqual(true);
    const root = zkApp.root.get();
    const updates = zkApp.updates.get();
    expect(root.toJSON()).toEqual(new MerkleTree(20).getRoot().toJSON());
    expect(updates.toJSON()).toEqual(new MerkleMap().getRoot().toJSON());
    const block = zkApp.block.get();
    expect(block.toJSON()).toEqual(Field(0).toJSON());
  });

  it(`should create a blocks`, async () => {
    expect(treeVerificationKey).toBeDefined();
    if (treeVerificationKey === undefined) return;

    for (let i = 0; i < BLOCKS_NUMBER; i++) {
      console.time(`created a block ${i} of ${ELEMENTS_NUMBER} elements`);
      const proof = await addBlock(blocks, blockData[i], Field(0));
      const ok = await verify(proof, treeVerificationKey);
      expect(ok).toBe(true);
      if (!ok) return;
      const root = zkApp.root.get();
      expect(root.toJSON()).toEqual(proof.publicInput.oldRoot.toJSON());
      const block = zkApp.block.get();
      expect(block.toJSON()).toEqual(proof.publicInput.index.toJSON());
      const signature = Signature.create(
        ownerPrivateKey,
        proof.publicInput.toFields()
      );
      const tx = await Mina.transaction({ sender }, () => {
        zkApp.commitNewNames(proof, signature, storage);
      });
      await tx.prove();
      await tx.sign([deployer]).send();
      Memory.info(`should commit the block ${i}`);
      blocks.push(proof.publicInput.value);
      console.timeEnd(`created a block ${i} of ${ELEMENTS_NUMBER} elements`);
    }
  });

  it("should generate elements", () => {
    for (let i = 0; i < ACTIONS_COUNT; i++) {
      const name = Field(i < 2 ? 1 : i + 1);
      const userPrivateKey = PrivateKey.random();
      const address = userPrivateKey.toPublicKey();

      const element = new DomainName({
        name,
        address,
        metadata,
        storage,
      });
      elements.push(element);
      userPrivateKeys.push(userPrivateKey);
    }
  });

  it("should send the elements", async () => {
    console.time("send elements");
    for (let i = 0; i < ACTIONS_COUNT; i++) {
      const signature = Signature.create(
        userPrivateKeys[i],
        elements[i].toFields()
      );
      const tx = await Mina.transaction({ sender }, () => {
        zkApp.add(elements[i], signature);
      });
      Memory.info(`element ${i + 1}/${ACTIONS_COUNT} sent`);
      await tx.prove();
      if (i === 0) Memory.info(`Setting base for RSS memory`, false, true);
      await tx.sign([deployer]).send();
    }
    console.timeEnd("send elements");
    Memory.info(`should send the elements`);
  });

  it("should check the actions", async () => {
    let actions = zkApp.reducer.getActions({
      fromActionState: zkApp.actionState.get(),
    });
    // console.log("actions", actions.length);
    let actionState = emptyActionsHash();
    //console.log("actionState", actionState.toJSON());
    const actions2 = await Mina.fetchActions(publicKey);
    const account = Account(publicKey);
    const finalActionState = account.actionState.get();
    //console.log("finalActionState", finalActionState.toJSON());
    if (Array.isArray(actions2)) {
      for (let i = 0; i < actions2.length; i++) {
        //console.log("action", i, actions2[i].actions[0]);
        //console.log("hash", actions2[i].hash);

        const element = DomainNameAction.fromFields(
          actions2[i].actions[0].map((f: string) => Field.fromJSON(f))
        );
        expect(element.domain.name.toJSON()).toEqual(
          actions[i][0].domain.name.toJSON()
        );
        expect(element.domain.address.toJSON()).toEqual(
          actions[i][0].domain.address.toJSON()
        );
        expect(element.domain.metadata.toFields()[0]).toEqual(
          actions[i][0].domain.metadata.toFields()[0]
        );
        expect(element.domain.metadata.toFields()[1]).toEqual(
          actions[i][0].domain.metadata.toFields()[1]
        );
        expect(element.domain.storage.toFields()[0]).toEqual(
          actions[i][0].domain.storage.toFields()[0]
        );
        expect(element.domain.storage.toFields()[1]).toEqual(
          actions[i][0].domain.storage.toFields()[1]
        );
        expect(element.hash.toJSON()).toEqual(actions[i][0].hash.toJSON());

        actionState = calculateActionsHash(actions2[i].actions, actionState);
        //console.log("actionState", actionState.toJSON());
        expect(actionState.toJSON()).toEqual(actions2[i].hash);
      }
    }
    expect(finalActionState.toJSON()).toEqual(actionState.toJSON());
  });

  it("should update the state", async () => {
    let actions = await Mina.fetchActions(publicKey);
    let length = 0;
    let startActionState: Field = zkApp.actionState.get();
    let firstPass = true;
    if (Array.isArray(actions)) length = Math.min(actions.length, BATCH_SIZE);
    while (length > 0) {
      const isSynced = zkApp.isSynced.get().toBoolean();
      const currentBlock = zkApp.block.get();
      expect(Number(currentBlock.toBigInt())).toEqual(blocks.length);
      expect(isSynced).toEqual(firstPass);
      firstPass = false;
      console.time("reduce");
      if (Array.isArray(actions)) {
        console.log("length", length);
        let hash: Field = Field(0);
        const elements: DomainNameAction[] = [];
        for (let i = 0; i < length; i++) {
          const element: DomainNameAction = DomainNameAction.fromFields(
            actions[i].actions[0].map((f: string) => Field.fromJSON(f))
          );
          const calculatedHash = element.domain.hash();
          expect(calculatedHash.toJSON()).toEqual(element.hash.toJSON());
          hash = hash.add(calculatedHash);
          elements.push(element);
        }
        const reducerState = new ReducerState({
          count: Field(length),
          hash,
        });
        const endActionState: Field = Field.fromJSON(actions[length - 1].hash);

        expect(mapVerificationKey).toBeDefined();
        expect(treeVerificationKey).toBeDefined();
        if (
          mapVerificationKey === undefined ||
          treeVerificationKey === undefined
        )
          return;
        const map = new MerkleMap();
        const tree = new MerkleTree(20);
        tree.fill(blocks);
        const root = zkApp.root.get();
        expect(root.toJSON()).toBe(tree.getRoot().toJSON());
        const { proof, blockProof } = await calculateProof(
          elements,
          map,
          tree,
          Field(blocks.length),
          mapVerificationKey,
          treeVerificationKey,
          true
        );
        const signature = Signature.create(ownerPrivateKey, [
          ...proof.publicInput.toFields(),
          ...blockProof.publicInput.toFields(),
        ]);

        const tx = await Mina.transaction({ sender }, () => {
          zkApp.reduce(
            startActionState,
            endActionState,
            reducerState,
            proof,
            blockProof,
            signature
          );
        });
        await tx.prove();
        await tx.sign([deployer]).send();
        Memory.info(`should update the state`);
        blocks.push(blockProof.publicInput.value);
      }
      startActionState = zkApp.actionState.get();
      const actionStates = { fromActionState: startActionState };
      actions = await Mina.fetchActions(publicKey, actionStates);
      if (Array.isArray(actions)) length = Math.min(actions.length, BATCH_SIZE);
      console.timeEnd("reduce");
    }
    const isSynced = zkApp.isSynced.get().toBoolean();
    expect(isSynced).toEqual(true);
  });

  it("should reset the root", async () => {
    console.time("reset");
    const map = new MerkleMap();
    const root = map.getRoot();
    const signature = Signature.create(ownerPrivateKey, [root, Field(0)]);
    const tx = await Mina.transaction({ sender }, () => {
      zkApp.setRoot(root, Field(0), signature);
    });
    await tx.prove();
    await tx.sign([deployer]).send();
    console.timeEnd("reset");
    Memory.info(`reset`);
  });
});
