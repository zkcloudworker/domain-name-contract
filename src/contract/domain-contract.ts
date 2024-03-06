import {
  Field,
  state,
  State,
  method,
  SmartContract,
  DeployArgs,
  Reducer,
  Permissions,
  Struct,
  PublicKey,
  Bool,
  Signature,
  MerkleTree,
  MerkleMap,
} from "o1js";

import { Storage } from "./storage";
import { MapUpdateProof, MapTransition } from "./update";
import { Block, BlockCalculationProof } from "../rollup/proof";
import { DomainName } from "./update";

export const BATCH_SIZE = 3; //TODO: change to 256 in production
/*

Token account data structure:
- root of Map
- expiry time slot
- nullifier map
- count
- block number
- IPFS hash

change with signatures of the owner

what is API for mass registration and update of domain names?

*/
export class DomainNameAction extends Struct({
  domain: DomainName,
  hash: Field,
}) {}

export class ReducerState extends Struct({
  count: Field,
  hash: Field,
}) {
  static assertEquals(a: ReducerState, b: ReducerState) {
    a.count.assertEquals(b.count);
    a.hash.assertEquals(b.hash);
  }
}

export class MapTransitionEvent extends Struct({
  transition: MapTransition,
  storage: Storage,
}) {}

export class BlockEvent extends Struct({
  transition: Block,
  storage: Storage,
}) {}

export class DomainNameContract extends SmartContract {
  @state(Field) domain = State<Field>();
  @state(Field) root = State<Field>();
  @state(Field) updates = State<Field>();
  @state(Field) block = State<Field>();
  @state(Field) actionState = State<Field>();
  @state(PublicKey) owner = State<PublicKey>();
  @state(Bool) isSynced = State<Bool>();

  deploy(args: DeployArgs) {
    super.deploy(args);
    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proof(),
    });
  }

  init() {
    super.init();
    this.root.set(new MerkleTree(20).getRoot());
    this.updates.set(new MerkleMap().getRoot());
    this.actionState.set(Reducer.initialActionState);
    this.isSynced.set(Bool(true));
    this.block.set(Field(0));
  }

  // TODO: snapshot, 5 last states in token accounts, reduce updates

  reducer = Reducer({
    actionType: DomainNameAction,
  });

  events = {
    add: DomainName,
    update: DomainName,
    reduce: ReducerState,
    commitNewNames: BlockEvent,
    commitUpdatedNames: MapTransitionEvent,
  };

  @method add(domain: DomainName, signature: Signature) {
    const hash = domain.hash();
    const action = new DomainNameAction({ domain, hash });

    signature.verify(domain.address, domain.toFields()).assertEquals(true);
    this.reducer.dispatch(action);
    this.emitEvent("add", domain);
  }

  @method update(domain: DomainName, signature: Signature) {
    const hash = domain.hash();
    const action = new DomainNameAction({ domain, hash });

    signature.verify(domain.address, domain.toFields()).assertEquals(true);
    this.emitEvent("update", domain);
  }

  @method reduce(
    startActionState: Field,
    endActionState: Field,
    reducerState: ReducerState,
    proof: MapUpdateProof,
    blockProof: BlockCalculationProof,
    signature: Signature
  ) {
    const owner = this.owner.getAndRequireEquals();
    const block = this.block.getAndRequireEquals();
    signature
      .verify(owner, [
        ...proof.publicInput.toFields(),
        ...blockProof.publicInput.toFields(),
      ])
      .assertEquals(true);
    proof.verify();
    proof.publicInput.oldRoot.assertEquals(new MerkleMap().getRoot());
    proof.publicInput.hash.assertEquals(reducerState.hash);
    proof.publicInput.count.assertEquals(reducerState.count.toFields()[0]);

    blockProof.verify();
    blockProof.publicInput.oldRoot.assertEquals(
      this.root.getAndRequireEquals()
    );
    blockProof.publicInput.value.assertEquals(proof.publicInput.newRoot);
    blockProof.publicInput.index.assertEquals(block);

    const actionState = this.actionState.getAndRequireEquals();
    actionState.assertEquals(startActionState);

    const pendingActions = this.reducer.getActions({
      fromActionState: actionState,
      endActionState,
    });

    let elementsState: ReducerState = new ReducerState({
      count: Field(0),
      hash: Field(0),
    });

    const { state: newReducerState, actionState: newActionState } =
      this.reducer.reduce(
        pendingActions,
        ReducerState,
        (state: ReducerState, action: DomainNameAction) => {
          return new ReducerState({
            count: state.count.add(Field(1)),
            hash: state.hash.add(action.hash),
          });
        },
        {
          state: elementsState,
          actionState: actionState,
        },
        {
          maxTransactionsWithActions: BATCH_SIZE,
          skipActionStatePrecondition: true,
        }
      );
    ReducerState.assertEquals(newReducerState, reducerState);
    const accountActionState = this.account.actionState.getAndRequireEquals();
    const isSynced = newActionState.equals(accountActionState);
    this.isSynced.set(isSynced);
    this.actionState.set(newActionState);
    this.root.set(blockProof.publicInput.newRoot);
    this.block.set(block.add(Field(1)));
    this.emitEvent("reduce", reducerState);
  }

  @method commitNewNames(
    proof: BlockCalculationProof,
    signature: Signature,
    storage: Storage
  ) {
    const owner = this.owner.getAndRequireEquals();
    const block = this.block.getAndRequireEquals();
    signature.verify(owner, proof.publicInput.toFields()).assertEquals(true);
    proof.verify();
    proof.publicInput.oldRoot.assertEquals(this.root.getAndRequireEquals());
    proof.publicInput.index.assertEquals(block);

    this.root.set(proof.publicInput.newRoot);
    this.block.set(block.add(Field(1)));
    const transitionEvent = new BlockEvent({
      transition: proof.publicInput,
      storage: storage,
    });
    this.emitEvent("commitNewNames", transitionEvent);
  }

  // TODO: prove that content of the updates in block and the updates Map is the same
  @method commitUpdatedNames(
    proof: MapUpdateProof,
    blockProof: BlockCalculationProof,
    signature: Signature,
    storage: Storage
  ) {
    const owner = this.owner.getAndRequireEquals();
    const block = this.block.getAndRequireEquals();
    signature
      .verify(owner, [
        ...proof.publicInput.toFields(),
        ...blockProof.publicInput.toFields(),
      ])
      .assertEquals(true);
    proof.verify();
    proof.publicInput.oldRoot.assertEquals(this.updates.getAndRequireEquals());
    blockProof.verify();
    blockProof.publicInput.oldRoot.assertEquals(
      this.root.getAndRequireEquals()
    );
    blockProof.publicInput.index.assertEquals(block);

    this.updates.set(proof.publicInput.newRoot);
    this.root.set(blockProof.publicInput.newRoot);
    this.block.set(block.add(Field(1)));
    const transitionEvent = new MapTransitionEvent({
      transition: proof.publicInput,
      storage: storage,
    });
    this.emitEvent("commitUpdatedNames", transitionEvent);
  }

  @method setOwner(newOwner: PublicKey, signature: Signature) {
    const owner = this.owner.getAndRequireEquals();
    signature.verify(owner, newOwner.toFields()).assertEquals(true);
    this.owner.set(newOwner);
  }

  // TODO: remove after debugging
  @method setRoot(root: Field, block: Field, signature: Signature) {
    const owner = this.owner.getAndRequireEquals();
    signature.verify(owner, [root, block]).assertEquals(true);
    this.root.set(root);
    this.block.set(block);
  }
}
